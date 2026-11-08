# G1/G2 — independent review and exact-head evidence gate

**Date:** 2026-11-09. **Classification:** read-only GitHub policy verification; local unit tests; NO_GO for hosted G1, hosted G2 and production. No billing, route, SWP, IAM, secret, Firestore, or clinical operation is modified.

## Confirmed repository condition at audit

- Protected branch: `main` of `irtizah738/G-HIMS-AI`.
- Parent G2 PR [#274](https://github.com/irtizah738/G-HIMS-AI/pull/274) is **draft/open/unmerged** with **zero recorded PR review submissions**; source-only features from #275 and #276 have been merged into its **feature branch** only. That is not a merge into `main`.
- `main` branch ruleset `25733056` is active, but requires **zero** approving reviews, does **not** dismiss stale reviews, does **not** require last-pusher approval, and does **not** require CODEOWNER approval.
- `.github/CODEOWNERS` is missing. Do not fabricate owner identities or assign approvals to the author.
- The ruleset requires four legacy checks: CIQP-182 source guards, CIQP-182 emulator crash/replay/race, typecheck/lint/full-unit/build, dependency/secret/SBOM. The two G3–G8 synthetic jobs are **not** presently required in the branch ruleset.
- Passing any number of CI workflows is not proof of independent review or production network qualification.

Treat all such evidence as *point-in-time*; use the live read-only guard again before a security-review handoff and after each new commit.

## New read-only check

`scripts/ops/helixis-g3-g8-pr-review-evidence.mjs` fetches live GitHub API evidence only when invoked explicitly with `--live`. It never merges, approves, changes branch rules, or touches billing/cloud resources. A token with read-only repository, pull request, contents and checks access is required; do not paste the token into a chat or store it in a project file.

Example from a trusted local terminal:

```bash
export GITHUB_TOKEN="$(gh auth token)"
node scripts/ops/helixis-g3-g8-pr-review-evidence.mjs --live --repo irtizah738/G-HIMS-AI --pr=274
```

The guard checks the exact PR head SHA (not previous CI runs), open/non-draft `main` target, mergeability, at least two **distinct non-bot non-author** fresh approvals for that exact head commit, reviewer-request changes, strict branch status checks, effective two-review and CODEOWNER policies, last-pusher and stale-review controls, a nonempty `.github/CODEOWNERS`, and the six mandatory check contexts.

Returns `NO_GO` with reason codes when facts are missing, reviewers are stale, checks are pending/failed, CODEOWNERS is absent, or rules are not enforced. When all checked **GitHub review-evidence** predicates pass, it returns `REVIEW_EVIDENCE_READY_ONLY` while **still hardcoding** `hostedQualification: NO_GO` and `productionRelease: NO_GO`. This is a code-review handoff gate, **not** a deployment release decision.

The companion `tests/helixis-g3-g8-pr-review-evidence.test.mjs` is included in the dedicated source-only G3–G8 workflow. It exercises good and adversarial synthetic facts. The workflow runs the **unit tests**, not the token-based live check; this prevents untrusted PR code from being granted privileged token access.

## Required human and repository actions before merge

1. Identify at least **two genuinely independent** security/clinical reviewers with appropriate repository access, plus a named accountable code owner. The PR author and the last pusher must not supply their own independent approval. Reviewers must explicitly read the code, diffs, threat model, audit integrity, Firestore rules, consent and clinical-fact safety.
2. Add **real** CODEOWNERS entries for `lib/clinical/intelligence/external-fhir-*`, `emulator-security/helixis-fhir-*`, `firestore.rules`, and relevant workflows, once the owners accept this responsibility. Verify their accounts/teams are eligible to approve.
3. As a separately reviewed ruleset change, require at least two approving reviews, stale-approval dismissal on new commits, last-pusher approval, and CODEOWNER review. Add both exact G3–G8 check contexts to the existing mandatory checks, and retain strict status policy.
4. Review and merge parent #274 **only after** the evidence gate passes; check merge base and full exact-head CI after any rebase or pushed change. Branch protection must not be bypassed.
5. G1 actual network workload identity and fail-closed egress, G2 hosted IAM/scheduler, independently authenticated vendor/KMS/witness data, DR, hospital approval and clinical safety still require distinct deployed qualification. Never infer them from synthetic tests.

## Deployment separation

These approval requirements are *necessary but not sufficient* for real hospital release. Additional production gates must be owned independently of this tool and must consume verifiable cloud/hospital evidence rather than synthetic GitHub data.

`G1_HOSTED=NO_GO`
`G2_HOSTED=NO_GO`
`PRODUCTION_RELEASE=NO_GO`
