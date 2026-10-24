# CI-10D — Provisional Creatinine Rise Screening (review-only)

## Scope and release status

**Engineering prototype only. NOT APPROVED for clinical deployment, patient triage, treatment, diagnosis, AKI staging, or escalation automation.** This addition strengthens deterministic Clinical Trend Intelligence alerts without handing clinical authority to Gemini. It is a candidate algorithm for *qualified institutional clinical review*, not a clinical rule that should go live solely on a passing CI run.

Evidence is derived from coded `LOINC:2160-0` serum/plasma creatinine values with identical explicit `UCUM:mg/dL` quantity units, only eligible final, amended or corrected observations, and identical tenant/patient context from the established CI-10D frozen snapshot. No free-text matching, blind unit conversion or inferred baseline.

## Proposed numerical screening criteria (subject to clinician approval)

KDIGO 2012 / NICE NG148 identify potential AKI by:
- Serum creatinine increase **at least 1.5×** known/presumed baseline within the preceding **7 days**; or
- Serum creatinine increase of **at least 0.3 mg/dL within 48 hours**; or
- Separately, low urine output thresholds (not evaluated by this code).

The new screen identifies **candidate numerical changes**, NOT AKI diagnosis or stage. An earlier value is **not verified to be an actual baseline**, and the routine cannot infer renal history, clinical stability, fluid status, urine output, assay quality, dialysis, age-specific nuances or causes. Clinician reviewers must determine clinical interpretation and urgency.

- 0.9 mg/dL to 2.1 mg/dL over five days => 2.33× => candidate signal, corroborating the Step-112 synthetic renal finding.
- Comparators older than seven days, a latest reading stale by more than seven days, incompatible/missing UCUM units, unrecognized LOINC metric, conflicting same-time observations, and nonfinal readings do not yield a signal.
- A **missing signal never establishes that AKI is absent**. Stage or care-management decisions are intentionally not inferred.
- Only current coded observations support this numerical screen. The previously generated Step-112 `trend-cr-1` through `trend-cr-3` examples were text-only `DIAGNOSTIC_REPORT` facts; no claim is made that these free-text inputs have become structured authoritative Clinical Trend Intelligence.

## Implementation architecture

- `lib/clinical/intelligence/creatinine-rise-review-screen.ts` screens the **already computed** `ClinicalTrendMetric`, preserving evidence IDs and refusing inconsistent readings.
- `ClinicalTrendIntelligenceService.build` records provisional `reviewSignals`, elevates their warnings (while preserving the CI-10D no-autonomy safety object) and versions the immutable artifact to `ci10d-clinical-trend-v2` and `schemaVersion: 2`, avoiding mutation of historical `v1` artifact hashes/IDs.
- `ClinicalCopilotWorkspace` displays provisional signals directly rather than burying them in collapsed general-warning lists. For stale chart artifacts, it tells the reviewer to check the current chart.
- Existing server authorization, immutable evidence, audit/outbox, source access controls, CI-10H and clinical signing policy remain unchanged.

## Clinician policy decisions — required before clinical release

A licensed clinician, nephrology or renal-safety subject-matter expert, and the pilot hospital safety/governance authority must review and record:

1. Target population, clinical context exclusions, confirmation/quality of baseline, unit conventions, and age/renal-replacement considerations.
2. Warning wording and what `CLINICAL_REVIEW_REQUIRED_POLICY_UNAPPROVED` should mean operationally; timing / escalation urgency cannot be assigned by the software before policy approval.
3. Alert fatigue and missed cases, false positives, temporal windows, assay variation, duplicated/corrected results, critical-but-uncoded values, and out-of-order/replayed events.
4. Cross-role acknowledgment, clinician intervention, chart freshness, event provenance, and no automated diagnosis/treatment.
5. A *blinded* synthetic and then approved deidentified retrospective validation cohort with adjudicated source correctness, true- and false-positive rates, sensitivity and specificity, safety-impact outcomes and reviewer agreement; set minimum pass thresholds before data collection.

## Technical tests

The new `tests/ci10d-creatinine-review-screen.test.ts` covers threshold-positive 7-day rise and 48h absolute rise, negatives outside intervals and under thresholds, stale readings, wrong code/unit, conflicts, preliminary data, falling values, and end-to-end assembly into an immutable trend artifact. The CI-10D PR workflow invokes it, along with existing typecheck/lint/build and CI-10D through security regressions.

**Do not merge this PR as a production-enabled clinical rule without the above adjudication and institutional authorization.**

## Clinical sources
- NICE acute kidney injury NG148: https://www.nice.org.uk/guidance/ng148/chapter/Recommendations
- KDIGO AKI 2012 guideline: https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf

**Evidence origin:** G-HIMS synthetic Step-112 model-output audit; clinical wording and thresholds sourced from clinical standards, but implementation and operational thresholds still require qualified local review.
