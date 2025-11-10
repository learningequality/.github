// See docs/community-automations.md

const {
  LE_BOT_USERNAME,
  KEYWORDS_DETECT_ASSIGNMENT_REQUEST,
  ISSUE_LABEL_HELP_WANTED,
  BOT_MESSAGE_ISSUE_NOT_OPEN,
  BOT_MESSAGE_ALREADY_ASSIGNED
} = require('./constants');
const {
  isCloseContributor,
  sendBotMessage,
  escapeIssueTitleForSlackMessage,
  hasRecentBotComment
} = require('./utils');

module.exports = async ({ github, context, core }) => {
  try {
    const issueNumber = context.payload.issue.number;
    const issueUrl = context.payload.issue.html_url;
    const issueTitle = escapeIssueTitleForSlackMessage(context.payload.issue.title);
    const issueCreator = context.payload.issue.user.login;
    const issueAssignees = context.payload.issue.assignees?.map(assignee => assignee.login) || [];
    const commentId = context.payload.comment.id;
    const commentAuthor = context.payload.comment.user.login;
    const commentBody = context.payload.comment.body;
    const repo = context.repo.repo;
    const owner = context.repo.owner;
    const supportDevSlackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    const supportDevNotificationsSlackWebhookUrl = process.env.SLACK_COMMUNITY_NOTIFICATIONS_WEBHOOK_URL;
    const keywordRegexes = KEYWORDS_DETECT_ASSIGNMENT_REQUEST
      .map(k => k.trim().toLowerCase())
      .filter(Boolean)
      .map(keyword => new RegExp(`\\b${keyword}\\b`, 'i'));
    const isAssignmentRequest = keywordRegexes.find(regex => regex.test(commentBody));
    const isIssueAssignedToSomeoneElse = issueAssignees && issueAssignees.length > 0 && !issueAssignees.includes(commentAuthor);
    const isHelpWanted = await hasLabel(ISSUE_LABEL_HELP_WANTED);
    const commentAuthorIsCloseContributor = await isCloseContributor(commentAuthor, { github, context, core });

    async function hasLabel(name) {
      let labels = [];
      try {
        const response = await github.rest.issues.listLabelsOnIssue({
          owner,
          repo,
          issue_number: issueNumber
        });
        labels = response.data.map(label => label.name);
      } catch (error) {
        core.warning(`Failed to fetch labels on issue #${issueNumber}: ${error.message}`);
        labels = [];
      }
      return labels.some(label => label.toLowerCase() === name.toLowerCase());
    }

    async function getIssues(assignee, state) {
      try {
        const response = await github.rest.issues.listForRepo({
          owner,
          repo,
          assignee,
          state
        });
        return response.data.filter(issue => !issue.pull_request);
      } catch (error) {
        core.warning(`Failed to fetch issues: ${error.message}`);
        return [];
      }
    }

    async function getPullRequests(assignee, state) {
      try {
        const response = await github.rest.pulls.list({
          owner,
          repo,
          state
        });
        return response.data.filter(pr => pr.user.login === assignee);
      } catch (error) {
        core.warning(`Failed to fetch pull requests: ${error.message}`);
        return [];
      }
    }

    // Format information about author's assigned open issues
    // as '(Issues #1 #2 | PRs #3)' and PRs for Slack message
    function formatAuthorActivity(issues, pullRequests) {
      const parts = [];

      if (issues.length > 0) {
        const issueLinks = issues.map(issue => `<${issue.html_url}|#${issue.number}>`).join(' ');
        parts.push(`Issues ${issueLinks}`);
      } else {
        parts.push(`Issues none`);
      }

      if (pullRequests.length > 0) {
        const prLinks = pullRequests.map(pr => `<${pr.html_url}|#${pr.number}>`).join(' ');
        parts.push(`PRs ${prLinks}`);
      } else {
        parts.push(`PRs none`);
      }

      return `(${parts.join(' | ')})`;
    }

    function shouldSendBotReply() {
      if (issueCreator === commentAuthor) {
        // Strictly prevents all bot replies on issues reported
        // by people using our apps - sometimes there's conversation
        // in comments and in this context, it's strange to have the bot
        // chime in if someone uses a keyword triggering the bot.
        // (This means that a bot reply won't be sent if a contributor
        // reports an issue and then requests its assignment. But that's
        // acceptable trade-off, and we'd likely want to see the report anyway
        // and then decide whether they can work on it).
        return [false, null];
      }

      if (isHelpWanted && isAssignmentRequest && isIssueAssignedToSomeoneElse) {
        return [true, BOT_MESSAGE_ALREADY_ASSIGNED];
      }

      if (!isHelpWanted && isAssignmentRequest) {
        return [true, BOT_MESSAGE_ISSUE_NOT_OPEN];
      }

      return [false, null];
    }

    function shouldContactSupport() {
      // for close contributors, send notification
      // to #support-dev under all circumstances
      if (commentAuthorIsCloseContributor) {
        return true;
      }

      // for other contributors, do not send on non-help-wanted issues
      if (!isHelpWanted) {
        return false;
      }

      // on help-wanted issues, do not send if it's an assignment
      // request and issue is already assigned to someone else
      if (isAssignmentRequest && isIssueAssignedToSomeoneElse) {
        return false;
      }

      return true;
    }

    const [shouldPostBot, botMessage] = shouldSendBotReply();
    if (shouldPostBot) {
      // post bot reply only when there are no same bot comments
      // in the past hour to prevent overwhelming issue comment section
      const skipBot = await hasRecentBotComment(
        issueNumber,
        LE_BOT_USERNAME,
        botMessage,
        3600000,
        { github, context, core }
      );
      if (skipBot) {
        const slackBotSkippedMessage = `*[${repo}] Bot response skipped on issue: <${issueUrl}|${issueTitle}> (less than 1 hour since last bot message)*`;

        core.setOutput('bot_reply_skipped', true);
        core.setOutput('slack_notification_bot_skipped', slackBotSkippedMessage);
      } else {
        const botMessageUrl = await sendBotMessage(issueNumber, botMessage, { github, context, core });
        if (botMessageUrl) {
          const slackMessage = `*[${repo}] <${botMessageUrl}|Bot response sent> on issue: <${issueUrl}|${issueTitle}>*`;
          core.setOutput('bot_replied', true);
          core.setOutput('slack_notification_bot_comment', slackMessage);
        }
      }
    }

    const contactSupport = shouldContactSupport();
    let slackMessage = `*[${repo}] <${issueUrl}#issuecomment-${commentId}|New comment> on issue: <${issueUrl}|${issueTitle}> by _${commentAuthor}_*`;

    if (contactSupport) {
      // Append activity info when sending to #support-dev
      // to guide the decision on whether to assign an issue
      const [assignedOpenIssues, openPRs] = await Promise.all([
        getIssues(commentAuthor, 'open'),
        getPullRequests(commentAuthor, 'open')
      ]);
      const authorActivity = formatAuthorActivity(assignedOpenIssues, openPRs);
      slackMessage += ` _${authorActivity}_`;

      core.setOutput('webhook_url', supportDevSlackWebhookUrl);
      core.setOutput('slack_notification_comment', slackMessage);
    } else {
      // if we're not sending notification to #support-dev,
      // send it to #support-dev-notifications and if the comment
      // appears to be an assignment request, post GitHub bot reply
      core.setOutput('webhook_url', supportDevNotificationsSlackWebhookUrl);
      core.setOutput('slack_notification_comment', slackMessage);
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
