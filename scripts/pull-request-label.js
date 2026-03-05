// Send info message when community-review label is added

const { BOT_MESSAGE_COMMUNITY_REVIEW, LABEL_COMMUNITY_REVIEW } = require('./constants');
const { sendBotMessage } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const label = context.payload.label?.name;
    if (label !== LABEL_COMMUNITY_REVIEW) {
      return;
    }
    const prNumber = context.payload.pull_request.number;
    await sendBotMessage(prNumber, BOT_MESSAGE_COMMUNITY_REVIEW, { github, context });
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
