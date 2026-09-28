# G-HIMS Disaster Recovery & Restore Runbook

**Status:** Operational procedure; **not evidence that recovery objectives have been achieved**.

## Scope

This runbook covers Firestore export, isolated restore validation, rollback decision-making, and evidence capture for a G-HIMS deployment. A production-readiness declaration requires a successful restore drill within the last 90 days.

## Required configuration

- `GHIMS_RUNTIME_MODE=STAGING|PRODUCTION`
- `FIREBASE_PROJECT_ID`
- `GHIMS_BACKUP_PROJECT_ID` — must equal the deployed Firestore project.
- `GHIMS_BACKUP_BUCKET` — dedicated, access-controlled Google Cloud Storage bucket.
- `GHIMS_BACKUP_RETENTION_DAYS`
- `GHIMS_RPO_TARGET_MINUTES` — target only; do not report as achieved without measured evidence.
- `GHIMS_RTO_TARGET_MINUTES` — target only; do not report as achieved without measured evidence.
- `GHIMS_LAST_RESTORE_DRILL_AT` — timestamp of the last successful measured drill.

## Scheduled backup

Use a service identity with only the permissions required for Firestore managed export and the destination bucket.

```bash
PROJECT_ID="$FIREBASE_PROJECT_ID"
BUCKET="$GHIMS_BACKUP_BUCKET"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

gcloud firestore export "gs://$BUCKET/firestore/$STAMP" \
  --project="$PROJECT_ID" \
  --async
```

Capture the operation identifier, export URI, start/end timestamps, object generation metadata, and service identity in the change/evidence record.

## Restore drill — never restore over production

1. Provision an isolated restore-validation project/database with no production traffic.
2. Record the drill start timestamp.
3. Import a selected successful export into the isolated environment:

```bash
RESTORE_PROJECT="<isolated-restore-project>"
EXPORT_URI="gs://<backup-bucket>/firestore/<timestamp>"

gcloud firestore import "$EXPORT_URI" \
  --project="$RESTORE_PROJECT" \
  --async
```

4. Validate:
   - tenant document counts and representative tenant isolation;
   - immutable event/audit/outbox collections are present;
   - patient/encounter/financial projections can be rebuilt or reconciled;
   - no application points at the restore project as production;
   - checksums/object generations and operation logs are retained.
5. Record measured elapsed restore time. Compare it to the **target** RTO; do not claim the target was met without this measurement.
6. Determine the newest successfully restored record/export time. Compare measured data loss exposure to the **target** RPO.
7. Destroy or quarantine restored PHI according to the approved data-handling procedure.

## Failure handling

A failed export, incomplete import, missing tenant collections, reconciliation failure, or stale restore drill is a production blocker. Do not compensate by changing the evidence timestamp or relaxing the readiness check.

## Required drill evidence

- change/ticket ID;
- source project/database ID;
- export URI and generation metadata;
- isolated restore project/database ID;
- start/end timestamps;
- measured restore duration;
- measured recovery point;
- reconciliation results;
- operator and reviewer identities;
- cleanup confirmation;
- explicit PASS/FAIL with defects.

No document in this repository should claim an achieved RPO, RTO, backup success rate, or disaster-recovery certification without that external evidence.
