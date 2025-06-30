const fs = require('fs');
const path = require('path');

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
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    const communityWebhookUrl = process.env.SLACK_COMMUNITY_NOTIFICATIONS_WEBHOOK_URL;
    const LE_bot_username = 'testshobh[bot]';
    const botMessage = `👋
Thanks so much for your interest! This issue is currently reserved for the core team and isn’t available for assignment right now.
If you’d like to get started contributing, please take a look at our [Contributing Guidelines](https://github.com/your-org/your-repo/blob/main/CONTRIBUTING.md) for tips on finding “help-wanted” issues, setting up your environment, and submitting a PR.
We really appreciate your willingness to help — feel free to pick another issue labeled **help-wanted** and let us know if you have any questions. 😊`
    const Close_Contributors = ['user1', 'user2'];
    const keywordsPath = path.join(__dirname, 'keywords.txt');
    const keywordRegexes = fs.readFileSync(keywordsPath, 'utf-8')
      .split('\n')
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
              body: `Hi @${commentAuthor} ${botMessage}`
            });
            if (response?.data?.html_url) {
              core.setOutput('bot_replied', true);
              const botReplyMessage = `*[${repo}] <${response.data.html_url}|Bot response sent> on issue: <${issueUrl}|${escapedTitle}>*`;
              core.setOutput('bot_reply_message', botReplyMessage);
            }
        } catch (error) {
            core.warning(`Failed to post bot comment: ${error.message}`);
            core.setOutput('bot_replied', false);
        }
        return response;
    }


    // set webhook url based on label on issue
    if (await hasLabel('help wanted') || Close_Contributors.includes(commentAuthor)) {
      core.setOutput('webhook_url', slackWebhookUrl);
    } else {
      core.setOutput('webhook_url', communityWebhookUrl);
      const matchedKeyword = keywordRegexes.find(regex => regex.test(commentBody));
      // post a bot reply if there is matched keyword and no previous bot comment in past hour
      if(matchedKeyword){
        let lastBotComment;
        let PastBotComments = await findRecentCommentsByUser(LE_bot_username);
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
    core.setOutput('text', message);

  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
