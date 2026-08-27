/**
 * G-HIMS Offline Batch Synchronization API Route
 * POST /api/sync/batch
 */

import { NextRequest, NextResponse } from 'next/server';
import { OfflineReconciliationDomainService } from '@/lib/backend/services/offline-reconciliation-domain-service';
import { OfflineSyncBatch, CommandContext } from '@/lib/backend/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const batch: OfflineSyncBatch = body.batch;

    if (!batch || !Array.isArray(batch.mutations)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_SYNC_BATCH', message: 'Batch object with mutations array is required.' },
        },
        { status: 400 }
      );
    }

    const tenantIdHeader = req.headers.get('x-tenant-id') || batch.tenantId || 'tenant_default';
    const actorIdHeader = req.headers.get('x-actor-id') || batch.actorId || 'usr_offline_sync';

    const context: CommandContext = {
      actorId: actorIdHeader,
      tenantId: tenantIdHeader,
      roles: ['CLINICIAN', 'DOCTOR', 'NURSE'],
      permissions: ['ALL_CLINICAL'],
      clinicalPrivileges: ['CONSULT', 'PRESCRIBE', 'ORDER_LAB', 'ORDER_RADIOLOGY'],
      deviceId: batch.deviceId,
      correlationId: `sync_corr_${Date.now()}`,
      requestId: `req_${Date.now()}`,
    };

    const syncResponse = await OfflineReconciliationDomainService.processSyncBatch(context, batch);
    return NextResponse.json({ success: true, ...syncResponse }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'SYNC_ERROR', message: err instanceof Error ? err.message : 'Internal sync error' },
      },
      { status: 500 }
    );
  }
}
