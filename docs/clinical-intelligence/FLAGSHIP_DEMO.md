# G-HIMS Clinical Intelligence Flagship Demo

This is the fixed fundraising and clinician demo scenario for the Clinical Intelligence wedge.

## Thesis

G-HIMS Clinical Intelligence turns longitudinal hospital data into evidence-grounded clinician intelligence while preserving provenance, uncertainty and clinician authority.

The underlying G-HIMS OS is infrastructure and moat. The demo should not present the product as a generic hospital ERP with an AI layer.

## Synthetic patient

- **Patient:** Amina Shah (Synthetic)
- **MRN:** CI-DEMO-001
- **Setting:** General Medicine OPD
- **Longitudinal context:** confirmed hypertension and type 2 diabetes
- **Medication context:** lisinopril and metformin
- **Safety context:** confirmed penicillin allergy
- **Longitudinal signal:** creatinine changes from 0.9 mg/dL to 1.5 mg/dL
- **Concurrent result:** potassium 5.6 mmol/L
- **Current vital context:** blood pressure 148/92
- **Supporting longitudinal domains:** diagnostic order/report, prior note, procedure and active care plan

All records are synthetic. The demo must never be described as clinical validation or real-patient evidence.

## Provision

Use the guarded setup at [INVESTOR_DEMO_SETUP.md](INVESTOR_DEMO_SETUP.md).
The real G-HIMS AI Clinical Intelligence Copilot lives inside Patient 360; the
DEMO-only entry page is `/<tenantId>/clinical-intelligence`.

Both seeding scripts require an explicitly isolated DEMO Firebase project, matching
server/browser project IDs, and exact tenant confirmation. On localhost, use the
Auth and Firestore emulators. Do not connect this demo to the production G-HIMS AI
Firebase project or the G-HIMS OS staging project. Hosted Firebase writes are
blocked without an additional explicit synthetic-DEMO-only acknowledgment.

For the pre-seeded patient ID `demo-ci-patient-001`, the Patient 360 deep link is
`/<tenantId>/patients/demo-ci-patient-001/360`. If the chart isn't populated,
run the verified synthetic seeding workflow rather than editing actual patient data.

## Seven-minute demo

1. Open Patient 360 for `CI-DEMO-001`.
2. Show the longitudinal chart: conditions, medication history, allergy, orders, results, procedure and care plan.
3. Open **Encounter Preparation**. Emphasize that the output is generated from a frozen authoritative evidence snapshot, not a chat window.
4. Open the evidence panel and click through provenance.
5. Open **Trend Intelligence** and show the creatinine trajectory plus the new laboratory context.
6. Open **Medication Reconciliation** and show the current medication context against the same Patient 360 revision.
7. Generate a **Governed SOAP draft**.
8. Demonstrate that the draft cannot become authoritative automatically: clinician edit → approval attestation → qualified signature.
9. Return to Patient 360 and show that the signed result is now part of the longitudinal authoritative record.

## What to say

**Opening:** “A clinician should not have to reconstruct a patient from tabs, PDFs and memory. G-HIMS builds the longitudinal truth first, then lets intelligence operate only on traceable evidence.”

**During provenance:** “Every claim can be traced back to the frozen chart state that produced it. If the chart changes, the intelligence becomes stale rather than silently pretending to remain current.”

**During drafting:** “AI never signs the chart. It produces a governed draft. A qualified clinician must edit, approve and sign the exact revision.”

**Close:** “The intelligence is useful because the Hospital OS captures the clinical events underneath it. That data architecture is the moat.”

## Demo success criteria

The demo is successful only if all of the following are visible:

- Patient 360 contains the complete synthetic longitudinal story.
- Encounter Preparation generates from authoritative evidence.
- Evidence provenance is inspectable.
- Trend Intelligence identifies the represented laboratory trajectory without unsupported claims.
- Medication Reconciliation uses current chart state.
- A governed draft is explicitly non-authoritative before clinician action.
- Stale/current state is visible.
- The clinician edit/approval/signature chain is enforced.
- No screen implies autonomous diagnosis, prescription or treatment.
- The demo can be reset deterministically by rerunning the provisioning script.
