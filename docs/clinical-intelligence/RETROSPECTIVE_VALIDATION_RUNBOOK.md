# G-HIMS Clinical Intelligence — Retrospective Validation Runbook

## Scope

This runbook governs retrospective evaluation of G-HIMS Clinical Intelligence on de-identified historical encounters before a controlled live Hospital-0 deployment.

It does not authorize use of identifiable patient data, prospective clinical decision-making, autonomous treatment, or write-back into a source medical record.

## Entry criteria

Retrospective validation may begin only when:

- the exact G-HIMS commit SHA is frozen;
- Patient 360 projection version is recorded;
- the AI provider/model and prompt/safety policy versions are frozen;
- the Clinical Evaluation Protocol version is recorded;
- institutional permission for retrospective use is documented;
- the dataset is de-identified or otherwise handled under the institution's approved governance process;
- reviewers are named and qualified;
- a case-selection method is documented before outcomes are reviewed.

## Minimum cohort

Recommended first cohort: **100–300 encounters**.

The cohort should include a deliberate mix of:

- straightforward longitudinal follow-up;
- multiple chronic conditions;
- abnormal laboratory trends;
- medication changes;
- medication discrepancies;
- allergy/safety context;
- multiple encounters;
- incomplete/unknown data;
- conflicting or amended facts;
- diagnostic order/result sequences;
- cases where no important abnormality exists.

Do not enrich only for cases where the product is expected to look good.

## Case package

Each case package must contain only the evidence needed for evaluation:

- pseudonymous case ID;
- encounter/care setting;
- frozen longitudinal source record;
- Patient 360 revision/checkpoint used by G-HIMS;
- model output;
- evidence links emitted by G-HIMS;
- blinded clinician reference standard;
- adjudication record;
- timing observations where applicable.

The evaluation package must not include direct identifiers unless explicitly permitted by the institution.

## Gold standard

At least two qualified clinicians independently annotate:

- relevant clinical facts;
- critical clinical facts;
- medication discrepancies;
- safety-critical issues;
- temporal relationships;
- explicit uncertainty/unknown states;
- expected draft elements for drafting tasks.

Disagreements affecting any scored metric are adjudicated by a third qualified clinician.

## Blinding

Where practical:

- fact-correctness reviewers should not know whether text was model-generated or manually prepared;
- adjudicators should not see aggregate G-HIMS performance during individual review;
- baseline and assisted timing sessions should use comparable case complexity;
- case inclusion/exclusion must not be changed after aggregate results are visible without a documented protocol deviation.

## Required outputs

For every cohort, produce:

1. dataset manifest;
2. frozen environment/version manifest;
3. per-case adjudication records;
4. numerator/denominator for every metric;
5. timing distributions;
6. inter-rater agreement;
7. exclusions and protocol deviations;
8. aggregate evaluation JSON produced by `bun run ops:ci:evaluate`;
9. signed reviewer/adjudicator summary.

## Stop rules

Stop the evaluation and investigate before proceeding if any of the following occurs:

- cross-patient evidence contamination;
- a harmful recommendation;
- failure to surface a critical safety issue;
- provenance links that point to the wrong patient or encounter;
- evidence tampering/integrity failure;
- systematic temporal misattribution;
- a model/provider/version change during the cohort without protocol restart.

## Claims boundary

Retrospective results may support only task-specific statements tied to the evaluated cohort and protocol.

They do not establish:

- diagnosis performance;
- improved clinical outcomes;
- autonomous treatment capability;
- general safety across all hospitals;
- TRL-6 by themselves.

Hospital-0 evidence remains a separate requirement.
