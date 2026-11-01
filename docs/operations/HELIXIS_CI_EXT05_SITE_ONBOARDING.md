# CI-EXT-05 — Governed Hospital FHIR Site Onboarding

**Status: Code review / isolated synthetic qualification. No live HIS, no patient data, no production activation.**

SMART Backend Services (<https://hl7.org/fhir/smart-app-launch/backend-services.html>) confirms authorization to request vendor FHIR resources. It does not establish a hospital-specific agreement, identity matching, reliable event replay, or approval to process real patients. CI-EXT-05 keeps those separate.

## Security contract

Existing hospital integrations and secrets must be provisioned by authorized operators outside this endpoint. Onboarding cannot accept client-submitted credentials, OAuth endpoints, source configuration, synthetic test results, identity links, reviewer identities, or evidence payloads.

`POST /api/integrations/fhir/onboarding` is **STAGING only** and requires all:

- `GHIMS_CI_FHIR_SITE_ONBOARDING_ENABLED=true`
- `GHIMS_RUNTIME_MODE=STAGING`
- `GHIMS_INTEGRATION_FHIR_R4_STATE=INTEGRATION_READY`
- Verified server session, canonical tenant membership and device authorization

The server supports five actions with distinct explicit permissions:

| Action | Permission | Effect |
|---|---|---|
| `REQUEST` | `FHIR_SITE_REQUEST` | Validate existing source + immutable protocol and synthetic qualification receipts; start a bounded, replay-safe site review |
| `CLINICAL_REVIEW` | `FHIR_SITE_CLINICAL_APPROVE` | Create an immutable clinical approval decision with rationale digest |
| `SECURITY_REVIEW` | `FHIR_SITE_SECURITY_APPROVE` | Create an immutable security decision with rationale digest |
| `ACTIVATE_APPROVAL` | `FHIR_SITE_ACTIVATE` | Require independent reviewers, freshness and unchanged source configuration; atomically create immutable site approval and link it to source |
| `SUSPEND_SOURCE` | `FHIR_SITE_SUSPEND` | Immediately change registered source to `SUSPENDED` and append immutable suspension event |

The requester, clinical reviewer, security reviewer and activation operator must all be different authenticated identities. Facility scope is enforced on every action. No administrator role grants any of the five permissions implicitly.

## Verified immutable evidence

Two **server-written** evidence receipts must already exist:

1. `/tenants/{tenantId}/fhirSandboxQualifications/{qualificationId}` — current credential revision, passed SMART discovery and FHIR R4.0.1 read capability; `PROTOCOL_PASSED_SITE_PENDING`, no patient-data production approval.
2. `/tenants/{tenantId}/fhirSyntheticQualifications/{evidenceId}` — a trusted vendor-connected synthetic qualification, scoped to same source/credential/facility and earlier protocol receipt, with independent testing evidence for verified patient matching, replay, consent withdrawal, tenant isolation and network recovery. Must be `syntheticOnly=true`, `outcome=PASS`, reviewed and unexpired.

**Important:** CI-EXT-05 intentionally provides NO web endpoint for creating the second receipt. An approved site qualification runner / reviewer must create it from actual authorized vendor-sandbox tests. A manually invented PASS record does not establish a real deployment qualification.

A review request expires after seven days, source fingerprints pin the source URL, status, approved resource types and OAuth registration, and activation requires evidence no older than 30 days.

## Firestore schema

```text
tenants/{tenantId}/
  fhirSources/{sourceId}                          # Existing operator-provisioned metadata
  fhirSandboxQualifications/{qualificationId}     # Existing protocol-only proof
  fhirSyntheticQualifications/{evidenceId}       # Trusted synthetic site qualification proof
  fhirSiteReviewRequests/{requestId}              # Mutable derived review state
  fhirSiteReviewDecisions/{decisionId}            # Immutable, one reviewer/discipline decision
  fhirSiteReviewEvents/{eventId}                  # Immutable request/activation/suspension
  fhirSiteApprovals/{siteApprovalId}              # Immutable dual-reviewed hospital authorization
```

All listed review collections are browser-denied in Firestore rules; only server-admin paths can read/write. No new compound Firestore index is required: actions reference document IDs.

One successful approval resembles:

```json
{
  "approvalId": "fsa_...",
  "tenantId": "hospital-a",
  "sourceId": "site-ehr",
  "facilityId": "site-campus",
  "status": "APPROVED",
  "credentialRevision": 2,
  "approvedResourceTypes": ["Observation"],
  "clinicalReviewerId": "clinical-reviewer-uid",
  "securityReviewerId": "security-reviewer-uid",
  "sandboxQualificationId": "fsq_...",
  "syntheticEvidenceId": "synthetic-qualification-id",
  "activationActorId": "release-officer-uid",
  "reviewedAt": 1793500000000,
  "expiresAt": 1796000000000,
  "immutable": true
}
```

The current import route already requires `source.siteApprovalId` and checks the approval in the same Firestore transaction as the immutable imported version, guaranteeing source revocation and credential-rotation fences remain authoritative. This new flow is the only application onboarding path that issues a site approval, replacing fabricated static reviewer IDs. Admin credentials remain a trusted privileged boundary, so direct server-admin writes must still be controlled by IAM, change management and audit.

## Acceptance, rollback and limitations

Emulator tests cover missing synthetic evidence, idempotent requests, reviewer self-approval denial, both distinct approvals, distinct activator, atomic approval creation, deterministic replay, cross-tenant denial, suspension and admission rejection after suspension. Existing SMART OAuth and evidence-only isolation tests remain required.

**No patient data flows after onboarding alone.** `GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED` and `GHIMS_INTEGRATION_FHIR_R4_STATE=LIVE` are never changed by this implementation. A production site still needs hospital/vendor onboarding, real sandbox credentials, infrastructure egress protection, independent clinical sign-off and deliberate environment promotion.

Emergency rollback is `SUSPEND_SOURCE`: imported evidence and immutable history are retained; no new source imports can pass an ACTIVE source check. This is not a hard data deletion. Native clinical drafting continues to deny external context promotion.
