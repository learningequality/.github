const {
  BOT_MESSAGE_PULL_REQUEST,
  BOT_MESSAGE_LINK_ISSUE,
  BOT_MESSAGE_PULL_REQUEST_CLOSED,
  LABEL_COMMUNITY_REVIEW,
  RTIBBLESBOT_USERNAME,
} = require('./constants');
const { sendBotMessage, getLinkedIssues } = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const number = context.payload.pull_request.number;
    const url = context.payload.pull_request.html_url;
    const title = context.payload.pull_request.title;
    const author = context.payload.pull_request.user.login;

    const linkedIssues = await getLinkedIssues(number, { github, context, core });
    const authorAssigned = linkedIssues.some(issue => issue.assignees.includes(author));
    const assignedElsewhere = linkedIssues.find(
      issue => issue.assignees.length > 0 && !issue.assignees.includes(author),
    );

    if (!authorAssigned && assignedElsewhere) {
      const botMessageUrl = await sendBotMessage(
        number,
        BOT_MESSAGE_PULL_REQUEST_CLOSED(author, assignedElsewhere.number),
        { github, context, core },
      );
      await github.rest.pulls.update({
        owner,
        repo,
        pull_number: number,
        state: 'closed',
      });
      core.setOutput(
        'slack_notification',
        `*[${repo}] <${botMessageUrl}|Closed> pull request on assigned issue #${assignedElsewhere.number}: <${url}|${title}>*`,
      );
      return;
    }

    if (authorAssigned) {
      await github.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: number,
        reviewers: [RTIBBLESBOT_USERNAME],
      });
      await github.rest.issues.addLabels({
        owner,
        repo,
        issue_number: number,
        labels: [LABEL_COMMUNITY_REVIEW],
      });
    }

    const reply = linkedIssues.length
      ? BOT_MESSAGE_PULL_REQUEST(author)
      : `${BOT_MESSAGE_PULL_REQUEST(author)}\n\n${BOT_MESSAGE_LINK_ISSUE}`;
    const botMessageUrl = await sendBotMessage(number, reply, {
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
