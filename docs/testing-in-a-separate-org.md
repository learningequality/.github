# Testing in a separate organization

Most testing belongs in `learningequality/test-actions`, where the app and the secrets are already
in place. See [testing-automations](./testing-automations.md).

A separate organization is worth the setup when:

- You are changing the bot app itself, its permissions or its installation scope. Those cannot be
  tried on the production app.
- You need different secret values, such as another Slack webhook, without changing what everyone
  else testing in `test-actions` sees.
- You are changing discovery. `--only` covers one repo, while an organization lets you arrange
  several: in sync, drifted, archived, and a fork.

## Setting one up

1. Create an organization, or use one you own.
2. Register a GitHub App in it, with repository permissions for contents, issues and pull requests
   set to read and write, and metadata to read. Install it on the repos you will test with.
3. Generate a private key for the app. Set `LE_BOT_APP_ID` to the app's id and `LE_BOT_PRIVATE_KEY`
   to the whole key file, at organization or repository level.
4. Add `SLACK_WEBHOOK_URL` and `SLACK_COMMUNITY_NOTIFICATIONS_WEBHOOK_URL` if you want the Slack
   automations. Without them those steps fail, and the rest still run.
5. For the spreadsheet, create a Google Cloud project, enable the Google Sheets API, and create a
   service account. On that service account open the Keys tab, add a key, and choose JSON. Set
   `GH_UPLOADER_GCP_SA_CREDENTIALS` to the whole file.
6. Create a Google Sheet and share it with the service account's `client_email` as an editor. That
   sharing is the only permission that matters, since no IAM role is involved. Set
   `CONTRIBUTIONS_SPREADSHEET_ID` to the id in the sheet's URL and `CONTRIBUTIONS_SHEET_NAME` to the
   tab name.
7. Copy `automation-template.yml` into a repo there as `.github/workflows/automation.yml`.

## Running against it

Set `SYNC_ORG` to the organization:

```
SYNC_ORG=<org> GITHUB_TOKEN=<token> node scripts/sync-automation-template.js --dry-run
```

`SYNC_ORG` and `--only` compose, so a run can still be narrowed to one repo inside it.

Installation is per repo and separate from the app's permissions. A repo the app is not installed on
never appears, because discovery only sees what the token can see.
