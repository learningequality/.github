const { BOT_MESSAGE_PULL_REQUEST } = require('./constants');
const { sendBotMessage } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const repo = context.repo.repo;
    const number = context.payload.pull_request.number;
    const url = context.payload.pull_request.html_url;
    const title = context.payload.pull_request.title;

    const botMessageUrl = await sendBotMessage(number, BOT_MESSAGE_PULL_REQUEST, {
      github,
      context,
      core,
    });

    if (botMessageUrl) {
      const slackMessage = `*[${repo}] <${botMessageUrl}|Reply sent> on pull request: <${url}|${title}>*`;
      core.setOutput('slack_notification', slackMessage);
    } else {
      core.setOutput('slack_notification', '');
    }
  } catch (error) {
    core.setOutput('slack_notification', '');
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
