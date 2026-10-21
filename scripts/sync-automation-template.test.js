const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { PR_TEMPLATE_MARKER } = require('./constants');

const {
  run,
  classifyDrift,
  findConsumers,
  parseArgs,
  report,
  PROBLEM_STATES,
  BRANCH,
  PR_TEMPLATE_TARGET,
  TARGET_PATH,
} = require('./sync-automation-template');

const USES = 'jobs:\n  automation:\n    uses: learningequality/.github/.github/workflows/automation.yml@main\n';
const TEMPLATE = `name: Automation\non: {}\n${USES}`;
const STALE = `name: Automation\non: {old: true}\n${USES}`;
// Shaped like kolibri-design-system's, including the placeholder its own
// check-description job rejects.
const PR_TEMPLATE = [
  '<!-- Please remove any unused sections -->',
  '',
  '## Description',
  '',
  '<!-- describe the change -->',
  '',
  '#### Issue addressed',
  '',
  'Addresses #*PR# HERE*',
  '',
  '## Changelog',
  '',
  '  - **Description:** Summary of change(s)',
  '  - **Products impact:** Choose from - none / bugfix / new API',
  '  - **Breaking:** Choose from: yes / no',
  '',
  '## Steps to test',
  '',
  '1. Step 1',
  '2. Step 2',
  '',
].join('\n');
// The shared pull request template, which a consumer keeping none of its own takes.
// The first line is the marker that tells a copy of ours from a template of theirs.
const PR_SHARED = [
  '<!-- learningequality/.github shared pull request template. Edit it there, not in a copy. -->',
  '## Summary',
  '<!-- REQUIRED -->',
  '',
  '…',
  '',
].join('\n');

const SOURCES = { [TARGET_PATH]: TEMPLATE, [PR_TEMPLATE_TARGET]: PR_SHARED };

// Not "main": a default branch that differs is the only way to catch a hardcoded base.
const BASE = 'develop';
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
  ['GET contents/.github/PULL_REQUEST_TEMPLATE.md', ok({ sha: 'pr-sha', content: encode(PR_SHARED) })],
  ['GET /repos/learningequality/demo/pulls?state=open', ok([])],
  ['GET /repos/learningequality/demo/pulls?state=closed', ok([])],
  [`GET /repos/learningequality/demo/git/ref/heads/${BASE}`, ok({ object: { sha: 'base-sha' } })],
  ['POST /repos/learningequality/demo/git/refs', ok({})],
  ['PUT /repos/learningequality/demo/contents', ok({})],
  ['POST /repos/learningequality/demo/pulls', ok({ number: 7, html_url: 'https://example.test/7' })],
];

const only = async (routes, options = {}) => (await run(makeApi(routes), SOURCES, options))[0];

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
  await run(makeApi(baseRoutes(STALE), calls), SOURCES, {});
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.branch, BRANCH, 'must never write to a default branch');
  assert.equal(Buffer.from(put.body.content, 'base64').toString('utf8'), TEMPLATE);
});

test('the pull request targets the discovered default branch', async () => {
  const calls = [];
  await run(makeApi(baseRoutes(STALE), calls), SOURCES, {});
  const pr = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'));
  assert.equal(pr.body.base, BASE);
  assert.equal(pr.body.head, BRANCH);
});

// The repo whose check-description job forces the template path.
const CHECKED = 'kolibri-design-system';

const checkedRoutes = (copy) => [
  ...baseRoutes(copy, [repo({ name: CHECKED })]),
  [`GET /repos/learningequality/${CHECKED}/pulls?state=open`, ok([])],
  [`GET /repos/learningequality/${CHECKED}/pulls?state=closed`, ok([])],
  [`GET /repos/learningequality/${CHECKED}/git/ref/heads/${BASE}`, ok({ object: { sha: 'base-sha' } })],
  [`POST /repos/learningequality/${CHECKED}/git/refs`, ok({})],
  [`PUT /repos/learningequality/${CHECKED}/contents`, ok({})],
  [`POST /repos/learningequality/${CHECKED}/pulls`, ok({ number: 7, html_url: 'https://example.test/7' })],
  ['GET contents/.github/pull_request_template.md', ok({ content: encode(PR_TEMPLATE) })],
];

const bodyOf = (calls) => calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls')).body.body;

test('a repo that checks the description gets its own template, with every field answered', async () => {
  const calls = [];
  await run(makeApi(checkedRoutes(STALE), calls), SOURCES, {});
  const body = bodyOf(calls);
  assert.ok(body.startsWith('## Description'), 'the repo template decides the shape');
  assert.ok(!body.includes('Summary of change(s)'), 'the placeholder fails check-description');
  assert.match(body, /- \*\*Description:\*\* Internal: refresh the copied files/);
  assert.ok(body.includes('- **Breaking:** -'), 'a field we have no answer for gets a dash');
  assert.ok(!body.includes('yes / no'), 'instructions for a human author do not survive');
  assert.ok(body.includes('automation-template.yml'), 'our explanation is still there');
});

test('a renamed description heading still leaves the change explained', async () => {
  const calls = [];
  const renamed = PR_TEMPLATE.replace('## Description', '## Overview');
  const routes = [
    ...checkedRoutes(STALE),
    ['GET contents/.github/pull_request_template.md', ok({ content: encode(renamed) })],
  ];
  await run(makeApi(routes, calls), SOURCES, {});
  const body = bodyOf(calls);
  assert.ok(body.startsWith('This replaces'), 'the explanation must not go missing');
  assert.ok(body.includes('## Changelog'), 'a section that survived is kept, so their check still passes');
});

test('a template with none of the kept headings still explains itself', async () => {
  const calls = [];
  const routes = [
    ...checkedRoutes(STALE),
    ['GET contents/.github/pull_request_template.md', ok({ content: encode('## Notes\n\nnothing here\n') })],
  ];
  await run(makeApi(routes, calls), SOURCES, {});
  const body = bodyOf(calls);
  assert.ok(body.includes('automation-template.yml'), 'the body must never be empty');
  assert.ok(body.trim().length, 'a bare newline is not a pull request body');
});

test('sections that would arrive unfilled are dropped', async () => {
  const calls = [];
  await run(makeApi(checkedRoutes(STALE), calls), SOURCES, {});
  const body = bodyOf(calls);
  assert.ok(!body.includes('## Steps to test'), 'their template asks for unused sections to go');
  assert.ok(!body.includes('1. Step 1'));
  assert.ok(!body.includes('Addresses #'));
  assert.deepEqual(body.match(/^## .*/gm), ['## Description', '## Changelog']);
});

test('any other repo gets the plain explanation, template or not', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(STALE),
    ['GET contents/.github/pull_request_template.md', ok({ content: encode(PR_TEMPLATE) })],
  ];
  await run(makeApi(routes, calls), SOURCES, {});
  const body = bodyOf(calls);
  assert.ok(!body.includes('## Description'), 'only the repo that checks the description gets its template read');
  assert.ok(body.includes('automation-template.yml'));
});

test('a repo with no pull request template gets the plain explanation', async () => {
  const calls = [];
  await run(makeApi(baseRoutes(STALE), calls), SOURCES, {});
  const { body } = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls')).body;
  assert.ok(!body.includes('## '));
  assert.ok(body.includes('automation-template.yml'));
});

const putsTo = (calls, target) => calls.filter((c) => c.method === 'PUT' && c.url.includes(target));

// The lowercase spelling, which is a template of the repo's own rather than ours.
const ownTemplate = (content = PR_TEMPLATE) => [
  'GET contents/.github/pull_request_template.md',
  ok({ content: encode(content) }),
];

const noSharedTemplate = () => ['GET contents/.github/PULL_REQUEST_TEMPLATE.md', fail(404, 'Not Found')];

test('a consumer holding no template of its own takes the shared one', async () => {
  const calls = [];
  const routes = [...baseRoutes(TEMPLATE), noSharedTemplate()];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'opened');
  const put = putsTo(calls, PR_TEMPLATE_TARGET);
  assert.equal(put.length, 1);
  assert.equal(Buffer.from(put[0].body.content, 'base64').toString('utf8'), PR_SHARED);
  assert.equal(putsTo(calls, TARGET_PATH).length, 0, 'automation.yml already matches');
});

test('a consumer holding its own template keeps it', async () => {
  const calls = [];
  const routes = [...baseRoutes(TEMPLATE), ownTemplate(), noSharedTemplate()];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'in-sync');
  assert.equal(putsTo(calls, PR_TEMPLATE_TARGET).length, 0);
});

test('a candidate path that cannot be read counts as a template of its own', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(TEMPLATE),
    ['GET contents/docs/pull_request_template.md', fail(500, 'Server Error')],
    noSharedTemplate(),
  ];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'in-sync', 'a failed read must never overwrite a template it cannot see');
  assert.equal(putsTo(calls, PR_TEMPLATE_TARGET).length, 0);
});

test('the shared template is replaced when a copy of ours has drifted', async () => {
  const calls = [];
  const stale = PR_SHARED.replace('## Summary', '## Overview');
  const routes = [
    ...baseRoutes(TEMPLATE),
    ['GET contents/.github/PULL_REQUEST_TEMPLATE.md', ok({ sha: 'pr-sha', content: encode(stale) })],
  ];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'opened');
  const put = putsTo(calls, PR_TEMPLATE_TARGET);
  assert.equal(put.length, 1);
  assert.equal(put[0].body.sha, 'pr-sha', 'an update without the sha fails with a 422');
});

test('a template of their own at our path is left alone', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(TEMPLATE),
    // morango's shape: its own template sits at the path the sync writes to.
    ['GET contents/.github/PULL_REQUEST_TEMPLATE.md', ok({ sha: 'pr-sha', content: encode('## Summary\n') })],
  ];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'in-sync');
  assert.equal(putsTo(calls, PR_TEMPLATE_TARGET).length, 0, 'their template must never be overwritten');
});

test('both files drifted are written under one pull request', async () => {
  const calls = [];
  const routes = [...baseRoutes(STALE), noSharedTemplate()];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'opened');
  assert.equal(putsTo(calls, TARGET_PATH).length, 1);
  assert.equal(putsTo(calls, PR_TEMPLATE_TARGET).length, 1);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls')).length, 1);
});

test('an open sync pull request is updated in place, keeping the file sha', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(STALE),
    ['GET /repos/learningequality/demo/pulls?state=open', ok([{ number: 3, html_url: 'https://example.test/3' }])],
  ];
  const results = await run(makeApi(routes, calls), SOURCES, {});
  assert.equal(results[0].state, 'updated');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls')).length, 0);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.sha, 'file-sha', 'an update without the sha fails with a 422');
});

test('discovery skips archived repos and forks', async () => {
  const repos = [repo({ name: 'old', archived: true }), repo({ name: 'mirror', fork: true }), repo()];
  const results = await run(makeApi(baseRoutes(TEMPLATE, repos)), SOURCES, {});
  assert.deepEqual(
    results.map((r) => r.repo),
    ['demo']
  );
});

test('a repo with no copy is not a consumer', async () => {
  const routes = [...baseRoutes(TEMPLATE), ['GET contents/.github/workflows/automation.yml', fail(404, 'Not Found')]];
  const results = await run(makeApi(routes), SOURCES, {});
  assert.deepEqual(results, []);
});

test('a file that does not call the shared workflow is not a consumer', async () => {
  const routes = [
    ...baseRoutes(TEMPLATE),
    ['GET contents/.github/workflows/automation.yml', ok({ sha: 'x', content: encode('name: Something else\n') })],
  ];
  const results = await run(makeApi(routes), SOURCES, {});
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
  await assert.rejects(() => run(makeApi(routes), SOURCES, {}), /could not list the org's repos/);
});

test('a failed pull request listing is an error, not a missing pull request', async () => {
  const routes = [...baseRoutes(STALE), ['GET /repos/learningequality/demo/pulls?state=open', fail(403, 'Forbidden')]];
  const result = await only(routes);
  assert.equal(result.state, 'error');
  assert.match(result.detail, /could not list/);
});

test('a thrown request during the sync is contained and reported per repo', async () => {
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

test('a thrown request during discovery is contained, not fatal', async () => {
  const routes = [
    ...baseRoutes(STALE),
    [
      'GET contents/.github/workflows/automation.yml',
      () => {
        throw new Error('socket hang up');
      },
    ],
  ];
  const result = await only(routes);
  assert.equal(result.state, 'error', 'discovery runs before the per-repo try, so it needs its own');
  assert.equal(result.detail, 'socket hang up');
});

test('dry run reports without writing', async () => {
  const calls = [];
  const results = await run(makeApi(baseRoutes(STALE), calls), SOURCES, { dryRun: true });
  assert.equal(results[0].state, 'would-open');
  assert.equal(
    calls.filter((c) => c.method !== 'GET').length,
    0
  );
});

const MERGED = { merged_at: '2026-03-01T00:00:00Z', merge_commit_sha: 'm1' };
const CLOSED = { merged_at: null, head: { sha: 'h1' } };

test('classifyDrift: no prior pull request is ordinary drift', () => {
  assert.equal(classifyDrift(null, undefined, TEMPLATE), 'drift');
});

test('classifyDrift: a template published since the merge is ordinary drift', () => {
  assert.equal(classifyDrift(MERGED, STALE, TEMPLATE), 'drift');
});

test('classifyDrift: drift with the template unchanged since the merge is a toolchain conflict', () => {
  assert.equal(classifyDrift(MERGED, TEMPLATE, TEMPLATE), 'toolchain-conflict');
});

test('classifyDrift: a pull request closed unmerged is declined until the template moves', () => {
  assert.equal(classifyDrift(CLOSED, TEMPLATE, TEMPLATE), 'declined');
  assert.equal(classifyDrift(CLOSED, STALE, TEMPLATE), 'drift');
});

const mergedSync = (sha) => [
  'GET /repos/learningequality/demo/pulls?state=closed',
  ok([{ number: 9, merged_at: '2026-03-01T00:00:00Z', merge_commit_sha: sha }]),
];

// The copy at a given ref, so a test can say what the closed pull request left.
const atRef = (sha, content) => [
  `GET contents/.github/workflows/automation.yml?ref=${sha}`,
  ok({ sha: 'x', content: encode(content) }),
];

test('a repo that reverted a merged sync is reported, and no pull request is opened', async () => {
  const calls = [];
  const routes = [...baseRoutes(STALE), mergedSync('m1'), atRef('m1', TEMPLATE)];
  const results = await run(makeApi(routes, calls), SOURCES, {});
  assert.equal(results[0].state, 'toolchain-conflict', 'the merge left the template, so the consumer changed it');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
});

test('a template published after the merge is drift, whatever the commit dates say', async () => {
  const calls = [];
  // The case dates get wrong: a template whose commits predate the sync merge,
  // but which reached main after it, because the branch was merged later.
  const routes = [...baseRoutes(STALE), mergedSync('m1'), atRef('m1', STALE)];
  const results = await run(makeApi(routes, calls), SOURCES, {});
  assert.equal(results[0].state, 'opened', 'the merge left something older, so the template moved on');
});

test('a closed unmerged pull request is read at its head', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(STALE),
    ['GET /repos/learningequality/demo/pulls?state=closed', ok([{ number: 9, merged_at: null, head: { sha: 'h1' } }])],
    atRef('h1', TEMPLATE),
  ];
  const results = await run(makeApi(routes, calls), SOURCES, {});
  assert.equal(results[0].state, 'declined');
  assert.ok(
    calls.some((c) => c.url.includes('ref=h1')),
    'the head stays readable after the branch is reset'
  );
});

// The copy of the shared template at a given ref.
const prAtRef = (sha, content) => [
  `GET contents/.github/PULL_REQUEST_TEMPLATE.md?ref=${sha}`,
  ok({ sha: 'x', content: encode(content) }),
];

test('a declined template is not offered again when automation.yml drifts', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(STALE),
    noSharedTemplate(),
    ['GET /repos/learningequality/demo/pulls?state=closed', ok([{ number: 9, merged_at: null, head: { sha: 'h1' } }])],
    atRef('h1', STALE),
    prAtRef('h1', PR_SHARED),
  ];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'opened', 'automation.yml still moved on');
  assert.deepEqual(results[0].files, [TARGET_PATH]);
  assert.equal(putsTo(calls, PR_TEMPLATE_TARGET).length, 0, 'the maintainer already said no to this one');
});

test('a template deleted after the merge is left alone rather than failing every run', async () => {
  const calls = [];
  const routes = [
    ...baseRoutes(TEMPLATE),
    noSharedTemplate(),
    mergedSync('m1'),
    prAtRef('m1', PR_SHARED),
  ];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'toolchain-conflict');
  assert.deepEqual(results[0].files, [PR_TEMPLATE_TARGET]);
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
});

test('the first run after a merge offers a template the closed pull request never held', async () => {
  const calls = [];
  const routes = [...baseRoutes(STALE), noSharedTemplate(), mergedSync('m1'), atRef('m1', STALE)];
  const results = await run(makeApi(routes, calls), SOURCES, {});

  assert.equal(results[0].state, 'opened');
  assert.deepEqual(results[0].files, [TARGET_PATH, PR_TEMPLATE_TARGET]);
});

test('the shared template carries the marker the sync recognises its own copies by', () => {
  const real = fs.readFileSync(path.join(__dirname, '..', PR_TEMPLATE_TARGET), 'utf8');
  assert.ok(
    real.includes(PR_TEMPLATE_MARKER),
    'without it the sync reads every copy it placed as the consumer\'s own and stops refreshing them'
  );
});

test('report names the files a pull request carries', () => {
  const quiet = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    report([{ repo: 'demo', state: 'would-open', files: [TARGET_PATH, PR_TEMPLATE_TARGET] }]);
  } finally {
    console.log = quiet;
  }

  assert.match(lines[0], /automation\.yml/);
  assert.match(lines[0], /PULL_REQUEST_TEMPLATE\.md/);
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
  await run(makeApi(routes, calls), SOURCES, {});
  const reset = calls.find((c) => c.method === 'PATCH' && c.url.endsWith(`/git/refs/heads/${BRANCH}`));
  assert.ok(reset, 'expected the branch to be reset');
  assert.equal(reset.body.sha, 'base-sha');
  assert.equal(reset.body.force, true);
});

test('both spellings of --only are parsed, because an ignored one runs against everything', () => {
  assert.equal(parseArgs(['--only=demo']).only, 'demo');
  assert.equal(parseArgs(['--only', 'demo']).only, 'demo');
  assert.equal(parseArgs(['--dry-run', '--only', 'demo']).dryRun, true);
  assert.equal(parseArgs(['--dry-run']).only, undefined);
});

test('--only without a repo name is an error, not a full run', () => {
  assert.throws(() => parseArgs(['--only']), /needs a repo name/);
  assert.throws(() => parseArgs(['--only=']), /needs a repo name/);
  assert.throws(() => parseArgs(['--only', '--dry-run']), /needs a repo name/);
});

test('a named repo that is not a consumer says why, rather than reporting none', async () => {
  const cases = [
    [repo({ archived: true }), /archived/],
    [repo({ fork: true }), /a fork/],
  ];
  for (const [r, expected] of cases) {
    const routes = [...baseRoutes(TEMPLATE), ['GET =/repos/learningequality/demo', ok(r)]];
    await assert.rejects(() => run(makeApi(routes), SOURCES, { only: 'demo' }), expected);
  }
});

test('a named repo without the marker says why', async () => {
  const routes = [
    ...baseRoutes(TEMPLATE),
    ['GET =/repos/learningequality/demo', ok(repo())],
    ['GET contents/.github/workflows/automation.yml', ok({ sha: 'x', content: encode('name: other\n') })],
  ];
  await assert.rejects(() => run(makeApi(routes), SOURCES, { only: 'demo' }), /does not call the shared workflow/);
});

test('only limits the run to that repo, and never lists the org', async () => {
  const calls = [];
  const others = [repo({ name: 'demo' }), repo({ name: 'production-repo' })];
  const routes = [...baseRoutes(TEMPLATE, others), ['GET =/repos/learningequality/demo', ok(repo())]];
  const results = await run(makeApi(routes, calls), SOURCES, { only: 'demo' });
  assert.deepEqual(
    results.map((r) => r.repo),
    ['demo']
  );
  assert.ok(
    !calls.some((c) => c.url.includes('/orgs/')),
    'the org listing is the path to every other repo, so it must not be walked'
  );
});

test('without only, every repo in the listing is considered', async () => {
  const others = [repo({ name: 'demo' }), repo({ name: 'production-repo' })];
  const results = await run(makeApi(baseRoutes(TEMPLATE, others)), SOURCES, {});
  assert.deepEqual(
    results.map((r) => r.repo),
    ['demo', 'production-repo']
  );
});

test('only reports an error when the repo cannot be read', async () => {
  const routes = [...baseRoutes(TEMPLATE), ['GET =/repos/learningequality/missing', fail(404, 'Not Found')]];
  await assert.rejects(() => run(makeApi(routes), SOURCES, { only: 'missing' }), /could not read missing/);
});

test('findConsumers pages through the org listing', async () => {
  const calls = [];
  const many = Array.from({ length: 100 }, (_, i) => repo({ name: `r${i}` }));
  const routes = [
    ...baseRoutes(TEMPLATE, many),
    ['GET /orgs/learningequality/repos', (url) => ok(url.includes('page=2') ? [repo()] : many)],
  ];
  const consumers = await findConsumers(makeApi(routes, calls));
  assert.equal(consumers.length, 101);
  assert.ok(calls.some((c) => c.url.includes('page=2')));
});
