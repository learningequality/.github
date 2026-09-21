const { PR_STATS_REPOS, BOT_USERNAMES } = require('./constants');
const {
  distributionSparkline,
  percentile,
  formatDuration,
  formatMedianCount,
} = require('./pr-stats/render');
const { fetchPRsForRepo, getReviewSummary } = require('./pr-stats/github');

const ORG = 'learningequality';
const ROLLING_WINDOW_DAYS = 30;

module.exports = async ({ github, core }) => {
  const now = new Date();
  const sinceDate = new Date(now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // eslint-disable-next-line no-console
  console.log(`Calculating PR statistics for ${ROLLING_WINDOW_DAYS}-day rolling window`);
  // eslint-disable-next-line no-console
  console.log(`Since: ${sinceDate.toISOString()}`);
  // eslint-disable-next-line no-console
  console.log(`Repositories: ${PR_STATS_REPOS.join(', ')}`);

  const timeToFirstHumanReviewValues = [];
  const lifespanValues = [];
  const openUnreviewedPRs = [];

  let totalPRsProcessed = 0;
  let totalHumanReviewedPRs = 0;
  let totalClosedPRs = 0;

  let prsCreatedInWindow = 0;
  let botReviewedCreatedInWindow = 0;
  let botReviewedPRs = 0;
  let humanFirstCount = 0;
  const botLeadTimeValues = [];
  const humanSubmittedReviewsWithBot = [];
  const humanSubmittedReviewsWithoutBot = [];

  for (const repo of PR_STATS_REPOS) {
    // eslint-disable-next-line no-console
    console.log(`\nProcessing ${ORG}/${repo}...`);

    const prs = await fetchPRsForRepo(github, ORG, repo, sinceDate);
    // eslint-disable-next-line no-console
    console.log(`  Found ${prs.length} PRs updated in rolling window`);

    for (const pr of prs) {
      totalPRsProcessed++;
      const prCreatedAt = new Date(pr.created_at).getTime();
      const isBotAuthored = BOT_USERNAMES.includes(pr.user?.login);

      const { firstHumanReviewAt, firstBotReviewAt, humanSubmittedReviewCount } =
        await getReviewSummary(github, ORG, repo, pr.number);

      if (!isBotAuthored) {
        if (new Date(pr.created_at) >= sinceDate) {
          prsCreatedInWindow++;
          if (firstBotReviewAt !== null) {
            botReviewedCreatedInWindow++;
          }
        }

        if (firstBotReviewAt !== null) {
          botReviewedPRs++;

          if (firstHumanReviewAt !== null) {
            const botLeadTime = firstHumanReviewAt - firstBotReviewAt;
            if (botLeadTime > 0) {
              botLeadTimeValues.push(botLeadTime);
            } else {
              humanFirstCount++;
            }
          }
        }

        if (humanSubmittedReviewCount > 0) {
          if (firstBotReviewAt !== null) {
            humanSubmittedReviewsWithBot.push(humanSubmittedReviewCount);
          } else {
            humanSubmittedReviewsWithoutBot.push(humanSubmittedReviewCount);
          }
        }
      }

      let timeToReview = null;
      if (pr.state === 'open') {
        if (firstHumanReviewAt === null) {
          openUnreviewedPRs.push({
            repo,
            number: pr.number,
            title: pr.title,
            url: pr.html_url,
            createdAt: pr.created_at,
          });
        } else {
          timeToReview = firstHumanReviewAt - prCreatedAt;
        }
      } else {
        const prClosedAt = new Date(pr.closed_at).getTime();
        const lifespan = prClosedAt - prCreatedAt;

        if (lifespan >= 0) {
          lifespanValues.push(lifespan);
          totalClosedPRs++;
        }

        if (firstHumanReviewAt !== null) {
          timeToReview = firstHumanReviewAt - prCreatedAt;
        }
      }

      if (timeToReview !== null && timeToReview >= 0) {
        timeToFirstHumanReviewValues.push(timeToReview);
        totalHumanReviewedPRs++;
      }
    }
  }

  timeToFirstHumanReviewValues.sort((a, b) => a - b);
  lifespanValues.sort((a, b) => a - b);
  botLeadTimeValues.sort((a, b) => a - b);
  humanSubmittedReviewsWithBot.sort((a, b) => a - b);
  humanSubmittedReviewsWithoutBot.sort((a, b) => a - b);

  const timeToReviewMedian = percentile(timeToFirstHumanReviewValues, 50);
  const timeToReviewP95 = percentile(timeToFirstHumanReviewValues, 95);

  const lifespanMedian = percentile(lifespanValues, 50);
  const lifespanP95 = percentile(lifespanValues, 95);

  // eslint-disable-next-line no-console
  console.log('\n--- Statistics ---');
  // eslint-disable-next-line no-console
  console.log(`Total PRs processed: ${totalPRsProcessed}`);
  // eslint-disable-next-line no-console
  console.log(`Human-reviewed PRs: ${totalHumanReviewedPRs}`);
  // eslint-disable-next-line no-console
  console.log(`Closed/Merged PRs: ${totalClosedPRs}`);
  // eslint-disable-next-line no-console
  console.log(`Open unreviewed PRs: ${openUnreviewedPRs.length}`);
  // eslint-disable-next-line no-console
  console.log(
    `Time to first human review - Median: ${formatDuration(timeToReviewMedian)}, P95: ${formatDuration(timeToReviewP95)}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `PR lifespan - Median: ${formatDuration(lifespanMedian)}, P95: ${formatDuration(lifespanP95)}`,
  );

  const reportDate = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  let slackMessage = `*Weekly PR Statistics Report*\n`;
  slackMessage += `_${ROLLING_WINDOW_DAYS}-day rolling window | Generated ${reportDate}_\n\n`;

  slackMessage += `*Time to First Human Review*\n`;
  if (timeToFirstHumanReviewValues.length > 0) {
    slackMessage += `Median: ${formatDuration(timeToReviewMedian)} | 95th percentile: ${formatDuration(timeToReviewP95)}\n`;
    slackMessage += `Distribution: ${distributionSparkline(timeToFirstHumanReviewValues)}\n`;
    slackMessage += `_Based on ${totalHumanReviewedPRs} human-reviewed PRs_\n\n`;
  } else {
    slackMessage += `_No reviewed PRs in this period_\n\n`;
  }

  slackMessage += `*PR Lifespan (Open to Close/Merge)*\n`;
  if (lifespanValues.length > 0) {
    slackMessage += `Median: ${formatDuration(lifespanMedian)} | 95th percentile: ${formatDuration(lifespanP95)}\n`;
    slackMessage += `Distribution: ${distributionSparkline(lifespanValues)}\n`;
    slackMessage += `_Based on ${totalClosedPRs} closed/merged PRs_\n\n`;
  } else {
    slackMessage += `_No closed PRs in this period_\n\n`;
  }

  slackMessage += `*Open PRs Awaiting Human Review*\n`;
  if (openUnreviewedPRs.length > 0) {
    slackMessage += `${openUnreviewedPRs.length} PR${openUnreviewedPRs.length === 1 ? '' : 's'} awaiting first review\n`;
  } else {
    slackMessage += `All open PRs have been reviewed\n`;
  }

  if (botReviewedPRs > 0) {
    const coveragePct =
      prsCreatedInWindow > 0
        ? Math.round((100 * botReviewedCreatedInWindow) / prsCreatedInWindow)
        : 0;

    slackMessage += `\n*@rtibblesbot Pre-review*\n`;
    slackMessage += `Reviewed ${botReviewedCreatedInWindow} of ${prsCreatedInWindow} PRs opened in window (${coveragePct}%)\n`;

    if (botLeadTimeValues.length > 0) {
      const botLeadTimeMedian = percentile(botLeadTimeValues, 50);
      const humanFirstSuffix = humanFirstCount > 0 ? `; human first on ${humanFirstCount}` : '';
      slackMessage += `Lead time over first human review: median ${formatDuration(botLeadTimeMedian)} (${botLeadTimeValues.length} PR${botLeadTimeValues.length === 1 ? '' : 's'}${humanFirstSuffix})\n`;
    }

    if (humanSubmittedReviewsWithBot.length > 0 && humanSubmittedReviewsWithoutBot.length > 0) {
      const submittedWithBotMedian = percentile(humanSubmittedReviewsWithBot, 50);
      const submittedWithoutBotMedian = percentile(humanSubmittedReviewsWithoutBot, 50);
      slackMessage += `Human reviews submitted: median ${formatMedianCount(submittedWithBotMedian)} with bot pre-review vs ${formatMedianCount(submittedWithoutBotMedian)} without\n`;
    }
  }

  slackMessage += `\n_Repos: ${PR_STATS_REPOS.join(', ')}_`;

  core.setOutput('slack_message', slackMessage);
  core.setOutput('total_prs', totalPRsProcessed);
  core.setOutput('reviewed_prs', totalHumanReviewedPRs);
  core.setOutput('closed_prs', totalClosedPRs);
  core.setOutput('open_unreviewed_prs', openUnreviewedPRs.length);
  core.setOutput('bot_reviewed_prs', botReviewedPRs);

  return slackMessage;
};
