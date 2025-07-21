const {
  LE_BOT_USERNAME,
  CLOSE_CONTRIBUTORS,
  KEYWORDS_DETECT_ASSIGNMENT_REQUEST,
  ISSUE_LABEL_HELP_WANTED,
  BOT_MESSAGE_ISSUE_NOT_OPEN
} = require('./constants');

module.exports = async ({ github, context, core }) => {
  try {
    const issueNumber = context.payload.issue.number;
    const issueUrl = context.payload.issue.html_url;
    const issueTitle = context.payload.issue.title;
    const escapedTitle = issueTitle.replace(/"/g, '\\"');
    const commentId = context.payload.comment.id;
    const commentTime = new Date(context.payload.comment.created_at);
    const oneHourBefore = new Date(commentTime - 3600000);
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
           core.warning(`⚠️ Failed to fetch labels on issue #${issueNumber}: ${error.message}`);
           labels = [];
        }
        return labels.some(label => label.toLowerCase() === name.toLowerCase());
    }

    async function findRecentCommentsByUser(username) {
      try{
          let response = await github.rest.issues.listComments({
              owner,
              repo,
              issue_number: issueNumber,
              since: oneHourBefore.toISOString()
          });
          return response.data.filter(comment => comment.user.login === username);
      } catch (error) {
          core.warning(`⚠️ Failed to fetch comments on issue #${issueNumber}: ${error.message}`);
          return [];
      }
    }

    async function botReply(){
        let response = null;
        try {
            response = await github.rest.issues.createComment({
              owner,
              repo,
              issue_number: issueNumber,
              body: BOT_MESSAGE_ISSUE_NOT_OPEN
            });
            if (response?.data?.html_url) {
              core.setOutput('bot_replied', true);
              const slackMessage = `*[${repo}] <${response.data.html_url}|Bot response sent> on issue: <${issueUrl}|${escapedTitle}>*`;
              core.setOutput('slack_notification_bot_comment', slackMessage);
            }
        } catch (error) {
            core.warning(`Failed to post bot comment: ${error.message}`);
            core.setOutput('bot_replied', false);
        }
        return response;
    }


    if (await hasLabel(ISSUE_LABEL_HELP_WANTED) || CLOSE_CONTRIBUTORS.includes(commentAuthor)) {
      core.setOutput('webhook_url', supportDevSlackWebhookUrl);
    } else {
      core.setOutput('webhook_url', supportDevNotificationsSlackWebhookUrl);
      const matchedKeyword = keywordRegexes.find(regex => regex.test(commentBody));
      // post a bot reply if there is matched keyword and no previous bot comment in past hour
      if(matchedKeyword){
        let lastBotComment;
        let PastBotComments = await findRecentCommentsByUser(LE_BOT_USERNAME);
        if(PastBotComments.length > 0){
                lastBotComment = PastBotComments.at(-1);
                core.setOutput('bot_replied', false);
            } else if(PastBotComments.length === 0){
                console.log("bot is replying");
                lastBotComment = await botReply();
            }
      }
    }

    const message = `*[${repo}] <${issueUrl}#issuecomment-${commentId}|New comment> on issue: <${issueUrl}|${escapedTitle}> by ${commentAuthor}*`;
    core.setOutput('slack_notification_comment', message);

  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
