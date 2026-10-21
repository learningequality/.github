/**
 * Fails the run when a pull request body does not carry the sections that its
 * template marks as required.
 */

const fs = require('fs');
const path = require('path');

const { isBot } = require('./utils');

const ORG_TEMPLATE_PATH = path.join(__dirname, '..', '.github', 'PULL_REQUEST_TEMPLATE.md');

// The contents API is case sensitive, so both spellings are tried in each of the
// three places GitHub reads a template from.
const REPO_TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
];

const HEADING = /^## [^#]/;
const REQUIRED_MARKER = /^\s*<!--\s*REQUIRED\s*-->\s*$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const PLACEHOLDER = '…';

/**
 * Splits markdown on level-two headings, so a deeper heading stays in its section.
 */
function sections(markdown) {
  const out = [];
  for (const line of (markdown || '').split('\n')) {
    if (HEADING.test(line)) out.push({ heading: line.trim(), lines: [] });
    else if (out.length) out[out.length - 1].lines.push(line);
  }
  return out;
}

function isMarked(section) {
  const first = section.lines.find(line => line.trim() !== '');
  return first !== undefined && REQUIRED_MARKER.test(first);
}

/**
 * The headings a body must carry. A template that marks none requires them all,
 * so a repo whose template has no markers is strict rather than unchecked.
 */
function requiredHeadings(template) {
  const all = sections(template);
  const marked = all.filter(isMarked);
  return (marked.length ? marked : all).map(section => section.heading);
}

function content(section) {
  return section.lines.join('\n').replace(HTML_COMMENT, '').trim();
}

/**
 * One message per required section the body does not satisfy.
 */
function failures(body, required) {
  const found = new Map(sections(body).map(section => [section.heading.toLowerCase(), section]));
  const problems = [];
  for (const heading of required) {
    const section = found.get(heading.toLowerCase());
    if (!section) {
      problems.push(`\`${heading}\` is missing.`);
      continue;
    }
    const text = content(section);
    if (text === '') {
      problems.push(`\`${heading}\` is empty.`);
    } else if (text.includes(PLACEHOLDER)) {
      problems.push(`\`${heading}\` still holds the \`${PLACEHOLDER}\` placeholder.`);
    }
  }
  return problems;
}

async function readRepoTemplate({ github, context, core }, ref) {
  for (const templatePath of REPO_TEMPLATE_PATHS) {
    try {
      const response = await github.rest.repos.getContent({
        owner: context.repo.owner,
        repo: context.repo.repo,
        path: templatePath,
        ref,
      });
      if (response.data?.content) {
        core.info(`Checking against ${templatePath} on ${ref}.`);
        return Buffer.from(response.data.content, 'base64').toString('utf8');
      }
    } catch (error) {
      if (error.status !== 404) {
        core.warning(`Could not read ${templatePath}: ${error.message}`);
      }
    }
  }
  return null;
}

module.exports = async ({ github, context, core }) => {
  try {
    const pullRequest = context.payload.pull_request;
    const author = pullRequest.user.login;

    if (await isBot(author, { core })) {
      core.info(`${author} is a bot, so the template is not checked.`);
      return;
    }

    const repoTemplate = await readRepoTemplate(
      { github, context, core },
      pullRequest.base.ref,
    );
    const template = repoTemplate ?? fs.readFileSync(ORG_TEMPLATE_PATH, 'utf8');
    if (!repoTemplate) {
      core.info('No template in this repo, so the shared template applies.');
    }

    const required = requiredHeadings(template);
    if (!required.length) {
      core.warning('The template holds no sections, so there is nothing to check.');
      return;
    }

    const problems = failures(pullRequest.body, required);
    if (!problems.length) {
      core.info(`The body carries all ${required.length} required sections.`);
      return;
    }

    for (const problem of problems) {
      core.error(problem);
    }
    core.setFailed(
      `The description does not follow the pull request template:\n` +
        problems.map(problem => `- ${problem}`).join('\n') +
        `\n\nRequired: ${required.join(', ')}. Edit the description and the check runs again.`,
    );
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
