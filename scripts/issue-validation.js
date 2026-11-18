// See docs/community-automations.md

const {
  LABEL_COMMUNITY_ISSUE_REVIEW,
  LABEL_NEEDS_TEMPLATE,
  BOT_MESSAGE_ISSUE_VALIDATION,
} = require('./constants');
const { sendBotMessage, addLabel, removeLabel } = require('./utils');
const { checkIssueTemplate } = require('./issue-template');

module.exports = async ({ github, context, core }) => {
  try {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const issueNumber = context.payload.issue.number;

    if (context.payload.repository?.private) {
      core.info(`Issue validation does not run in private repo ${repo}.`);
      return;
    }

    const { data: issue } = await github.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    if (issue.state !== 'open') {
      core.info(`Issue #${issueNumber} is ${issue.state}.`);
      return;
    }

    const labels = (issue.labels || []).map(label =>
      (typeof label === 'string' ? label : label.name).toLowerCase(),
    );
    const flagged = labels.includes(LABEL_NEEDS_TEMPLATE);
    if (context.payload.action !== 'opened' && !flagged) {
      core.info(`Issue #${issueNumber} is not waiting on the template.`);
      return;
    }

    if (!(await checkIssueTemplate({ github, context, core }, issue))) {
      return;
    }
    if (
      flagged &&
      !(await removeLabel(LABEL_NEEDS_TEMPLATE, owner, repo, issueNumber, github, core))
    ) {
      return;
    }

    if (labels.includes(LABEL_COMMUNITY_ISSUE_REVIEW)) {
      core.info(`Issue #${issueNumber} already carries ${LABEL_COMMUNITY_ISSUE_REVIEW}.`);
      return;
    }

    await sendBotMessage(issueNumber, BOT_MESSAGE_ISSUE_VALIDATION, { github, context });
    await addLabel(LABEL_COMMUNITY_ISSUE_REVIEW, owner, repo, issueNumber, github, core);
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
