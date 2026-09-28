# G-HIMS P5C — Controlled Pilot Readiness

## Status boundary

P5C is a controlled-pilot readiness gate. Repository tests may prove engineering controls, but they do not by themselves authorize a hospital go-live or establish regulatory, security, or clinical approval.

## Code gates

The P5C branch must not merge unless all of the following remain green:

- TypeScript typecheck and lint;
- P5C pilot-readiness guards;
- full unit/domain regression;
- P0-P3 security regression;
- Firestore tenant, durability, and least-privilege emulator suites;
- Firebase Auth/IAM emulator suite;
- P4 synthetic patient + recovery journey;
- production build;
- deployment fail-closed Playwright smoke.

## P5C security closure

Before controlled pilot use:

1. Firestore reads must re-check an ACTIVE authoritative tenant membership.
2. Tenant membership alone must not grant unrestricted read access across clinical, financial, workforce, and audit data.
3. Patient identities must not receive tenant-wide clinical read authority.
4. Inactive memberships must not receive refreshed Firebase tenant claims or new G-HIMS sessions.
5. Registration retries must use a caller-supplied stable idempotency key.

## Operational evidence required before Hospital-0

### STAGING-01 — Current-main deployment proof

Deploy the exact approved P5C/main commit to dedicated STAGING and run:

`GHIMS_STAGING_BASE_URL=https://<staging-host> bun run ops:staging-smoke`

Retain deployment ID, Git commit SHA, readiness response, smoke output, operator, and timestamp.

A Vercel build-rate-limit or other platform quota failure is a blocker until a deployment of the approved commit reaches READY.

### DR-01 — Timed isolated restore drill

Use the existing backup/restore and projection-recovery runbooks.

Retain:
- source export ID and timestamp;
- isolated recovery project ID;
- restore operation ID;
- measured data-loss window;
- restore start/end time;
- projection recovery fingerprints;
- event/checkpoint cardinality;
- finance balance validation;
- PASS/FAIL and reviewer.

The documented RPO/RTO remain targets until this exercise proves them.

### OBS-01 — External alert delivery

Provision a real deployment-owned alert sink and on-call destination. Prove delivery for at least:

- readiness failure;
- backup failure;
- reconciliation financial imbalance;
- outbox backlog/failure;
- repeated authorization or tenant-isolation rejection;
- production integration attempt while integration state is not LIVE.

Retain delivery timestamp, destination, acknowledgement owner, and incident reference. Demo notification simulation is not acceptable evidence.

### ROLLBACK-01 — Deployment rollback rehearsal

Define the known-good deployment, release decision owner, rollback trigger, data compatibility boundary, and post-rollback integrity checks.

Rehearse rollback in STAGING and retain:

- bad/candidate deployment ID;
- rollback target deployment ID;
- start/end timestamps;
- readiness/smoke results after rollback;
- confirmation that authoritative event/audit/idempotency data remained intact;
- operator and reviewer.

Rollback must never mean deleting or rewriting authoritative clinical/financial events.

### DAY-01 — Hospital-day rehearsal

Run a seeded isolated environment with separate authenticated personas for at least:

- reception/registration;
- nurse/triage;
- doctor;
- billing;
- lab;
- pharmacy;
- administrator/auditor.

Exercise concurrent and interrupted workflows including:

- registration retry after simulated timeout;
- duplicate submission/replay;
- internet loss and reconnect;
- session expiry/user switch on shared workstation;
- order/billing handoff;
- outbox worker interruption;
- rejected unauthorized/cross-role reads;
- reconciliation after replay.

No Critical/High safety, authorization, tenant-isolation, durability, reconciliation, or data-loss defect may remain open.

### SEC-EXT-01 — Independent security assessment

Repository security tests are regression controls, not an independent penetration assessment. Retain the external assessment and remediation evidence required by the production blocker register.

## Exit rule

P5C may be marked complete only when:

- all repository P5C checks are green on the exact candidate commit;
- STAGING-01, DR-01, OBS-01, ROLLBACK-01, and DAY-01 have PASS evidence;
- no unresolved Critical/High defect remains in safety, security, tenant isolation, identity, durability, recovery, reconciliation, or rollback;
- hospital governance has approved the controlled pilot scope.

External integrations that are not needed for the pilot must remain disabled.
