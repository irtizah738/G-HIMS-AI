/**
 * Tenant-Scoped Firestore Path Generator
 * Strongly-typed path generator functions targeting tenant-isolated clinical subcollections
 */

export function tenantPath(tenantId: string): string {
  return `tenants/${tenantId}`;
}

export function patientsPath(tenantId: string): string {
  return `tenants/${tenantId}/patients`;
}

export function patientDocPath(tenantId: string, patientId: string): string {
  return `tenants/${tenantId}/patients/${patientId}`;
}

export function encountersPath(tenantId: string): string {
  return `tenants/${tenantId}/encounters`;
}

export function encounterDocPath(tenantId: string, encounterId: string): string {
  return `tenants/${tenantId}/encounters/${encounterId}`;
}

export function workflowSnapshotsPath(tenantId: string, encounterId: string): string {
  return `tenants/${tenantId}/encounters/${encounterId}/workflow_snapshots`;
}

export function workflowSnapshotDocPath(
  tenantId: string,
  encounterId: string,
  snapshotId: string
): string {
  return `tenants/${tenantId}/encounters/${encounterId}/workflow_snapshots/${snapshotId}`;
}

export function timelineEventsPath(tenantId: string, patientId: string): string {
  return `tenants/${tenantId}/patients/${patientId}/timeline_events`;
}

export function timelineEventDocPath(
  tenantId: string,
  patientId: string,
  eventId: string
): string {
  return `tenants/${tenantId}/patients/${patientId}/timeline_events/${eventId}`;
}

export function auditLogsPath(tenantId: string): string {
  return `tenants/${tenantId}/audit_logs`;
}

export function auditLogDocPath(tenantId: string, auditId: string): string {
  return `tenants/${tenantId}/audit_logs/${auditId}`;
}

export function outboxEventsPath(tenantId: string): string {
  return `tenants/${tenantId}/outbox_events`;
}

export function outboxEventDocPath(tenantId: string, eventId: string): string {
  return `tenants/${tenantId}/outbox_events/${eventId}`;
}

export function mpiRegistryPath(tenantId: string): string {
  return `tenants/${tenantId}/mpi_registry`;
}

export function mpiRegistryDocPath(tenantId: string, mpiKey: string): string {
  return `tenants/${tenantId}/mpi_registry/${mpiKey}`;
}

export function opdQueuePath(tenantId: string): string {
  return `tenants/${tenantId}/opd_queue`;
}

export function opdQueueDocPath(tenantId: string, tokenId: string): string {
  return `tenants/${tenantId}/opd_queue/${tokenId}`;
}
