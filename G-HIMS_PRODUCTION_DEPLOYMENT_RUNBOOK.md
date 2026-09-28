# G-HIMS Production Deployment Runbook

**Status:** Release procedure. Deployment approval remains an institutional decision supported by evidence.

## Promotion order

`DEMO/TEST -> STAGING -> PRODUCTION`

Never point two environment classes at the same Firebase project. Staging and production must use explicit `GHIMS_RUNTIME_MODE` values and pass `/api/health/ready`.

## Pre-deployment gates

1. P0, P1, P2 and P3 regression suites pass.
2. Firestore emulator security-rule tests pass.
3. TypeScript validation and production build pass.
4. P3 environment-policy tests pass.
5. No production blocker is hidden by demo/simulation fallback.
6. Backup configuration is present and the most recent successful restore drill is <= 90 days old.
7. External integrations are activated only when their canonical integration state is `LIVE`.
8. Institutional security/privacy/compliance approvals required by the deployment are attached outside this repository.

## Environment separation

Production requires:
- explicit `GHIMS_RUNTIME_MODE=PRODUCTION`;
- explicit server and browser Firebase project IDs that match each other;
- no `FIRESTORE_EMULATOR_HOST`;
- a project ID not labeled dev/demo/test/sandbox/emulator/local;
- backup project matching the production Firestore project;
- configured alerting destination.

The readiness endpoint reports only control codes and does not disclose credentials, bucket names, project secrets, PHI, or connection strings.

## Deployment

Deploy the exact commit SHA that passed CI. Record:
- commit SHA;
- build/run IDs;
- target project and environment class;
- operator;
- start/end timestamps;
- migration/config changes;
- smoke-test evidence.

## Smoke tests

- `GET /api/health/live` returns 200.
- `GET /api/health/ready` returns 200 in the deployed production environment.
- authenticated tenant isolation and session validation work;
- one non-PHI test command traverses command -> event -> audit -> outbox;
- alerting receives a controlled operational test event.

## Rollback

Rollback to the last known-good immutable deployment artifact/commit. Do not mutate production data backwards to match old code. If schema/event compatibility is uncertain, stop writes and follow the incident + recovery procedure.

## Evidence rule

A green repository build proves only the checks executed by CI. It does not prove HIPAA/GDPR/ISO certification, clinical validation, live-device certification, payer acceptance, disaster recovery performance, or hospital pilot approval.
