const {
  BOT_MESSAGE_PULL_REQUEST,
  BOT_MESSAGE_LINK_ISSUE,
  BOT_MESSAGE_LINKED_ISSUE,
  BOT_MESSAGE_LINK_WHICH_ISSUE,
} = require('./constants');
const { sendBotMessage, getLinkedIssues, escapeIssueTitleForSlackMessage } = require('./utils');
const { linkReferences, linkStatus, planLink, applyLink } = require('./pull-request-link');

function slackLine(context, text) {
  const { repo } = context.repo;
  const { html_url: url, title } = context.payload.pull_request;
  return `*[${repo}] ${text}: <${url}|${escapeIssueTitleForSlackMessage(title)}>*`;
}

function linkNote(link, { named, ambiguous }) {
  if (named) return BOT_MESSAGE_LINKED_ISSUE(named.number);
  if (link.status !== 'unlinked') return null;
  if (ambiguous.length) return BOT_MESSAGE_LINK_WHICH_ISSUE(ambiguous.map(issue => issue.number));
  return BOT_MESSAGE_LINK_ISSUE;
}

async function sendReply({ github, context, core }, note) {
  const { number, user } = context.payload.pull_request;
  const reply = BOT_MESSAGE_PULL_REQUEST(user.login);
  const body = note ? `${reply}\n\n${note}` : reply;
  const botMessageUrl = await sendBotMessage(number, body, { github, context, core });
  core.setOutput(
    'slack_notification',
    slackLine(context, `<${botMessageUrl}|Reply sent> on pull request`),
  );
}

async function act({ github, context, core }, plan, link) {
  const { owner, repo } = context.repo;
  const { number } = context.payload.pull_request;
  try {
    const closingUrl = await applyLink(owner, repo, number, plan, { github, core });
    if (plan.action === 'close') {
      const reason = link.status === 'unassigned' ? 'unassigned' : 'assigned';
      core.setOutput(
        'slack_notification',
        slackLine(
          context,
          `<${closingUrl}|Closed> pull request on ${reason} issue <${link.issue.url}|#${link.issue.number}>`,
        ),
      );
    }
  } catch (error) {
    if (plan.action === 'close') {
      core.setOutput('slack_notification', slackLine(context, 'Failed to close pull request'));
    }
    core.setFailed(`Failed to ${plan.action} the pull request: ${error.message}`);
  }
}

module.exports = async ({ github, context, core }) => {
  try {
    const { owner, repo } = context.repo;
    const pullRequest = context.payload.pull_request;
    const { number } = pullRequest;
    const author = pullRequest.user.login;
    const opening = context.payload.action !== 'edited';
    core.setOutput('slack_notification', '');

    if (!opening && pullRequest.state !== 'open') {
      core.info(`Pull request #${number} is ${pullRequest.state}.`);
      return;
    }

    const plan = async link =>
      planLink(owner, repo, pullRequest, link, { github, core }, { opening });

    const lookup = await getLinkedIssues(number, { github, context, core });
    if (lookup === null) {
      if (opening) {
        await sendReply({ github, context, core }, null);
      }
      return;
    }

    const found = lookup.length
      ? { linked: lookup, named: null, ambiguous: [] }
      : await linkReferences(owner, repo, pullRequest, { github, core });
    const link = linkStatus(found.linked, author);
    const first = await plan(link);
    if (opening && first.action !== 'close') {
      await sendReply({ github, context, core }, linkNote(link, found));
    }
    await act({ github, context, core }, first, link);

    if (opening && first.action === 'label') {
      const relookup = await getLinkedIssues(number, { github, context, core });
      if (relookup?.length) {
        const relink = linkStatus(relookup, author);
        await act({ github, context, core }, await plan(relink), relink);
      }
    }
  } catch (error) {
    core.setOutput('slack_notification', '');
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
