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

const dryRun = process.argv.includes('--dry-run');
const token = process.env.GITHUB_TOKEN;

async function api(method, url, body) {
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
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data };
}

function body(consumer) {
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

async function currentCopy(repo, ref) {
  const r = await api('GET', `/repos/${ORG}/${repo}/contents/${TARGET_PATH}?ref=${ref}`);
  if (r.status === 404) return { missing: true };
  if (!r.ok) return { error: `read failed (${r.status}) ${r.data && r.data.message}` };
  return { sha: r.data.sha, content: Buffer.from(r.data.content, 'base64').toString('utf8') };
}

async function openSyncPr(repo) {
  const r = await api('GET', `/repos/${ORG}/${repo}/pulls?state=open&head=${ORG}:${BRANCH}`);
  return r.ok && r.data.length ? r.data[0] : null;
}

// A sync pull request that merged, followed by the file drifting again, means the
// repo's own tooling rewrites the copy. Reopening would loop, so report instead.
async function revertedAfterMerge(repo) {
  const r = await api('GET', `/repos/${ORG}/${repo}/pulls?state=closed&head=${ORG}:${BRANCH}&per_page=1`);
  if (!r.ok || !r.data.length) return false;
  return Boolean(r.data[0].merged_at);
}

async function syncRepo(consumer, template) {
  const { repo, base } = consumer;
  const copy = await currentCopy(repo, base);

  if (copy.error) return { repo, state: 'error', detail: copy.error };
  if (copy.missing) return { repo, state: 'not-migrated' };
  if (copy.content === template) return { repo, state: 'in-sync' };

  const existing = await openSyncPr(repo);
  if (!existing && (await revertedAfterMerge(repo))) {
    return { repo, state: 'toolchain-conflict' };
  }
  if (dryRun) return { repo, state: existing ? 'would-update' : 'would-open', pr: existing && existing.number };

  const baseRef = await api('GET', `/repos/${ORG}/${repo}/git/ref/heads/${base}`);
  if (!baseRef.ok) return { repo, state: 'error', detail: `base ${base} not found` };

  if (!existing) {
    const made = await api('POST', `/repos/${ORG}/${repo}/git/refs`, {
      ref: `refs/heads/${BRANCH}`,
      sha: baseRef.data.object.sha,
    });
    if (!made.ok && made.status !== 422) {
      return { repo, state: 'error', detail: `branch failed (${made.status}) ${made.data && made.data.message}` };
    }
  }

  const onBranch = await currentCopy(repo, BRANCH);
  const put = await api('PUT', `/repos/${ORG}/${repo}/contents/${TARGET_PATH}`, {
    message: TITLE,
    content: Buffer.from(template, 'utf8').toString('base64'),
    branch: BRANCH,
    ...(onBranch.sha ? { sha: onBranch.sha } : {}),
  });
  if (!put.ok) {
    return { repo, state: 'error', detail: `write failed (${put.status}) ${put.data && put.data.message}` };
  }

  if (existing) return { repo, state: 'updated', pr: existing.number, url: existing.html_url };

  const pr = await api('POST', `/repos/${ORG}/${repo}/pulls`, {
    title: TITLE,
    head: BRANCH,
    base,
    body: body(consumer),
  });
  if (!pr.ok) {
    return { repo, state: 'error', detail: `pull request failed (${pr.status}) ${pr.data && pr.data.message}` };
  }

  const review = await api('POST', `/repos/${ORG}/${repo}/pulls/${pr.data.number}/requested_reviewers`, {
    reviewers: [REVIEWER],
  });
  return {
    repo,
    state: 'opened',
    pr: pr.data.number,
    url: pr.data.html_url,
    reviewerFailed: !review.ok,
  };
}

async function main() {
  if (!token) {
    console.error('GITHUB_TOKEN is not set.');
    process.exit(1);
  }
  const registry = yaml.load(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  const results = [];
  for (const consumer of registry.consumers) {
    results.push(await syncRepo(consumer, template));
  }

  for (const r of results) {
    const extra = r.url || r.detail || (r.pr ? `#${r.pr}` : '');
    const note = r.reviewerFailed ? `  (could not request ${REVIEWER})` : '';
    console.log(`${r.repo.padEnd(26)} ${r.state.padEnd(20)} ${extra}${note}`);
  }

  const problems = results.filter((r) => r.state === 'error' || r.state === 'toolchain-conflict');
  const drifted = results.filter((r) => r.state !== 'in-sync');

  console.log(`\n${results.length} consumers, ${drifted.length} not in sync, ${problems.length} needing attention.`);
  for (const p of problems) {
    console.log(`::error title=${p.repo}::${p.state}${p.detail ? `: ${p.detail}` : ''}`);
  }
  process.exit(problems.length ? 1 : 0);
}

main();
