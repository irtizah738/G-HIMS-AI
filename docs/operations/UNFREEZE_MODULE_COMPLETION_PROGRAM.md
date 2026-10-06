# G-HIMS Module Completion Program

## Purpose

This program removes artificial "frozen" product states without weakening RBAC, tenant isolation, clinical privilege, billing, consent, patient-safety or authoritative-command gates.

**Unfreeze means:** a module is visible, navigable and buildable under its normal role permissions.

**Unfreeze does not mean:** relabeling unfinished workflows as production, bypassing backend authority, enabling fake demo actions, or allowing client-side clinical/financial mutations.

The old hard-coded "G-HIMS OS Master Module Readiness & Production Audit Matrix" is retired from the product UI because its percentages, owners and readiness labels were static metadata rather than live evidence.

## Program sequence

### UMP-0 — Product truth and navigation closure

- remove stale readiness/audit matrix from user-facing navigation;
- keep the canonical 52-domain directory as the launch surface;
- remove fabricated "production-ready" claims that are not generated from CI/runtime evidence;
- ensure every domain resolves to a real route or an explicitly named parent workflow;
- keep RBAC/ABAC/credential gates intact.

**Exit:** no module is hidden by an artificial readiness tier; no internal audit artifact is presented as a hospital feature.

### UMP-1 — Patient identity and MPI closure

- institutional MRN is generated once by the server;
- MRN becomes a first-class immutable Patient identifier;
- CNIC and MRN are indexed atomically in MPI;
- registration rejects client-supplied institutional MRN;
- MPI lookup uses MRN and/or CNIC only;
- patient merge preserves the primary MRN and redirects the merged identity;
- duplicate prevention is exact on MRN/CNIC before probabilistic demographic matching.

**Exit:** one patient, one authoritative MRN, deterministic lookup by MRN/CNIC.

### UMP-2 — OPD specialist-routing workflow

- HCM credential/privilege directory is authoritative;
- no consultant is silently preselected in production;
- no fabricated SBAR/handoff content;
- no diagnostic orders are auto-dispatched from routing UI;
- urgency SLA labels match persisted/requested priority;
- empty-directory states explain credential/roster blockers;
- routing creates one governed Consultation request and returns a traceable confirmation.

**Exit:** Patient 360 / OPD / specialty intake can route a consultation without bypassing clinical authority.

### UMP-3 — Disease-centric intake workflow

- require explicit patient selection in production;
- remove synthetic vitals/history/risk defaults outside DEMO runtime;
- guided questionnaire starts from unknown/unanswered patient state;
- AI output remains advisory and is clearly labelled as not ordered/not authoritative;
- finalization is an explicit clinician action;
- specialist routing is a separate governed action after intake review;
- configuration/localization moves toward role-scoped administration rather than the primary clinician path.

**Exit:** Select patient → choose protocol → complete intake → review intelligence → finalize intake → route specialist.

### UMP-4 — Clinical modules still sharing parent shells

Build dedicated authoritative workflows for the currently registered domains that still depend on generic parent screens:

1. Inpatient Nursing Care Plans & eMAR;
2. Renal Care / Hemodialysis;
3. Labor, Delivery & Obstetric Partogram;
4. Oncology Tumor Board & Chemotherapy;
5. Physical / Occupational Rehabilitation.

For each domain:

- canonical entities and events;
- command schemas;
- server-side invariants;
- projections/read models;
- role/credential matrix;
- offline policy;
- UI workflow;
- audit/outbox;
- failure injection;
- staging E2E.

**Exit:** no specialty domain is only a label that forwards to a generic OPD/IPD screen.

### UMP-5 — Controlled-beta clinical closure

Finish the remaining deeper clinical runtime surfaces:

- IPD admissions/transfers/discharge;
- Emergency/trauma;
- OR/PACU;
- Telehealth;
- Clinical Intelligence copilot surfaces.

Required gates:

- no duplicate authority path;
- authoritative backend commands;
- cross-role E2E;
- stale/offline behavior defined;
- rollback/failure containment;
- clinician-visible provenance where AI is involved.

### UMP-6 — Diagnostics and interoperability

- LIS/RIS/PACS authority and worklists;
- HL7/FHIR inbound/outbound reliability;
- PACS/DICOM network qualification;
- diagnostic payment/pre-authorization gates where required;
- external integration retry/DLQ and reconciliation evidence.

### UMP-7 — Revenue, ERP and operations closure

- Billing/revenue integrity;
- Finance/GL;
- SCM/inventory/procurement;
- HCM/credentialing/rosters;
- facilities/capacity;
- claims/EDI when the external integration is available.

Every visible action must map to a governed backend workflow; no browser-only CRUD authority.

### UMP-8 — Production qualification

For every module/domain:

1. TypeScript/lint/build green;
2. domain tests green;
3. security/tenant negative tests green;
4. deployed staging workflow green;
5. offline/recovery policy proven;
6. performance/concurrency qualification;
7. evidence artifact retained;
8. production/pilot status derived from evidence, not manually typed percentages.

## Priority order

1. Patient identity / MPI.
2. Specialist routing.
3. Disease-centric intake.
4. Nursing/eMAR.
5. IPD + discharge.
6. Emergency.
7. OR/PACU.
8. Diagnostics/interoperability.
9. Specialty domains (renal, maternity, oncology, rehab).
10. Telehealth.
11. Revenue/ERP/operations residual gaps.
12. Full staging qualification.

## Non-negotiable rule

A module may be **unfrozen for development and access** while still being **not production-qualified**.

G-HIMS must never make a hospital feature appear complete merely because its screen is visible.
