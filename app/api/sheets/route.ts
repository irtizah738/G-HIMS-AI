import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization');
  if (!token) {
    return NextResponse.json({ error: 'Authorization header is required' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const spreadsheetId = searchParams.get('spreadsheetId');
  const range = searchParams.get('range');
  const action = searchParams.get('action') || 'values';

  try {
    if (action === 'list') {
      const query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          query
        )}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=25`,
        {
          headers: { Authorization: token },
        }
      );
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (!spreadsheetId) {
      return NextResponse.json({ error: 'spreadsheetId query param is required' }, { status: 400 });
    }

    if (action === 'metadata') {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`, {
        headers: { Authorization: token },
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    // Default: read values
    const sheetRange = range || 'A1:Z100';
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
        sheetRange
      )}`,
      {
        headers: { Authorization: token },
      }
    );
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization');
  if (!token) {
    return NextResponse.json({ error: 'Authorization header is required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, spreadsheetId, title, sheetsData, range, rows } = body;

    if (action === 'create') {
      const createPayload = {
        properties: { title: title || `G-HIMS Export ${new Date().toLocaleDateString()}` },
        sheets: (sheetsData || [{ title: 'Sheet1' }]).map((s: any) => ({
          properties: { title: s.title },
        })),
      };

      const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createPayload),
      });

      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === 'append') {
      if (!spreadsheetId || !range) {
        return NextResponse.json({ error: 'spreadsheetId and range are required' }, { status: 400 });
      }

      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: rows || [] }),
        }
      );

      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
