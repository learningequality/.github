const test = require('node:test');
const assert = require('node:assert/strict');

const issueValidationDone = require('./issue-validation-done');
const {
  ISSUE_VALIDATION_MARKER,
  LABEL_COMMUNITY_ISSUE_REVIEW,
  RTIBBLESBOT_USERNAME,
} = require('./constants');

const VERDICT = `${ISSUE_VALIDATION_MARKER}\n\n**Verdict:** claim holds`;

function fakeGithub({ status = 200 } = {}) {
  const removed = [];
  return {
    removed,
    rest: {
      issues: {
        removeLabel: async ({ name, issue_number }) => {
          if (status !== 200) {
            const error = new Error(status === 404 ? 'Label does not exist' : 'server error');
            error.status = status;
            throw error;
          }
          removed.push({ name, issue_number });
        },
      },
    },
  };
}

function fakeContext({ author = RTIBBLESBOT_USERNAME, body = VERDICT, pullRequest = false } = {}) {
  const issue = { number: 7 };
  if (pullRequest) {
    issue.pull_request = { url: 'https://api.github.com/repos/learningequality/kolibri/pulls/7' };
  }
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: { issue, comment: { body, user: { login: author } } },
  };
}

function fakeCore() {
  const failures = [];
  const warnings = [];
  return {
    failures,
    warnings,
    info() {},
    warning(message) {
      warnings.push(message);
    },
    error() {},
    setFailed(message) {
      failures.push(message);
    },
  };
}

test('a marker comment from rtibblesbot removes the label', async () => {
  const github = fakeGithub();
  const core = fakeCore();
  await issueValidationDone({ github, context: fakeContext(), core });

  assert.deepEqual(github.removed, [{ name: LABEL_COMMUNITY_ISSUE_REVIEW, issue_number: 7 }]);
  assert.deepEqual(core.failures, []);
});

test('the same marker from another account leaves the label on', async () => {
  const github = fakeGithub();
  // The marker is plain text that anyone can paste, so the author decides too.
  await issueValidationDone({
    github,
    context: fakeContext({ author: 'contributor' }),
    core: fakeCore(),
  });

  assert.deepEqual(github.removed, []);
});

test('a comment from rtibblesbot without the marker leaves the label on', async () => {
  const github = fakeGithub();
  await issueValidationDone({
    github,
    context: fakeContext({ body: 'Looks like a duplicate of #42.' }),
    core: fakeCore(),
  });

  assert.deepEqual(github.removed, []);
});

test('an empty comment body does not throw', async () => {
  const github = fakeGithub();
  const core = fakeCore();
  await issueValidationDone({ github, context: fakeContext({ body: null }), core });

  assert.deepEqual(github.removed, []);
  assert.deepEqual(core.failures, []);
});

test('a pull request comment is ignored', async () => {
  const github = fakeGithub();
  await issueValidationDone({
    github,
    context: fakeContext({ pullRequest: true }),
    core: fakeCore(),
  });

  assert.deepEqual(github.removed, []);
});

test('a label that is already off does not fail the run', async () => {
  const github = fakeGithub({ status: 404 });
  const core = fakeCore();
  await issueValidationDone({ github, context: fakeContext(), core });

  assert.deepEqual(core.failures, []);
  assert.deepEqual(core.warnings, []);
});

test('any other remove failure warns and leaves the run passing', async () => {
  const github = fakeGithub({ status: 500 });
  const core = fakeCore();
  await issueValidationDone({ github, context: fakeContext(), core });

  assert.deepEqual(core.failures, []);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /Failed to remove/);
});
