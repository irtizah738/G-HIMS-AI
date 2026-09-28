# G-HIMS Disaster Recovery Runbook

## Status boundary

This runbook defines operational targets and recovery procedures. It does **not** claim that a hospital production recovery exercise has been completed.

## Recovery objectives

- **Target RPO:** <= 1 hour for authoritative clinical, financial, security, and event data.
- **Target RTO:** <= 4 hours for restoration of core registration, encounter, orders, pharmacy-lite, billing, authentication, and audit services.
- These are engineering targets until a timed institutional recovery exercise demonstrates them.

## Backup policy

1. Production and staging use separate Firebase/GCP projects and separate backup buckets.
2. Schedule Firestore exports at a cadence that can meet the RPO target.
3. Keep backup bucket write authority separate from ordinary application service credentials.
4. Apply retention/lifecycle policy at the bucket/infrastructure layer; repository code does not claim that retention is active.
5. Record export job ID, source project, database ID, destination URI, start/end time, result, and operator/service identity in the operations log.

Manual/automated command entrypoint:

`bun run ops:backup`

Required variables:
- `GHIMS_RUNTIME_MODE`
- `FIREBASE_PROJECT_ID`
- `GHIMS_FIREBASE_PROJECT_ID_<MODE>`
- `GHIMS_BACKUP_BUCKET`
- optional `FIRESTORE_DATABASE_ID`

Use `GHIMS_BACKUP_DRY_RUN=true` to verify targeting without invoking gcloud.

## Restore procedure

1. Declare incident and freeze authoritative writes.
2. Confirm the target environment and project ID.
3. Identify the last known-good export and verify its source project/database metadata.
4. Restore into a non-production recovery project first whenever the incident allows.
5. Run integrity checks before reopening writes:
   - tenant isolation/security rules
   - patient/encounter counts
   - event/audit/outbox referential checks
   - journal debit/credit balance
   - idempotency and outbox processing checks
6. For a production import, require explicit project confirmation and production-restore override.
7. Re-enable traffic in stages and monitor authorization failures, outbox lag, sync conflicts, and reconciliation findings.
8. Record actual RPO/RTO from the exercise or incident.

Restore entrypoint:

`bun run ops:restore`

Production restore additionally requires:
- `GHIMS_RESTORE_CONFIRM_PROJECT=<exact project id>`
- `GHIMS_ALLOW_PRODUCTION_RESTORE=true`

## Required exercises

At minimum, run and record:
- quarterly restore into an isolated recovery project;
- annual timed clinical continuity exercise with hospital operations;
- recovery after an intentionally incomplete/offline command replay;
- recovery validation for financial journal integrity.

Until those exercises exist, documentation must say **target RPO/RTO**, never “verified RPO/RTO”.
