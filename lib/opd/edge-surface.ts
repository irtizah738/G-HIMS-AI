export const OPD_EDGE_COLLECTIONS = [
  'patients',
  'encounters',
  'encounterEvidence',
  'orders',
  'prescriptions',
  'opd_queue',
  'opdAppointments',
  'opdWaitlist',
  'beds',
  'patient360Projections',
  'dischargeReadinessProjections',
  'deteriorationProjections',
  'medicationSafetyProjections',
  'clinicalOpenItems',
  'clinicalEscalations',
  'consultationRequests',
  'clinicalHandoffs',
  'billingMismatches',
  'encounterCharges',
  'invoices',
  'invoiceSettlements',
  'arOpenItems',
  'journalEntries',
  'cashReceipts',
] as const;

export type OpdEdgeCollection = (typeof OPD_EDGE_COLLECTIONS)[number];

export function isOpdEdgeCollection(value: string): value is OpdEdgeCollection {
  return (OPD_EDGE_COLLECTIONS as readonly string[]).includes(value);
}
