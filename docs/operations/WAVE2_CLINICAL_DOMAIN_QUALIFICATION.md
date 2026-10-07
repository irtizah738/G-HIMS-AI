# G-HIMS Wave 2 — Clinical Domain Qualification

## Scope

Wave 2 completes the five previously frozen clinical domains:

1. Domain 05 — Inpatient Nursing Care Plans & eMAR
2. Domain 43 — Renal Care / Hemodialysis
3. Domain 45 — Labor, Delivery & Obstetric Partogram
4. Domain 46 — Oncology / Tumor Board
5. Domain 47 — Rehabilitation

Wave 2 is built on the post-Wave-1 Patient 360 v4 baseline and advances
Patient 360 to projection schema v5.

## Architecture boundary

Every Wave 2 mutation follows the same authority chain:

```text
Authenticated client intent
  -> strict versioned Command schema
  -> Command Bus
  -> tenant/patient/encounter + role/privilege validation
  -> domain transition validation
  -> TransactionManager
       - authoritative state
       - immutable domain event
       - audit record
       - transactional outbox
       - idempotency completion
  -> Patient 360 / clinical attention projections
```

Browser Firestore writes are prohibited. The Wave 2 patient workspace is hydrated
through `GET /api/clinical/wave2/workspace`, which re-derives tenant authority,
enforces a clinical role, validates Patient 360 patient access and performs
bounded server-side reads.

## Firestore authority collections

All paths are tenant-scoped under `tenants/{tenantId}`.

| Aggregate | Collection | Authority |
| --- | --- | --- |
| eMAR schedule | `emarScheduleSlots` | server only |
| medication administration | `medicationAdministrations` | server only |
| canonical administration | `canonicalMedicationAdministrations` | server only |
| nursing care plan | `nursingCarePlans` | server only |
| canonical care plan | `carePlans` | server only |
| dialysis order | `renalDialysisOrders` | server only |
| dialysis session | `renalDialysisSessions` | server only |
| obstetric episode | `obstetricEpisodes` | server only |
| partogram entry | `obstetricPartogramEntries` | server only |
| oncology case | `oncologyCases` | server only |
| tumor board recommendation | `oncologyTumorBoardRecommendations` | server only |
| oncology regimen | `oncologyRegimens` | server only |
| chemotherapy linkage | `oncologyChemotherapyLinks` | server only |
| toxicity assessment | `oncologyToxicityAssessments` | server only |
| rehabilitation plan | `rehabilitationPlans` | server only |
| rehabilitation session | `rehabilitationSessions` | server only |

The explicit Firestore rules for all new Wave 2 collections are
`allow read, write: if false`. Reads and writes are performed through trusted
server routes/services after authorization.

## Index strategy

The Wave 2 patient workspace deliberately queries each domain by one equality
field only:

```text
patientId == selected patient
limit 251
```

The server then enforces the selected encounter in memory. This avoids making
Wave 2 dependent on a large matrix of composite indexes during pilot rollout.
Firestore's automatic single-field index on `patientId` is therefore the
required index for the current read path.

The server fails closed if a domain returns more than 250 records for one
patient. Before national-scale deployments, high-volume domains should move to
encounter-scoped projections and explicit composite indexes such as:

```text
medicationAdministrations: patientId ASC, encounterId ASC, administeredAt DESC
emarScheduleSlots:          patientId ASC, encounterId ASC, scheduledFor ASC
obstetricPartogramEntries:  patientId ASC, encounterId ASC, observedAt DESC
rehabilitationSessions:     patientId ASC, encounterId ASC, occurredAt DESC
oncologyToxicityAssessments:patientId ASC, encounterId ASC, assessedAt DESC
```

Those indexes are not required by the current query implementation and must not
be added speculatively without the corresponding query migration.

## Domain safety contracts

### Nursing & eMAR

Medication administration is not a free-form nursing write.

```text
ACTIVE MedicationOrder
  -> clinician-authorized eMAR slot
  -> nurse bedside action
  -> server reloads MedicationOrder
  -> patient/order/version/time checks
  -> immutable outcome
  -> canonical medication administration
  -> exception work item when not GIVEN
```

Supported outcomes:

- GIVEN
- HELD
- REFUSED
- MISSED
- DELAYED

The old direct `RecordMedicationAdministrationCommand` path is retained only
as a compatibility rejection and returns `EMAR_SCHEDULED_COMMAND_REQUIRED`.

Five-rights system enforcement is based on:

- patient: authoritative patient + encounter scope;
- medication: authoritative medication order;
- dose: authoritative medication order;
- route: authoritative medication order;
- time: clinician-authorized eMAR slot tolerance.

Physical barcode scanning remains an optional device-integration enhancement;
the browser cannot claim a medication/dose/route different from the order.

Non-GIVEN outcomes require a reason and generate a clinical open item.

Offline administration uses the encrypted governed command outbox. It has
`optimisticCache: false`: local queueing does not mean the medication has been
authoritatively accepted. Replay re-runs all server order/version/time checks.

### Renal / Dialysis

```text
Dialysis order -> IN_PROGRESS session -> COMPLETED | ABORTED
```

The order controls modality, duration and access plan. Sessions preserve
machine, access-device, dialyzer/reprocessing traceability, observations,
ultrafiltration, complications and medication/diagnostic references. Session
completion atomically closes the source order.

### Obstetrics / Partogram

The obstetric episode is unique per encounter. Server-side transition rules
prevent arbitrary stage jumps.

```text
ADMISSION -> LABOR -> DELIVERY -> POSTPARTUM -> COMPLETED
     \          \-> THEATRE -> DELIVERY/POSTPARTUM
      \-> THEATRE
```

Partogram observations are immutable event records. Fetal heart rate and
maternal blood-pressure/heart-rate signals derive the escalation state on the
server. Delivery outcome can only be recorded from DELIVERY or THEATRE.

### Oncology / Tumor Board

```text
Evidence-linked case
  -> multidisciplinary tumor-board recommendation
  -> regimen approval against active MedicationOrders
  -> authoritative GIVEN administration linkage
  -> toxicity monitoring
```

Evidence references must resolve to this patient in one of:

- canonical clinical condition;
- diagnostic report;
- clinical document;
- clinical observation;
- FINAL disease-intake artifact.

An arbitrary client string cannot become oncology evidence.

Grade 3–5 toxicity cannot be recorded with an unconditional CONTINUE action.

### Rehabilitation

```text
Rehabilitation plan
  -> therapy sessions
  -> functional score history
  -> goal disposition
  -> accepted clinical handoff
  -> plan completion
```

Session goals must belong to the active plan. Completion fails while any goal is
still ACTIVE and requires an ACCEPTED clinical handoff for the same
patient/encounter.

## Patient 360 v5

Wave 2 adds:

- `recentMedicationAdministrations`;
- `recentSpecialtyActivities`;
- counts for medication administrations and specialty activities.

Wave 2 domain events are represented on the longitudinal timeline with source
event references. The projection remains derived state; specialty aggregates
and immutable events remain the sources of truth.

## Concurrency and idempotency

New aggregates use `expectedPrimaryServerVersion: 0` so a second command cannot
overwrite an already-created deterministic or UUID-keyed aggregate.

State transitions use the loaded `_serverVersion` as an optimistic
precondition. Secondary writes, including eMAR slots, dialysis orders,
obstetric episodes, oncology cases/regimens and canonical care plans, are
version-checked in the same Firestore transaction.

Idempotency is still handled by the central command executor and
`TransactionManager`; version checks protect against two distinct idempotency
keys racing on the same clinical state.

## Qualification gates

### Repository qualification — mandatory for merge

```bash
bun run validate:wave2
```

This includes:

- TypeScript
- lint
- Wave 2 domain regression contract
- Patient 360 CI-4
- medication safety CI-9
- consultant coordination CBE
- P8 baseline hardening
- P6 offline boundaries
- security regression
- production build

GitHub workflow:
`.github/workflows/wave2-clinical-domain-completion.yml`

### Deployed cross-role staging qualification

This is intentionally separate from source CI. It requires a disposable
synthetic staging fixture, not production data.

Required environment:

```text
GHIMS_STAGING_BASE_URL=https://...
GHIMS_P7_TENANT_ID=...
GHIMS_WAVE2_CONFIRM_TENANT=<exact same tenant>
GHIMS_P7_BOOTSTRAP_PASSWORD=...
GHIMS_P7_DOCTOR_EMAIL=...
GHIMS_P7_NURSE_EMAIL=...

GHIMS_WAVE2_PATIENT_ID=...
GHIMS_WAVE2_IPD_ENCOUNTER_ID=...
GHIMS_WAVE2_ACTIVE_MEDICATION_ORDER_ID=...
GHIMS_WAVE2_EVIDENCE_ID=...
GHIMS_WAVE2_ACCEPTED_HANDOFF_ID=...
```

The fixture must be synthetic and disposable. It must provide an active IPD
encounter, active medication order, valid oncology evidence source and accepted
handoff.

Run:

```bash
bun run test:e2e:wave2:staging
bun run ops:wave2:evidence
```

The browser qualification proves:

1. doctor schedules medication and creates nursing plan;
2. nurse administers the same authoritative slot and completes an intervention;
3. doctor orders dialysis and nurse executes the session;
4. doctor/nurse record the obstetric episode, partogram, transitions and delivery;
5. doctor completes the oncology evidence → tumor board → regimen →
   administration → toxicity chain;
6. rehabilitation plan/session/goal closes only through an accepted handoff.

The evidence generator refuses to issue a PASS manifest unless all six deployed
journeys pass against the confirmed tenant and current Git SHA.

## Exit criteria

Wave 2 can be called **CODE_QUALIFIED** only when PR CI is fully green.

Wave 2 can be called **STAGING_QUALIFIED** only after the remote HTTPS Playwright
journey passes and `artifacts/wave2-staging-evidence.json` is produced for the
same source SHA.

No document, registry badge or presentation should claim deployed qualification
from repository CI alone.
