// See docs/community-automations.md

const { LABEL_COMMUNITY_ISSUE_REVIEW, ISSUE_REVIEW_MAX_DAYS } = require('./constants');
const { removeLabel } = require('./utils');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * When the label was last applied, or null when the timeline carries no such
 * event. The timeline returns events oldest first, so the last match is the
 * most recent application.
 */
async function labeledAt(name, owner, repo, issueNumber, github, core) {
  try {
    const events = await github.paginate(github.rest.issues.listEventsForTimeline, {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    const applied = events.filter(
      event => event.event === 'labeled' && event.label?.name?.toLowerCase() === name.toLowerCase(),
    );
    if (!applied.length) {
      return null;
    }
    return new Date(applied[applied.length - 1].created_at);
  } catch (error) {
    core.warning(`Failed to read the timeline of issue #${issueNumber}: ${error.message}`);
    return null;
  }
}

/**
 * Removes the review label from every open issue that carried it for longer
 * than ISSUE_REVIEW_MAX_DAYS, and returns the issue numbers it cleared. A stuck
 * label means the agent never answered, so it tells a maintainer nothing.
 */
async function sweepIssueReviewLabels(owner, repo, { github, core }, now = Date.now()) {
  let issues = [];
  try {
    issues = await github.paginate(github.rest.issues.listForRepo, {
      owner,
      repo,
      state: 'open',
      labels: LABEL_COMMUNITY_ISSUE_REVIEW,
      per_page: 100,
    });
  } catch (error) {
    core.warning(`Failed to list issues under review in ${owner}/${repo}: ${error.message}`);
    return [];
  }

  const cleared = [];
  for (const issue of issues) {
    const applied = await labeledAt(
      LABEL_COMMUNITY_ISSUE_REVIEW,
      owner,
      repo,
      issue.number,
      github,
      core,
    );
    if (!applied) {
      continue;
    }
    if (now - applied.getTime() <= ISSUE_REVIEW_MAX_DAYS * MS_PER_DAY) {
      continue;
    }
    const removed = await removeLabel(
      LABEL_COMMUNITY_ISSUE_REVIEW,
      owner,
      repo,
      issue.number,
      github,
      core,
    );
    if (removed) {
      cleared.push(issue.number);
      core.info(
        `Removed ${LABEL_COMMUNITY_ISSUE_REVIEW} from issue #${issue.number}, ` +
          `applied ${applied.toISOString()}.`,
      );
    }
  }
  return cleared;
}

module.exports = { sweepIssueReviewLabels };
