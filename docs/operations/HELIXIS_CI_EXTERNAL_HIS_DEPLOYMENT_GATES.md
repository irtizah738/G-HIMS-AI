# Helixis Clinical Intelligence — external HIS deployment gates

**Status: EXTERNAL_HIS_CLINICAL_GO=NO_GO.** This plan applies to independently deployed Helixis connecting to a hospital's active HIS using read-only FHIR APIs or a locally controlled integration gateway. The native G-HIMS Patient 360 does not become clinically authoritative simply because an external FHIR resource was retrieved.

## P0 — Source-authority interlock implemented in this change

`GHIMS_CI_CONTEXT_SOURCE=EXTERNAL` refuses all native Clinical Intelligence POST and GET routes (`drafts`, `evidence-snapshots`, `longitudinal-summary`, `encounter-preparation`, `medication-reconciliation`, `trends`) with **409** `CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED` and `Cache-Control: no-store, private`, **before** patient/encounter lookup, native Patient 360 projection rebuilding, saved artifacts, or AI calls. Unknown context mode returns **503** `CI_STANDALONE_CLINICAL_CONTEXT_SOURCE_INVALID`. These are safe unqualified statuses, not clinical missing-data diagnoses. `NATIVE` remains the current default to avoid breaking existing hospital-OS installations.

The separate `/api/integrations/fhir/evidence` route retains its explicit `FHIR_EVIDENCE_REVIEW` RBAC, tenant/facility authorization, live link and consent checks, immutable receipt/source/availability/history reconciliation, atomic read audit, and `EVIDENCE_ONLY` / `aiDraftingEligible: false` response. **Never cast `ExternalPatient360Projection` into the native `Patient360Projection` type.**

This process-wide environment interlock is **not sufficient** for future mixed-mode multi-tenant deployments. Before a single runtime hosts both native and external hospitals, use a server-authoritative per-tenant integration mode and source generation, transactionally checked at each patient scope decision, instead of inheriting a global flag. Avoid trusting browser-provided tenant or mode fields.

## Remaining hospital activation gates (not completed by this PR)

| Gate | Required evidence | Release disposition |
| --- | --- | --- |
| G1 network | Actual Cloud Run workload source identity and route/SWP fail-closed ALLOW Epic-host-only vs DENY arbitrary host, with independent packet/firewall/log provenance | NO_GO |
| G2 runtime | Hosted, source-sharded worker/scheduler with verified IAM and least-privilege Secret Manager/KMS, bounded retries, idempotent lease/checkpoint and no browser-credential access | NO_GO |
| HIS contract | Signed hospital API/data-processing agreement, verified service endpoint, read-only scopes, rate limits, location of data processing, authorization of patient categories and patient consent workflow | NO_GO |
| Source adapter | Versioned ingestion of Patient, Encounter, Observation from qualified existing HIS; strict tenant+facility+patient mapping; version-order, 404/410 absence, deletion/retraction and replay reconciliation | LOCAL/SANDBOX QUALIFIED ONLY |
| External longitudinal | Canonical, provenance-preserving external Patient 360 with encounter/observation timeline, explicit unknown vs absent categories, source completeness/revision checkpoints and clinician review workflow | EVIDENCE_ONLY |
| Clinical authorization | Security and qualified clinician review of patient linkage, consent and all imported facts, with signed purpose-/scope-bound evaluation and prohibition of silent auto-promotion | NO_GO |
| AI clinical use | External-specific `ClinicalContextReader` qualified against immutable event/history semantics, reference/generation trust, evaluation against clinician reviewed synthetic/retrospective cases, rollback and harm monitoring | NO_GO |
| Reliability | Polling outages, device disconnect, auth 401/403 pause, vendor 404/410 held, partial pages, credential rotation, stale worker lease, audit recovery, and separately retained encrypted DR evidence | LOCAL ONLY |
| Operations | Hospital environment and network preflight, observability/alerting, tenant IAM/security-rules deny checks, on-call runbook, pilot training, clinician escalation and rollback | NO_GO |
| Release governance | Independent security code review by `@AB2412`, separate qualified clinical signoff (Dr Ufaq Waqas), explicit hospital owner authorization and enforced GitHub approvals | PENDING |

## Required next build after this P0 interlock

Implement a **new explicit external evidence-to-clinician review workflow**, not a shortcut through native clinical snapshots. It should consume the existing transactionally verified `readExternalClinicalEvidence`, expose source and revision provenance, record independent clinician review as an append-only decision bound to immutable fact hashes, and invalidate approval when source version, consent, patient match, or site authority changes. Only after a separately validated clinical safety policy may reviewed facts be used in an external-specific drafting context. Preserve contradictory facts and missing source data as unknown/uncertain; do not silently infer absence or merge with native records.

**Do not activate `GHIMS_CI_CONTEXT_SOURCE=EXTERNAL` expecting AI drafting to work.** The explicit refusal is intentional pending a new authorized external adapter. It must not be disabled as a deployment workaround.

## Firestore schema and security notes

No Firestore schema/index or client permissions are added by this interlock. The separate imported evidence remains under tenant-scoped `fhirImportedVersions`, `fhirResourceHeads`, `fhirPatientLinks`, `externalPatient360Projections`, and `externalContextAccessAudits`. Existing browser rules must continue to deny writes to imported evidence, outboxes, leases, external projections, and audits. All source/provenance/consent rechecks belong in server-authoritative Firestore transactions. Admin SDK access bypasses client security rules and requires separate workload IAM scrutiny.

Offline clients must never create authoritative external clinical facts. On reconnect, obtain a new server-authorized evidence revision and revalidate consent/source generation; do not replay cached evidence as an approved longitudinal history. On lost connectivity, return explicit `EXTERNAL_CONTEXT_UNAVAILABLE` rather than falling back to a native patient chart.

**G1_HOSTED=NO_GO | G2_HOSTED=NO_GO | EXTERNAL_HIS_CLINICAL_GO=NO_GO | PRODUCTION_RELEASE=NO_GO.**
