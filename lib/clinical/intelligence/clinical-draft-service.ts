import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { AIGateway } from '@/lib/ai/gateway';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { clinicalDraftContentHash } from '@/lib/clinical/intelligence/clinical-draft-lifecycle';
import type { CommandContext, DomainEventEnvelope } from '@/lib/backend/types';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';
import type { ClinicalEvidenceSnapshot, CopilotClaim } from '@/types/clinical-intelligence-evidence';
import type {
  ClinicalDraftGenerationResponse,
  ClinicalDraftRevision,
  ClinicalDraftSection,
  ClinicalDraftType,
  GovernedClinicalDraft,
} from '@/types/clinical-draft';

const POLICY_VERSION = 'ci10f-clinical-drafting-v1';

type ProviderClaim = {
  claimId: string;
  text: string;
  classification: 'DIRECT_FACT' | 'DERIVED_FACT' | 'TREND' | 'POSSIBLE_DISCREPANCY' | 'DRAFT' | 'UNCERTAIN';
  evidenceRefs: string[];
  confidence?: number;
};

type ProviderSection = {
  sectionId: string;
  heading: string;
  text: string;
  claims: ProviderClaim[];
};

type ProviderOutput = {
  title: string;
  sections: ProviderSection[];
  warnings?: string[];
};

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

function validateProviderOutput(
  snapshot: ClinicalEvidenceSnapshot,
  output: ProviderOutput
): { title: string; sections: ClinicalDraftSection[]; claims: CopilotClaim[]; warnings: string[] } {
  const title = normalize(output?.title);
  if (!title) throw new Error('CI10F_AI_OUTPUT_TITLE_REQUIRED');
  if (!Array.isArray(output?.sections) || output.sections.length === 0) {
    throw new Error('CI10F_AI_OUTPUT_SECTIONS_REQUIRED');
  }

  const sectionIds = new Set<string>();
  const sections: ClinicalDraftSection[] = output.sections.map((section, sectionIndex) => {
    const sectionId = normalize(section?.sectionId) || `section-${sectionIndex + 1}`;
    const heading = normalize(section?.heading);
    const text = normalize(section?.text);
    if (sectionIds.has(sectionId)) throw new Error(`CI10F_DUPLICATE_SECTION_ID:${sectionId}`);
    sectionIds.add(sectionId);
    if (!heading || !text) throw new Error(`CI10F_AI_OUTPUT_SECTION_INVALID:${sectionId}`);

    const claims: CopilotClaim[] = (Array.isArray(section?.claims) ? section.claims : []).map(
      (claim, claimIndex) => ({
        claimId: normalize(claim?.claimId) || `${sectionId}-claim-${claimIndex + 1}`,
        text: normalize(claim?.text),
        classification: claim?.classification || 'DRAFT',
        evidenceRefs: Array.isArray(claim?.evidenceRefs)
          ? Array.from(new Set(claim.evidenceRefs.map(normalize).filter(Boolean)))
          : [],
        ...(typeof claim?.confidence === 'number' ? { confidence: claim.confidence } : {}),
      })
    );

    if (claims.length === 0) {
      throw new Error(`CI10F_SECTION_CLAIMS_REQUIRED:${sectionId}`);
    }
    return { sectionId, heading, text, claims };
  });

  const claims = sections.flatMap((section) => section.claims);
  const grounding = ClinicalEvidenceService.validateClaims(snapshot, claims);
  if (!grounding.valid) {
    throw new Error(`CI10F_GROUNDING_REJECTED:${grounding.errors.join(',')}`);
  }

  return {
    title,
    sections,
    claims,
    warnings: Array.from(new Set((output.warnings || []).map(normalize).filter(Boolean))),
  };
}

function contentFromSections(sections: ClinicalDraftSection[]): string {
  return sections
    .map((section) => `${section.heading}\n${section.text}`)
    .join('\n\n')
    .trim();
}

function schemaFor(draftType: ClinicalDraftType) {
  return JSON.stringify({
    title: 'string',
    draftType,
    sections: [{
      sectionId: 'stable short string',
      heading: 'string',
      text: 'draft text containing only evidence-supported or explicitly uncertain content',
      claims: [{
        claimId: 'unique string',
        text: 'one clinical assertion represented in the section',
        classification: 'DIRECT_FACT|DERIVED_FACT|TREND|POSSIBLE_DISCREPANCY|DRAFT|UNCERTAIN',
        evidenceRefs: ['evidenceId from supplied frozen snapshot; may be empty only for UNCERTAIN'],
        confidence: 'optional number 0..1',
      }],
    }],
    warnings: ['optional drafting limitation'],
  });
}

function instructionFor(draftType: ClinicalDraftType): string {
  return [
    `Create a ${draftType} DRAFT for a qualified clinician to edit, review, approve, and sign.`,
    'This is non-authoritative clinical drafting. Never issue orders, diagnoses, prescriptions, medication changes, disposition decisions, referrals, or patient instructions as completed clinical actions.',
    'Use only facts contained in the supplied frozen evidence snapshot. Never fill missing information from general medical knowledge or assumptions.',
    'Every clinical assertion must appear as a claim and cite evidenceIds from the supplied snapshot. If a statement is uncertain or evidence is incomplete, say so explicitly.',
    'Do not invent negative findings. Absence of evidence is not evidence of absence.',
    'Do not fabricate examination findings, stability statements, diagnoses, medication adherence, procedures, follow-up intervals, appointments, or warning signs.',
    'For patient instructions, draft wording only from already documented clinician plans/orders; do not create new treatment advice.',
    'For discharge summaries, never imply discharge readiness or completed discharge unless the evidence explicitly supports it.',
    'For referrals and handovers, preserve unresolved risks, pending diagnostics, medication concerns, and uncertainty.',
    'Return JSON only using the required schema.',
  ].join(' ');
}

function evidenceIndex(snapshot: ClinicalEvidenceSnapshot) {
  return snapshot.evidenceRefs.map((item) => ({
    evidenceId: item.evidenceId,
    sourceType: item.sourceType,
    sourceEntityId: item.sourceEntityId,
    label: item.label,
    status: item.status,
    occurredAt: item.occurredAt,
    provenanceStatus: item.provenanceStatus,
    sourceEventIds: item.sourceEventIds,
    contentHash: item.contentHash,
    content: item.content,
  }));
}

export class ClinicalDraftService {
  public static async generateAuthoritatively(
    context: CommandContext,
    patientId: string,
    encounterId: string,
    careSetting: ClinicalCareSetting,
    draftType: ClinicalDraftType,
    idempotencyKey: string
  ): Promise<ClinicalDraftGenerationResponse> {
    const normalizedIdempotencyKey = normalize(idempotencyKey);
    if (!normalizedIdempotencyKey) throw new Error('CI10F_IDEMPOTENCY_KEY_REQUIRED');
    const draftId = `cdraft_${crypto.createHash('sha256')
      .update([context.tenantId, context.actorId, normalizedIdempotencyKey].join('|'))
      .digest('hex')
      .slice(0, 32)}`;

    const existing = await this.get(context.tenantId, draftId);
    if (existing) {
      if (
        existing.patientId !== patientId ||
        existing.encounterId !== encounterId ||
        existing.draftType !== draftType
      ) {
        throw new Error('CI10F_IDEMPOTENCY_SCOPE_CONFLICT');
      }
      const [revision, persistedEvidence] = await Promise.all([
        this.getRevision(context.tenantId, existing.currentRevisionId),
        ClinicalEvidenceService.getSnapshot(context.tenantId, existing.evidenceSnapshotId),
      ]);
      if (!revision || !persistedEvidence || persistedEvidence.snapshotHash !== existing.evidenceSnapshotHash) {
        throw new Error('CI10F_IDEMPOTENT_REPLAY_INTEGRITY_FAILURE');
      }
      return { draft: existing, revision, evidenceIndex: evidenceIndex(persistedEvidence) };
    }

    const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context,
      patientId,
      'CLINICAL_DRAFT',
      { encounterId, careSetting }
    );

    if (snapshot.purpose !== 'CLINICAL_DRAFT') {
      throw new Error('CI10F_EVIDENCE_PURPOSE_MISMATCH');
    }

    const generation = await AIGateway.generateJson<ProviderOutput>({
      purpose: 'CLINICAL_GOVERNED_DRAFT',
      systemInstruction: instructionFor(draftType),
      sourceData: {
        draftType,
        evidenceSnapshot: {
          snapshotId: snapshot.snapshotId,
          snapshotHash: snapshot.snapshotHash,
          patientId: snapshot.patientId,
          patient360Revision: snapshot.patient360Revision,
          patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
          limitations: snapshot.limitations,
          evidenceRefs: snapshot.evidenceRefs,
        },
      },
      responseSchema: schemaFor(draftType),
      temperature: 0,
    });

    const normalized = validateProviderOutput(snapshot, generation.data);
    const content = contentFromSections(normalized.sections);
    if (!content) throw new Error('CI10F_AI_OUTPUT_CONTENT_REQUIRED');

    const generatedAt = Date.now();
    const revisionId = `${draftId}_r1`;
    const contentHash = clinicalDraftContentHash(normalized.title, content);

    const warnings = Array.from(new Set([
      ...snapshot.limitations,
      ...normalized.warnings,
      'AI-generated content is non-authoritative until a qualified clinician edits, reviews, explicitly approves, and signs the current revision.',
      'Any edit after approval invalidates approval and requires a new approval.',
    ]));

    const draft: GovernedClinicalDraft = {
      draftId,
      tenantId: context.tenantId,
      patientId,
      encounterId,
      careSetting,
      draftType,
      status: 'GENERATED_REQUIRES_REVIEW',
      evidenceSnapshotId: snapshot.snapshotId,
      evidenceSnapshotHash: snapshot.snapshotHash,
      patient360Revision: snapshot.patient360Revision,
      patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
      generationPolicyVersion: POLICY_VERSION,
      generationProvenance: generation.provenance,
      generatedBy: context.actorId,
      generatedAt,
      currentRevisionId: revisionId,
      currentRevisionNumber: 1,
      currentTitle: normalized.title,
      currentContent: content,
      currentContentHash: contentHash,
      generatedContentHash: contentHash,
      warnings,
      claimCount: normalized.claims.length,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      safety: {
        nonAuthoritativeUntilSigned: true,
        qualifiedClinicianReviewRequired: true,
        clinicianEditRequiredBeforeApproval: true,
        explicitApprovalRequired: true,
        signatureRequiredForAuthority: true,
        directClinicalMutationAllowed: false,
      },
    };

    const revision: ClinicalDraftRevision = {
      revisionId,
      draftId,
      tenantId: context.tenantId,
      patientId,
      encounterId,
      revisionNumber: 1,
      source: 'AI_GENERATED',
      title: normalized.title,
      content,
      contentHash,
      sections: normalized.sections,
      claims: normalized.claims,
      createdBy: context.actorId,
      createdAt: generatedAt,
      immutable: true,
      evidenceSnapshotId: snapshot.snapshotId,
      evidenceSnapshotHash: snapshot.snapshotHash,
      patient360Revision: snapshot.patient360Revision,
      patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
    };

    const db = getAdminFirestore();
    if (!db) throw new Error('CI10F_DRAFT_STORE_UNAVAILABLE');
    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const draftRef = tenantRef.collection('clinicalDrafts').doc(draftId);
    const revisionRef = tenantRef.collection('clinicalDraftRevisions').doc(revisionId);

    await db.runTransaction(async (transaction) => {
      const now = Date.now();
      const eventId = `evt_${crypto.randomUUID()}`;
      const auditId = `aud_${crypto.randomUUID()}`;
      const outboxId = `obx_${crypto.randomUUID()}`;
      const event: DomainEventEnvelope = {
        eventId,
        tenantId: context.tenantId,
        aggregateType: 'CLINICAL_DRAFT',
        aggregateId: draftId,
        eventType: 'CLINICAL_DRAFT_GENERATED',
        eventVersion: 1,
        payload: {
          draftId,
          revisionId,
          patientId,
          encounterId,
          careSetting,
          draftType,
          evidenceSnapshotId: snapshot.snapshotId,
          evidenceSnapshotHash: snapshot.snapshotHash,
          contentHash,
          generationPolicyVersion: POLICY_VERSION,
        },
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        occurredAt: now,
        recordedAt: now,
        correlationId: context.correlationId,
        commandId: `ci10f-generate:${draftId}`,
        idempotencyKey: normalizedIdempotencyKey,
        source: 'system',
        schemaVersion: 1,
      };

      transaction.create(draftRef, sanitizeForFirestore(draft));
      transaction.create(revisionRef, sanitizeForFirestore(revision));
      transaction.create(tenantRef.collection('events').doc(eventId), sanitizeForFirestore(event));
      transaction.create(tenantRef.collection('audit_logs').doc(auditId), sanitizeForFirestore({
        auditId,
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        action: 'GENERATE_GOVERNED_CLINICAL_DRAFT',
        resourceType: 'CLINICAL_DRAFT',
        resourceId: draftId,
        commandId: event.commandId,
        eventId,
        correlationId: context.correlationId,
        occurredAt: now,
        recordedAt: now,
        reason: `Generated non-authoritative ${draftType} draft for clinician review`,
        metadata: {
          patientId,
          encounterId,
          draftType,
          revisionId,
          evidenceSnapshotId: snapshot.snapshotId,
          evidenceSnapshotHash: snapshot.snapshotHash,
          contentHash,
          provider: generation.provenance.provider,
          model: generation.provenance.model,
        },
      }));
      transaction.create(tenantRef.collection('outbox').doc(outboxId), sanitizeForFirestore({
        outboxId,
        tenantId: context.tenantId,
        eventId,
        eventType: event.eventType,
        topic: 'g-hims-clinical-intelligence-events',
        payload: event.payload,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: now,
        createdAt: now,
      }));
    });

    return { draft, revision, evidenceIndex: evidenceIndex(snapshot) };
  }

  public static async get(tenantId: string, draftId: string): Promise<GovernedClinicalDraft | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10F_DRAFT_STORE_UNAVAILABLE');
    const snapshot = await db.collection('tenants').doc(tenantId)
      .collection('clinicalDrafts').doc(draftId).get();
    return snapshot.exists ? (snapshot.data() as GovernedClinicalDraft) : null;
  }

  public static async getRevision(
    tenantId: string,
    revisionId: string
  ): Promise<ClinicalDraftRevision | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10F_DRAFT_STORE_UNAVAILABLE');
    const snapshot = await db.collection('tenants').doc(tenantId)
      .collection('clinicalDraftRevisions').doc(revisionId).get();
    return snapshot.exists ? (snapshot.data() as ClinicalDraftRevision) : null;
  }
}
