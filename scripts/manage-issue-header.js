/**
 * Updates issue contributing header according to the presence of the 'help wanted' label.
 */

const HELP_WANTED_LABEL = 'help wanted';

const HEADER_START_MARKER = '<!---HEADER START-->';
const HEADER_END_MARKER = '<!---HEADER END-->';

const HELP_WANTED_HEADER = '<!---HEADER START-->\n\n<img height="20px" src="https://i.imgur.com/0ZZG9qx.jpeg">\n\n🙂 Looking for an issue? Welcome! This issue is open for contribution. If this is the first time you’re requesting an issue, please:\n\n- **Read <a href="https://learningequality.org/contributing-to-our-open-code-base/" target="_blank">Contributing guidelines</a>** carefully. **Pay extra attention to [Using generative AI](https://learningequality.org/contributing-to-our-open-code-base/#using-generative-ai)**. **Pull requests and comments that don’t follow the guidelines won’t be answered.**\n- **Confirm that you’ve read the guidelines** in your comment.\n\n<img height="20px" src="https://i.imgur.com/0ZZG9qx.jpeg">\n\n<!---HEADER END-->\n\n';

const NON_HELP_WANTED_HEADER = '<!---HEADER START-->\n\n<img height="20px" src="https://i.imgur.com/c7hUeb5.jpeg">\n\n❌ **This issue is not open for contribution. Visit <a href="https://learningequality.org/contributing-to-our-open-code-base/" target="_blank">Contributing guidelines</a>** to learn about the contributing process and how to find suitable issues.\n\n<img height="20px" src="https://i.imgur.com/c7hUeb5.jpeg">\n\n<!---HEADER END-->\n\n';

function clearHeader(issueBody) {  
  const startIndex = issueBody.indexOf(HEADER_START_MARKER);
  const endIndex = issueBody.indexOf(HEADER_END_MARKER);
  
  if (startIndex === -1 || endIndex === -1) {
    return issueBody;
  }

  return issueBody.substring(0, startIndex) + issueBody.substring(endIndex + HEADER_END_MARKER.length).trimStart();
}

module.exports = async ({ github, context, core }) => {
  try {
    const repoOwner = context.repo.owner;
    const repoName = context.repo.repo;
    const issueNumber = context.payload.issue.number;
    const actionType = context.payload.action;
    const labelName = context.payload.label?.name;
    let header;

    if (
      actionType === 'opened' || 
      (actionType === 'unlabeled' && labelName === HELP_WANTED_LABEL)
    ) {
      header = NON_HELP_WANTED_HEADER;
    } else if (actionType === 'labeled' && labelName === HELP_WANTED_LABEL) {
      header = HELP_WANTED_HEADER;
    } else {
      core.info(`Unsupported action type "${actionType}" or label "${labelName}". Skipping.`);
      return;
    }

    const issue = await github.rest.issues.get({
      owner: repoOwner,
      repo: repoName,
      issue_number: issueNumber
    });
    
    const currentBody = issue.data.body || "";

    let newBody = clearHeader(currentBody);
    newBody = header + newBody;

    await github.rest.issues.update({
      owner: repoOwner,
      repo: repoName,
      issue_number: issueNumber,
      body: newBody
    });  
    
  } catch (error) {
    core.setFailed(`Error: ${error.message}`);
  }
};
