# Helixis Clinical Intelligence — External FHIR R4 import, first engineering slice

**Status:** Source implementation and emulator qualification candidate. **Not production/site qualified.**

This is the Phase 2 inbound ingestion boundary of the standalone Clinical Intelligence extraction program. It extends the existing `FhirR4Adapter` transport; it does not replace the hospital's EHR or enable FHIR writes.

## Scope and trust boundaries

```text
Authenticated clinician/integrator session with explicit FHIR_IMPORT permission
    -> POST /api/integrations/fhir/import (tenant, source, resourceType, resourceId)
    -> authoritative tenant/session/device authorization
    -> operator-pinned source runtime (tenant/source/HTTPS endpoint/credential)
    -> tenant-owned ACTIVE + APPROVED source config and facility authorization
    -> FHIR R4 versioned read through existing transport (no redirects)
    -> verified patient link + current consent + canonical patient inside transaction
    -> immutable source version + provenance event + audit + HELD outbox atomically
    -> isolated external evidence staging (not native Patient 360 authority)
```

Only `Patient`, `Encounter`, and `Observation` read imports are in this slice. No search, pagination, subscriptions, patient demographic matching, arbitrary resource types, source API write-back, or source EHR mutation is exposed through this ingress route. Other FHIR types require qualified normalizers first.

**Important:** FHIR `meta.versionId` is opaque and is never sorted lexicographically or numerically. This importer requires `meta.versionId` and `meta.lastUpdated` by **site integration policy** (the FHIR standard itself makes metadata optional). Later arrivals with an older `lastUpdated` are immutable historical evidence, not current. Ties across distinct versions are held for reconciliation. Source history gaps cannot be proven absent from this endpoint.

## Firestore schema — all tenant-scoped

All documents are only writable/readable by trusted Firebase Admin paths. Firestore browser rules explicitly deny direct access.

- `/tenants/{tenantId}/fhirSources/{sourceId}`
  - `{tenantId,sourceId,facilityId,baseUrl,status:'ACTIVE',securityReviewStatus:'APPROVED',approvedResourceTypes:['Patient','Encounter','Observation']}`
  - Must be provisioned by a privileged operator after hospital identity/consent review. Never by a browser or an integrator using the import route.
- `/tenants/{tenantId}/fhirPatientLinks/{sha256-derived-key}`
  - `{tenantId,sourceId,externalPatientId,patientId,facilityId,matchStatus:'VERIFIED',consentStatus:'GRANTED',verifiedBy}`
  - Deterministic ID from `fhirPatientLinkId(sourceId, externalPatientId)`. No name/DOB fuzzy fallback. Links are verified **out of band** by the hospital.
- `/tenants/{tenantId}/fhirImportedVersions/{receiptId}`
  - Immutable captured JSON of a source version, normalized evidence summary, SHA-256, source timestamp/version and mapping provenance.
- `/tenants/{tenantId}/fhirResourceHeads/{headId}`
  - Mutable derived head only for clearly newer versions, scoped by source and resource. Head is **not** a clinician-authored clinical fact.
- `/tenants/{tenantId}/fhirImportEvents/{eventId}`
  - Immutable `EXTERNAL_FHIR_VERSION_IMPORTED` or `EXTERNAL_FHIR_VERSION_QUARANTINED` evidence event.
- `/tenants/{tenantId}/auditLogs/{auditId}`
  - Immutable import action/actor/source reference (not raw credentials).
- `/tenants/{tenantId}/fhirImportOutbox/{outboxId}`
  - `status:'HELD'`, `destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION'`. This is deliberately separate from the native outbox dispatcher. Do not publish these messages into native Patient 360 without an independently qualified external projector and clinical review.

There are **no composite indexes** for this workflow: source, link, version and head lookups use deterministic document paths. Single-field index exemptions protect the long raw `resourceJson` and nested clinical payload.

## Authorization

The request does **not** supply a FHIR endpoint, OAuth credential, raw resource, patient ID or provider-supplied identity. The server:

1. Verifies a Firebase ID token and active server session/device using `deriveAuthoritativeContext`.
2. Requires explicit `FHIR_IMPORT` permission, not merely admin/configuration rights.
3. Requires the registered source's facility to be in the caller's authoritative facility scope.
4. Requires source `status=ACTIVE`, `securityReviewStatus=APPROVED`, resource in source allowlist and exact operator-pinned HTTPS base URL.
5. Reads from the configured hospital server, then **rechecks** source, patient link, consent and canonical patient inside the Firestore transaction. Revocation during network retrieval fails closed.
6. Rejects unverified/different/merged patient links, cross-tenant identities and cross-patient revision changes.

**Initial runtime limitation:** This route pins **one** FHIR source to one deployment using server-side configuration; it must not be represented as a multi-source OAuth credential broker. Before operating as multi-tenant SaaS, implement per-tenant managed-secret identities, OAuth audience/scope/expiry verification, refresh and rotation, subscription/polling governance and source-specific SSRF/network egress policy. Treat credentials as secrets; do not commit them or store bearer tokens in `fhirSources`.

## Controlled environment variables (never public or client-supplied)

```dotenv
GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=false
GHIMS_INTEGRATION_FHIR_R4_STATE=DISABLED
GHIMS_CI_FHIR_SOURCE_TENANT=
GHIMS_CI_FHIR_SOURCE_ID=
GHIMS_CI_FHIR_BASE_URL=https://hospital.example/fhir/R4
GHIMS_CI_FHIR_ACCESS_TOKEN=
```

A controlled site can enable `LIVE` only after documented consent, scope, endpoint and clinical governance sign-off. Runtime token injection is an initial narrow transport mechanism; expiring tokens and institutional OAuth/SMART credentials need a token broker before unattended operational sync. In production, use hosted secret injection, never `NEXT_PUBLIC_*` or checked-in `.env`.

### Request shape

```http
POST /api/integrations/fhir/import
Authorization: Bearer <firebase-id-token>
x-ghims-session-id: <active-session>
x-ghims-device-id: <bound-device-if-applicable>
Content-Type: application/json

{"tenantId":"hospital-a","sourceId":"ehr-1","resourceType":"Observation","resourceId":"lab-1001"}
```

Returns a scoped import receipt without the raw resource. Duplicate exact versions return `replay:true`; same version with conflicting content or patient mapping is rejected.

## Replay, corrections, provenance, failure handling

- Source tuple `(sourceId,resourceType,resourceId,meta.versionId)` hashes to a deterministic receipt and event ID. A duplicate with identical payload and link returns the existing receipt. Different payload for same version fails; no silent overwrite.
- A revised version creates a *new* receipt, event, audit and held outbox; the previous imported version is never mutated.
- Out-of-order older revisions persist as historical evidence. Equal timestamps with different opaque versions persist as `RECONCILIATION_REQUIRED`; neither advances current head.
- Source `entered-in-error`, deletion, conditional-read `404/410`, merge/split, withdrawn consent or unavailable past history **require a site-defined reconciliation workflow** before these can alter clinician-facing projections.
- No FHIR server requests occur inside the Firestore transaction. A transient HTTP retry is read-only; Firestore retries remain safe through deterministic IDs and atomic writes.
- The remote server's `meta.lastUpdated` is *source evidence*, not proof of completeness or clinical accuracy.
- The full FHIR resource is preserved as a bounded, server-only versioned JSON payload with SHA-256. Protected evidence has indexing exemptions and is never returned through the import API.

## Qualification

- `bun test tests/helixis-external-fhir-import.test.ts`
- `firebase emulators:exec --project ghims-p4-ci --only firestore "bun test emulator-security/helixis-external-fhir-import.test.ts"`
- `bun run typecheck`
- `bun run lint`
- `bun run test:wave4`

The PR-specific workflow runs these checks. Emulator tests require `FIRESTORE_EMULATOR_HOST` and refuse to run on a live Firestore database.

### Non-negotiable site qualification still outstanding

1. Institution-signed endpoint, issuer, scopes and network egress contract.
2. Clinical/integration officer dual approval of every patient link and consent basis.
3. FHIR CapabilityStatement and actual `Patient`, `Encounter`, `Observation` reads against the selected HIS.
4. Real version history/correction/deletion semantics and rate/timeout limits.
5. External evidence-to-Clinical Intelligence projector and clinical safety evaluation.
6. Independently witnessed tenant-isolation, downtime replay, restoration and rollback exercises.
7. Approval to lift held outbox records; **no automatic external-to-native Patient 360 promotion**.

## Rollback

Disable `GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED` or set `GHIMS_INTEGRATION_FHIR_R4_STATE=DISABLED`. Existing immutable version receipts and audit evidence remain available to authorized server operators; no external HIS data is changed. Review source access revocation and secret rotation if endpoint trust is compromised.
