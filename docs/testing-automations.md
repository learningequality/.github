# Testing the automations

Test in [`learningequality/test-actions`](https://github.com/learningequality/test-actions). The bot
app is installed there and the secrets resolve, so there is nothing to set up.

It holds a copy of `automation-template.yml` at `.github/workflows/automation.yml`, making it a
consumer like any other. Every automation runs there against the reusable workflows on `main`.

## Testing an automation

Trigger the event you want to test: open a pull request, comment on an issue, add a label, etc. Then
check the run in the Actions tab.

Jobs that do not match the event are reported as skipped, which is normal. If everything is skipped,
the `if:` condition on each job did not match, so check the event first.

### Automations that need an outside contributor

Some automations run only when `is-contributor` is true, meaning the author is not a member of the
organization. An org member cannot trigger them, so they skip. These are `review-requested`,
`pull-request-label`, `contributor-pr-reply`, `contributor-issue-comment`, and
`update-pr-spreadsheet`, plus `holiday-message` when enabled.

Use a second GitHub account that is not in the organization. It needs no permissions, secrets, or
app. For a pull request, it forks `test-actions` and opens a pull request back to it.
`pull_request_target` then runs in `test-actions` with `test-actions`' secrets rather than the
fork's. For an issue or comment, no fork is needed.

Keep that account out of the organization. Adding it makes these automations skip again.

`update-pr-spreadsheet` writes to a test sheet rather than the production sheet because
`CONTRIBUTIONS_SPREADSHEET_ID` and `CONTRIBUTIONS_SHEET_NAME` are set as repository secrets there. A
repository secret takes precedence over an organization secret with the same name.

## Testing the sync workflow

Run `Sync automation template` from the Actions tab with `only` set to `test-actions`. This limits
the run to one repo, so it cannot open a pull request anywhere else. Leave `dry_run` on to see what
it would do, or turn it off to let it open a pull request.

Without `only`, the workflow considers every consumer in the organization, which is how it runs on
its schedule.

To see it propose a change, modify `.github/workflows/automation.yml` in `test-actions` so that it
differs from the template, then run it with `only: test-actions`.

## Testing a change to a reusable workflow

Point a caller at your branch, for example:

`uses: learningequality/.github/.github/workflows/automation.yml@my-branch`

Put that caller at a path other than `.github/workflows/automation.yml`. The sync reads exactly that
path, so a branch-pinned caller there looks like drift and gets a pull request on every run.

## Clearing up

Close test pull requests and delete their branches. Leave `.github/workflows/automation.yml` in
place, since the repo is only a consumer while that file exists.

## Testing in a separate organization

Changing the bot app itself, using different secret values, or changing discovery across several
repos needs an organization you control. See
[testing in a separate organization](./testing-in-a-separate-org.md).
