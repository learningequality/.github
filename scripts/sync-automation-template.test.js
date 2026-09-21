const test = require('node:test');
const assert = require('node:assert/strict');

const { run, classifyDrift, report, PROBLEM_STATES, BRANCH, REVIEWER } = require('./sync-automation-template');

const TEMPLATE = 'name: Automation\non: {}\n';
const STALE = 'name: Automation\non: {old: true}\n';
const TEMPLATE_BODY = '## Description\n\n{{explanation}}\n\n## Changelog\n\n  - **Description:** test\n';
// Not "main": five of the eight real consumers target something else, so a
// fixture on main cannot catch a hardcoded base.
const BASE = 'develop';
const REGISTRY = { consumers: [{ repo: 'demo', base: BASE }] };

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
  [`GET /repos/learningequality/demo/git/ref/heads/${BASE}`, ok({ object: { sha: 'base-sha' } })],
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

test('the write targets the sync branch and carries the template', async () => {
  const calls = [];
  await run(makeApi(baseRoutes(STALE), calls), REGISTRY, TEMPLATE, {});
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.branch, BRANCH, 'must never write to a default branch');
  assert.equal(Buffer.from(put.body.content, 'base64').toString('utf8'), TEMPLATE);
});

test('the pull request targets the consumer base and names the reviewer', async () => {
  const calls = [];
  await run(makeApi(baseRoutes(STALE), calls), REGISTRY, TEMPLATE, {});
  const pr = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'));
  assert.equal(pr.body.base, BASE);
  const review = calls.find((c) => c.url.endsWith('/requested_reviewers'));
  assert.deepEqual(review.body.reviewers, [REVIEWER]);
});

test('a body_template keeps its own shape and receives the explanation', async () => {
  const calls = [];
  const registry = { consumers: [{ repo: 'demo', base: BASE, body_template: TEMPLATE_BODY }] };
  await run(makeApi(baseRoutes(STALE), calls), registry, TEMPLATE, {});
  const { body } = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls')).body;
  assert.ok(body.startsWith('## Description'), 'the repo template decides the order, not the script');
  assert.ok(body.includes('## Changelog'), 'KDS check-description needs the Changelog block');
  assert.ok(body.includes('automation-template.yml'), 'the explanation must replace the placeholder');
  assert.ok(!body.includes('{{explanation}}'));
  assert.ok(body.indexOf('## Description') < body.indexOf('## Changelog'));
});

test('a consumer with no template gets the plain explanation', async () => {
  const calls = [];
  await run(makeApi(baseRoutes(STALE), calls), REGISTRY, TEMPLATE, {});
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
  const results = await run(makeApi(routes, calls), REGISTRY, TEMPLATE, {});
  assert.equal(results[0].state, 'updated');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls')).length, 0);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.sha, 'file-sha', 'an update without the sha fails with a 422');
  assert.equal(put.body.branch, BRANCH);
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

test('an unreadable template history proposes rather than stopping the repo', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(STALE),
    ['GET /repos/learningequality/.github/commits', fail(502, 'Bad Gateway')],
    [
      'GET /repos/learningequality/demo/pulls?state=closed',
      ok([{ number: 9, merged_at: '2026-03-01T00:00:00Z', closed_at: '2026-03-01T00:00:00Z' }]),
    ],
  ];
  const results = await run(makeApi(routes, calls), REGISTRY, TEMPLATE, {});
  assert.equal(results[0].state, 'opened', 'a 502 must not read as a toolchain conflict');
});

test('a thrown template history request does not kill the run', async () => {
  const routes = [
    ...baseRoutes(STALE),
    [
      'GET /repos/learningequality/.github/commits',
      () => {
        throw new Error('socket hang up');
      },
    ],
  ];
  const results = await run(makeApi(routes), REGISTRY, TEMPLATE, {});
  assert.equal(results[0].state, 'opened');
});

test('report counts only the states that stop a merge', () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const problems = report([
      { repo: 'a', state: 'in-sync' },
      { repo: 'b', state: 'opened', pr: 1 },
      { repo: 'c', state: 'declined', pr: 2 },
      { repo: 'd', state: 'not-migrated' },
      { repo: 'e', state: 'error', detail: 'no access' },
      { repo: 'f', state: 'toolchain-conflict', pr: 3 },
    ]);
    assert.equal(problems, 3, 'not-migrated, error and toolchain-conflict each need attention');
  } finally {
    console.log = quiet;
  }
});

test('the set of problem states is closed', () => {
  assert.deepEqual(
    [...PROBLEM_STATES].sort(),
    ['error', 'not-migrated', 'toolchain-conflict'],
    'adding a state here turns the weekly run red for repos that were passing, so change it deliberately and cover it in the report test above'
  );
});

test('a failed reviewer request is noted but does not fail the run', () => {
  const lines = [];
  const quiet = console.log;
  console.log = (line) => lines.push(line);
  try {
    const problems = report([{ repo: 'a', state: 'opened', pr: 1, reviewerFailed: true }]);
    assert.equal(problems, 0);
    assert.ok(lines.some((l) => l.includes(REVIEWER)));
  } finally {
    console.log = quiet;
  }
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
