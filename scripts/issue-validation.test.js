const test = require('node:test');
const assert = require('node:assert/strict');

const issueValidation = require('./issue-validation');
const { LABEL_COMMUNITY_ISSUE_REVIEW, COMMUNITY_REPOS } = require('./constants');

const SANDBOX = 'test-actions';

function fakeGithub({ labels = [], addFails = false } = {}) {
  const comments = [];
  const added = [];
  return {
    comments,
    added,
    paginate: async (fn, params) => fn(params),
    rest: {
      issues: {
        listLabelsOnIssue: async () => labels.map(name => ({ name })),
        addLabels: async ({ labels: names }) => {
          if (addFails) {
            throw new Error('Resource not accessible by integration');
          }
          added.push(...names);
        },
        createComment: async ({ body }) => {
          comments.push(body);
          return { data: { html_url: 'https://github.com/learningequality/kolibri/issues/7' } };
        },
      },
    },
  };
}

function fakeContext({ repo = COMMUNITY_REPOS[0] } = {}) {
  return {
    repo: { owner: 'learningequality', repo },
    payload: { issue: { number: 7 } },
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

test('a new issue in a community repo gets one comment and the label', async () => {
  const github = fakeGithub();
  const core = fakeCore();
  await issueValidation({ github, context: fakeContext(), core });

  assert.equal(github.comments.length, 1);
  assert.deepEqual(github.added, [LABEL_COMMUNITY_ISSUE_REVIEW]);
  assert.deepEqual(core.failures, []);
});

test('the comment mentions rtibblesbot outside backticks, which is the trigger', async () => {
  const github = fakeGithub();
  await issueValidation({ github, context: fakeContext(), core: fakeCore() });

  // A backticked handle sends no notification, and the mention is the only way
  // to reach the agent. See learningequality/coding-agent#1229.
  assert.match(github.comments[0], /(^|[^`])@rtibblesbot/);
});

test('a repo outside the community list gets neither', async () => {
  const github = fakeGithub();
  const core = fakeCore();
  await issueValidation({ github, context: fakeContext({ repo: 'internal-tooling' }), core });

  assert.deepEqual(github.comments, []);
  assert.deepEqual(github.added, []);
  assert.deepEqual(core.failures, []);
});

test('the sandbox is in scope, so the automation can be tested there', async () => {
  const github = fakeGithub();
  await issueValidation({ github, context: fakeContext({ repo: SANDBOX }), core: fakeCore() });

  assert.equal(github.comments.length, 1);
  assert.deepEqual(github.added, [LABEL_COMMUNITY_ISSUE_REVIEW]);
});

test('an issue already under review gets no second comment', async () => {
  const github = fakeGithub({ labels: [LABEL_COMMUNITY_ISSUE_REVIEW] });
  await issueValidation({ github, context: fakeContext(), core: fakeCore() });

  assert.deepEqual(github.comments, []);
  assert.deepEqual(github.added, []);
});

test('the label match ignores case', async () => {
  const github = fakeGithub({ labels: ['Community-Issue-Review'] });
  await issueValidation({ github, context: fakeContext(), core: fakeCore() });

  assert.deepEqual(github.comments, []);
});

test('a failed label add warns and leaves the run passing', async () => {
  const github = fakeGithub({ addFails: true });
  const core = fakeCore();
  await issueValidation({ github, context: fakeContext(), core });

  assert.equal(github.comments.length, 1);
  assert.deepEqual(core.failures, []);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /Failed to add/);
});
