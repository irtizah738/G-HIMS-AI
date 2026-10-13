# G-HIMS AI — Clinical Infrastructure & Intelligence Qualification Program (CIQP)

**Scope:** `irtizah738/G-HIMS-AI` only. G-HIMS-OS is a separate experimental repository; its passing builds do not qualify this repository.
**Baseline at program initiation:** `8d97587c226349f820cc6bd5a1f1c1deaed3ebf1` (2026-10-11).
**Evidence classes:** IMPLEMENTED, SOURCE_TESTED, DEPLOYED_QUALIFIED, CLINICALLY_VALIDATED, EXTERNALLY_BLOCKED. Each claim requires a source/check/run/attestation identifier. A workflow's existence is not a pass.

## Ordered implementation and evidence ledger

| CIQP | Clinical objective | Evidence observed at initiation | Open release gate |
| --- | --- | --- | --- |
| 00 | Clinical baseline / architecture | Clinical AI CI matrix and domain tests green on initiating SHA; full CI Baseline red on two brittle guard source assertions | Re-run whole main baseline and fix remaining failures; do not downgrade tenant guards |
| 01 | Clinical actor, privilege, consent | Server-derived authorization context, credential guards, consultant services | Independent staging MFA, revoked privilege, tenant and consultant routing tests; PR #162 |
| 02 | Atomic clinical commands | TransactionManager and registration orchestrator, replay-idempotency tests | Concurrent clinical event/outbox and failure injection on deployed source |
| 03 | MPI / MRN / identity resolution | Institutional MRN normalization, registration orchestrator, patient identity and MPI merge domain | Reconcile open #158/#159 with main; real negative merge/resolution tests |
| 04 | OPD clinical workflow | OPD 1–16 source services, deployed cross-role contract definitions | Rehearse full deployed OPD cross-role, consultant worklist and clinical signing, without manual Firestore edits |
| 05 | Patient 360 longitudinal projection | Deterministic projector and service; CI-4 tests | Real staging rebuild, revision concurrency and recovery evidence |
| 06 | Context and missingness | CI-5/6 read surface, knowledge status, evidence loader | Completeness and provenance tests on retrospective real cases |
| 07 | Offline clinical continuity | Encrypted edge store and vector-clock sync; CI-10I contract tests | Two-device physical airplane-mode and cross-user isolation; blocked by #162/#165 |
| 08 | CI-10F governed drafting | Six draft types with revisions and clinician approval/signature tests | Signed clinician staging workflow using real patient context |
| 09 | CI-10G copilot | Copilot workspace and longitudinal/encounter prep/trend/medication APIs | Staging provider smoke, clinician UX metrics |
| 10 | CI-10H safety evaluation | Safety evaluator and synthetic adversarial benchmark source tests | Held-out clinician-adjudicated retrospective safety cohort |
| 11 | CI-10I offline/production | Fail-closed offline read-only mode and provider policy code | Target environment readiness 200, live synthetic provider smoke, physical offline qualification |
| 12 | Longitudinal flagship demo | `docs/clinical-intelligence/FLAGSHIP_DEMO.md` and synthetic scripted provisioner | Exact SHA staging repeatable cross-role demo artifact |
| 13 | Retrospective evaluation | Protocol, evaluator, scoring harness | Institutional approval, frozen **real** dataset, >=2 independent reviewers, third adjudicator, actual report |
| 14 | Hospital-0 | Clinical pilot charter, evidence contract | Institutional authorization, staff enrollment, signed clinical evaluation, incident review, onsite evidence |

## CIQP-05 legacy Patient 360 policy epoch migration — 2026-10-12

- **Current stage: source implementation + synthetic emulator qualification IN PROGRESS; not deployed-qualified, not clinically validated.**
- Main baseline P0 repair: `720c262e4165da05c4964205751246a9783524a6`, 18/18 green push checks. Draft PR #189 contains the separate CIQP historical migration work and MUST retain its draft status until independent approval.
- The versioned `projectionPolicyEpoch=2` is added *outside* the canonical hash input to preserve audit/content-hash compatibility. AI-generated, reviewed, approved-but-unsigned and rejected draft events remain immutable in the event store, but do not count toward the authoritative Patient 360 revision.
- `lib/clinical/patient360/ciqp-policy-migration.ts` is an **emulator-only** migration qualification engine: explicit TEST + local Firestore emulator host + synthetic tenant + acknowledgement; there is no hosted/staging/production execution route.
- The migration's CAS transaction re-reads the stored projection, patient, canonical clinical collections, clinical knowledge and all four patient-event routes. It only accepts a legacy revision with a matching raw event count and stored last-event cursor that is corroborated by excluded AI events; ambiguous / oversize / concurrent updates fail closed.
- For accepted synthetic cases, it persists previous revision, cursor, source fingerprint, and content hash in a tenant-owned audit ledger, commits a generation with `timelineReady=false`, writes revision-scoped rows, and finalizes readiness only after publication. Interrupted migrations can resume idempotently without rewriting immutable events. No existing event/outbox or old timeline rows are deleted.
- New `emulator-security/ciqp-patient360-policy-migration.test.ts` exercises synthetic migration/retry, crash and resume, signed clinical event inserted during preflight, two-worker CAS, and cross-tenant isolation. The P4 emulator CI script includes it. `tests/ciqp-patient360-policy-migration-guards.test.ts` enforces the emulator-only gate.
- `scripts/ops/ciqp-migrate-patient360-legacy.ts` provides bounded read-only dry-run vs explicit synthetic-emulator apply, aggregate-count output only, and always reports `EMULATOR_ONLY_NOT_APPROVED`. It is **not** a live migration executable.
- **Outstanding release evidence:** exact final SHA and full completed CI/emulator pass, realistic restore rehearsal, signed staging tenant authorization and synthetic staging dry-run/run evidence under a separately reviewed *hosted* migration design, backups/rollback, operators' approval, incident response, independently verified two-worker source-event race behavior, and clinical sign-off. Do not mark issue #182 complete or deploy PR #189 on source CI alone.

## Explicit no-claims boundary

1. The `scripts/ops/ci-synthetic-validation.ts` cohort contains **fixed numerical benchmark labels** for 120 synthetic cases. Passing it verifies scoring and safety gate logic. It is **not 120 model-reviewed patients** and does not measure observed real-world clinical accuracy.
2. `evaluation/retrospective/clinical-evaluation-template.json` has zero cases and zero reviewers. An empty retrospective template cannot pass a clinical evaluation.
3. Successful Hospital-0 contract CI checks validate the **manifest schema and safeguards**, not live hospital enrollment or patient encounters.
4. Source CI cannot establish Vercel Preview/Firebase staging isolation, clinician MFA enrollment, physician credential authority, physical offline operation, a third-party security review, or a hospital's permission to use data.
5. Do not merge deployment-changing security PRs until required staging identities, IdP/MFA, cross-user offline and rollback evidence exist. This includes draft PRs #162 and #165. Other stacked draft PRs are not automatically eligible for merge.
6. Never copy, deploy, merge or back-port an entire G-HIMS OS repository into G-HIMS AI.

## Qualification protocol and evidence requirements

1. Freeze exact `main` SHA and obtain green full CI Baseline, domain/CI safety, clinical evaluation, and P8 tests **on that SHA**.
2. Complete isolated staging deployment of **G-HIMS AI code** to a dedicated Firebase project; capture `/api/health/ready` and `/api/health/clinical-intelligence` real responses with no blocker and exact release SHA.
3. Rehearse General Medicine OPD + Patient 360 + CI-10F/G across reception, nursing, consultant and second clinical reviewer with real credential authority, synthetic records, signed clinical facts and complete provenance. No direct Firestore edits, mock command responses or impersonation.
4. Physically disconnect two devices; exercise encrypted cache, actor switch, logout/UID change, TTL revocation, stale context, replay conflict, reconnect and session rotation.
5. Test a real approved AI provider on **synthetic** encounter facts for both normal outputs and timeout/failure. Freeze prompt/model, safety policy, projection revision, outcome logs and source citations.
6. Undertake institutional review for retrospective study of 100–300 approved, properly handled historical encounters, independently annotated by >=2 qualified clinicians. Report denominators, confidence intervals, omissions, critical fact recall, source-link correctness, harmfulness and cost/latency separately from synthetic samples.
7. Begin read-only/shadow Hospital-0 only after signed hospital authorization, data agreements, staff enrollment, incident stop criteria, rollback rehearsals and independent security/DR/monitoring evidence. No autonomous clinical action.
8. Update this ledger after **each** completed gate with links to actual Actions runs, deployment SHA, signed clinical evaluations and safety incident reports; never promote a status based on a draft plan.

## Immediate issue routing

- **Baseline repair:** synchronize tenant route authority *behavioral safety invariants* with the merged combined loading+unresolved guard. Source string formatting is not a clinical release criterion; fail-closed behavior is.
- **Clinical identity:** PR #162 requires real staging MFA; PR #165 must follow #162 and independently prove no prior-user edge PHI is returned.
- **MPI and consultant workflow:** stacked PRs #158/#159 need source reconciliation and cross-role deployed evidence.
- **Development sandbox:** PR #160 is synthetic/emulator only and must never touch hosted `g-hims-ai` data.
- **Telehealth security:** PR #169 is not permitted to bypass its staging TURN and MFA preconditions.
- **External institutional evidence:** follow `docs/clinical-intelligence/RETROSPECTIVE_VALIDATION_RUNBOOK.md` and `docs/clinical-intelligence/HOSPITAL0_PILOT_CHARTER.md`.

**Authority:** `G-HIMS_PRODUCTION_BLOCKERS.md` is the active production blocker register. Nothing in this ledger overrides it.
