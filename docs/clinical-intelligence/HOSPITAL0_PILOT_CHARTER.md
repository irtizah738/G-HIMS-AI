# G-HIMS Clinical Intelligence — Hospital-0 Controlled Pilot Charter

## Objective

Hospital-0 exists to produce relevant-environment evidence for the **G-HIMS Clinical Intelligence** fundraising wedge.

The pilot is not a generic HIS rollout. The primary question is:

> Can G-HIMS Clinical Intelligence help qualified clinicians understand longitudinal patient context faster and produce safer, traceable, governed clinical drafts without transferring clinical authority to the AI layer?

## Pilot scope

Initial controlled scope:

- General Medicine OPD;
- Patient 360 longitudinal review;
- Encounter Preparation;
- Longitudinal Summary;
- Trend Intelligence;
- Medication Reconciliation Copilot;
- Governed Clinical Drafting;
- clinician review, edit, approval and signature;
- audit/provenance review.

The following remain outside the first Hospital-0 Clinical Intelligence evidence claim unless separately approved:

- autonomous diagnosis;
- autonomous prescribing;
- autonomous treatment;
- external claims/EDI;
- unqualified PACS/HL7/device integrations;
- unsupervised AI write-back.

## Entry gates

Hospital-0 Clinical Intelligence activity begins only after:

1. the deployed commit SHA is frozen;
2. OPD deployed cross-role qualification is green;
3. CI-10F–CI-10I repository qualification is green;
4. target-environment CI readiness is green;
5. synthetic live-provider smoke is green;
6. synthetic preclinical validation report is archived;
7. retrospective validation has either completed or is explicitly documented as a parallel pre-pilot evidence activity approved by the site;
8. institutional pilot approval is documented;
9. participating clinicians complete training;
10. incident escalation and rollback criteria are approved.

## Users

Only approved users may participate. Every participant must have:

- named role;
- tenant membership;
- facility/department scope;
- appropriate clinical credential status;
- explicit privilege where required;
- training acknowledgement.

## Clinical authority

G-HIMS Clinical Intelligence is advisory.

AI-generated content remains non-authoritative until the qualified clinician:

1. reviews the evidence;
2. edits the draft;
3. explicitly approves the exact revision;
4. signs through the governed clinical authority path.

No pilot metric may incentivize clinicians to accept AI output without review.

## Evidence collection

For every included encounter, collect a pseudonymous pilot record containing:

- pilot case ID;
- encounter ID or approved pseudonymous mapping;
- clinician participant ID;
- Patient 360 revision/checkpoint;
- CI artifact types used;
- generation timestamps;
- safety-gate status;
- clinician edit category;
- time-to-chart-understanding;
- draft editing time where applicable;
- usefulness rating;
- incident/safety flag;
- provenance issue flag;
- technical failure flag.

Do not copy unnecessary PHI into the pilot evidence package.

## Primary pilot endpoints

The Hospital-0 evidence package should report:

- supported-claim precision;
- relevant-fact recall;
- critical-fact recall;
- source-link accuracy;
- temporal attribution accuracy;
- medication discrepancy sensitivity where applicable;
- critical safety issue recall;
- harmful recommendation rate;
- major correction rate;
- minor/no-edit acceptance;
- clinician usefulness;
- median chart-review time reduction;
- median draft-time reduction;
- operational success rate;
- generation latency distribution;
- incident count and severity.

## Stop criteria

Immediately suspend Clinical Intelligence use for investigation if any of the following occurs:

- cross-patient evidence contamination;
- harmful autonomous clinical action;
- unsigned AI content becomes authoritative;
- evidence provenance points to the wrong patient/encounter;
- critical safety issue is suppressed by the system;
- repeated scope/tenant isolation failure;
- repeated stale-evidence acceptance;
- material integrity/tampering failure;
- site requests suspension.

## Exit criteria

The Hospital-0 Clinical Intelligence pilot is complete only when:

- planned pilot cases are complete;
- all mandatory incidents are resolved or dispositioned;
- quantitative results are calculated;
- clinician feedback is summarized;
- collaborator/site attestation is signed;
- deployment/version metadata is frozen in the evidence package;
- the evidence manifest has no unresolved mandatory Hospital-0 item.

Hospital-0 completion does not by itself justify claims beyond the evaluated scope.
