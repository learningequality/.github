const { isContributor } = require('./utils');

/**
 * Checks if a user is a contributor based on their
 * username and author association. Sets `is_contributor` output.
 */
module.exports = async ({ core, github, context }) => {
  const username = process.env.USERNAME;
  const authorAssociation = process.env.AUTHOR_ASSOCIATION;

  const isUserContributor = await isContributor(username, authorAssociation, { github, context, core });

  core.setOutput('is_contributor', isUserContributor);
};
