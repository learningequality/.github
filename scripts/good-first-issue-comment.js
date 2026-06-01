// See docs/community-automations.md

const {
  LE_BOT_USERNAME,
  ISSUE_LABEL_HELP_WANTED,
  ASSIGN_GUIDANCE_MARKER,
  BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE,
} = require('./constants');
const { sendBotMessage, deleteBotComments, hasLabel } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const issueNumber = context.payload.issue.number;

    // Only post guidance if the issue is also help wanted
    const isHelpWanted = await hasLabel(
      ISSUE_LABEL_HELP_WANTED,
      owner,
      repo,
      issueNumber,
      github,
      core,
    );

    if (!isHelpWanted) {
      core.info(`Issue #${issueNumber} is not help wanted, skipping guidance comment`);
      return;
    }

    // Delete any previous guidance comments
    await deleteBotComments(issueNumber, LE_BOT_USERNAME, ASSIGN_GUIDANCE_MARKER, {
      github,
      context,
      core,
    });

    // Post new guidance comment
    await sendBotMessage(issueNumber, BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE, {
      github,
      context,
      core,
    });

    core.info(`Posted guidance comment on issue #${issueNumber}`);
  } catch (error) {
    core.setFailed(`Error: ${error.message}`);
  }
};
