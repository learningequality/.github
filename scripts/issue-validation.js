// See docs/community-automations.md

const {
  COMMUNITY_REPOS,
  LABEL_COMMUNITY_ISSUE_REVIEW,
  BOT_MESSAGE_ISSUE_VALIDATION,
} = require('./constants');
const { sendBotMessage, hasLabel, addLabel } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const issueNumber = context.payload.issue.number;

    if (!COMMUNITY_REPOS.includes(repo)) {
      core.info(`${repo} is not a community repo, so no validation is requested.`);
      return;
    }

    if (await hasLabel(LABEL_COMMUNITY_ISSUE_REVIEW, owner, repo, issueNumber, github, core)) {
      core.info(`Issue #${issueNumber} already carries ${LABEL_COMMUNITY_ISSUE_REVIEW}.`);
      return;
    }

    await sendBotMessage(issueNumber, BOT_MESSAGE_ISSUE_VALIDATION, { github, context });
    await addLabel(LABEL_COMMUNITY_ISSUE_REVIEW, owner, repo, issueNumber, github, core);
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
