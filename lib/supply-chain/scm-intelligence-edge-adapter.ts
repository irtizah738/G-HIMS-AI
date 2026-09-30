'use client';
import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type { GenerateScmIntelligenceSnapshotPayload, ScmOperationalSnapshot } from '@/types/scm-intelligence';

export async function generateScmIntelligenceSnapshotEdge(
  payload:GenerateScmIntelligenceSnapshotPayload,idempotencyKey?:string
):Promise<ScmOperationalSnapshot>{
  const result=await executeActiveTenantCommand<ScmOperationalSnapshot>(
    'GenerateScmIntelligenceSnapshotCommand',
    payload as unknown as Record<string,unknown>,
    {idempotencyKey,schemaVersion:1}
  );
  if(!result.success)throw new Error(result.error?.message||'SCM intelligence generation failed.');
  return result.data as ScmOperationalSnapshot;
}
