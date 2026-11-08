# G2 — encrypted synthetic cold-readback / restore quarantine (no billing)

**Scope:** Stage F / detached certificate source engineering only. This is a cold **file read-back** and verified in-memory quarantine, NOT restoration of a Firestore database, independent WORM backup, production disaster recovery, or reactivation of FHIR polling.

## Architectural trust boundary

This capability is intentionally stacked on the Stage F validated multi-page evidence and the separate, PHI-free, keyed inventory from PR #280:

1. Read the complete Stage F evidence inside one bounded Firestore emulator transaction. Stage F verifies exact source/manifest revisions, checkpoint sequence, source authority, event/audit/HELD outbox links, verified patient links, **current consent at the time of capture**, and the detached anchor. Capture is opt-in (`captureValidatedEvidenceForBackup: true`) and **only returns evidence to memory in TEST**.
2. Verify its detached HMAC certificate with an independently retained synthetic test key. The archive encryptor never signs unvalidated evidence and requires the separately held Stage F HMAC authority.
3. Encrypt the full evidence object with **AES-256-GCM** using a 32-byte local test key and a cryptographically random 96-bit nonce. The envelope's exact v1 header (archive UUID, synthetic tenant/facility/source IDs, anchor and detached certificate fingerprints) is authenticated as GCM additional authenticated data. The encrypted payload contains resource receipts, source metadata, manifest content and clinical records; **plaintext must never be persisted or logged**.
4. Write the single encrypted envelope to a local directory using `O_EXCL|O_NOFOLLOW` with mode `0600`, then `fsync`; partial/truncated files fail closed on read. The test fixture uses an isolated OS temporary directory, not a hospital filesystem.
5. In a separate readback session, require an **out-of-band latest archive SHA-256 fingerprint**, expected archive ID/tenant/source/facility, externally retained detached HMAC certificate and original HMAC signers, plus the local AES key. Verify the head before decrypting, then GCM tag, exact JSON payload shape, scope, Stage F original anchor, full Stage F facts and complete detached certificate.
6. Return `QUARANTINED_REQUIRES_FRESH_ANCHOR`, `sourceDispatchAllowed=false`, `clinicalAuthority=false`, and `productionRelease=NO_GO`, even when every byte matches. No Firestore write, source activation, FHIR HTTP call, checkpoint advance, patient projection, outbox dispatch, or token use is permitted by this API.

**Important:** A snapshot's previously granted consent does not establish present consent. Any future physical restore to a new Firestore database changes document `updateTime` and invalidates the old Stage F anchor. A fresh source generation, independent signed anchor, checked current patient link/consent, independently authorized site approval and clinical/security signoffs would be required before any active workflow. None of those authority-granting operations is implemented here.

## File format

`G2SyntheticColdBackup`: v1, strict fields `schemaVersion`, `kind`, `suite`, `archiveId`, `tenantId`, `sourceId`, `facilityId`, `stageFAnchorFingerprint`, `detachedCertificateFingerprint`, `nonceHex`, `tagHex` and `ciphertextBase64`.

Synthetic IDs and cryptographic fingerprints in the **header are unencrypted metadata**. This format MUST NOT be used for real PHI or real identifiers; a production design needs encrypted/obfuscated metadata, envelope-key wrapping, audited KMS/HSM, encrypted storage and independently governed WORM retention. Maximum plaintext 12 MB, file 18 MB; larger inputs fail closed. The detached certificate contains only ordinal slot tags, not plaintext clinical fields; its key and this archive's key must be retained separately from the archive and Firestore.

The offline latest-head fingerprint is meaningful only if its custody is independent and its freshness is established. The system does **not** have a trusted monotonic witness or authenticated real-world backup origin. A malicious actor controlling both the archive and its supposed external head can replay both; do not claim tamper-proof or anti-rollback production DR.

## APIs

`rehearseSyntheticMultiPageRecovery({..., captureValidatedEvidenceForBackup: true, detachedRestore: {signer}})` returns synthetic `validatedEvidenceForBackup` for immediate encryption in memory. The default response is unchanged.

`encryptVerifiedSyntheticG2Evidence` requires a verified Stage F signer, detached signer/certificate, AES-256-GCM key, unique archive UUID and validated Stage F evidence.

`writeSyntheticColdBackupFile` writes an exclusive `.g2-test.enc.json` file. `readSyntheticColdBackupFile` parses its bounded encrypted JSON without decrypting it.

`coldReadbackVerifiedSyntheticG2Evidence` requires independently retained latest fingerprint, correct scope, original Stage F and detached certificate trust material, and AES key. Its output is a **quarantined in-memory record** only.

All calls enforce `NODE_ENV=test`, `GHIMS_RUNTIME_MODE=TEST`, `FIREBASE_PROJECT_ID=ghims-p4-ci`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, and disabled external FHIR integration. There is no new Firestore schema, index, security rule, privileged CI secret or GCP resource.

## Fail-closed emulator qualification

- Valid two-page/four-resource evidence can be encrypted to disk and read back, and its ciphertext excludes synthetic patient IDs, FHIR JSON and vendor cursors.
- Altered ciphertext fails GCM authentication even if the attacker supplies a *new* archive fingerprint; wrong encryption key fails authentication.
- Replaying an older archive with a separately retained newer fingerprint is rejected.
- Wrong tenant/source/facility or substituted detached cert fails before decrypting.
- Unknown envelope fields or invalid nonce shape cannot be smuggled into the trusted archive header.
- Existing file cannot be overwritten; partial/truncated file read fails.
- Withdrawal of live patient consent after capture cannot authorize clinical recovery; old snapshot readback is still quarantined.
- PRODUCTION runtime rejects the operation unconditionally.
- Existing Stage F transaction/audit/HELD outbox data and patient360 remain unchanged by backup or readback.

## Explicit exit criteria not achieved

This is **not** an isolated physical Firestore restore test, cross-project recovery, independent KMS, quorum signoff, formal patient reconsent, clinical projection qualification, source authority issuance, real vendor/OAuth provenance or a safe production failover. These are subsequent, separate gates.

**Qualification:** `G2_COLD_READBACK=LOCAL_ONLY`. **G1_HOSTED=NO_GO**. **G2_HOSTED=NO_GO**. **PRODUCTION_RELEASE=NO_GO**.
