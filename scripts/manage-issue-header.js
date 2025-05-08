/**
 * Updates issue contributing header according to the presence of the 'help wanted' label.
 */

const HELP_WANTED_LABEL = 'help wanted';

const HEADER_START_MARKER = '<!---HEADER START-->';
const HEADER_END_MARKER = '<!---HEADER END-->';

const HELP_WANTED_HEADER = '<!---HEADER START-->\n\n<img height="20px" src="https://i.imgur.com/c7hUeb5.jpeg">\n\n🙂 Looking for an issue? Welcome! This issue is open for contribution. If this is the first time you’re requesting an issue, please:\n\n- **Read the <a href="https://learningequality.org/contributing-to-our-open-code-base/" target="_blank">Contributing guidelines</a>** carefully. **Pay extra attention to the [Using generative AI](https://learningequality.org/contributing-to-our-open-code-base/#using-generative-ai)**. **Pull requests and comments that don’t follow the guidelines won’t be answered.**\n- **Confirm that you’ve read the guidelines** in your comment.\n\n<img height="20px" src="https://i.imgur.com/c7hUeb5.jpeg">\n\n<!---HEADER END-->\n\n';

const NON_HELP_WANTED_HEADER = '<!---HEADER START-->\n\n<img height="20px" src="https://i.imgur.com/c7hUeb5.jpeg">\n\n❌ **This issue is not open for contribution. Please read the <a href="https://learningequality.org/contributing-to-our-open-code-base/" target="_blank">Contributing guidelines</a>** carefully to learn about the contributing process and how to find suitable issues.\n\n<img height="20px" src="https://i.imgur.com/c7hUeb5.jpeg">\n\n<!---HEADER END-->\n\n';

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
    const labelName = context.payload.label.name;

    const labelAdded = actionType === "labeled";
    const labelRemoved = actionType === "unlabeled";

    if (!labelAdded && !labelRemoved) {
      return;
    }

    if (labelName !== HELP_WANTED_LABEL) {
      return;
    }

    const issue = await github.rest.issues.get({
      owner: repoOwner,
      repo: repoName,
      issue_number: issueNumber
    });
    
    const currentBody = issue.data.body || "";

    let newBody = clearHeader(currentBody);
    if (labelAdded) {
      newBody = HELP_WANTED_HEADER + newBody;
    } else if (labelRemoved) {
      newBody = NON_HELP_WANTED_HEADER + newBody;
    }

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
