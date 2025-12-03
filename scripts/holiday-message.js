// See docs/community-automations.md

const { HOLIDAY_MESSAGE, LE_BOT_USERNAME } = require('./constants');
const { sendBotMessage, escapeIssueTitleForSlackMessage, hasRecentBotComment } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const repo = context.repo.repo;

    const isPullRequest = !!context.payload.pull_request;
    const number = isPullRequest
      ? context.payload.pull_request.number
      : context.payload.issue.number;
    const url = isPullRequest
      ? context.payload.pull_request.html_url
      : context.payload.issue.html_url;
    const title = escapeIssueTitleForSlackMessage(
      isPullRequest ? context.payload.pull_request.title : context.payload.issue.title,
    );

    // post bot reply only when there are no same bot comments
    // in the past hour to prevent overwhelming issue comment section
    const skipBot = await hasRecentBotComment(number, LE_BOT_USERNAME, HOLIDAY_MESSAGE, 3600000, {
      github,
      context,
      core,
    });
    if (skipBot) {
      const itemType = isPullRequest ? 'pull request' : 'issue';
      const slackBotSkippedMessage = `*[${repo}] Holiday message skipped on ${itemType}: <${url}|${title}> (less than 1 hour since last holiday message)*`;
      core.setOutput('slack_notification', slackBotSkippedMessage);
      return;
    }

    const botMessageUrl = await sendBotMessage(number, HOLIDAY_MESSAGE, { github, context, core });

    if (botMessageUrl) {
      const itemType = isPullRequest ? 'pull request' : 'issue';
      const slackMessage = `*[${repo}] <${botMessageUrl}|Holiday message sent> on ${itemType}: <${url}|${title}>*`;
      core.setOutput('slack_notification', slackMessage);
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
