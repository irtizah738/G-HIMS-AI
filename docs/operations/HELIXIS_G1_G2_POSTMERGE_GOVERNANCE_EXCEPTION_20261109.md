# G1/G2 post-merge governance exception — 2026-11-09

**Classification:** source-only retrospective review. **G1 hosted, G2 hosted, and production: NO_GO.**

## Verified GitHub evidence (2026-11-09 check)

- PR [#274](https://github.com/irtizah738/G-HIMS-AI/pull/274), G2 evidence and held-work review: merged into `main` at `2026-11-08T21:14:48Z`, merge commit `01a7d6df8b884b306d3d0864119d5cbc2754752b`. **No recorded pull-request review submissions.**
- PR [#277](https://github.com/irtizah738/G-HIMS-AI/pull/277), review-evidence source checker: merged into `main` at `2026-11-08T20:47:58Z`, merge commit `8c367279aa0034fb6cf28d5083453552baf91d94`. **No recorded pull-request review submissions.**
- PR [#278](https://github.com/irtizah738/G-HIMS-AI/pull/278), always-on G3–G8 job triggers: merged into `main` at `2026-11-08T21:08:25Z`, merge commit `110fefd47bf050639c5d53232b20c1ffe6ff7cb0`. **No recorded pull-request review submissions.**
- Current `main` head at that check: `01a7d6df8b884b306d3d0864119d5cbc2754752b`.
- Active ruleset `25733056` still enforces `required_approving_review_count: 0`, `dismiss_stale_reviews_on_push: false`, `require_code_owner_review: false`, `require_last_push_approval: false`, and four legacy status contexts (not the two G3–G8 contexts).
- The merged review checker and always-on workflows are **not** evidence that GitHub branch protection now requires independent security/clinical approvals.

All three merges were performed by the repository owner in GitHub. No statement is made about why they were merged or whether anyone informally reviewed them outside GitHub; that cannot be established from these records. Prior source-only CI PASS is evidence of synthetic tests, **not** independent approval.

## Retrospective audit tool

`scripts/ops/helixis-merged-pr-governance-audit.mjs` is a read-only evaluator of concrete merged-PR metadata, pre-merge exact-head reviewer submissions, and **current** effective rules. It reports:

- `NO_RECORDED_REVIEWS` and `FEWER_THAN_TWO_PREMERGE_EXACT_HEAD_HUMAN_APPROVALS` when applicable.
- Missing current two-review, stale-approval dismissal, last-push approval, and CODEOWNER enforcement.
- `historicalRulesetAtMerge: NOT_VERIFIABLE_FROM_CURRENT_RULES` because today's settings do not prove the rules active when a PR merged.

It **does not** retrospectively approve a merge, inspect private informal review communications, authenticate professional clinical credentials, or issue a release approval.

### Local read-only use

```bash
# Existing GitHub CLI auth; token never written into repo files.
export GITHUB_TOKEN="$(gh auth token)"
node scripts/ops/helixis-merged-pr-governance-audit.mjs \
  --live --repo=irtizah738/G-HIMS-AI --prs=274,277,278
```

A separate `workflow_dispatch`-only Actions workflow, `Helixis G1-G2 Post-Merge Governance Audit (Read Only)`, uses a read-only `GITHUB_TOKEN` and checks out **main**, not an untrusted PR head. It exits nonzero if governance exceptions are present; the failure is deliberate, not a source build failure. It may use GitHub Actions minutes. It performs **no** GCP billing, Cloud Run, routes, IAM, SWP, real HIS FHIR or hospital-data operation.

The pure evaluator has synthetic adversarial tests (no GitHub access in the CI test job). Its result is either `GOVERNANCE_EXCEPTIONS_REQUIRE_REVIEW` or `EVIDENCE_SNAPSHOT_ONLY`, always with `hostedQualification: NO_GO` and `productionRelease: NO_GO`.

## Required corrective action — separate authenticated governance

1. Record a formal post-merge nonconformance for #274, #277 and #278. Arrange *retrospective* review of the exact merged code by independent technical security and qualified clinical personnel. Do **not** backdate or manufacture GitHub approvals; if issues are found, file new PRs and retain audit history.
2. Immediately review `main` ruleset in GitHub Settings → Rules → Rulesets. Require **at least two independent approvals**, dismiss stale approvals, require last-push approval, and audit bypass actors. Confirm repository/organization plan support and enforceability.
3. Confirm real eligible owners before adding `CODEOWNERS` (targeting FHIR, emulator, Firestore security and workflows), then enforce code-owner review. GitHub owner review alone does not prove approval by both a security specialist and a qualified clinician.
4. The #278 workflow removes G3–G8 path filtering. Validate both job contexts on an unrelated docs-only PR, then explicitly add both exact job names to required statuses. Ensure checks are from the expected GitHub Actions App.
5. Separate hosted G1 SWP source identity and fail-closed route evidence, G2 Cloud Run/Secret Manager/KMS/Vendor FHIR provenance, independent DR/witness, institutional authority, and clinical safety before any pilot or production release.

**Release flags:** `G1_HOSTED=NO_GO`, `G2_HOSTED=NO_GO`, `PRODUCTION_RELEASE=NO_GO`. No billing activation or hosted GCP mutation was performed by this audit.
