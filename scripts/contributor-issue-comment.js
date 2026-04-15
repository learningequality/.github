// See docs/community-automations.md

const {
  LE_BOT_USERNAME,
  KEYWORDS_DETECT_ASSIGNMENT_REQUEST,
  ISSUE_LABEL_HELP_WANTED,
  ISSUE_LABEL_GOOD_FIRST_ISSUE,
  MAX_ASSIGNED_ISSUES,
  COOLDOWN_DAYS,
  GSOC_NOTE,
  BOT_MESSAGE_ISSUE_NOT_OPEN,
  BOT_MESSAGE_ALREADY_ASSIGNED,
  BOT_MESSAGE_ASSIGN_SUCCESS,
  BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE,
  BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE,
  COMMUNITY_REPOS,
} = require('./constants');
const {
  isCloseContributor,
  sendBotMessage,
  escapeIssueTitleForSlackMessage,
  hasRecentBotComment,
  getLabels,
  getIssues,
  getPullRequests,
  getRecentUnassignments,
} = require('./utils');

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

function formatAssignAtLimitMessage(assignedIssues, recentUnassignments) {
  let message =
    `Hi! 👋\n\n` +
    `You can't be assigned to this issue right now because ` +
    `you've reached the **${MAX_ASSIGNED_ISSUES}-issue limit**.`;

  if (assignedIssues.length > 0) {
    message += '\n\n**Your current assignments:**\n';
    message += assignedIssues.map(i => `- ${i.html_url}`).join('\n');
  }

  if (recentUnassignments.length > 0) {
    const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    message += '\n\n**Recently dropped issues (cooldown):**\n';
    message += recentUnassignments
      .map(u => {
        const daysRemaining = Math.ceil(
          (cooldownMs - (Date.now() - new Date(u.unassignedAt).getTime())) / (24 * 60 * 60 * 1000),
        );
        return `- ${u.issueUrl} (${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining)`;
      })
      .join('\n');
  }

  message += `\n\nOnce a slot opens up, come back and comment \`/assign\` again. 😊${GSOC_NOTE}`;
  return message;
}

async function sendAssignReplyAndNotify(issueNumber, message, slackSuffix, ctx) {
  const { repo, issueUrl, issueTitle, github, context, core } = ctx;
  const url = await sendBotMessage(issueNumber, message, { github, context, core });
  if (url) {
    core.setOutput(
      'support_dev_notifications_bot',
      `*[${repo}] <${url}|${slackSuffix}> on issue: <${issueUrl}|${issueTitle}>*`,
    );
  }
}

async function handleAssignCommand({
  issueNumber,
  issueUrl,
  issueTitle,
  commentAuthor,
  commentId,
  issueAssignees,
  isHelpWanted,
  isGoodFirstIssue,
  repo,
  owner,
  github,
  context,
  core,
}) {
  const ctx = { repo, issueUrl, issueTitle, github, context, core };
  const slackRequest =
    `*[${repo}] ` +
    `<${issueUrl}#issuecomment-${commentId}|/assign comment> ` +
    `on issue: <${issueUrl}|${issueTitle}> ` +
    `by _${commentAuthor}_*`;

  // Not help wanted
  if (!isHelpWanted) {
    core.setOutput('support_dev_notifications_message', slackRequest);
    await sendAssignReplyAndNotify(
      issueNumber,
      BOT_MESSAGE_ISSUE_NOT_OPEN,
      '/assign rejected - not open',
      ctx,
    );
    return;
  }

  // Already assigned to commenter — silent no-op, no Slack
  if (issueAssignees.includes(commentAuthor)) {
    core.info(`${commentAuthor} already assigned to #${issueNumber}`);
    return;
  }

  // Slack notification: /assign requested (after no-op checks)
  core.setOutput('support_dev_notifications_message', slackRequest);

  // Assigned to someone else
  if (issueAssignees.length > 0) {
    await sendAssignReplyAndNotify(
      issueNumber,
      BOT_MESSAGE_ALREADY_ASSIGNED,
      '/assign rejected - already assigned',
      ctx,
    );
    return;
  }

  if (!isGoodFirstIssue) {
    await sendAssignReplyAndNotify(
      issueNumber,
      BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE,
      '/assign rejected - not good first issue',
      ctx,
    );
    return;
  }

  // --- Limit check and assignment ---

  // Check cross-repo limits and cooldown
  const [assignedIssues, recentUnassignments] = await Promise.all([
    getIssues(commentAuthor, 'open', owner, COMMUNITY_REPOS, github, core),
    getRecentUnassignments(commentAuthor, COOLDOWN_DAYS, owner, COMMUNITY_REPOS, github, core),
  ]);

  // Filter unassignments to exclude currently assigned issues
  const assignedUrls = new Set(assignedIssues.map(i => i.html_url));
  const filteredUnassignments = recentUnassignments.filter(u => !assignedUrls.has(u.issueUrl));

  const totalSlots = assignedIssues.length + filteredUnassignments.length;

  if (totalSlots >= MAX_ASSIGNED_ISSUES) {
    const message = formatAssignAtLimitMessage(assignedIssues, filteredUnassignments);
    await sendAssignReplyAndNotify(issueNumber, message, '/assign rejected - at limit', ctx);
    return;
  }

  // Assign the contributor
  await github.rest.issues.addAssignees({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: [commentAuthor],
  });

  await sendAssignReplyAndNotify(
    issueNumber,
    BOT_MESSAGE_ASSIGN_SUCCESS,
    `/assign approved - assigned _${commentAuthor}_`,
    ctx,
  );
}

function shouldSendBotReply(
  issueCreator,
  commentAuthor,
  commentAuthorIsCloseContributor,
  isHelpWanted,
  isAssignmentRequest,
  isIssueAssignedToSomeoneElse,
  isGoodFirstIssue,
  isUnassigned,
) {
  if (commentAuthorIsCloseContributor) {
    return [false, null];
  }

  if (issueCreator === commentAuthor) {
    return [false, null];
  }

  if (isHelpWanted && isIssueAssignedToSomeoneElse && isAssignmentRequest) {
    return [true, BOT_MESSAGE_ALREADY_ASSIGNED];
  }

  if (!isHelpWanted && isAssignmentRequest) {
    return [true, BOT_MESSAGE_ISSUE_NOT_OPEN];
  }

  // Keyword on unassigned GFI → guide to /assign
  if (isHelpWanted && isGoodFirstIssue && isUnassigned && isAssignmentRequest) {
    return [true, BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE];
  }

  return [false, null];
}

function shouldContactSupport(
  commentAuthorIsCloseContributor,
  isHelpWanted,
  isIssueAssignedToSomeoneElse,
) {
  if (commentAuthorIsCloseContributor) {
    return true;
  }

  if (!isHelpWanted) {
    return false;
  }

  if (isHelpWanted && isIssueAssignedToSomeoneElse) {
    return false;
  }

  return true;
}

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
    const keywordRegexes = KEYWORDS_DETECT_ASSIGNMENT_REQUEST.map(k => k.trim().toLowerCase())
      .filter(Boolean)
      .map(keyword => new RegExp(`\\b${keyword}\\b`, 'i'));
    const isAssignmentRequest = keywordRegexes.find(regex => regex.test(commentBody));
    const isIssueAssignedToSomeoneElse =
      issueAssignees && issueAssignees.length > 0 && !issueAssignees.includes(commentAuthor);
    const [labels, commentAuthorIsCloseContributor] = await Promise.all([
      getLabels(owner, repo, issueNumber, github, core),
      isCloseContributor(commentAuthor, { github, context, core }),
    ]);
    const isHelpWanted = labels.includes(ISSUE_LABEL_HELP_WANTED.toLowerCase());
    const isGoodFirstIssue = labels.includes(ISSUE_LABEL_GOOD_FIRST_ISSUE.toLowerCase());

    // Handle /assign command — early return skips normal flow.
    // This intentionally bypasses shouldContactSupport so
    // /assign activity never reaches #support-dev (only
    // #support-dev-notifications). See docs/community-automations.md.
    const isAssignCommand = commentBody.trim().toLowerCase() === '/assign';
    if (isAssignCommand) {
      await handleAssignCommand({
        issueNumber,
        issueUrl,
        issueTitle,
        commentAuthor,
        commentId,
        issueAssignees,
        isHelpWanted,
        isGoodFirstIssue,
        repo,
        owner,
        github,
        context,
        core,
      });
      return;
    }

    const isUnassigned = issueAssignees.length === 0;
    const [shouldPostBot, botMessage] = shouldSendBotReply(
      issueCreator,
      commentAuthor,
      commentAuthorIsCloseContributor,
      isHelpWanted,
      isAssignmentRequest,
      isIssueAssignedToSomeoneElse,
      isGoodFirstIssue,
      isUnassigned,
    );
    if (shouldPostBot) {
      // post bot reply only when there are no same bot comments
      // in the past hour to prevent overwhelming issue comment section
      const skipBot = await hasRecentBotComment(issueNumber, LE_BOT_USERNAME, botMessage, 3600000, {
        github,
        context,
        core,
      });
      if (skipBot) {
        const slackMessage = `*[${repo}] Bot response skipped on issue: <${issueUrl}|${issueTitle}> (less than 1 hour since last bot message)*`;
        core.setOutput('support_dev_notifications_bot', slackMessage);
      } else {
        const botMessageUrl = await sendBotMessage(issueNumber, botMessage, {
          github,
          context,
          core,
        });
        if (botMessageUrl) {
          const slackMessage = `*[${repo}] <${botMessageUrl}|Bot response sent> on issue: <${issueUrl}|${issueTitle}>*`;
          core.setOutput('support_dev_notifications_bot', slackMessage);
        }
      }
    }

    const contactSupport = shouldContactSupport(
      commentAuthorIsCloseContributor,
      isHelpWanted,
      isIssueAssignedToSomeoneElse,
    );
    let slackMessage = `*[${repo}] <${issueUrl}#issuecomment-${commentId}|New comment> on issue: <${issueUrl}|${issueTitle}> by _${commentAuthor}_*`;

    if (contactSupport) {
      const [assignedOpenIssues, openPRs] = await Promise.all([
        getIssues(commentAuthor, 'open', owner, COMMUNITY_REPOS, github, core),
        getPullRequests(commentAuthor, 'open', owner, COMMUNITY_REPOS, github, core),
      ]);
      const authorActivity = formatAuthorActivity(assignedOpenIssues, openPRs);
      slackMessage += ` _${authorActivity}_`;
      core.setOutput('support_dev_message', slackMessage);
    } else {
      core.setOutput('support_dev_notifications_message', slackMessage);
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
