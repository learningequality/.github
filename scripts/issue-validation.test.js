const test = require('node:test');
const assert = require('node:assert/strict');

const issueValidation = require('./issue-validation');
const {
  LABEL_COMMUNITY_ISSUE_REVIEW,
  LABEL_NEEDS_TEMPLATE,
  BOT_MESSAGE_ISSUE_VALIDATION,
  ISSUE_TEMPLATE_MARKER,
  LE_BOT_USERNAME,
} = require('./constants');

const FOLLOWS_TEMPLATE = '## Description\n\nThe sync fails.\n\n## AI usage\n\nI used no AI.\n';
// Shaped like kolibri#15779, which an agent wrote without a template.
const FREESTYLED = [
  '## Summary',
  '',
  'The sync fails.',
  '',
  '## Steps to reproduce',
  '',
  '1. Sync',
  '',
  '## Suggested fix',
  '',
  'Retry.',
].join('\n');

function fakeGithub({
  body = FOLLOWS_TEMPLATE,
  labels = [],
  state = 'open',
  comments = [],
  addFails = false,
  removeFails = false,
} = {}) {
  const created = [];
  const updated = [];
  const deleted = [];
  const added = [];
  const removed = [];
  const listComments = async () => comments;
  return {
    created,
    updated,
    deleted,
    added,
    removed,
    paginate: async (fn, params) => fn(params),
    rest: {
      issues: {
        get: async () => ({
          data: { number: 7, body, state, labels: labels.map(name => ({ name })) },
        }),
        listComments,
        addLabels: async ({ labels: names }) => {
          if (addFails) {
            throw new Error('Resource not accessible by integration');
          }
          added.push(...names);
        },
        removeLabel: async ({ name }) => {
          if (removeFails) {
            const error = new Error('server error');
            error.status = 500;
            throw error;
          }
          removed.push(name);
        },
        createComment: async ({ body: text }) => {
          created.push(text);
          return { data: { html_url: 'https://github.com/learningequality/kolibri/issues/7' } };
        },
        updateComment: async ({ comment_id, body: text }) => {
          updated.push({ comment_id, body: text });
        },
        deleteComment: async ({ comment_id }) => {
          deleted.push(comment_id);
        },
      },
    },
  };
}

function fakeContext({ action = 'opened', isPrivate = false } = {}) {
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: { action, issue: { number: 7 }, repository: { private: isPrivate } },
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

const templateComment = { id: 3, user: { login: LE_BOT_USERNAME }, body: ISSUE_TEMPLATE_MARKER };

test('a new issue following a template gets one comment and the review label', async () => {
  const github = fakeGithub();
  const core = fakeCore();
  await issueValidation({ github, context: fakeContext(), core });

  assert.deepEqual(github.created, [BOT_MESSAGE_ISSUE_VALIDATION]);
  assert.deepEqual(github.added, [LABEL_COMMUNITY_ISSUE_REVIEW]);
  assert.deepEqual(core.failures, []);
});

test('the comment mentions rtibblesbot outside backticks, which is the trigger', async () => {
  const github = fakeGithub();
  await issueValidation({ github, context: fakeContext(), core: fakeCore() });

  // A backticked handle sends no notification, and the mention is the only way
  // to reach the agent. See learningequality/coding-agent#1229.
  assert.match(github.created[0], /(^|[^`])@rtibblesbot/);
});

test('a new freestyled issue is flagged and not sent for validation', async () => {
  const github = fakeGithub({ body: FREESTYLED });
  await issueValidation({ github, context: fakeContext(), core: fakeCore() });

  assert.equal(github.created.length, 1);
  assert.ok(github.created[0].includes(ISSUE_TEMPLATE_MARKER));
  assert.match(github.created[0], /closest to \[Report a bug\]/);
  assert.match(github.created[0], /`## AI usage` is missing/);
  assert.ok(
    !github.created[0].includes('@rtibblesbot'),
    'the template comment must not summon the agent',
  );
  assert.deepEqual(github.added, [LABEL_NEEDS_TEMPLATE]);
});

test('an edit that makes a flagged issue pass clears it and requests validation', async () => {
  const github = fakeGithub({ labels: [LABEL_NEEDS_TEMPLATE], comments: [templateComment] });
  await issueValidation({ github, context: fakeContext({ action: 'edited' }), core: fakeCore() });

  assert.deepEqual(github.deleted, [3]);
  assert.deepEqual(github.removed, [LABEL_NEEDS_TEMPLATE]);
  assert.deepEqual(github.created, [BOT_MESSAGE_ISSUE_VALIDATION]);
  assert.deepEqual(github.added, [LABEL_COMMUNITY_ISSUE_REVIEW]);
});

test('a flagged issue whose label cannot come off is not sent for validation', async () => {
  const github = fakeGithub({ labels: [LABEL_NEEDS_TEMPLATE], removeFails: true });
  await issueValidation({ github, context: fakeContext({ action: 'edited' }), core: fakeCore() });

  assert.deepEqual(github.created, []);
  assert.deepEqual(github.added, []);
});

test('an edit that leaves a flagged issue failing updates the comment', async () => {
  const github = fakeGithub({
    body: FREESTYLED,
    labels: [LABEL_NEEDS_TEMPLATE],
    comments: [templateComment],
  });
  await issueValidation({ github, context: fakeContext({ action: 'edited' }), core: fakeCore() });

  assert.deepEqual(github.created, []);
  assert.equal(github.updated.length, 1);
  assert.deepEqual(github.removed, []);
});

test('an edit to an issue never flagged is not checked', async () => {
  const github = fakeGithub({ body: FREESTYLED });
  await issueValidation({ github, context: fakeContext({ action: 'edited' }), core: fakeCore() });

  assert.deepEqual(github.created, []);
  assert.deepEqual(github.added, []);
});

test('reopening a flagged issue that now passes requests validation', async () => {
  const github = fakeGithub({ labels: [LABEL_NEEDS_TEMPLATE] });
  await issueValidation({
    github,
    context: fakeContext({ action: 'reopened' }),
    core: fakeCore(),
  });

  assert.deepEqual(github.removed, [LABEL_NEEDS_TEMPLATE]);
  assert.deepEqual(github.created, [BOT_MESSAGE_ISSUE_VALIDATION]);
});

test('an edit to a closed issue does nothing until it is reopened', async () => {
  const github = fakeGithub({ labels: [LABEL_NEEDS_TEMPLATE], state: 'closed' });
  await issueValidation({ github, context: fakeContext({ action: 'edited' }), core: fakeCore() });

  assert.deepEqual(github.created, []);
  assert.deepEqual(github.removed, []);
});

test('an issue in a private repo gets neither', async () => {
  const github = fakeGithub({ body: FREESTYLED });
  const core = fakeCore();
  await issueValidation({ github, context: fakeContext({ isPrivate: true }), core });

  assert.deepEqual(github.created, []);
  assert.deepEqual(github.added, []);
  assert.deepEqual(core.failures, []);
});

test('an issue already under review gets no second request', async () => {
  const github = fakeGithub({ labels: [LABEL_COMMUNITY_ISSUE_REVIEW] });
  await issueValidation({ github, context: fakeContext(), core: fakeCore() });

  assert.deepEqual(github.created, []);
  assert.deepEqual(github.added, []);
});

test('the label match ignores case', async () => {
  const github = fakeGithub({ labels: ['Community-Issue-Review'] });
  await issueValidation({ github, context: fakeContext(), core: fakeCore() });

  assert.deepEqual(github.created, []);
});

test('a failed label add warns and leaves the run passing', async () => {
  const github = fakeGithub({ addFails: true });
  const core = fakeCore();
  await issueValidation({ github, context: fakeContext(), core });

  assert.equal(github.created.length, 1);
  assert.deepEqual(core.failures, []);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /Failed to add/);
});
