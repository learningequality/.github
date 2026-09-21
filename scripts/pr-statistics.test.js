const test = require('node:test');
const assert = require('node:assert/strict');

const prStatistics = require('./pr-statistics');

function makeGithub({ prsByRepo = {}, reviewsByNumber = {}, commentsByNumber = {} }) {
  return {
    rest: {
      pulls: {
        list: async ({ repo, page }) => {
          if (page > 1) return { data: [] };
          return { data: prsByRepo[repo] || [] };
        },
        listReviews: async ({ pull_number: pullNumber }) => ({
          data: reviewsByNumber[pullNumber] || [],
        }),
        listReviewComments: async ({ pull_number: pullNumber }) => ({
          data: commentsByNumber[pullNumber] || [],
        }),
      },
    },
  };
}

function makePR({
  number,
  repo = 'kolibri',
  state = 'open',
  createdAt,
  updatedAt,
  closedAt,
  user = 'author',
}) {
  return {
    number,
    repo,
    state,
    title: `PR ${number}`,
    html_url: `https://github.com/learningequality/${repo}/pull/${number}`,
    created_at: createdAt.toISOString(),
    updated_at: (updatedAt || createdAt).toISOString(),
    closed_at: closedAt ? closedAt.toISOString() : undefined,
    user: { login: user },
  };
}

function review(login, at, state = 'APPROVED', { id, body = '' } = {}) {
  return { id, user: { login }, submitted_at: at.toISOString(), state, body };
}

function groupByRepo(prs) {
  const byRepo = {};
  for (const pr of prs) {
    byRepo[pr.repo] = byRepo[pr.repo] || [];
    byRepo[pr.repo].push(pr);
  }
  return byRepo;
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function makeCore() {
  const outputs = {};
  return {
    outputs,
    setOutput: (key, value) => {
      outputs[key] = value;
    },
  };
}

test('a PR reviewed solely by a bot counts as unreviewed by a human', async () => {
  const now = new Date();
  const github = makeGithub({
    prsByRepo: {
      kolibri: [
        {
          number: 1,
          state: 'open',
          title: 'Some PR',
          html_url: 'https://github.com/learningequality/kolibri/pull/1',
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
      ],
    },
    reviewsByNumber: {
      1: [{ user: { login: 'rtibblesbot' }, submitted_at: now.toISOString() }],
    },
  });
  const core = makeCore();

  await prStatistics({ github, core });

  assert.equal(core.outputs.open_unreviewed_prs, 1);
  assert.equal(core.outputs.reviewed_prs, 0);
});

test('bot coverage is measured over PRs created in the window, not the full updated_at population', async () => {
  const now = new Date();
  const prA = makePR({ number: 1, createdAt: new Date(now - DAY) }); // created in window, bot-reviewed
  const prB = makePR({
    number: 2,
    createdAt: new Date(now - 40 * DAY),
    updatedAt: new Date(now - DAY),
  }); // created before window, bot-reviewed
  const prC = makePR({ number: 3, createdAt: new Date(now - 2 * DAY) }); // created in window, no bot review

  const github = makeGithub({
    prsByRepo: groupByRepo([prA, prB, prC]),
    reviewsByNumber: {
      1: [review('rtibblesbot', new Date(now - DAY + HOUR))],
      2: [review('rtibblesbot', new Date(now - DAY + HOUR))],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.match(message, /Reviewed 1 of 2 PRs opened in window \(50%\)/);
});

test('bot lead time suppresses the "human first" suffix when every bot review lands first', async () => {
  const now = new Date();
  const createdAt = new Date(now - DAY);
  const botAt = new Date(createdAt.getTime() + HOUR);
  const humanAt = new Date(botAt.getTime() + 4 * HOUR);
  const pr = makePR({ number: 1, createdAt });

  const github = makeGithub({
    prsByRepo: groupByRepo([pr]),
    reviewsByNumber: {
      1: [review('rtibblesbot', botAt), review('reviewer', humanAt)],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.match(message, /Lead time over first human review: median 4h \(1 PR\)/);
  assert.doesNotMatch(message, /human first/);
});

test('a human review that lands before the bot review is tallied as human-first, not in the median', async () => {
  const now = new Date();
  const createdAt = new Date(now - DAY);

  const botFirstAt = new Date(createdAt.getTime() + HOUR);
  const humanAfterBotAt = new Date(botFirstAt.getTime() + 4 * HOUR);
  const prBotFirst = makePR({ number: 1, createdAt });

  const humanFirstAt = new Date(createdAt.getTime() + HOUR);
  const botAfterHumanAt = new Date(humanFirstAt.getTime() + HOUR);
  const prHumanFirst = makePR({ number: 2, createdAt });

  const github = makeGithub({
    prsByRepo: groupByRepo([prBotFirst, prHumanFirst]),
    reviewsByNumber: {
      1: [review('rtibblesbot', botFirstAt), review('reviewer', humanAfterBotAt)],
      2: [review('reviewer', humanFirstAt), review('rtibblesbot', botAfterHumanAt)],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.match(message, /Lead time over first human review: median 4h \(1 PR; human first on 1\)/);
});

test('submitted-reviews line reports the with-bot and without-bot medians in order', async () => {
  const now = new Date();

  const prWithBot = makePR({ number: 1, createdAt: new Date(now - 2 * DAY) });
  const botAt = new Date(prWithBot.created_at).getTime() + HOUR;
  const human1At = new Date(prWithBot.created_at).getTime() + 7 * HOUR;
  const human2At = new Date(prWithBot.created_at).getTime() + 8 * HOUR;

  const prWithoutBot = makePR({ number: 2, createdAt: new Date(now - 3 * DAY) });
  const humanWithoutBotAt = new Date(prWithoutBot.created_at).getTime() + 30 * HOUR;

  const github = makeGithub({
    prsByRepo: groupByRepo([prWithBot, prWithoutBot]),
    reviewsByNumber: {
      1: [
        review('rtibblesbot', new Date(botAt)),
        review('reviewer', new Date(human1At)),
        review('reviewer', new Date(human2At)),
      ],
      2: [review('reviewer', new Date(humanWithoutBotAt))],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.match(message, /Human reviews submitted: median 2 with bot pre-review vs 1 without/);
});

test('a PR with no human review is excluded from both submitted-reviews groups', async () => {
  const now = new Date();

  const prWithBotReviewed = makePR({ number: 1, createdAt: new Date(now - 2 * DAY) });
  const botAt1 = new Date(prWithBotReviewed.created_at).getTime() + HOUR;
  const human1At = new Date(prWithBotReviewed.created_at).getTime() + 7 * HOUR;
  const human2At = new Date(prWithBotReviewed.created_at).getTime() + 8 * HOUR;

  const prWithBotUnreviewed = makePR({ number: 2, createdAt: new Date(now - 2 * DAY) });
  const botAt2 = new Date(prWithBotUnreviewed.created_at).getTime() + HOUR;

  const prWithoutBot = makePR({ number: 3, createdAt: new Date(now - 3 * DAY) });
  const humanWithoutBotAt = new Date(prWithoutBot.created_at).getTime() + 30 * HOUR;

  const github = makeGithub({
    prsByRepo: groupByRepo([prWithBotReviewed, prWithBotUnreviewed, prWithoutBot]),
    reviewsByNumber: {
      1: [
        review('rtibblesbot', new Date(botAt1)),
        review('reviewer', new Date(human1At)),
        review('reviewer', new Date(human2At)),
      ],
      2: [review('rtibblesbot', new Date(botAt2))],
      3: [review('reviewer', new Date(humanWithoutBotAt))],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.match(message, /Human reviews submitted: median 2 with bot pre-review vs 1 without/);
});

test('a PR whose only human reviews are bodyless single-reply COMMENTED reviews is excluded from both submitted-reviews groups', async () => {
  const now = new Date();

  const prWithBotVerdict = makePR({ number: 1, createdAt: new Date(now - 2 * DAY) });
  const botAt1 = new Date(prWithBotVerdict.created_at).getTime() + HOUR;
  const humanVerdictAt = new Date(prWithBotVerdict.created_at).getTime() + 7 * HOUR;

  const prWithBotCommentOnly = makePR({ number: 2, createdAt: new Date(now - 2 * DAY) });
  const botAt2 = new Date(prWithBotCommentOnly.created_at).getTime() + HOUR;
  const commentAt1 = new Date(prWithBotCommentOnly.created_at).getTime() + 5 * HOUR;
  const commentAt2 = new Date(prWithBotCommentOnly.created_at).getTime() + 6 * HOUR;
  const commentAt3 = new Date(prWithBotCommentOnly.created_at).getTime() + 7 * HOUR;

  const prWithoutBot = makePR({ number: 3, createdAt: new Date(now - 3 * DAY) });
  const humanWithoutBotAt = new Date(prWithoutBot.created_at).getTime() + 30 * HOUR;

  const github = makeGithub({
    prsByRepo: groupByRepo([prWithBotVerdict, prWithBotCommentOnly, prWithoutBot]),
    reviewsByNumber: {
      1: [review('rtibblesbot', new Date(botAt1)), review('reviewer', new Date(humanVerdictAt))],
      2: [
        review('rtibblesbot', new Date(botAt2)),
        review('reviewer', new Date(commentAt1), 'COMMENTED', { id: 21 }),
        review('reviewer', new Date(commentAt2), 'COMMENTED', { id: 22 }),
        review('reviewer', new Date(commentAt3), 'COMMENTED', { id: 23 }),
      ],
      3: [review('reviewer', new Date(humanWithoutBotAt))],
    },
    commentsByNumber: {
      2: [
        { pull_request_review_id: 21, in_reply_to_id: 900 },
        { pull_request_review_id: 22, in_reply_to_id: 901 },
        { pull_request_review_id: 23, in_reply_to_id: 902 },
      ],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.match(message, /Human reviews submitted: median 1 with bot pre-review vs 1 without/);
});

test('a PR whose only human activity is a bare reply is in neither submitted-reviews group', async () => {
  const now = new Date();

  const prWithBotOne = makePR({ number: 1, createdAt: new Date(now - 2 * DAY) });
  const botAt1 = new Date(prWithBotOne.created_at).getTime() + HOUR;
  const human1At = new Date(prWithBotOne.created_at).getTime() + 7 * HOUR;

  const prWithBotTwo = makePR({ number: 2, createdAt: new Date(now - 2 * DAY) });
  const botAt2 = new Date(prWithBotTwo.created_at).getTime() + HOUR;
  const human2At = new Date(prWithBotTwo.created_at).getTime() + 7 * HOUR;

  const prWithBotBareReplyOnly = makePR({ number: 3, createdAt: new Date(now - 2 * DAY) });
  const botAt3 = new Date(prWithBotBareReplyOnly.created_at).getTime() + HOUR;
  const bareReplyAt = new Date(prWithBotBareReplyOnly.created_at).getTime() + 5 * HOUR;

  const prWithoutBot = makePR({ number: 4, createdAt: new Date(now - 3 * DAY) });
  const humanWithoutBotAt = new Date(prWithoutBot.created_at).getTime() + 30 * HOUR;

  const github = makeGithub({
    prsByRepo: groupByRepo([prWithBotOne, prWithBotTwo, prWithBotBareReplyOnly, prWithoutBot]),
    reviewsByNumber: {
      1: [review('rtibblesbot', new Date(botAt1)), review('reviewer', new Date(human1At))],
      2: [
        review('rtibblesbot', new Date(botAt2)),
        review('reviewer', new Date(human2At)),
        review('reviewer', new Date(human2At)),
      ],
      3: [
        review('rtibblesbot', new Date(botAt3)),
        review('reviewer', new Date(bareReplyAt), 'COMMENTED', { id: 31 }),
      ],
      4: [review('reviewer', new Date(humanWithoutBotAt))],
    },
    commentsByNumber: {
      3: [{ pull_request_review_id: 31, in_reply_to_id: 900 }],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.match(message, /Human reviews submitted: median 1\.5 with bot pre-review vs 1 without/);
});

test('the bot section is omitted entirely when no PR has a bot review', async () => {
  const now = new Date();
  const pr = makePR({ number: 1, createdAt: new Date(now - DAY) });

  const github = makeGithub({
    prsByRepo: groupByRepo([pr]),
    reviewsByNumber: {
      1: [review('reviewer', new Date(now - DAY + HOUR))],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.doesNotMatch(message, /@rtibblesbot/);
});

test('a dependabot-authored PR is excluded from bot-section metrics but stays in the other sections', async () => {
  const now = new Date();
  const createdAt = new Date(now - DAY);

  const prHuman = makePR({ number: 1, createdAt, user: 'somehuman' });
  const prBot = makePR({ number: 2, createdAt, user: 'dependabot[bot]' });

  const github = makeGithub({
    prsByRepo: groupByRepo([prHuman, prBot]),
    reviewsByNumber: {
      1: [review('rtibblesbot', new Date(createdAt.getTime() + HOUR))],
      2: [review('rtibblesbot', new Date(createdAt.getTime() + HOUR))],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.match(message, /Reviewed 1 of 1 PRs opened in window \(100%\)/);
  assert.equal(core.outputs.bot_reviewed_prs, 1);
  assert.equal(core.outputs.open_unreviewed_prs, 2);
});

test('a merged, bot-pre-reviewed PR is counted in lifespan and the closed-branch submitted-reviews push', async () => {
  const now = new Date();

  const createdAt = new Date(now - 3 * DAY);
  const closedAt = new Date(now - DAY);
  const botAt = new Date(createdAt.getTime() + HOUR);
  const humanWithBotAt = new Date(createdAt.getTime() + 7 * HOUR);
  const prMerged = makePR({ number: 1, state: 'closed', createdAt, closedAt });

  const createdAtNoBot = new Date(now - 2 * DAY);
  const humanWithoutBotAt = new Date(createdAtNoBot.getTime() + 30 * HOUR);
  const prOpenNoBot = makePR({ number: 2, createdAt: createdAtNoBot });

  const github = makeGithub({
    prsByRepo: groupByRepo([prMerged, prOpenNoBot]),
    reviewsByNumber: {
      1: [review('rtibblesbot', botAt), review('reviewer', humanWithBotAt)],
      2: [review('reviewer', humanWithoutBotAt)],
    },
  });
  const core = makeCore();

  const message = await prStatistics({ github, core });

  assert.equal(core.outputs.closed_prs, 1);
  assert.equal(core.outputs.reviewed_prs, 2);
  assert.match(message, /\*PR Lifespan \(Open to Close\/Merge\)\*\nMedian: 2d/);
  assert.match(message, /Human reviews submitted: median 1 with bot pre-review vs 1 without/);
});
