const { CLOSE_CONTRIBUTORS, TEAMS_WITH_CLOSE_CONTRIBUTORS } = require('./constants');

module.exports = async ({ core, github, context }) => {
  const username = process.env.USERNAME;
  if (!username) {
    core.setFailed('Missing username input.');
    return;
  }

  if (CLOSE_CONTRIBUTORS.map(c => c.toLowerCase().trim()).includes(username.toLowerCase().trim())) {
    core.info(`User '${username}' found in the CLOSE CONTRIBUTORS list.`);
    core.setOutput('is_close_contributor', true);
    return;
  }

  const org = context.repo.owner;

  // Even though we check on team members here, it's best
  // to add everyone to CLOSE_CONTRIBUTORS constant anyway
  // for reliable results (e.g. check below won't work
  // for private members)
  const promises = TEAMS_WITH_CLOSE_CONTRIBUTORS.map(team_slug =>
    github.rest.teams.getMembershipForUserInOrg({
      org,
      team_slug,
      username,
    })
  );

  try {
    const results = await Promise.allSettled(promises);
    let isTeamMember = false;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.data.state === 'active') {
        isTeamMember = true;
        break;
      }

      if (result.status === 'rejected' && result.reason.status !== 404) {
        throw new Error(`API Error: ${result.reason.message}`);
      }
    }

    if (isTeamMember) {
      core.info(`User '${username}' was found to be a member of a monitored team.`);
    } else {
      core.info(`User '${username}' was not found to be a member of a monitored team.`);
    }

    core.setOutput('is_close_contributor', isTeamMember);

  } catch (error) {
    core.setFailed(error.message);
  }
};