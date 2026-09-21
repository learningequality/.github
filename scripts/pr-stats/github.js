const { BOT_USERNAMES } = require('../constants');

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

      const relevantPRs = response.data.filter(pr => new Date(pr.updated_at) >= sinceDate);

      prs.push(...relevantPRs);

      if (response.data.length < perPage) break;

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

const VERDICT_STATES = ['APPROVED', 'CHANGES_REQUESTED'];

function hasNonEmptyBody(review) {
  return typeof review.body === 'string' && review.body.trim().length > 0;
}

async function fetchReviewComments(github, owner, repo, pullNumber) {
  const comments = [];
  let page = 1;
  const perPage = 100;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await github.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: perPage,
      page,
    });

    comments.push(...response.data);

    if (response.data.length < perPage) break;
    page++;
  }

  return comments;
}

async function getReviewSummary(github, owner, repo, pullNumber) {
  try {
    const response = await github.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    const submittedReviews = response.data.filter(review => review.submitted_at);

    const botTimes = [];
    const humanTimes = [];
    const ambiguousReviews = [];
    let humanSubmittedReviewCount = 0;
    for (const review of submittedReviews) {
      const time = new Date(review.submitted_at).getTime();
      if (BOT_USERNAMES.includes(review.user?.login)) {
        botTimes.push(time);
        continue;
      }

      humanTimes.push(time);
      if (VERDICT_STATES.includes(review.state)) {
        humanSubmittedReviewCount++;
      } else if (review.state === 'COMMENTED') {
        if (hasNonEmptyBody(review)) {
          humanSubmittedReviewCount++;
        } else {
          ambiguousReviews.push(review);
        }
      }
    }

    if (ambiguousReviews.length > 0) {
      let comments = null;
      try {
        comments = await fetchReviewComments(github, owner, repo, pullNumber);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `Error fetching review comments for ${owner}/${repo}#${pullNumber}:`,
          error.message,
        );
      }

      if (comments !== null) {
        for (const review of ambiguousReviews) {
          const reviewComments = comments.filter(
            comment => comment.pull_request_review_id === review.id,
          );
          const opensNewThread = reviewComments.some(comment => !comment.in_reply_to_id);
          if (opensNewThread || reviewComments.length >= 2) {
            humanSubmittedReviewCount++;
          }
        }
      }
    }

    return {
      firstHumanReviewAt: humanTimes.length > 0 ? Math.min(...humanTimes) : null,
      firstBotReviewAt: botTimes.length > 0 ? Math.min(...botTimes) : null,
      humanSubmittedReviewCount,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error fetching reviews for ${owner}/${repo}#${pullNumber}:`, error.message);
    return { firstHumanReviewAt: null, firstBotReviewAt: null, humanSubmittedReviewCount: 0 };
  }
}

module.exports = { fetchPRsForRepo, getReviewSummary };
