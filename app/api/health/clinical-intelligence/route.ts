import { NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { evaluateClinicalIntelligenceProductionConfig } from '@/lib/clinical/intelligence/clinical-intelligence-production-policy';
import { CLINICAL_SAFETY_POLICY_VERSION } from '@/types/clinical-intelligence-safety';
import { CI10I_PRODUCTION_POLICY_VERSION } from '@/types/clinical-intelligence-production';

export const dynamic = 'force-dynamic';

export async function GET() {
  const runtime = getRuntimeMode();
  const policy = evaluateClinicalIntelligenceProductionConfig(
    process.env,
    runtime
  );
  const blockers = [...policy.blockers];

  const auth = getAdminAuth();
  const db = getAdminFirestore();

  if (!auth) blockers.push('CI10I_FIREBASE_ADMIN_AUTH_UNAVAILABLE');
  if (!db) blockers.push('CI10I_FIRESTORE_ADMIN_UNAVAILABLE');

  if (db) {
    try {
      await db.collection('_ghims_operational').limit(1).get();
    } catch {
      blockers.push('CI10I_FIRESTORE_CONNECTIVITY_FAILED');
    }
  }

  const ready = blockers.length === 0;

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'not_ready',
      service: 'g-hims-clinical-intelligence',
      runtime,
      policyVersion: CI10I_PRODUCTION_POLICY_VERSION,
      safetyPolicyVersion: CLINICAL_SAFETY_POLICY_VERSION,
      ai: {
        state: policy.ai.state,
        provider: policy.ai.provider || null,
        model: policy.ai.model || null,
        timeoutMs: policy.ai.timeoutMs || null,
        providerApproved: policy.ai.providerApproved,
        modelApproved: policy.ai.modelApproved,
        credentialsConfigured: policy.ai.credentialsConfigured,
      },
      blockers,
      timestamp: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
