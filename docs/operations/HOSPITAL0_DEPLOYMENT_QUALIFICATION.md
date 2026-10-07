# Hospital-0 Deployment & Qualification Program

## Purpose

Hospital-0 begins after Waves 1–5 are ENGINEERING_QUALIFIED.

The program converts repository evidence into deployed operational evidence. It must never be used to relabel CI success as a live-hospital qualification.

Readiness states remain:

- BUILDING
- ENGINEERING_QUALIFIED
- STAGING_QUALIFIED
- PILOT_QUALIFIED
- PRODUCTION_QUALIFIED

## Current entry state

The current engineering baseline is the latest `main` after Wave 5.

The existing Vercel Hobby project is used only as a guarded Preview-based STAGING trust domain. Automatic Git deployments remain disabled by `vercel.json`.

A dedicated Firebase STAGING project is mandatory. The historic shared Firebase project must not be reused merely to unblock deployment.

## H0-1 — Dedicated STAGING deployment

Required before any Hospital-0 account provisioning:

1. dedicated Firebase project created for STAGING;
2. Firebase Auth Email/Password enabled;
3. Firestore database created;
4. Firebase web application created;
5. least-privilege Firebase Admin/service identity created;
6. Vercel Preview configured with:
   - `GHIMS_RUNTIME_MODE=STAGING`
   - `NEXT_PUBLIC_GHIMS_RUNTIME_MODE=STAGING`
   - `FIREBASE_PROJECT_ID=<staging-project>`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID=<staging-project>`
   - `GHIMS_FIREBASE_PROJECT_ID_STAGING=<staging-project>`
   - `NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING=<staging-project>`
   - Firebase Admin credentials
   - Firebase web API/auth configuration
7. external integrations disabled unless separately qualified;
8. run the guarded `STAGING Deployment` workflow against exact current `main`;
9. readiness must return HTTP 200 with runtime STAGING and no blockers.

Do not configure PRODUCTION Firebase identifiers for this gate.

## H0-2 — Identity and tenant

Provision a synthetic qualification tenant first.

Required roles include Administrator, Reception, Billing, Nurse, Doctor, Lab and Pharmacy. Clinical identities remain unprivileged until credential verification and privilege assignment are explicitly completed.

Hospital-0 site accounts are provisioned only after the synthetic staging rehearsal is green.

## H0-3 — Physical offline qualification

Use at least two real workstations/devices.

Required evidence includes physical network loss, refresh/restart offline, queued writes, reconnect/replay, local-to-canonical ID remapping, conflict behavior, shared-workstation actor isolation and encrypted local PHI inspection.

The application offline toggle is not sufficient evidence.

## H0-4 — Cross-role workflow

Run the deployed hospital-day and cross-domain rehearsals plus browser journeys against the exact STAGING deployment.

No local mocks or browser-owned authority paths count.

## H0-5 — Resilience

Capture real evidence for:

- Firestore export/import to an isolated restore target;
- measured RPO/RTO;
- projection failure injection and deterministic rebuild;
- known-good deployment rollback/redeploy;
- failed outbox/projection recovery.

Immutable events must never be deleted to repair a drill.

## H0-6 — Security and performance

Required:

- authenticated load/concurrency evidence;
- independent deployed-build penetration/security assessment;
- Critical/High remediation and retest;
- external alert route delivery/acknowledgement.

Repository penetration tests remain mandatory but are not independent assessment evidence.

## H0-7 — Controlled pilot

Begin only after H0-1 through H0-6 are green and institutional approval is signed.

The first live scope remains controlled and explicitly approved. External integrations remain disabled unless separately qualified.

## Evidence manifest

Put qualification evidence under:

`artifacts/hospital0-qualification`

Generate the manifest with:

`bun run ops:hospital0:qualification`

To make incomplete evidence fail the command:

`GHIMS_HOSPITAL0_REQUIRE_COMPLETE=true bun run ops:hospital0:qualification`

The manifest intentionally refuses to infer missing human/external evidence.
