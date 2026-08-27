/**
 * Patient Longitudinal Timeline Projection Types
 */

export type TimelineCategory =
  | 'REGISTRATION'
  | 'TRIAGE'
  | 'CONSULTATION'
  | 'DIAGNOSTICS'
  | 'PHARMACY'
  | 'BILLING';

export interface PatientTimelineProjection {
  id: string;
  patientId: string;
  tenantId: string;
  encounterId: string;
  title: string;
  summary: string;
  category: TimelineCategory;
  timestamp: number;
  actorName: string;
  actorRole?: string;
  severity?: 'NORMAL' | 'WARN' | 'CRITICAL';
  metadata: Record<string, unknown>;
  rawEventId?: string;
}
