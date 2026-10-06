# G-HIMS Full Module Completion Program

## Decision

The development freeze is lifted across the product roadmap.

This does **not** remove clinical safety, RBAC, credential, tenant, consent, billing, calibration, or other fail-closed authority gates. Those are runtime controls, not development freezes.

The previous `G-HIMS OS Master Module Readiness & Production Audit Matrix` was a static engineering visualization. It used hard-coded completion percentages, owners, evidence text and readiness tiers. It is therefore not authoritative release evidence and has been removed from the operational sidebar. Future readiness must come from executable CI, deployed-environment qualification and retained evidence.

## Source-of-truth rule

A module is not “production ready” because a UI card says so.

A domain becomes qualified only when all applicable gates are green:

1. authoritative backend commands and read models;
2. multi-tenant/RBAC/credential enforcement;
3. offline/failure behavior;
4. domain regression tests;
5. production build;
6. staging workflow qualification;
7. integration evidence where relevant;
8. rollback/recovery evidence;
9. clinical or operational sign-off where relevant.

## Current completion waves

### Wave 0 — Identity and navigation truth

- Institutional MRN is issued once at patient creation.
- MRN becomes the immutable institution-facing patient identifier.
- CNIC and MRN receive exact MPI registry keys.
- Internal opaque `patientId` remains the immutable technical aggregate identifier.
- Exact MRN/CNIC lookup is available without patient name.
- Remove static readiness claims from the operational application.
- Preserve RBAC/credential gates.

**Exit:** identity lookup and registration regressions green; no operator-facing hard-coded readiness claims.

### Wave 1 — Clinical coordination surfaces

#### Specialist Routing Engine

- HCM credentialed consultant directory only.
- Explicit consultant selection.
- Correct SLA semantics: STAT 10m, Urgent 30m, Priority 60m.
- Explicit active encounter requirement.
- No fabricated STEMI/SBAR defaults.
- No UI claim that diagnostics were ordered unless an authoritative order command ran.
- Clear empty state when no eligible consultant exists.
- Consultation request persists through `RequestConsultationCommand`.
- Add consultation acknowledgement/acceptance SLA visualization.
- Add source-linked Patient 360 handoff context.

#### Disease-Centric Intake

- No implicit patient.
- No fabricated symptoms, vitals, history or risk state.
- Risk score derives from governed template weights and entered data.
- AI remains source-limited; no autonomous diagnosis, order or treatment UI.
- Save reviewed intake and specialist routing are separate explicit actions.
- Configuration/localization moves to governed admin settings rather than the live clinician workflow.
- Link saved intake evidence to Patient 360 and consultant handoff.

**Exit:** cross-role staging flow from patient selection → intake → reviewed save → routing → consultant acceptance.

### Wave 2 — Domains currently marked ACTIVE in the 52-domain registry

1. **Domain 05 — Inpatient Nursing Care Plans & eMAR**
   - authoritative eMAR administrations;
   - five-rights checks;
   - medication administration reconciliation;
   - bedside nursing care-plan state;
   - missed-dose/escalation workflow;
   - offline nursing workflow qualification.

2. **Domain 43 — Renal Care / Hemodialysis**
   - dialysis order authority;
   - session lifecycle;
   - access/device tracking;
   - pre/post observations;
   - dialyzer/reprocessing traceability where enabled;
   - medication/lab linkage.

3. **Domain 45 — Labor, Delivery & Obstetric Partogram**
   - obstetric encounter authority;
   - partogram timeline;
   - maternal/fetal observations;
   - escalation and theatre transition;
   - delivery/postpartum linkage.

4. **Domain 46 — Oncology / Tumor Board**
   - problem/staging evidence;
   - multidisciplinary recommendation workflow;
   - regimen approval;
   - chemotherapy administration linkage;
   - toxicity/monitoring events.

5. **Domain 47 — Rehabilitation**
   - therapy plan authority;
   - functional score history;
   - scheduled/complete therapy sessions;
   - goal tracking;
   - discharge handoff.

**Exit:** each domain has backend authority, production UI, tests, staging qualification and evidence.

### Wave 3 — Integration gaps previously shown as CONTROLLED_BETA

- **IPD:** discharge-summary linkage and complete OPD/IPD transition evidence.
- **Emergency:** ambulance/pre-arrival telemetry adapter qualification.
- **OR/PACU:** governed postoperative PACU transition automation.
- **Telehealth:** low-bandwidth fallback, session recovery and remote signing qualification.
- **Clinical Intelligence:** continue specialty evaluation and Hospital-0 evidence; do not reintroduce generic autonomous “AI coding/diagnosis” behavior.

### Wave 4 — External interoperability

- HL7 v2 live MLLP qualification.
- FHIR R4 read/write conformance for approved resources.
- DICOMweb/PACS live environment qualification.
- device/biomedical adapters;
- external EDI 837/835 only when that program is intentionally started.

### Wave 5 — Enterprise hardening

- full deployed cross-role E2E;
- load/concurrency;
- backup/restore and rollback drills;
- projection rebuild failure injection;
- security/penetration qualification;
- observability and alerting;
- data retention/governance;
- environment-specific runbooks.

## Readiness status model going forward

Use only:

- **BUILDING** — implementation incomplete.
- **ENGINEERING_QUALIFIED** — code/tests/build green.
- **STAGING_QUALIFIED** — deployed workflow evidence green.
- **PILOT_QUALIFIED** — controlled pilot prerequisites green.
- **PRODUCTION_QUALIFIED** — all required operational/security/integration gates satisfied.

Percent-complete numbers should not be used unless calculated from explicit checklist items.

## Rule for “unfreezing”

Engineering may proceed on every domain.

Do **not** disable or bypass:

- RBAC;
- verified clinical privileges;
- consent authority;
- tenant isolation;
- medication/prescribing authority;
- diagnostic payment gates where business rules require them;
- biomedical calibration locks;
- clinical evidence provenance;
- clinician review/signature requirements;
- audit/event/outbox integrity.

Those controls are part of the product, not unfinished-module freezes.
