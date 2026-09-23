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

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'automation-template.yml');

const ORG = 'learningequality';
const TARGET_PATH = '.github/workflows/automation.yml';
const BRANCH = 'automation-template-sync';
const TITLE = 'Refresh automation.yml from the shared template';
const API = 'https://api.github.com';
const CONSUMER_MARKER = 'workflows/automation.yml@';

const PROBLEM_STATES = ['error', 'toolchain-conflict'];

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

const EXPLANATION = [
  `This replaces \`${TARGET_PATH}\` with the current \`automation-template.yml\` from`,
  `[${ORG}/.github](https://github.com/${ORG}/.github).`,
  '',
  'The file is generated. Do not edit this copy: edit `automation-registry.yml` upstream',
  'and regenerate, or the next sync will overwrite the change.',
  '',
  'Opened automatically. A core maintainer reviews and merges it.',
].join('\n');

const SUMMARY = 'Internal: refresh the copied automation.yml so it matches the current shared template';
const FIELD = /^([ \t]*-[ \t]*\*\*([^*]+?):\*\*).*$/gm;

function prBody(prTemplate, answers) {
  if (!prTemplate) return `${EXPLANATION}\n`;
  const filled = prTemplate.replace(FIELD, (line, prefix, field) => {
    const answer = answers[field.trim().toLowerCase()];
    return `${prefix} ${answer === undefined ? '-' : answer}`;
  });
  return `${filled.trimEnd()}\n\n---\n\n${EXPLANATION}\n`;
}

function detail(r) {
  return `${r.status} ${(r.data && r.data.message) || ''}`.trim();
}

// kolibri-design-system's check-description job needs a Changelog section whose
// Description is not the placeholder its template ships with.
const KDS_REPO = 'kolibri-design-system';
const KDS_TEMPLATE_ANSWERS = {
  description: SUMMARY,
  'products impact': 'none',
  addresses: '-',
  components: '-',
  breaking: '-',
  'impacts a11y': '-',
  guidance: '-',
};

const PR_TEMPLATE_PATHS = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md'];

async function readPrTemplate(api, repo, ref) {
  if (repo !== KDS_REPO) return null;
  for (const p of PR_TEMPLATE_PATHS) {
    const r = await api('GET', `/repos/${ORG}/${repo}/contents/${p}?ref=${ref}`);
    if (r.ok) return Buffer.from(r.data.content, 'base64').toString('utf8');
  }
  return null;
}

async function readCopy(api, repo, ref) {
  const r = await api('GET', `/repos/${ORG}/${repo}/contents/${TARGET_PATH}?ref=${ref}`);
  if (r.ok) return { sha: r.data.sha, content: Buffer.from(r.data.content, 'base64').toString('utf8') };
  if (r.status === 404) return { missing: true };
  return { error: `read failed (${detail(r)})` };
}

/**
 * Finds every repo in the org holding a copy of the template. Archived repos are
 * skipped because Actions do not run on them, and forks because their copy
 * belongs to the upstream repo.
 */
async function findConsumers(api) {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const r = await api('GET', `/orgs/${ORG}/repos?per_page=100&type=all&page=${page}`);
    if (!r.ok) throw new Error(`could not list the org's repos (${detail(r)})`);
    repos.push(...r.data);
    if (r.data.length < 100) break;
  }

  const consumers = [];
  for (const repo of repos) {
    if (repo.archived || repo.fork) continue;
    const copy = await readCopy(api, repo.name, repo.default_branch);
    if (copy.missing) continue;
    if (copy.error) {
      consumers.push({ repo: repo.name, base: repo.default_branch, unreadable: copy.error });
      continue;
    }
    // This repo's own reusable automation.yml sits at the same path and does not
    // call the shared workflow, so this excludes it without a special case.
    if (!copy.content.includes(CONSUMER_MARKER)) continue;
    consumers.push({ repo: repo.name, base: repo.default_branch });
  }
  return consumers;
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
  if (consumer.unreadable) return { repo, state: 'error', detail: consumer.unreadable };

  const copy = await readCopy(api, repo, base);
  if (copy.error) return { repo, state: 'error', detail: copy.error };
  if (copy.missing) return { repo, state: 'error', detail: 'the copy disappeared during the run' };
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
    body: prBody(await readPrTemplate(api, repo, base), KDS_TEMPLATE_ANSWERS),
  });
  if (!pr.ok) return { repo, state: 'error', detail: `pull request failed (${detail(pr)})` };
  return { repo, state: 'opened', pr: pr.data.number, url: pr.data.html_url };
}

async function run(api, template, options) {
  const change = await lastTemplateChange(api);
  if (change.failed) {
    console.log(`::warning::could not read the template history (${change.detail}); treating drift as ordinary`);
  }
  const templateChangedAt = change.date;
  const consumers = await findConsumers(api);

  const results = [];
  for (const consumer of consumers) {
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
    console.log(`${r.repo.padEnd(26)} ${r.state.padEnd(20)} ${extra}`);
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
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const results = await run(httpApi(token), template, { dryRun: process.argv.includes('--dry-run') });
  process.exit(report(results) ? 1 : 0);
}

if (require.main === module) main();

module.exports = { run, syncRepo, classifyDrift, findConsumers, report, PROBLEM_STATES, BRANCH, TARGET_PATH };
