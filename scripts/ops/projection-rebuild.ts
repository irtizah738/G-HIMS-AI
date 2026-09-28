import { ProjectionRecoveryService } from '../../lib/backend/recovery/projection-recovery-service';

const tenantId = String(process.env.GHIMS_PROJECTION_REBUILD_TENANT || '').trim();
if (!tenantId) {
  throw new Error('GHIMS_PROJECTION_REBUILD_TENANT is required.');
}

const manifest = await ProjectionRecoveryService.rebuildTenantInIsolatedEnvironment(
  tenantId
);

process.stdout.write(
  JSON.stringify(
    {
      runId: manifest.runId,
      tenantId: manifest.tenantId,
      runtimeMode: manifest.runtimeMode,
      status: manifest.status,
      eventCount: manifest.eventCount,
      checkpointCount: manifest.checkpointCount,
      eventTypeCounts: manifest.eventTypeCounts,
      eventStreamSha256: manifest.eventStreamSha256,
      projectionSha256: manifest.projectionSha256,
      durationMs: manifest.durationMs,
    },
    null,
    2
  ) + '\n'
);
