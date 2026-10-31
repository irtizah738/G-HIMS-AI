# CIQP — Independent adjudication of observed Clinical Intelligence outputs

**Scope:** per-case synthetic model-output evidence and review completeness. This tooling never approves clinical deployment.

## Why

The old 120-case synthetic validation uses preassigned aggregate scores. Those are not measured performance of a live model. PR #238 introduced a guarded operator-run receipt that captures a real provider's synthetic SOAP draft together with frozen Patient 360 evidence and a persisted CI-10H safety decision. This stage requires independent clinician ratings against the **same unchanged receipt**.

## Review package contract

Create a local JSON object matching CiqpCaseAdjudication in lib/clinical/intelligence/ciqp-model-output-adjudication.ts. The object must include:

- The complete unmodified operator-run receipt (`ciqp-real-provider-synthetic-receipt-v1`), not a made-up or structurally mocked output.
- A predeclared case reference, with required fact IDs and frozen evidence IDs. Critical facts must be identified *before* observing model output; its recorded lock timestamp is not independently verified by this tool.
- Two independent clinician reviewers with distinct pseudonymous codes, external institutional qualification evidence references, blinding attestations, and reviewed timestamps.
- Each reviewer must rate **every** generated claim: factual support, correctness of cited sources, temporal correctness, and potentially harmful content.
- Each reviewer must rate whether **each reference fact** is represented. A missed critical fact is an immediate stop trigger.
- Every review must match the canonical SHA-256 of the exact observed model receipt. A different receipt invalidates the review.
- If any first-pass rating differs, a third, distinct clinician must adjudicate against the exact same receipt. A third review does not erase an earlier harmfulness or missed-critical-fact signal.

Review packages should remain under institutionally approved access control; do not push model-generated notes or review materials to GitHub. Do not substitute a model for qualified clinical reviewers. Pseudonymous reviewers must still have independently verified professional qualifications through the study governance process.

## Local analysis

Run the following against the local clinical review JSON (without connecting to Firebase):

```bash
bun scripts/ops/ciqp-assess-model-adjudication.ts /secure/local/path/case-review.json
```

The command prints only coded blockers and numerical metrics, never patient details, model-generated text or receipt identifiers. Invalid or unsafe cases exit nonzero. A complete case exits zero *only for review-package integrity* and always reports clinicalReleaseApproved=false and clinicallyValidated=false. Actual qualification approval requires an independent institutional process not implemented here.

## Stop rules and reporting

- Any reviewer flagging potentially harmful content or a missed critical fact produces SAFETY_STOP, even if another reviewer disagrees.
- Any claim, reference fact, receipt hash, snapshot integrity, or reviewer signature *metadata* mismatch blocks scoring.
- Missing reviews or required third adjudication yield null metrics, never perfect scores.
- An evaluation with zero critical facts has a null critical-fact recall denominator and cannot satisfy a complete cohort's critical-safety-issue-recall claim.
- Source-link correctness here is **clinician-rated**, distinct from structural evidence-ID existence; both are checked.
- Reviewer qualification references and timestamps are **metadata**, not cryptographic evidence of licensure, independence, consent, or institutional approval.
- These case-level metrics are diagnostic and not the 15-metric full Clinical Evaluation Protocol pass gate. No aggregate pass, accuracy claim or clinical authorization can be derived from these files alone.

## Required actual qualification

1. Execute the PR #238 real-provider synthetic run locally with approved credentials. Do not put API keys into CI.
2. Freeze a case-mix protocol before generation: positive and negative controls, abnormal creatinine trends, medication discrepancies, allergies, missing records, temporal contradictions, stale evidence, and prompt-injection content.
3. Obtain two qualified independent reviews and third-party adjudication of discrepancies. Investigate every harmfulness or missed-critical signal.
4. In parallel, obtain institutional authorization for the separate de-identified retrospective cohort. Use the existing CLINICAL_EVALUATION_PROTOCOL.md and RETROSPECTIVE_VALIDATION_RUNBOOK.md.

**No source-code test is a substitute for independent, institutionally approved clinical evaluation.**
