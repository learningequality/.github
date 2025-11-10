const { google } = require('googleapis');

// Extract relevant data from the event payload
const extractPRData = (payload) => {
  const pr = payload.pull_request;
  return {
    merged_at: pr.merged_at,
    html_url: pr.html_url,
    user_login: pr.user.login,
    title: pr.title,
    repo_name: pr.base.repo.name,
    created_at: pr.created_at,
    requested_reviewers: pr.requested_reviewers.map(r => r.login).join(','),
    assignees: pr.assignees.map(a => a.login).join(','),
    user_site_admin: pr.user.site_admin,
    user_type: pr.user.type,
    author_association: pr.author_association,
    state: pr.state
  };
};

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME;
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;

// Validate environment variables
function validateEnvVariables() {
  const missingVars = [];
  if (!SPREADSHEET_ID) missingVars.push("SPREADSHEET_ID");
  if (!SHEET_NAME) missingVars.push("SHEET_NAME");
  if (!GOOGLE_CREDENTIALS) missingVars.push("GOOGLE_CREDENTIALS");

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
  }
}

// Set up GoogleAuth for Google Sheets API
async function authorize() {
  try {
    const credentials = JSON.parse(GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: "v4", auth: authClient });
  } catch (error) {
    throw new Error(
      `Failed to authorize: ${error.message}. Please check your GOOGLE_CREDENTIALS.`
    );
  }
}

// Update Google Sheets with pull request data
async function updateSpreadsheet(pullRequest) {
  const sheets = await authorize();
  const prData = [
    pullRequest.merged_at ? pullRequest.merged_at.split("T")[0].replace("'", "") : pullRequest.state === "closed" ? "closed" : pullRequest.state,
    pullRequest.html_url || "",
    pullRequest.user_login || "",
    pullRequest.title || "",
    pullRequest.repo_name || "",
    pullRequest.created_at
      ? pullRequest.created_at.split("T")[0].replace("'", "")
      : "",
    pullRequest.requested_reviewers || "",
    pullRequest.assignees || "",
  ];

  try {
    // Fetch existing rows from the sheet
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: SHEET_NAME,
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
        console.log(`Detected changes for row ${rowToUpdate}.`);

        const updates = [];
        const columns = ["A", "B", "C", "D", "E", "F", "G", "H"];
        for (let col = 0; col < prData.length; col++) {
          if (existingData[col] !== prData[col]) {
            updates.push({
              range: `${SHEET_NAME}!${columns[col]}${rowToUpdate}`,
              values: [[prData[col]]],
            });
          }
        }

        if (updates.length > 0) {
          // Batch update changed columns
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
              data: updates,
              valueInputOption: "RAW",
            },
          });
          console.log(`Updated row ${rowToUpdate} in Google Sheets.`);
        } else {
          console.log(`No changes detected for row ${rowToUpdate}.`);
        }
      } else {
        console.log(`No changes detected for row ${rowToUpdate}.`);
      }
    } else {
      // Append new row starting from column B
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:H`,
        valueInputOption: "RAW",
        resource: { values: [prData] },
      });
      console.log(`Added new row to Google Sheets.`);
    }
  } catch (error) {
    throw new Error(`Failed to update spreadsheet: ${error.message}`);
  }
}

// Validate environment variables
try {
  validateEnvVariables();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Get the GitHub event data
const githubEvent = JSON.parse(process.env.GITHUB_EVENT);

// Extract PR data and run the script
const prData = extractPRData(githubEvent);
updateSpreadsheet(prData).catch((error) => {
  console.error("An error occurred:", error.message);
  process.exit(1);
});
