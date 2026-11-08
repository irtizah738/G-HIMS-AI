# Helixis — G3–G8 Stage G: Vendor cursor continuity and detached witness (LOCAL ONLY)

**Qualification scope:** `ghims-p4-ci` Firestore emulator, synthetic FHIR fixtures, no live HIS, no hosted services.  **Release:** `NO_GO`.  **Allowed result:** `STAGE_G_ONE_GO=PASS_LOCAL_ONLY`.

## Architecture and threat boundary

Stage F verifies every immutable FHIR import receipt, exact checkpoint, held outbox, audit, patient consent and two-/three-page manifest against a signed local recovery anchor. Stage G adds a **second, detached Ed25519 certificate** for the sequence of opaque pagination cursors. It binds:

1. `tenantId`, `sourceId`, `facilityId`, exact source snapshot revision and signed Stage F anchor fingerprint;
2. each sealed manifest ID, Firestore manifest revision, start/end checkpoint watermark and digest of every immutable reservation/checkpoint/receipt identifier in that page;
3. the page's **decrypted request cursor HMAC** and the **prior page's synthetic response next-cursor HMAC**;
4. a certificate issuer identity, monotonically increasing witness sequence, previous witness fingerprint, issuance time and short expiry.

The first request cursor MUST be `null`. Every subsequent request cursor MUST match the immediately preceding page's response next-cursor. The final response cursor MUST be `null` in this fully-completed, bounded qualification. Duplicate tokens, omitted pages, substituted scopes and broken successor links are denied. **Cursors are opaque data, never fetched or executed as URLs.** HMAC-SHA256 with a distinct 256-bit ephemeral secret prevents exposing even low-entropy cursor tokens through bare SHA hashes. The manifest payload continues to use Stage C AES-GCM for encryption.

The Ed25519 **issuer private key** is used by a separate synthetic signing step and is never written to Firestore. The Firestore rehearsal writer holds only the public verifier. A local append-only NDJSON witness log, outside the repository and Firestore emulator, holds signed certificates. The writer requires the log's current witnessed certificate fingerprint and sequence. Lost/corrupted/old log heads fail closed. The log is fsync'ed and checked after append.

**Limits:** The filesystem witness is a *simulated separate trust domain*, not an immutable/WORM/cloud-hardware anchor: a privileged adversary could roll back both a local log and its filesystem metadata, and concurrent writers on a compromised OS could bypass it. There is no hosted key separation, independent time authority, vendor-signed pagination response, trusted vendor cursor origin, KMS/HSM, network egress, backup restore or physical DR qualification. No new production capability is authorized.

## Firestore transaction and data model

Existing Stage F collection and source rules are reused—no new Firestore collection or index is needed. Direct document IDs are used; no query or composite index is introduced.

`tenants/{tenantId}/fhirPollMultiRecoveryRehearsals/{rehearsalId}` receives only:

```json
{
  "status": "RECORDED_REHEARSAL_ONLY",
  "productionAuthorization": "NO_GO",
  "clinicalAuthority": false,
  "immutable": true,
  "vendorCursorWitnessFingerprint": "sha256-hex-of-detached-certificate",
  "vendorCursorWitnessSequence": 1,
  "vendorCursorQualification": "LOCAL_SYNTHETIC_WITNESS_ONLY"
}
```

The identical metadata is appended to `fhirPollMultiRecoveryEvents/{eventId}`, `auditLogs/{auditId}` and `fhirPollMultiRecoveryOutbox/{outboxId}` (`status: HELD`). The previous source/lease/clinical/manifest writes are unchanged. A conflicting replay on the same rehearsal ID fails; exact replay remains idempotent. A Stage G proof cannot be downgraded to a Stage F-only replay under the same ID.

Existing `firestore.rules` explicitly denies client read/write to the three Stage F recovery evidence collections. The server-only witness file is **not** accessible through Firestore or the UI. Do not expose issuer private keys, token strings or detached ledger paths in client bundles or operational logs.

**Transaction ordering:** The Stage F writer loads source, lease, manifests, every audit/outbox/receipt/head/link/patient in the **same Firestore transaction**, validates Stage F, then reads the detached witness head and validates the Stage G Ed25519 certificate/manifest cursor HMAC chain. Only after both gates pass does it create the rehearsal/event/audit/HELD-outbox documents. Failure at any gate causes no partial Firestore evidence. This is **not** an atomic two-phase commit with the witness filesystem, which remains a qualification limitation.

## Test matrix

- Node local contract: 52 Stage G tests (signed continuity, token scope, altered manifest/checkpoint/receipt, cursor substitution/replay, expired certificate, issuer key mismatch, detached witness persistence/tampering/rollback and TEST-only gates).
- Firestore emulator: 14 added Stage G scenarios in the existing `helixis-fhir-multi-page-recovery` suite, covering verified witness persistence, concurrent/idempotent replay, rollback/downgrade rejection, incorrect synthetic vendor response, missing or forged witness file, expired certificate, consent withdrawal, source change, clinical receipt deletion, interruption and both first-/second-page crash takeovers.
- Existing Stage A–F contract, FHIR, interoperability, security and 10 emulator suites remain in the one-go runner.

Expected if all suites pass: **13 qualification groups; 479 tests including 69 emulator tests.** These are target numbers, not an assertion of Windows execution.

## Installation and Windows qualification

Extract the Stage G ZIP and run `apply-stage-g.ps1`. It verifies the repository remote/branch, Stage F files and Firestore deny, checks an embedded SHA-256 patch hash, and performs `git apply --check` before changing files. It cannot deploy or migrate sources; the complete qualification uses the same local synthetic project as Stage F. Do not modify `package.json` to silence Node's informational `MODULE_TYPELESS_PACKAGE_JSON` warning.

## Release gates remaining NO_GO

G1 secure web proxy egress / compute identity; G2 hosted polling; production KMS and real key custody; independent hosted or WORM recovery anchors; trusted time and replay-protected witness service; authentic FHIR vendor `next`/cursor response sourcing; network control-plane qualification; hospital-specific source migration and contracting approvals; clinical governance review; controlled production security/DR testing. Hospital-0 `RESOURCE` durable mapping and the legacy ephemeral-only security suite remain separately open.
