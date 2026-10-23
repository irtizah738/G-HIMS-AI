import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import type { CommandContext, DomainEventEnvelope } from '@/lib/backend/types';
import {
  CIQP_VALIDATION_ADMIN_ROLES,
  CIQP_VALIDATION_ROLES,
  CIQP_VALIDATION_STUDY_ID,
  type ValidationAssessment,
  type ValidationCaseView,
  type ValidationEvidenceItem,
  type ValidationJudgment,
  type ValidationSyntheticCase,
} from '@/types/clinical-validation-workspace';

const STUDY_CASES: Array<{ id: string; evidence: ValidationEvidenceItem[]; question: string }> = [
  {
    id: 'renal-synthetic-001',
    evidence: [
      { evidenceId: 'creatinine-a', label: 'Lab, day 1', fact: '2026-10-17 serum creatinine 0.9 mg/dL (synthetic)' },
      { evidenceId: 'creatinine-b', label: 'Lab, day 4', fact: '2026-10-20 serum creatinine 1.2 mg/dL (synthetic)' },
      { evidenceId: 'creatinine-c', label: 'Lab, day 6', fact: '2026-10-22 serum creatinine 2.1 mg/dL (synthetic)' },
      { evidenceId: 'context-unknown', label: 'Context', fact: 'Prior stable baseline and urine output are not documented in supplied synthetic record.' },
    ],
    question: 'Does this record merit clinician assessment for potentially significant renal deterioration? Assess source support and uncertainty, not a diagnosis.',
  },
  {
    id: 'renal-synthetic-002',
    evidence: [
      { evidenceId: 'creatinine-a', label: 'Lab, day 1', fact: '2026-10-17 serum creatinine 1.0 mg/dL (synthetic)' },
      { evidenceId: 'creatinine-b', label: 'Lab, day 4', fact: '2026-10-20 serum creatinine 1.0 mg/dL (synthetic)' },
      { evidenceId: 'creatinine-c', label: 'Lab, day 6', fact: '2026-10-22 serum creatinine 1.0 mg/dL (synthetic)' },
    ],
    question: 'Does the represented trajectory itself merit a renal-deterioration warning? Explain any missing clinical context.',
  },
  {
    id: 'renal-synthetic-003',
    evidence: [
      { evidenceId: 'creatinine-a', label: 'Preliminary lab', fact: '2026-10-22 serum creatinine 2.2 mg/dL, status PRELIMINARY (synthetic)' },
      { evidenceId: 'creatinine-b', label: 'Final lab', fact: '2026-10-22 serum creatinine 1.0 mg/dL, status FINAL (synthetic)' },
      { evidenceId: 'context-unknown', label: 'Context', fact: 'No known prior stable baseline or urine output provided.' },
    ],
    question: 'What can the available results establish? Describe uncertainty and any appropriate source verification.',
  },
];

export function assertValidationSandbox(runtime: string | undefined, publicRuntime: string | undefined) {
  const server = String(runtime || '').trim().toUpperCase();
  const browser = String(publicRuntime || '').trim().toUpperCase();
  const project = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const testProject = String(process.env.GHIMS_FIREBASE_PROJECT_ID_TEST || '').trim();
  const clientProject = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  if (
    server !== 'TEST' || browser !== 'TEST' ||
    Boolean(process.env.VERCEL) ||
    !/^ghims-ciqp-[a-z0-9-]+$/.test(project) ||
    project === 'g-hims-ai' || project !== testProject || project !== clientProject ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
  ) {
    throw new Error('CIQP_VALIDATION_TEST_EMULATOR_REQUIRED');
  }
}

function authorizedCoordinator(context: CommandContext): boolean {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [...CIQP_VALIDATION_ADMIN_ROLES],
    requiredPermissions: ['CLINICAL_VALIDATION_ADMIN'],
  }).authorized;
}

function authorizedReviewer(context: CommandContext): boolean {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [...CIQP_VALIDATION_ROLES],
    requiredPermissions: ['CLINICAL_VALIDATION_REVIEW'],
  }).authorized && (context.clinicalPrivileges || []).length > 0;
}

export function validationRole(context: CommandContext): 'COORDINATOR' | 'REVIEWER' | null {
  if (authorizedCoordinator(context)) return 'COORDINATOR';
  if (authorizedReviewer(context)) return 'REVIEWER';
  return null;
}

function dbFor(context: CommandContext) {
  assertValidationSandbox(process.env.GHIMS_RUNTIME_MODE, process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE);
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_VALIDATION_FIRESTORE_UNAVAILABLE');
  return db.collection('tenants').doc(context.tenantId);
}

function validUid(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function checkJudgment(value: unknown): value is ValidationJudgment {
  return value === 'YES' || value === 'NO' || value === 'INSUFFICIENT_EVIDENCE';
}

export function validateIndependentRoster(actors: unknown[]): asserts actors is string[] {
  if (actors.length !== 3 || !actors.every(validUid) || new Set(actors).size !== 3) {
    throw new Error('CIQP_VALIDATION_THREE_DISTINCT_REVIEWERS_REQUIRED');
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const item = value as Record<string, unknown>;
  return '{' + Object.keys(item).sort().map(
    key => JSON.stringify(key) + ':' + canonicalJson(item[key])
  ).join(',') + '}';
}

export function syntheticCaseSourceHash(input: { evidence: ValidationEvidenceItem[]; question: string }): string {
  return crypto.createHash('sha256').update(
    canonicalJson({ evidence: input.evidence, question: input.question })
  ).digest('hex');
}

function auditMutation(
  context: CommandContext,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>
) {
  const now = Date.now();
  const eventId = 'evt_' + crypto.randomUUID();
  const event: DomainEventEnvelope = {
    eventId,
    tenantId: context.tenantId,
    aggregateType: 'CLINICAL_VALIDATION_SYNTHETIC',
    aggregateId: resourceId,
    eventType: action,
    eventVersion: 1,
    payload: { studyId: CIQP_VALIDATION_STUDY_ID, resourceId, syntheticOnly: true },
    actorId: context.actorId,
    actorRole: context.roles[0] || 'STAFF',
    occurredAt: now,
    recordedAt: now,
    correlationId: context.correlationId,
    commandId: 'cv_' + crypto.randomUUID(),
    idempotencyKey: resourceId + ':' + action + ':' + context.actorId,
    source: 'system',
    schemaVersion: 1,
  };
  return {
    event,
    audit: {
      auditId: 'aud_' + crypto.randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'STAFF',
      action,
      resourceType: 'CLINICAL_VALIDATION_SYNTHETIC',
      resourceId,
      eventId,
      correlationId: context.correlationId,
      occurredAt: now,
      recordedAt: now,
      metadata: { studyId: CIQP_VALIDATION_STUDY_ID, syntheticOnly: true, ...metadata },
    },
  };
}

export class ClinicalValidationWorkspaceService {
  public static async seed(
    context: CommandContext,
    reviewerA: unknown,
    reviewerB: unknown,
    adjudicator: unknown
  ) {
    if (!authorizedCoordinator(context)) throw new Error('CIQP_VALIDATION_ADMIN_REQUIRED');
    const roster: unknown[] = [reviewerA, reviewerB, adjudicator];
    validateIndependentRoster(roster);
    const [a, b, c] = roster;
    if ([a, b, c].includes(context.actorId)) {
      throw new Error('CIQP_VALIDATION_COORDINATOR_REVIEWER_CONFLICT');
    }
    const tenant = dbFor(context);
    // The study is entirely hardcoded synthetic input. No patient, note, model
    // output or user-submitted clinical evidence is accepted through this route.
    await tenant.firestore.runTransaction(async tx => {
      const refs = STUDY_CASES.map(item => tenant.collection('clinicalValidationCases').doc(item.id));
      const existing = await tx.getAll(...refs);
      if (existing.some(s => s.exists)) throw new Error('CIQP_VALIDATION_STUDY_ALREADY_INITIALIZED');
      for (let i = 0; i < STUDY_CASES.length; i++) {
        const item = STUDY_CASES[i];
        const studyCase: ValidationSyntheticCase = {
          caseId: item.id,
          studyId: CIQP_VALIDATION_STUDY_ID,
          classification: 'SYNTHETIC_ONLY',
          caseVersion: 1,
          evidence: item.evidence,
          question: item.question,
          sourceHash: syntheticCaseSourceHash(item),
          reviewerUids: [a, b],
          adjudicatorUid: c,
          createdAt: Date.now(),
          assignedAt: Date.now(),
        };
        const { event, audit } = auditMutation(context, 'CLINICAL_VALIDATION_CASE_ASSIGNED', item.id, {
          reviewerCount: 2, adjudicatorAssigned: true, sourceHash: studyCase.sourceHash,
        });
        tx.create(refs[i], sanitizeForFirestore(studyCase));
        tx.create(tenant.collection('events').doc(event.eventId), sanitizeForFirestore(event));
        tx.create(tenant.collection('audit_logs').doc(audit.auditId), sanitizeForFirestore(audit));
      }
    });
    return { studyId: CIQP_VALIDATION_STUDY_ID, caseCount: STUDY_CASES.length };
  }

  public static async list(context: CommandContext): Promise<ValidationCaseView[]> {
    const role = validationRole(context);
    if (!role) throw new Error('CIQP_VALIDATION_ACCESS_DENIED');
    const tenant = dbFor(context);
    const list = await tenant.collection('clinicalValidationCases').limit(200).get();
    const records = list.docs.map(d => d.data() as ValidationSyntheticCase)
      .filter(c => c.studyId === CIQP_VALIDATION_STUDY_ID && c.classification === 'SYNTHETIC_ONLY')
      .filter(c => role === 'COORDINATOR' || c.reviewerUids.includes(context.actorId) || c.adjudicatorUid === context.actorId);
    const results: ValidationCaseView[] = [];
    for (const c of records) {
      const assignedPrimary = c.reviewerUids.includes(context.actorId);
      const isAdjudicator = c.adjudicatorUid === context.actorId;
      const primaryRefs = c.reviewerUids.map(uid => tenant.collection('clinicalValidationAssessments').doc(c.caseId + '_' + uid));
      const primary = await tenant.firestore.getAll(...primaryRefs);
      const allPrimaries = primary.every(s => s.exists);
      const myRef = tenant.collection('clinicalValidationAssessments').doc(c.caseId + '_' + context.actorId);
      const own = (assignedPrimary || isAdjudicator) ? await myRef.get() : null;
      const ownRecord = own?.exists ? own.data() as ValidationAssessment : null;
      const roleForCase = role === 'COORDINATOR' ? 'COORDINATOR' : assignedPrimary ? 'REVIEWER' : 'ADJUDICATOR';
      // Coordinator sees completion metadata only, never individual opinions.
      const adjudicated = role === 'COORDINATOR' && c.adjudicatorUid
        ? (await tenant.collection('clinicalValidationAssessments').doc(c.caseId + '_' + c.adjudicatorUid).get()).exists
        : false;
      const status = role === 'COORDINATOR'
        ? (adjudicated ? 'ADJUDICATED' : allPrimaries ? 'SUBMITTED' : 'PENDING')
        : ownRecord ? (isAdjudicator ? 'ADJUDICATED' : 'SUBMITTED') : 'PENDING';
      // Adjudicator sees deidentified primary reasoning only after BOTH lock.
      results.push({
        caseId: c.caseId, studyId: c.studyId, classification: c.classification,
        evidence: c.evidence, question: c.question, role: roleForCase,
        status, myAssessment: ownRecord,
        ...(isAdjudicator && allPrimaries ? { primaryAssessments: primary.map(s => {
          const data = s.data() as ValidationAssessment;
          return {
            judgment: data.judgment, confidence: data.confidence,
            evidenceRefs: data.evidenceRefs, rationale: data.rationale,
          };
        }) } : {}),
      });
    }
    return results;
  }

  public static async submit(
    context: CommandContext,
    input: Record<string, unknown>
  ): Promise<{ saved: true; kind: ValidationAssessment['kind'] }> {
    if (!authorizedReviewer(context)) throw new Error('CIQP_VALIDATION_VERIFIED_REVIEWER_REQUIRED');
    const tenant = dbFor(context);
    const caseId = String(input.caseId || '');
    if (!/^renal-synthetic-00[1-3]$/.test(caseId)) throw new Error('CIQP_VALIDATION_CASE_UNKNOWN');
    const judgment = input.judgment;
    const confidence = input.confidence;
    const rationale = String(input.rationale || '').trim();
    const attestation = String(input.attestation || '').trim();
    const refs = input.evidenceRefs;
    if (!checkJudgment(judgment) || !['LOW','MEDIUM','HIGH'].includes(String(confidence)) ||
      rationale.length < 20 || rationale.length > 2500 ||
      attestation !== 'I confirm this is my independent clinical assessment of synthetic evidence.' ||
      !Array.isArray(refs) || refs.length < 1 ||
      refs.length > 12 || !refs.every(x => typeof x === 'string')) {
      throw new Error('CIQP_VALIDATION_ASSESSMENT_INVALID');
    }
    const recordRef = tenant.collection('clinicalValidationCases').doc(caseId);
    const submissionRef = tenant.collection('clinicalValidationAssessments').doc(caseId + '_' + context.actorId);
    let kind: ValidationAssessment['kind'] = 'PRIMARY';
    await tenant.firestore.runTransaction(async tx => {
      const caseSnap = await tx.get(recordRef);
      if (!caseSnap.exists) throw new Error('CIQP_VALIDATION_CASE_NOT_FOUND');
      const studyCase = caseSnap.data() as ValidationSyntheticCase;
      if (studyCase.classification !== 'SYNTHETIC_ONLY' || studyCase.studyId !== CIQP_VALIDATION_STUDY_ID ||
          studyCase.sourceHash !== syntheticCaseSourceHash(studyCase)) throw new Error('CIQP_VALIDATION_CASE_INTEGRITY_FAILED');
      const isPrimary = studyCase.reviewerUids.includes(context.actorId);
      const isAdjudicator = studyCase.adjudicatorUid === context.actorId;
      if (!isPrimary && !isAdjudicator) throw new Error('CIQP_VALIDATION_NOT_ASSIGNED');
      kind = isPrimary ? 'PRIMARY' : 'ADJUDICATION';
      if (!refs.every(x => studyCase.evidence.some(y => y.evidenceId === x))) {
        throw new Error('CIQP_VALIDATION_EVIDENCE_REFERENCE_INVALID');
      }
      const existing = await tx.get(submissionRef);
      if (existing.exists) throw new Error('CIQP_VALIDATION_IMMUTABLE_SUBMISSION_EXISTS');
      if (isAdjudicator) {
        const a = tenant.collection('clinicalValidationAssessments').doc(caseId + '_' + studyCase.reviewerUids[0]);
        const b = tenant.collection('clinicalValidationAssessments').doc(caseId + '_' + studyCase.reviewerUids[1]);
        const prior = await Promise.all([tx.get(a),tx.get(b)]);
        if (!prior.every(s => s.exists)) throw new Error('CIQP_VALIDATION_PRIMARY_REVIEWS_NOT_LOCKED');
      }
      const assessment: ValidationAssessment = {
        caseId, studyId: CIQP_VALIDATION_STUDY_ID, actorId: context.actorId, kind,
        judgment, confidence: confidence as ValidationAssessment['confidence'],
        evidenceRefs: Array.from(new Set(refs as string[])),
        rationale, attestedQualified: true, attestation, createdAt: Date.now(), schemaVersion: 1,
      };
      const { event, audit } = auditMutation(context,
        kind === 'PRIMARY' ? 'CLINICAL_VALIDATION_PRIMARY_REVIEW_SUBMITTED' : 'CLINICAL_VALIDATION_ADJUDICATION_SUBMITTED',
        caseId, { kind, judgment, evidenceCount: assessment.evidenceRefs.length });
      tx.create(submissionRef, sanitizeForFirestore(assessment));
      tx.create(tenant.collection('events').doc(event.eventId), sanitizeForFirestore(event));
      tx.create(tenant.collection('audit_logs').doc(audit.auditId), sanitizeForFirestore(audit));
    });
    return { saved: true, kind };
  }
}
