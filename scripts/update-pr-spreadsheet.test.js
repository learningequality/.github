const test = require('node:test');
const assert = require('node:assert/strict');

const { collectRows, planSheetChanges } = require('./update-pr-spreadsheet');

const core = { info() {}, warning() {}, setFailed() {} };
const context = { repo: { owner: 'learningequality', repo: '.github' } };

function pr(overrides = {}) {
  return {
    number: 1,
    merged_at: null,
    state: 'open',
    html_url: 'https://github.com/learningequality/kolibri/pull/1',
    user: { login: 'outsider' },
    title: 'Fix it',
    base: { repo: { name: 'kolibri' } },
    created_at: '2026-09-20T10:00:00Z',
    requested_reviewers: [{ login: 'reviewer' }],
    assignees: [{ login: 'assignee' }],
    author_association: 'CONTRIBUTOR',
    ...overrides,
  };
}

function searchItem(p) {
  return {
    number: p.number,
    user: p.user,
    author_association: p.author_association,
    repository_url: `https://api.github.com/repos/learningequality/${p.base.repo.name}`,
  };
}

function fakeGithub(prs) {
  const queries = [];
  const search = () => {};
  return {
    queries,
    rest: {
      search: { issuesAndPullRequests: search },
      pulls: {
        get: async ({ repo, pull_number }) => ({
          data: prs.find(p => p.base.repo.name === repo && p.number === pull_number),
        }),
      },
    },
    paginate: async (method, params) => {
      assert.equal(method, search);
      queries.push(params.q);
      return prs.map(searchItem);
    },
  };
}

test('only contributor PRs updated since the cutoff become rows', async () => {
  const github = fakeGithub([
    pr(),
    pr({ number: 2, user: { login: 'core-dev' }, author_association: 'MEMBER' }),
    pr({ number: 3, user: { login: 'dependabot[bot]' }, author_association: 'NONE' }),
    pr({ number: 4, user: { login: 'boss' }, author_association: 'OWNER' }),
  ]);

  const rows = await collectRows({ github, context, core }, '2026-09-23');

  assert.deepEqual(github.queries, [
    'org:learningequality is:pr is:public -repo:learningequality/test-actions updated:>=2026-09-23',
  ]);
  assert.deepEqual(rows, [
    [
      'open',
      'https://github.com/learningequality/kolibri/pull/1',
      'outsider',
      'Fix it',
      'kolibri',
      '2026-09-20',
      'reviewer',
      'assignee',
    ],
  ]);
});

test('a merged PR shows its merge date and a closed one shows closed', async () => {
  const github = fakeGithub([
    pr({ merged_at: '2026-09-24T08:00:00Z', state: 'closed' }),
    pr({
      number: 2,
      state: 'closed',
      html_url: 'https://github.com/learningequality/kolibri/pull/2',
    }),
  ]);

  const rows = await collectRows({ github, context, core }, '2026-09-23');

  assert.deepEqual(
    rows.map(r => r[0]),
    ['2026-09-24', 'closed'],
  );
});

test('changed cells of known PRs are updated and unknown PRs appended', () => {
  const existing = [
    ['Status', 'URL', 'Author', 'Title', 'Repo', 'Created', 'Reviewers', 'Assignees'],
    ['open', 'https://x/pull/1', 'a', 'Old title', 'kolibri', '2026-09-20', '', ''],
    ['open', 'https://x/pull/2', 'b', 'Same', 'studio', '2026-09-21', '', ''],
  ];
  const rows = [
    ['2026-09-24', 'https://x/pull/1', 'a', 'New title', 'kolibri', '2026-09-20', '', ''],
    ['open', 'https://x/pull/2', 'b', 'Same', 'studio', '2026-09-21', '', ''],
    ['open', 'https://x/pull/3', 'c', 'Brand new', 'kolibri', '2026-09-24', '', ''],
  ];

  const { updates, appends } = planSheetChanges(existing, rows, 'Sheet1');

  assert.deepEqual(updates, [
    { range: 'Sheet1!A2', values: [['2026-09-24']] },
    { range: 'Sheet1!D2', values: [['New title']] },
  ]);
  assert.deepEqual(appends, [rows[2]]);
});
