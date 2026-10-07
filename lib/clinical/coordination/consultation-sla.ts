export type ConsultationPriority = 'ROUTINE' | 'PRIORITY' | 'URGENT' | 'STAT';

export interface ConsultationSlaPolicy {
  acknowledgementMinutes: number;
  acceptanceMinutes: number;
}

/**
 * Server-owned default consultation coordination SLA.
 *
 * These are operational coordination targets, not clinical treatment guarantees.
 * Keep them out of the client so UI, worklists and command state cannot diverge.
 * Tenant-specific policy can replace this table later without changing callers.
 */
const DEFAULT_CONSULTATION_SLA: Readonly<Record<ConsultationPriority, ConsultationSlaPolicy>> = {
  STAT: { acknowledgementMinutes: 10, acceptanceMinutes: 15 },
  URGENT: { acknowledgementMinutes: 30, acceptanceMinutes: 60 },
  PRIORITY: { acknowledgementMinutes: 60, acceptanceMinutes: 120 },
  ROUTINE: { acknowledgementMinutes: 240, acceptanceMinutes: 480 },
};

export function getConsultationSla(
  priority: ConsultationPriority
): ConsultationSlaPolicy {
  return DEFAULT_CONSULTATION_SLA[priority];
}

export type ConsultationSlaPhase = 'ACKNOWLEDGEMENT' | 'ACCEPTANCE' | 'COMPLETE';

export type ConsultationSlaState =
  | 'ON_TRACK'
  | 'DUE_SOON'
  | 'BREACHED'
  | 'COMPLETE';

export function getConsultationSlaState(
  now: number,
  dueAt: number | undefined,
  phase: ConsultationSlaPhase
): ConsultationSlaState {
  if (phase === 'COMPLETE') return 'COMPLETE';
  if (!dueAt) return 'ON_TRACK';
  if (now > dueAt) return 'BREACHED';

  const remaining = dueAt - now;
  const dueSoonWindow = Math.min(15 * 60_000, Math.max(60_000, remaining / 2));
  return remaining <= dueSoonWindow ? 'DUE_SOON' : 'ON_TRACK';
}
