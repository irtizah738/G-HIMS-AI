# CI-EXT-13 — Actual-Workload Egress Inventory + Encrypted FHIR Poll Manifests

**State:** Engineering qualification candidate. Synthetic Firestore test only.  
**Production external FHIR: NO-GO (R24 and release issue #266 unchanged).**  
**Source:** `G-HIMS-AI` / `main` after merged CI-EXT-12 PR #267.  
**Environment:** `studio-1130431360-48a05` synthetic-only staging; no new cloud resources.

## G1 — Read-only actual Cloud Run workload inspection

A new guarded script, `scripts/ops/ci-ext13-cloud-run-egress-readonly.sh`,
reads the **existing** Cloud Run sealed worker, declared VPC/subnet, configured
route inventory, classic VPC firewall and effective hierarchical/firewall
policy output. It **does not** deploy, enable worker instances, invoke an
endpoint, use secrets, start a VM, create a route, activate firewall rules,
or emit a TCP request. The script drops temporary raw Cloud CLI responses
after emitting a sanitized inventory (no environment secrets).

Use only from a trusted GCP operator terminal whose current gcloud project
has already been verified, and with an operator approved to view that staging
project. All commands are explicitly read-only:

```bash
export GHIMS_RUNTIME_MODE=STAGING
export HELIXIS_CI_EXT13_CONFIRM_PROJECT=studio-1130431360-48a05
export GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=false
export GHIMS_INTEGRATION_FHIR_R4_STATE=DISABLED
gcloud config set project studio-1130431360-48a05  # optional, outside the script; alters local CLI config only
bash scripts/ops/ci-ext13-cloud-run-egress-readonly.sh
```

To avoid any local gcloud configuration change, run the following before
executing the script:

```bash
gcloud config get-value project
```

The active project must *already* be `studio-1130431360-48a05`. Do not
run `gcloud config set` unless the operator explicitly chooses to change
their local CLI configuration.

Expected output includes a structured
`helixis.ci-ext13.cloud-run-readonly.v1` assessment with the current
source service account, `all-traffic` Direct VPC/subnet observations,
sealed runtime flags, deny-all inventory flag, and route categories.

Even a completely matching inventory yields
`productionRelease:NO_GO`,
`swpServiceAccountMatcherProven:false`,
`directInternetBypassPreventionProven:false`, and
`actualCloudRunPacketsTested:false`. This is intentional: topology
inspection is **not** evidence of SWP workload identity matching.

Google Cloud source identity documentation explicitly lists service accounts
as supported for Direct VPC Cloud Run, not secure tags. R24's earlier
identity-matcher failure came from a GCE VM next-hop SWP lab; a future,
independently approved **actual Cloud Run source-account proof** would be a
different experiment, but must not reopen or mutate that old lab.

Sources:
- https://docs.cloud.google.com/secure-web-proxy/docs/create-a-policy
- https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
- https://docs.cloud.google.com/secure-web-proxy/docs/configure-rules

### G1 next decisions (NOT executed here)

1. Receive/analyze sanitized current Cloud Run inventory from the operator.
2. Confirm which network/subnet and next-hop routing mode applies to a
   *separately isolated* Cloud Run qualification workload; avoid mixing
   `helixis-epic-egress` and the old `helixis-ci-gateway-net`.
3. Choose a disposable, explicitly approved no-PHI workload with dedicated
   service account, `all-traffic` Direct VPC, approved route and gateway.
4. Test service-account-only source matcher **positive and negative**, exact
   `fhir.epic.com:443` and wrong SNI, wrong service account, unexpected host,
   public direct bypass, route loss, proxy down, UDP 443/QUIC, DNS rebinding,
   redirect, credential confusion. Preserve externally verifiable evidence.
5. If the identity matcher is not demonstrated, **stop** and pursue the
   independently mTLS-authenticated private broker from ADR CI-EXT-08.
6. No production GO until separately reviewed and signed G1 and G7/G8.

## G2 — Encrypted persistent work manifests

`lib/clinical/intelligence/external-fhir-encrypted-poll-manifest.ts`
adds a durable Firestore manifest **envelope contract** and an
emulator-only bridge into CI-EXT-12's existing fenced polling runner.

### Firestore paths and isolation

All paths are `/tenants/{tenantId}/`:

| Collection | ID | Persistence and authority |
| --- | --- | --- |
| `fhirPollManifests` | `{manifestUuid}` | Immutable AES-256-GCM ciphertext, KMS envelope identity, source/facility, manifest digest, work count, starting checkpoint |
| `fhirPollManifestHeads` | `{sourceId}` | Mutable derived active manifest pointer; single source writer/replacement fence |
| `fhirPollManifestEvents` | `fpm_{manifestUuid}` | Immutable manifest sealed evidence, no clinical payload |
| `fhirPollManifestOutbox` | `fpo_fpm_{manifestUuid}` | HELD, not dispatched or promoted |
| `auditLogs` | `fau_fpm_{manifestUuid}` | Immutable server actor, timestamp and non-clinical digest |

Browser reads and writes to all four new collections are explicitly denied.
The Firestore Admin SDK bypasses Security Rules; use a dedicated runtime
service account with least-privilege IAM, no browser-issued actor authority.

**No composite indexes:** deterministic tenant-scoped document IDs only.

The plaintext schema remains the bounded CI-EXT-12 work plan
(`manifestId,sourceId,startCheckpointSequence,items[]` with UUID work IDs
and exact source resource/version references). Every resource ID and
`expectedVersionId` stays inside AES-GCM ciphertext, not metadata,
outbox, audit log or GitHub artifacts. The plaintext hash is domain separated
and bound to a random manifest UUID.

The authenticated encryption AAD binds
`(tenantId,sourceId,manifestId,startCheckpointSequence)`. The ciphertext,
tag, IV, wrapped DEK and KMS crypto-key-version reference are validated
before storage. A `CLOUD_KMS_ENVELOPE_V1` provider must implement real
per-manifest DEK creation, wrapping, authorization and KMS auditability.
**This PR does not implement or deploy the Cloud KMS provider.** It never
stores plaintext keys. The synthetic cipher is permitted **only** when
`GHIMS_RUNTIME_MODE=TEST`, `FIREBASE_PROJECT_ID=ghims-p4-ci`,
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and live flags are disabled.

### Transaction sequence

```text
server-authorized FHIR_IMPORT + FHIR_POLL_COORDINATE
  -> validate bounded manifest + source/tenant scope
  -> encrypt outside Firestore transaction (KMS is external I/O)
  -> transaction:
       ACTIVE + APPROVED + FENCED source; facility permission
       SMART source site approvals verified if credentialed
       source checkpoint sequence exactly matches new manifest start
       prior active manifest must be COMPLETED
       immutable manifest + event + audit + HELD outbox
       derived active manifest head
  -> later authorized worker reads manifest head + source approvals
  -> decrypt outside transaction, verify digest, scope and item count
  -> isolated CI-EXT-12 synthetic runner acquires lease, reserves
     operation sequence, imports and checks availability before checkpoint
```

Replaying the same manifest UUID/content is idempotent. Reusing that ID with
different work items fails. A second manifest cannot replace uncheckpointed
work, and the reader denies superseded manifests. A source suspension, grant
revocation, facility mismatch, tampered ciphertext or incorrect encryption
provider forces a fail-closed response.

### Qualification and remaining G2 work

- Pure source-inventory tests:
  `tests/ci-ext13-cloud-run-egress-readonly.test.mjs`.
- Isolated Firestore tests:
  `emulator-security/helixis-fhir-encrypted-poll-manifest.test.ts`.
- CI workflow:
  `.github/workflows/helixis-external-fhir-r4.yml`.

**Not implemented or qualified:** real Cloud KMS envelope client, hospital
source poll worker, encrypted vendor pagination cursors, Cloud Run secrets
and WIF, actual FHIR HTTP fetch under egress identity, durable work queue
and poison-message handling, large paginated backfills, KMS rotation,
real RPO/RTO restore, traffic cost bounds, clinical/tenant site approval.

**Important operational constraint:** Do NOT change any existing source to
`syncMode:FENCED` just because this code is merged. The current Next.js
one-off FHIR route does not acquire a poll lease. Until a separately
qualified poll worker exists, enabling FENCED causes that route to
fail closed (which is safer than allowing bypass).
