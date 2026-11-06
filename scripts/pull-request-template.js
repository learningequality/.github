/**
 * Fails the run when a pull request body does not carry the sections that its
 * template marks as required.
 */

const fs = require('fs');
const path = require('path');

const { isContributor } = require('./utils');
const { requiredSections, failures, syncComment } = require('./template-check');
const { PR_TEMPLATE_PATHS, PR_TEMPLATE_TARGET } = require('./constants');

const ORG_TEMPLATE_PATH = path.join(__dirname, '..', PR_TEMPLATE_TARGET);

const COMMENT_MARKER = '<!-- pull-request-template-check -->';

/**
 * The repo's own template, `null` if none exists, or `{ unreadable }` if a
 * candidate path returns anything other than a 404. An unreadable path may
 * contain a repo-owned template, so validating against the shared template
 * could reject a body that follows the template the author was given.
 */
async function readRepoTemplate({ github, context, core }, ref) {
  for (const templatePath of PR_TEMPLATE_PATHS) {
    try {
      const response = await github.rest.repos.getContent({
        owner: context.repo.owner,
        repo: context.repo.repo,
        path: templatePath,
        ref,
      });
      if (response.data?.content) {
        core.info(`Checking against ${templatePath} on ${ref}.`);
        return {
          template: Buffer.from(response.data.content, 'base64').toString('utf8'),
          url: `https://github.com/${context.repo.owner}/${context.repo.repo}/blob/${ref}/${templatePath}`,
        };
      }
    } catch (error) {
      if (error.status !== 404) {
        return { unreadable: `${templatePath}: ${error.message}` };
      }
    }
  }
  return { template: null };
}

function commentBody(problems, templateUrl) {
  return [
    COMMENT_MARKER,
    `**📝 The description doesn't follow the [pull request template](${templateUrl}) yet.** ` +
      'Please edit it to fix:',
    '',
    ...problems.map(problem => `- ${problem}`),
    '',
    'The check runs again when you save, and this comment goes away once it passes.',
  ].join('\n');
}

module.exports = async ({ github, context, core }) => {
  try {
    const pullRequest = context.payload.pull_request;
    const author = pullRequest.user.login;

    if (!(await isContributor(author, pullRequest.author_association, { github, context, core }))) {
      core.info(`${author} is a maintainer or bot, so the template is not checked.`);
      return;
    }

    const found = await readRepoTemplate({ github, context, core }, pullRequest.base.ref);
    if (found.unreadable) {
      core.warning(`Could not read ${found.unreadable}, so the template is not checked.`);
      return;
    }

    const template = found.template ?? fs.readFileSync(ORG_TEMPLATE_PATH, 'utf8');
    if (!found.template) {
      core.info('No template in this repo, so the shared template applies.');
    }

    const required = requiredSections(template);
    if (!required.length) {
      core.warning('The template holds no sections, so there is nothing to check.');
      return;
    }

    const problems = failures(pullRequest.body, required);
    if (!problems.length) {
      core.info(`The body carries all ${required.length} required sections.`);
      await syncComment({ github, context, core }, pullRequest.number, COMMENT_MARKER, null);
      return;
    }

    const templateUrl =
      found.url ??
      `https://github.com/${context.repo.owner}/.github/blob/main/${PR_TEMPLATE_TARGET}`;
    await syncComment(
      { github, context, core },
      pullRequest.number,
      COMMENT_MARKER,
      commentBody(problems, templateUrl),
    );

    for (const problem of problems) {
      core.error(problem);
    }
    core.setFailed(
      `The description does not follow the pull request template:\n` +
        problems.map(problem => `- ${problem}`).join('\n') +
        `\n\nRequired: ${required.map(section => section.heading).join(', ')}. ` +
        `Edit the description and the check runs again.`,
    );
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
};
