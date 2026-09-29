# G-HIMS P6 Offline-First Qualification

Use only synthetic/non-production patient data for engineering qualification.

## Device qualification

1. Login online and wait for `/api/offline/bootstrap` to hydrate authorized edge data.
2. Confirm `ghims_clinical_dexie_db.edge_entities` is populated with encrypted envelopes and the mutation outbox is initially empty.
3. Physically disable network access and refresh `/`. The PHI-free app shell must load and authorized local read models must render from IndexedDB.
4. Register one synthetic patient offline. Confirm temporary `local-patient-*`, `local-encounter-*`, and `local-opd-*` identities and one pending registration command.
5. Record vitals, a signed note, a diagnostic order, and one permitted OPD transition using the local identities.
6. Close and reopen the browser while still offline. The pending encrypted outbox and local patient must remain available.
7. For an authorized inpatient/SCM test user, queue one permitted bed operation and one stock transaction/requisition. Both must use the same clinical edge outbox.
8. Restore network access. Observe `POST /api/sync/batch` and confirm registration is reconciled before dependent commands.
9. Confirm local IDs are mapped to canonical server IDs and the authoritative snapshot re-hydrates automatically.
10. Confirm accepted commands disappear from the outbox and no duplicate patient/order/note/stock movement is created if replay is retried.

## Conflict qualification

Hydrate the same mutable entity on two test workstations. Disconnect workstation A, change the authoritative entity from B, then create a conflicting state command from A and reconnect.

Expected: stale/concurrent mutable state becomes `requires_review`; SAFE_APPEND events still pass normal server validation; the browser never performs generic LWW or client overwrite.

## Actor/session isolation

Queue a command as User A, sign out, then sign in as User B on the same workstation. User B must not be able to replay User A's command. Re-authentication as User A may resume owned work only while the applicable session/device policy permits it.

## Storage and privacy checks

- G-HIMS requests persistent browser storage and records quota estimates.
- Quota pruning may remove only configured non-critical historical edge cache.
- Pending mutations, entity mappings, core patient/encounter state, current beds/queues/orders and active inventory state are never quota-pruned.
- Clinical mutation payloads, hydrated edge entities, and conflict records are AES-GCM encrypted at rest.
- Logout purges PHI-bearing read models while preserving actor-bound encrypted pending commands needed for later safe replay.
- Clinical/deep-link HTML is not cached; only the PHI-free `/` and `/login` application shells may be cached for offline restart.

## Pass criteria

A device is offline-qualified only when the physical network-loss journey passes, the outbox survives browser restart, canonical ID remapping succeeds, replay remains idempotent, conflicts fail closed to review, local PHI is encrypted at rest, and the complete P0-P6 CI matrix is green.
