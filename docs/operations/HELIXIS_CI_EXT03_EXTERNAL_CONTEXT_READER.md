# CI-EXT-03 — External Clinical Evidence Reader

**Status:** Engineering qualification candidate. **Never a clinical deployment approval.**

The standalone Helixis FHIR R4 ingestion and external Patient 360 projection were merged in PR #241. This gate introduces a **distinct external evidence-review read contract** instead of coercing external facts into the native `Patient360Projection` interface.

## Architecture

```text
Third-party HIS / FHIR R4
   -> authorized versioned imports
   -> immutable FHIR receipt + event + held outbox
   -> external Patient 360 evidence projection (immutable revisions)
   -> CI-EXT-03 read transaction
       + authenticated tenant/session/device scope
       + explicit FHIR_EVIDENCE_REVIEW grant
       + facility scope across ALL external source heads
       + verified patient link + current consent
       + approved ACTIVE source registration
       + patient merge/scope guard
       + current heads, source receipts and imported event lineage
       + unresolved reconciliation fence
       + SHA256 evidence/projection and exact generation checkpoint
       + max 5-minute projection freshness
       + atomic externalContextAccessAudits event
   -> authorized evidence-only reviewer response
   -> NOT native Patient 360 and NOT AI drafting
```

## Security contract

* `POST /api/integrations/fhir/evidence` requires server-verified identity and the existing session/device/tenant authorization pipeline, plus **explicit** `FHIR_EVIDENCE_REVIEW` permission. Neither administrator role, native clinical privileges, nor `FHIR_IMPORT` alone are sufficient.
* The endpoint requires `GHIMS_CI_EXTERNAL_EVIDENCE_READER_ENABLED=true` and an approved LIVE FHIR integration state; the new feature flag defaults to OFF.
* The caller selects only tenant and patient. Source endpoints, signed client projections, resource payloads, credentials and external patient link overrides are not accepted.
* The reader never trusts a projected fact alone: it checks the complete source-head set, versioned receipt, immutable import event, content digest, verified patient identity link, live consent, source authorization, case status and exact projection checkpoint within a Firestore transaction. Evidence access is recorded in `externalContextAccessAudits`, atomically with a successful disclosure decision.
* A source/patient merge, expired projection, changed source revision, withdrawn consent, missing event, source revocation, cross-facility access, unresolved case, tampered evidence or unrecognized source forces denial. Errors include no PHI, source URL or credentials. The API returns `Cache-Control: no-store, private`.
* Bound initial implementation: up to 64 resource heads and 64 reconciliation cases for one patient; larger data sets fail closed pending an explicit pagination and checkpoint-consistency design.
* No access to `externalContextAccessAudits` via the browser Firestore SDK. Admin-only persistence.

## Firestore schema

`/tenants/{tenantId}/externalContextAccessAudits/{auditId}`:

```json
{
  "auditId": "cea_<uuid>",
  "action": "EXTERNAL_FHIR_EVIDENCE_READ",
  "tenantId": "tenant-a",
  "patientId": "canonical-id",
  "actorId": "authorized-reviewer",
  "evidenceCount": 4,
  "revision": 3,
  "contentHash": "<sha256>",
  "sourceCheckpoint": "<sha256>",
  "recordedAt": 1793500000000,
  "immutable": true,
  "clinicalUseAuthorized": false
}
```

Access uses document IDs and bounded per-patient queries; no new compound index is required for this milestone. The data itself remains in the existing tenant-scoped immutable import and projection collections.

## External review response

```json
{
  "success": true,
  "source": "EXTERNAL_FHIR",
  "tenantId": "hospital-a",
  "patientId": "patient-1",
  "projectionRevision": 2,
  "projectionContentHash": "<sha256>",
  "sourceCheckpoint": "<sha256>",
  "status": "EVIDENCE_ONLY",
  "historyCompleteness": "UNVERIFIED",
  "clinicalUseAuthorized": false,
  "clinicianVerified": false,
  "aiDraftingEligible": false,
  "evidenceOnly": true,
  "facts": [{ "type": "Observation", "clinicalVerification": "UNVERIFIED_EXTERNAL" }]
}
```

Clinical reviewers are to view these as **source observations**, not native hospital-authoritative facts. The existing `getConfiguredClinicalContextReader` intentionally still throws `CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED` for `EXTERNAL` mode. Using imported evidence for AI drafting or decision support is NOT permitted by this gate.

## Acceptance and failure tests

- Unit: explicit review permission, tenant scope, freshness policy, tamper detection and refusal of native external-mode fallback.
- Isolated Firestore emulator under Node.js: accepted review creates access audit; expired projection denied; a new FHIR version without rebuild denied; rebuilt version accepted; unresolved source collision denied; withdrawn consent, mismatched tenant/facility and tampered projection denied; no native Patient 360 projection is written.
- CI: `bun run typecheck`, `bun run lint`, Bun contract tests and Node-native Firestore emulator integration.
- No external HIS contacted, no real patient data, no production integration toggle changed.

## Gates still open

1. Qualified hospital-specific FHIR connection, OAuth2/SMART scopes, secret management and rotation.
2. Verified patient identity reconciliation and consent records owned by the hospital.
3. Source freshness monitoring, FHIR history gaps, deletions, source tombstones and content normalization/coding qualification.
4. Clinical evidence-review interface, clinical reviewer validation, comprehensive incident drill and site-specific sign-off.
5. A **separate** clinical-source qualification policy before `ClinicalContextReader`, drafting, deterioration alerts, or Patient 360 authoritative clinical synthesis may consume external evidence.

**Rollback:** Set `GHIMS_CI_EXTERNAL_EVIDENCE_READER_ENABLED=false` or disable FHIR integration. All immutable imports, historical revisions and access audit entries remain retained under hospital retention rules.
