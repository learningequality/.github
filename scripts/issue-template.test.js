const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { checkIssueTemplate, readTemplates } = require('./issue-template');
const { LABEL_NEEDS_TEMPLATE } = require('./constants');

const TEMPLATE_DIR = path.join(__dirname, '..', '.github', 'ISSUE_TEMPLATE');
const TEMPLATE_FILES = fs.readdirSync(TEMPLATE_DIR).filter(file => file.endsWith('.md'));

function fakeGithub() {
  const comments = [];
  const added = [];
  return {
    comments,
    added,
    paginate: async () => [],
    rest: {
      issues: {
        listComments: async () => [],
        createComment: async ({ body }) => {
          comments.push(body);
        },
        addLabels: async ({ labels }) => {
          added.push(...labels);
        },
      },
    },
  };
}

const context = { repo: { owner: 'learningequality', repo: 'kolibri' } };
const core = { info() {}, warning() {} };

const check = (body, github = fakeGithub()) =>
  checkIssueTemplate({ github, context, core }, { number: 7, body });

function fillIn(template) {
  return template
    .split('\n')
    .flatMap(line => {
      if (line.trim() === '…') return ['Filled in.'];
      if (/^\s*<!--\s*REQUIRED\s*-->\s*$/.test(line)) return [line, 'Filled in.'];
      return [line];
    })
    .join('\n');
}

for (const file of TEMPLATE_FILES) {
  const template = fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8');

  test(`${file} filled in passes`, async () => {
    assert.equal(await check(fillIn(template)), true);
  });

  test(`${file} left as written fails`, async () => {
    assert.equal(await check(template), false);
  });

  test(`${file} without AI usage fails`, async () => {
    const withoutAiUsage = fillIn(template).split('## AI usage')[0];
    assert.equal(await check(withoutAiUsage), false);
  });
}

test('the templates are read with their names', () => {
  const names = readTemplates().map(template => template.name);
  assert.ok(names.includes('Report a bug'));
});

test('a failure comments, labels, and names the closest template', async () => {
  const github = fakeGithub();
  const body = '## Steps to reproduce\n\n1. Sync\n\n## AI usage\n\nNone.\n';
  assert.equal(await check(body, github), false);

  assert.deepEqual(github.added, [LABEL_NEEDS_TEMPLATE]);
  assert.match(github.comments[0], /closest to \[Report a bug\]/);
  assert.match(github.comments[0], /`## Observed behavior` is missing/);
  assert.ok(!github.comments[0].includes('Steps to reproduce'));
});

test('a required subsection is checked even when its parent is filled', async () => {
  const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'technical_tracking_issue.md'), 'utf8');
  const withoutScope = fillIn(template).replace('### Scope', '### Boundaries');
  const github = fakeGithub();
  assert.equal(await check(withoutScope, github), false);
  assert.match(github.comments[0], /`### Scope` is missing/);
});

test('a filled template matches whatever heading level the body uses', async () => {
  // kolibri#15703 followed the bug template with `###` headings throughout.
  const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'bug_issue.md'), 'utf8');
  assert.equal(await check(fillIn(template).replace(/^## /gm, '### ')), true);
});

test('an empty body fails rather than throwing', async () => {
  assert.equal(await check(null), false);
});
