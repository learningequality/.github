const test = require('node:test');
const assert = require('node:assert/strict');

const contributorPrReply = require('./contributor-pr-reply');
const { LABEL_COMMUNITY_REVIEW, RTIBBLESBOT_USERNAME } = require('./constants');

const AUTHOR = 'outsider';

function fakeContext(author = AUTHOR) {
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: {
      pull_request: {
        number: 42,
        html_url: 'https://github.com/learningequality/kolibri/pull/42',
        title: 'Fix it',
        user: { login: author },
      },
    },
  };
}

function fakeCore() {
  const outputs = {};
  const warnings = [];
  const failures = [];
  return {
    outputs,
    warnings,
    failures,
    info() {},
    warning(message) {
      warnings.push(message);
    },
    setFailed(message) {
      failures.push(message);
    },
    setOutput(name, value) {
      outputs[name] = value;
    },
  };
}

function fakeGithub(linkedIssues = [], { graphqlError } = {}) {
  const calls = { comments: [], updates: [], reviewers: [], labels: [] };
  return {
    calls,
    graphql: async () => {
      if (graphqlError) {
        throw new Error(graphqlError);
      }
      return {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: linkedIssues.map(issue => ({
                number: issue.number,
                title: `Issue ${issue.number}`,
                url: `https://github.com/learningequality/kolibri/issues/${issue.number}`,
                assignees: { nodes: issue.assignees.map(login => ({ login })) },
              })),
            },
          },
        },
      };
    },
    rest: {
      issues: {
        createComment: async ({ issue_number, body }) => {
          calls.comments.push({ issue_number, body });
          return { data: { html_url: 'https://github.com/learningequality/kolibri/pull/42#c1' } };
        },
        addLabels: async ({ labels }) => {
          calls.labels.push(...labels);
        },
      },
      pulls: {
        update: async ({ pull_number, state }) => {
          calls.updates.push({ pull_number, state });
        },
        requestReviewers: async ({ reviewers }) => {
          calls.reviewers.push(...reviewers);
        },
      },
    },
  };
}

async function run(github, context = fakeContext()) {
  const core = fakeCore();
  await contributorPrReply({ github, context, core });
  return core;
}

test('a linked issue assigned to someone else closes the pull request', async () => {
  const github = fakeGithub([{ number: 7, assignees: ['someone-else'] }]);
  const core = await run(github);

  assert.deepEqual(github.calls.updates, [{ pull_number: 42, state: 'closed' }]);
  assert.equal(github.calls.comments.length, 1);
  assert.match(github.calls.comments[0].body, /#7 is assigned to someone else/);
  assert.match(core.outputs.slack_notification, /Closed/);
  assert.deepEqual(github.calls.reviewers, []);
  assert.deepEqual(github.calls.labels, []);
  assert.deepEqual(core.failures, []);
});

test('the closing message replaces the standard reply', async () => {
  const github = fakeGithub([{ number: 7, assignees: ['someone-else'] }]);
  await run(github);

  assert.doesNotMatch(github.calls.comments[0].body, /For the review process to begin/);
});

test('a linked issue assigned to the author requests review and adds the label', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  const core = await run(github);

  assert.deepEqual(github.calls.reviewers, [RTIBBLESBOT_USERNAME]);
  assert.deepEqual(github.calls.labels, [LABEL_COMMUNITY_REVIEW]);
  assert.deepEqual(github.calls.updates, []);
  assert.match(github.calls.comments[0].body, /For the review process to begin/);
  assert.match(core.outputs.slack_notification, /Reply sent/);
});

test('the standard reply carries the review language', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  await run(github);

  const body = github.calls.comments[0].body;
  assert.match(body, /Before we assign a reviewer/);
  assert.match(body, /@rtibblesbot` will pre-review/);
  assert.match(body, /We'll also invite community pre-review/);
});

test('the author counts as assigned alongside other assignees', async () => {
  const github = fakeGithub([{ number: 7, assignees: ['someone-else', AUTHOR] }]);
  await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, [RTIBBLESBOT_USERNAME]);
});

test('an issue assigned to the author outweighs another assigned elsewhere', async () => {
  const github = fakeGithub([
    { number: 7, assignees: ['someone-else'] },
    { number: 8, assignees: [AUTHOR] },
  ]);
  await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, [RTIBBLESBOT_USERNAME]);
});

test('no linked issue leaves the pull request alone', async () => {
  const github = fakeGithub([]);
  const core = await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, []);
  assert.deepEqual(github.calls.labels, []);
  assert.equal(github.calls.comments.length, 1);
  assert.match(core.outputs.slack_notification, /Reply sent/);
});

test('a linked issue with no assignee leaves the pull request alone', async () => {
  const github = fakeGithub([{ number: 7, assignees: [] }]);
  await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, []);
  assert.deepEqual(github.calls.labels, []);
});

test('an unlinked pull request is asked to link an issue', async () => {
  const github = fakeGithub([]);
  await run(github);

  assert.match(github.calls.comments[0].body, /link one under \*\*References\*\*/);
});

test('a linked pull request is not asked to link an issue', async () => {
  const github = fakeGithub([{ number: 7, assignees: [] }]);
  await run(github);

  assert.doesNotMatch(github.calls.comments[0].body, /link one under/);
});

test('a failed lookup falls back to the standard reply', async () => {
  const github = fakeGithub([], { graphqlError: 'API down' });
  const core = await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, []);
  assert.equal(github.calls.comments.length, 1);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /API down/);
  assert.deepEqual(core.failures, []);
});
