const { PR_STATS_REPOS } = require('./constants');

const ORG = 'learningequality';
const ROLLING_WINDOW_DAYS = 30;

/**
 * Calculate percentile value from a sorted array of numbers.
 * Uses linear interpolation between closest ranks.
 */
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];

  const index = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sortedArr.length) return sortedArr[sortedArr.length - 1];
  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

/**
 * Format milliseconds into human-readable duration.
 */
function formatDuration(ms) {
  if (ms === null || ms === undefined) return 'N/A';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h`;
    }
    return `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return '<1m';
}

/**
 * Fetch all PRs for a repository updated within the rolling window.
 */
async function fetchPRsForRepo(github, owner, repo, sinceDate) {
  const prs = [];
  let page = 1;
  const perPage = 100;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const response = await github.rest.pulls.list({
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: perPage,
        page,
      });

      if (response.data.length === 0) break;

      // Filter PRs updated within the rolling window
      const relevantPRs = response.data.filter(pr => new Date(pr.updated_at) >= sinceDate);

      prs.push(...relevantPRs);

      // If we got fewer PRs than requested or all remaining PRs are outside window, stop
      if (response.data.length < perPage) break;

      // If the last PR in this page is outside our window, we can stop
      const lastPR = response.data[response.data.length - 1];
      if (new Date(lastPR.updated_at) < sinceDate) break;

      page++;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching PRs for ${owner}/${repo} page ${page}:`, error.message);
      break;
    }
  }

  return prs;
}

/**
 * Fetch reviews for a PR and return the first review timestamp.
 */
async function getFirstReviewTime(github, owner, repo, pullNumber) {
  try {
    const response = await github.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    if (response.data.length === 0) return null;

    // Find the earliest review
    const reviewTimes = response.data
      .filter(review => review.submitted_at)
      .map(review => new Date(review.submitted_at).getTime());

    if (reviewTimes.length === 0) return null;

    return Math.min(...reviewTimes);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error fetching reviews for ${owner}/${repo}#${pullNumber}:`, error.message);
    return null;
  }
}

/**
 * Main function to calculate PR statistics.
 */
module.exports = async ({ github, core }) => {
  const now = new Date();
  const sinceDate = new Date(now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // eslint-disable-next-line no-console
  console.log(`Calculating PR statistics for ${ROLLING_WINDOW_DAYS}-day rolling window`);
  // eslint-disable-next-line no-console
  console.log(`Since: ${sinceDate.toISOString()}`);
  // eslint-disable-next-line no-console
  console.log(`Repositories: ${PR_STATS_REPOS.join(', ')}`);

  // Collect all time-to-first-review values (in milliseconds)
  const timeToFirstReviewValues = [];

  // Collect all PR lifespan values for closed/merged PRs (in milliseconds)
  const lifespanValues = [];

  // Count open PRs without reviews
  const openUnreviewedPRs = [];

  // Track totals for reporting
  let totalPRsProcessed = 0;
  let totalReviewedPRs = 0;
  let totalClosedPRs = 0;

  for (const repo of PR_STATS_REPOS) {
    // eslint-disable-next-line no-console
    console.log(`\nProcessing ${ORG}/${repo}...`);

    const prs = await fetchPRsForRepo(github, ORG, repo, sinceDate);
    // eslint-disable-next-line no-console
    console.log(`  Found ${prs.length} PRs updated in rolling window`);

    for (const pr of prs) {
      totalPRsProcessed++;
      const prCreatedAt = new Date(pr.created_at).getTime();

      // Get first review time
      const firstReviewTime = await getFirstReviewTime(github, ORG, repo, pr.number);

      if (pr.state === 'open') {
        // Check if open PR has no reviews
        if (firstReviewTime === null) {
          openUnreviewedPRs.push({
            repo,
            number: pr.number,
            title: pr.title,
            url: pr.html_url,
            createdAt: pr.created_at,
          });
        } else {
          // Open PR with review - calculate time to first review
          const timeToReview = firstReviewTime - prCreatedAt;
          if (timeToReview >= 0) {
            timeToFirstReviewValues.push(timeToReview);
            totalReviewedPRs++;
          }
        }
      } else {
        // Closed or merged PR
        const prClosedAt = new Date(pr.closed_at).getTime();
        const lifespan = prClosedAt - prCreatedAt;

        if (lifespan >= 0) {
          lifespanValues.push(lifespan);
          totalClosedPRs++;
        }

        // If it had a review, calculate time to first review
        if (firstReviewTime !== null) {
          const timeToReview = firstReviewTime - prCreatedAt;
          if (timeToReview >= 0) {
            timeToFirstReviewValues.push(timeToReview);
            totalReviewedPRs++;
          }
        }
      }
    }
  }

  // Sort arrays for percentile calculations
  timeToFirstReviewValues.sort((a, b) => a - b);
  lifespanValues.sort((a, b) => a - b);

  // Calculate statistics
  const timeToReviewMedian = percentile(timeToFirstReviewValues, 50);
  const timeToReviewP95 = percentile(timeToFirstReviewValues, 95);

  const lifespanMedian = percentile(lifespanValues, 50);
  const lifespanP95 = percentile(lifespanValues, 95);

  // eslint-disable-next-line no-console
  console.log('\n--- Statistics ---');
  // eslint-disable-next-line no-console
  console.log(`Total PRs processed: ${totalPRsProcessed}`);
  // eslint-disable-next-line no-console
  console.log(`Reviewed PRs: ${totalReviewedPRs}`);
  // eslint-disable-next-line no-console
  console.log(`Closed/Merged PRs: ${totalClosedPRs}`);
  // eslint-disable-next-line no-console
  console.log(`Open unreviewed PRs: ${openUnreviewedPRs.length}`);
  // eslint-disable-next-line no-console
  console.log(`Time to first review - Median: ${formatDuration(timeToReviewMedian)}, P95: ${formatDuration(timeToReviewP95)}`);
  // eslint-disable-next-line no-console
  console.log(`PR lifespan - Median: ${formatDuration(lifespanMedian)}, P95: ${formatDuration(lifespanP95)}`);

  // Format date for report
  const reportDate = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Build Slack message
  let slackMessage = `*Weekly PR Statistics Report*\n`;
  slackMessage += `_${ROLLING_WINDOW_DAYS}-day rolling window | Generated ${reportDate}_\n\n`;

  slackMessage += `*Time to First Review*\n`;
  if (timeToFirstReviewValues.length > 0) {
    slackMessage += `Median: ${formatDuration(timeToReviewMedian)} | 95th percentile: ${formatDuration(timeToReviewP95)}\n`;
    slackMessage += `_Based on ${totalReviewedPRs} reviewed PRs_\n\n`;
  } else {
    slackMessage += `_No reviewed PRs in this period_\n\n`;
  }

  slackMessage += `*PR Lifespan (Open to Close/Merge)*\n`;
  if (lifespanValues.length > 0) {
    slackMessage += `Median: ${formatDuration(lifespanMedian)} | 95th percentile: ${formatDuration(lifespanP95)}\n`;
    slackMessage += `_Based on ${totalClosedPRs} closed/merged PRs_\n\n`;
  } else {
    slackMessage += `_No closed PRs in this period_\n\n`;
  }

  slackMessage += `*Open Unreviewed PRs*\n`;
  if (openUnreviewedPRs.length > 0) {
    slackMessage += `${openUnreviewedPRs.length} PR${openUnreviewedPRs.length === 1 ? '' : 's'} awaiting first review\n`;
  } else {
    slackMessage += `All open PRs have been reviewed\n`;
  }

  slackMessage += `\n_Repos: ${PR_STATS_REPOS.join(', ')}_`;

  // Set outputs
  core.setOutput('slack_message', slackMessage);
  core.setOutput('total_prs', totalPRsProcessed);
  core.setOutput('reviewed_prs', totalReviewedPRs);
  core.setOutput('closed_prs', totalClosedPRs);
  core.setOutput('open_unreviewed_prs', openUnreviewedPRs.length);

  return slackMessage;
};
