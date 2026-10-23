# CIQP — Versioned clinical governance evidence contract (proposed; NOT an approval)

**Status: SPECIFICATION ONLY — NOT IMPLEMENTED AS A WRITE WORKFLOW, NOT SIGNED, NOT CLINICALLY APPROVED.**  
**Linked draft work:** [renal policy PR #215](https://github.com/irtizah738/G-HIMS-AI/pull/215), [validation workspace PR #216](https://github.com/irtizah738/G-HIMS-AI/pull/216).  
**Production Clinical Intelligence: DISABLED.** Synthetic TEST/emulator scope is unchanged.

## Authoritative external documents (do not duplicate or invent decisions)

- `docs/clinical-intelligence/CI10D_RENAL_CLINICAL_POLICY_APPROVAL_FORM.md` in #215: proposed creatinine thresholds, wording, populations/exclusions, baseline semantics, acknowledgement SLA and clinical response. All signature fields currently blank.
- `docs/clinical-intelligence/CI10D_BLINDED_RENAL_VALIDATION_PREREGISTRATION.md` in #215: study prerequisites, blinded reference judgments, preregistered outcomes and stop rules.
- `docs/clinical-intelligence/CLINICAL_VALIDATION_WORKSPACE_MVP.md` in #216: isolated TEST-only engineering workflow and separate 120-case generated rehearsal.

A checkbox, GitHub comment, CI success, synthetic review, typed attestation or coordinator action must **never** become an institutional policy approval. Signing requires independently verified human authorization and a valid signature/evidence process.

## Proposed immutable authority records (future implementation; no endpoints are created by this specification)

```text
tenants/{tenantId}/clinicalValidationGovernanceEvidence/{evidenceId}
tenants/{tenantId}/clinicalValidationGovernanceReadModels/{studyId}  # derived cache only
tenants/{tenantId}/events/{eventId}
tenants/{tenantId}/audit_logs/{auditId}
```

Each governance evidence document is created once by a tenant-scoped server command, never updated/deleted. New decisions create **new** documents with `supersedesEvidenceId` and a monotonically validated subject revision. Example shape (illustrative fields, not an approval):

```ts
interface ClinicalGovernanceEvidenceV1 {
  schemaVersion: 1;
  evidenceId: string;                 // server-generated, immutable
  tenantId: string;                   // derived from server context
  studyId: string;                    // canonical study, NOT rehearsal
  gate: 'RENAL_SCREEN_POLICY' | 'STUDY_PROTOCOL' |
        'REVIEWER_CREDENTIALS' | 'COHORT_FREEZE' |
        'BLINDED_REFERENCE_LOCK' | 'MODEL_OUTPUT_LOCK' |
        'CLINICAL_EVALUATION_ACCEPTANCE' | 'INSTITUTIONAL_RELEASE';
  disposition: 'APPROVED' | 'REVISE' | 'REJECTED';
  policyVersion: string;
  protocolVersion: string;
  sourceManifestSha256: string;        // required for cohort-specific gates
  codeCommitSha: string;
  allowedPopulation: string[];        // explicitly scoped
  exclusions: string[];
  approvedWordingSha256: string | null;
  escalationPolicySha256: string | null;
  decisionDocumentSha256: string;
  signingEvidenceRef: string;          // immutable restricted evidence storage
  signerUid: string;                  // authenticated; not from browser body
  signerInstitutionId: string;
  signerCredentialVerificationRef: string;
  independentVerifierUid: string;
  signerConflictOfInterestDeclared: boolean;
  signatureVerification: {
    method: string;
    verifierVersion: string;
    verifiedAt: number;               // trusted server / verification service
    signedContentSha256: string;
  };
  createdAt: number;                  // trusted server time
  supersedesEvidenceId: string | null;
  correlationId: string;
  eventId: string;
}
```

A `signatureVerification` object is **evidence metadata, never self-attestation**: only an independently trusted verification service can populate it. The contract must be adjusted to the institution's accepted legal signature mechanism and credential verification process before implementation. Personal credential/license details must not be copied into public document paths, error messages or browser responses; store minimum verifiable references.

## Write authority, audit and isolation

1. A proposed **new** server-only `SUBMIT_CLINICAL_GOVERNANCE_DECISION` command must require tenant membership, an active verified staff session, canonical HCM credential/licensure, gate-specific permission and approved institutional signer assignment. Do not reuse the general admin wildcard: being platform admin is not proof of clinical authority.
2. The signer, independent verifier and, where required, clinical adjudicator must be distinct from engineering author/coordinator; reject conflicts of interest or expired credentials. For nephrology policy require a qualified renal specialist **and** a site clinical lead; institutional governance is a separate authority.
3. Bind the signed bytes to the exact policy/protocol, threshold/warning/escalation wording, intended cohort/population, frozen dataset hash and code revision; verify the document digest and signer authority **server-side**.
4. Use Firestore transaction `create()` for immutable evidence + domain event + audit. Reject replay, revision conflicts, missing predecessor, cross-tenant and incorrect version/hash. Persist an idempotency outcome keyed by tenant, gate, signer, version and signed digest, and return the same result on retried commands.
5. Derive readiness read models from events, never let a browser write `approved: true`. Fresh commands that unlock study assignments, unblinding or any clinical alert must revalidate authoritative evidence (and revocation/expiry) rather than trust a cached projection.
6. Keep synthetic rehearsals and actual approved studies in distinct namespaces and manifests; the 120-case generated rehearsal is **NOT** the clinician-unapproved original 120-case pack. Block real-data import unless explicit institutional privacy/ethics authorization exists.

### Firestore boundary required before implementing writes

```js
match /tenants/{tenantId}/clinicalValidationGovernanceEvidence/{id} {
  allow read, write: if false;
}
match /tenants/{tenantId}/clinicalValidationGovernanceReadModels/{id} {
  allow read, write: if false;
}
```

The existing tenant catch-all deny currently blocks these unimplemented paths. Any future server-sanitized GET response must be least-privilege and must not reveal protected signer details, original blinded assessments or sealed AI predictions.

### Query/index plan (only if future read-side queries require it)

For tenant-scoped `clinicalValidationGovernanceEvidence` collection queries, composite index `studyId ASC, gate ASC, createdAt DESC`, optionally `studyId ASC, signerUid ASC, createdAt DESC` for restricted audit. Direct document lookups need no extra index. Avoid collection-group cross-tenant governance queries.

## Independent gates — all remain CLOSED

| Gate | Evidence needed | Present status |
| --- | --- | --- |
| Renal policy | Independently verified renal specialist and site clinician decisions; approved/revised thresholds, applicability, warning and escalation protocol | PENDING |
| Study protocol | Institution-approved preregistration, endpoints, stop rules and consent/ethics determination | PENDING |
| Reviewer identity | Real license, organizational appointment and conflict-of-interest verification for two primaries and separate adjudicator | PENDING |
| Cohort lock | Clinically approved independent case-pack digest and eligibility/strata rules; **not** the generated rehearsal cohort | PENDING |
| Reference adjudication | Immutable blinded primary assessments then independent third review and locked reference | NOT STARTED |
| Model unblinding/scoring | Sealed version/digest of model outputs, unblind only after reference lock, safety metrics and independent evaluation | NOT STARTED |
| Institutional release | Security CI, risk review, clinical safety and formally delegated hospital production deployment decision | NOT GRANTED |

**Gate transition discipline:** Approval of a *study protocol* authorizes only the study within its written scope, not clinical use. Failed safety endpoints, withdrawn credentials, superseding policy, changes to patient population or model/algorithm version must invalidate dependent readiness until independently reviewed again.

## Adversarial acceptance tests required for future implementation

- Reject forged signatures, staff-typed `approved`, invalid/expired credentials, platform admin acting as renal specialist, cross-tenant refs, role escalation, and revoked verifier.
- Reject mismatched policy/cohort/algorithm hashes, malformed signed bytes, duplicate/superseded version and conflicting simultaneous signers; preserve original decision and audit.
- Reject attempted study access before all independently approved gates, access to other reviewer's verdict before lock, and premature model unblinding.
- After crash/retry return the same event/evidence identity, never duplicate sign-off; under emulator replay/concurrency preserve append-only evidence and tenant isolation.
- Any missing verification, unknown version, stale model, revoked approval or failure to read provenance returns **NOT AUTHORIZED**, never implied acceptance.

## Immediate non-engineering actions

Nominate a credentialed nephrologist/renal specialist, a pilot-site clinical lead, independent adjudicator and hospital safety/governance signatory. Each must review the #215 proposal, explicitly approve/revise/reject in the institution's accepted signing process, and supply independently verifiable authorization/evidence. Do **not** commit real signatures, credentials, identity documents or patient information to GitHub. The trusted governance write path above remains a future security-qualified implementation.

**Current release decision:** #215 and #216 stay DRAFT; no model unblinding, no new real clinical data, no patient-care clinical activation, no production AI change.
