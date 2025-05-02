/**
 * Adds/removes issue contributing header when 'help wanted' label is added / removed.
 */

module.exports = async ({ github, context, core }) => {
  try {
    const HELP_WANTED_LABEL = "help wanted";

    const repoOwner = context.repo.owner;
    const repoName = context.repo.repo;
    const issueNumber = context.payload.issue.number;
    const actionType = context.payload.action;
    const labelName = context.payload.label.name;

    if (labelName !== HELP_WANTED_LABEL) {
      console.log(`This event does not involve the '${HELP_WANTED_LABEL}' label. Exiting.`);
      return;
    }

    const isAddingHeader = actionType === "labeled";
    const isRemovingHeader = actionType === "unlabeled";

    if (!isAddingHeader && !isRemovingHeader) {
      console.log(`Unsupported action type: ${actionType}. Exiting.`);
      return;
    }

    const issue = await github.rest.issues.get({
      owner: repoOwner,
      repo: repoName,
      issue_number: issueNumber
    });
    
    const currentBody = issue.data.body || "";
    console.log('Current body:', currentBody)

    const helpWantedHeader = '<!---HEADER START-->\n\n<img height="20px" src="https://i.imgur.com/c7hUeb5.jpeg">\n\n🙂 Looking for an issue? Welcome! This issue is open for contribution. If this is the first time you’re requesting an issue, please:\n\n- **Read [the contributing guidelines](https://learningequality.org/contributing-to-our-open-code-base/)** carefully. **Pay extra attention to the [Using generative AI](https://learningequality.org/contributing-to-our-open-code-base/#using-generative-ai)**. **Pull requests and comments that don’t follow the guidelines won’t be answered.**\n- **Confirm that you’ve read the guidelines** in your comment.\n\n<img height="20px" src="https://i.imgur.com/c7hUeb5.jpeg">\n\n<!---HEADER END-->'

    if (isAddingHeader) {
      await updateIssueWithHeader(github, repoOwner, repoName, issueNumber, currentBody, helpWantedHeader);
    } else if (isRemovingHeader) {
      await removeHeaderFromIssue(github, repoOwner, repoName, issueNumber, currentBody, helpWantedHeader);
    }
    
  } catch (error) {
    core.setFailed(`Error in managing help wanted header: ${error.message}`);
  }
};

async function updateIssueWithHeader(github, owner, repo, issueNumber, currentBody, header) {
  if (currentBody.includes(header)) {
    console.log("Help wanted header already exists in the issue. No changes needed.");
    return;
  }
  
  const newBody = header + currentBody;
    await github.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    body: newBody
  });
  
  console.log(`Successfully added 'Help wanted' header to issue #${issueNumber}`);
}

async function removeHeaderFromIssue(github, owner, repo, issueNumber, currentBody, header) {
  if (!currentBody.includes(header)) {
    console.log("Help wanted header does not exist in the issue. No changes needed.");
    return;
  }  
  const newBody = currentBody.replace(header, "");
  await github.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    body: newBody
  });
  
  console.log(`Successfully removed 'Help wanted' header from issue #${issueNumber}`);
}

