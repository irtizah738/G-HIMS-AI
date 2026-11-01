# CI-EXT-06 — Vendor HIS / FHIR R4 synthetic sandbox probe

**Engineering status:** review candidate; live vendor execution NOT performed. No production traffic, no real patient data. This is a technical evidence capture mechanism, not site approval.

## Goal and authority boundaries

Helixis already supports governed FHIR R4 reads, tenant-scoped SMART OAuth, immutable imported evidence and separate hospital site review. CI-EXT-06 fills the gap between passing simulated transport tests and observing a **specific hospital vendor's real sandbox**. The runner is strictly read-only and requires pre-provisioned synthetic fixtures. It does not change native Patient 360 or authorize clinical AI.

```text
Authenticated STAGING integration engineer (FHIR_VENDOR_SANDBOX_PROBE)
    -> POST /api/integrations/fhir/vendor-probe {tenantId,sourceId}
    -> canonical tenant/session/device + facility authorization
    -> server-owned approved source registration
    -> server-owned approved synthetic fixture manifest
    -> exact host allowlist and public-DNS resolution preflight
    -> registered SMART Backend OAuth credential in Secret Manager
    -> GET synthetic Patient, Encounter, Observation by approved IDs
    -> validate source version IDs, timestamps, patient references, LOINC code
    -> second GET of same Observation, compare version/lastUpdated
    -> immutable fhirVendorProbes technical observation (no PHI)
    -> independent site/clinical review still required
```

The endpoint is denied unless `GHIMS_RUNTIME_MODE=STAGING`,
`GHIMS_INTEGRATION_FHIR_R4_STATE=INTEGRATION_READY`,
`GHIMS_CI_FHIR_AUTH_MODE=SMART_BACKEND`, and
`GHIMS_CI_VENDOR_SANDBOX_PROBE_ENABLED=true`. The feature defaults off.

It accepts exactly `tenantId` and `sourceId`. No URL, resource ID, raw
fixture, OAuth credential, arbitrary clinical payload or self-reported result can
be submitted by the client.

## Source-owned fixture manifest

`/tenants/{tenantId}/fhirSyntheticFixtureManifests/{sourceId}`

```json
{
  "tenantId": "synthetic-hospital",
  "sourceId": "vendor-fhir",
  "facilityId": "synthetic-campus",
  "manifestRevision": 1,
  "status": "APPROVED",
  "syntheticOnly": true,
  "credentialRevision": 2,
  "fhirBaseUrl": "https://fhir.sandbox-vendor.example/r4",
  "tokenUrl": "https://auth.sandbox-vendor.example/token",
  "approvedBy": "hospital-integration-officer",
  "vendorAuthorizationId": "vendor-sandbox-consent-2026",
  "approvedAt": 1793500000000,
  "expiresAt": 1794000000000,
  "fixtures": {
    "patientId": "vendor-synthetic-p1",
    "encounterId": "vendor-synthetic-e1",
    "observationId": "vendor-synthetic-o1",
    "observationCodeSystem": "http://loinc.org",
    "observationCode": "2160-0"
  }
}
```

The manifest is written by a privileged enrollment service or operator after
receiving express vendor authorization and **verifying the three IDs are
synthetic**. The browser cannot write or read it. A boolean field by itself is
not proof that the vendor's data is synthetic. Avoid testing against unknown
Patient IDs, real tenant clinical data, or third-party public demo sandboxes
without their approved terms.

All scoped fields, OAuth credential revision, exact FHIR and token endpoint,
approval expiry (maximum 30 days) and fixture IDs are validated before any
network traffic. Changes during remote calls invalidate the result.

## Read-only qualification and failure handling

The runner performs only four reads (same Observation twice). It validates:
- exact resource type/ID and `meta.versionId`/`meta.lastUpdated`;
- Encounter and Observation reference the expected synthetic Patient;
- Observation contains the expected configured code+system;
- repeated Observation read returns the same version/timestamp;
- strict response size (128 KiB) and transport timeouts;
- never follows redirects, never writes back into the vendor EHR;
- no patient names, dates of birth, observations values, raw clinical JSON,
  bearer tokens or client assertions in the qualification response/audit.

Results are `OBSERVED_PENDING_INDEPENDENT_REVIEW` or `FAILED`. The runner
does **not** create the separate `fhirSyntheticQualifications` PASS receipt
consumed by CI-EXT-05. Reconciliation, import idempotency, device/consent
withdrawal, unavailable network behavior and clinical validation require
additional independent qualification evidence; checking stable vendor reads
does **not** prove them.

Result documents:
`/tenants/{tenantId}/fhirVendorProbes/{evidenceId}` with immutable source,
actor, credential and manifest revisions, boolean checks, error codes,
content-free evidence hash, observed timestamp, and explicit
`qualifiedForPatientData=false`, `qualifiedForProduction=false`,
`independentReviewRequired=true`. All browser access denied.

## Network egress and operational setup

The sandbox HTTP origins must match exact allowlisted HTTPS hostnames. Preflight
DNS rejects local, link-local, private, metadata, carrier-grade NAT, multicast,
documentation and malformed address destinations.

**Important:** DNS preflight alone cannot prevent DNS rebinding or address
changes after validation. A real deployment MUST enforce its egress policy at
an isolated outbound proxy/gateway (or fixed approved private integration
gateway) and forbid direct workload egress. Do not deploy CI-EXT-06 on an
unrestricted runtime to an internet-selected destination.

Use separate STAGING Workload Identity, source-only Secret Manager access and
a source allowlist; record operator identity, vendor authorization document ID,
sandbox purpose and planned rollback. Run from a network location authorized
by the hospital/vendor. No real sandbox credential is bundled in this repo.

## Site acceptance remaining (NOT asserted by CI-EXT-06)

1. Hospital/vendor supplies approved sandbox URL, registered OAuth client, public key and three synthetic FHIR fixture IDs.
2. Technical reviewer runs the actual probe and examines the immutable evidence receipt.
3. Qualify source version changes, replay/import idempotency, ambiguous identity, consent revocation, cross-tenant attempts, 401/429/5xx, offline/network failure, partial recovery, egress protection and secret rotation using **synthetic** hospital vendor data only.
4. Independent clinical and security reviewers record signed decisions. The existing CI-EXT-05 onboarding gate must receive separately approved synthetic qualification evidence, not this technical probe alone.
5. Approve real patient data processing and production changes only under distinct site consent, privacy, clinical safety, security and release governance.

**Rollback:** keep `GHIMS_CI_VENDOR_SANDBOX_PROBE_ENABLED=false` to disable future probes. `SUSPEND_SOURCE` in CI-EXT-05 blocks all new imports; preserve immutable evidence/audit per retention policy. Production `GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED` and `GHIMS_INTEGRATION_FHIR_R4_STATE` are unchanged by CI-EXT-06.

## Local synthetic qualification

```bash
bun run typecheck
bun run lint
bun test tests/ci-ext06-vendor-sandbox-probe.test.ts
```

A green GitHub action proves synthetic contract behavior only. It must never be
presented as successful live vendor/HIS integration.
