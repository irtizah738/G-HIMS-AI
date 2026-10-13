# G-HIMS-AI — audit of remaining unmerged branches (2026-10-12)

**Baseline:** `main` commit `b15e5ba307bad3fb795e1edd0000e478d60bc2e7`.
**Scope:** G-HIMS-AI Git branch review only. G-HIMS-OS remains the independent staging repository and is not merged into G-HIMS-AI.
**Disposition:** Neither a historical green test run nor a branch marked "draft" proves current-main compatibility, deployment readiness or authority to mutate production clinical/finance data. No unsafe bulk merge.

## Open draft PRs — review completed

| PR | Branch | Main comparison (ahead/behind) | Exact-head PR CI | Decision, prerequisites |
|---|---|---|---|---|
| [#189](https://github.com/irtizah738/G-HIMS-AI/pull/189) | `release/ciqp-clinical-integrated-current-main` | 25/5, conflicts | 47 success, 20 fail, 1 cancelled (68 total) | **BLOCKED.** Patient 360 policy-epoch migration requires a successful exact-head rebase/test run, emulator restore/conflict qualification, hosted *isolated* staging approval, clinical evidence/provenance review, independent restore plan. Old CI fails include lost Bun lockfile and extracted HCM privilege-map expectations fixed separately on later main. Never apply emulator-only migration tools to hosted production. |
| [#169](https://github.com/irtizah738/G-HIMS-AI/pull/169) | `fix/telehealth-turn-patient-capability-20261010` | 17/15, conflicts | 64 success (historical head) | **BLOCKED.** Reconcile current signaling/Next config/security controls with main; rerun exact-head CI and negative capability tests; verify actual TURN, patient token fragment scrubbing, clinician scope, and cross-role browser call in isolated staging. Preserve already-merged #161 signaling security. |
| [#165](https://github.com/irtizah738/G-HIMS-AI/pull/165) | `fix/offline-hydration-identity-isolation-20261010` | 39/27, stacked on #162 | One supply-chain workflow success only | **BLOCKED.** Parent #162 is unmerged; rebase stack, require full exact-head CI plus shared workstation UID switch, offline encryption and reconnect tests. Prevent all access to cached PHI before restored UID verification. |
| [#162](https://github.com/irtizah738/G-HIMS-AI/pull/162) | `fix/identity-offline-continuity-20261010` | 32/27, mergeable with current main but unqualified | 64 success (historical head) | **BLOCKED.** Production MFA requirement could lock out current authorized clinical/administrative/finance users. Verify MFA enrollment/claims and a rollback/downtime plan in isolated staging before rollout; retest against latest main. |
| [#160](https://github.com/irtizah738/G-HIMS-AI/pull/160) | `feat/dev-sandbox-isolated-workflow-program` | 35/59, conflicts | 70 success (historical head) | **BLOCKED.** Dev sandbox wiring overlaps current Firebase/runtime guard and package manifests; must be emulator-only, with no real `g-hims-ai` project, no production patient data, and full contemporary CI. |
| [#159](https://github.com/irtizah738/G-HIMS-AI/pull/159) | `fix/mpi-single-directory-and-terminal-state` | 32/60, conflicts | 64 success (historical head) | **BLOCKED.** Incorporates older #158 active-care blocker UX. Reconcile shared MPI and OPD workspace against later billing and main clinical changes; preserve MRN uniqueness, tenant isolation and terminal encounter semantics; qualify existing-patient/no-duplicate-registration. |
| [#157](https://github.com/irtizah738/G-HIMS-AI/pull/157) | `fix/telehealth-lifecycle-cancel-empty-encounter` | 60/60, conflicts | 64 success (historical head) | **BLOCKED.** Older TURN/ICE security implementation is superseded in part by #169. Extract only distinct cancellation/room repair/signed-evidence fixes, reconcile against #161 security; test no cancellation of started or billed care before new PR. |

## Closed but unmerged PR branches — review completed

| PR | Branch | Disposition |
|---|---|---|
| [#187](https://github.com/irtizah738/G-HIMS-AI/pull/187) | `fix/restore-test-demo-firebase-isolation` | Historical TEST/DEMO isolation work partially addressed by #190 and current main; compare safety assertions before retiring. DO NOT replace current PRODUCTION mapping. |
| [#186](https://github.com/irtizah738/G-HIMS-AI/pull/186) | `release/ciqp-clinical-integrated-candidate` | Older Patient 360 integration candidate, substantially replaced by #189; no direct merge over modern main. |
| [#185](https://github.com/irtizah738/G-HIMS-AI/pull/185) | `fix/ci10-evidence-event-cursor-fence` | Evidence cursor/frozen revision work is included conceptually in #189; retain until final candidate regression evidence proves parity. |
| [#184](https://github.com/irtizah738/G-HIMS-AI/pull/184) | `fix/ciqp-readonly-patient360-legacy-inspector` | Read-only Patient 360 policy inspector evolved in #189; review parity before deletion. |
| [#183](https://github.com/irtizah738/G-HIMS-AI/pull/183) | `fix/restore-clinical-revision-fences-and-reproducible-ci` | Old Patient 360 revision fencing/reproducible CI; main dependency baseline has since changed and #189 carries additional clinical revision behavior. |
| [#181](https://github.com/irtizah738/G-HIMS-AI/pull/181) | `fix/clinical-evidence-self-amplification` | AI non-authoritative events should not alter patient clinical revision; preserve until proven in integrated #189. |
| [#180](https://github.com/irtizah738/G-HIMS-AI/pull/180) | `fix/patient360-interrupted-read-recovery` | Revision-fenced interrupted publication/read recovery, overlapping #189; preserve until emulator negative/interrupt tests prove no regression. |
| [#179](https://github.com/irtizah738/G-HIMS-AI/pull/179) | `fix/clinical-death-certificate-least-privilege` | Certificate-only grant must never expand to general clinical note signing; compare typed privilege mapping against current server policy and #189. |
| [#158](https://github.com/irtizah738/G-HIMS-AI/pull/158) | `fix/mpi-removal-active-care-blocker-ux` | Ancestor of open #159 MPI work, not safe to discard until merged/qualified active-care safeguard exists on main. |

**Closed does not mean merged.** Keep these commits retrievable; retire refs only after verified parity in a qualified main-bound replacement, not simply because their PRs are closed.

## Branches with no PR — review completed

| Branch | Main comparison | Disposition |
|---|---|---|
| `fix/mock-retirement-clinical-pointer-diagnostics-20261009` | ahead 0, behind 64 | **SAFE TO RETIRE**: ancestor of main; no unique commits or changes. The one-time cleanup workflow independently rechecks this before deletion. |
| `fix/ciqp-182-complete-legacy-event-inspection` | ahead 41, behind 6 | **PRESERVE**: distinct historical Patient 360 inspection/MPI/revision code. Needs manual integration review against #189; no PR or exact-head all-green evidence. Do not run historical-data rewrites. |

## Merge order and sign-off requirements

1. Reconcile **one** current-main candidate at a time and obtain exact-head CI plus clinical/regression evidence; do not bulk-merge 7 diverged, overlapping PRs.
2. Qualify identity #162 and child #165 in **isolated** staging with real MFA claims, UID-switch/reconnect and clinical-authority tests before any production-access changes.
3. Reconcile telehealth security #169 before selecting distinct older lifecycle operations from #157; verify patient capability, TURN confidentiality, clinical scope and no phantom session completion.
4. Reconcile MPI #158/#159 while preserving active-episode removal lockout and unified MRN identity; then qualify emulator and cross-role browser flows.
5. Reconcile clinical intelligence #179/#180/#181/#183/#184/#185/#187 and orphan #182 inspector into **one** #189-current-main candidate. Resolve all failing CI, interrupted publication and real historical-data migration qualification before enabling Patient 360 release.
6. Only then retire old closed/unmerged refs if each fix is verified to be preserved; real clinical staging approval, restore drills and independently reviewed evidence remain distinct from green CI.

**Production policy:** No test/DEMO project using production Firebase `g-hims-ai`; no bypass of credential-gated clinical signing; never create fake financial records; no cross-repository merging of G-HIMS-OS/G-HIMS-AI.
