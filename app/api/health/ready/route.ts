import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json(
        { status: 'not_ready', service: 'g-hims', runtime: getRuntimeMode() },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      { status: 'ready', service: 'g-hims', runtime: getRuntimeMode() },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { status: 'not_ready', service: 'g-hims', runtime: getRuntimeMode() },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
