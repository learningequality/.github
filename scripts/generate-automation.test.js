const test = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');

const { buildReusableWorkflows } = require('./generate-automation');

const prLabel = {
  name: 'pr-label',
  leaf: 'pr-label.yml',
  on: { pull_request_target: { types: ['labeled'] } },
  if: "github.event.action == 'labeled'",
  secrets: { LE_BOT_APP_ID: 'required' },
};
const prOpened = {
  name: 'pr-opened',
  leaf: 'pr-opened.yml',
  on: { pull_request_target: { types: ['opened'] } },
  if: "github.event.action == 'opened'",
  secrets: { SLACK_WEBHOOK_URL: 'optional' },
  permissions: { contents: 'read', 'pull-requests': 'write' },
};
const sweep = {
  name: 'sweep',
  leaf: 'sweep.yml',
  on: { schedule: { cron: '1 0 * * 1' }, workflow_dispatch: {} },
  if: "github.event_name == 'schedule'",
  secrets: {},
};

function build(automations) {
  const files = buildReusableWorkflows(automations);
  const parsed = {};
  for (const [file, content] of Object.entries(files)) parsed[file] = yaml.load(content);
  return parsed;
}

test('automations sharing trigger events are called through one group workflow', () => {
  const files = build([prLabel, prOpened, sweep]);

  assert.deepEqual(Object.keys(files).sort(), ['automation-group-pull-request-target.yml', 'automation.yml']);
  assert.deepEqual(Object.keys(files['automation.yml'].jobs), ['pull-request-target', 'sweep']);

  const groupJob = files['automation.yml'].jobs['pull-request-target'];
  assert.equal(groupJob.name, 'Pull Request Target');
  assert.equal(groupJob.if, "${{ (github.event.action == 'labeled') || (github.event.action == 'opened') }}");
  assert.equal(groupJob.uses, 'learningequality/.github/.github/workflows/automation-group-pull-request-target.yml@main');
  assert.deepEqual(groupJob.permissions, { contents: 'read', 'pull-requests': 'write' });
  assert.deepEqual(groupJob.secrets, {
    LE_BOT_APP_ID: '${{ secrets.LE_BOT_APP_ID }}',
    SLACK_WEBHOOK_URL: '${{ secrets.SLACK_WEBHOOK_URL }}',
  });

  const group = files['automation-group-pull-request-target.yml'];
  assert.deepEqual(Object.keys(group.jobs), ['pr-label', 'pr-opened']);
  assert.equal(group.jobs['pr-label'].uses, 'learningequality/.github/.github/workflows/pr-label.yml@main');
  assert.deepEqual(Object.keys(group.on.workflow_call.secrets), ['LE_BOT_APP_ID', 'SLACK_WEBHOOK_URL']);
});

test('an automation alone on its trigger events is called directly', () => {
  const files = build([prLabel, sweep]);

  assert.deepEqual(Object.keys(files), ['automation.yml']);
  assert.equal(files['automation.yml'].jobs['pr-label'].uses, 'learningequality/.github/.github/workflows/pr-label.yml@main');
  assert.equal(files['automation.yml'].jobs.sweep.uses, 'learningequality/.github/.github/workflows/sweep.yml@main');
});

test('a group whose job id collides with an automation name is rejected', () => {
  const clash = { ...sweep, name: 'pull-request-target' };
  assert.throws(() => buildReusableWorkflows([prLabel, prOpened, clash]), /pull-request-target/);
});
