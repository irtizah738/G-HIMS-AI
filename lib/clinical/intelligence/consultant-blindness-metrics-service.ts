import { getAdminFirestore } from '@/server/firebase/admin';
import type { CommandContext } from '@/lib/backend/types';
import { ConsultantAttentionProjectionService } from '@/lib/clinical/intelligence/consultant-attention-projection-service';
import type { ConsultantBlindnessMetrics } from '@/types/consultant-blindness-metrics';
import type { ClinicalOpenItemProjection } from '@/types/consultant-visibility';

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export class ConsultantBlindnessMetricsService {
  public static async forActor(
    context: CommandContext
  ): Promise<ConsultantBlindnessMetrics> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CONSULTANT_BLINDNESS_METRICS_STORE_UNAVAILABLE');

    const worklist = await ConsultantAttentionProjectionService.getWorklist(context);
    const items = worklist.items;
    const now = Date.now();

    const checkpoints = await db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('consultantReviewCheckpoints')
      .where('consultantId', '==', context.actorId)
      .limit(500)
      .get();

    const reviewedPatientIds = new Set<string>();
    let lastReviewAt = 0;
    for (const doc of checkpoints.docs) {
      const row = doc.data();
      const patientId = String(row.patientId || '').trim();
      if (patientId) reviewedPatientIds.add(patientId);
      lastReviewAt = Math.max(lastReviewAt, Number(row.reviewedAt || 0));
    }

    const ownedItems = items.filter((item) => Boolean(item.ownerId)).length;
    const evidenceLinkedItems = items.filter(
      (item) => Array.isArray(item.sourceRefs) && item.sourceRefs.length > 0
    ).length;
    const safelyRouted = items.filter(
      (item) =>
        Boolean(item.ownerId) &&
        Array.isArray(item.sourceRefs) &&
        item.sourceRefs.length > 0 &&
        (
          item.clinicalPriority !== 'CRITICAL_REVIEW_REQUIRED' ||
          item.status === 'ACKNOWLEDGED'
        )
    ).length;

    return {
      tenantId: context.tenantId,
      scope: 'ACTOR',
      actorId: context.actorId,
      generatedAt: now,
      attentionCoveragePct: percent(safelyRouted, items.length),
      unresolvedAttentionItems: items.length,
      criticalUnacknowledgedItems: items.filter(
        (item) =>
          item.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED' &&
          item.status === 'OPEN'
      ).length,
      overdueAttentionItems: items.filter(
        (item) => Boolean(item.dueAt && item.dueAt < now)
      ).length,
      pendingConsultations: items.filter(
        (item) => item.category === 'CONSULTATION'
      ).length,
      pendingHandoffs: items.filter(
        (item) => item.category === 'HANDOFF'
      ).length,
      unresolvedDiagnostics: items.filter(
        (item) => item.category === 'DIAGNOSTIC'
      ).length,
      deteriorationItems: items.filter(
        (item) => item.category === 'DETERIORATION'
      ).length,
      ownedItems,
      evidenceLinkedItems,
      reviewedPatientCount: reviewedPatientIds.size,
      lastReviewAt: lastReviewAt || undefined,
    };
  }

  public static async forTenant(
    context: CommandContext
  ): Promise<ConsultantBlindnessMetrics> {
    const roles = new Set(
      context.roles.map((role) => String(role || '').trim().toUpperCase())
    );
    if (
      !roles.has('SYSTEM_ADMIN') &&
      !roles.has('MEDICAL_DIRECTOR') &&
      !roles.has('CLINICAL_DIRECTOR')
    ) {
      throw new Error('CONSULTANT_BLINDNESS_TENANT_METRICS_UNAUTHORIZED');
    }

    const db = getAdminFirestore();
    if (!db) throw new Error('CONSULTANT_BLINDNESS_METRICS_STORE_UNAVAILABLE');
    const now = Date.now();
    const snapshot = await db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('clinicalOpenItems')
      .where('status', 'in', ['OPEN', 'ACKNOWLEDGED'])
      .limit(1000)
      .get();

    const items = snapshot.docs.map(
      (doc) => doc.data() as ClinicalOpenItemProjection
    );
    const ownedItems = items.filter((item) => Boolean(item.ownerId)).length;
    const evidenceLinkedItems = items.filter(
      (item) => Array.isArray(item.sourceRefs) && item.sourceRefs.length > 0
    ).length;
    const safelyRouted = items.filter(
      (item) =>
        Boolean(item.ownerId) &&
        Array.isArray(item.sourceRefs) &&
        item.sourceRefs.length > 0 &&
        (
          item.clinicalPriority !== 'CRITICAL_REVIEW_REQUIRED' ||
          item.status === 'ACKNOWLEDGED'
        )
    ).length;

    const checkpoints = await db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('consultantReviewCheckpoints')
      .limit(1000)
      .get();
    const patientIds = new Set<string>();
    let lastReviewAt = 0;
    for (const doc of checkpoints.docs) {
      const row = doc.data();
      const patientId = String(row.patientId || '').trim();
      if (patientId) patientIds.add(patientId);
      lastReviewAt = Math.max(lastReviewAt, Number(row.reviewedAt || 0));
    }

    return {
      tenantId: context.tenantId,
      scope: 'TENANT',
      actorId: context.actorId,
      generatedAt: now,
      attentionCoveragePct: percent(safelyRouted, items.length),
      unresolvedAttentionItems: items.length,
      criticalUnacknowledgedItems: items.filter(
        (item) =>
          item.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED' &&
          item.status === 'OPEN'
      ).length,
      overdueAttentionItems: items.filter(
        (item) => Boolean(item.dueAt && item.dueAt < now)
      ).length,
      pendingConsultations: items.filter((item) => item.category === 'CONSULTATION').length,
      pendingHandoffs: items.filter((item) => item.category === 'HANDOFF').length,
      unresolvedDiagnostics: items.filter((item) => item.category === 'DIAGNOSTIC').length,
      deteriorationItems: items.filter((item) => item.category === 'DETERIORATION').length,
      ownedItems,
      evidenceLinkedItems,
      reviewedPatientCount: patientIds.size,
      lastReviewAt: lastReviewAt || undefined,
    };
  }
}
