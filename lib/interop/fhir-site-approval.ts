/**
 * Hospital site authorization is separate from SMART protocol conformance.
 * This gate must pass before any external FHIR patient resource is fetched.
 * Rechecked inside the import transaction to defeat revoke/rotate races.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';

export type FhirSiteApproval = {
  tenantId: string;
  sourceId: string;
  facilityId: string;
  approvalId: string;
  status: 'APPROVED' | 'PENDING' | 'REVOKED';
  credentialRevision: number;
  approvedResourceTypes: string[];
  clinicalReviewerId: string;
  securityReviewerId: string;
  sandboxQualificationId: string;
  reviewedAt: number;
  expiresAt: number;
};
export function validateFhirSiteApproval(
  source: FhirSourceRecord,
  approval: FhirSiteApproval | null,
  resourceType: string,
  now: number
): FhirSiteApproval {
  if (!approval || !source.siteApprovalId ||
      approval.approvalId !== source.siteApprovalId ||
      approval.tenantId !== source.tenantId ||
      approval.sourceId !== source.sourceId ||
      approval.facilityId !== source.facilityId ||
      approval.status !== 'APPROVED' ||
      approval.credentialRevision !== source.oauth?.credentialRevision ||
      !approval.approvedResourceTypes?.includes(resourceType) ||
      !source.approvedResourceTypes.includes(resourceType) ||
      !approval.clinicalReviewerId || !approval.securityReviewerId ||
      approval.clinicalReviewerId === approval.securityReviewerId ||
      !approval.sandboxQualificationId ||
      !Number.isFinite(approval.reviewedAt) ||
      !Number.isFinite(approval.expiresAt) ||
      now < approval.reviewedAt ||
      now >= approval.expiresAt ||
      approval.expiresAt - approval.reviewedAt > 90 * 86400_000) {
    throw new Error('CI_EXT04_SITE_APPROVAL_REQUIRED');
  }
  return approval;
}
export function siteApprovalDocId(source: FhirSourceRecord): string {
  const id = source.siteApprovalId || '';
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id) || id === '.' || id === '..') {
    throw new Error('CI_EXT04_SITE_APPROVAL_REQUIRED');
  }
  return id;
}
export async function preflightFhirSiteApproval(args: {
  db: Firestore;
  source: FhirSourceRecord;
  resourceType: string;
  now?: () => number;
}): Promise<FhirSiteApproval> {
  const { db, source, resourceType } = args;
  const snap = await db.collection('tenants').doc(source.tenantId)
    .collection('fhirSiteApprovals').doc(siteApprovalDocId(source)).get();
  return validateFhirSiteApproval(
    source, snap.exists ? snap.data() as FhirSiteApproval : null,
    resourceType, (args.now || Date.now)()
  );
}
