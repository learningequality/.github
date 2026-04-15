const { deleteBotComments, getRecentUnassignments } = require('./utils');
const { mockCore } = require('./test-helpers');

// Helper to create mock context
function mockContext(owner = 'testorg', repo = 'testrepo') {
  return {
    repo: { owner, repo },
  };
}

describe('deleteBotComments', () => {
  test('deletes comments from bot that contain marker', async () => {
    const core = mockCore();
    const context = mockContext();
    const github = {
      paginate: jest.fn().mockResolvedValue([
        {
          id: 1,
          user: { login: 'le-bot' },
          body: '<!-- MARKER --> guidance text',
        },
        {
          id: 2,
          user: { login: 'someone-else' },
          body: '<!-- MARKER --> other text',
        },
        {
          id: 3,
          user: { login: 'le-bot' },
          body: 'regular comment without marker',
        },
      ]),
      rest: {
        issues: {
          listComments: jest.fn(),
          deleteComment: jest.fn().mockResolvedValue({}),
        },
      },
    };

    await deleteBotComments(42, 'le-bot', '<!-- MARKER -->', {
      github,
      context,
      core,
    });

    // Should only delete comment 1 (bot + marker)
    expect(github.rest.issues.deleteComment).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.deleteComment).toHaveBeenCalledWith({
      owner: 'testorg',
      repo: 'testrepo',
      comment_id: 1,
    });
    expect(core.info).toHaveBeenCalled();
  });

  test('handles API errors gracefully with warning', async () => {
    const core = mockCore();
    const context = mockContext();
    const github = {
      paginate: jest.fn().mockRejectedValue(new Error('API error')),
      rest: { issues: { listComments: jest.fn() } },
    };

    await deleteBotComments(42, 'le-bot', '<!-- MARKER -->', {
      github,
      context,
      core,
    });

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete bot comments'),
    );
  });

  test('does nothing when no matching comments exist', async () => {
    const core = mockCore();
    const context = mockContext();
    const github = {
      paginate: jest.fn().mockResolvedValue([
        {
          id: 1,
          user: { login: 'someone' },
          body: 'unrelated comment',
        },
      ]),
      rest: {
        issues: {
          listComments: jest.fn(),
          deleteComment: jest.fn(),
        },
      },
    };

    await deleteBotComments(42, 'le-bot', '<!-- MARKER -->', {
      github,
      context,
      core,
    });

    expect(github.rest.issues.deleteComment).not.toHaveBeenCalled();
  });
});

describe('getRecentUnassignments', () => {
  test('finds unassignment events within cutoff window', async () => {
    const core = mockCore();
    const now = Date.now();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    const github = {
      rest: {
        search: {
          issuesAndPullRequests: jest.fn().mockResolvedValue({
            data: {
              items: [
                {
                  number: 10,
                  html_url: 'https://github.com/org/repo1/issues/10',
                  title: 'Test issue',
                },
              ],
            },
          }),
        },
        issues: {
          listEventsForTimeline: jest.fn(),
        },
      },
      paginate: jest.fn().mockResolvedValue([
        {
          event: 'unassigned',
          assignee: { login: 'testuser' },
          created_at: twoDaysAgo,
        },
        {
          event: 'assigned',
          assignee: { login: 'testuser' },
          created_at: twoDaysAgo,
        },
      ]),
    };

    const result = await getRecentUnassignments('testuser', 7, 'org', ['repo1'], github, core);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      repo: 'repo1',
      issueNumber: 10,
      issueUrl: 'https://github.com/org/repo1/issues/10',
      issueTitle: 'Test issue',
      unassignedAt: twoDaysAgo,
    });
  });

  test('ignores unassignment events outside cutoff window', async () => {
    const core = mockCore();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const github = {
      rest: {
        search: {
          issuesAndPullRequests: jest.fn().mockResolvedValue({
            data: {
              items: [
                {
                  number: 10,
                  html_url: 'https://github.com/org/repo1/issues/10',
                  title: 'Old issue',
                },
              ],
            },
          }),
        },
        issues: {
          listEventsForTimeline: jest.fn(),
        },
      },
      paginate: jest.fn().mockResolvedValue([
        {
          event: 'unassigned',
          assignee: { login: 'testuser' },
          created_at: tenDaysAgo,
        },
      ]),
    };

    const result = await getRecentUnassignments('testuser', 7, 'org', ['repo1'], github, core);

    expect(result).toHaveLength(0);
  });

  test('case-insensitive username matching', async () => {
    const core = mockCore();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const github = {
      rest: {
        search: {
          issuesAndPullRequests: jest.fn().mockResolvedValue({
            data: {
              items: [
                {
                  number: 5,
                  html_url: 'https://github.com/org/repo1/issues/5',
                  title: 'Case test',
                },
              ],
            },
          }),
        },
        issues: {
          listEventsForTimeline: jest.fn(),
        },
      },
      paginate: jest.fn().mockResolvedValue([
        {
          event: 'unassigned',
          assignee: { login: 'TestUser' },
          created_at: twoDaysAgo,
        },
      ]),
    };

    const result = await getRecentUnassignments('testuser', 7, 'org', ['repo1'], github, core);

    expect(result).toHaveLength(1);
  });

  test('handles search API errors gracefully', async () => {
    const core = mockCore();
    const github = {
      rest: {
        search: {
          issuesAndPullRequests: jest.fn().mockRejectedValue(new Error('Search failed')),
        },
        issues: {
          listEventsForTimeline: jest.fn(),
        },
      },
      paginate: jest.fn(),
    };

    const result = await getRecentUnassignments('testuser', 7, 'org', ['repo1'], github, core);

    expect(result).toEqual([]);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to search issues'));
  });

  test('searches across multiple repos', async () => {
    const core = mockCore();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    let callCount = 0;

    const github = {
      rest: {
        search: {
          issuesAndPullRequests: jest.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve({
              data: {
                items: [
                  {
                    number: callCount,
                    html_url: `https://github.com/org/repo${callCount}/issues/${callCount}`,
                    title: `Issue in repo${callCount}`,
                  },
                ],
              },
            });
          }),
        },
        issues: {
          listEventsForTimeline: jest.fn(),
        },
      },
      paginate: jest.fn().mockResolvedValue([
        {
          event: 'unassigned',
          assignee: { login: 'testuser' },
          created_at: twoDaysAgo,
        },
      ]),
    };

    const result = await getRecentUnassignments(
      'testuser',
      7,
      'org',
      ['repo1', 'repo2'],
      github,
      core,
    );

    expect(github.rest.search.issuesAndPullRequests).toHaveBeenCalledTimes(2);
    // Both repos return distinct results
    expect(result).toHaveLength(2);
  });

  test('deduplicates multiple unassignment events for the same issue', async () => {
    const core = mockCore();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    const github = {
      rest: {
        search: {
          issuesAndPullRequests: jest.fn().mockResolvedValue({
            data: {
              items: [
                {
                  number: 10,
                  html_url: 'https://github.com/org/repo1/issues/10',
                  title: 'Reassigned issue',
                },
              ],
            },
          }),
        },
        issues: {
          listEventsForTimeline: jest.fn(),
        },
      },
      paginate: jest.fn().mockResolvedValue([
        {
          event: 'unassigned',
          assignee: { login: 'testuser' },
          created_at: twoDaysAgo,
        },
        {
          event: 'unassigned',
          assignee: { login: 'testuser' },
          created_at: oneDayAgo,
        },
      ]),
    };

    const result = await getRecentUnassignments('testuser', 7, 'org', ['repo1'], github, core);

    // Should deduplicate to 1 entry, keeping the most recent
    expect(result).toHaveLength(1);
    expect(result[0].unassignedAt).toBe(oneDayAgo);
  });
});
