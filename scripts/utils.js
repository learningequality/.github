const { LE_BOT_USERNAME, SENTRY_BOT_USERNAME } = require('./constants');
const { CLOSE_CONTRIBUTORS, TEAMS_WITH_CLOSE_CONTRIBUTORS } = require('./constants');

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
async function isCloseContributor(username, { github, context, core }) {
  if (!username) {
    core.setFailed('Missing username');
    return false;
  }

  if (CLOSE_CONTRIBUTORS.map(c => c.toLowerCase().trim()).includes(username.toLowerCase().trim())) {
    return true;
  }

  const org = context.repo.owner;

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
  }
}

module.exports = {
  isContributor,
  isCloseContributor,
  isBot
};
