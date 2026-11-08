# G3–G8 always-on required-check readiness

**Governance classification:** source-only CI change. **Hosted G1/G2 and production remain NO_GO.**

## Problem

The prior `.github/workflows/helixis-g3-g8-offline-qualification.yml` ran only for a path-filtered subset of pull requests targeting `main`. GitHub documents that a workflow skipped by path filters can leave a configured required check **Pending**. Therefore adding its two G3–G8 job names to the branch ruleset *before* fixing the trigger could block unrelated PRs.

## Design choice

The G3–G8 workflow now runs for **every** `pull_request` targeting `main`, without workflow-level `paths` filters. Both jobs always emit stable check names:

- `G3-G8 offline contracts, security and typecheck`
- `G3-G8 atomicity and synthetic recovery emulator`

The second job depends on the first and remains unavailable or unsuccessful if its prerequisite fails. Tests assert that the trigger stays unfiltered, the context names remain stable, and token permissions stay `contents: read`. No token with cloud or write privileges is provided. Both jobs run synthetic contracts or the loopback Firestore emulator, not actual hosted G1/G2.

**Tradeoff:** this incurs extra GitHub Actions minutes and longer PR CI for *all* repository changes, including non-FHIR changes. This is a deliberate reliability-over-cost choice until a separately reviewed and reliably always-emitted lightweight gate is designed. It does not activate Google Cloud billing.

## Evidence requirements before ruleset update

1. Merge this workflow change **only after** independent human code/security approval. Verify the exact-head two jobs pass.
2. On a later PR that changes only a non-FHIR file, verify both G3–G8 jobs are emitted and completed successfully. A successful run of this workflow-change PR alone is not independent proof for unrelated changes.
3. In GitHub **Settings → Rules → Rulesets → main**, retain existing strict required checks and add these two contexts (GitHub Actions integration) **only after** they exist in the check registry and have passed as expected.
4. Require at least two distinct approving reviewers, dismiss stale reviews when new commits are pushed, require approval after the last push, and (after real CODEOWNERS are assigned) require code-owner review.
5. Confirm actual reviewer permissions and independence; GitHub CODEOWNERS may allow one of several listed owners, so two approvals alone do not guarantee one security and one clinical signoff. Record and check both role approvals explicitly.
6. Review all bypass actors, admin exceptions, and any other rulesets. A ruleset check in isolation is not proof that it cannot be bypassed.
7. Repeat exact-head qualification after any rebase/retarget; keep G1 and G2 hosted/clinical release separate.

## What this does not solve

This change does **not** modify GitHub rulesets or appoint reviewers. It does not auto-approve drafts, assign CODEOWNERS accounts, authenticate real hospital reviewers, complete G1 network identity/route-fail-closed proofs, qualify production KMS or vendor OAuth, or authorize real patient use.

**State:** `G3_G8_ALWAYS_ON_WORKFLOW=QUALIFICATION_CANDIDATE`; `INDEPENDENT_APPROVAL=NOT_VERIFIED`; `G1_HOSTED=NO_GO`; `G2_HOSTED=NO_GO`; `PRODUCTION_RELEASE=NO_GO`.
