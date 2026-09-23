const test = require('node:test');
const assert = require('node:assert/strict');

const { run, classifyDrift, findConsumers, report, PROBLEM_STATES, BRANCH } = require('./sync-automation-template');

const USES = 'jobs:\n  automation:\n    uses: learningequality/.github/.github/workflows/automation.yml@main\n';
const TEMPLATE = `name: Automation\non: {}\n${USES}`;
const STALE = `name: Automation\non: {old: true}\n${USES}`;
const TEMPLATE_BODY = '## Description\n\n{{explanation}}\n\n## Changelog\n\n  - **Description:** test\n';
// Not "main": a default branch that differs is the only way to catch a hardcoded base.
const BASE = 'develop';
const NO_OVERRIDES = { consumers: [] };

const encode = (s) => Buffer.from(s, 'utf8').toString('base64');
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status, message) => ({ ok: false, status, data: { message } });
const repo = (over = {}) => ({ name: 'demo', default_branch: BASE, archived: false, fork: false, ...over });

/**
 * Routes calls by method and a fragment of the path. Later entries win, so a
 * test can override one route and inherit the rest.
 */
function makeApi(routes, calls = []) {
  const ordered = [...routes].reverse();
  return async function api(method, url, body) {
    calls.push({ method, url, body });
    const route = ordered.find(([match]) => {
      const [m, fragment] = match.split(' ');
      if (m !== method) return false;
      // A leading "=" matches the whole path, so a repo route cannot also swallow
      // the longer URLs underneath it.
      return fragment.startsWith('=') ? url === fragment.slice(1) : url.includes(fragment);
    });
    if (!route) return fail(404, 'unrouted');
    return typeof route[1] === 'function' ? route[1](url, body) : route[1];
  };
}

const baseRoutes = (copy, repos = [repo()]) => [
  ['GET /repos/learningequality/.github/commits', ok([{ commit: { committer: { date: '2026-01-02T00:00:00Z' } } }])],
  ['GET /orgs/learningequality/repos', ok(repos)],
  ['GET contents/.github/workflows/automation.yml', ok({ sha: 'file-sha', content: encode(copy) })],
  ['GET /repos/learningequality/demo/pulls?state=open', ok([])],
  ['GET /repos/learningequality/demo/pulls?state=closed', ok([])],
  [`GET /repos/learningequality/demo/git/ref/heads/${BASE}`, ok({ object: { sha: 'base-sha' } })],
  ['POST /repos/learningequality/demo/git/refs', ok({})],
  ['PUT /repos/learningequality/demo/contents', ok({})],
  ['POST /repos/learningequality/demo/pulls', ok({ number: 7, html_url: 'https://example.test/7' })],
];

const only = async (routes, options = {}, registry = NO_OVERRIDES) =>
  (await run(makeApi(routes), registry, TEMPLATE, options))[0];

test('a matching copy is in sync', async () => {
  assert.equal((await only(baseRoutes(TEMPLATE))).state, 'in-sync');
});

test('a drifted copy opens a pull request', async () => {
  const result = await only(baseRoutes(STALE));
  assert.equal(result.state, 'opened');
  assert.equal(result.pr, 7);
});

test('the write targets the sync branch and carries the template', async () => {
  const calls = [];
  await run(makeApi(baseRoutes(STALE), calls), NO_OVERRIDES, TEMPLATE, {});
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.branch, BRANCH, 'must never write to a default branch');
  assert.equal(Buffer.from(put.body.content, 'base64').toString('utf8'), TEMPLATE);
});

test('the pull request targets the discovered default branch', async () => {
  const calls = [];
  await run(makeApi(baseRoutes(STALE), calls), NO_OVERRIDES, TEMPLATE, {});
  const pr = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'));
  assert.equal(pr.body.base, BASE);
  assert.equal(pr.body.head, BRANCH);
});

test('an override supplies the body template for that repo only', async () => {
  const calls = [];
  const registry = { consumers: [{ repo: 'demo', body_template: TEMPLATE_BODY }] };
  await run(makeApi(baseRoutes(STALE), calls), registry, TEMPLATE, {});
  const { body } = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls')).body;
  assert.ok(body.startsWith('## Description'), 'the repo template decides the order, not the script');
  assert.ok(body.includes('## Changelog'), 'KDS check-description needs the Changelog block');
  assert.ok(!body.includes('{{explanation}}'));
});

test('a consumer with no override gets the plain explanation', async () => {
  const calls = [];
  await run(makeApi(baseRoutes(STALE), calls), NO_OVERRIDES, TEMPLATE, {});
  const { body } = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls')).body;
  assert.ok(!body.includes('## '));
  assert.ok(body.includes('automation-template.yml'));
});

test('an open sync pull request is updated in place, keeping the file sha', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(STALE),
    ['GET /repos/learningequality/demo/pulls?state=open', ok([{ number: 3, html_url: 'https://example.test/3' }])],
  ];
  const results = await run(makeApi(routes, calls), NO_OVERRIDES, TEMPLATE, {});
  assert.equal(results[0].state, 'updated');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls')).length, 0);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.sha, 'file-sha', 'an update without the sha fails with a 422');
});

test('discovery skips archived repos and forks', async () => {
  const repos = [repo({ name: 'old', archived: true }), repo({ name: 'mirror', fork: true }), repo()];
  const results = await run(makeApi(baseRoutes(TEMPLATE, repos)), NO_OVERRIDES, TEMPLATE, {});
  assert.deepEqual(
    results.map((r) => r.repo),
    ['demo']
  );
});

test('a repo with no copy is not a consumer', async () => {
  const routes = [...baseRoutes(TEMPLATE), ['GET contents/.github/workflows/automation.yml', fail(404, 'Not Found')]];
  const results = await run(makeApi(routes), NO_OVERRIDES, TEMPLATE, {});
  assert.deepEqual(results, []);
});

test('a file that does not call the shared workflow is not a consumer', async () => {
  const routes = [
    ...baseRoutes(TEMPLATE),
    ['GET contents/.github/workflows/automation.yml', ok({ sha: 'x', content: encode('name: Something else\n') })],
  ];
  const results = await run(makeApi(routes), NO_OVERRIDES, TEMPLATE, {});
  assert.deepEqual(results, []);
});

test('a repo that cannot be read is reported, not skipped', async () => {
  const routes = [...baseRoutes(TEMPLATE), ['GET contents/.github/workflows/automation.yml', fail(500, 'Server Error')]];
  const result = await only(routes);
  assert.equal(result.state, 'error');
  assert.match(result.detail, /read failed/);
});

test('a failed repo listing stops the run loudly', async () => {
  const routes = [...baseRoutes(TEMPLATE), ['GET /orgs/learningequality/repos', fail(403, 'Forbidden')]];
  await assert.rejects(() => run(makeApi(routes), NO_OVERRIDES, TEMPLATE, {}), /could not list the org's repos/);
});

test('a failed pull request listing is an error, not a missing pull request', async () => {
  const routes = [...baseRoutes(STALE), ['GET /repos/learningequality/demo/pulls?state=open', fail(403, 'Forbidden')]];
  const result = await only(routes);
  assert.equal(result.state, 'error');
  assert.match(result.detail, /could not list/);
});

test('a thrown request is contained and reported per repo', async () => {
  const routes = [
    ...baseRoutes(STALE),
    [
      'GET /repos/learningequality/demo/pulls?state=open',
      () => {
        throw new Error('socket hang up');
      },
    ],
  ];
  const result = await only(routes);
  assert.equal(result.state, 'error');
  assert.equal(result.detail, 'socket hang up');
});

test('dry run reports without writing', async () => {
  const calls = [];
  const results = await run(makeApi(baseRoutes(STALE), calls), NO_OVERRIDES, TEMPLATE, { dryRun: true });
  assert.equal(results[0].state, 'would-open');
  assert.equal(
    calls.filter((c) => c.method !== 'GET').length,
    0
  );
});

test('classifyDrift: no prior pull request is ordinary drift', () => {
  assert.equal(classifyDrift(null, '2026-01-02T00:00:00Z'), 'drift');
});

test('classifyDrift: a template change after a merge is ordinary drift', () => {
  const merged = { merged_at: '2026-01-01T00:00:00Z', closed_at: '2026-01-01T00:00:00Z' };
  assert.equal(classifyDrift(merged, '2026-02-01T00:00:00Z'), 'drift');
});

test('classifyDrift: drift with no template change after a merge is a toolchain conflict', () => {
  const merged = { merged_at: '2026-03-01T00:00:00Z', closed_at: '2026-03-01T00:00:00Z' };
  assert.equal(classifyDrift(merged, '2026-01-01T00:00:00Z'), 'toolchain-conflict');
});

test('classifyDrift: a pull request closed unmerged is declined until the template moves', () => {
  const closed = { merged_at: null, closed_at: '2026-03-01T00:00:00Z' };
  assert.equal(classifyDrift(closed, '2026-01-01T00:00:00Z'), 'declined');
  assert.equal(classifyDrift(closed, '2026-04-01T00:00:00Z'), 'drift');
});

test('a repo that reverted a merged sync is reported, and no pull request is opened', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(STALE),
    [
      'GET /repos/learningequality/demo/pulls?state=closed',
      ok([{ number: 9, merged_at: '2026-03-01T00:00:00Z', closed_at: '2026-03-01T00:00:00Z' }]),
    ],
  ];
  const results = await run(makeApi(routes, calls), NO_OVERRIDES, TEMPLATE, {});
  assert.equal(results[0].state, 'toolchain-conflict');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
});

test('an unreadable template history proposes rather than stopping the repo', async () => {
  const routes = [
    ...baseRoutes(STALE),
    ['GET /repos/learningequality/.github/commits', fail(502, 'Bad Gateway')],
    [
      'GET /repos/learningequality/demo/pulls?state=closed',
      ok([{ number: 9, merged_at: '2026-03-01T00:00:00Z', closed_at: '2026-03-01T00:00:00Z' }]),
    ],
  ];
  const result = await only(routes);
  assert.equal(result.state, 'opened', 'a 502 must not read as a toolchain conflict');
});

test('report counts only the states that stop a merge', () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const problems = report([
      { repo: 'a', state: 'in-sync' },
      { repo: 'b', state: 'opened', pr: 1 },
      { repo: 'c', state: 'declined', pr: 2 },
      { repo: 'd', state: 'error', detail: 'no access' },
      { repo: 'e', state: 'toolchain-conflict', pr: 3 },
    ]);
    assert.equal(problems, 2, 'error and toolchain-conflict each need attention');
  } finally {
    console.log = quiet;
  }
});

test('the set of problem states is closed', () => {
  assert.deepEqual(
    [...PROBLEM_STATES].sort(),
    ['error', 'toolchain-conflict'],
    'adding a state here turns the weekly run red for repos that were passing, so change it deliberately and cover it in the report test above'
  );
});

test('a stale branch is reset to base when no pull request is open', async () => {
  const calls = [];
  const routes = [...baseRoutes(STALE), ['POST /repos/learningequality/demo/git/refs', fail(422, 'Reference exists')]];
  await run(makeApi(routes, calls), NO_OVERRIDES, TEMPLATE, {});
  const reset = calls.find((c) => c.method === 'PATCH' && c.url.endsWith(`/git/refs/heads/${BRANCH}`));
  assert.ok(reset, 'expected the branch to be reset');
  assert.equal(reset.body.sha, 'base-sha');
  assert.equal(reset.body.force, true);
});

test('findConsumers pages through the org listing', async () => {
  const calls = [];
  const many = Array.from({ length: 100 }, (_, i) => repo({ name: `r${i}` }));
  const routes = [
    ...baseRoutes(TEMPLATE, many),
    ['GET /orgs/learningequality/repos', (url) => ok(url.includes('page=2') ? [repo()] : many)],
  ];
  const consumers = await findConsumers(makeApi(routes, calls), {});
  assert.equal(consumers.length, 101);
  assert.ok(calls.some((c) => c.url.includes('page=2')));
});
