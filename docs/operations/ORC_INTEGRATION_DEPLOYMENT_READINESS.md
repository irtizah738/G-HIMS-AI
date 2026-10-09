# ORC Integrated Release Candidate — Deployment Preconditions

The release branch is `integration/orc-deploy-ready-20261009`. It consolidates ORC PRs #135, #138, #141, #142, #144. Only the exact qualified merge SHA may be deployed.

## Stage 1: source qualification
- Require Bun frozen dependency install, TypeScript, all clinical, financial, offline, HCM and security GitHub Actions checks on the combined commit.
- Keep only `bun.lock`; do not introduce a competing `package-lock.json`.
- Reconcile changes from updated `main` without discarding current test infra or patient safety guards.
- Record integration SHA and CI run URLs. Green checks on individual PRs do **not** qualify their combined source.

## Stage 2: guarded STAGING preview
- In GitHub **repository Settings → Secrets and variables → Actions**, configure `VERCEL_TOKEN` as a repository secret. Create it for the correct Vercel account/team with access to G-HIMS, and do not paste it into logs or tickets.
- In the same protected secret store configure `VERCEL_AUTOMATION_BYPASS_SECRET` and `GHIMS_P7_BOOTSTRAP_PASSWORD` according to the STAGING security runbook.
- Vercel scope must match team `team_0S9QQkyN4yTIj7QUZ9BVKsVV` and project `prj_a0TEuNNMAE61UziOoLNTok6Wbp1v`. Vercel Preview environment must be isolated from PRODUCTION Firebase.
- The `STAGING Deployment` workflow deploys **current main**, not an arbitrary PR. Merge the fully green integrated PR before invoking it with `confirm=STAGING`.
- Retain exact `MAIN_SHA`, staging URL, smoke response, provisioned *synthetic* tenant IDs, audit and cross-role qualification artifacts.

## Stage 3: operational acceptance (15 requirements)
HCM: verified credential authority, correct roster/facility, real consultant worklist handoff.
Tenant hydration: cache/switch isolation, all 8 authorized surfaces, all 52 domains independently assessed.
Emergency: persistent direct intake/census, vitals and handoff, discharge/transfer/IPD.
Record Vitals: credentialed clinician, Patient 360 projection, offline/replay recovery.
Billing: cash receipt/journal, all patient liabilities, final reconciliation with negative cases.

No source-code CI pass, Preview build, or green feature flag alone may convert a clinical/financial operational requirement from UNVERIFIED to VERIFIED.

## Stage 4: release
Run ORC-7 read-only staging integrity audit, ORC-8 deployed authenticated workflows, and ORC-9 rollback / audit / clinical and financial sign-off. Production deployment requires all 15 evidence-backed acceptance gates.
