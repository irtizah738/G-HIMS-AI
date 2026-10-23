# CI-10D — Pre-registered Blinded Renal Deterioration Evaluation

**Status:** STUDY DESIGN ONLY — `RENAL_POLICY_APPROVAL=PENDING` — `CLINICAL_CASE_REVIEW=NOT_STARTED`  
**Parent:** [Draft PR #215](https://github.com/irtizah738/G-HIMS-AI/pull/215) / [renal policy approval form](./CI10D_RENAL_CLINICAL_POLICY_APPROVAL_FORM.md).  
**Existing contracts:** [Clinical Evaluation Protocol v1](./CLINICAL_EVALUATION_PROTOCOL.md), [Retrospective Validation Runbook](./RETROSPECTIVE_VALIDATION_RUNBOOK.md), `bun run ops:ci:evaluate <adjudicated-dataset.json>`.

## Gate 0: No evaluation until qualified clinician policy decisions

A licensed renal/nephrology clinical reviewer and site clinical reviewer must approve/revise the candidate numeric thresholds, clinical context exclusions, warning wording, baseline behavior, and human escalation pathway; independent disagreement adjudication and institutional governance record are required. **Designing/generating synthetic cases is not adjudication.** No patient-facing alert or real patient data is permitted by this document.

Check current KDIGO guideline status at study lock: its **2026 AKI/AKD update is under publication preparation following a public-review draft**; do not assume the draft is final. Relevant sources: [KDIGO](https://kdigo.org/guidelines/acute-kidney-injury/), [NICE NG148](https://www.nice.org.uk/guidance/ng148/chapter/Recommendations).

## Stage 1 — Blinded, synthetic preclinical evaluation

**Planned pilot:** 120 wholly synthetic cases, **not** 120 real outcomes, stratified and randomized before scoring; extend if denominators are insufficient. A 120-case synthetic sample cannot establish real-world sensitivity or safety. Use a deterministic seed/manifest and retain immutable SHA256 hashes of case material, scoring schema, engine/prompt/model versions, review forms, inclusion criteria, and exclusion rules.

Case strata (preplanned, not outcome labels):
- Rapid creatinine increase candidates, including 48h and 7-day windows.
- Gradual/stable/declining and borderline trajectories.
- Units/codes missing or incompatible and same-time contradictions.
- Superseded/preliminary/future/stale records and missing evidence.
- CKD, low or unknown urine output, uncertain baseline or interfering context.
- Obstetric/peripartum and renal replacement therapy caution scenarios requiring explicit applicability decisions.

**Blinded reference-standard procedure:**
1. Issue each reviewer the **same numbered case pack containing source facts only**, with neither algorithm result nor another reviewer's labels.
2. Two independently credential-verified clinicians judge `REFERENCE_ACTIONABLE_DETERIORATION` as `YES / NO / INSUFFICIENT_EVIDENCE`, identify time-critical omissions and evidence refs, baseline confidence, and site-specific escalation obligations. They also grade independent model-output claims for factual support and timeliness when applicable.
3. Disagreements are reconciled **only by a third qualified clinician**, with original independent records retained and adjudication reasons logged.
4. Freeze the adjudicated reference **before unblinding** the system outputs, candidate review flags and generated warnings. Third reviewer does not see aggregate performance while deciding cases.
5. Merge blinded labels to system outputs **only after** both locks and capture protocol deviations and exclusions.

**No automated/engineered numerical oracle equals a clinician gold standard.** Numeric criterion adherence is a separate engineering endpoint; `INSUFFICIENT_EVIDENCE` is reported explicitly rather than silently treated as a true negative.

## Study endpoints (numerators and denominators, with 95% intervals)

**Renal-specific primary endpoints:**
- **Missed deterioration** = adjudicated `YES` cases that did not produce the approved review flag / adjudicated `YES` cases. Record severity and context; any critical miss triggers safety stop.
- **Sensitivity** = true flagged cases / all adjudicated `YES` cases.
- **False alert rate** = flags in adjudicated `NO` cases / adjudicated `NO` cases.
- **Specificity** = correctly unflagged `NO` cases / all adjudicated `NO` cases.
- **Indeterminate rate** and rate of missing/invalid evidence; reported separately, not quietly discarded.
- **Warning factual/source accuracy** = independently supported claims / all checked factual claims. Record wrong-time, wrong-unit, wrong-source and undocumented certainty events.
- **Inter-rater agreement** = raw agreement and Cohen's kappa for the two initial reviewers; for more than two, use appropriately documented multi-rater measures. Disagreement adjudication records are mandatory.

Report sensitivity/specificity confidence intervals and denominators; a perfect 120-case engineered cohort must not be advertised as clinical accuracy. False alert/PPV in a stratified synthetic cohort are **not** population prevalence estimates. No extrapolation to real hospitals.

**Existing Clinical Evaluation Protocol v1 still controls broader tasks** (≥98% supported claim precision, ≥95% critical fact recall, ≥98% source link accuracy, 100% critical safety recall, 0% harmful recommendation rate, ≥0.70 reviewer kappa and all other listed metrics). Those are provisional gates, not achieved results. Site reviewers must pre-specify the renal-only sensitivity and false-alert acceptability limits **before** unblinding; do not choose a convenient threshold after inspecting outputs.

## Stage 2 — Retrospective de-identified validation (separate cohort)

After Stage 1 has qualified and the institution authorizes it in writing, lock a **100–300 encounter cohort** (or a formally justified, adequately powered alternative) using predeclared case selection representative of the intended hospital population. Use pseudonymization, data minimization, approved processing agreements, ethics/privacy oversight as applicable, and an explicit prohibition on model writes to the clinical record. Score under the **same frozen rubric** but report results **separately** from synthetic data. Independently validate claims and source events tied to Patient360 frozen projection checkpoints, not only free-text case notes.

## Stop rules and release gate

Stop, investigate and repeat affected frozen segments for: critical deterioration miss, harmful recommendation, cross-patient leakage, provenance mismatch, source/event alteration, systematic timing error, or model/prompt/clinical policy change mid-cohort. Preserve original scores, version changes and exclusions. No production release by merely attaining a nominal passing percentage.

## Locked-manifest checklist (all initially pending)

- [ ] Written clinical policy signed, populations/exclusions fixed and site authorization recorded.
- [ ] Two qualified blinded reviewers plus an independent adjudicator named; conflicts of interest disclosed.
- [ ] Case-selection/seed/strata and study power reviewed, fixed before opening results.
- [ ] Frozen source SHA, Patient360 projection, `ci10d-clinical-trend-v2` policy, model/prompt/safety boundary recorded.
- [ ] Gold-standard rubric, urgency mapping, escalation thresholds and endpoint definitions approved.
- [ ] Synthetic dataset locked; reviewers blinded; independent ratings saved and signed.
- [ ] Adjudication completed; system output unblinded; 95% intervals and missing cases reported.
- [ ] Independent clinical safety sign-off and signed limitation statement obtained.
- [ ] Retrospective hospital consent/ethics and de-identification authorization obtained **before** accessing real data.
- [ ] Separate G-HIMS production readiness, deployment approval and Hospital-0 contracts completed.

**Do not use `scripts/ops/ci-synthetic-validation.ts` as clinical evidence.** Its fixed `caseCount:120` and benchmark counts exercise score calculation, **not** real model outputs or reviewer annotations; synthetic scoring PASS does not replace this blinded study.

**Current disposition:** `PRE_REGISTERED_DRAFT`; `CLINICAL_SIGNOFF=NOT_GRANTED`; `COHORT_MEASUREMENTS=NONE`; `PRODUCTION_AI_STATE=DISABLED`.
