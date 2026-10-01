# PRP — Pilot Readiness Program

Status: INITIATED
Program owner: G-HIMS Engineering / Hospital-0 Pilot Team
Frozen qualification candidate: `a3f96e8b124b280a5ed53acbb833df09d9465766`
Candidate source: `main`
Initiated: 2026-10-01

## Program rule

PRP is a qualification program, not a new architecture phase. No feature work is permitted unless a failed qualification gate demonstrates a safety, security, data-integrity, reliability, or pilot-operability defect.

Every qualification defect must follow:

`Finding -> severity -> reproducible evidence -> fix branch -> regression test -> review -> merge -> redeploy exact candidate lineage -> repeat failed gate`

## Release lineage

`main -> immutable candidate SHA -> isolated STAGING -> qualification evidence -> pilot release tag -> Hospital-0 controlled pilot`

## PRP gates

### PRP-1 — Isolated STAGING Deployment
Status: BLOCKED — DEPLOYMENT CREDENTIALS

Exit criteria:
- Exact current `main` SHA is recorded before deployment.
- Deployment uses the guarded STAGING workflow only.
- G-HIMS runtime mode is `STAGING` on both server and client.
- STAGING Firebase project is different from DEMO and PRODUCTION.
- Server/client Firebase project IDs match the declared STAGING project.
- STAGING contains no unguarded DEMO fixtures or hospital branding.
- Automatic branch deployments remain disabled.
- Smoke, authenticated P7, and DRP-10 cross-domain rehearsals pass.
- Deployment evidence artifact records SHA, URL, runtime, and verification time.

Kickoff finding:
- Current Vercel project has no deployment corresponding to the frozen DRP-S/main candidate.
- Recent Vercel deployment records predate the frozen candidate and are in ERROR state.
- Guarded STAGING workflow dispatch was successfully initiated for exact main SHA `a3f96e8b124b280a5ed53acbb833df09d9465766`.
- Workflow runs `36829005293` and `36829172912` both failed closed at "Validate Vercel credentials".
- Confirmed blocker: GitHub Actions secret `VERCEL_TOKEN` is unset.
- The workflow log also shows `VERCEL_AUTOMATION_BYPASS_SECRET` is unset; it will be required by the protected STAGING smoke gate.
- `GHIMS_P7_BOOTSTRAP_PASSWORD` is required by the later authenticated qualification steps and must be configured before retry.
- No build or deployment occurred after the credential gate, so no unqualified artifact reached STAGING.

### PRP-2 — Physical-Device Offline Qualification
Status: BLOCKED BY PRP-1

Required evidence includes physical phones/tablets/laptops under:
- mid-command network loss;
- browser/app restart;
- device reboot;
- power interruption;
- prolonged offline use;
- duplicate submission;
- outbox replay;
- expired sessions;
- shared-device user changes;
- reconnect ordering;
- projection convergence and duplicate prevention.

### PRP-3 — Backup / Restore / Rollback Drills
Status: BLOCKED BY PRP-1

Required evidence:
- real STAGING Firestore export;
- restore into isolated recovery project;
- event/invariant verification;
- projection rebuild;
- application rollback rehearsal;
- recovery timing and operator runbook.

### PRP-4 — External Alert Routing
Status: BLOCKED BY PRP-1

Required evidence:
- security/authz failures;
- failed governed commands;
- projection lag/outbox failures;
- backup failures;
- integration failures;
- availability failures;
- named human escalation and acknowledgement route.

### PRP-5 — Independent Penetration Assessment
Status: BLOCKED BY STABLE STAGING CANDIDATE

Required evidence:
- independent assessor scope;
- dated report;
- Critical/High findings triaged and remediated;
- regression evidence for each accepted fix;
- residual-risk record for deferred findings.

### PRP-6 — Hospital-0 Consent & Operational Rehearsal
Status: BLOCKED BY PRP-1..5

Required evidence:
- documented pilot consent and permitted scope;
- trained named users/roles;
- end-to-end hospital-day rehearsal;
- downtime/recovery scenario;
- incident/rollback contacts;
- known-limitations acknowledgement.

### PRP-7 — Site Acceptance & Pilot Go/No-Go
Status: BLOCKED BY PRP-1..6

Required evidence:
- department/site sign-off;
- support and escalation readiness;
- release manifest and exact pilot tag;
- baseline operational metrics;
- rollback authority;
- controlled pilot authorization.

## Existing qualification assets reused

The current repository already contains:
- `.github/workflows/staging-deploy.yml`
- `.github/workflows/drp-staging-readiness.yml`
- `.github/workflows/drp-recovery-drill.yml`
- `.github/workflows/drp-security-qualification.yml`
- `scripts/ops/drp-staging-preflight.ts`
- authenticated P7 and DRP-10 staging rehearsal scripts
- DRP security, offline, recovery, identity/session, and architecture regression suites

PRP reuses those assets as evidence-producing gates. It does not duplicate the DRP-S architecture program.

## Current next action

Configure the required GitHub Actions secrets without exposing their values in source control:
- `VERCEL_TOKEN`;
- `VERCEL_AUTOMATION_BYPASS_SECRET`;
- `GHIMS_P7_BOOTSTRAP_PASSWORD`.

Then re-run the guarded `STAGING Deployment` workflow against current `main` and require the workflow to produce:
- exact-main verification PASS;
- STAGING environment preflight PASS;
- build/deploy PASS;
- protected smoke PASS;
- authenticated P7 rehearsal PASS;
- DRP-10 cross-domain rehearsal PASS;
- deployment evidence artifact whose `main_sha` matches the frozen candidate lineage.

PRP-2 does not begin until PRP-1 exits PASS.
