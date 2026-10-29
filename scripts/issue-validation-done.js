// See docs/community-automations.md

const {
  ISSUE_VALIDATION_MARKER,
  ISSUE_VALIDATION_DUPLICATE_VERDICT,
  ISSUE_VALIDATION_FOLLOW_UPS,
  ISSUE_VALIDATION_NO_VERDICT,
  ISSUE_VALIDATION_NO_VERDICT_FOLLOW_UP,
  LABEL_COMMUNITY_ISSUE_REVIEW,
  RTIBBLESBOT_USERNAME,
} = require('./constants');
const { removeLabel, escapeIssueTitleForSlackMessage } = require('./utils');

// The verdict line is written by the agent's LLM session, not by a template, so
// its shape varies. These three mirror the agent's own reader, which has to
// tolerate that: _LIST_NUMBER_RE, _VERDICT_RE and the strips in parse_verdict
// and classify_verdict, all in learningequality/coding-agent. Anything stricter
// here reports a healthy run as broken.
const LIST_NUMBER = /^(\s*)\d+[.)][ \t]+/gm;
const VERDICT_LINE = /^[\s>*_-]*verdict[*_\s]*:\s*(.+?)\s*$/im;
const VERDICT_TRIM = /^[`*_\s.!;]+|[`*_\s.!;]+$/g;
const DUPLICATE_VERDICT = /^duplicate of #\d+$/;

function readVerdict(body) {
  const match = VERDICT_LINE.exec((body || '').replace(LIST_NUMBER, '$1'));
  if (!match) {
    return null;
  }

  const verdict = match[1].toLowerCase().replace(VERDICT_TRIM, '');
  if (DUPLICATE_VERDICT.test(verdict)) {
    return { verdict, followUp: ISSUE_VALIDATION_FOLLOW_UPS[ISSUE_VALIDATION_DUPLICATE_VERDICT] };
  }

  const followUp = ISSUE_VALIDATION_FOLLOW_UPS[verdict];
  return followUp ? { verdict, followUp } : null;
}

module.exports = async ({ github, context, core }) => {
  try {
    const issue = context.payload.issue;
    const comment = context.payload.comment;
    const author = comment.user.login;

    if (issue.pull_request) {
      core.info('The comment is on a pull request, so there is no review label to clear.');
      return;
    }

    if (author !== RTIBBLESBOT_USERNAME) {
      core.info(`${author} is not ${RTIBBLESBOT_USERNAME}, so the label stays on.`);
      return;
    }

    if (!(comment.body || '').includes(ISSUE_VALIDATION_MARKER)) {
      core.info('The comment carries no validation marker, so the label stays on.');
      return;
    }

    const read = readVerdict(comment.body);
    const verdict = read ? read.verdict : ISSUE_VALIDATION_NO_VERDICT;
    const followUp = read ? read.followUp : ISSUE_VALIDATION_NO_VERDICT_FOLLOW_UP;
    const title = escapeIssueTitleForSlackMessage(issue.title || '');
    core.setOutput(
      'support_dev_message',
      `*[${context.repo.repo}] <${comment.html_url}|Validation: ${verdict}> ` +
        `on issue: <${issue.html_url}|${title}> reported by _${issue.user.login}_* ` +
        `_(${followUp})_`,
    );

    const removed = await removeLabel(
      LABEL_COMMUNITY_ISSUE_REVIEW,
      context.repo.owner,
      context.repo.repo,
      issue.number,
      github,
      core,
    );
    if (removed) {
      core.info(`Removed ${LABEL_COMMUNITY_ISSUE_REVIEW} from issue #${issue.number}.`);
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
