import { NextRequest, NextResponse } from 'next/server';
import { resolveNextStage } from '@/lib/workflow/transition-resolver';
import { db } from '@/lib/firebase/client';
import { doc, runTransaction } from 'firebase/firestore';
import {
  workflowSnapshotDocPath,
  encounterDocPath,
  timelineEventDocPath,
  auditLogDocPath,
} from '@/lib/firestore/paths';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { WorkflowSnapshot } from '@/types/encounter-runtime';
import { PatientTimelineProjection, TimelineCategory } from '@/types/patient-timeline';

export async function POST(req: NextRequest) {
  try {
    const {
      tenantId = 'metro_general',
      encounterId,
      patientId,
      currentSnapshot,
      completedStageId,
      actorId = 'user_nurse_1',
      actorRole = 'nurse',
      actorName = 'Staff Nurse',
      stageMetadata,
      summary,
    } = await req.json();

    if (!encounterId || !currentSnapshot || !completedStageId) {
      return NextResponse.json(
        { success: false, error: 'encounterId, currentSnapshot, and completedStageId are required' },
        { status: 400 }
      );
    }

    const { updatedSnapshot, isCompleted, nextStage } = resolveNextStage(
      currentSnapshot as WorkflowSnapshot,
      completedStageId,
      actorId,
      actorRole,
      actorName,
      stageMetadata
    );

    const now = Date.now();
    const timelineEventId = `tl_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const auditLogId = `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Map completed stage to timeline category
    const categoryMap: Record<string, TimelineCategory> = {
      REGISTRATION: 'REGISTRATION',
      TRIAGE: 'TRIAGE',
      CONSULTATION: 'CONSULTATION',
      DIAGNOSTICS_PHARMACY: 'DIAGNOSTICS',
      BILLING_DISCHARGE: 'BILLING',
    };

    const timelineRecord: PatientTimelineProjection = {
      id: timelineEventId,
      patientId: patientId || 'pat_unknown',
      tenantId,
      encounterId,
      title: isCompleted
        ? `Stage '${completedStageId}' Completed — Encounter Concluded`
        : `Stage '${completedStageId}' Completed -> Advanced to '${nextStage?.name}'`,
      summary: summary || `Clinical stage transition executed by ${actorName} (${actorRole}).`,
      category: categoryMap[completedStageId] || 'CONSULTATION',
      timestamp: now,
      actorName,
      actorRole,
      severity: 'NORMAL',
      metadata: stageMetadata || {},
    };

    const auditLogEntry = {
      id: auditLogId,
      timestamp: new Date(now).toISOString(),
      userId: actorId,
      userName: actorName,
      role: actorRole,
      action: 'WORKFLOW_STAGE_TRANSITION',
      resource: `encounters/${encounterId}/workflow_snapshots/${updatedSnapshot.id}`,
      ipAddress: '127.0.0.1',
      status: 'SUCCESS',
      details: `Completed stage ${completedStageId}, advanced to ${updatedSnapshot.currentStageId}.`,
    };

    // Commit transaction
    const workflowRef = doc(db, workflowSnapshotDocPath(tenantId, encounterId, updatedSnapshot.id));
    const encounterRef = doc(db, encounterDocPath(tenantId, encounterId));
    const timelineRef = doc(db, timelineEventDocPath(tenantId, patientId, timelineEventId));
    const auditRef = doc(db, auditLogDocPath(tenantId, auditLogId));

    await runTransaction(db, async (transaction) => {
      transaction.set(workflowRef, sanitizeForFirestore(updatedSnapshot));
      transaction.update(encounterRef, sanitizeForFirestore({
        currentStageId: updatedSnapshot.currentStageId,
        status: isCompleted ? 'COMPLETED' : 'IN_PROGRESS',
        ...(isCompleted ? { endedAt: now } : {}),
      }));
      transaction.set(timelineRef, sanitizeForFirestore(timelineRecord));
      transaction.set(auditRef, sanitizeForFirestore(auditLogEntry));
    });

    return NextResponse.json({
      success: true,
      data: {
        updatedSnapshot,
        isCompleted,
        nextStage,
        timelineEvent: timelineRecord,
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('API /api/clinical/workflow/transition Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
