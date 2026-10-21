/**
 * Fails the run when a pull request body does not carry the sections that its
 * template marks as required.
 */

const fs = require('fs');
const path = require('path');

const { isBot } = require('./utils');
const { PR_TEMPLATE_PATHS, PR_TEMPLATE_TARGET } = require('./constants');

const ORG_TEMPLATE_PATH = path.join(__dirname, '..', PR_TEMPLATE_TARGET);

const HEADING = /^## [^#]/;
const REQUIRED_MARKER = /^\s*<!--\s*REQUIRED\s*-->\s*$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const PLACEHOLDER = '…';

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

// A template that marks nothing requires every section, so a repo whose template
// has no markers is strict rather than unchecked.
function requiredHeadings(template) {
  const all = sections(template);
  const marked = all.filter(isMarked);
  return (marked.length ? marked : all).map(section => section.heading);
}

function content(section) {
  return section.lines.join('\n').replace(HTML_COMMENT, '').trim();
}

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
    } else if (text.split('\n').some(line => line.trim() === PLACEHOLDER)) {
      // The template puts the placeholder on a line of its own, so an ellipsis
      // inside a sentence is prose rather than an unfilled section.
      problems.push(`\`${heading}\` still holds the \`${PLACEHOLDER}\` placeholder.`);
    }
  }
  return problems;
}

/**
 * The repo's own template, `null` when it holds none, or `{ unreadable }` when a
 * candidate path answered with anything but a 404. The repo may hold a template
 * there, and judging the body against the shared one instead would fail a body
 * that follows the template the author was given.
 */
async function readRepoTemplate({ github, context, core }, ref) {
  for (const templatePath of PR_TEMPLATE_PATHS) {
    try {
      const response = await github.rest.repos.getContent({
        owner: context.repo.owner,
        repo: context.repo.repo,
        path: templatePath,
        ref,
      });
      if (response.data?.content) {
        core.info(`Checking against ${templatePath} on ${ref}.`);
        return { template: Buffer.from(response.data.content, 'base64').toString('utf8') };
      }
    } catch (error) {
      if (error.status !== 404) {
        return { unreadable: `${templatePath}: ${error.message}` };
      }
    }
  }
  return { template: null };
}

module.exports = async ({ github, context, core }) => {
  try {
    const pullRequest = context.payload.pull_request;
    const author = pullRequest.user.login;

    if (await isBot(author, { core })) {
      core.info(`${author} is a bot, so the template is not checked.`);
      return;
    }

    const found = await readRepoTemplate({ github, context, core }, pullRequest.base.ref);
    if (found.unreadable) {
      core.warning(`Could not read ${found.unreadable}, so the template is not checked.`);
      return;
    }

    const template = found.template ?? fs.readFileSync(ORG_TEMPLATE_PATH, 'utf8');
    if (!found.template) {
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
