# G2 detached multi-page restore inventory — local proof only

**Security classification:** offline TEST/emulator-only, no Google Cloud billing, hosted FHIR, real hospital data, or production authorization. The certificate is not itself a backup, external witness, immutable storage system, clinical validation, or a restore command.

## Problem and architecture

Stage F already requires a detached HMAC anchor and fully validates the bounded multi-page checkpoint sequence, manifest generations, resource receipts, resource hashes, patient links, consent, immutable events, and HELD outboxes. That protects the core clinical chain but may not notice unrelated changes to additional audit document fields. A legitimate offline backup also needs to detect accidental omission or byte-level alteration of records across a restore.

New `EmulatorOnlyG2DetachedRestoreSigner` creates a **PHI-free, keyed per-record inventory** only after complete Stage F validation of transactionally reread Firestore evidence. The inventory includes HMACs of the canonicalized full source/lease records, each decrypted/sealed manifest and its event/audit/HELD outbox, every checkpoint/reservation/import/clinical receipt/availability/head/patient link/patient record, abandoned reservations and the two synthetic reviewer records.

The manifest has no plaintext record content, resource IDs, patient IDs, source ID, tenant ID, vendor cursor or raw SHA-256 of low-entropy patient data. Instead it contains ordinal slot labels, HMAC-SHA256 tags and a distinct HMAC for the complete signed certificate. Slots, cardinality and ordering are fixed; duplicates and invalid certificate structure are rejected. The synthetic HMAC key is exactly 32 bytes and must be independently retained by the test custodian.

The Stage F rehearsal returns a certificate as `detachedRestoreCertificate` **only when explicitly requested**, and stores only `detachedRestoreFingerprint` and `LOCAL_DATA_INTEGRITY_ONLY` in its own immutable HELD audit evidence. A subsequent rehearsal supplied with the original certificate recomputes all keyed record tags and rejects any mismatch before a new database write. The certificate fingerprint is included in the rehearsal's idempotency fingerprint: replay cannot silently downgrade to the older no-inventory flow.

## Safety boundaries

- All functions require `NODE_ENV=test`, `GHIMS_RUNTIME_MODE=TEST`, `FIREBASE_PROJECT_ID=ghims-p4-ci`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, and disabled external FHIR import/integration.
- Maximum 3 pages, 12 Stage F steps, 256 inventory slots, 512 KB per JSON slot, and 12 MB total canonical evidence bytes. Larger or malformed inputs fail closed rather than silently truncating.
- Keyed HMACs mitigate offline guessing of small clinical fields. Store the certificate and key in a **separate, access-controlled external medium**; placing both in the restored Firestore database provides no independent integrity.
- The proof is over **data fields**, not Firestore's physical storage identity or server-signed transaction snapshots. Stage F *separately* enforces exact source/manifest updateTime revisions. Rewriting a byte-identical manifest under a new Firestore updateTime must fail the old Stage F anchor: an independently authorized **new** anchor is required.
- A successful inventory match means only local payload preservation relative to the test certificate. It does NOT authorize reimport, resume, delete, reconcile to Patient 360, publish, change consent, or claim clinical safety.
- There is **no external trusted monotonic clock or witness** for this certificate. A backup rollback accompanied by replay of an old retained certificate cannot be ruled out by the HMAC alone. G1 fail-closed egress, G2 hosted identity/KMS, authentic vendor signatures, independently retained backups and full DR remain unqualified.
- Every returned certificate is a sensitive governance artifact even though it excludes plaintext clinical data. Do not commit actual certificates, test keys or backups into GitHub.

## Firestore schema / indexes

No new Firestore collections, writes, indexes or client permissions. Stage F continues to write only its existing immutable `fhirPollMultiRecoveryRehearsals`, `fhirPollMultiRecoveryEvents`, `auditLogs` and HELD `fhirPollMultiRecoveryOutbox` documents. They gain optional, non-PHI:

```ts
detachedRestoreFingerprint?: string; // SHA-256 of the HMAC certificate
detachedRestoreQualification?: 'LOCAL_DATA_INTEGRITY_ONLY';
```

No projection or checkpoint writes occur. Browser reads/writes to the new state are not introduced.

## Emulator acceptance tests

1. Successful Stage F rehearsal can return a bounded detached certificate without PHI or a vendor cursor, and its HELD record contains only a fingerprint.
2. Same certificate verifies in a replay, while dropping the certificate on an identical rehearsal ID is a replay conflict.
3. An added unrecognized field in an otherwise Stage F-valid checkpoint audit document is rejected by the independent inventory.
4. A modified clinical receipt is rejected by Stage F even if a detached certificate exists.
5. Edited certificate tags or a different signing key fail HMAC verification; no additional rehearsal record is committed.
6. Delete and recreate a byte-identical sealed manifest: the old anchor fails on its changed Firestore updateTime.
7. Production-mode invocation fails at the emulator guard.

## Follow-on deployment engineering

A future **separate** design must actually encrypt, export, retain and restore a bounded set of PHI-bearing backup documents in an independently administered repository; verify a trusted monotonic witness/root and independently signed backup origin; reauthorize new Firestore revisions and consent; and run a full cold-restore qualification in a different isolated environment. None of those operations are implemented here.

**G2_DETACHED_RESTORE=LOCAL_QUALIFICATION_CANDIDATE**; **G1_HOSTED=NO_GO**; **G2_HOSTED=NO_GO**; **PRODUCTION_RELEASE=NO_GO**.

**Repository governance:** At the initial check on 2026-11-09 the active `main` ruleset had enabled stale dismissal, latest-push approval and code-owner review but still had `required_approving_review_count=0`; G3–G8 jobs were not mandatory. These must be resolved independently of source CI. 
