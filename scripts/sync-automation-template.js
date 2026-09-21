#!/usr/bin/env node
/**
 * Opens one pull request per consumer repo whose copy of automation.yml has
 * drifted from automation-template.yml.
 *
 * Usage:
 *   node scripts/sync-automation-template.js           open or update pull requests
 *   node scripts/sync-automation-template.js --dry-run report only, change nothing
 *
 * Requires GITHUB_TOKEN with contents:write and pull-requests:write on each
 * consumer repo. It never commits to a default branch and never merges.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'automation-registry.yml');
const TEMPLATE_PATH = path.join(ROOT, 'automation-template.yml');

const ORG = 'learningequality';
const TARGET_PATH = '.github/workflows/automation.yml';
const BRANCH = 'automation-template-sync';
const TITLE = 'Refresh automation.yml from the shared template';
const REVIEWER = 'rtibblesbot';
const API = 'https://api.github.com';

const PROBLEM_STATES = ['error', 'toolchain-conflict', 'not-migrated'];

function httpApi(token) {
  return async function api(method, url, body) {
    const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    // A gateway error answers with an HTML page, so parsing has to be able to fail.
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, data };
  };
}

function prBody(consumer) {
  const explanation = [
    `This replaces \`${TARGET_PATH}\` with the current \`automation-template.yml\` from`,
    `[${ORG}/.github](https://github.com/${ORG}/.github).`,
    '',
    'The file is generated. Do not edit this copy: edit `automation-registry.yml` upstream',
    'and regenerate, or the next sync will overwrite the change.',
    '',
    'Opened automatically. A core maintainer reviews and merges it.',
  ].join('\n');
  return consumer.body_prefix ? `${consumer.body_prefix.trimEnd()}\n\n${explanation}\n` : `${explanation}\n`;
}

function detail(r) {
  return `${r.status} ${(r.data && r.data.message) || ''}`.trim();
}

async function readCopy(api, repo, ref) {
  const r = await api('GET', `/repos/${ORG}/${repo}/contents/${TARGET_PATH}?ref=${ref}`);
  if (r.ok) return { sha: r.data.sha, content: Buffer.from(r.data.content, 'base64').toString('utf8') };
  // A repo the token cannot see answers 404, exactly like a missing file, so ask
  // whether the repo itself is readable before calling the file missing.
  if (r.status === 404) {
    const probe = await api('GET', `/repos/${ORG}/${repo}`);
    return probe.ok ? { missing: true } : { error: `no access to ${repo} (${detail(probe)})` };
  }
  return { error: `read failed (${detail(r)})` };
}

async function lastTemplateChange(api) {
  try {
    const r = await api('GET', `/repos/${ORG}/.github/commits?path=automation-template.yml&per_page=1`);
    if (!r.ok) return { date: null, failed: true, detail: detail(r) };
    if (!r.data.length) return { date: null, failed: false };
    return { date: r.data[0].commit.committer.date, failed: false };
  } catch (err) {
    return { date: null, failed: true, detail: err.message };
  }
}

async function openSyncPr(api, repo) {
  const r = await api('GET', `/repos/${ORG}/${repo}/pulls?state=open&head=${ORG}:${BRANCH}`);
  if (!r.ok) return { error: `could not list pull requests (${detail(r)})` };
  return { pr: r.data.length ? r.data[0] : null };
}

async function lastClosedSyncPr(api, repo) {
  const r = await api(
    'GET',
    `/repos/${ORG}/${repo}/pulls?state=closed&head=${ORG}:${BRANCH}&sort=updated&direction=desc&per_page=1`
  );
  if (!r.ok) return { error: `could not list closed pull requests (${detail(r)})` };
  return { pr: r.data.length ? r.data[0] : null };
}

/**
 * Decides what a drifted copy means, given the last closed sync pull request.
 * A template change after that pull request closed is ordinary drift. With no
 * such change, a merged pull request means the consumer reverted the file, and a
 * closed one means a maintainer declined it.
 *
 * An unknown template date resolves to drift. A needless pull request costs one
 * review, where a wrong toolchain-conflict stops syncing the repo entirely.
 */
function classifyDrift(closedPr, templateChangedAt) {
  if (!closedPr || !templateChangedAt) return 'drift';
  const closedAt = closedPr.merged_at || closedPr.closed_at;
  if (!closedAt) return 'drift';
  if (new Date(templateChangedAt) > new Date(closedAt)) return 'drift';
  return closedPr.merged_at ? 'toolchain-conflict' : 'declined';
}

async function syncRepo(api, consumer, template, { dryRun, templateChangedAt }) {
  const { repo, base } = consumer;
  const copy = await readCopy(api, repo, base);

  if (copy.error) return { repo, state: 'error', detail: copy.error };
  if (copy.missing) return { repo, state: 'not-migrated' };
  if (copy.content === template) return { repo, state: 'in-sync' };

  const open = await openSyncPr(api, repo);
  if (open.error) return { repo, state: 'error', detail: open.error };

  if (!open.pr) {
    const closed = await lastClosedSyncPr(api, repo);
    if (closed.error) return { repo, state: 'error', detail: closed.error };
    const verdict = classifyDrift(closed.pr, templateChangedAt);
    if (verdict !== 'drift') return { repo, state: verdict, pr: closed.pr.number };
  }

  if (dryRun) {
    return { repo, state: open.pr ? 'would-update' : 'would-open', pr: open.pr && open.pr.number };
  }

  const baseRef = await api('GET', `/repos/${ORG}/${repo}/git/ref/heads/${base}`);
  if (!baseRef.ok) return { repo, state: 'error', detail: `base ${base} not found (${detail(baseRef)})` };
  const baseSha = baseRef.data.object.sha;

  if (!open.pr) {
    const made = await api('POST', `/repos/${ORG}/${repo}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: baseSha });
    if (!made.ok && made.status === 422) {
      // The branch outlives a closed pull request, so start it again from base
      // rather than carrying commits a maintainer already saw.
      const reset = await api('PATCH', `/repos/${ORG}/${repo}/git/refs/heads/${BRANCH}`, { sha: baseSha, force: true });
      if (!reset.ok) return { repo, state: 'error', detail: `branch reset failed (${detail(reset)})` };
    } else if (!made.ok) {
      return { repo, state: 'error', detail: `branch failed (${detail(made)})` };
    }
  }

  const onBranch = await readCopy(api, repo, BRANCH);
  if (onBranch.error) return { repo, state: 'error', detail: onBranch.error };

  const put = await api('PUT', `/repos/${ORG}/${repo}/contents/${TARGET_PATH}`, {
    message: TITLE,
    content: Buffer.from(template, 'utf8').toString('base64'),
    branch: BRANCH,
    ...(onBranch.sha ? { sha: onBranch.sha } : {}),
  });
  if (!put.ok) return { repo, state: 'error', detail: `write failed (${detail(put)})` };

  if (open.pr) return { repo, state: 'updated', pr: open.pr.number, url: open.pr.html_url };

  const pr = await api('POST', `/repos/${ORG}/${repo}/pulls`, {
    title: TITLE,
    head: BRANCH,
    base,
    body: prBody(consumer),
  });
  if (!pr.ok) return { repo, state: 'error', detail: `pull request failed (${detail(pr)})` };

  const review = await api('POST', `/repos/${ORG}/${repo}/pulls/${pr.data.number}/requested_reviewers`, {
    reviewers: [REVIEWER],
  });
  return { repo, state: 'opened', pr: pr.data.number, url: pr.data.html_url, reviewerFailed: !review.ok };
}

async function run(api, registry, template, options) {
  const change = await lastTemplateChange(api);
  if (change.failed) {
    console.log(`::warning::could not read the template history (${change.detail}); treating drift as ordinary`);
  }
  const templateChangedAt = change.date;
  const results = [];
  for (const consumer of registry.consumers) {
    try {
      results.push(await syncRepo(api, consumer, template, { ...options, templateChangedAt }));
    } catch (err) {
      results.push({ repo: consumer.repo, state: 'error', detail: err.message });
    }
  }
  return results;
}

function report(results) {
  for (const r of results) {
    const extra = r.url || r.detail || (r.pr ? `#${r.pr}` : '');
    const note = r.reviewerFailed ? `  (could not request ${REVIEWER})` : '';
    console.log(`${r.repo.padEnd(26)} ${r.state.padEnd(20)} ${extra}${note}`);
  }
  const problems = results.filter((r) => PROBLEM_STATES.includes(r.state));
  const drifted = results.filter((r) => r.state !== 'in-sync');
  console.log(`\n${results.length} consumers, ${drifted.length} not in sync, ${problems.length} needing attention.`);
  for (const p of problems) {
    console.log(`::error title=${p.repo}::${p.state}${p.detail ? `: ${p.detail}` : ''}`);
  }
  return problems.length;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is not set.');
    process.exit(1);
  }
  const registry = yaml.load(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const results = await run(httpApi(token), registry, template, { dryRun: process.argv.includes('--dry-run') });
  process.exit(report(results) ? 1 : 0);
}

if (require.main === module) main();

module.exports = { run, syncRepo, classifyDrift, report, PROBLEM_STATES, BRANCH, REVIEWER, TARGET_PATH };
