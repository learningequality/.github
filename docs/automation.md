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
dispatch it, and which secrets it needs (required vs. optional). `scripts/generate-automation.js`
reads the registry and writes:

- `.github/workflows/automation.yml` - the reusable workflow jobs
- `automation-template.yml` - the file every consumer repo copies, including the generated
  exhaustive `on:` block (the union of every enabled automation's events/types)
- `.github/workflows/automation-caller.yml` - this repo dogfeeding the same template against itself

A pre-commit hook (`generate-automation`, run via `prek`) regenerates and fails the commit if the
checked-in files don't match what the registry produces - so the generated files can never drift
from the registry.

## Onboarding a new repo

Copy `automation-template.yml` from this repo into the new repo as `.github/workflows/automation.yml`.
No edits required. Make sure the repo has access to the required secrets (`LE_BOT_APP_ID`,
`LE_BOT_PRIVATE_KEY`); the optional ones (Slack webhooks, the contributions spreadsheet, GCP
credentials) can be left unset - automations that don't need them still run.

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
