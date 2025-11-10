# `contributor-issue-comment`

Manages GitHub issue comments. Sends Slack notifications and GitHub bot replies.

| Contributor type | Issue type | Comment type | #support-dev | #support-dev-notifications | GitHub bot | GitHub bot message |
|------------------|------------|--------------|--------------|---------------------------|------------------|-------------|
| **Core team** | Any | Any | No | No | No | - |
| **Close contributor** | Any | Any | **Yes** | No | No | - |
| **Issue creator** | `help-wanted` | Any | **Yes** | No | No | - |
| **Issue creator** | Private | Any | No | Yes | No | - |
| **Other** | Private | Regular | No | Yes | No | - |
| **Other** | Private | Assignment request | No | Yes | Yes`*` | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Other** | Unassigned `help-wanted` | Any | **Yes** | No | No | - |
| **Other** | `help-wanted` assigned to the comment author | Any | **Yes** | No | No | - |
| **Other** | `help-wanted` assigned to someone else | Regular | No | Yes | No | - |
| **Other** | `help-wanted` assigned to someone else | Assignment request | No | Yes | Yes`*` | `BOT_MESSAGE_ALREADY_ASSIGNED` |

`*` There is an additional optimization that prevents more than one bot message per hour to not overwhelm issue comment section

In `scripts/contants.js` set:
- `BOT_MESSAGE_ISSUE_NOT_OPEN`: _Issue not open for contribution_ message text
- `BOT_MESSAGE_ALREADY_ASSIGNED`: _Issue already assigned_ message text

# `contributor-pr-reply`

Sends reply to a community pull requests.

In `scripts/contants.js` set:
- `BOT_MESSAGE_PULL_REQUEST`: Message text

# `holiday-message`

Sends a holiday message to community pull requests and issue comments.

In `scripts/contants.js` set:

- `HOLIDAY_MESSAGE`: Message text
- `HOLIDAY_MESSAGE_START_DATE` and `HOLIDAY_MESSAGE_END_DATE`: From and till when the message should be sent

Additionally before/after holidays, enable/disable all related workflows in all repositories that use it (search for `call-holiday-message`).
