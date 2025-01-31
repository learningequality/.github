import os
import requests
import json

def get_user_type(owner, repo, username, token):
    if not username:
        return None

    url = f'https://api.github.com/repos/{owner}/{repo}/collaborators/{username}'
    headers = {"Authorization": f"token {token}"}
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 204:  # User is a collaborator
            return "internal"
        elif response.status_code == 404:  # User is not a collaborator
            return "external"
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"Error checking user type: {e}")
        return None

def add_label(owner, repo, issue_number, token):
    url = f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}/labels"
    headers = {"Authorization": f"token {token}"}
    data = {"labels": ["community-contribution-in-progress"]}
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()

def remove_label(owner, repo, issue_number, token):
    url = f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}/labels/community-contribution-in-progress"
    headers = {"Authorization": f"token {token}"}
    try:
        response = requests.delete(url, headers=headers)
        if response.status_code == 404:
            print("Label not found")
            return
        response.raise_for_status()
        print("Label removed")
    except requests.exceptions.RequestException as e:
        print(f"Error removing label: {e}")
        raise

def main():
    event_path = os.getenv("GITHUB_EVENT_PATH")
    token = os.getenv("token")

    if not event_path or not token:
        raise Exception("GITHUB_EVENT_PATH and token must be set")

    with open(event_path, "r") as f:
        event_data = json.load(f)

    issue = event_data["issue"]
    issue_number = issue["number"]
    repo = os.getenv("GITHUB_REPOSITORY")
    owner, repo_name = repo.split("/")
    action = event_data["action"]

    current_assignees = [assignee["login"] for assignee in issue.get("assignees", [])]

    has_external_assignee = False
    for assignee in current_assignees:
        if get_user_type(owner, repo_name, assignee, token) == "external":
            has_external_assignee = True
            break

    if action == "assigned" and has_external_assignee:
        add_label(owner, repo_name, issue_number, token)
    elif action == "unassigned" and not has_external_assignee:
        remove_label(owner, repo_name, issue_number, token)

if __name__ == "__main__":
    main()
