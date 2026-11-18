const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sweepIssueReviewLabels,
  closeIssuesMissingTemplate,
  closeUnlinkedPullRequests,
} = require('./issue-review-sweep');
const {
  LABEL_COMMUNITY_ISSUE_REVIEW,
  ISSUE_REVIEW_MAX_DAYS,
  LABEL_NEEDS_TEMPLATE,
  ISSUE_TEMPLATE_MAX_DAYS,
  BOT_MESSAGE_ISSUE_TEMPLATE_CLOSED,
  LABEL_UNLINKED,
  PR_UNLINKED_MAX_DAYS,
  BOT_MESSAGE_PULL_REQUEST_UNLINKED_CLOSED,
  LABEL_COMMUNITY_REVIEW,
  RTIBBLESBOT_USERNAME,
  CLOSE_CONTRIBUTORS,
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

const AUTHOR = 'outsider';
const prContext = { repo: { owner: 'learningequality', repo: 'kolibri' } };
const unlinkedPr = number => ({
  number,
  labels: [LABEL_UNLINKED],
  pull_request: {},
  user: { login: AUTHOR },
});

function prGithub({ issues, linked = {}, graphqlFails = false }) {
  const github = fakeGithub({
    issues,
    timelines: Object.fromEntries(
      issues.map(({ number }) => [
        number,
        [labeled(daysAgo(PR_UNLINKED_MAX_DAYS + 1), LABEL_UNLINKED)],
      ]),
    ),
  });
  github.commented = [];
  github.closed = [];
  github.reviewers = [];
  github.labelled = [];
  github.graphql = async (query, { number }) => {
    if (graphqlFails) throw new Error('API down');
    const nodes = (linked[number] || []).map(issue => ({
      number: issue.number,
      url: `https://github.com/learningequality/kolibri/issues/${issue.number}`,
      assignees: { nodes: issue.assignees.map(login => ({ login })) },
    }));
    return { repository: { pullRequest: { closingIssuesReferences: { nodes } } } };
  };
  github.rest.issues.createComment = async ({ issue_number, body }) => {
    github.commented.push({ issue_number, body });
    return {
      data: { html_url: `https://github.com/learningequality/kolibri/pull/${issue_number}` },
    };
  };
  github.rest.issues.addLabels = async ({ labels }) => {
    github.labelled.push(...labels);
  };
  github.rest.issues.listLabelsOnIssue = async ({ issue_number }) =>
    issues.find(({ number }) => number === issue_number).labels.map(name => ({ name }));
  github.rest.pulls = {
    update: async ({ pull_number, state }) => {
      github.closed.push({ pull_number, state });
    },
    requestReviewers: async ({ reviewers }) => {
      github.reviewers.push(...reviewers);
    },
  };
  return github;
}

const sweepPrs = (github, core = fakeCore()) =>
  closeUnlinkedPullRequests(
    'learningequality',
    'kolibri',
    { github, context: prContext, core },
    NOW,
  );

test('a pull request unlinked past the limit is closed with a comment', async () => {
  const github = prGithub({ issues: [unlinkedPr(42)] });

  assert.deepEqual(await sweepPrs(github), [42]);
  assert.deepEqual(github.commented, [
    { issue_number: 42, body: BOT_MESSAGE_PULL_REQUEST_UNLINKED_CLOSED },
  ]);
  assert.deepEqual(github.closed, [{ pull_number: 42, state: 'closed' }]);
});

test('a pull request since linked to the issue assigned to its author starts review', async () => {
  const github = prGithub({
    issues: [unlinkedPr(42)],
    linked: { 42: [{ number: 7, assignees: [AUTHOR] }] },
  });

  assert.deepEqual(await sweepPrs(github), []);
  assert.deepEqual(github.removed, [{ name: LABEL_UNLINKED, issue_number: 42 }]);
  assert.deepEqual(github.reviewers, [RTIBBLESBOT_USERNAME]);
  assert.deepEqual(github.labelled, [LABEL_COMMUNITY_REVIEW]);
});

test('a linked pull request already under review gets no second request', async () => {
  const github = prGithub({
    issues: [{ ...unlinkedPr(42), labels: [LABEL_UNLINKED, LABEL_COMMUNITY_REVIEW] }],
    linked: { 42: [{ number: 7, assignees: [AUTHOR] }] },
  });

  assert.deepEqual(await sweepPrs(github), []);
  assert.deepEqual(github.reviewers, []);
});

test('a failed review request leaves the unlinked label for the next sweep', async () => {
  const github = prGithub({
    issues: [unlinkedPr(42)],
    linked: { 42: [{ number: 7, assignees: [AUTHOR] }] },
  });
  github.rest.pulls.requestReviewers = async () => {
    throw new Error('Reviewer cannot be requested');
  };
  const core = fakeCore();

  assert.deepEqual(await sweepPrs(github, core), []);
  assert.deepEqual(github.removed, []);
  assert.match(core.warnings[0], /Reviewer cannot be requested/);
});

test('a close contributor carrying the unlinked label is not closed', async () => {
  const github = prGithub({
    issues: [{ ...unlinkedPr(42), user: { login: CLOSE_CONTRIBUTORS[0] } }],
  });

  assert.deepEqual(await sweepPrs(github), []);
  assert.deepEqual(github.commented, []);
  assert.deepEqual(github.closed, []);
});

test('a pull request since linked to an unassigned issue is closed for that', async () => {
  const github = prGithub({
    issues: [unlinkedPr(42)],
    linked: { 42: [{ number: 7, assignees: [] }] },
  });

  assert.deepEqual(await sweepPrs(github), [42]);
  assert.match(github.commented[0].body, /isn't assigned to you/);
});

test('an issue carrying the unlinked label is not swept', async () => {
  const github = prGithub({ issues: [{ number: 7, labels: [LABEL_UNLINKED] }] });

  assert.deepEqual(await sweepPrs(github), []);
  assert.deepEqual(github.commented, []);
});

test('a pull request whose links cannot be read is left open', async () => {
  const github = prGithub({ issues: [unlinkedPr(42)], graphqlFails: true });

  assert.deepEqual(await sweepPrs(github), []);
  assert.deepEqual(github.commented, []);
  assert.deepEqual(github.closed, []);
});
