import crypto from 'crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import type { CommandContext } from '@/lib/backend/types';
import type { AIGenerationProvenance, AIPurpose } from '@/lib/ai/gateway';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';

export type AIDraftStatus =
  | 'DRAFT_REQUIRES_CLINICIAN_REVIEW'
  | 'DRAFT_REQUIRES_HUMAN_REVIEW'
  | 'ACCEPTED_IN_SIGNED_NOTE'
  | 'REJECTED';

export interface AIDraftRecord {
  draftId: string;
  tenantId: string;
  actorId: string;
  purpose: AIPurpose;
  status: AIDraftStatus;
  patientId?: string;
  encounterId?: string;
  sourceEvidenceIds: string[];
  inputHash: string;
  outputHash: string;
  output: unknown;
  provenance: AIGenerationProvenance;
  createdAt: number;
  acceptedBy?: string;
  acceptedAt?: number;
  acceptedEvidenceId?: string;
  acceptedContentHash?: string;
  acceptedStructuredDataHash?: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort()
    .map((key) => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}

export function sha256Canonical(value: unknown): string {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

export class AIDraftRepository {
  public static async create(
    context: CommandContext,
    params: {
      purpose: AIPurpose;
      status?: 'DRAFT_REQUIRES_CLINICIAN_REVIEW' | 'DRAFT_REQUIRES_HUMAN_REVIEW';
      patientId?: string;
      encounterId?: string;
      sourceEvidenceIds?: string[];
      input: unknown;
      output: unknown;
      provenance: AIGenerationProvenance;
    }
  ): Promise<AIDraftRecord> {
    const db = getAdminFirestore();
    if (!db) throw new Error('AI_DRAFT_STORE_UNAVAILABLE: durable Firestore storage is required.');

    const draftId = 'aid_' + crypto.randomUUID();
    const record: AIDraftRecord = {
      draftId,
      tenantId: context.tenantId,
      actorId: context.actorId,
      purpose: params.purpose,
      status: params.status || 'DRAFT_REQUIRES_CLINICIAN_REVIEW',
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.encounterId ? { encounterId: params.encounterId } : {}),
      sourceEvidenceIds: Array.from(new Set(
        (params.sourceEvidenceIds || []).map(String).map((v) => v.trim()).filter(Boolean)
      )),
      inputHash: sha256Canonical(params.input),
      outputHash: sha256Canonical(params.output),
      output: params.output,
      provenance: params.provenance,
      createdAt: Date.now(),
    };

    await db.collection('tenants').doc(context.tenantId)
      .collection('aiDrafts').doc(draftId).create(sanitizeForFirestore(record));
    return record;
  }

  public static async get(tenantId: string, draftId: string): Promise<AIDraftRecord | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('AI_DRAFT_STORE_UNAVAILABLE: durable Firestore storage is required.');
    const snapshot = await db.collection('tenants').doc(tenantId)
      .collection('aiDrafts').doc(draftId).get();
    return snapshot.exists ? (snapshot.data() as AIDraftRecord) : null;
  }

  public static buildAcceptedState(
    draft: AIDraftRecord,
    params: {
      actorId: string;
      evidenceId: string;
      signedContent: string;
      acceptedStructuredData?: Record<string, unknown>;
      acceptedAt: number;
    }
  ): AIDraftRecord {
    return {
      ...draft,
      status: 'ACCEPTED_IN_SIGNED_NOTE',
      acceptedBy: params.actorId,
      acceptedAt: params.acceptedAt,
      acceptedEvidenceId: params.evidenceId,
      acceptedContentHash: sha256Canonical(params.signedContent),
      acceptedStructuredDataHash: sha256Canonical(params.acceptedStructuredData || {}),
    };
  }
}
