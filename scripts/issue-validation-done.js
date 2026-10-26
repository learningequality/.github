// See docs/community-automations.md

const {
  ISSUE_VALIDATION_MARKER,
  LABEL_COMMUNITY_ISSUE_REVIEW,
  RTIBBLESBOT_USERNAME,
} = require('./constants');
const { removeLabel } = require('./utils');

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
