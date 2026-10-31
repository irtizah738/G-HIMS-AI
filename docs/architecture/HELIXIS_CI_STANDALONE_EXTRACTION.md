# Helixis Clinical Intelligence — Standalone extraction program

Status: **Phase 1 (clinical context boundary) — source PR, not an independent deployment.**

## Commercial rule

A hospital must be able to purchase **Helixis Clinical Intelligence** without
purchasing or deploying the native Helixis Health Platform, HCM, SCM or Finance.
Keep those products optional and keep clinical authority with qualified users.

## Architecture: migration-in-place

```text
Third-party HIS/EHR  ── future authorized FHIR/HL7 adapter ─┐
                                                           ├─ versioned clinical context
Helixis Health Platform ── native Patient 360 adapter ────┘       │
                                                                  v
                                                    Clinical Evidence Service
                                                                  │
                                                   CI Draft/Safety/Review Engine
                                                                  │
                                                    Immutable Draft and Audit
```

### Phase 1 implemented scope

- `lib/clinical/intelligence/clinical-context-port.ts` defines a typed clinical
  context reader. The contract preserves tenant/patient scope, revision,
  content hash, source checkpoint and event provenance.
- `native-clinical-context-adapter.ts` is the sole native Patient 360 dependency
  for **the two migrated CI services**, namely evidence snapshots and governed
  draft generation. Both use the port; existing native workflows retain the
  current self-healing projection behavior.
- Clinical Evidence Service still verifies event membership at the projection
  cursor, freezes immutable evidence snapshots and checks for source
  publication races before writing.
- CI Draft Service still runs independent safety evaluation against the latest
  authorized clinical context before writing an unsigned draft.
- The trusted server may inject a ClinicalContextReader for a separately
  qualified integration, but no external connector is wired into production.
- `GHIMS_CI_CONTEXT_SOURCE=NATIVE` (or unset) uses the existing native adapter.
  `GHIMS_CI_CONTEXT_SOURCE=EXTERNAL` **fails closed** until a qualified
  external adapter is connected. Unknown values are rejected.

### Explicitly NOT implemented yet

- Third-party EHR authorization, consent, patient-linking and tenant-specific
  FHIR/OAuth credentials; sandbox FHIR adapters do not establish these.
- Inbound FHIR R4/HL7 normalization to canonical immutable clinical events and
  first-party Patient 360 projection, including uncertain/missing data.
- Independent CI data tenancy, external provenance, replay and out-of-order
  backfill, source record deletions/corrections, and downtime reconciliation.
- Removal of remaining native HIS dependencies from other CI-10 services,
  sign/review transactions, source-specific supplement loaders, auth and UI.
- CI-specific deployment, product entitlements, connector provisioning,
  billing, external login/SSO and isolated disaster-recovery/backup.
- No standalone deployable app is claimed at this stage.

## Adapter correctness requirements for Phase 2

A future external connector must meet all of the following before enabling
`EXTERNAL` mode:

1. Trusted server-side credentials, facility and tenant mapping, scoped patient
   matching, patient-merge handling, and revocable access. Never allow browser
   source selection or client-provided tenant overrides.
2. Per-source event ID and provenance, source system/version, effective and
   recorded time, deterministic idempotency keys, and monotonic projections.
3. Import source updates/corrections as *new* events. Never overwrite
   immutable clinical source facts silently.
4. Strict normalized coding and units (including renal/creatinine) and
   three-valued unknown state. No data is not the same as negative data.
5. Race fencing: read evidence and latest context from the same versioned
   source checkpoint; do not silently serve stale charts.
6. Explicit import boundary that separates untrusted third-party records from
   signed authoritative Helixis clinical decisions and prevents source
   instructions being interpreted as prompts.
7. Contract and emulator tests covering cross-tenant data, duplicate events,
   out-of-order events, source deletion, consent withdrawal, partial network
   failures, offline replay, merge/split identities and audit restoration.
8. Dedicated clinical review: external records are evidence, not proof of
   medical correctness.

## Deployment roadmap

- **Phase 1:** clinical context port (this PR), native adapter and regression.
- **Phase 2:** external EHR ingest adapter, source events and MPI identity map,
  replay/idempotency and a synthetic external-HIS test fixture.
- **Phase 3:** migrate all CI clinical services and signing workflow off
  hard-coded HIS reads, preserving immutable tenant-scoped authority.
- **Phase 4:** isolated CI application shell, deployment configuration,
  per-product subscriptions and server-authoritative feature entitlements.
- **Phase 5:** end-to-end integration and security qualification at a real
  hospital after governance approval, then controlled paid pilot.

This program is separate from pending **real-model clinical evaluation** and
institutional medical review. A modular CI architecture does not substitute
for clinical safety or pilot qualification.

## Firestore migration policy

No new Firestore collection, index or security rule is required **for Phase 1**:
the native adapter continues to read the existing server-owned Patient 360
projection and evidence collection. Do not create hypothetical external
connector collections or permissive rules until the Phase 2 event contract
and least-privilege authorization design are formally reviewed.
