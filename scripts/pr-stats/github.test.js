const test = require('node:test');
const assert = require('node:assert/strict');

const { getReviewSummary } = require('./github');

function stubGithub(reviews, comments = []) {
  return {
    rest: {
      pulls: {
        listReviews: async () => ({ data: reviews }),
        listReviewComments: async () => ({ data: comments }),
      },
    },
  };
}

function countingCommentsStub(reviews, comments = []) {
  let calls = 0;
  const github = {
    rest: {
      pulls: {
        listReviews: async () => ({ data: reviews }),
        listReviewComments: async () => {
          calls++;
          return { data: comments };
        },
      },
    },
  };
  return { github, callCount: () => calls };
}

test('getReviewSummary: partitions bot and human reviews by submission time', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const github = stubGithub([
    { user: { login: 'rtibblesbot' }, submitted_at: new Date(t1).toISOString() },
    { user: { login: 'someone' }, submitted_at: new Date(t2).toISOString() },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.firstHumanReviewAt, t2);
  assert.equal(result.firstBotReviewAt, t1);
});

test('getReviewSummary: reviews from all bot usernames with no human review', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const t3 = new Date('2024-01-03T00:00:00Z').getTime();
  const t4 = new Date('2024-01-04T00:00:00Z').getTime();
  const github = stubGithub([
    { user: { login: 'learning-equality-bot[bot]' }, submitted_at: new Date(t2).toISOString() },
    { user: { login: 'sentry-io[bot]' }, submitted_at: new Date(t3).toISOString() },
    { user: { login: 'dependabot[bot]' }, submitted_at: new Date(t4).toISOString() },
    { user: { login: 'rtibblesbot' }, submitted_at: new Date(t1).toISOString() },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.firstHumanReviewAt, null);
  assert.equal(result.firstBotReviewAt, t1);
});

test('getReviewSummary: ignores a human review with a null submitted_at', async () => {
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const github = stubGithub([
    { user: { login: 'someone' }, submitted_at: null },
    { user: { login: 'someone-else' }, submitted_at: new Date(t2).toISOString() },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.firstHumanReviewAt, t2);
  assert.equal(result.firstBotReviewAt, null);
});

test('getReviewSummary: returns nulls without throwing when listReviews rejects', async () => {
  const github = {
    rest: {
      pulls: {
        listReviews: async () => {
          throw new Error('boom');
        },
      },
    },
  };

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.firstHumanReviewAt, null);
  assert.equal(result.firstBotReviewAt, null);
});

test('getReviewSummary: handles null user from deleted/ghost accounts', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const github = stubGithub([
    { user: null, submitted_at: new Date(t1).toISOString() },
    { user: { login: 'someone' }, submitted_at: new Date(t2).toISOString() },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.firstHumanReviewAt, t1);
  assert.equal(result.firstBotReviewAt, null);
});

test('getReviewSummary: humanSubmittedReviewCount counts APPROVED and CHANGES_REQUESTED out of a mix', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const t3 = new Date('2024-01-03T00:00:00Z').getTime();
  const github = stubGithub([
    { user: { login: 'rtibblesbot' }, submitted_at: new Date(t1).toISOString(), state: 'APPROVED' },
    {
      user: { login: 'someone' },
      submitted_at: new Date(t2).toISOString(),
      state: 'APPROVED',
    },
    {
      user: { login: 'someone-else' },
      submitted_at: new Date(t3).toISOString(),
      state: 'CHANGES_REQUESTED',
    },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 2);
});

test('getReviewSummary: a COMMENTED review with a non-empty body counts as submitted', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const github = stubGithub([
    {
      id: 1,
      user: { login: 'someone' },
      submitted_at: new Date(t1).toISOString(),
      state: 'COMMENTED',
      body: 'Looks fine, minor nit below.',
    },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 1);
});

test('getReviewSummary: a bodyless COMMENTED review whose only comment is a reply does not count', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const { github, callCount } = countingCommentsStub(
    [
      {
        id: 1,
        user: { login: 'someone' },
        submitted_at: new Date(t1).toISOString(),
        state: 'COMMENTED',
        body: '',
      },
    ],
    [{ pull_request_review_id: 1, in_reply_to_id: 555 }],
  );

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 0);
  assert.equal(callCount(), 1);
});

test('getReviewSummary: a bodyless COMMENTED review opening a new thread counts as submitted', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const github = stubGithub(
    [
      {
        id: 1,
        user: { login: 'someone' },
        submitted_at: new Date(t1).toISOString(),
        state: 'COMMENTED',
        body: '',
      },
    ],
    [{ pull_request_review_id: 1, in_reply_to_id: null }],
  );

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 1);
});

test('getReviewSummary: a bodyless COMMENTED review with two replies counts as submitted', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const github = stubGithub(
    [
      {
        id: 1,
        user: { login: 'someone' },
        submitted_at: new Date(t1).toISOString(),
        state: 'COMMENTED',
        body: '',
      },
    ],
    [
      { pull_request_review_id: 1, in_reply_to_id: 555 },
      { pull_request_review_id: 1, in_reply_to_id: 556 },
    ],
  );

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 1);
});

test('getReviewSummary: humanSubmittedReviewCount excludes DISMISSED reviews', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const github = stubGithub([
    { user: { login: 'someone' }, submitted_at: new Date(t1).toISOString(), state: 'DISMISSED' },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 0);
});

test('getReviewSummary: humanSubmittedReviewCount is 0 when only bots left verdicts', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const github = stubGithub([
    { user: { login: 'rtibblesbot' }, submitted_at: new Date(t1).toISOString(), state: 'APPROVED' },
    {
      user: { login: 'dependabot[bot]' },
      submitted_at: new Date(t1).toISOString(),
      state: 'APPROVED',
    },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 0);
});

test('getReviewSummary: humanSubmittedReviewCount ignores a review with a null submitted_at', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const github = stubGithub([
    { user: { login: 'someone' }, submitted_at: null, state: 'APPROVED' },
    {
      user: { login: 'someone-else' },
      submitted_at: new Date(t1).toISOString(),
      state: 'APPROVED',
    },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 1);
});

test('getReviewSummary: humanSubmittedReviewCount counts a null-user verdict as human', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const github = stubGithub([
    { user: null, submitted_at: new Date(t1).toISOString(), state: 'APPROVED' },
    {
      user: { login: 'someone' },
      submitted_at: new Date(t2).toISOString(),
      state: 'CHANGES_REQUESTED',
    },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 2);
});

test('getReviewSummary: a human COMMENTED review still sets firstHumanReviewAt even when not submitted', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const github = stubGithub(
    [
      {
        id: 1,
        user: { login: 'someone' },
        submitted_at: new Date(t1).toISOString(),
        state: 'COMMENTED',
        body: '',
      },
    ],
    [{ pull_request_review_id: 1, in_reply_to_id: 555 }],
  );

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.firstHumanReviewAt, t1);
  assert.equal(result.humanSubmittedReviewCount, 0);
});

test('getReviewSummary: does not request comments when no bodyless COMMENTED review exists', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const { github, callCount } = countingCommentsStub([
    { user: { login: 'someone' }, submitted_at: new Date(t1).toISOString(), state: 'APPROVED' },
    {
      user: { login: 'someone-else' },
      submitted_at: new Date(t2).toISOString(),
      state: 'COMMENTED',
      body: 'non-empty',
    },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 2);
  assert.equal(callCount(), 0);
});

test('getReviewSummary: requests comments at most once for several ambiguous reviews', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const { github, callCount } = countingCommentsStub(
    [
      {
        id: 1,
        user: { login: 'someone' },
        submitted_at: new Date(t1).toISOString(),
        state: 'COMMENTED',
        body: '',
      },
      {
        id: 2,
        user: { login: 'someone-else' },
        submitted_at: new Date(t2).toISOString(),
        state: 'COMMENTED',
        body: '',
      },
    ],
    [
      { pull_request_review_id: 1, in_reply_to_id: null },
      { pull_request_review_id: 2, in_reply_to_id: 555 },
    ],
  );

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 1);
  assert.equal(callCount(), 1);
});

test('getReviewSummary: bot COMMENTED reviews never count and never trigger a comments request', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const { github, callCount } = countingCommentsStub([
    {
      id: 1,
      user: { login: 'rtibblesbot' },
      submitted_at: new Date(t1).toISOString(),
      state: 'COMMENTED',
      body: '',
    },
  ]);

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 0);
  assert.equal(callCount(), 0);
});

test('getReviewSummary: when the comments request rejects, ambiguous reviews are not counted', async () => {
  const t1 = new Date('2024-01-01T00:00:00Z').getTime();
  const t2 = new Date('2024-01-02T00:00:00Z').getTime();
  const github = {
    rest: {
      pulls: {
        listReviews: async () => ({
          data: [
            { user: { login: 'rtibblesbot' }, submitted_at: new Date(t1).toISOString() },
            {
              id: 1,
              user: { login: 'someone' },
              submitted_at: new Date(t2).toISOString(),
              state: 'COMMENTED',
              body: '',
            },
          ],
        }),
        listReviewComments: async () => {
          throw new Error('boom');
        },
      },
    },
  };

  const result = await getReviewSummary(github, 'learningequality', 'kolibri', 1);

  assert.equal(result.humanSubmittedReviewCount, 0);
  assert.equal(result.firstHumanReviewAt, t2);
  assert.equal(result.firstBotReviewAt, t1);
});
