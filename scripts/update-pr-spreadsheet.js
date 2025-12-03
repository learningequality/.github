const { google } = require('googleapis');

// Extract relevant data from the event payload
const extractPRData = payload => {
  const pr = payload.pull_request;
  return {
    merged_at: pr.merged_at,
    html_url: pr.html_url,
    user_login: pr.user.login,
    title: pr.title,
    repo_name: pr.base.repo.name,
    created_at: pr.created_at,
    requested_reviewers: pr.requested_reviewers?.map(r => r.login).join(',') || '',
    assignees: pr.assignees?.map(a => a.login).join(',') || '',
    user_site_admin: pr.user.site_admin,
    user_type: pr.user.type,
    author_association: pr.author_association,
    state: pr.state,
  };
};

// Set up GoogleAuth for Google Sheets API
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

// Update Google Sheets with pull request data
async function updateSpreadsheet(pullRequest, sheetId, sheetName, googleCredentials) {
  const sheets = await authorize(googleCredentials);
  const prData = [
    pullRequest.merged_at
      ? pullRequest.merged_at.split('T')[0].replace("'", '')
      : pullRequest.state === 'closed'
        ? 'closed'
        : pullRequest.state,
    pullRequest.html_url || '',
    pullRequest.user_login || '',
    pullRequest.title || '',
    pullRequest.repo_name || '',
    pullRequest.created_at ? pullRequest.created_at.split('T')[0].replace("'", '') : '',
    pullRequest.requested_reviewers || '',
    pullRequest.assignees || '',
  ];

  try {
    // Fetch existing rows from the sheet
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetName,
    });

    const existingRows = data.values || [];
    let rowToUpdate = null;

    // Find the row that corresponds to the pull request URL
    for (let i = 1; i < existingRows.length; i++) {
      if (existingRows[i][1] === pullRequest.html_url) {
        rowToUpdate = i + 1; // Get the row number to update
        break;
      }
    }

    if (rowToUpdate) {
      // Check if row data has changed and update if necessary
      const existingData = existingRows[rowToUpdate - 1];
      const prDataString = JSON.stringify(prData);
      const existingDataString = JSON.stringify(existingData);

      if (prDataString !== existingDataString) {
        // console.log(`Detected changes for row ${rowToUpdate}.`);

        const updates = [];
        const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        for (let col = 0; col < prData.length; col++) {
          if (existingData[col] !== prData[col]) {
            updates.push({
              range: `${sheetName}!${columns[col]}${rowToUpdate}`,
              values: [[prData[col]]],
            });
          }
        }

        if (updates.length > 0) {
          // Batch update changed columns
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: sheetId,
            resource: {
              data: updates,
              valueInputOption: 'RAW',
            },
          });
          // console.log(`Updated row ${rowToUpdate} in Google Sheets.`);
        } else {
          // console.log(`No changes detected for row ${rowToUpdate}.`);
        }
      } else {
        // console.log(`No changes detected for row ${rowToUpdate}.`);
      }
    } else {
      // Append new row starting from column B
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:H`,
        valueInputOption: 'RAW',
        resource: { values: [prData] },
      });
      // console.log(`Added new row to Google Sheets.`);
    }
  } catch (error) {
    throw new Error(`Failed to update spreadsheet: ${error.message}`);
  }
}

module.exports = async ({ context, core }) => {
  const sheetId = process.env.CONTRIBUTIONS_SPREADSHEET_ID;
  const sheetName = process.env.CONTRIBUTIONS_SHEET_NAME;
  const googleCredentials = process.env.GH_UPLOADER_GCP_SA_CREDENTIALS;

  try {
    const prData = extractPRData(context.payload);
    await updateSpreadsheet(prData, sheetId, sheetName, googleCredentials);
  } catch (error) {
    core.setFailed(`An error occurred: ${error.message}`);
    throw error;
  }
};
