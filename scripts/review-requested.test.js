const test = require('node:test');
const assert = require('node:assert/strict');

const reviewRequested = require('./review-requested');
const { LE_BOT_USERNAME, RTIBBLESBOT_USERNAME } = require('./constants');

function fakeGithub() {
  const comments = [];
  return {
    comments,
    rest: {
      issues: {
        createComment: async ({ body }) => {
          comments.push(body);
          return { data: { html_url: 'https://github.com/learningequality/kolibri/pull/42#c1' } };
        },
      },
    },
  };
}

function fakeContext({ reviewer = RTIBBLESBOT_USERNAME, sender = 'maintainer' } = {}) {
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: {
      requested_reviewer: { login: reviewer },
      sender: { login: sender },
      pull_request: { number: 42 },
    },
  };
}

const core = { info() {}, warning() {}, setFailed() {} };

test('a review requested by a person posts the note', async () => {
  const github = fakeGithub();
  await reviewRequested({ github, context: fakeContext(), core });

  assert.equal(github.comments.length, 1);
  assert.match(github.comments[0], /pre-review/);
});

test('a review requested by the bot posts nothing', async () => {
  const github = fakeGithub();
  await reviewRequested({ github, context: fakeContext({ sender: LE_BOT_USERNAME }), core });

  assert.deepEqual(github.comments, []);
});

test('a review requested for anyone else posts nothing', async () => {
  const github = fakeGithub();
  await reviewRequested({ github, context: fakeContext({ reviewer: 'someone-else' }), core });

  assert.deepEqual(github.comments, []);
});
