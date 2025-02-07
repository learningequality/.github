# Prints a list of links to all issues that are assigned
# to external contributors.
# This is not used by any workflows, and meant to be used locally
# whenever need arises. The script requires `GITHUB_TOKEN`
# environment variable with 'repo' and 'read:org' permissions. 

import os
import requests

ORG = "learningequality"
REPOS = ["kolibri", "studio", "kolibri-design-system", "le-utils", ".github","ricecooker"]

TOKEN = os.getenv("GITHUB_TOKEN")
if not TOKEN:
    raise EnvironmentError("Please set the GITHUB_TOKEN environment variable with 'repo' and 'read:org' permissions.")

BASE_URL = "https://api.github.com"
HEADERS = {
    "Authorization": f"token {TOKEN}",
    "Accept": "application/vnd.github+json"
}

def get_team_members(org):
    """Fetch all team members for the organization."""
    team_members = set()
    url = f"{BASE_URL}/orgs/{org}/members"
    while url:
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        members = response.json()
        team_members.update(member["login"] for member in members)
        url = response.links.get("next", {}).get("url")
    return team_members

def get_issues_for_repo(org, repo):
    """Fetch all issues for a specific repository."""
    issues = []
    url = f"{BASE_URL}/repos/{org}/{repo}/issues?state=open"
    while url:
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        issues.extend(response.json())
        url = response.links.get("next", {}).get("url")
    return issues

def filter_issues(issues, team_members):
    """Filter issues assigned to external contributors"""
    return [
        issue for issue in issues
        if issue.get("assignee") and issue["assignee"]["login"] not in team_members
    ]

def main():
    team_members = get_team_members(ORG)
    print(f"Found {len(team_members)} team members in {ORG}.")

    all_filtered_issues = []
    print(f"Processing {len(REPOS)} repositories in {ORG}...")

    for repo in REPOS:
        print(f"Processing repository: {repo}")
        issues = get_issues_for_repo(ORG, repo)
        filtered_issues = filter_issues(issues, team_members)
        all_filtered_issues.extend(
            issue["html_url"]
            for issue in filtered_issues
        )
    
    for url in all_filtered_issues:
        print(url)

if __name__ == "__main__":
    main()
