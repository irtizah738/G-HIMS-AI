# G-HIMS Clinical Intelligence — Problem → Solution qualification

**Status:** Engineering evidence reconstruction candidate. **Not clinical validation,
a hospital integration, AI model qualification, or authorization for patient care.**

## Problem / solution being demonstrated

Problem: clinicians often have to reconstruct a longitudinal context from
encounters, conditions, prescriptions, laboratory records, reports and clinical
documents. Information may be incomplete and its provenance uncertain.

Solution hypothesis: G-HIMS Clinical Intelligence can present a coherent,
auditable view of **what is documented, what changed, and what remains
uncertain**, without transferring clinical decision-making authority to AI.
G-HIMS OS is event-driven infrastructure; the Clinical Intelligence product is
intended to integrate with hospital systems rather than require replacing them.

## What works in the current isolated demo

- Exact dedicated Firebase project: `g-hims-ci-demo`; synthetic patient
  `central-metro-hospital/demo-ci-patient-001`.
- Protected Vercel preview with Google Workload Identity Federation; signed
  and authorized DEMO physician login.
- Patient 360 projection (v6, revision 10) and three source-verified synthetic
  lab observations: creatinine 0.9 mg/dL and 1.5 mg/dL; potassium 5.6 mmol/L.
- The first tab lets a user **compare the same case** in five source
  categories versus a deterministic, timestamp-ordered context reconstruction.
  These are separate **canonical record categories within one synthetic
  G-HIMS dataset**, not proof of different EHR integrations.
- Explicit evidence IDs, project/tenant/patient scoping, unit/date verification
  and provenance; no fabricated citations.
- An uncertainty register distinguishes documented absence, missing or
  unverified information, and matters requiring a qualified clinician.
- An interactive clinician inspection checklist is local in the browser only.
  Checking a box does not create a signature, immutable event, clinical
  authorization, institutional approval, or study evidence.
- Native G-HIMS AI Patient 360 is a secondary read-only supporting view.
  No prescriptions, clinical actions, generated assessment or signatures.

## Reproducible technical qualification

From the demo branch, run locally or in a restored CI runner:

```bash
bun test tests/investor-demo-isolation.test.ts
bun test tests/demo-clinical-context.test.ts
```

The deterministic test suite checks record grouping and chronology, a
source-linked arithmetic delta, explicit medication-administration unknowns,
missing fact semantics, denial of cross-tenant/stale projections, altered
source IDs, preliminary laboratory results, invalid numeric values and
non-ordered timestamps. These tests are **engineering tests only**.

The Vercel build validates TypeScript and page compilation. It does not
substitute for the two Bun test commands or protected browser E2E evaluation.

## Human review protocol (authorization required; no invented findings)

1. Qualified hospital reviewers approve the study protocol and the set of
   fabricated or properly authorized cases. Obtain institutional approval
   before access to real patient records or clinician data collection.
2. For each case, review raw source categories in random order **without**
   the reconstruction. Record required items, omissions, uncertain facts and
   actual start/end times.
3. Review the reconstructed context for the same case. Verify every included
   fact back to source ID/date and identify unsupported claims, omissions,
   incorrect temporal sequences, and possible false reassurance.
4. Evaluate whether the system clearly distinguishes *not documented*,
   *unknown*, and *known none* from affirmative clinical negatives.
5. Review any clinically actionable change independently. The creatinine
   measurements have **no approved deterioration threshold or escalation
   wording** in this investor demo. Clinicians must approve any such logic
   before it can be shown as a clinical warning.
6. Use blinded independent review followed by documented adjudication.
   Capture factual agreement, missed important changes, false alerts,
   provenance correctness, time to retrieve required information and
   reviewer agreement. Report denominators, confidence intervals and
   disagreements. **Do not invent metrics.**
7. Confirm role-authorization, tenant isolation, revocation, Vercel preview
   protection, absence of clinical writes, and failure on altered evidence.
8. Record distinct clinical and institutional sign-offs before claiming
   suitability for a pilot or patient-care setting.

## Outstanding dependencies / release blockers

- No independent clinical approval for thresholds, warning content, escalation,
  accuracy, effectiveness or safety.
- No demonstrated external EHR/FHIR/HL7 integration in this isolated demo;
  test against an authorized hospital system separately.
- No approved or measured time savings; no clinical outcome improvement data.
- Clinical AI generation, draft editing, explicit clinician approval/signing
  and the authoritative audit lifecycle are **not enabled** in this preview.
- GitHub Actions are failing; do not merge PR #218 or promote to production
  until the required release checks are green and code reviewed.
- No shareable investor URL until protected browser tests and truthful
  presentation of unqualified modules are complete.

## Investor demo story (no overstated claims)

1. **The problem:** the same patient information lives in several clinical
   record categories that must be assembled for care.
2. **What changes:** show the five source categories, then reconstruct the
   dated chart without copying or inventing facts.
3. **Why trust it:** drill into specific source identifiers, timestamps,
   LOINC codes and the published source checkpoint.
4. **What remains missing:** inspect explicit unknowns and medication
   administration gaps; do not infer clinical significance from a number.
5. **How authority is preserved:** demonstrate that no AI conclusion,
   escalation or signing occurs without separately qualified governance.
6. **Why adoption can be lighter:** describe the intended standalone
   integration architecture as the roadmap, not as a verified integration.
