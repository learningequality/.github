#!/usr/bin/env node
/**
 * Opens one pull request per consumer repo whose copy of a shared file has
 * drifted from this repo's. The shared files are automation-template.yml, which
 * every consumer takes, and the pull request template, which only a consumer
 * holding none of its own takes.
 *
 * Usage:
 *   node scripts/sync-automation-template.js             open or update pull requests
 *   node scripts/sync-automation-template.js --dry-run   report only, change nothing
 *   node scripts/sync-automation-template.js --only=repo limit the run to one repo
 *
 * Requires GITHUB_TOKEN with contents:write and pull-requests:write on each
 * consumer repo. It never commits to a default branch and never merges.
 */
const fs = require('fs');
const path = require('path');

const { PR_TEMPLATE_PATHS, PR_TEMPLATE_TARGET, PR_TEMPLATE_MARKER } = require('./constants');

const ROOT = path.join(__dirname, '..');

// SYNC_ORG points the whole run at another org, so the write path can be
// exercised somewhere other than production.
const ORG = process.env.SYNC_ORG || 'learningequality';
const TARGET_PATH = '.github/workflows/automation.yml';
const BRANCH = 'automation-template-sync';
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

const UPSTREAM_NOTE = {
  [TARGET_PATH]: 'edit `automation-registry.yml` upstream and regenerate `automation-template.yml`',
  [PR_TEMPLATE_TARGET]: 'edit the shared template upstream',
};

function explanation(targets) {
  const named = targets.map(target => `\`${target}\``).join(' and ');
  return [
    `This replaces ${named} with the current copy from`,
    `[${ORG}/.github](https://github.com/${ORG}/.github).`,
    '',
    ...targets.map(
      target => `Do not edit \`${target}\` here: ${UPSTREAM_NOTE[target]}, or the next sync will overwrite the change.`
    ),
    '',
    'Opened automatically. A core maintainer reviews and merges it.',
  ].join('\n');
}

function title(targets) {
  return `Refresh ${targets.map((target) => path.basename(target)).join(' and ')} from the shared template`;
}

const SUMMARY = 'Internal: refresh the copied files so they match the current shared ones';
const FIELD = /^([ \t]*-[ \t]*\*\*([^*]+?):\*\*).*$/gm;

// Splits on level-two headings only, so a deeper heading stays inside its section.
function sections(markdown) {
  const out = [];
  for (const line of markdown.split('\n')) {
    if (/^## [^#]/.test(line)) out.push({ heading: line.trim(), lines: [] });
    else if (out.length) out[out.length - 1].lines.push(line);
  }
  return out;
}

function prBody(prTemplate, { keep, describe, answers }, targets) {
  const EXPLANATION = explanation(targets);
  if (!prTemplate) return `${EXPLANATION}\n`;
  const kept = sections(prTemplate).filter((s) => keep.includes(s.heading));
  const parts = kept.map((s) => {
    if (s.heading === describe) return `${s.heading}\n\n${EXPLANATION}`;
    const filled = s.lines.join('\n').replace(FIELD, (line, prefix, field) => {
      const answer = answers[field.trim().toLowerCase()];
      return `${prefix} ${answer === undefined ? '-' : answer}`;
    });
    return `${s.heading}\n${filled.trimEnd()}`;
  });
  // A renamed heading would otherwise leave the pull request unexplained, or empty.
  if (!kept.some((s) => s.heading === describe)) parts.unshift(EXPLANATION);
  return `${parts.join('\n\n').trimEnd()}\n`;
}

function detail(r) {
  return `${r.status} ${(r.data && r.data.message) || ''}`.trim();
}

// kolibri-design-system's check-description job needs a Changelog section whose
// Description is not the placeholder its template ships with.
// Its template opens with "Please remove any unused sections", so only the two
// that carry content are kept.
const KDS_REPO = 'kolibri-design-system';
const KDS_TEMPLATE = {
  keep: ['## Description', '## Changelog'],
  describe: '## Description',
  answers: {
    description: SUMMARY,
    'products impact': 'none',
    addresses: '-',
    components: '-',
    breaking: '-',
    'impacts a11y': '-',
    guidance: '-',
  },
};

/**
 * The files carried to a consumer. `mustExist` says the consumer already holds
 * one, so a missing file is a fault rather than work to do. `ownStops` says a
 * consumer that holds its own copy keeps it.
 */
const SYNCED_FILES = [
  { target: TARGET_PATH, source: 'automation-template.yml', mustExist: true },
  { target: PR_TEMPLATE_TARGET, source: PR_TEMPLATE_TARGET, ownStops: true },
];

async function readPrTemplate(api, repo, ref) {
  if (repo !== KDS_REPO) return null;
  for (const p of PR_TEMPLATE_PATHS) {
    const r = await api('GET', `/repos/${ORG}/${repo}/contents/${p}?ref=${ref}`);
    if (r.ok) return Buffer.from(r.data.content, 'base64').toString('utf8');
  }
  return null;
}

/**
 * Whether the consumer keeps a pull request template of its own, in any of the
 * places GitHub reads one from. An unreadable path counts as one, so a failed
 * read never overwrites a template this run could not see.
 *
 * morango's own template sits at PR_TEMPLATE_TARGET, the path the sync writes
 * to, so at that one path existence cannot tell a copy of ours from theirs. A
 * copy of ours carries PR_TEMPLATE_MARKER.
 */
async function keepsOwnPrTemplate(api, repo, ref) {
  for (const p of PR_TEMPLATE_PATHS) {
    const r = await api('GET', `/repos/${ORG}/${repo}/contents/${p}?ref=${ref}`);
    if (r.status === 404) continue;
    if (!r.ok) return true;
    if (p !== PR_TEMPLATE_TARGET) return true;
    if (!Buffer.from(r.data.content, 'base64').toString('utf8').includes(PR_TEMPLATE_MARKER)) return true;
  }
  return false;
}

async function readFile(api, repo, filePath, ref) {
  const r = await api('GET', `/repos/${ORG}/${repo}/contents/${filePath}?ref=${ref}`);
  if (r.ok) return { sha: r.data.sha, content: Buffer.from(r.data.content, 'base64').toString('utf8') };
  if (r.status === 404) return { missing: true };
  return { error: `read failed (${detail(r)})` };
}

async function readCopy(api, repo, ref) {
  return readFile(api, repo, TARGET_PATH, ref);
}

/**
 * Finds every repo in the org holding a copy of the template. Archived repos are
 * skipped because Actions do not run on them, and forks because their copy
 * belongs to the upstream repo.
 */
async function findConsumers(api, only) {
  const repos = [];
  if (only) {
    const r = await api('GET', `/repos/${ORG}/${only}`);
    if (!r.ok) throw new Error(`could not read ${only} (${detail(r)})`);
    repos.push(r.data);
  }
  for (let page = 1; !only; page += 1) {
    const r = await api('GET', `/orgs/${ORG}/repos?per_page=100&type=all&page=${page}`);
    if (!r.ok) throw new Error(`could not list the org's repos (${detail(r)})`);
    repos.push(...r.data);
    if (r.data.length < 100) break;
  }

  // Skipping a named repo would report no consumers and exit 0, which reads as
  // "in sync". Say why instead.
  const skip = (repo, why) => {
    if (only) throw new Error(`${repo.name} is not a consumer: ${why}`);
  };

  const consumers = [];
  for (const repo of repos) {
    if (repo.archived || repo.fork) {
      skip(repo, repo.archived ? 'archived' : 'a fork');
      continue;
    }
    let copy;
    try {
      copy = await readCopy(api, repo.name, repo.default_branch);
    } catch (err) {
      copy = { error: err.message };
    }
    if (copy.missing) {
      skip(repo, `no ${TARGET_PATH}`);
      continue;
    }
    if (copy.error) {
      consumers.push({ repo: repo.name, base: repo.default_branch, unreadable: copy.error });
      continue;
    }
    // This repo's own reusable automation.yml sits at the same path and does not
    // call the shared workflow, so this excludes it without a special case.
    if (!copy.content.includes(CONSUMER_MARKER)) {
      skip(repo, 'its automation.yml does not call the shared workflow');
      continue;
    }
    consumers.push({ repo: repo.name, base: repo.default_branch });
  }
  return consumers;
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
 * Decides what a drifted copy means, given what the last closed sync pull
 * request left behind. `proposed` is the file as that pull request had it.
 *
 * Matching the template means nothing new has been published since, so the
 * difference came from the consumer: a merge they then reverted, or a pull
 * request a maintainer declined. Otherwise the template has moved on.
 *
 * Content rather than dates, because a commit carries the date it was written
 * rather than the date it reached main, and a branch can be merged long after.
 */
function classifyDrift(closedPr, proposed, template) {
  if (!closedPr || proposed !== template) return 'drift';
  return closedPr.merged_at ? 'toolchain-conflict' : 'declined';
}

// Reported when no file is left to propose. A toolchain conflict needs
// attention, while a decline is the maintainer's answer and needs none.
const SETTLED_STATES = ['toolchain-conflict', 'declined'];

async function applicableFiles(api, repo, base, sources) {
  const files = [];
  for (const file of SYNCED_FILES) {
    if (file.ownStops && (await keepsOwnPrTemplate(api, repo, base))) continue;
    files.push({ ...file, content: sources[file.target] });
  }
  return files;
}

// The reference the pull request left behind: its merge commit once merged,
// otherwise its head, which stays readable after the branch is reset.
function closedPrRef(closedPr) {
  return closedPr.merged_at ? closedPr.merge_commit_sha : closedPr.head && closedPr.head.sha;
}

async function syncRepo(api, consumer, sources, { dryRun }) {
  const { repo, base } = consumer;
  if (consumer.unreadable) return { repo, state: 'error', detail: consumer.unreadable };

  const files = await applicableFiles(api, repo, base, sources);
  const pending = [];
  for (const file of files) {
    const copy = await readFile(api, repo, file.target, base);
    if (copy.error) return { repo, state: 'error', detail: copy.error };
    if (copy.missing && file.mustExist) {
      return { repo, state: 'error', detail: 'the copy disappeared during the run' };
    }
    if (copy.missing || copy.content !== file.content) pending.push(file);
  }
  if (!pending.length) return { repo, state: 'in-sync' };

  const open = await openSyncPr(api, repo);
  if (open.error) return { repo, state: 'error', detail: open.error };

  const settled = [];
  let drifted = pending;
  if (!open.pr) {
    const closed = await lastClosedSyncPr(api, repo);
    if (closed.error) return { repo, state: 'error', detail: closed.error };
    if (closed.pr) {
      const ref = closedPrRef(closed.pr);
      if (!ref) return { repo, state: 'error', detail: 'no reference on the closed pull request' };
      // Per file, because a file a maintainer declined must not be offered again
      // every time another file drifts.
      drifted = [];
      for (const file of pending) {
        const proposed = await readFile(api, repo, file.target, ref);
        if (proposed.error) return { repo, state: 'error', detail: proposed.error };
        const verdict = classifyDrift(closed.pr, proposed.content, file.content);
        if (verdict === 'drift') drifted.push(file);
        else settled.push({ target: file.target, verdict, pr: closed.pr.number });
      }
    }
  }

  if (!drifted.length) {
    const worst = SETTLED_STATES.find(state => settled.some(s => s.verdict === state));
    return { repo, state: worst, pr: settled[0].pr, files: settled.map(s => s.target) };
  }

  if (dryRun) {
    return {
      repo,
      state: open.pr ? 'would-update' : 'would-open',
      pr: open.pr && open.pr.number,
      files: drifted.map(file => file.target),
    };
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

  const targets = drifted.map(file => file.target);

  for (const file of drifted) {
    const onBranch = await readFile(api, repo, file.target, BRANCH);
    if (onBranch.error) return { repo, state: 'error', detail: onBranch.error };

    const put = await api('PUT', `/repos/${ORG}/${repo}/contents/${file.target}`, {
      message: title([file.target]),
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      branch: BRANCH,
      ...(onBranch.sha ? { sha: onBranch.sha } : {}),
    });
    if (!put.ok) return { repo, state: 'error', detail: `write failed (${detail(put)})` };
  }

  if (open.pr) {
    return { repo, state: 'updated', pr: open.pr.number, url: open.pr.html_url, files: targets };
  }

  const pr = await api('POST', `/repos/${ORG}/${repo}/pulls`, {
    title: title(targets),
    head: BRANCH,
    base,
    body: prBody(await readPrTemplate(api, repo, base), KDS_TEMPLATE, targets),
  });
  if (!pr.ok) return { repo, state: 'error', detail: `pull request failed (${detail(pr)})` };
  return { repo, state: 'opened', pr: pr.data.number, url: pr.data.html_url, files: targets };
}

async function run(api, sources, options) {
  const consumers = await findConsumers(api, options.only);

  const results = [];
  for (const consumer of consumers) {
    try {
      results.push(await syncRepo(api, consumer, sources, options));
    } catch (err) {
      results.push({ repo: consumer.repo, state: 'error', detail: err.message });
    }
  }
  return results;
}

function report(results) {
  for (const r of results) {
    const extra = r.url || r.detail || (r.pr ? `#${r.pr}` : '');
    const files = r.files ? ` (${r.files.join(', ')})` : '';
    console.log(`${r.repo.padEnd(26)} ${r.state.padEnd(20)} ${extra}${files}`);
  }
  const problems = results.filter((r) => PROBLEM_STATES.includes(r.state));
  const drifted = results.filter((r) => r.state !== 'in-sync');
  console.log(`\n${results.length} consumers, ${drifted.length} not in sync, ${problems.length} needing attention.`);
  for (const p of problems) {
    console.log(`::error title=${p.repo}::${p.state}${p.detail ? `: ${p.detail}` : ''}`);
  }
  return problems.length;
}

// Both spellings, because an --only nobody parses is a full run against every
// consumer, which is the opposite of what it asks for.
function parseArgs(argv) {
  const i = argv.findIndex((a) => a === '--only' || a.startsWith('--only='));
  let only;
  if (i !== -1) {
    only = argv[i] === '--only' ? argv[i + 1] : argv[i].slice('--only='.length);
    if (!only || only.startsWith('--')) throw new Error('--only needs a repo name');
  }
  return { dryRun: argv.includes('--dry-run'), only };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is not set.');
    process.exit(1);
  }
  const sources = {};
  for (const file of SYNCED_FILES) {
    sources[file.target] = fs.readFileSync(path.join(ROOT, file.source), 'utf8');
  }
  const results = await run(httpApi(token), sources, parseArgs(process.argv.slice(2)));
  process.exit(report(results) ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  run,
  syncRepo,
  classifyDrift,
  findConsumers,
  parseArgs,
  report,
  PROBLEM_STATES,
  BRANCH,
  TARGET_PATH,
  PR_TEMPLATE_TARGET,
  SYNCED_FILES,
};
