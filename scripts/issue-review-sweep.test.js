const test = require('node:test');
const assert = require('node:assert/strict');

const { sweepIssueReviewLabels } = require('./issue-review-sweep');
const { LABEL_COMMUNITY_ISSUE_REVIEW, ISSUE_REVIEW_MAX_DAYS } = require('./constants');

const NOW = Date.parse('2026-10-26T12:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const daysAgo = days => new Date(NOW - days * MS_PER_DAY).toISOString();

const labeled = (at, name = LABEL_COMMUNITY_ISSUE_REVIEW) => ({
  event: 'labeled',
  label: { name },
  created_at: at,
});

const unlabeled = (at, name = LABEL_COMMUNITY_ISSUE_REVIEW) => ({
  event: 'unlabeled',
  label: { name },
  created_at: at,
});

function fakeGithub({
  issues = [],
  timelines = {},
  listFails = false,
  timelineFails = false,
  removeFails = false,
} = {}) {
  const removed = [];
  // An entry is a number, which carries the review label, or { number, labels }
  // to model an issue carrying other labels.
  const all = issues.map(issue =>
    typeof issue === 'number' ? { number: issue, labels: [LABEL_COMMUNITY_ISSUE_REVIEW] } : issue,
  );
  return {
    removed,
    paginate: async (fn, params) => fn(params),
    rest: {
      issues: {
        listForRepo: async ({ labels }) => {
          if (listFails) {
            throw new Error('server error');
          }
          const wanted = (labels || '').split(',').filter(Boolean);
          return all.filter(issue => wanted.every(name => issue.labels.includes(name)));
        },
        listEventsForTimeline: async ({ issue_number }) => {
          if (timelineFails) {
            throw new Error('server error');
          }
          return timelines[issue_number] || [];
        },
        removeLabel: async ({ name, issue_number }) => {
          if (removeFails) {
            const error = new Error('server error');
            error.status = 500;
            throw error;
          }
          removed.push({ name, issue_number });
        },
      },
    },
  };
}

function fakeCore() {
  const warnings = [];
  return {
    warnings,
    info() {},
    warning(message) {
      warnings.push(message);
    },
  };
}

test('a label older than the limit comes off', async () => {
  const github = fakeGithub({
    issues: [7],
    timelines: { 7: [labeled(daysAgo(ISSUE_REVIEW_MAX_DAYS + 1))] },
  });
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    {
      github,
      core: fakeCore(),
    },
    NOW,
  );

  assert.deepEqual(cleared, [7]);
  assert.deepEqual(github.removed, [{ name: LABEL_COMMUNITY_ISSUE_REVIEW, issue_number: 7 }]);
});

test('a label younger than the limit stays on', async () => {
  const github = fakeGithub({
    issues: [7],
    timelines: { 7: [labeled(daysAgo(ISSUE_REVIEW_MAX_DAYS - 1))] },
  });
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    {
      github,
      core: fakeCore(),
    },
    NOW,
  );

  assert.deepEqual(cleared, []);
  assert.deepEqual(github.removed, []);
});

test('a label at exactly the limit stays on', async () => {
  const github = fakeGithub({
    issues: [7],
    timelines: { 7: [labeled(daysAgo(ISSUE_REVIEW_MAX_DAYS))] },
  });
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    {
      github,
      core: fakeCore(),
    },
    NOW,
  );

  assert.deepEqual(cleared, []);
});

test('the most recent application decides', async () => {
  // Labelled long ago, cleared, then labelled again today.
  const github = fakeGithub({
    issues: [7],
    timelines: {
      7: [labeled(daysAgo(30)), unlabeled(daysAgo(29)), labeled(daysAgo(0))],
    },
  });
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    {
      github,
      core: fakeCore(),
    },
    NOW,
  );

  assert.deepEqual(cleared, []);
});

test('a labeled event for another label is not read as this one', async () => {
  const github = fakeGithub({
    issues: [7],
    timelines: { 7: [labeled(daysAgo(30), 'help wanted')] },
  });
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    {
      github,
      core: fakeCore(),
    },
    NOW,
  );

  assert.deepEqual(cleared, []);
});

test('each issue is judged on its own age', async () => {
  const github = fakeGithub({
    issues: [7, 8],
    timelines: {
      7: [labeled(daysAgo(ISSUE_REVIEW_MAX_DAYS + 1))],
      8: [labeled(daysAgo(1))],
    },
  });
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    {
      github,
      core: fakeCore(),
    },
    NOW,
  );

  assert.deepEqual(cleared, [7]);
});

test('an issue that no longer carries the label is left alone', async () => {
  // The timeline keeps the old `labeled` event, so only the label filter on the
  // listing keeps this issue out of the sweep.
  const github = fakeGithub({
    issues: [{ number: 7, labels: ['help wanted'] }],
    timelines: { 7: [labeled(daysAgo(30)), unlabeled(daysAgo(29))] },
  });
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    { github, core: fakeCore() },
    NOW,
  );

  assert.deepEqual(cleared, []);
  assert.deepEqual(github.removed, []);
});

test('a removal this run cannot make is not counted as cleared', async () => {
  const github = fakeGithub({
    issues: [7],
    timelines: { 7: [labeled(daysAgo(ISSUE_REVIEW_MAX_DAYS + 1))] },
    removeFails: true,
  });
  const core = fakeCore();
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    { github, core },
    NOW,
  );

  assert.deepEqual(cleared, []);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /Failed to remove/);
});

test('a timeline this run cannot read leaves the label on', async () => {
  const github = fakeGithub({ issues: [7], timelineFails: true });
  const core = fakeCore();
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    { github, core },
    NOW,
  );

  assert.deepEqual(cleared, []);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /Failed to read the timeline/);
});

test('a listing this run cannot read sweeps nothing', async () => {
  const github = fakeGithub({ listFails: true });
  const core = fakeCore();
  const cleared = await sweepIssueReviewLabels(
    'learningequality',
    'kolibri',
    { github, core },
    NOW,
  );

  assert.deepEqual(cleared, []);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /Failed to list issues under review/);
});
