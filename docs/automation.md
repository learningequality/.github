# Automation entry point

Every learningequality repo that wants our shared bot automations (review-request routing,
contributor replies, issue header management, the community-contribution spreadsheet, etc.)
copies a single file: `automation-template.yml`. There is nothing else to maintain per repo —
no per-automation caller, no hand-written `on:` block to keep in sync.

## How it fits together

```
consumer repo's .github/workflows/automation.yml   (copy of automation-template.yml)
  -> .github/workflows/automation.yml               (this repo, reusable, one job per automation)
       -> leaf workflow (e.g. review-requested.yml)
            -> is-contributor.yml                   (where applicable)
```

That's 4 levels deep, GitHub's maximum for reusable workflow nesting - `automation.yml` calls
leaf workflows directly rather than going through an intermediate dispatcher.

`automation-registry.yml` is the single source of truth: one entry per automation, declaring its
leaf workflow, the events/types (or schedule) that should trigger it, the `if:` condition used to
dispatch it, which secrets it needs, and its job-level permissions (defaults to `contents: read`). `scripts/generate-automation.js`
reads the registry and writes:

- `.github/workflows/automation.yml` - the reusable workflow jobs
- `automation-template.yml` - the file every consumer repo copies, including the generated
  exhaustive `on:` block (the union of every enabled automation's events/types)
- `.github/workflows/automation-caller.yml` - this repo's own copy of the template, so `.github`
  runs the automations it publishes

A pre-commit hook (`generate-automation`, run via `prek`) regenerates and fails the commit if the
checked-in files don't match what the registry produces - so the generated files can never drift
from the registry.

## Onboarding a new repo

Copy `automation-template.yml` from this repo into the new repo as `.github/workflows/automation.yml`.
No edits required. Then set the secrets:

| Secret | Required | Purpose |
|--------|----------|---------|
| `LE_BOT_APP_ID` | yes | GitHub App ID for bot authentication |
| `LE_BOT_PRIVATE_KEY` | yes | GitHub App private key for bot authentication |
| `SLACK_WEBHOOK_URL` | no | Slack `#support-dev` channel webhook |
| `SLACK_COMMUNITY_NOTIFICATIONS_WEBHOOK_URL` | no | Slack `#support-dev-notifications` channel webhook |
| `CONTRIBUTIONS_SPREADSHEET_ID` | no | Google Sheets spreadsheet ID for PR tracking |
| `CONTRIBUTIONS_SHEET_NAME` | no | Sheet name within the spreadsheet |
| `GH_UPLOADER_GCP_SA_CREDENTIALS` | no | GCP service account credentials for Sheets access |

Every automation except `resolve-bot-pr-threads` authenticates as `learning-equality-bot[bot]`, the
GitHub App behind `LE_BOT_APP_ID`, so the two required secrets must be set. `resolve-bot-pr-threads`
uses the default `GITHUB_TOKEN` instead.

Optional means that you accept losing the automations that use the secret. It does not mean that
they degrade gracefully. The generated caller forwards every key, so an absent secret reaches the
leaf workflow as an empty string, and every automation that needs it fails at run time.
`SLACK_COMMUNITY_NOTIFICATIONS_WEBHOOK_URL` reaches four of them.

## Adding or toggling an automation

1. Edit `automation-registry.yml`: add a new entry, or flip an existing one's `enabled: true/false`
   (e.g. to switch `holiday-message` on/off seasonally - no per-repo changes needed, every consumer
   picks it up the next time they pull `automation.yml@main`).
2. Run `node scripts/generate-automation.js` to regenerate `automation.yml`, `automation-template.yml`,
   and `automation-caller.yml`.
3. Commit the registry change together with the regenerated files (pre-commit will refuse the
   commit otherwise).
4. If the change adds a new event/type that no existing automation triggers on, every consumer repo
   picks up the wider `on:` block the next time they re-copy `automation-template.yml` - existing
   copies keep running on their current `on:` block until then, since GitHub workflow triggers are
   evaluated from the file checked into the consumer repo itself, not from this repo.

## Keeping the copies in sync

Most registry changes reach consumers automatically because their copied file only says:
`uses: learningequality/.github/.github/workflows/automation.yml@main`. A consumer needs its file
updated whenever its copy no longer matches the template, which happens in two ways.

The template changes here, such as when a new event or activity type is added to the `on:` union,
permissions are widened, or the secret list changes. Or the consumer's own tooling rewrites its
copy, which is reported as a `toolchain-conflict` below.

`.github/workflows/sync-automation-template.yml` handles this. It runs weekly, on manual dispatch,
and whenever `automation-template.yml` changes on `main`.

It discovers the consumers by walking the org's repos, skipping archived ones and forks, and keeping
every repo whose `.github/workflows/automation.yml` calls this repo's `automation.yml`. Each pull
request targets that repo's default branch, which is the only branch GitHub evaluates workflow
triggers from.

For each consumer it compares the copy with the template and opens a pull request when they differ.
A repo that is already in sync gets nothing, while a repo with an existing sync pull request has
that pull request updated rather than a second one opened.

The workflow only proposes changes. It opens pull requests on a branch, never commits to a default
branch, and never merges, approves, or enables auto-merge. A core maintainer in each consumer repo
gives the final review and merges under that repo's own rules.

Run it with `dry_run` to see which repos have drifted without opening any pull requests.

Two results turn the run red and require action:

- `error` means the repo could not be read or written. The app already has the permissions required
  for syncing, so this is usually a transient API failure or the app not being installed on that
  repo. Check the installation first for a recently added repo.
- `toolchain-conflict` means a sync pull request was merged, the template has not changed since, and
  the file has drifted again. The repo's own tooling is rewriting the copy, so the template is not
  stable under that toolchain. Fix the template rather than reopening the pull request.

A third result, `declined`, keeps the run green and requires no action. It means a core maintainer
closed the last sync pull request without merging it, so the workflow leaves that repo alone until
the template changes again. The repo remains drifted in the meantime. To restore it sooner, copy the
template in by hand.

To onboard a repo, copy the template in and make sure the `learning-equality-bot[bot]` app is
installed on it. The next run picks it up. A repo on which the app is not installed stays invisible
to the sync, so the installation is what enrols it.

A repo with its own pull request template, or a check on the description, needs an entry under
`consumers` in `automation-registry.yml` carrying a `body_template`. The workflow inserts the
generated text wherever `{{explanation}}` appears, so the body follows that repo's own section
order. `kolibri-design-system` needs one because its `check-description` job fails unless the body
contains a Changelog block. Every other consumer needs no entry at all.
