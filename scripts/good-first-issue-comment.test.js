const {
  LE_BOT_USERNAME,
  ASSIGN_GUIDANCE_MARKER,
  BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE,
} = require('./constants');
const { mockCore } = require('./test-helpers');

function mockContext(issueNumber = 42) {
  return {
    repo: { owner: 'testorg', repo: 'testrepo' },
    payload: { issue: { number: issueNumber } },
  };
}

describe('good-first-issue-comment', () => {
  let script;

  beforeEach(() => {
    jest.resetModules();
    script = require('./good-first-issue-comment');
  });

  test('posts guidance comment on help wanted + good first issue', async () => {
    const core = mockCore();
    const context = mockContext();
    const labels = [{ name: 'help wanted' }, { name: 'good first issue' }];

    const github = {
      paginate: jest.fn().mockImplementation(method => {
        if (method === github.rest.issues.listLabelsOnIssue) {
          return Promise.resolve(labels);
        }
        if (method === github.rest.issues.listComments) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }),
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn(),
          listComments: jest.fn(),
          createComment: jest.fn().mockResolvedValue({
            data: { html_url: 'https://example.com/comment' },
          }),
          deleteComment: jest.fn(),
        },
      },
    };

    await script({ github, context, core });

    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 42,
        body: BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE,
      }),
    );
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Posted guidance comment'));
  });

  test('skips posting when issue is not help wanted', async () => {
    const core = mockCore();
    const context = mockContext();
    const labels = [{ name: 'good first issue' }];

    const github = {
      paginate: jest.fn().mockImplementation(method => {
        if (method === github.rest.issues.listLabelsOnIssue) {
          return Promise.resolve(labels);
        }
        return Promise.resolve([]);
      }),
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn(),
          listComments: jest.fn(),
          createComment: jest.fn(),
          deleteComment: jest.fn(),
        },
      },
    };

    await script({ github, context, core });

    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('not help wanted'));
  });

  test('deletes previous guidance comments before posting new one', async () => {
    const core = mockCore();
    const context = mockContext();
    const labels = [{ name: 'help wanted' }, { name: 'good first issue' }];
    const existingComments = [
      {
        id: 100,
        user: { login: LE_BOT_USERNAME },
        body: `${ASSIGN_GUIDANCE_MARKER}\n\nOld guidance`,
      },
      {
        id: 101,
        user: { login: 'someone' },
        body: 'A regular comment',
      },
    ];

    const github = {
      paginate: jest.fn().mockImplementation(method => {
        if (method === github.rest.issues.listLabelsOnIssue) {
          return Promise.resolve(labels);
        }
        if (method === github.rest.issues.listComments) {
          return Promise.resolve(existingComments);
        }
        return Promise.resolve([]);
      }),
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn(),
          listComments: jest.fn(),
          createComment: jest.fn().mockResolvedValue({
            data: { html_url: 'https://example.com/comment' },
          }),
          deleteComment: jest.fn().mockResolvedValue({}),
        },
      },
    };

    await script({ github, context, core });

    // Should delete only the bot's guidance comment
    expect(github.rest.issues.deleteComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 100 }),
    );
    expect(github.rest.issues.deleteComment).toHaveBeenCalledTimes(1);
    // Should still post new guidance
    expect(github.rest.issues.createComment).toHaveBeenCalled();
  });

  test('calls setFailed on error', async () => {
    const core = mockCore();
    // Missing payload.issue causes a TypeError in the script
    const context = {
      repo: { owner: 'testorg', repo: 'testrepo' },
      payload: {},
    };

    const github = {
      paginate: jest.fn(),
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn(),
          listComments: jest.fn(),
          createComment: jest.fn(),
          deleteComment: jest.fn(),
        },
      },
    };

    await script({ github, context, core });

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Error'));
  });
});
