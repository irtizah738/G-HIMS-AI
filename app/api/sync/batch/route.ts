/**
 * G-HIMS Offline Batch Synchronization API Route
 * Offline actors are re-authenticated on reconnect; batch actor/role fields are not trusted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { OfflineReconciliationDomainService } from '@/lib/backend/services/offline-reconciliation-domain-service';
import { OfflineSyncBatch } from '@/lib/backend/types';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { emitOperationalEvent, operationalTimer } from '@/lib/observability/server-telemetry';

export async function POST(req: NextRequest) {
  const elapsed = operationalTimer();
  const correlationId = req.headers.get('x-correlation-id') || undefined;
  const requestId = req.headers.get('x-request-id') || undefined;
  let observedTenantId: string | undefined;
  try {
    const body = await req.json();
    const batch: OfflineSyncBatch = body.batch;
    observedTenantId = batch?.tenantId;

    if (!batch || !batch.tenantId || !Array.isArray(batch.mutations)) {
      emitOperationalEvent({
        event: 'offline.sync_batch',
        outcome: 'REJECTED',
        correlationId,
        requestId,
        tenantId: observedTenantId,
        durationMs: elapsed(),
        errorCode: 'INVALID_SYNC_BATCH',
      });
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_SYNC_BATCH', message: 'A tenant-scoped batch with mutations is required.' } },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, batch.tenantId);

    const authoritativeBatch: OfflineSyncBatch = {
      ...batch,
      tenantId: context.tenantId,
      actorId: context.actorId,
      deviceId: context.deviceId || batch.deviceId,
    };

    const syncResponse = await OfflineReconciliationDomainService.processSyncBatch(
      context,
      authoritativeBatch
    );

    emitOperationalEvent({
      event: 'offline.sync_batch',
      outcome: 'SUCCESS',
      correlationId: context.correlationId || correlationId,
      requestId: context.requestId || requestId,
      tenantId: context.tenantId,
      durationMs: elapsed(),
      attributes: {
        mutationCount: batch.mutations.length,
        syncedCount: syncResponse.syncedCount,
        conflictCount: syncResponse.conflictCount,
      },
    });

    return NextResponse.json({ success: true, ...syncResponse }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Offline sync failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    emitOperationalEvent({
      event: 'offline.sync_batch',
      outcome: unauthorized ? 'REJECTED' : 'FAILURE',
      correlationId,
      requestId,
      tenantId: observedTenantId,
      durationMs: elapsed(),
      errorCode: unauthorized ? 'UNAUTHORIZED' : 'SYNC_ERROR',
    });
    return NextResponse.json(
      { success: false, error: { code: unauthorized ? 'UNAUTHORIZED' : 'SYNC_ERROR', message } },
      { status: unauthorized ? 403 : 500 }
    );
  }
}
