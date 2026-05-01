const { BOT_USERNAMES } = require('./constants');
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
  return BOT_USERNAMES.includes(username);
}

/**
 * Checks if a user is a contributor (= not a core team member or bot).
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

/**
 * Fetches all label names for an issue. Returns an array of lowercase label strings.
 */
async function getLabels(owner, repo, issueNumber, github, core) {
  try {
    const allLabels = await github.paginate(github.rest.issues.listLabelsOnIssue, {
      owner,
      repo,
      issue_number: issueNumber,
    });
    return allLabels.map(label => label.name.toLowerCase());
  } catch (error) {
    core.warning(`Failed to fetch labels on issue #${issueNumber}: ${error.message}`);
    return [];
  }
}

/**
 * Checks if an issue has a label with the given name (case-insensitive).
 */
async function hasLabel(name, owner, repo, issueNumber, github, core) {
  const labels = await getLabels(owner, repo, issueNumber, github, core);
  return labels.includes(name.toLowerCase());
}

/**
 * Fetches issues assigned to an assignee in given repositories.
 */
async function getIssues(assignee, state, owner, repos, github, core) {
  const promises = repos.map(repo =>
    github
      .paginate(github.rest.issues.listForRepo, {
        owner,
        repo,
        assignee,
        state,
      })
      .then(issues => issues.filter(issue => !issue.pull_request))
      .catch(error => {
        core.warning(`Failed to fetch issues from ${repo}: ${error.message}`);
        return [];
      }),
  );

  const results = await Promise.all(promises);
  return results.flat();
}

/**
 * Fetches pull requests by an author in given repositories.
 */
async function getPullRequests(author, state, owner, repos, github, core) {
  const promises = repos.map(repo =>
    github
      .paginate(github.rest.pulls.list, {
        owner,
        repo,
        state,
      })
      .then(prs => prs.filter(pr => pr.user.login === author))
      .catch(error => {
        core.warning(`Failed to fetch pull requests from ${repo}: ${error.message}`);
        return [];
      }),
  );

  const results = await Promise.all(promises);
  return results.flat();
}

/**
 * Deletes bot comments on an issue that contain a specific marker string.
 */
async function deleteBotComments(issueNumber, botUsername, marker, { github, context, core }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  try {
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: issueNumber,
    });

    const toDelete = comments.filter(
      c => c.user?.login === botUsername && c.body?.includes(marker),
    );
    await Promise.all(
      toDelete.map(async comment => {
        await github.rest.issues.deleteComment({ owner, repo, comment_id: comment.id });
        core.info(`Deleted bot comment ${comment.id} on issue #${issueNumber}`);
      }),
    );
  } catch (error) {
    core.warning(`Failed to delete bot comments on #${issueNumber}: ` + error.message);
  }
}

/**
 * Finds recent unassignment events for a user across repos.
 * Uses the search API to find candidate issues, then checks
 * timeline events for unassigned events within the cutoff.
 */
async function getRecentUnassignments(username, daysAgo, owner, repos, github, core) {
  const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const since = cutoff.toISOString().split('T')[0];

  const promises = repos.map(async repo => {
    const repoUnassignments = [];
    try {
      const q = `involves:${username} repo:${owner}/${repo} is:issue updated:>=${since}`;
      const { data } = await github.rest.search.issuesAndPullRequests({ q });

      for (const issue of data.items || []) {
        try {
          const events = await github.paginate(github.rest.issues.listEventsForTimeline, {
            owner,
            repo,
            issue_number: issue.number,
            per_page: 100,
          });

          for (const event of events) {
            if (
              event.event === 'unassigned' &&
              event.assignee?.login?.toLowerCase() === username.toLowerCase() &&
              new Date(event.created_at) >= cutoff
            ) {
              repoUnassignments.push({
                repo,
                issueNumber: issue.number,
                issueUrl: issue.html_url,
                issueTitle: issue.title,
                unassignedAt: event.created_at,
              });
            }
          }
        } catch (tlError) {
          core.warning(`Failed to fetch timeline for ${repo}#${issue.number}: ${tlError.message}`);
        }
      }
    } catch (error) {
      core.warning(`Failed to search issues in ${repo}: ${error.message}`);
    }
    return repoUnassignments;
  });

  const results = await Promise.all(promises);
  const unassignments = results.flat();

  // Deduplicate by issueUrl, keeping the most recent unassignment event.
  // A user could be assigned/unassigned multiple times on the same issue
  // within the cooldown window, and each event should only count once.
  const byIssue = new Map();
  for (const u of unassignments) {
    const existing = byIssue.get(u.issueUrl);
    if (!existing || new Date(u.unassignedAt) > new Date(existing.unassignedAt)) {
      byIssue.set(u.issueUrl, u);
    }
  }
  return [...byIssue.values()];
}

module.exports = {
  isContributor,
  isCloseContributor,
  isBot,
  sendBotMessage,
  escapeIssueTitleForSlackMessage,
  hasRecentBotComment,
  getLabels,
  hasLabel,
  getIssues,
  getPullRequests,
  deleteBotComments,
  getRecentUnassignments,
};
