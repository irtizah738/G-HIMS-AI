import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import type { ClinicalOpenItemProjection } from '@/types/consultant-visibility';
import type { EmarScheduleSlot } from '@/types/wave2-clinical-domains';

interface EmarOverdueRefreshResult {
  overdueSlotIds: string[];
  openItemIds: string[];
  autoResolvedItemIds: string[];
}

function isOverdue(slot: EmarScheduleSlot, now: number): boolean {
  return (
    slot.status === 'DUE' &&
    now > slot.scheduledFor + slot.toleranceMinutes * 60_000
  );
}

export class EmarOverdueProjectionService {
  public static async refreshEncounter(
    tenantId: string,
    patientId: string,
    encounterId: string,
    now = Date.now()
  ): Promise<EmarOverdueRefreshResult> {
    const db = getAdminFirestore();
    if (!db) throw new Error('EMAR_OVERDUE_PROJECTION_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(tenantId);
    const [slotSnapshot, openItemSnapshot] = await Promise.all([
      tenantRef
        .collection('emarScheduleSlots')
        .where('patientId', '==', patientId)
        .limit(251)
        .get(),
      tenantRef
        .collection('clinicalOpenItems')
        .where('patientId', '==', patientId)
        .limit(501)
        .get(),
    ]);

    if (slotSnapshot.size > 250) {
      throw new Error('EMAR_OVERDUE_SLOT_LIMIT_EXCEEDED:250');
    }
    if (openItemSnapshot.size > 500) {
      throw new Error('EMAR_OVERDUE_OPEN_ITEM_LIMIT_EXCEEDED:500');
    }

    const slots = slotSnapshot.docs
      .map((document) => document.data() as EmarScheduleSlot)
      .filter((slot) => slot.encounterId === encounterId);

    const existing = new Map(
      openItemSnapshot.docs
        .map((document) => document.data() as ClinicalOpenItemProjection)
        .filter(
          (item) =>
            item.encounterId === encounterId &&
            item.generatedBy === 'WAVE2_EMAR_OVERDUE'
        )
        .map((item) => [item.openItemId, item])
    );

    const overdue = slots.filter((slot) => isOverdue(slot, now));
    const activeOpenItemIds = new Set<string>();
    const batch = db.batch();

    for (const slot of overdue) {
      const openItemId = `open_emar_overdue_${slot.emarSlotId}`;
      activeOpenItemIds.add(openItemId);
      const previous = existing.get(openItemId);
      const status =
        previous?.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'OPEN';

      const next: ClinicalOpenItemProjection = {
        openItemId,
        tenantId,
        patientId,
        encounterId,
        careSetting: 'IPD',
        category: 'MEDICATION',
        description:
          `Medication administration remains unresolved after the authorized eMAR window: ${slot.medicationOrderId}.`,
        clinicalPriority: 'ACTION_REQUIRED',
        ownerType: 'ROLE',
        ownerId: 'DOCTOR',
        ownerRole: 'DOCTOR',
        status,
        resolutionMode: 'SOURCE_STATE',
        createdAt: previous?.createdAt || slot.scheduledFor,
        dueAt: slot.scheduledFor + slot.toleranceMinutes * 60_000,
        acknowledgedAt:
          status === 'ACKNOWLEDGED' ? previous?.acknowledgedAt : undefined,
        acknowledgedBy:
          status === 'ACKNOWLEDGED' ? previous?.acknowledgedBy : undefined,
        acknowledgementNote:
          status === 'ACKNOWLEDGED'
            ? previous?.acknowledgementNote
            : undefined,
        sourceRefs: [slot.emarSlotId, slot.medicationOrderId],
        generatedBy: 'WAVE2_EMAR_OVERDUE',
        updatedAt: now,
      };

      batch.set(
        tenantRef.collection('clinicalOpenItems').doc(openItemId),
        sanitizeForFirestore(next)
      );
    }

    const autoResolvedItemIds: string[] = [];
    for (const [openItemId, previous] of existing) {
      if (
        activeOpenItemIds.has(openItemId) ||
        previous.status === 'RESOLVED'
      ) {
        continue;
      }

      autoResolvedItemIds.push(openItemId);
      batch.set(
        tenantRef.collection('clinicalOpenItems').doc(openItemId),
        sanitizeForFirestore({
          ...previous,
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedBy: 'SYSTEM_PROJECTION',
          resolutionReason:
            'The authoritative eMAR slot no longer remains overdue.',
          resolutionRef:
            previous.sourceRefs.find((ref) => ref.startsWith('emar_')) ||
            previous.sourceRefs[0],
          updatedAt: now,
        })
      );
    }

    await batch.commit();

    return {
      overdueSlotIds: overdue.map((slot) => slot.emarSlotId),
      openItemIds: Array.from(activeOpenItemIds),
      autoResolvedItemIds,
    };
  }
}
