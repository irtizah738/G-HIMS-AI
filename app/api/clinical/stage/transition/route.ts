import { NextRequest, NextResponse } from 'next/server';
import { GlobalStageTransitionResolver } from '@/lib/clinical/workflow/transition-resolver';
import { ClinicalStageType } from '@/types/clinical-workflow';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { ClinicalPaths } from '@/lib/clinical/paths';
import { createOutboxEventRecord } from '@/lib/events/outbox';
import { createStageTransitionedEvent } from '@/lib/clinical/events/envelope';
import { logAuditEvent } from '@/lib/audit/logger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const tenantId = body.tenantId || 'central-metro-hospital';
    const encounterId = body.encounterId;
    const currentStage: ClinicalStageType = body.currentStage;
    const targetStage: ClinicalStageType = body.targetStage;
    const initiatorUserId = body.initiatorUserId || 'sys-service';
    const initiatorUserName = body.initiatorUserName || 'Clinical Practitioner';
    const initiatorUserRole = body.initiatorUserRole || 'practitioner';
    const clientIp = req.headers.get('x-forwarded-for') || '127.0.0.1';

    if (!encounterId || !currentStage || !targetStage) {
      return NextResponse.json(
        { success: false, error: 'encounterId, currentStage, and targetStage are required.' },
        { status: 400 }
      );
    }

    // 1. Resolve Transition with Clinical Guard Engine
    const resolution = GlobalStageTransitionResolver.resolve({
      tenantId,
      encounterId,
      currentStage,
      targetStage,
      initiatorUserId,
      initiatorUserRole,
      transitionData: body.transitionData || {},
      vitals: body.vitals,
      soapSigned: body.soapSigned,
      billingCleared: body.billingCleared,
      overrideEmergency: body.overrideEmergency,
    });

    if (!resolution.allowed) {
      return NextResponse.json({
        success: false,
        resolution,
        message: 'Stage transition rejected by clinical governance guards.',
      }, { status: 422 });
    }

    const timestamp = new Date().toISOString();

    // 2. Perform Database updates
    const batch = writeBatch(db);

    // Update or create runtime stage document
    const stageDocId = `stage_${targetStage.toLowerCase()}_${Date.now().toString(36)}`;
    const stageRef = doc(db, ClinicalPaths.tenant.stage(tenantId, encounterId, stageDocId));
    batch.set(stageRef, {
      id: stageDocId,
      stageType: targetStage,
      status: 'ACTIVE',
      startedAt: timestamp,
      performedByUserId: initiatorUserId,
      performedByUserName: initiatorUserName,
      stageData: body.transitionData || {},
      notes: body.notes || `Advanced from ${currentStage} to ${targetStage}`,
    });

    // Create Outbox Event
    const stageEvent = createStageTransitionedEvent({
      tenantId,
      encounterId,
      patientId: body.patientId || 'unknown-patient',
      fromStage: currentStage,
      toStage: targetStage,
      dwellDurationSeconds: body.dwellDurationSeconds || 0,
      notes: body.notes,
      producer: {
        userId: initiatorUserId,
        userName: initiatorUserName,
        userRole: initiatorUserRole,
        ipAddress: clientIp,
      },
    });

    const outboxRecord = createOutboxEventRecord({
      tenantId,
      destinationQueue: 'HL7_V2_BROKER',
      envelope: stageEvent,
    });

    const outboxRef = doc(db, ClinicalPaths.tenant.outboxEvent(tenantId, outboxRecord.id));
    batch.set(outboxRef, outboxRecord);

    await batch.commit();

    // 3. Log Audit Entry
    const auditEntry = await logAuditEvent({
      tenantId,
      userId: initiatorUserId,
      userName: initiatorUserName,
      userRole: initiatorUserRole,
      action: 'UPDATE',
      resource: `encounter:${encounterId}/stage_transition`,
      status: 'SUCCESS',
      severity: 'INFO',
      details: `Encounter stage transitioned from ${currentStage} to ${targetStage}. Reason: ${body.notes || 'Routine care progression'}`,
      ipAddress: clientIp,
      metadata: {
        encounterId,
        fromStage: currentStage,
        toStage: targetStage,
        warnings: resolution.warnings,
      },
    });

    return NextResponse.json({
      success: true,
      resolution,
      data: {
        stageId: stageDocId,
        targetStage,
        timestamp,
        auditLogId: auditEntry.id,
        outboxEventId: outboxRecord.id,
      },
    });
  } catch (error) {
    console.error('[API /api/clinical/stage/transition] Error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
