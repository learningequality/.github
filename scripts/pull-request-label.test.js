const test = require('node:test');
const assert = require('node:assert/strict');

const pullRequestLabel = require('./pull-request-label');
const { LE_BOT_USERNAME, LABEL_COMMUNITY_REVIEW } = require('./constants');

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

function fakeContext({ label = LABEL_COMMUNITY_REVIEW, sender = 'maintainer' } = {}) {
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: {
      label: { name: label },
      sender: { login: sender },
      pull_request: { number: 42 },
    },
  };
}

const core = { info() {}, warning() {}, setFailed() {} };

test('a label added by a person posts the note', async () => {
  const github = fakeGithub();
  await pullRequestLabel({ github, context: fakeContext(), core });

  assert.equal(github.comments.length, 1);
  assert.match(github.comments[0], /community pre-review/);
});

test('a label added by the bot posts nothing', async () => {
  const github = fakeGithub();
  await pullRequestLabel({ github, context: fakeContext({ sender: LE_BOT_USERNAME }), core });

  assert.deepEqual(github.comments, []);
});

test('any other label posts nothing', async () => {
  const github = fakeGithub();
  await pullRequestLabel({ github, context: fakeContext({ label: 'bug' }), core });

  assert.deepEqual(github.comments, []);
});
