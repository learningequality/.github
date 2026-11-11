const test = require('node:test');
const assert = require('node:assert/strict');

const isContributorScript = require('./is-contributor');
const { CLOSE_CONTRIBUTORS, LE_BOT_USERNAME, MAINTAINER_TEAMS } = require('./constants');

const CLOSE_CONTRIBUTOR = CLOSE_CONTRIBUTORS[0];
const [ADMIN_TEAM] = MAINTAINER_TEAMS;

function fakeCore() {
  const outputs = {};
  const failures = [];
  return {
    outputs,
    failures,
    info() {},
    warning() {},
    error() {},
    setOutput(name, value) {
      outputs[name] = value;
    },
    setFailed(message) {
      failures.push(message);
    },
  };
}

function fakeGithub(teams) {
  return {
    rest: {
      teams: {
        getMembershipForUserInOrg: async ({ org, team_slug, username }) => {
          assert.equal(org, 'learningequality');
          if ((teams[team_slug] || []).includes(username)) return { data: { state: 'active' } };
          const error = new Error('Not Found');
          error.status = 404;
          throw error;
        },
      },
    },
  };
}

async function run(username, authorAssociation, { teams = {}, github } = {}) {
  const before = {
    USERNAME: process.env.USERNAME,
    AUTHOR_ASSOCIATION: process.env.AUTHOR_ASSOCIATION,
  };
  const core = fakeCore();
  try {
    if (username === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = username;
    if (authorAssociation === undefined) delete process.env.AUTHOR_ASSOCIATION;
    else process.env.AUTHOR_ASSOCIATION = authorAssociation;

    await isContributorScript({
      core,
      github: github || fakeGithub(teams),
      context: { repo: { owner: 'learningequality', repo: 'kolibri' } },
    });
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  return core;
}

test('a first time contributor is a contributor', async () => {
  const core = await run('outsider', 'FIRST_TIME_CONTRIBUTOR');

  assert.equal(core.outputs.is_contributor, true);
  assert.deepEqual(core.failures, []);
});

test('an account with no association to the repo is a contributor', async () => {
  const core = await run('outsider', 'NONE');

  assert.equal(core.outputs.is_contributor, true);
});

test('an organization owner is not a contributor', async () => {
  const core = await run('owner', 'OWNER');

  assert.equal(core.outputs.is_contributor, false);
});

test('a bot is not a contributor', async () => {
  const core = await run(LE_BOT_USERNAME, 'NONE');

  assert.equal(core.outputs.is_contributor, false);
});

test('a member of any maintainer team is not a contributor whatever the event reports', async () => {
  for (const team of MAINTAINER_TEAMS) {
    for (const association of ['MEMBER', 'CONTRIBUTOR', 'NONE']) {
      const core = await run('teammate', association, { teams: { [team]: ['teammate'] } });

      assert.equal(core.outputs.is_contributor, false, `${team} ${association}`);
    }
  }
});

test('an org member outside the maintainer teams is a contributor', async () => {
  const core = await run('community-guide', 'MEMBER', {
    teams: { 'learning-equality-community-guide': ['community-guide'] },
  });

  assert.equal(core.outputs.is_contributor, true);
});

test('a failed membership check fails rather than guessing', async () => {
  const github = {
    rest: {
      teams: {
        getMembershipForUserInOrg: async () => {
          const error = new Error('server error');
          error.status = 500;
          throw error;
        },
      },
    },
  };

  await assert.rejects(run('outsider', 'NONE', { github }), /outsider.*server error/);
});

test('a close contributor stays a contributor even in a maintainer team', async () => {
  const core = await run(CLOSE_CONTRIBUTOR, 'MEMBER', {
    teams: { [ADMIN_TEAM]: [CLOSE_CONTRIBUTOR] },
  });

  assert.equal(core.outputs.is_contributor, true);
});

test('a close contributor is matched whatever case the login arrives in', async () => {
  const core = await run(CLOSE_CONTRIBUTOR.toUpperCase(), 'MEMBER');

  assert.equal(core.outputs.is_contributor, true);
});

test('a missing username fails the run', async () => {
  const core = await run(undefined, 'NONE');

  assert.equal(core.outputs.is_contributor, false);
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /Missing username/);
});

test('a missing author association fails the run', async () => {
  const core = await run('outsider', undefined);

  assert.equal(core.outputs.is_contributor, false);
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /Missing authorAssociation/);
});
