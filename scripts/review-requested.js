// Send info message about rtibblesbot review

const {
  BOT_MESSAGE_RTIBBLESBOT_REVIEW,
  RTIBBLESBOT_USERNAME,
  LE_BOT_USERNAME,
} = require('./constants');
const { sendBotMessage } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const reviewer = context.payload.requested_reviewer?.login;
    if (reviewer !== RTIBBLESBOT_USERNAME) {
      return;
    }
    // Actions taken with the bot app's token trigger this event, unlike GITHUB_TOKEN. The
    // automatic path in contributor-pr-reply already carries this text in its own message.
    if (context.payload.sender?.login === LE_BOT_USERNAME) {
      return;
    }
    const prNumber = context.payload.pull_request.number;
    await sendBotMessage(prNumber, BOT_MESSAGE_RTIBBLESBOT_REVIEW, { github, context });
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
