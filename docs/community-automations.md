# `contributor-issue-comment`

Manages GitHub issue comments. Sends Slack notifications and GitHub bot replies.

| Contributor type | Issue type | Comment type | #support-dev | #support-dev-notifications | GitHub bot | GitHub bot message |
|------------------|------------|--------------|--------------|---------------------------|------------|-------------------|
| **Core team** | Any | Any | No | No | No | - |
| **Close contributor** | Any | regular, assign keyword | **Yes** | No | No | - |
| **Issue creator** | `help-wanted` | regular, assign keyword | **Yes** | No | No | - |
| **Issue creator** | Private | regular, assign keyword | No | Yes | No | - |
| **Other** | Private | regular | No | Yes | No | - |
| **Other** | Private | assign keyword | No | Yes | Yes`*` | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Other** | Unassigned `help-wanted` (not good first issue) | regular, assign keyword | **Yes** | No | No | - |
| **Other** | Unassigned `help-wanted` + good first issue | regular | **Yes** | No | No | - |
| **Other** | Unassigned `help-wanted` + good first issue | assign keyword | **Yes** | No | Yes`*` | `BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE` |
| **Other** | `help-wanted` assigned to commenter | regular, assign keyword | **Yes** | No | No | - |
| **Other** | `help-wanted` assigned to someone else | regular | No | Yes | No | - |
| **Other** | `help-wanted` assigned to someone else | assign keyword | No | Yes | Yes`*` | `BOT_MESSAGE_ALREADY_ASSIGNED` |
| **Close contributor, Issue creator, Other** | Private | /assign command | No | Yes | Yes | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Close contributor, Issue creator, Other** | `help-wanted` assigned to commenter | /assign command | No | No | No | - (silent no-op) |
| **Close contributor, Issue creator, Other** | `help-wanted` assigned to someone else | /assign command | No | Yes | Yes | `BOT_MESSAGE_ALREADY_ASSIGNED` |
| **Close contributor, Issue creator, Other** | Unassigned `help-wanted` (not good first issue) | /assign command | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE` |
| **Close contributor, Issue creator, Other** | Unassigned `help-wanted` + good first issue, under limit | /assign command | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_SUCCESS` |
| **Close contributor, Issue creator, Other** | Unassigned `help-wanted` + good first issue, at limit | /assign command | No | Yes | Yes | Dynamic at-limit message |

`*` There is an additional optimization that prevents more than one bot message per hour to not overwhelm issue comment section

**`/assign` command** applies to all external contributors (close contributors, issue creators, and others). Core team members never reach the script. `/assign` must be the entire comment (trimmed, case-insensitive). All `/assign` Slack activity goes to `#support-dev-notifications` only.

**`/assign` cross-repo limit:** Contributors can have up to 2 assigned issues across all community repos (`COMMUNITY_REPOS`). Issues unassigned within the last 7 days count toward the limit (`currentAssignments + recentUnassignments >= MAX_ASSIGNED_ISSUES`).

In `scripts/constants.js` set:
- `BOT_MESSAGE_ISSUE_NOT_OPEN`: _Issue not open for contribution_ message text
- `BOT_MESSAGE_ALREADY_ASSIGNED`: _Issue already assigned_ message text
- `BOT_MESSAGE_ASSIGN_SUCCESS`: Assignment confirmation message
- `BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE`: Decline message for non-good-first-issue issues
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
