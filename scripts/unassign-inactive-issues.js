const fetch = require('node-fetch-native');

const formatUnassignments = (unassignments) => {
  if (unassignments.length === 0) return '';
  
  // Group unassignments by issue
  const groupedByIssue = unassignments.reduce((acc, curr) => {
    const key = `${curr.repo}#${curr.issueNumber}`;
    if (!acc[key]) {
      acc[key] = {
        repo: curr.repo,
        owner: curr.owner,
        issueNumber: curr.issueNumber,
        issueUrl: curr.issueUrl,
        users: []
      };
    }
    acc[key].users.push(curr.user);
    return acc;
  }, {});

  // Format the grouped unassignments
  return Object.values(groupedByIssue)
    .map(({ users, repo, issueNumber, issueUrl }) => 
      `${users.map(u => `@${u}`).join(', ')} from <${issueUrl}|${repo}#${issueNumber}>`
    )
    .join(', ');
};

async function getAllIssues(github, owner, repo) {
  const allIssues = [];
  let page = 1;
  const perPage = 100;
  
  while (true) {
    console.log(`Fetching page ${page} of issues...`);
    
    try {
      const response = await github.rest.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        per_page: perPage,
        page: page,
        filter: 'all',
        pulls: false
      });
      
      const issues = response.data.filter(issue => !issue.pull_request);
      
      if (issues.length === 0) {
        break; // No more issues to fetch
      }
      
      allIssues.push(...issues);
      console.log(`Fetched ${issues.length} issues (excluding PRs) from page ${page}`);
      
      if (issues.length < perPage) {
        break; // Last page has fewer items than perPage
      }
      
      page++;
    } catch (error) {
      console.error(`Error fetching issues page ${page}:`, error);
      break;
    }
  }
  
  console.log(`Total issues fetched (excluding PRs): ${allIssues.length}`);
  return allIssues;
}

const checkLinkedPRs = async (issue, github, owner, repo) => {
  try {
    if (!issue || !issue.number) {
      console.error('Invalid issue object received:', issue);
      return new Set(); // Return empty Set instead of false
    }

    let linkedPRs = new Set();

    // Method 1: Check timeline with enhanced connected event handling
    try { 
      const { data: timelineEvents } = await github.rest.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: issue.number,
        per_page: 100
      });

      
      for (const event of timelineEvents) {
        if (
          // Check if the event type is 'connected' or 'cross-referenced'. 
          // These events indicate that GitHub automatically linked the issue to a PR based on commit messages or references.
          (event.event === 'connected' || event.event === 'cross-referenced') ||

          // Look for a 'referenced' event that includes a commit ID and a linked PR.
          // This implies that the commit in a PR mentions the issue, suggesting a connection.
          (event.event === 'referenced' && event?.commit_id && event?.source?.issue?.pull_request) ||

          // Check for a 'closed' event that has an associated commit and a linked PR.
          // This typically means the issue was closed by a commit referenced in the PR.
          (event.event === 'closed' && event?.commit_id && event?.source?.issue?.pull_request) ||

          // Confirm a 'connected' event where the linked PR is not merged yet.
          // This ensures that we consider PRs that are still open and haven't been merged.
          (event.event === 'connected' && event?.source?.issue?.pull_request?.merged === false)
        ) {
          try {
            //issue.number is used because every pull request is also an issue.
            //Some GitHub events only provide the issue object, so using issue.number ensures consistent access to the PR number across events.
            let prNumber = event?.source?.issue?.number;
            
            if (!prNumber && event?.source?.pull_request?.number) {
              prNumber = event.source.pull_request.number;
            }

            if (prNumber) {
              console.log(`Checking PR #${prNumber} from timeline event`);
              const { data: pr } = await github.rest.pulls.get({
                owner,
                repo,
                pull_number: prNumber
              });
              
              if (pr && pr.state === 'open') {
                console.log(`Found valid linked PR #${prNumber} (${pr.state})`);
                linkedPRs.add(prNumber); 
              }
            }else{
              // Fallback for PRs linked via GitHub UI where PR number cannot be retrieved from the payload
              console.log('found pr linked in the issue');
              linkedPRs.add(1); // Adds a placeholder to indicate a linked PR was found
            }
          } catch (e) {
            console.log(`Error fetching PR details:`, e.message);
          }
        }
      }
    } catch (timelineError) {
      console.error(`Error fetching timeline for issue #${issue.number}:`, timelineError.message);
    }

    // Method 2: Search for PRs that mention this issue
    try {
      const searchQuery = `repo:${owner}/${repo} type:pr is:open ${issue.number} in:body,title`;
      const searchResult = await github.rest.search.issuesAndPullRequests({
        q: searchQuery,
      });

      // Local regex for "closes/fixes/resolves #123"
      const closingRegex = new RegExp(
        `(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\\s*:?\\s*#${issue.number}`,
        "i"
      );

      for (const prItem of searchResult.data.items || []) {
        if (prItem.pull_request && prItem.number) {
          const prDetails = await github.rest.pulls.get({
            owner,
            repo,
            pull_number: prItem.number,
          });

          if (prDetails.data.state === "open") {
            const prBody = prDetails.data.body || "";
            const prTitle = prDetails.data.title || "";
            if (closingRegex.test(prBody) || closingRegex.test(prTitle)) {
              linkedPRs.add(prItem.number);
            }
          }
        }
      }
    } catch (searchError) {
      console.log('Search API error:', searchError.message);
    }
    // Return the Set of linked PR numbers (always return a Set)
    return linkedPRs;
  } catch (error) {
    console.error(`Error in checkLinkedPRs for issue #${issue.number}:`, error);
    return new Set(); // Return empty Set instead of false
  }
};

// Function to check user membership and ownership
const checkUserMembership = async (owner, repo, username, github) => {
  try {
    // Check if the user is an owner of the repository
    const repoDetails = await github.rest.repos.get({
      owner,
      repo
    });

    // Check if the repository owner matches the username
    if (repoDetails.data.owner.login === username) {
      console.log(`${username} is the repository owner`);
      return true;
    }

    // Check if the user is an organization member
    try {
      await github.rest.orgs.getMembershipForUser({
        org: owner,
        username: username
      });
      console.log(`${username} is an organization member`);
      return true;
    } catch (orgError) {
      console.log(`${username} is not an organization member`);
      return false;
    }
  } catch (error) {
    console.error(`Error checking user membership for ${username}:`, error);
    return false;
  }
};

module.exports = async ({ github, context, core }) => {
  try {

    const unassignments = [];
    const inactivityPeriodInMinutes = 1;

    const [owner, repo] = context.payload.repository.full_name.split('/');
    console.log(`Processing repository: ${owner}/${repo}`);
    
    try {
      // Test API access by getting repository details
      const { data: repository } = await github.rest.repos.get({
        owner,
        repo
      });
      console.log('Successfully authenticated with GitHub App and verified repository access');
      console.log(`Repository: ${repository.full_name}`);
    } catch (authError) {
      console.error('Authentication error details:', {
        message: authError.message,
        status: authError.status,
        documentation_url: authError.documentation_url
      });
      throw new Error(`Repository access failed. Please check your GitHub App permissions for repository access. Error: ${authError.message}`);
    }


    const issues = await getAllIssues(github, owner, repo);
    console.log(`Processing ${issues.length} open issues`);

    for (const issue of issues) {
      if (!issue || !issue.number) {
        console.error('Skipping invalid issue:', issue);
        continue;
      }

      console.log(`\nProcessing issue #${issue.number}`);
      console.log('Issue data:', {
        number: issue.number,
        title: issue.title,
        assignees: issue.assignees ? issue.assignees.length : 0,
        updated_at: issue.updated_at
      });

      const assignees = issue.assignees || [];
      if (assignees.length === 0) {
        console.log(`Issue #${issue.number} has no assignees, skipping`);
        continue;
      }

      // Check if issue is inactive
      const lastActivity = new Date(issue.updated_at);
      const now = new Date();
      
      if (now - lastActivity <= inactivityPeriodInMinutes * 60 * 1000) {
        console.log(`Issue #${issue.number} is still active, skipping`);
        continue;
      }

      console.log(`Checking for linked PRs for issue #${issue.number}`);
      const hasOpenPRs = await checkLinkedPRs(issue, github, owner, repo);
      
      if (hasOpenPRs.size > 0) {
        console.log(`Issue #${issue.number} has open PRs, skipping unassignment`);
        continue;
      }

      console.log(`Processing inactive issue #${issue.number} with no open PRs`);

      const inactiveAssignees = [];
      const activeAssignees = [];

      for (const assignee of assignees) {
        if (!assignee || !assignee.login) {
          console.log('Skipping invalid assignee:', assignee);
          continue;
        }

        if (assignee.site_admin || await checkUserMembership(owner, repo, assignee.login, github)) {
          activeAssignees.push(assignee.login);
          console.log(`${assignee.login} is an active member, keeping assignment`);
        } else {
          inactiveAssignees.push(assignee.login);
          console.log(`${assignee.login} is inactive, will be unassigned`);
        }
      }

      if (inactiveAssignees.length === 0) {
        console.log(`No inactive assignees for issue #${issue.number}, skipping`);
        continue;
      }

      try {
        // Update issue assignees
        await github.rest.issues.update({
          owner,
          repo,
          issue_number: issue.number,
          assignees: activeAssignees,
        });
        console.log(`Successfully unassigned users from issue #${issue.number}`);

        // Add comment
        const mentionList = inactiveAssignees.map(login => `@${login}`).join(', ');
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: issue.number,
          body: `Automatically unassigning ${mentionList} due to inactivity. ${mentionList}, If you're still interested in this issue or already have work in progress, please message us here, and we'll assign you again. Thank you!`,
        });
        console.log(`Added comment to issue #${issue.number}`);

        // Record unassignments
        inactiveAssignees.forEach(login => {
          unassignments.push({
            user: login,
            repo,
            owner,
            issueNumber: issue.number,
            issueUrl: `https://github.com/${owner}/${repo}/issues/${issue.number}`
          });
        });

      } catch (issueError) {
        console.error(`Error processing issue #${issue.number}:`, {
          message: issueError.message,
          status: issueError.status
        });
        if (issueError.status === 403) {
          throw new Error('Token lacks necessary permissions. Ensure it has "issues" and "write" access.');
        }
      }
    }

    const formattedUnassignments = formatUnassignments(unassignments);
    console.log('Unassignments completed:', unassignments.length);
    
    try {
      core.setOutput('unassignments', formattedUnassignments);
      return formattedUnassignments;
    } catch (error) {
      console.error('Error setting output:', error);
      core.setFailed(error.message);
    }

  } catch (error) {
    console.error('Action failed:', error);
    console.error('Full error details:', error);
    core.setFailed(error.message);
    return '';
  }
};