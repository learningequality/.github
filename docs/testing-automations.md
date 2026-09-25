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

## When this is not enough

Testing against an app or secrets that are not in production requires a separate organization, with
its own app installed and its own secrets. Point the sync at it with `SYNC_ORG`.
