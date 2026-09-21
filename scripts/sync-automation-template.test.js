const test = require('node:test');
const assert = require('node:assert/strict');

const { run, classifyDrift, BRANCH } = require('./sync-automation-template');

const TEMPLATE = 'name: Automation\non: {}\n';
const STALE = 'name: Automation\non: {old: true}\n';
const REGISTRY = { consumers: [{ repo: 'demo', base: 'main' }] };

const encode = (s) => Buffer.from(s, 'utf8').toString('base64');
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status, message) => ({ ok: false, status, data: { message } });

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

const baseRoutes = (copy) => [
  ['GET /repos/learningequality/.github/commits', ok([{ commit: { committer: { date: '2026-01-02T00:00:00Z' } } }])],
  ['GET contents/.github/workflows/automation.yml', ok({ sha: 'file-sha', content: encode(copy) })],
  ['GET /repos/learningequality/demo/pulls?state=open', ok([])],
  ['GET /repos/learningequality/demo/pulls?state=closed', ok([])],
  ['GET /repos/learningequality/demo/git/ref/heads/main', ok({ object: { sha: 'base-sha' } })],
  ['POST /repos/learningequality/demo/git/refs', ok({})],
  ['PUT /repos/learningequality/demo/contents', ok({})],
  ['POST /repos/learningequality/demo/pulls', ok({ number: 7, html_url: 'https://example.test/7' })],
  ['POST /repos/learningequality/demo/pulls/7/requested_reviewers', ok({})],
];

const only = async (routes, options = {}) => (await run(makeApi(routes), REGISTRY, TEMPLATE, options))[0];

test('a matching copy is in sync', async () => {
  assert.equal((await only(baseRoutes(TEMPLATE))).state, 'in-sync');
});

test('a drifted copy opens a pull request and requests the reviewer', async () => {
  const calls = [];
  const results = await run(makeApi(baseRoutes(STALE), calls), REGISTRY, TEMPLATE, {});
  assert.equal(results[0].state, 'opened');
  assert.equal(results[0].pr, 7);
  assert.ok(calls.some((c) => c.url.endsWith('/pulls/7/requested_reviewers')));
});

test('an open sync pull request is updated, not duplicated', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(STALE),
    ['GET /repos/learningequality/demo/pulls?state=open', ok([{ number: 3, html_url: 'https://example.test/3' }])],
  ];
  const results = await run(makeApi(routes, calls), REGISTRY, TEMPLATE, {});
  assert.equal(results[0].state, 'updated');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls')).length, 0);
});

test('a missing file in a readable repo is not-migrated', async () => {
  const routes = [
    ...baseRoutes(STALE),
    ['GET contents/.github/workflows/automation.yml', fail(404, 'Not Found')],
    ['GET =/repos/learningequality/demo', ok({ name: 'demo' })],
  ];
  assert.equal((await only(routes)).state, 'not-migrated');
});

test('a repo the token cannot see is an error, not not-migrated', async () => {
  const routes = [
    ...baseRoutes(STALE),
    ['GET contents/.github/workflows/automation.yml', fail(404, 'Not Found')],
    ['GET =/repos/learningequality/demo', fail(404, 'Not Found')],
  ];
  const result = await only(routes);
  assert.equal(result.state, 'error');
  assert.match(result.detail, /no access/);
});

test('a failed pull request listing is an error, not a missing pull request', async () => {
  const routes = [...baseRoutes(STALE), ['GET /repos/learningequality/demo/pulls?state=open', fail(403, 'Forbidden')]];
  const result = await only(routes);
  assert.equal(result.state, 'error');
  assert.match(result.detail, /could not list/);
});

test('a thrown request is contained and reported per repo', async () => {
  const api = async (method, url) => {
    if (url.includes('contents/')) throw new Error('socket hang up');
    return ok([]);
  };
  const results = await run(api, REGISTRY, TEMPLATE, {});
  assert.equal(results[0].state, 'error');
  assert.equal(results[0].detail, 'socket hang up');
});

test('dry run reports without writing', async () => {
  const calls = [];
  const results = await run(makeApi(baseRoutes(STALE), calls), REGISTRY, TEMPLATE, { dryRun: true });
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
  const results = await run(makeApi(routes, calls), REGISTRY, TEMPLATE, {});
  assert.equal(results[0].state, 'toolchain-conflict');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
});

test('a stale branch is reset to base when no pull request is open', async () => {
  const calls = [];
  const routes = [...baseRoutes(STALE), ['POST /repos/learningequality/demo/git/refs', fail(422, 'Reference exists')]];
  await run(makeApi(routes, calls), REGISTRY, TEMPLATE, {});
  const reset = calls.find((c) => c.method === 'PATCH' && c.url.endsWith(`/git/refs/heads/${BRANCH}`));
  assert.ok(reset, 'expected the branch to be reset');
  assert.equal(reset.body.sha, 'base-sha');
  assert.equal(reset.body.force, true);
});
