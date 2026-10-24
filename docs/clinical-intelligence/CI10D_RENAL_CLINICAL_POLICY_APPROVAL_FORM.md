# CI-10D — Renal Deterioration Screening: Independent Clinical Approval Record

**Status:** PROPOSED — **NO CLINICAL APPROVAL RECORDED**  
**Linked code:** [Draft PR #215](https://github.com/irtizah738/G-HIMS-AI/pull/215), candidate screen `ci10d-clinical-trend-v2`  
**Objective:** Have independently qualified clinical reviewers **approve, revise or reject** the numerical criteria, wording, exclusions and escalation workflow **before any patient-facing use**.

## Evidence reviewed

- **NICE NG148**, recommendation 1.3.1: ≥26 μmol/L creatinine increase within 48 h, ≥50% rise within 7 days, or urine-output criteria; recommendation 1.2.11: CDS must not replace clinical judgment. https://www.nice.org.uk/guidance/ng148/chapter/Recommendations
- **KDIGO 2012 AKI guideline**: ≥0.3 mg/dL within 48 h or ≥1.5x baseline within 7 days, or oliguria. https://kdigo.org/wp-content/uploads/2019/01/KDIGO-2012-AKI-Guideline-English.pdf
- **KDIGO 2026 AKI/AKD update**: **public-review draft, not presumed to be a final enacted standard** as of this packet. The reviewers should check status and differences on approval date. https://kdigo.org/guidelines/acute-kidney-injury/
- **G-HIMS Step-112 case**: synthetic serum creatinine 0.9 mg/dL (Oct 17), 1.2 (Oct 20), 2.1 (Oct 22), a 2.33x five-day rise. Prior Gemini wording was under-specific. This is *not* a validated patient finding.
- **NICE / Kidney-related population caveat**: pregnancy/peripartum, chronic kidney disease, renal replacement therapy, age and availability/quality of actual baseline and urine output may alter applicability and urgency. G-HIMS must not apply an adult generic rule silently to the obstetric site.

## Candidate behavior to review

| Topic | Proposed engineering behavior | Reviewer decision |
| --- | --- | --- |
| Ratio screen | Flag candidate ≥1.5x increase from an earlier eligible result ≤7 days | ☐ Approve ☐ Revise ☐ Reject |
| Absolute screen | Flag candidate ≥0.3 mg/dL increase within ≤48 hours | ☐ Approve ☐ Revise ☐ Reject |
| Measurement identity | Explicit coded LOINC:2160-0 + comparable UCUM mg/dL; do not match free text or convert units implicitly | ☐ Approve ☐ Revise ☐ Reject |
| Source validity | Eligible final/amended/corrected; reject conflicting same-time/mixed-unit series; source evidence IDs required | ☐ Approve ☐ Revise ☐ Reject |
| Baseline | Earlier value is only a comparator, **not** automatically a verified pre-illness baseline | ☐ Approve ☐ Revise ☐ Reject |
| Recency | Latest observation must be within 7 days of snapshot; older latest readings produce no alert (never proof of no risk) | ☐ Approve ☐ Revise ☐ Reject |
| Warning wording | Display values, ratio, interval and evidence; require clinician assessment of possible kidney injury without diagnosis/stage/treatment | ☐ Approve ☐ Revise ☐ Reject |
| Escalation | No automatic urgency, notification, order, physician assignment, or clinical-signing action without site-approved policy | ☐ Approve ☐ Revise ☐ Reject |
| Missing / excluded data | Missing alarm is **not** a negative diagnostic result; clarify partial observation coverage/uncoded values | ☐ Approve ☐ Revise ☐ Reject |
| Target setting | Explicitly define eligible adult/paediatric/obstetric/peripartum/CKD/dialysis cohorts and site restrictions | ☐ Approve ☐ Revise ☐ Reject |
| Alert workflow | Agree responsible role, acknowledgement SLA, repeat alert handling, audit trail, out-of-hours/escalation route and alert-fatigue monitoring | ☐ Approve ☐ Revise ☐ Reject |

## Proposed UI warning for approval / revision

> **Provisional renal trend review — no diagnosis or action assigned.** The coded creatinine measurements changed from **0.9 to 2.1 mg/dL in 5 days** (2.33x). The earlier reading has not been established as the clinical baseline. A qualified clinician should review source results, history, symptoms, urine output and applicable site protocol to assess possible acute kidney injury. Evidence IDs: [source A], [source C]. **Policy not yet approved.**

**Approved wording:** __________________________________________

**Permitted patient populations and exclusions:** __________________________________________

**Clinician review urgency and escalation responsibility:** __________________________________________

**Expected behavior if measurement is stale or missing:** __________________________________________

**Reviewer comments or requested changes:** __________________________________________

## Adjudication and approvals (blank intentionally)

**Reviewer A — qualified nephrologist/renal-safety specialist**  
Legal name / clinical registration: _______________________  
Affiliation (independent of engineering): _________________  
Decision: ☐ APPROVE ☐ APPROVE WITH REVISIONS ☐ REJECT  
Signature / date / record reference: ______________________

**Reviewer B — site clinical lead or relevant physician**  
Legal name / clinical registration: _______________________  
Affiliation: _____________________________________________  
Decision: ☐ APPROVE ☐ APPROVE WITH REVISIONS ☐ REJECT  
Signature / date / record reference: ______________________

**Reviewer C — independent safety adjudicator (if disagreement)**  
Legal name / clinical registration: _______________________  
Disagreement disposition and evidence: _____________________  
Signature / date / record reference: ______________________

**Institutional patient-safety/governance authority (separate from specialist opinion)**  
Name / role / hospital / authorization instrument: ________  
Scope, limits, expiry, version: ____________________________  
Decision / signature / date: _______________________________

## Decision gate

Only mark `CLINICAL_POLICY_REVIEW=APPROVED` after (1) an exact revision and scope are defined, (2) registered reviewers and institutional authority are independently verified, (3) disagreements and revisions are closed, and (4) dated signatures are present. An approved **review protocol** is not approval to deploy a clinical alarm. The later blinded study and separate production/institutional release gate remain mandatory.

**Current state:** `POLICY_REVIEW=PENDING` · `BLINDED_EVALUATION=NOT_STARTED` · `PRODUCTION_AI=DISABLED`.
