const test = require('node:test');
const assert = require('node:assert/strict');

const pullRequestTemplate = require('./pull-request-template');
const { LE_BOT_USERNAME } = require('./constants');

const MARKED = [
  '## Summary',
  '<!-- REQUIRED -->',
  '<!-- guidance -->',
  '',
  '…',
  '',
  '## Notes',
  '',
  'anything',
  '',
].join('\n');

const UNMARKED = ['## Summary', '', '…', '', '## Notes', '', 'anything', ''].join('\n');

// Shaped like morango's template, which fills the section with prose rather than
// with the placeholder.
const PROSE_PLACEHOLDER = [
  '## Summary',
  '<!-- REQUIRED -->',
  '',
  '*Short description*',
  '',
  '## Notes',
  '',
  'anything',
  '',
].join('\n');

// A required section of more than one line, as kolibri-design-system's Changelog
// is. The GitHub web form returns the body with CRLF line endings.
const MULTILINE = [
  '## Changelog',
  '<!-- REQUIRED -->',
  '',
  '- **Description:** Summary of change(s)',
  '- **Breaking:** yes / no',
  '',
].join('\n');

const GOOD_BODY = ['## Summary', '', 'What this does.', '', '## Notes', '', 'A note.'].join('\n');

function fakeGithub({ templates = {}, maintainers = [], comments = [] } = {}) {
  const reads = [];
  const commented = { created: [], updated: [], deleted: [] };
  const listComments = async () => {};
  return {
    reads,
    commented,
    paginate: async (method, params) => {
      assert.equal(method, listComments);
      assert.equal(params.issue_number, 42);
      return comments;
    },
    rest: {
      issues: {
        listComments,
        createComment: async ({ issue_number, body }) => {
          commented.created.push({ issue_number, body });
          return { data: { html_url: 'https://github.com/comment' } };
        },
        updateComment: async ({ comment_id, body }) => {
          commented.updated.push({ comment_id, body });
        },
        deleteComment: async ({ comment_id }) => {
          commented.deleted.push(comment_id);
        },
      },
      teams: {
        getMembershipForUserInOrg: async ({ username }) => {
          if (maintainers.includes(username)) return { data: { state: 'active' } };
          const error = new Error('Not Found');
          error.status = 404;
          throw error;
        },
      },
      repos: {
        getContent: async ({ path, ref }) => {
          reads.push({ path, ref });
          if (!(path in templates)) {
            const error = new Error('Not Found');
            error.status = 404;
            throw error;
          }
          return { data: { content: Buffer.from(templates[path], 'utf8').toString('base64') } };
        },
      },
    },
  };
}

function fakeContext({
  body = GOOD_BODY,
  author = 'contributor',
  association = 'CONTRIBUTOR',
  base = 'develop',
} = {}) {
  return {
    repo: { owner: 'learningequality', repo: 'kolibri' },
    payload: {
      pull_request: {
        number: 42,
        body,
        user: { login: author },
        author_association: association,
        base: { ref: base },
      },
    },
  };
}

function fakeCore() {
  const failures = [];
  const errors = [];
  const warnings = [];
  return {
    failures,
    errors,
    warnings,
    info() {},
    warning(message) {
      warnings.push(message);
    },
    error(message) {
      errors.push(message);
    },
    setFailed(message) {
      failures.push(message);
    },
  };
}

const repoTemplate = body => ({ '.github/pull_request_template.md': body });

test('a body carrying every marked section passes', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext(),
    core,
  });

  assert.deepEqual(core.failures, []);
});

test('a missing marked section fails and is named', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext({ body: '## Notes\n\nA note.' }),
    core,
  });

  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /`## Summary` is missing/);
});

test('an empty marked section fails', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext({ body: '## Summary\n\n<!-- still a comment -->\n' }),
    core,
  });

  assert.match(core.failures[0], /`## Summary` is empty/);
});

test('a marked section still holding the placeholder fails', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext({ body: '## Summary\n\n…\n' }),
    core,
  });

  assert.match(core.failures[0], /placeholder/);
});

test('an unmarked section is not required', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext({ body: '## Summary\n\nWhat this does.' }),
    core,
  });

  assert.deepEqual(core.failures, []);
});

test('a template marking nothing requires every section', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(UNMARKED) }),
    context: fakeContext({ body: '## Summary\n\nWhat this does.' }),
    core,
  });

  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /`## Notes` is missing/);
});

test('a template holding no sections warns and fails nothing', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate('Open a pull request and describe it.\n') }),
    context: fakeContext({ body: '' }),
    core,
  });

  assert.deepEqual(core.failures, []);
  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /holds no sections/);
});

test('a heading matches whatever case the body writes it in', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext({ body: '## summary\n\nWhat this does.' }),
    core,
  });

  assert.deepEqual(core.failures, []);
});

test('every failure is named, not only the first', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(UNMARKED) }),
    context: fakeContext({ body: '' }),
    core,
  });

  assert.equal(core.errors.length, 2);
  assert.match(core.failures[0], /## Summary/);
  assert.match(core.failures[0], /## Notes/);
});

test('an empty body fails rather than throwing', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext({ body: null }),
    core,
  });

  assert.equal(core.failures.length, 1);
});

test('a bot author passes without a template read', async () => {
  const core = fakeCore();
  const github = fakeGithub({ templates: repoTemplate(MARKED) });
  await pullRequestTemplate({
    github,
    context: fakeContext({ body: '', author: LE_BOT_USERNAME }),
    core,
  });

  assert.deepEqual(core.failures, []);
  assert.deepEqual(github.reads, []);
});

const COMMENT_MARKER = '<!-- pull-request-template-check -->';

const ourComment = (id, body = `${COMMENT_MARKER}\nold`) => ({
  id,
  user: { login: LE_BOT_USERNAME },
  body,
});

test('a failing body gets one comment naming every problem and the template', async () => {
  const github = fakeGithub({ templates: repoTemplate(UNMARKED) });
  await pullRequestTemplate({ github, context: fakeContext({ body: '' }), core: fakeCore() });

  assert.equal(github.commented.created.length, 1);
  const { issue_number, body } = github.commented.created[0];
  assert.equal(issue_number, 42);
  assert.ok(body.includes(COMMENT_MARKER));
  assert.match(body, /`## Summary` is missing/);
  assert.match(body, /`## Notes` is missing/);
  assert.ok(
    body.includes(
      'https://github.com/learningequality/kolibri/blob/develop/.github/pull_request_template.md',
    ),
  );
});

test('a body falling back to the shared template links to it', async () => {
  const github = fakeGithub();
  await pullRequestTemplate({ github, context: fakeContext({ body: '' }), core: fakeCore() });

  assert.ok(
    github.commented.created[0].body.includes(
      'https://github.com/learningequality/.github/blob/main/.github/PULL_REQUEST_TEMPLATE.md',
    ),
  );
});

test('a body still failing after an edit updates the comment rather than adding one', async () => {
  const github = fakeGithub({ templates: repoTemplate(MARKED), comments: [ourComment(7)] });
  await pullRequestTemplate({ github, context: fakeContext({ body: '' }), core: fakeCore() });

  assert.deepEqual(github.commented.created, []);
  assert.equal(github.commented.updated.length, 1);
  assert.equal(github.commented.updated[0].comment_id, 7);
  assert.match(github.commented.updated[0].body, /`## Summary` is missing/);
});

test('an unchanged failure leaves the comment alone', async () => {
  const first = fakeGithub({ templates: repoTemplate(MARKED) });
  await pullRequestTemplate({
    github: first,
    context: fakeContext({ body: '' }),
    core: fakeCore(),
  });
  const github = fakeGithub({
    templates: repoTemplate(MARKED),
    comments: [ourComment(7, first.commented.created[0].body)],
  });
  await pullRequestTemplate({ github, context: fakeContext({ body: '' }), core: fakeCore() });

  assert.deepEqual(github.commented.created, []);
  assert.deepEqual(github.commented.updated, []);
});

test('a passing body deletes the comment', async () => {
  const someoneElse = { id: 8, user: { login: 'reviewer' }, body: COMMENT_MARKER };
  const github = fakeGithub({
    templates: repoTemplate(MARKED),
    comments: [ourComment(7), someoneElse],
  });
  await pullRequestTemplate({ github, context: fakeContext(), core: fakeCore() });

  assert.deepEqual(github.commented.deleted, [7]);
  assert.deepEqual(github.commented.created, []);
});

test('a comment that cannot be posted still fails the check', async () => {
  const core = fakeCore();
  const github = fakeGithub({ templates: repoTemplate(MARKED) });
  github.rest.issues.createComment = async () => {
    throw new Error('forbidden');
  };
  await pullRequestTemplate({ github, context: fakeContext({ body: '' }), core });

  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /## Summary/);
  assert.equal(core.warnings.length, 1);
});

test('a maintainer passes without a template read', async () => {
  const core = fakeCore();
  const github = fakeGithub({ templates: repoTemplate(MARKED), maintainers: ['bjesterbot'] });
  await pullRequestTemplate({
    github,
    context: fakeContext({ body: '', author: 'bjesterbot', association: 'CONTRIBUTOR' }),
    core,
  });

  assert.deepEqual(core.failures, []);
  assert.deepEqual(github.reads, []);
});

test('an org member outside the maintainer teams is checked', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext({ body: '', author: 'community-guide', association: 'MEMBER' }),
    core,
  });

  assert.equal(core.failures.length, 1);
});

test('the template is read from the base branch, never the head', async () => {
  const github = fakeGithub({ templates: repoTemplate(MARKED) });
  await pullRequestTemplate({
    github,
    context: fakeContext({ base: 'release-v1' }),
    core: fakeCore(),
  });

  assert.ok(github.reads.length);
  for (const read of github.reads) {
    assert.equal(read.ref, 'release-v1');
  }
});

test('an uppercase template in the repo is found', async () => {
  const core = fakeCore();
  // A marked heading the shared template does not carry, so falling back to the
  // shared one could not produce this failure.
  const own = ['## Evidence', '<!-- REQUIRED -->', '', 'what to paste', ''].join('\n');
  const github = fakeGithub({ templates: { '.github/PULL_REQUEST_TEMPLATE.md': own } });
  await pullRequestTemplate({ github, context: fakeContext({ body: '' }), core });

  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /## Evidence/);
  assert.ok(!core.failures[0].includes('## AI usage'), 'the shared template must not be reached');
});

test('a repo holding no template falls back to the shared one', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub(),
    context: fakeContext({ body: '## Summary\n\nWhat this does.' }),
    core,
  });

  // The shared template asks for References, Reviewer guidance and AI usage too.
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /## AI usage/);
});

test('an unreadable candidate path skips the check rather than falling back', async () => {
  const core = fakeCore();
  const github = fakeGithub();
  github.rest.repos.getContent = async () => {
    const error = new Error('server error');
    error.status = 500;
    throw error;
  };
  // An empty body: falling back to the shared template would fail it.
  await pullRequestTemplate({ github, context: fakeContext({ body: '' }), core });

  assert.equal(core.warnings.length, 1);
  assert.match(core.warnings[0], /Could not read/);
  assert.deepEqual(core.failures, [], 'a body may follow a template this run could not read');
});

test('a section left as the template wrote it fails, placeholder or not', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(PROSE_PLACEHOLDER) }),
    context: fakeContext({ body: '## Summary\n\n*Short description*\n' }),
    core,
  });

  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /`## Summary` still holds the text from the template/);
});

test('rewriting that text passes', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(PROSE_PLACEHOLDER) }),
    context: fakeContext({ body: '## Summary\n\nRetries the push on a timeout.\n' }),
    core,
  });

  assert.deepEqual(core.failures, []);
});

test('a CRLF body left as the template wrote it fails too', async () => {
  const core = fakeCore();
  const body = [
    '## Changelog',
    '',
    '- **Description:** Summary of change(s)',
    '- **Breaking:** yes / no',
    '',
  ].join('\r\n');
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MULTILINE) }),
    context: fakeContext({ body }),
    core,
  });

  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /`## Changelog` still holds the text from the template/);
});

test('an ellipsis inside a sentence is prose, not the placeholder', async () => {
  const core = fakeCore();
  await pullRequestTemplate({
    github: fakeGithub({ templates: repoTemplate(MARKED) }),
    context: fakeContext({ body: '## Summary\n\nAdds a Loading… spinner.\n' }),
    core,
  });

  assert.deepEqual(core.failures, []);
});
