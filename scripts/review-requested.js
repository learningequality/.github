// Send info message about rtibblesbot review

const { BOT_MESSAGE_RTIBBLESBOT_REVIEW, RTIBBLESBOT_USERNAME } = require('./constants');
const { sendBotMessage } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const reviewer = context.payload.requested_reviewer?.login;
    if (reviewer !== RTIBBLESBOT_USERNAME) {
      return;
    }
    const prNumber = context.payload.pull_request.number;
    await sendBotMessage(prNumber, BOT_MESSAGE_RTIBBLESBOT_REVIEW, { github, context });
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
