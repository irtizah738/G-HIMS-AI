# G-HIMS Projection Recovery Rehearsal

## Safety boundary

Projection rebuild is a **destructive read-model operation**. It is intentionally forbidden in `PRODUCTION`.

The supported recovery pattern is:

1. restore authoritative data into an isolated TEST/STAGING recovery project;
2. verify project/environment isolation;
3. confirm the exact tenant to rebuild;
4. run deterministic projection rebuild;
5. compare the event-stream and projection fingerprints across repeated runs;
6. verify event/checkpoint cardinality and domain invariants;
7. only then continue the disaster-recovery promotion procedure.

Do not rebuild live production projections in place.

## Command

```bash
GHIMS_RUNTIME_MODE=STAGING \
FIREBASE_PROJECT_ID=<isolated-recovery-project> \
GHIMS_FIREBASE_PROJECT_ID_STAGING=<isolated-recovery-project> \
GHIMS_PROJECTION_REBUILD_TENANT=<tenant-id> \
GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT=<tenant-id> \
GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD=true \
bun run ops:projection-rebuild
```

The two tenant variables must match exactly. The command refuses production runtime even when the destructive flag is enabled.

## Preconditions

- The recovery project contains a restored authoritative tenant event stream.
- The project is isolated from hospital production traffic.
- External integrations remain disabled unless separately validated.
- The target tenant is explicitly confirmed.
- A backup/export identifier and restore operation identifier are already recorded.

## Validation performed

The recovery service:

- loads the authoritative tenant event stream from `tenants/{tenantId}/events`;
- rejects an empty stream;
- rejects duplicate event IDs;
- rejects cross-tenant input;
- rebuilds only disposable projections;
- requires one durable projection checkpoint per authoritative event;
- records event-type counts;
- records SHA-256 fingerprints of the normalized event stream and rebuilt projections;
- stores a PHI-free recovery-run manifest in `projectionRecoveryRuns`.

Repeated rebuilds of the same authoritative stream should produce the same event-stream and projection fingerprints. In other words, identical authoritative input must yield the same projection fingerprint. A mismatch is a release/recovery blocker.

## What is not rebuilt

Authoritative patient, encounter, order, prescription, financial journal, audit, idempotency and event records are not replaced by this operation.

## Failure handling

If validation fails, keep the recovery project isolated and do not promote it. Investigate the first failing invariant. Never resolve a failed rehearsal by deleting authoritative events, changing the expected tenant, or running the destructive operation directly against production.

## Evidence

For each rehearsal retain:

- recovery project ID;
- source backup/export identifier;
- tenant ID;
- recovery-run ID;
- event count and checkpoint count;
- event-type counts;
- event-stream SHA-256;
- projection SHA-256;
- start/end timestamps and duration;
- CI/run/ticket reference;
- operator and reviewer;
- PASS/FAIL and defect references.

Repository tests demonstrate the rebuild mechanics in an emulator. They do not constitute a measured hospital RPO/RTO exercise.


## Wave 5 failure-injection rehearsal

Failure injection is supported only in an explicitly confirmed TEST/STAGING recovery environment. Production remains blocked by the same recovery service guard.

After restoring an isolated project, run:

```bash
GHIMS_RUNTIME_MODE=STAGING \
GHIMS_PROJECTION_REBUILD_TENANT=<tenant-id> \
GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT=<tenant-id> \
GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD=true \
bun run ops:wave5:projection-failure-injection
```

The drill intentionally fails after projection-worker execution and must create a FAILED recovery manifest with error code `PROJECTION_REBUILD_INJECTED_FAILURE`.

After the injected failure, run a normal clean `bun run ops:projection-rebuild` against the same isolated authoritative event stream. Deterministic event/projection fingerprints and cardinality checks must pass before the recovery exercise can be accepted.
