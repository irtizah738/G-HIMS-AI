import { NextResponse } from 'next/server';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'g-hims',
      runtime: getRuntimeMode(),
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
