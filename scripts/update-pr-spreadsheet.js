const { google } = require('googleapis');
const { isContributor } = require('./utils');

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const toDate = timestamp => (timestamp ? timestamp.split('T')[0].replace("'", '') : '');

const toRow = pr => [
  pr.merged_at ? toDate(pr.merged_at) : pr.state,
  pr.html_url || '',
  pr.user.login || '',
  pr.title || '',
  pr.base.repo.name || '',
  toDate(pr.created_at),
  pr.requested_reviewers?.map(r => r.login).join(',') || '',
  pr.assignees?.map(a => a.login).join(',') || '',
];

async function collectRows({ github, context, core }, since) {
  const org = context.repo.owner;
  const items = await github.paginate(github.rest.search.issuesAndPullRequests, {
    q: `org:${org} is:pr is:public -repo:${org}/test-actions updated:>=${since}`,
    per_page: 100,
  });

  const rows = [];
  for (const item of items) {
    const { login } = item.user;
    if (!(await isContributor(login, item.author_association, { github, context, core }))) {
      continue;
    }
    const repo = item.repository_url.split('/').pop();
    const pull_number = item.number;
    const { data: pr } = await github.rest.pulls.get({ owner: org, repo, pull_number });
    rows.push(toRow(pr));
  }
  return rows;
}

function planSheetChanges(existingRows, rows, sheetName) {
  const rowIndexByUrl = new Map();
  for (let i = 1; i < existingRows.length; i++) {
    const url = existingRows[i][1];
    if (!rowIndexByUrl.has(url)) rowIndexByUrl.set(url, i);
  }

  const updates = [];
  const appends = [];
  for (const row of rows) {
    const index = rowIndexByUrl.get(row[1]);
    if (index === undefined) {
      appends.push(row);
      continue;
    }
    row.forEach((value, col) => {
      if (existingRows[index][col] !== value) {
        updates.push({ range: `${sheetName}!${COLUMNS[col]}${index + 1}`, values: [[value]] });
      }
    });
  }
  return { updates, appends };
}

async function authorize(googleCredentials) {
  try {
    const credentials = JSON.parse(googleCredentials);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
  } catch (error) {
    throw new Error(`Failed to authorize: ${error.message}.`);
  }
}

module.exports = async ({ github, context, core }) => {
  const sheetId = process.env.CONTRIBUTIONS_SPREADSHEET_ID;
  const sheetName = process.env.CONTRIBUTIONS_SHEET_NAME;
  const lookbackDays = Number(process.env.LOOKBACK_DAYS);
  const dryRun = process.env.DRY_RUN === 'true';

  try {
    const since = toDate(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString());
    const rows = await collectRows({ github, context, core }, since);
    core.info(`Found ${rows.length} contributor PRs updated since ${since}.`);

    if (dryRun) {
      for (const row of rows) core.info(JSON.stringify(row));
      return;
    }

    const sheets = await authorize(process.env.GOOGLE_CREDENTIALS);
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetName,
    });
    const { updates, appends } = planSheetChanges(data.values || [], rows, sheetName);

    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        resource: { data: updates, valueInputOption: 'RAW' },
      });
    }
    if (appends.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:H`,
        valueInputOption: 'RAW',
        resource: { values: appends },
      });
    }
    core.info(`Updated ${updates.length} cells and appended ${appends.length} rows.`);
  } catch (error) {
    core.setFailed(`An error occurred: ${error.message}`);
    throw error;
  }
};

module.exports.collectRows = collectRows;
module.exports.planSheetChanges = planSheetChanges;
