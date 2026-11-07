const {
  BOT_MESSAGE_PULL_REQUEST_CLOSED,
  BOT_MESSAGE_PULL_REQUEST_UNASSIGNED,
  LABEL_COMMUNITY_REVIEW,
  LABEL_UNLINKED,
  RTIBBLESBOT_USERNAME,
} = require('./constants');
const {
  addLabel,
  removeLabel,
  isCloseContributor,
  findIssueReferences,
  getReferencedIssues,
  addClosingIssueReference,
} = require('./utils');

function chooseReferences(issues, author, defaultBase) {
  const closing = defaultBase ? [] : issues.filter(issue => issue.keyword);
  if (closing.length) return { link: closing, named: false, ambiguous: [] };
  const assigned = issues.filter(issue => issue.assignees.includes(author));
  if (assigned.length === 1) return { link: assigned, named: true, ambiguous: [] };
  return { link: [], named: false, ambiguous: assigned.length > 1 ? assigned : [] };
}

async function linkReferences(owner, repo, pullRequest, { github, core }) {
  const references = findIssueReferences(pullRequest.body, owner, repo);
  if (!references.length) return { linked: [], named: null, ambiguous: [] };
  const issues = await getReferencedIssues(owner, repo, references, { github, core });
  const defaultBase = pullRequest.base.ref === pullRequest.base.repo.default_branch;
  const { link, named, ambiguous } = chooseReferences(issues, pullRequest.user.login, defaultBase);
  const linked = [];
  for (const issue of link) {
    try {
      await addClosingIssueReference(issue.id, pullRequest.node_id, github);
      linked.push(issue);
    } catch (error) {
      core.warning(`Failed to link #${issue.number} to #${pullRequest.number}: ${error.message}`);
    }
  }
  return { linked, named: named && linked.length ? linked[0] : null, ambiguous };
}

function linkStatus(linkedIssues, author) {
  if (!linkedIssues.length) return { status: 'unlinked' };
  if (linkedIssues.some(issue => issue.assignees.includes(author))) return { status: 'assigned' };
  const elsewhere = linkedIssues.find(issue => issue.assignees.length > 0);
  if (elsewhere) {
    return {
      status: 'assigned elsewhere',
      issue: elsewhere,
      message: BOT_MESSAGE_PULL_REQUEST_CLOSED(author, elsewhere.url),
    };
  }
  return {
    status: 'unassigned',
    issue: linkedIssues[0],
    message: BOT_MESSAGE_PULL_REQUEST_UNASSIGNED(author, linkedIssues[0].url),
  };
}

async function currentLabels(owner, repo, number, github) {
  const labels = await github.paginate(github.rest.issues.listLabelsOnIssue, {
    owner,
    repo,
    issue_number: number,
    per_page: 100,
  });
  return labels.map(label => label.name.toLowerCase());
}

async function planLink(owner, repo, pullRequest, link, { github, core }, { opening }) {
  if (link.status === 'assigned') {
    const labels = await currentLabels(owner, repo, pullRequest.number, github);
    const unlinked = labels.includes(LABEL_UNLINKED);
    if (!opening && !unlinked) {
      return { action: 'none' };
    }
    return { action: 'review', underReview: labels.includes(LABEL_COMMUNITY_REVIEW), unlinked };
  }
  if (await isCloseContributor(pullRequest.user.login, { core })) {
    return { action: 'none' };
  }
  return link.message ? { action: 'close', message: link.message } : { action: 'label' };
}

async function applyLink(owner, repo, number, plan, { github, core }) {
  if (plan.action === 'close') {
    await github.rest.pulls.update({ owner, repo, pull_number: number, state: 'closed' });
    const { data } = await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: plan.message,
    });
    return data.html_url;
  }
  if (plan.action === 'label') {
    await addLabel(LABEL_UNLINKED, owner, repo, number, github, core);
  }
  if (plan.action === 'review') {
    if (!plan.underReview) {
      await github.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: number,
        reviewers: [RTIBBLESBOT_USERNAME],
      });
      await github.rest.issues.addLabels({
        owner,
        repo,
        issue_number: number,
        labels: [LABEL_COMMUNITY_REVIEW],
      });
    }
    if (plan.unlinked) {
      await removeLabel(LABEL_UNLINKED, owner, repo, number, github, core);
    }
  }
  return null;
}

module.exports = { linkReferences, linkStatus, planLink, applyLink };
