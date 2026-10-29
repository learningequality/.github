const test = require('node:test');
const assert = require('node:assert/strict');

const issueValidationDone = require('./issue-validation-done');
const {
  ISSUE_VALIDATION_MARKER,
  ISSUE_VALIDATION_FOLLOW_UPS,
  ISSUE_VALIDATION_DUPLICATE_VERDICT,
  LABEL_COMMUNITY_ISSUE_REVIEW,
  RTIBBLESBOT_USERNAME,
} = require('./constants');

const VERDICT = `${ISSUE_VALIDATION_MARKER}\n\n**Verdict:** claim holds`;
const COMMENT_URL = 'https://github.com/learningequality/kolibri/issues/7#issuecomment-1';
const ISSUE_URL = 'https://github.com/learningequality/kolibri/issues/7';

function body(verdict) {
  return `${ISSUE_VALIDATION_MARKER}\n\n**Verdict:** ${verdict}\n**Evidence:** \`a.py:1\``;
}

function fakeGithub({ status = 200 } = {}) {
  const removed = [];
  return {
    removed,
    rest: {
      issues: {
        removeLabel: async ({ name, issue_number }) => {
          if (status !== 200) {
            const error = new Error(status === 404 ? 'Label does not exist' : 'server error');
            error.status = status;
            throw error;
          }
          removed.push({ name, issue_number });
        },
      },
    },
  };
}

function fakeContext({
  author = RTIBBLESBOT_USERNAME,
  commentBody = VERDICT,
  pullRequest = false,
  title = 'Server PID file kills the test run',
  reporter = 'octocat',
} = {}) {
  const issue = { number: 7, title, html_url: ISSUE_URL, user: { login: reporter } };
  if (pullRequest) {
    issue.pull_request = { url: 'https://api.github.com/repos/learningequality/kolibri/pulls/7' };
  }
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: {
      issue,
      comment: { body: commentBody, html_url: COMMENT_URL, user: { login: author } },
    },
  };
}

function fakeCore() {
  const failures = [];
  const warnings = [];
  const outputs = {};
  return {
    failures,
    warnings,
    outputs,
    info() {},
    warning(message) {
      warnings.push(message);
    },
    error() {},
    setOutput(name, value) {
      outputs[name] = value;
    },
    setFailed(message) {
      failures.push(message);
    },
  };
}

test('a marker comment from rtibblesbot removes the label', async () => {
  const github = fakeGithub();
  const core = fakeCore();
  await issueValidationDone({ github, context: fakeContext(), core });

  assert.deepEqual(github.removed, [{ name: LABEL_COMMUNITY_ISSUE_REVIEW, issue_number: 7 }]);
  assert.deepEqual(core.failures, []);
});

test('the same marker from another account leaves the label on', async () => {
  const github = fakeGithub();
  // The marker is plain text that anyone can paste, so the author decides too.
  await issueValidationDone({
    github,
    context: fakeContext({ author: 'contributor' }),
    core: fakeCore(),
  });

  assert.deepEqual(github.removed, []);
});

test('a comment from rtibblesbot without the marker leaves the label on', async () => {
  const github = fakeGithub();
  await issueValidationDone({
    github,
    context: fakeContext({ commentBody: 'Looks like a duplicate of #42.' }),
    core: fakeCore(),
  });

  assert.deepEqual(github.removed, []);
});

test('an empty comment body does not throw', async () => {
  const github = fakeGithub();
  const core = fakeCore();
  await issueValidationDone({ github, context: fakeContext({ commentBody: null }), core });

  assert.deepEqual(github.removed, []);
  assert.deepEqual(core.failures, []);
});

test('a pull request comment is ignored', async () => {
  const github = fakeGithub();
  await issueValidationDone({
    github,
    context: fakeContext({ pullRequest: true }),
    core: fakeCore(),
  });

  assert.deepEqual(github.removed, []);
});

test('a label that is already off does not fail the run', async () => {
  const github = fakeGithub({ status: 404 });
  const core = fakeCore();
  await issueValidationDone({ github, context: fakeContext(), core });

  assert.deepEqual(core.failures, []);
  assert.deepEqual(core.warnings, []);
});

test('any other remove failure warns and leaves the run passing', async () => {
  const github = fakeGithub({ status: 500 });
  const core = fakeCore();
  await issueValidationDone({ github, context: fakeContext(), core });

  assert.deepEqual(core.failures, []);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /Failed to remove/);
});

for (const [verdict, followUp] of Object.entries(ISSUE_VALIDATION_FOLLOW_UPS)) {
  const stated = verdict === ISSUE_VALIDATION_DUPLICATE_VERDICT ? 'duplicate of #15001' : verdict;

  test(`the notification carries the ${verdict} verdict and its follow-up`, async () => {
    const core = fakeCore();
    await issueValidationDone({
      github: fakeGithub(),
      context: fakeContext({ commentBody: body(stated) }),
      core,
    });

    assert.equal(
      core.outputs.support_dev_message,
      `*[kolibri] <${COMMENT_URL}|Validation: ${stated}> on issue: ` +
        `<${ISSUE_URL}|Server PID file kills the test run> reported by _octocat_* _(${followUp})_`,
    );
  });
}

test('a comment with no verdict line still notifies', async () => {
  const core = fakeCore();
  await issueValidationDone({
    github: fakeGithub(),
    context: fakeContext({ commentBody: `${ISSUE_VALIDATION_MARKER}\n\nNothing to report.` }),
    core,
  });

  assert.match(core.outputs.support_dev_message, /Validation: no verdict read/);
  assert.match(core.outputs.support_dev_message, /_\(check the agent run\)_$/);
});

test('a body with CRLF line endings reads the same verdict', async () => {
  const core = fakeCore();
  await issueValidationDone({
    github: fakeGithub(),
    context: fakeContext({ commentBody: body('claim holds').replace(/\n/g, '\r\n') }),
    core,
  });

  assert.match(core.outputs.support_dev_message, /Validation: claim holds>/);
});

test('a verdict outside the vocabulary notifies as unread', async () => {
  const core = fakeCore();
  await issueValidationDone({
    github: fakeGithub(),
    context: fakeContext({ commentBody: body('probably fine') }),
    core,
  });

  assert.match(core.outputs.support_dev_message, /Validation: no verdict read/);
});

test('a duplicate verdict with no issue number notifies as unread', async () => {
  const core = fakeCore();
  await issueValidationDone({
    github: fakeGithub(),
    context: fakeContext({ commentBody: body('duplicate of') }),
    core,
  });

  assert.match(core.outputs.support_dev_message, /Validation: no verdict read/);
});

test('an issue title holding angle brackets cannot break the link', async () => {
  const core = fakeCore();
  await issueValidationDone({
    github: fakeGithub(),
    context: fakeContext({ title: 'Fix <ChannelList> rendering' }),
    core,
  });

  assert.match(core.outputs.support_dev_message, /Fix &lt;ChannelList&gt; rendering/);
  assert.doesNotMatch(core.outputs.support_dev_message, /<ChannelList>/);
});

test('a failed label removal still leaves the notification set', async () => {
  const core = fakeCore();
  await issueValidationDone({ github: fakeGithub({ status: 500 }), context: fakeContext(), core });

  assert.match(core.outputs.support_dev_message, /Validation: claim holds/);
});

for (const guard of [
  { name: 'a pull request comment', context: { pullRequest: true } },
  { name: 'another account', context: { author: 'contributor' } },
  { name: 'a comment with no marker', context: { commentBody: 'No marker here.' } },
]) {
  test(`${guard.name} sets no notification`, async () => {
    const core = fakeCore();
    await issueValidationDone({
      github: fakeGithub(),
      context: fakeContext(guard.context),
      core,
    });

    assert.equal(core.outputs.support_dev_message, undefined);
  });
}
