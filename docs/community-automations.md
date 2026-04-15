# `contributor-issue-comment`

Manages GitHub issue comments. Sends Slack notifications and GitHub bot replies.

| Contributor type | Issue type | Comment type | #support-dev | #support-dev-notifications | GitHub bot | GitHub bot message |
|------------------|------------|--------------|--------------|---------------------------|------------------|-------------|
| **Core team** | Any | Any | No | No | No | - |
| **Close contributor** | Any | Regular/keyword | **Yes** | No | No | - |
| **Issue creator** | `help-wanted` | Regular/keyword | **Yes** | No | No | - |
| **Issue creator** | Private | Regular/keyword | No | Yes | No | - |
| **Other** | Private | Regular | No | Yes | No | - |
| **Other** | Private | Assignment request | No | Yes | Yes`*` | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Other** | Unassigned `help-wanted` (not GFI) | Regular/keyword | **Yes** | No | No | - |
| **Other** | Unassigned `help-wanted` + GFI | Regular | **Yes** | No | No | - |
| **Other** | Unassigned `help-wanted` + GFI | Assignment request | **Yes** | No | Yes`*` | `BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE` |
| **Other** | `help-wanted` assigned to commenter | Regular/keyword | **Yes** | No | No | - |
| **Other** | `help-wanted` assigned to someone else | Regular | No | Yes | No | - |
| **Other** | `help-wanted` assigned to someone else | Assignment request | No | Yes | Yes`*` | `BOT_MESSAGE_ALREADY_ASSIGNED` |
| Any`**` | Private | `/assign` | No | Yes | Yes | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| Any`**` | `help-wanted` assigned to commenter | `/assign` | No | No | No | - (silent no-op) |
| Any`**` | `help-wanted` assigned to someone else | `/assign` | No | Yes | Yes | `BOT_MESSAGE_ALREADY_ASSIGNED` |
| Any`**` | Unassigned `help-wanted` (not GFI) | `/assign` | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE` |
| Any`**` | Unassigned `help-wanted` + GFI, under limit | `/assign` | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_SUCCESS` |
| Any`**` | Unassigned `help-wanted` + GFI, at limit | `/assign` | No | Yes | Yes | Dynamic at-limit message |

`*` There is an additional optimization that prevents more than one bot message per hour to not overwhelm issue comment section

`**` `/assign` applies to all external contributors (close contributors and issue creators included). Core team members never reach the script. `/assign` must be the entire comment (trimmed, case-insensitive). All `/assign` Slack activity goes to `#support-dev-notifications` only.

**`/assign` cross-repo limit:** Contributors can have up to 2 assigned issues across all community repos (`COMMUNITY_REPOS`). Issues unassigned within the last 7 days count toward the limit (`currentAssignments + recentUnassignments >= MAX_ASSIGNED_ISSUES`).

In `scripts/constants.js` set:
- `BOT_MESSAGE_ISSUE_NOT_OPEN`: _Issue not open for contribution_ message text
- `BOT_MESSAGE_ALREADY_ASSIGNED`: _Issue already assigned_ message text
- `BOT_MESSAGE_ASSIGN_SUCCESS`: Assignment confirmation message
- `BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE`: Decline message for non-GFI issues
- `BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE`: Keyword reply with `/assign` guidance

# `good-first-issue-comment`

Posts a guidance comment when the `good first issue` label is applied to an issue (triggered via the `issue-label` workflow). Explains the `/assign` command, issue limits, cooldown, and links to contributing guidelines.

- Only posts if the issue also has `help wanted` label
- Deletes any previous guidance comment from the bot before posting a new one
- Identified by the `<!-- ASSIGN_GUIDANCE -->` HTML comment marker

In `scripts/constants.js` set:
- `BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE`: Guidance message text

# `contributor-pr-reply`

Sends reply to a community pull requests.

In `scripts/contants.js` set:
- `BOT_MESSAGE_PULL_REQUEST`: Message text

# `holiday-message`

Sends a holiday message to community pull requests and issue comments.

In `scripts/contants.js` set:
- `HOLIDAY_MESSAGE`: Message text

Before/after holidays, enable/disable all related workflows in all repositories that use it (search for `call-holiday-message`).
