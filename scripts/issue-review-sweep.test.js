const test = require('node:test');
const assert = require('node:assert/strict');

const { sweepIssueReviewLabels, closeIssuesMissingTemplate } = require('./issue-review-sweep');
const {
  LABEL_COMMUNITY_ISSUE_REVIEW,
  ISSUE_REVIEW_MAX_DAYS,
  LABEL_NEEDS_TEMPLATE,
  ISSUE_TEMPLATE_MAX_DAYS,
  BOT_MESSAGE_ISSUE_TEMPLATE_CLOSED,
} = require('./constants');

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
  assert.match(core.warnings[0], /Failed to list issues labelled/);
});

const templateIssue = number => ({ number, labels: [LABEL_NEEDS_TEMPLATE] });

function closingGithub(options) {
  const github = fakeGithub(options);
  github.commented = [];
  github.closed = [];
  github.rest.issues.createComment = async ({ issue_number, body }) => {
    github.commented.push({ issue_number, body });
  };
  github.rest.issues.update = async ({ issue_number, state, state_reason }) => {
    github.closed.push({ issue_number, state, state_reason });
  };
  return github;
}

test('an issue missing its template past the limit is closed with a comment', async () => {
  const github = closingGithub({
    issues: [templateIssue(7)],
    timelines: { 7: [labeled(daysAgo(ISSUE_TEMPLATE_MAX_DAYS + 1), LABEL_NEEDS_TEMPLATE)] },
  });
  const closed = await closeIssuesMissingTemplate(
    'learningequality',
    'kolibri',
    { github, core: fakeCore() },
    NOW,
  );

  assert.deepEqual(closed, [7]);
  assert.deepEqual(github.commented, [
    { issue_number: 7, body: BOT_MESSAGE_ISSUE_TEMPLATE_CLOSED },
  ]);
  assert.deepEqual(github.closed, [
    { issue_number: 7, state: 'closed', state_reason: 'not_planned' },
  ]);
});

test('an issue missing its template within the limit stays open', async () => {
  const github = closingGithub({
    issues: [templateIssue(7)],
    timelines: { 7: [labeled(daysAgo(ISSUE_TEMPLATE_MAX_DAYS - 1), LABEL_NEEDS_TEMPLATE)] },
  });
  const closed = await closeIssuesMissingTemplate(
    'learningequality',
    'kolibri',
    { github, core: fakeCore() },
    NOW,
  );

  assert.deepEqual(closed, []);
  assert.deepEqual(github.commented, []);
});

test('an issue whose template label a maintainer removed stays open', async () => {
  const github = closingGithub({
    issues: [{ number: 7, labels: [] }],
    timelines: { 7: [labeled(daysAgo(30), LABEL_NEEDS_TEMPLATE)] },
  });
  const closed = await closeIssuesMissingTemplate(
    'learningequality',
    'kolibri',
    { github, core: fakeCore() },
    NOW,
  );

  assert.deepEqual(closed, []);
});

test('a close this run cannot make warns and is not counted', async () => {
  const github = closingGithub({
    issues: [templateIssue(7)],
    timelines: { 7: [labeled(daysAgo(30), LABEL_NEEDS_TEMPLATE)] },
  });
  github.rest.issues.update = async () => {
    throw new Error('forbidden');
  };
  const core = fakeCore();
  const closed = await closeIssuesMissingTemplate(
    'learningequality',
    'kolibri',
    { github, core },
    NOW,
  );

  assert.deepEqual(closed, []);
  assert.deepEqual(github.commented, []);
  assert.match(core.warnings[0], /Failed to close issue #7/);
});

test('a reopened issue still missing its template gets the full limit again', async () => {
  const github = closingGithub({
    issues: [templateIssue(7)],
    timelines: {
      7: [
        labeled(daysAgo(30), LABEL_NEEDS_TEMPLATE),
        { event: 'reopened', created_at: daysAgo(ISSUE_TEMPLATE_MAX_DAYS - 1) },
      ],
    },
  });
  const closed = await closeIssuesMissingTemplate(
    'learningequality',
    'kolibri',
    { github, core: fakeCore() },
    NOW,
  );

  assert.deepEqual(closed, []);
});

test('a pull request carrying the template label is not closed', async () => {
  const github = closingGithub({
    issues: [{ ...templateIssue(7), pull_request: {} }],
    timelines: { 7: [labeled(daysAgo(30), LABEL_NEEDS_TEMPLATE)] },
  });
  const closed = await closeIssuesMissingTemplate(
    'learningequality',
    'kolibri',
    { github, core: fakeCore() },
    NOW,
  );

  assert.deepEqual(closed, []);
});
