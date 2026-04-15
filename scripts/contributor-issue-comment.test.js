const {
  BOT_MESSAGE_ISSUE_NOT_OPEN,
  BOT_MESSAGE_ALREADY_ASSIGNED,
  BOT_MESSAGE_ASSIGN_SUCCESS,
  BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE,
  MAX_ASSIGNED_ISSUES,
} = require('./constants');
const { mockCore } = require('./test-helpers');

function makeContext({
  issueNumber = 42,
  issueAssignees = [],
  commentBody = '/assign',
  commentAuthor = 'contributor1',
  issueCreator = 'creator',
  repo = 'testrepo',
  owner = 'testorg',
} = {}) {
  return {
    repo: { owner, repo },
    payload: {
      issue: {
        number: issueNumber,
        html_url: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
        title: 'Test Issue',
        user: { login: issueCreator },
        assignees: issueAssignees.map(login => ({ login })),
      },
      comment: {
        id: 999,
        user: { login: commentAuthor },
        body: commentBody,
      },
    },
  };
}

function makeGithub({
  labels = [],
  assignedIssues = [],
  unassignmentEvents = [],
  searchItems = [],
} = {}) {
  const github = {
    paginate: jest.fn().mockImplementation(method => {
      if (method === github.rest.issues.listLabelsOnIssue) {
        return Promise.resolve(labels.map(n => ({ name: n })));
      }
      if (method === github.rest.issues.listComments) {
        return Promise.resolve([]);
      }
      if (method === github.rest.issues.listForRepo) {
        return Promise.resolve(assignedIssues);
      }
      if (method === github.rest.pulls.list) {
        return Promise.resolve([]);
      }
      if (method === github.rest.issues.listEventsForTimeline) {
        return Promise.resolve(unassignmentEvents);
      }
      return Promise.resolve([]);
    }),
    rest: {
      issues: {
        listLabelsOnIssue: jest.fn(),
        listComments: jest.fn(),
        listForRepo: jest.fn(),
        listEventsForTimeline: jest.fn(),
        createComment: jest.fn().mockResolvedValue({
          data: { html_url: 'https://example.com/comment-url' },
        }),
        deleteComment: jest.fn().mockResolvedValue({}),
        addAssignees: jest.fn().mockResolvedValue({}),
      },
      pulls: {
        list: jest.fn(),
      },
      search: {
        issuesAndPullRequests: jest.fn().mockResolvedValue({
          data: { items: searchItems },
        }),
      },
    },
  };
  return github;
}

describe('/assign command handling', () => {
  let script;

  beforeEach(() => {
    jest.resetModules();
    script = require('./contributor-issue-comment');
  });

  test('/assign on non-help-wanted issue sends BOT_MESSAGE_ISSUE_NOT_OPEN', async () => {
    const core = mockCore();
    const context = makeContext({ commentBody: '/assign' });
    const github = makeGithub({ labels: [] }); // no help wanted

    await script({ github, context, core });

    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: BOT_MESSAGE_ISSUE_NOT_OPEN,
      }),
    );
    expect(core._outputs).toHaveProperty('support_dev_notifications_message');
  });

  test('/assign when already assigned to commenter is silent no-op', async () => {
    const core = mockCore();
    const context = makeContext({
      commentBody: '/assign',
      issueAssignees: ['contributor1'],
      commentAuthor: 'contributor1',
    });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
    });

    await script({ github, context, core });

    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(github.rest.issues.addAssignees).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('already assigned'));
  });

  test('/assign when assigned to someone else sends BOT_MESSAGE_ALREADY_ASSIGNED', async () => {
    const core = mockCore();
    const context = makeContext({
      commentBody: '/assign',
      issueAssignees: ['other-person'],
    });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
    });

    await script({ github, context, core });

    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: BOT_MESSAGE_ALREADY_ASSIGNED,
      }),
    );
  });

  test('/assign on help-wanted but not GFI sends BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE', async () => {
    const core = mockCore();
    const context = makeContext({ commentBody: '/assign' });
    const github = makeGithub({
      labels: ['help wanted'], // no 'good first issue'
    });

    await script({ github, context, core });

    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE,
      }),
    );
  });

  test('/assign success: assigns user and posts BOT_MESSAGE_ASSIGN_SUCCESS', async () => {
    const core = mockCore();
    const context = makeContext({ commentBody: '/assign' });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
      assignedIssues: [], // under limit
    });

    await script({ github, context, core });

    expect(github.rest.issues.addAssignees).toHaveBeenCalledWith(
      expect.objectContaining({
        assignees: ['contributor1'],
        issue_number: 42,
      }),
    );
    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: BOT_MESSAGE_ASSIGN_SUCCESS,
      }),
    );
    expect(core._outputs).toHaveProperty('support_dev_notifications_bot');
  });

  test('/assign at limit declines with dynamic message', async () => {
    const core = mockCore();
    const context = makeContext({ commentBody: '/assign' });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
      assignedIssues: [
        {
          html_url: 'https://github.com/org/repo1/issues/1',
          number: 1,
        },
        {
          html_url: 'https://github.com/org/repo2/issues/2',
          number: 2,
        },
      ],
    });

    await script({ github, context, core });

    expect(github.rest.issues.addAssignees).not.toHaveBeenCalled();
    // Should post a message containing the limit number
    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(`${MAX_ASSIGNED_ISSUES}-issue limit`),
      }),
    );
  });

  test('/assign at limit via cooldown declines (1 assigned + 1 cooldown)', async () => {
    const core = mockCore();
    const context = makeContext({ commentBody: '/assign' });
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
      assignedIssues: [
        {
          html_url: 'https://github.com/org/repo1/issues/1',
          number: 1,
        },
      ],
      searchItems: [
        {
          number: 5,
          html_url: 'https://github.com/org/repo2/issues/5',
          title: 'Dropped issue',
        },
      ],
      unassignmentEvents: [
        {
          event: 'unassigned',
          assignee: { login: 'contributor1' },
          created_at: twoDaysAgo,
        },
      ],
    });

    await script({ github, context, core });

    expect(github.rest.issues.addAssignees).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(`${MAX_ASSIGNED_ISSUES}-issue limit`),
      }),
    );
    // Should mention cooldown
    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('cooldown'),
      }),
    );
  });

  test('/assign is case-insensitive and trims whitespace', async () => {
    const core = mockCore();
    const context = makeContext({ commentBody: '  /Assign  ' });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
    });

    await script({ github, context, core });

    // Should be treated as /assign command
    expect(github.rest.issues.addAssignees).toHaveBeenCalled();
  });

  test('/assign with extra text is NOT treated as /assign command', async () => {
    const core = mockCore();
    const context = makeContext({ commentBody: '/assign please' });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
    });

    await script({ github, context, core });

    // Should NOT be treated as /assign — falls through to normal flow
    expect(github.rest.issues.addAssignees).not.toHaveBeenCalled();
  });

  test('/assign routes Slack to support_dev_notifications only', async () => {
    const core = mockCore();
    const context = makeContext({ commentBody: '/assign' });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
    });

    await script({ github, context, core });

    // Should set support_dev_notifications_message, NOT support_dev_message
    expect(core._outputs).toHaveProperty('support_dev_notifications_message');
    expect(core._outputs).not.toHaveProperty('support_dev_message');
  });
});

describe('keyword detection on GFI issues', () => {
  let script;

  beforeEach(() => {
    jest.resetModules();
    script = require('./contributor-issue-comment');
  });

  test('keyword on unassigned GFI replies with BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE', async () => {
    const core = mockCore();
    const context = makeContext({
      commentBody: 'Can I work on this issue?',
      commentAuthor: 'newcontrib',
      issueCreator: 'creator',
    });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
    });

    await script({ github, context, core });

    const { BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE } = require('./constants');
    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE,
      }),
    );
  });

  test('keyword on non-GFI help-wanted issue does NOT send keyword GFI message', async () => {
    const core = mockCore();
    const context = makeContext({
      commentBody: 'Can I work on this issue?',
      commentAuthor: 'newcontrib',
      issueCreator: 'creator',
    });
    const github = makeGithub({
      labels: ['help wanted'], // NOT good first issue
    });

    await script({ github, context, core });

    const { BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE } = require('./constants');
    // Should NOT send the GFI keyword message
    if (github.rest.issues.createComment.mock.calls.length > 0) {
      expect(github.rest.issues.createComment).not.toHaveBeenCalledWith(
        expect.objectContaining({
          body: BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE,
        }),
      );
    }
  });

  test('keyword on GFI when commenter is already assigned does NOT send keyword GFI message', async () => {
    const core = mockCore();
    const context = makeContext({
      commentBody: 'I am working on this issue',
      commentAuthor: 'newcontrib',
      issueCreator: 'creator',
      issueAssignees: ['newcontrib'],
    });
    const github = makeGithub({
      labels: ['help wanted', 'good first issue'],
    });

    await script({ github, context, core });

    const { BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE } = require('./constants');
    // Should NOT tell an already-assigned contributor to use /assign
    expect(github.rest.issues.createComment).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE,
      }),
    );
  });
});
