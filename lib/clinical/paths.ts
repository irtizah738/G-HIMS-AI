/**
 * Tenant-Scoped Firestore Path Helpers
 * Strict type safety and hierarchical path resolvers for Multi-Tenant Clinical Runtime
 */

export const ClinicalPaths = {
  // 1. Root and Global Fallback paths
  root: {
    patients: () => 'patients',
    patient: (patientId: string) => `patients/${patientId}`,
    beds: () => 'beds',
    bed: (bedId: string) => `beds/${bedId}`,
    auditLogs: () => 'auditLogs',
    auditLog: (logId: string) => `auditLogs/${logId}`,
    opdQueue: () => 'opdQueue',
    opdToken: (tokenId: string) => `opdQueue/${tokenId}`,
    billingMismatches: () => 'billingMismatches',
    billingMismatch: (mismatchId: string) => `billingMismatches/${mismatchId}`,
    tenants: () => 'tenants',
    tenant: (tenantId: string) => `tenants/${tenantId}`,
  },

  // 2. Tenant-Scoped Clinical Collections
  tenant: {
    // Tenant Base Document
    self: (tenantId: string) => `tenants/${tenantId}`,

    // Users and Staff
    users: (tenantId: string) => `tenants/${tenantId}/users`,
    user: (tenantId: string, userId: string) => `tenants/${tenantId}/users/${userId}`,

    // Master Patient Index (MPI)
    patients: (tenantId: string) => `tenants/${tenantId}/patients`,
    patient: (tenantId: string, patientId: string) => `tenants/${tenantId}/patients/${patientId}`,
    mpiRegistry: (tenantId: string) => `tenants/${tenantId}/mpi_registry`,
    mpiRecord: (tenantId: string, mpiKey: string) => `tenants/${tenantId}/mpi_registry/${mpiKey}`,

    // Patient Timeline Projections
    patientTimeline: (tenantId: string, patientId: string) =>
      `tenants/${tenantId}/patients/${patientId}/timeline`,
    patientTimelineEvent: (tenantId: string, patientId: string, eventId: string) =>
      `tenants/${tenantId}/patients/${patientId}/timeline/${eventId}`,

    // Clinical Encounters
    encounters: (tenantId: string) => `tenants/${tenantId}/encounters`,
    encounter: (tenantId: string, encounterId: string) => `tenants/${tenantId}/encounters/${encounterId}`,

    // Workflow Runtime Snapshots
    workflowSnapshots: (tenantId: string, encounterId: string) =>
      `tenants/${tenantId}/encounters/${encounterId}/workflow_snapshots`,
    workflowSnapshot: (tenantId: string, encounterId: string, snapshotId: string) =>
      `tenants/${tenantId}/encounters/${encounterId}/workflow_snapshots/${snapshotId}`,

    // Runtime Workflow Stages
    stages: (tenantId: string, encounterId: string) =>
      `tenants/${tenantId}/encounters/${encounterId}/stages`,
    stage: (tenantId: string, encounterId: string, stageId: string) =>
      `tenants/${tenantId}/encounters/${encounterId}/stages/${stageId}`,

    // OPD Clinic Queue & Tokens
    opdQueue: (tenantId: string) => `tenants/${tenantId}/opd_queue`,
    opdToken: (tenantId: string, tokenId: string) => `tenants/${tenantId}/opd_queue/${tokenId}`,

    // Financial Tariffs, Invoices & Claims
    tariffs: (tenantId: string) => `tenants/${tenantId}/tariffs`,
    tariff: (tenantId: string, tariffId: string) => `tenants/${tenantId}/tariffs/${tariffId}`,
    invoices: (tenantId: string) => `tenants/${tenantId}/invoices`,
    invoice: (tenantId: string, invoiceId: string) => `tenants/${tenantId}/invoices/${invoiceId}`,
    claims: (tenantId: string) => `tenants/${tenantId}/claims`,
    claim: (tenantId: string, claimId: string) => `tenants/${tenantId}/claims/${claimId}`,

    // Transactional Outbox Pattern
    outbox: (tenantId: string) => `tenants/${tenantId}/outbox`,
    outboxEvent: (tenantId: string, eventId: string) => `tenants/${tenantId}/outbox/${eventId}`,

    // Cryptographic HIPAA Audit Ledger
    auditLogs: (tenantId: string) => `tenants/${tenantId}/audit_logs`,
    auditLog: (tenantId: string, logId: string) => `tenants/${tenantId}/audit_logs/${logId}`,
  },
};

export default ClinicalPaths;
