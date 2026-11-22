const test = require('node:test');
const assert = require('node:assert/strict');

const manageIssueHeader = require('./manage-issue-header');

function fakeGithub(body) {
  const updates = [];
  return {
    updates,
    rest: {
      issues: {
        get: async () => ({ data: { body } }),
        update: async ({ body: updated }) => updates.push(updated),
      },
    },
  };
}

function fakeCore() {
  const failures = [];
  return { failures, info() {}, setFailed: message => failures.push(message) };
}

function fakeContext(action, labels = []) {
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: { action, issue: { number: 7, labels: labels.map(name => ({ name })) } },
  };
}

async function run(action, body, labels) {
  const github = fakeGithub(body);
  const core = fakeCore();
  await manageIssueHeader({ github, context: fakeContext(action, labels), core });
  assert.deepEqual(core.failures, []);
  return github.updates;
}

test('an edit that drops the header restores it', async () => {
  const [body] = await run('edited', 'Steps to reproduce', ['help wanted']);

  assert.match(body, /^<!---HEADER START-->[\s\S]*This issue is open for contribution/);
  assert.match(body, /<!---HEADER END-->\n\nSteps to reproduce$/);
});

test('an edit that keeps the header leaves the body alone', async () => {
  const [withHeader] = await run('edited', 'Steps to reproduce', []);

  assert.deepEqual(await run('edited', withHeader, []), []);
});

test('an edit replaces a header that no longer matches the labels', async () => {
  const [notOpen] = await run('edited', 'Steps to reproduce', []);
  const [open] = await run('edited', notOpen, ['help wanted']);

  assert.match(open, /This issue is open for contribution/);
  assert.doesNotMatch(open, /not open for contribution/);
});
