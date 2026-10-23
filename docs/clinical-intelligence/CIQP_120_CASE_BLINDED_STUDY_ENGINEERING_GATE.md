# CIQP Stage 2 — Exact 120-Case Blinded Synthetic Study Engineering Qualification

**As-built engineering protocol; not clinical approval or real-patient validation.**

## Relationship to earlier work
- Draft PR #215 contains **provisional renal deterioration numerical screening** requiring independent nephrology and hospital review.
- Draft PR #216 contains the clinician validation workspace. Its **three curated rehearsal cases** were previously qualified by four-account Chromium walkthrough and nine Auth/Firestore emulator route tests.
- The original [blinded clinical study protocol](CI10D_BLINDED_RENAL_VALIDATION_PREREGISTRATION.md) is the clinical authority. The full 120-case study is **not authorized to start** until the policy and reviewer credentials are verified externally.

## Exact prepared cohort — no invented labels

The 120-case synthetic JSONL supplied to the user is reproduced by:

\`python3 scripts/ops/ciqp-reproduce-120-synthetic-cohort.py\`

The reproducibility test **must** match the original source-byte SHA-256:

\`116596dd531f549873cf026cb0e61209f96554954ca622f53ef3b7fb3adcca9d\`

The seed is 1122401 and six construction strata each have 20 examples. The blinded input contains no construction strata or clinician reference labels. The script neither contacts a hosted service nor accesses patients. It fails closed if its output bytes differ from the original user's pack.

## Isolated TEST-only staging

While in a disposable Firebase emulator process with identical client/server TEST project \`ghims-ciqp-synthetic\`, run:

\`\`\`sh
python3 scripts/ops/ciqp-reproduce-120-synthetic-cohort.py
bun scripts/ops/ciqp-stage-120-blinded-cohort.ts
bun test emulator-security/ciqp-blinded-cohort-staging-emulator.test.ts
\`\`\`

The staging command validates the exact data and immutably creates **120 locked synthetic documents** under \`tenants/ciqp-renal-browser/clinicalValidationCohortCases\`, together with \`clinicalValidationStudies/renal-ciqp-synthetic-120-v0\` and an audit record. It does **not** unlock assignment, import any clinician answers, disclose model output, trigger AI inference, or enable a patient-facing feature. All direct browser Firestore reads/writes for these collections are denied. The coordinator workspace displays aggregate staged count and approval status only; reviewer case access remains denied for the 120 cohort.

## Prospective blinded study (NOT YET PERMITTED)

Only after valid clinical policy, hospital authority, dataset sampling and reviewer credentials are documented:

1. Record the approved protocol version, source fingerprint, inclusion/exclusion rules and target cohorts (especially obstetric/postpartum, CKD and renal-replacement).
2. Credential-verify two qualified clinicians and independent adjudicator. Avoid giving a primary reviewer both an authoring and reference-standard role.
3. Assign the entire locked cohort to both primary clinicians while hiding original source construction strata and all algorithm outputs. Both submit immutable evidence-linked independent assessments.
4. Third clinician resolves disagreements. The record must preserve the original reviews, adjudicator reasoning, timestamps and provenance.
5. Freeze all 120 independent labels and adjudications before *unsealing* blinded model outputs. Lock model policy/version/prompt/terminology and prediction artifact SHA.
6. Score using \`lib/clinical/validation/blinded-renal-study-metrics.ts\` and optional \`scripts/ops/ciqp-score-locked-blinded-cohort.ts\`. This requires *locally digest-verified* reviewer files, verified source-cohort hash, affirmative external approval references, and a pre-locked model output file; it outputs an explicitly **DRAFT_NOT_CLINICALLY_APPROVED** report.
7. Independently inspect missed deterioration, false alerts, source accuracy, unsupported facts, omission severity and reviewer agreement. Wilson 95% intervals apply to proportions; indeterminate/missing data must remain visible rather than silently counted as negatives.
8. Independent specialist, institutional clinical governance and authorized release personnel must separately sign. Only then could retrospective deidentified institutional validation or controlled hospital pilot be considered.

**The offline evaluator cannot authenticate clinicians, verify license registrations, cryptographic sign-offs, or confirm that reference answers were truly submitted before prediction unblinding. These checks require institutional procedures and separately audited records.**

## Tests and gates

The PR workflow runs:
- TypeScript, lint, Next build, CI10D/CI10H safety regressions.
- \`tests/ciqp-blinded-renal-study-metrics.test.ts\`: denominators, true/false results, indeterminate/missing, reviewer kappa, safety stops and 95% CIs.
- Reproducible exact 120-case source-hash check, emulator-only staging and zero-access/zero-unblinding assertions.
- Existing Auth/Firestore emulator reviewer-blinding test and real Chromium four-account rehearsal.

**Release decision remains HOLD until all PR-wide baseline security/dependency checks pass AND an independently verified institutional/clinical approval exists.** This study does not access any patient record or authorize AI activation in G-HIMS AI. The G-HIMS OS staging repository remains separate.
