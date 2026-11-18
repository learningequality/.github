// See docs/community-automations.md

const {
  LABEL_COMMUNITY_ISSUE_REVIEW,
  ISSUE_REVIEW_MAX_DAYS,
  LABEL_NEEDS_TEMPLATE,
  ISSUE_TEMPLATE_MAX_DAYS,
  BOT_MESSAGE_ISSUE_TEMPLATE_CLOSED,
  LABEL_UNLINKED,
  PR_UNLINKED_MAX_DAYS,
  BOT_MESSAGE_PULL_REQUEST_UNLINKED_CLOSED,
} = require('./constants');
const { removeLabel, getLinkedIssues } = require('./utils');
const { linkStatus, planLink, applyLink } = require('./pull-request-link');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * When the label was last applied, or the issue last reopened if later, or null
 * when the timeline carries no such label event. The timeline returns events
 * oldest first.
 */
async function labeledAt(name, owner, repo, issueNumber, github, core) {
  try {
    const events = await github.paginate(github.rest.issues.listEventsForTimeline, {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    const applied = events.findLastIndex(
      event => event.event === 'labeled' && event.label?.name?.toLowerCase() === name.toLowerCase(),
    );
    if (applied === -1) {
      return null;
    }
    const reopened = events.slice(applied).findLast(event => event.event === 'reopened');
    return new Date((reopened ?? events[applied]).created_at);
  } catch (error) {
    core.warning(`Failed to read the timeline of issue #${issueNumber}: ${error.message}`);
    return null;
  }
}

async function staleIssues(name, maxDays, owner, repo, { github, core }, now) {
  let issues = [];
  try {
    issues = await github.paginate(github.rest.issues.listForRepo, {
      owner,
      repo,
      state: 'open',
      labels: name,
      per_page: 100,
    });
  } catch (error) {
    core.warning(`Failed to list issues labelled ${name} in ${owner}/${repo}: ${error.message}`);
    return [];
  }

  const stale = [];
  for (const issue of issues) {
    const applied = await labeledAt(name, owner, repo, issue.number, github, core);
    if (applied && now - applied.getTime() > maxDays * MS_PER_DAY) {
      stale.push({ issue, applied });
    }
  }
  return stale;
}

/**
 * Removes the review label from every open issue that carried it for longer
 * than ISSUE_REVIEW_MAX_DAYS, and returns the issue numbers it cleared. A stuck
 * label means the agent never answered, so it tells a maintainer nothing.
 */
async function sweepIssueReviewLabels(owner, repo, { github, core }, now = Date.now()) {
  const stale = await staleIssues(
    LABEL_COMMUNITY_ISSUE_REVIEW,
    ISSUE_REVIEW_MAX_DAYS,
    owner,
    repo,
    { github, core },
    now,
  );
  const cleared = [];
  for (const { issue, applied } of stale) {
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

async function closeIssuesMissingTemplate(owner, repo, { github, core }, now = Date.now()) {
  const stale = await staleIssues(
    LABEL_NEEDS_TEMPLATE,
    ISSUE_TEMPLATE_MAX_DAYS,
    owner,
    repo,
    { github, core },
    now,
  );
  const closed = [];
  for (const { issue, applied } of stale.filter(({ issue }) => !issue.pull_request)) {
    try {
      await github.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: 'closed',
        state_reason: 'not_planned',
      });
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: BOT_MESSAGE_ISSUE_TEMPLATE_CLOSED,
      });
      closed.push(issue.number);
      core.info(
        `Closed issue #${issue.number}, labelled ${LABEL_NEEDS_TEMPLATE} ${applied.toISOString()}.`,
      );
    } catch (error) {
      core.warning(`Failed to close issue #${issue.number}: ${error.message}`);
    }
  }
  return closed;
}

async function closeUnlinkedPullRequests(owner, repo, { github, context, core }, now = Date.now()) {
  const stale = await staleIssues(
    LABEL_UNLINKED,
    PR_UNLINKED_MAX_DAYS,
    owner,
    repo,
    { github, core },
    now,
  );
  const closed = [];
  for (const { issue: pullRequest } of stale.filter(({ issue }) => issue.pull_request)) {
    const { number } = pullRequest;
    const linked = await getLinkedIssues(number, { github, context, core });
    if (linked === null) {
      continue;
    }
    const status = linkStatus(linked, pullRequest.user.login);
    const link = { ...status, message: status.message ?? BOT_MESSAGE_PULL_REQUEST_UNLINKED_CLOSED };
    try {
      const plan = await planLink(
        owner,
        repo,
        pullRequest,
        link,
        { github, core },
        {
          opening: false,
        },
      );
      await applyLink(owner, repo, number, plan, { github, core });
      if (plan.action === 'close') {
        closed.push(number);
        core.info(`Closed pull request #${number}: ${link.status}.`);
      }
    } catch (error) {
      core.warning(`Failed to act on pull request #${number}: ${error.message}`);
    }
  }
  return closed;
}

module.exports = { sweepIssueReviewLabels, closeIssuesMissingTemplate, closeUnlinkedPullRequests };
