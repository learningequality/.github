const test = require('node:test');
const assert = require('node:assert/strict');

const contributorPrReply = require('./contributor-pr-reply');
const {
  LABEL_COMMUNITY_REVIEW,
  LABEL_UNLINKED,
  RTIBBLESBOT_USERNAME,
  CLOSE_CONTRIBUTORS,
} = require('./constants');

const AUTHOR = 'outsider';
const CLOSE_CONTRIBUTOR = CLOSE_CONTRIBUTORS[0];

function fakeContext(
  author = AUTHOR,
  title = 'Fix it',
  { action = 'opened', state = 'open', labels = [] } = {},
) {
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: {
      action,
      pull_request: {
        number: 42,
        html_url: 'https://github.com/learningequality/kolibri/pull/42',
        title,
        state,
        labels: labels.map(name => ({ name })),
        user: { login: author },
      },
    },
  };
}

const edited = (author = AUTHOR, options = {}) =>
  fakeContext(author, 'Fix it', { action: 'edited', ...options });

function fakeCore() {
  const outputs = {};
  const warnings = [];
  const failures = [];
  return {
    outputs,
    warnings,
    failures,
    info() {},
    warning(message) {
      warnings.push(message);
    },
    setFailed(message) {
      failures.push(message);
    },
    setOutput(name, value) {
      outputs[name] = value;
    },
  };
}

function fakeGithub(linkedIssues = [], { graphqlError, relinked } = {}) {
  const calls = { comments: [], updates: [], reviewers: [], labels: [], removed: [], order: [] };
  const current = new Set();
  let lookups = 0;
  return {
    calls,
    current,
    paginate: async (fn, params) => fn(params),
    graphql: async () => {
      if (graphqlError) {
        throw new Error(graphqlError);
      }
      lookups += 1;
      const issues = lookups > 1 && relinked ? relinked : linkedIssues;
      return {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: issues.map(issue => ({
                number: issue.number,
                title: `Issue ${issue.number}`,
                url: `https://github.com/learningequality/kolibri/issues/${issue.number}`,
                assignees: { nodes: issue.assignees.map(login => ({ login })) },
              })),
            },
          },
        },
      };
    },
    rest: {
      issues: {
        createComment: async ({ issue_number, body }) => {
          calls.comments.push({ issue_number, body });
          calls.order.push('comment');
          return { data: { html_url: 'https://github.com/learningequality/kolibri/pull/42#c1' } };
        },
        addLabels: async ({ labels }) => {
          calls.labels.push(...labels);
          calls.order.push('label');
          labels.forEach(name => current.add(name));
        },
        removeLabel: async ({ name }) => {
          calls.removed.push(name);
          current.delete(name);
        },
        listLabelsOnIssue: async () => [...current].map(name => ({ name })),
      },
      pulls: {
        update: async ({ pull_number, state }) => {
          calls.updates.push({ pull_number, state });
          calls.order.push('close');
        },
        requestReviewers: async ({ reviewers }) => {
          calls.reviewers.push(...reviewers);
          calls.order.push('review');
        },
      },
    },
  };
}

async function run(github, context = fakeContext()) {
  context.payload.pull_request.labels.forEach(({ name }) => github.current.add(name));
  const core = fakeCore();
  await contributorPrReply({ github, context, core });
  return core;
}

test('a linked issue assigned to someone else closes the pull request', async () => {
  const github = fakeGithub([{ number: 7, assignees: ['someone-else'] }]);
  const core = await run(github);

  assert.deepEqual(github.calls.updates, [{ pull_number: 42, state: 'closed' }]);
  assert.equal(github.calls.comments.length, 1);
  assert.match(github.calls.comments[0].body, /issues\/7 is assigned to someone else/);
  assert.match(core.outputs.slack_notification, /Closed/);
  assert.deepEqual(github.calls.reviewers, []);
  assert.deepEqual(github.calls.labels, []);
  assert.deepEqual(core.failures, []);
});

test('the closing message replaces the standard reply', async () => {
  const github = fakeGithub([{ number: 7, assignees: ['someone-else'] }]);
  await run(github);

  assert.doesNotMatch(github.calls.comments[0].body, /For the review process to begin/);
});

test('a failed close still reports to Slack', async () => {
  const github = fakeGithub([{ number: 7, assignees: ['someone-else'] }]);
  github.rest.pulls.update = async () => {
    throw new Error('Resource not accessible');
  };
  const core = await run(github);

  assert.deepEqual(github.calls.comments, []);
  assert.match(core.outputs.slack_notification, /Failed to close/);
  assert.equal(core.failures.length, 1);
});

test('a cross-repo linked issue is named by its url', async () => {
  const github = fakeGithub([{ number: 7, assignees: ['someone-else'] }]);
  const core = await run(github);

  assert.match(github.calls.comments[0].body, /https:\/\/github\.com\/.+\/issues\/7/);
  assert.match(core.outputs.slack_notification, /issues\/7/);
});

test('a linked issue assigned to the author requests review and adds the label', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  const core = await run(github);

  assert.deepEqual(github.calls.reviewers, [RTIBBLESBOT_USERNAME]);
  assert.deepEqual(github.calls.labels, [LABEL_COMMUNITY_REVIEW]);
  assert.deepEqual(github.calls.updates, []);
  assert.match(github.calls.comments[0].body, /For the review process to begin/);
  assert.match(core.outputs.slack_notification, /Reply sent/);
});

test('the reply is sent before the review request and the label', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  await run(github);

  assert.deepEqual(github.calls.order, ['comment', 'review', 'label']);
});

test('a failed review request still leaves the reply in place', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  github.rest.pulls.requestReviewers = async () => {
    throw new Error('Reviewer cannot be requested');
  };
  const core = await run(github);

  assert.equal(github.calls.comments.length, 1);
  assert.equal(core.failures.length, 1);
  assert.match(core.outputs.slack_notification, /Reply sent/);
});

test('the author counts as assigned alongside other assignees', async () => {
  const github = fakeGithub([{ number: 7, assignees: ['someone-else', AUTHOR] }]);
  await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, [RTIBBLESBOT_USERNAME]);
});

test('an issue assigned to the author outweighs another assigned elsewhere', async () => {
  const github = fakeGithub([
    { number: 7, assignees: ['someone-else'] },
    { number: 8, assignees: [AUTHOR] },
  ]);
  await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, [RTIBBLESBOT_USERNAME]);
});

test('no linked issue leaves the pull request open and labels it unlinked', async () => {
  const github = fakeGithub([]);
  const core = await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, []);
  assert.deepEqual(github.calls.labels, [LABEL_UNLINKED]);
  assert.equal(github.calls.comments.length, 1);
  assert.match(core.outputs.slack_notification, /Reply sent/);
});

test('a linked issue with no assignee closes the pull request', async () => {
  const github = fakeGithub([{ number: 7, assignees: [] }]);
  const core = await run(github);

  assert.deepEqual(github.calls.updates, [{ pull_number: 42, state: 'closed' }]);
  assert.equal(github.calls.comments.length, 1);
  assert.match(github.calls.comments[0].body, /issues\/7 isn't assigned to you/);
  assert.match(core.outputs.slack_notification, /Closed> pull request on unassigned issue/);
  assert.deepEqual(github.calls.reviewers, []);
});

test('an unlinked pull request is asked to link an issue', async () => {
  const github = fakeGithub([]);
  await run(github);

  assert.match(github.calls.comments[0].body, /link the issue assigned to you under/);
  assert.match(github.calls.comments[0].body, /closed after 7 days/);
});

test('a linked pull request is not asked to link an issue', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  await run(github);

  assert.doesNotMatch(github.calls.comments[0].body, /link the issue/);
});

test('a close contributor is never closed', async () => {
  for (const assignees of [[], ['someone-else']]) {
    const github = fakeGithub([{ number: 7, assignees }]);
    await run(github, fakeContext(CLOSE_CONTRIBUTOR));

    assert.deepEqual(github.calls.updates, []);
    assert.match(github.calls.comments[0].body, /For the review process to begin/);
  }
});

test('a close contributor with no linked issue is not labelled unlinked', async () => {
  const github = fakeGithub([]);
  await run(github, fakeContext(CLOSE_CONTRIBUTOR));

  assert.deepEqual(github.calls.labels, []);
  assert.match(github.calls.comments[0].body, /link the issue/);
});

test('an edit linking the issue assigned to the author starts review without a reply', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  const core = await run(github, edited(AUTHOR, { labels: [LABEL_UNLINKED] }));

  assert.deepEqual(github.calls.comments, []);
  assert.deepEqual(github.calls.removed, [LABEL_UNLINKED]);
  assert.deepEqual(github.calls.reviewers, [RTIBBLESBOT_USERNAME]);
  assert.deepEqual(github.calls.labels, [LABEL_COMMUNITY_REVIEW]);
  assert.equal(core.outputs.slack_notification, '');
});

test('a failed review request leaves the unlinked label for a retry', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  github.rest.pulls.requestReviewers = async () => {
    throw new Error('Reviewer cannot be requested');
  };
  const core = await run(github, edited(AUTHOR, { labels: [LABEL_UNLINKED] }));

  assert.deepEqual(github.calls.removed, []);
  assert.equal(core.failures.length, 1);
});

test('a link added while the opening run labels it unlinked still starts review', async () => {
  const github = fakeGithub([], { relinked: [{ number: 7, assignees: [AUTHOR] }] });
  await run(github);

  assert.deepEqual(github.calls.reviewers, [RTIBBLESBOT_USERNAME]);
  assert.deepEqual(github.calls.removed, [LABEL_UNLINKED]);
  assert.deepEqual([...github.current], [LABEL_COMMUNITY_REVIEW]);
});

test('an edit to an assigned pull request that was never unlinked starts no review', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  await run(github, edited(AUTHOR, { labels: [] }));

  assert.deepEqual(github.calls.reviewers, []);
  assert.deepEqual(github.calls.labels, []);
});

test('an edit to a pull request already under review requests no second review', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  await run(github, edited(AUTHOR, { labels: [LABEL_COMMUNITY_REVIEW] }));

  assert.deepEqual(github.calls.reviewers, []);
  assert.deepEqual(github.calls.labels, []);
});

test('an edit linking an unassigned issue closes the pull request', async () => {
  const github = fakeGithub([{ number: 7, assignees: [] }]);
  await run(github, edited());

  assert.deepEqual(github.calls.updates, [{ pull_number: 42, state: 'closed' }]);
  assert.match(github.calls.comments[0].body, /isn't assigned to you/);
});

test('an edit that leaves the pull request unlinked labels it without a reply', async () => {
  const github = fakeGithub([]);
  await run(github, edited());

  assert.deepEqual(github.calls.comments, []);
  assert.deepEqual(github.calls.labels, [LABEL_UNLINKED]);
});

test('an edit to a closed pull request does nothing', async () => {
  const github = fakeGithub([{ number: 7, assignees: [] }]);
  await run(github, edited(AUTHOR, { state: 'closed' }));

  assert.deepEqual(github.calls.comments, []);
  assert.deepEqual(github.calls.updates, []);
});

test('a failed lookup falls back to the standard reply', async () => {
  const github = fakeGithub([], { graphqlError: 'API down' });
  const core = await run(github);

  assert.deepEqual(github.calls.updates, []);
  assert.deepEqual(github.calls.reviewers, []);
  assert.equal(github.calls.comments.length, 1);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /API down/);
  assert.deepEqual(core.failures, []);
});

test('a title holding a quote and a backslash reaches Slack escaped', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  const core = await run(github, fakeContext(AUTHOR, 'Treat "done" as C:\\full'));

  const line = core.outputs.slack_notification;
  assert.match(line, /Treat \\"done\\" as C:\\\\full/);
  assert.doesNotThrow(() => JSON.parse(`{"text": "${line}"}`));
});

test('a title holding angle brackets cannot end the Slack link early', async () => {
  const github = fakeGithub([{ number: 7, assignees: [AUTHOR] }]);
  const core = await run(github, fakeContext(AUTHOR, 'Remove <KButton>'));

  assert.match(core.outputs.slack_notification, /Remove &lt;KButton&gt;/);
});

test('a failed lookup does not ask the author to link an issue', async () => {
  const github = fakeGithub([], { graphqlError: 'API down' });
  await run(github);

  assert.doesNotMatch(github.calls.comments[0].body, /link the issue/);
});
