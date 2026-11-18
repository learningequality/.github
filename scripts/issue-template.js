const fs = require('fs');
const path = require('path');

const {
  headingKey,
  sections,
  requiredSections,
  failures,
  syncComment,
} = require('./template-check');
const {
  LABEL_NEEDS_TEMPLATE,
  ISSUE_TEMPLATE_MARKER,
  ISSUE_TEMPLATE_MAX_DAYS,
} = require('./constants');
const { addLabel } = require('./utils');

const TEMPLATE_DIR = path.join(__dirname, '..', '.github', 'ISSUE_TEMPLATE');
const TEMPLATE_URL = 'https://github.com/learningequality/.github/blob/main/.github/ISSUE_TEMPLATE';
const FRONT_MATTER_NAME = /^name:\s*["']?(.+?)["']?\s*$/m;

function readTemplates(dir = TEMPLATE_DIR) {
  return fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.md'))
    .sort()
    .map(file => {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      return {
        file,
        name: FRONT_MATTER_NAME.exec(text)?.[1] ?? file,
        headings: sections(text).map(section => headingKey(section.heading)),
        required: requiredSections(text),
      };
    });
}

function closestFailure(body, templates) {
  const present = new Set(sections(body).map(section => headingKey(section.heading)));
  const scored = templates.map(template => ({
    template,
    problems: failures(body, template.required),
    shared: template.headings.filter(heading => present.has(heading)).length,
  }));
  if (scored.some(({ problems }) => !problems.length)) return null;
  scored.sort((a, b) => b.shared - a.shared || a.problems.length - b.problems.length);
  return scored[0];
}

function commentBody({ template, problems }, { owner, repo }) {
  return [
    ISSUE_TEMPLATE_MARKER,
    `**📝 This issue doesn't follow one of our ` +
      `[issue templates](https://github.com/${owner}/${repo}/issues/new/choose) yet.** ` +
      `It is closest to [${template.name}](${TEMPLATE_URL}/${template.file}). ` +
      'Please edit the description to fix:',
    '',
    ...problems.map(problem => `- ${problem}`),
    '',
    'The check runs again when you save, and this comment goes away once it passes. ' +
      'We review the issue after that. ' +
      `**If it still doesn't follow a template in ${ISSUE_TEMPLATE_MAX_DAYS} days, ` +
      'it will be closed.**',
  ].join('\n');
}

async function checkIssueTemplate({ github, context, core }, issue, templates = readTemplates()) {
  const { owner, repo } = context.repo;
  const failure = closestFailure(issue.body, templates);
  if (!failure) {
    core.info(`Issue #${issue.number} follows a template.`);
    await syncComment({ github, context, core }, issue.number, ISSUE_TEMPLATE_MARKER, null);
    return true;
  }
  core.info(
    `Issue #${issue.number} is closest to ${failure.template.file}: ` + failure.problems.join(' '),
  );
  await syncComment(
    { github, context, core },
    issue.number,
    ISSUE_TEMPLATE_MARKER,
    commentBody(failure, context.repo),
  );
  await addLabel(LABEL_NEEDS_TEMPLATE, owner, repo, issue.number, github, core);
  return false;
}

module.exports = { checkIssueTemplate, readTemplates };
