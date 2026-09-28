import { NextResponse } from 'next/server';
import { evaluateServiceReadiness } from '@/server/operations/readiness-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const readiness = await evaluateServiceReadiness();
  return NextResponse.json(
    {
      status: readiness.ready ? 'ready' : 'not_ready',
      mode: readiness.mode,
      checks: readiness.checks,
      blockers: readiness.findings
        .filter((finding) => finding.severity === 'BLOCKER')
        .map((finding) => finding.code),
      warnings: readiness.findings
        .filter((finding) => finding.severity === 'WARNING')
        .map((finding) => finding.code),
      timestamp: new Date().toISOString(),
    },
    {
      status: readiness.ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
