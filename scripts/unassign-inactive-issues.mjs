import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import fetch from 'node-fetch';

async function run() {
  try {
    const token = process.env.WEB_Token;
    
    if (!token) {
      throw new Error('No authentication token provided. Please ensure WEB_Token is set in the workflow.');
    }

    console.log('Token exists:', !!token);

    const inactivityPeriodInMinutes = 10;

    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) {
      throw new Error('GITHUB_REPOSITORY environment variable is not set');
    }

    const [owner, repo] = repository.split('/');
    console.log(`Processing repository: ${owner}/${repo}`);

    const octokit = new Octokit({
      auth: token,
      request: {
        fetch: fetch
      }
    });

    try {
      const authUser = await octokit.rest.users.getAuthenticated();
      console.log('Successfully authenticated with GitHub as:', authUser.data.login);
    } catch (authError) {
      console.error('Authentication error details:', authError);
      throw new Error(`Authentication failed: ${authError.message}. Please check your token permissions.`);
    }

    // List open issues
    const issues = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });

    console.log(`Found ${issues.data.length} open issues`);

    for (const issue of issues.data) {
      const assignee = issue.assignee;
      if (!assignee || assignee.site_admin) {
        continue;
      }

    //   console.log(`\nChecking issue #${issue.number}:`);
    //   console.log('Issue data:', {
    //     number: issue.number,
    //     title: issue.title,
    //     assignee: assignee.login,
    //     has_pr_field: !!issue.pull_request,
    //     updated_at: issue.updated_at
    //   });

      // Check for linked PRs using multiple methods
      const checkLinkedPRs = async () => {
        try {
          // Method 1: Check direct PR field
          if (issue.pull_request) {
            console.log(`Issue #${issue.number} is a pull request`);
            return true;
          }

          // Method 2: Check timeline events
          const timeline = await octokit.rest.issues.listEventsForTimeline({
            owner,
            repo,
            issue_number: issue.number,
            per_page: 100
          });

          console.log(`Timeline events for issue #${issue.number}:`, 
            timeline.data.map(event => ({
              event: event.event,
              type: event.event_type,
              actor: event.actor?.login,
              created_at: event.created_at
            }))
          );

          // Look for various PR-related events
          const hasPRLink = timeline.data.some(event => 
            event.event === 'cross-referenced' ||
            event.event === 'connected' ||
            event.event === 'referenced' ||
            (event.source && event.source.type === 'pull_request')
          );

          if (hasPRLink) {
            console.log(`Issue #${issue.number} has PR links in timeline`);
            return true;
          }

          // Method 3: Check issue body for PR links
          const prLinkRegex = /(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#\d+/i;
          if (issue.body && prLinkRegex.test(issue.body)) {
            console.log(`Issue #${issue.number} has PR references in body`);
            return true;
          }

          console.log(`No PR links found for issue #${issue.number}`);
          return false;
        } catch (error) {
          console.error(`Error checking PR links for issue #${issue.number}:`, error);
          return false;
        }
      };

      const lastActivity = new Date(issue.updated_at);
      const now = new Date();
      
      if (now - lastActivity > inactivityPeriodInMinutes * 60 * 1000) {
        const hasLinkedPR = await checkLinkedPRs();
        
        if (hasLinkedPR) {
          console.log(`Skipping issue #${issue.number} as it has linked PR(s)`);
          continue;
        }

        console.log(`Processing inactive issue #${issue.number} with no linked PRs`);
        
        try {
          // Unassign user
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issue.number,
            assignees: [],
          });

          console.log(`Successfully unassigned user from issue #${issue.number}`);

          // Add comment
          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: issue.number,
            body: `Automatically unassigning @${assignee.login} due to inactivity. @${assignee.login}, if you're still interested in this issue or already have work in progress, please message us here, and we'll assign you again. Thank you!`,
          });

          console.log(`Added comment to issue #${issue.number}`);
        } catch (issueError) {
          console.error('Full error details:', issueError);
          console.error(`Error processing issue #${issue.number}:`, issueError.message);
          if (issueError.status === 403) {
            throw new Error('Token lacks necessary permissions. Ensure it has "issues" and "write" access.');
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Full error details:', error);
    console.error('Action failed:', error.message);
    core.setFailed(error.message);
  }
}

run();