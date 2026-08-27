/**
 * G-HIMS Google Sheets & Drive API Integration Service
 * Follows Google Workspace Integration specifications with zero-trust client token management.
 */

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

export interface SpreadsheetSheetInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount?: number;
  columnCount?: number;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  properties: {
    title: string;
    locale?: string;
    timeZone?: string;
  };
  sheets: Array<{
    properties: SpreadsheetSheetInfo;
  }>;
  spreadsheetUrl: string;
}

export interface SheetValueRange {
  range: string;
  majorDimension: 'ROWS' | 'COLUMNS';
  values: string[][];
}

/**
 * List spreadsheets from the user's Google Drive
 */
export async function listDriveSpreadsheets(accessToken: string): Promise<GoogleDriveFile[]> {
  const query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  const fields = 'files(id, name, mimeType, modifiedTime, webViewLink, owners)';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&orderBy=modifiedTime desc&pageSize=30`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Drive API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Fetch spreadsheet metadata (title, list of sheet tabs, and dimensions)
 * Avoid hardcoded sheet names by querying sheet metadata first.
 */
export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Sheets API metadata error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Read values from a specific spreadsheet range (e.g. "Census!A1:Z100")
 */
export async function getSpreadsheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string
): Promise<SheetValueRange> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Sheets API values error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Create a brand new Google Sheet with initial tabs and formatted data
 */
export async function createHospitalSpreadsheet(
  accessToken: string,
  title: string,
  sheetsData: Array<{
    title: string;
    headers: string[];
    rows: (string | number)[][];
  }>
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  // 1. Create spreadsheet structure
  const createPayload = {
    properties: {
      title: title || `G-HIMS Export - ${new Date().toISOString().split('T')[0]}`,
    },
    sheets: sheetsData.map((s) => ({
      properties: {
        title: s.title,
        gridProperties: {
          rowCount: Math.max(s.rows.length + 20, 100),
          columnCount: Math.max(s.headers.length + 5, 20),
          frozenRowCount: 1,
        },
      },
    })),
  };

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createPayload),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`Failed to create Google Spreadsheet: ${errorText}`);
  }

  const createdSheet = await createRes.json();
  const spreadsheetId = createdSheet.spreadsheetId;
  const spreadsheetUrl = createdSheet.spreadsheetUrl;

  // 2. Populate values in batch
  const dataPayload = sheetsData.map((s) => ({
    range: `'${s.title}'!A1`,
    majorDimension: 'ROWS',
    values: [s.headers, ...s.rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))))],
  }));

  const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values:batchUpdate`;

  const updateRes = await fetch(batchUpdateUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: dataPayload,
    }),
  });

  if (!updateRes.ok) {
    console.warn('Values batch update warning:', await updateRes.text());
  }

  return { spreadsheetId, spreadsheetUrl };
}

/**
 * Append rows to an existing sheet tab
 */
export async function appendSpreadsheetRows(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  rows: (string | number)[][]
): Promise<{ updatedRows: number }> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to append rows to spreadsheet: ${errorText}`);
  }

  const data = await response.json();
  return { updatedRows: data.updates?.updatedRows || rows.length };
}
