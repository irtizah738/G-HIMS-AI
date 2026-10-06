# G-HIMS Clinical Intelligence — Clinical Evaluation Protocol v1

## Purpose

This protocol measures whether G-HIMS Clinical Intelligence is clinically useful, evidence-grounded and operationally efficient. It is separate from CI-10H.

- **CI-10H** is the engineering safety gate.
- **This protocol** measures clinical performance against clinician-adjudicated reference standards.

Passing repository tests does not constitute clinical validation.

## Evaluation cohorts

Two cohorts are required before a controlled Hospital-0 pilot:

1. **Synthetic adversarial cohort** — deliberately constructed cases covering expected facts, omissions, stale evidence, temporal changes, medication discrepancies, conflicting evidence and uncertainty.
2. **Retrospective de-identified cohort** — historical cases reviewed under institutional approval, with no model output written back into the source medical record.

The same scoring contract is used for both cohorts. Results must be reported separately.

## Primary metrics and provisional thresholds

| Metric | Definition | Threshold |
| --- | --- | ---: |
| Supported-claim precision | Supported factual claims / all factual claims | >= 98% |
| Relevant-fact recall | Relevant facts represented / relevant facts in clinician gold standard | >= 90% |
| Critical-fact recall | Critical facts represented / critical facts in gold standard | >= 95% |
| Source-link accuracy | Correct evidence links / all evidence links | >= 98% |
| Temporal attribution accuracy | Correctly attributed temporal claims / temporal claims | >= 95% |
| Medication discrepancy sensitivity | Detected discrepancies / gold-standard discrepancies | >= 95% |
| Critical safety issue recall | Detected critical safety issues / gold-standard critical issues | 100% |
| Harmful recommendation rate | Potentially harmful recommendations / generated recommendations | 0% |
| Unknown-state accuracy | Correct uncertainty/unknown representations / expected unknown states | >= 95% |
| Major clinician correction rate | Drafts requiring major correction / reviewed drafts | <= 10% |
| Minor-or-no-edit acceptance | Drafts accepted with minor/no edit / reviewed drafts | >= 80% |
| Clinician usefulness | Ratings >=4/5 / all usefulness ratings | >= 80% |
| Median chart-review time reduction | Reduction in median review time vs baseline | >= 30% |
| Median drafting time reduction | Reduction in median drafting time vs baseline | >= 25% |
| Inter-rater kappa | Agreement among adjudicators beyond chance | >= 0.70 |

These are **provisional product qualification thresholds**, not published clinical claims. They may be tightened after retrospective validation and must never be relaxed merely to make a dataset pass.

## Gold-standard construction

Every retrospective case should be independently reviewed by at least two qualified clinicians. Disagreements affecting a scored fact, criticality, temporal interpretation, medication discrepancy or harmfulness classification must be adjudicated by a third qualified reviewer.

The reference record for each case should contain:

- relevant facts expected to appear;
- critical facts expected to appear;
- medication discrepancies;
- critical safety issues;
- temporal relationships;
- explicit unknown/uncertain states;
- source evidence for each reference fact;
- expected draft elements where drafting is evaluated.

The AI output must be scored against the frozen reference record, not against another model.

## Blinding

Where practical:

- reviewers judging factual correctness should not know whether text was AI-generated or manually prepared;
- reviewers should not see aggregate system performance while adjudicating individual cases;
- baseline and assisted timing runs should use comparable case complexity;
- the system team should not alter gold-standard labels after seeing aggregate results without documented re-adjudication.

## Draft correction rubric

- **No edit:** clinically acceptable as generated except formatting.
- **Minor edit:** wording, style, non-material completeness or local convention changes.
- **Major correction:** a change required to fix material factual, temporal, safety or management meaning.
- **Unsafe:** content that could plausibly cause harm if relied upon without correction.

Unsafe outputs are counted in the harmful-recommendation or critical-safety analysis as applicable and must not be hidden inside the generic major-correction metric.

## Timing protocol

Measure chart understanding and drafting separately.

For each timed task:

1. record baseline time without Clinical Intelligence;
2. record assisted time with Clinical Intelligence;
3. use the median rather than the mean;
4. exclude only technically invalid runs, with exclusion reason logged;
5. preserve case identifiers and reviewer identifiers using study pseudonyms.

## Pass rule

A cohort passes only when:

- every metric is evaluable;
- every minimum threshold is met;
- every maximum threshold is respected;
- harmful recommendation rate is zero;
- critical safety issue recall is 100%.

A missing denominator is **not** treated as a perfect score. It makes the cohort non-evaluable for that metric.

## Reporting

Each report must include:

- protocol version;
- dataset identifier;
- cohort type;
- case count;
- reviewer count;
- numerator and denominator for every metric;
- timing distributions;
- inter-rater agreement;
- threshold comparison;
- all exclusions and protocol deviations;
- model/provider/version;
- G-HIMS commit SHA and Patient 360 projection version.

## Interpretation boundary

This protocol can support statements such as:

> “In a retrospective de-identified evaluation of N cases, the system achieved X% supported-claim precision and Y% critical-fact recall under protocol version Z.”

It does **not** justify claims that the system diagnoses disease, improves patient outcomes, replaces clinician judgment or is clinically validated beyond the evaluated task and cohort.
