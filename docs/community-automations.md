# `contributor-issue-comment`

Manages GitHub issue comments. Sends Slack notifications and GitHub bot replies.

| Contributor type | Issue type | Comment type | #support-dev | #support-dev-notifications | GitHub bot | GitHub bot message |
|------------------|------------|--------------|--------------|---------------------------|------------|-------------------|
| **Core team** | Any | Any | No | No | No | - |
| **Close contributor** | Any | regular, [assign keyword](https://github.com/learningequality/.github/blob/main/scripts/constants.js#L44) | **Yes** | No | No | - |
| **Issue creator** | `help-wanted` | regular, [assign keyword](https://github.com/learningequality/.github/blob/main/scripts/constants.js#L44) | **Yes** | No | No | - |
| **Issue creator** | Private | regular, [assign keyword](https://github.com/learningequality/.github/blob/main/scripts/constants.js#L44) | No | Yes | No | - |
| **Other** | Private | regular | No | Yes | No | - |
| **Other** | Private | [assign keyword](https://github.com/learningequality/.github/blob/main/scripts/constants.js#L44) | No | Yes | Yes`*` | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Other** | Unassigned `help-wanted` (not good first issue) | regular, [assign keyword](https://github.com/learningequality/.github/blob/main/scripts/constants.js#L44) | **Yes** | No | No | - |
| **Other** | Unassigned `help-wanted` + good first issue | regular | **Yes** | No | No | - |
| **Other** | Unassigned `help-wanted` + good first issue | [assign keyword](https://github.com/learningequality/.github/blob/main/scripts/constants.js#L44) | **Yes** | No | Yes`*` | `BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE` |
| **Other** | `help-wanted` assigned to commenter | regular, [assign keyword](https://github.com/learningequality/.github/blob/main/scripts/constants.js#L44) | **Yes** | No | No | - |
| **Other** | `help-wanted` assigned to someone else | regular | No | Yes | No | - |
| **Other** | `help-wanted` assigned to someone else | [assign keyword](https://github.com/learningequality/.github/blob/main/scripts/constants.js#L44) | No | Yes | Yes`*` | `BOT_MESSAGE_ALREADY_ASSIGNED` |
| **Close contributor** | Private | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Close contributor** | `help-wanted` assigned to commenter | `/assign` command | No | No | No | - (silent no-op) |
| **Close contributor** | `help-wanted` assigned to someone else | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ALREADY_ASSIGNED` |
| **Close contributor** | Unassigned `help-wanted` (not good first issue) | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE` |
| **Close contributor** | Unassigned `help-wanted` + good first issue, under limit | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_SUCCESS` |
| **Close contributor** | Unassigned `help-wanted` + good first issue, at limit | `/assign` command | No | Yes | Yes | Dynamic at-limit message |
| **Issue creator** | Private | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Issue creator** | `help-wanted` assigned to commenter | `/assign` command | No | No | No | - (silent no-op) |
| **Issue creator** | `help-wanted` assigned to someone else | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ALREADY_ASSIGNED` |
| **Issue creator** | Unassigned `help-wanted` (not good first issue) | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE` |
| **Issue creator** | Unassigned `help-wanted` + good first issue, under limit | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_SUCCESS` |
| **Issue creator** | Unassigned `help-wanted` + good first issue, at limit | `/assign` command | No | Yes | Yes | Dynamic at-limit message |
| **Other** | Private | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Other** | `help-wanted` assigned to commenter | `/assign` command | No | No | No | - (silent no-op) |
| **Other** | `help-wanted` assigned to someone else | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ALREADY_ASSIGNED` |
| **Other** | Unassigned `help-wanted` (not good first issue) | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE` |
| **Other** | Unassigned `help-wanted` + good first issue, under limit | `/assign` command | No | Yes | Yes | `BOT_MESSAGE_ASSIGN_SUCCESS` |
| **Other** | Unassigned `help-wanted` + good first issue, at limit | `/assign` command | No | Yes | Yes | Dynamic at-limit message |

`*` There is an additional optimization that prevents more than one bot message per hour to not overwhelm issue comment section

**`/assign` command** applies to all external contributors (close contributors, issue creators). Detected when the comment contains `/assign` as a standalone word (`/assign me` matches, `/assignee` does not). All `/assign` Slack activity goes to `#support-dev-notifications` only.

**`/assign` cross-repo limit:** Contributors can have up to 2 assigned issues across all community repos (`COMMUNITY_REPOS`). Issues unassigned within the last 7 days count toward the limit (`currentAssignments + recentUnassignments >= MAX_ASSIGNED_ISSUES`).

In `scripts/constants.js` set:
- `BOT_MESSAGE_ISSUE_NOT_OPEN`: _Issue not open for contribution_ message text
- `BOT_MESSAGE_ALREADY_ASSIGNED`: _Issue already assigned_ message text
- `BOT_MESSAGE_ASSIGN_SUCCESS`: Assignment confirmation message
- `BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE`: Decline message for non-good-first-issue issues
- `BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE`: Keyword reply with `/assign` guidance

# `good-first-issue-comment`

Posts a guidance comment when the `good first issue` or `help wanted` label is applied to an issue. Explains the `/assign` command, issue limits, cooldown, and links to contributing guidelines.

- Only posts if the issue also has `help wanted` label
- Deletes any previous guidance comment from the bot before posting a new one
- Identified by the `<!-- ASSIGN_GUIDANCE -->` HTML comment marker

In `scripts/constants.js` set:
- `BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE`: Guidance message text

# `contributor-pr-reply`

Sends reply to a community pull request, and acts on the issue that pull request closes.

What happens depends on who the linked issue is assigned to:

- assigned to someone else: posts a closing message instead of the reply, closes the pull request, and notifies Slack
- assigned to the author: sends the reply, then requests `rtibblesbot` for review and adds the `community-review` label
- not assigned, or no issue linked: sends the reply

An issue counts as linked only when the description closes it, for example `Fixes #123`. Assignments on any other issue are ignored. A pull request with no linked issue is asked to add one under `## References`.

If the author is assigned to any linked issue, the pull request is not closed.

In `scripts/constants.js` set:
- `BOT_MESSAGE_PULL_REQUEST`: Message text
- `BOT_MESSAGE_LINK_ISSUE`: Text added when no issue is linked
- `BOT_MESSAGE_PULL_REQUEST_CLOSED`: Closing message text

# `pull-request-template`

Fails the run when a pull request description does not carry the sections its template requires. It runs on `opened`, `edited` and `reopened`, so a corrected description clears the check. Bot authors are exempt.

The template is resolved the way GitHub resolves it: the repo's own copy first, in all six places GitHub reads them from, and this repo's `.github/PULL_REQUEST_TEMPLATE.md` next. It is read from the pull request's base branch, so a pull request cannot relax the rules it is judged by.

A section is required when its heading carries a `<!-- REQUIRED -->` comment in the template:

```markdown
## Summary
<!-- REQUIRED -->
```

A template that marks no section requires every level-two heading, so that a repo is strict rather than silently unchecked. To change what a repo requires, edit the markers in that repo's template. No change is required here.

Four states fail, and the log names every one of them rather than stopping at the first:

- the heading is missing from the description
- the section holds no text, once HTML comments are stripped
- the section still holds the `…` placeholder
- the section still reads word for word as the template wrote it

The failed check is the only report. Nothing is posted on the pull request.

# `issue-validation` and `issue-validation-done`

These two automations ask `rtibblesbot` to validate claims in contributor-submitted issues and track the review while it is in progress.

## `issue-validation`

Runs on `issues: [opened]`. It proceeds only if the repository is in `ISSUE_VALIDATION_REPOS`, the issue opener is a contributor, and the issue does not already have the `community-issue-review` label.

It posts a comment mentioning `@rtibblesbot` and adds the label. If the label does not exist in the repository, the add-label call creates it.

**The mention is essential.** The agent polls its GitHub notifications and has no inbound endpoint, so a mention is the only way to reach it. Adding a label does not generate a notification, and a handle inside backticks, as in `BOT_MESSAGE_RTIBBLESBOT_REVIEW`, does not trigger one either.

## `issue-validation-done`

Runs on `issue_comment: [created]`. It removes the `community-issue-review` label only when both conditions are met:

- The comment contains the `<!-- ISSUE_VALIDATION -->` marker.
- The comment author is `rtibblesbot`.

Both checks are necessary. Anyone can include the marker in a comment, and `rtibblesbot` also comments on issues for other reasons.

The leaf workflow tests both conditions in its job `if:`, as `resolve-bot-pr-threads` does, so an ordinary comment starts no runner. The script tests them again.

This logic cannot live in `contributor-issue-comment`, because that automation deliberately ignores bot comments.

It also posts one line to Slack `#support-dev` for every validation comment, so a maintainer knows to follow up. The line carries the verdict, a link to the comment, a link to the issue, the reporter's handle, and the follow-up the verdict calls for:

```
*[kolibri] <comment-url|Validation: duplicate of #15001> on issue: <issue-url|Title> reported by _octocat_* _(consider closing as duplicate)_
```

`ISSUE_VALIDATION_FOLLOW_UPS` holds the six verdicts and their follow-ups. `learningequality/coding-agent#1229` fixes the vocabulary from the agent's side.

The agent's LLM session writes the verdict line, so its shape varies. `readVerdict` therefore mirrors the agent's own reader, which tolerates a missing bold, a colon on either side of it, a lowercase label, a list or quote prefix, backticks, and trailing punctuation. Keep the two readers in step. A stricter reader here reports a healthy run as broken.

A comment outside all of that reads `Validation: no verdict read` and asks a maintainer to check the agent run. The agent posts no comment at all when it states no verdict, so this line means the rendering drifted, not that a verdict is missing.

## Handling stalled reviews

The weekly `unassign-inactive-issues` run also sweeps stalled validations through `scripts/issue-review-sweep.js`.

If the agent never responds, for example, because the service is down or all available tokens have reached their limits, the label would otherwise remain indefinitely. The sweep removes it when the issue's `labeled` event is older than `ISSUE_REVIEW_MAX_DAYS` days.

## Scope and configuration

Neither automation closes issues or acts on the validation findings. The agent's comment recommends whether the issue should be closed; a maintainer must request that action in a reply.

Configure the following constants in `scripts/constants.js`:

- `ISSUE_VALIDATION_REPOS`: The repositories where validation runs, which are the community repositories plus the sandbox the automations are tested in.
- `LABEL_COMMUNITY_ISSUE_REVIEW`: The label applied while validation is in progress.
- `ISSUE_VALIDATION_MARKER`: The marker that signals validation completion, shared with `learningequality/coding-agent`.
- `ISSUE_REVIEW_MAX_DAYS`: The maximum age of the label before the sweep clears it.
- `BOT_MESSAGE_ISSUE_VALIDATION`: The comment text posted to request validation.
- `ISSUE_VALIDATION_FOLLOW_UPS`: The six verdicts and the follow-up each one asks a maintainer for, used in the Slack line.

# `holiday-message`

Sends a holiday message to community pull requests and issue comments.

In `scripts/contants.js` set:
- `HOLIDAY_MESSAGE`: Message text

Before/after holidays, toggle `enabled:` for `holiday-message` in [`automation-registry.yml`](../automation-registry.yml) and regenerate (see [the automation entry point](./automation.md)) - no per-repo changes needed.
