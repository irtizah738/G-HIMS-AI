import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

async function authorize(req: NextRequest, tenantId: string) {
  const { context } = await deriveAuthoritativeContext(req, tenantId);
  const exportAllowed = context.roles.some((role) =>
    ['SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMINISTRATOR', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(role)
  );
  if (!exportAllowed) throw new Error('AUTHORIZATION_FAILURE: export role required');
  return context;
}

function googleToken(req: NextRequest): string {
  return String(req.headers.get('x-google-access-token') || '').trim();
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().toLowerCase();
    if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    await authorize(req, tenantId);

    const token = googleToken(req);
    if (!token) return NextResponse.json({ error: 'x-google-access-token is required' }, { status: 401 });

    const spreadsheetId = req.nextUrl.searchParams.get('spreadsheetId');
    const range = req.nextUrl.searchParams.get('range');
    const action = req.nextUrl.searchParams.get('action') || 'values';

    if (action === 'list') {
      const query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=25`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return NextResponse.json(await response.json(), { status: response.status });
    }

    if (!spreadsheetId) {
      return NextResponse.json({ error: 'spreadsheetId is required' }, { status: 400 });
    }

    const url = action === 'metadata'
      ? `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
      : `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range || 'A1:Z100')}`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export request failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json({ error: message }, { status: unauthorized ? 403 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    await authorize(req, tenantId);

    const token = googleToken(req);
    if (!token) return NextResponse.json({ error: 'x-google-access-token is required' }, { status: 401 });

    const { action, spreadsheetId, title, sheetsData, range, rows } = body;

    if (action === 'create') {
      const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: { title: title || `G-HIMS Export ${new Date().toISOString()}` },
          sheets: (sheetsData || [{ title: 'Sheet1' }]).map((sheet: any) => ({
            properties: { title: sheet.title },
          })),
        }),
      });
      return NextResponse.json(await response.json(), { status: response.status });
    }

    if (action === 'append') {
      if (!spreadsheetId || !range) {
        return NextResponse.json({ error: 'spreadsheetId and range are required' }, { status: 400 });
      }
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: rows || [] }),
        }
      );
      return NextResponse.json(await response.json(), { status: response.status });
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export request failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json({ error: message }, { status: unauthorized ? 403 : 500 });
  }
}
