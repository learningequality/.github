// Send info message when community-review label is added

const {
  BOT_MESSAGE_COMMUNITY_REVIEW,
  LABEL_COMMUNITY_REVIEW,
  LE_BOT_USERNAME,
} = require('./constants');
const { sendBotMessage } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const label = context.payload.label?.name;
    if (label !== LABEL_COMMUNITY_REVIEW) {
      return;
    }
    // Actions taken with the bot app's token trigger this event, unlike GITHUB_TOKEN. The
    // automatic path in contributor-pr-reply already carries this text in its own message.
    if (context.payload.sender?.login === LE_BOT_USERNAME) {
      return;
    }
    const prNumber = context.payload.pull_request.number;
    await sendBotMessage(prNumber, BOT_MESSAGE_COMMUNITY_REVIEW, { github, context });
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
