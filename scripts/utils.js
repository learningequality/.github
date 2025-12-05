const { LE_BOT_USERNAME, SENTRY_BOT_USERNAME } = require('./constants');
// const { CLOSE_CONTRIBUTORS, TEAMS_WITH_CLOSE_CONTRIBUTORS } = require('./constants');
const { CLOSE_CONTRIBUTORS } = require('./constants');

/**
 * Checks if username belongs to one of our bots.
 */
async function isBot(username, { core }) {
  if (!username) {
    core.setFailed('Missing username');
    return false;
  }
  return [LE_BOT_USERNAME, SENTRY_BOT_USERNAME].includes(username);
}

/**
 * Checks if a user is a contributor (= not a core team member).
 */
async function isContributor(username, authorAssociation, { github, context, core }) {
  if (!username) {
    core.setFailed('Missing username');
    return false;
  }

  if (!authorAssociation) {
    core.setFailed('Missing authorAssociation');
    return false;
  }

  if (authorAssociation === 'OWNER') {
    return false;
  }

  if (await isBot(username, { core })) {
    return false;
  }

  const isClose = await isCloseContributor(username, { github, context, core });
  // Some close contributors may be 'MEMBER's due to GSoC or other GitHub team
  // memberships, so here we need to exclude only team members who are not
  // close contributors
  if (authorAssociation === 'MEMBER' && !isClose) {
    return false;
  }

  return true;
}

/**
 * Checks if a user is a close contributor by checking
 * both the constants list and team membership in monitored teams.
 */
async function isCloseContributor(username, { core }) {
  if (!username) {
    core.setFailed('Missing username');
    return false;
  }

  if (CLOSE_CONTRIBUTORS.map(c => c.toLowerCase().trim()).includes(username.toLowerCase().trim())) {
    return true;
  } else {
    return false;
  }

  // Detection on GitHub teams below is disabled until we re-think
  // how close contributors are managed (see Notion tracker):
  // - it was only fallback as explained lower
  // - it causes the problem when we receive undesired notification
  // to #support-dev when Richard posts issue comment since he is a member
  // of GSoC and other GitHub teams with close contributors (they require moderator).

  /* const org = context.repo.owner;

  // Even though we check on team members here, it's best
  // to add everyone to CLOSE_CONTRIBUTORS constant anyway
  // for reliable results (e.g. check below won't work
  // for people who have their membership set to private,
  // and we don't have control over that)
  const promises = TEAMS_WITH_CLOSE_CONTRIBUTORS.map(team_slug =>
    github.rest.teams.getMembershipForUserInOrg({
      org,
      team_slug,
      username,
    })
  );

  try {
    const results = await Promise.allSettled(promises);
    let isMember = false;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.data.state === 'active') {
        isMember = true;
        break;
      }

      if (result.status === 'rejected' && result.reason.status !== 404) {
        throw new Error(`API Error: ${result.reason.message}`);
      }
    }

    return isMember;
  } catch (error) {
    core.setFailed(error.message);
    return false;
  } */
}

/**
 * Sends a bot message as a comment on an issue. Returns message URL if successful.
 */
async function sendBotMessage(issueNumber, message, { github, context }) {
  try {
    if (!issueNumber) {
      throw new Error('Issue number is required');
    }
    if (!message) {
      throw new Error('Message content is required');
    }

    const response = await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      body: message,
    });

    if (!response?.data?.html_url) {
      throw new Error('Comment created but no URL returned');
    }

    return response.data.html_url;
  } catch (error) {
    throw new Error(error.message);
  }
}

function escapeIssueTitleForSlackMessage(issueTitle) {
  return issueTitle.replace(/"/g, '\\"').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Checks if a bot sent a message with a given text on an issue
 * in the past specified milliseconds.
 */
async function hasRecentBotComment(
  issueNumber,
  botUsername,
  commentText,
  msAgo,
  { github, context, core },
) {
  const oneHourAgo = new Date(Date.now() - msAgo);
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  try {
    const response = await github.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      since: oneHourAgo.toISOString(),
    });
    return (response.data || []).some(
      comment =>
        comment.user && comment.user.login === botUsername && comment.body.includes(commentText),
    );
  } catch (error) {
    core.warning(`Failed to fetch comments on issue #${issueNumber}: ${error.message}`);
  }
}

module.exports = {
  isContributor,
  isCloseContributor,
  isBot,
  sendBotMessage,
  escapeIssueTitleForSlackMessage,
  hasRecentBotComment,
};
