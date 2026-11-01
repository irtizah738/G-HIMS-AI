# CI-EXT-07 — Epic developer sandbox: source-specific key and disabled enrollment

**State: engineering candidate. Neither Secret Manager nor Firestore has been changed by this PR.** All commands below apply only to the verified synthetic STAGING project. Do not copy this credential to production, classify a patient record as real, or activate clinical imports.

## Architecture

```text
Epic developer sandbox (approved synthetic fixtures only)
         |
         | OAuth client_credentials; RS384; staging-only public JWKS
         v
Helixis staging integration worker (separate least-privilege identity)
         |
         +-- Secret Manager: exactly one tenant/source-specific private key
         |     no secrets in Firestore, Vercel env, logs, browser or Git
         |
         +-- /tenants/{tenantId}/fhirSources/{sourceId}
               starts SUSPENDED + securityReviewStatus=PENDING
               source approval + verified patient link required separately
```

The existing runtime broker derives the target secret from SHA-256 of `JSON.stringify([tenantId,sourceId])`. The previously created `helixis-epic-sandbox-rs384` is a **staging bootstrap key**, not that runtime source secret. The key-copy tool verifies the source public SPKI SHA-256 fingerprint against the Epic-registered JWKS key, then creates a new secret with the existing registered private key as **version 1**. It never logs private material and never re-generates keys. It refuses overwrite/collision rather than adding a new key version.

**Key reuse caveat:** This copy is suitable only for this single developer-sandbox source, after tenancy is fixed. The same private key must NOT be copied into multiple tenant/source secrets in production; each hospital must receive its own registered key and JWKS identity. Do not share the staging key across tenants.

## Operator prereqs (not yet verified)

- A **synthetic-only** tenant and an existing synthetic facility are identified, with reviewed IDs and a named integration operator. Do not use a production tenant or invent facility IDs.
- The Epic registered non-production client ID, staging-only JWKS `kid` and public fingerprint are unchanged and independently verified.
- `gcloud`, `node` and `openssl` installed in the operator Cloud Shell; authenticated account has scoped Secret Manager read/create rights in `studio-1130431360-48a05`.
- A dedicated, non-production **runtime** service account has been created and reviewed. Do not grant the Cloud Shell personal identity, a default Compute account, or the production runtime service account general project-wide secrets access.
- The PR containing `oauth.vendorProfile='EPIC_SANDBOX'` must be reviewed/merged before a source with this metadata can be activated. CI-EXT-07 itself does not provide or enable a runtime OAuth broker.
- Egress policy must be enforced by a separately controlled proxy, with no direct path around it. Application DNS/host checks alone are insufficient.

## Stage 0: identify an explicitly synthetic tenant and facility (read-only)

The GCP project carrying synthetic records does **not** prove each Firestore tenant/facility is marked synthetic-only. The provisioning command intentionally requires an existing tenant with `syntheticOnly: true` and a facility document with `tenantId` matching the tenant plus `syntheticOnly: true` or `sandbox: true`.

This metadata-only inspection uses Cloud Shell's existing `gcloud` identity. It requests only `tenantId`, `syntheticOnly`, `sandbox` and `status` fields, returns eligible **IDs and boolean statuses**, and never accesses clinical/patient collections.

```bash
git fetch origin
git checkout feat/ci-ext07-epic-secret-source-provisioning-20261101
git pull --ff-only origin feat/ci-ext07-epic-secret-source-provisioning-20261101

export GHIMS_RUNTIME_MODE=STAGING
export HELIXIS_CI_EXT07_CONFIRM_PROJECT=studio-1130431360-48a05
export HELIXIS_CI_EXT07_TENANT_ID='<existing-synthetic-tenant>'
gcloud config set project studio-1130431360-48a05
bun scripts/ops/ci-ext07-inspect-synthetic-tenant.ts
```

Proceed only if `CI_EXT07_TENANT_SYNTHETIC_ONLY=YES`, at least one `CI_EXT07_ELIGIBLE_FACILITY_ID` is reported, `CI_EXT07_FACILITY_SCAN_COMPLETE=YES`, and the operator independently verifies the selected tenant/facility ownership. No eligible IDs is an explicit **STOP**. Do not add a synthetic flag to a live hospital merely to pass this gate.

## Stage 1: read-only plan and public-key verification

With the exact eligible tenant/facility IDs verified, set these reviewed **non-secret** identifiers in Cloud Shell:

```bash
export GHIMS_RUNTIME_MODE=STAGING
export HELIXIS_CI_EXT07_CONFIRM_PROJECT=studio-1130431360-48a05
export HELIXIS_CI_EXT07_TENANT_ID='<existing-synthetic-tenant>'
export HELIXIS_CI_EXT07_SOURCE_ID='epic-sandbox'
export HELIXIS_CI_EXT07_FACILITY_ID='<existing-synthetic-facility>'
gcloud config set project studio-1130431360-48a05

bun scripts/ops/ci-ext07-print-epic-source-plan.ts
bash scripts/ops/ci-ext07-epic-key-copy.sh plan
```

Expected: a metadata-only source proposal showing `SUSPENDED`, `PENDING`, no site approval and no import activation; and shell output `SOURCE_PUBLIC_KEY_MATCH=PASS`, `PROVISIONING=PLAN_ONLY`. Do **not** publish or commit the generated plan as an active source.

## Stage 2: approval and strictly scoped secret copy

After validating the planned target secret path and registering the change approval:

```bash
export HELIXIS_CI_EXT07_CONFIRM_COPY=COPY_VERIFIED_EPIC_SANDBOX_KEY
bash scripts/ops/ci-ext07-epic-key-copy.sh copy
unset HELIXIS_CI_EXT07_CONFIRM_COPY
```

Expected: `SECRET_COPY=CREATED_AND_VERIFIED` or `ALREADY_EXISTS_VERIFIED`, `TARGET_VERSION=1`, `IAM_GRANTS=NOT_CHANGED`, `FIRESTORE=NOT_CHANGED`, `IMPORT_ENABLED=NO`.

This operation only copies an already verified sandbox signing key from one Secret Manager secret to a second secret. It **does not** enable imports, authorize hospital use, create patient links, or set IAM access.

## Stage 3: dedicated staging runtime identity / least privilege

This must be executed after independent IAM review **with the exact name output by Stage 1**. Do not grant at project level.

```bash
# Replace both placeholders with independently verified exact values.
DEST_SECRET='<exact-TARGET_SECRET-from-Stage-1>'
RUNTIME_SA='<dedicated-staging-fhir-worker>@studio-1130431360-48a05.iam.gserviceaccount.com'

# Security review must explicitly approve this exact grant.
gcloud secrets add-iam-policy-binding "$DEST_SECRET" \
  --project=studio-1130431360-48a05 \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets get-iam-policy "$DEST_SECRET" \
  --project=studio-1130431360-48a05 \
  --format=json
```

Grant `secretAccessor` only on the verified source secret. Separately verify the worker's identity federation and its ability to access **only** this specific secret; confirm a different tenant's secret is denied. Never attach the Epic key to Vercel public/static build environments.

## Stage 4: explicit suspended-source registration (optional, still disabled)

A trusted staging-only script can register the proposed metadata **only** after the source-specific Secret Manager key's public fingerprint matches the registered JWKS, the Firestore tenant document exists and has `syntheticOnly: true`, and the named facility exists with the same tenant ID and `syntheticOnly: true` or `sandbox: true`. The operator must have an independently reviewed change ticket and a recorded identity. The script never accepts a client-provided FHIR URL or private key.

```bash
export FIREBASE_PROJECT_ID=studio-1130431360-48a05
export HELIXIS_CI_EXT07_OPERATOR_ID='<authorized-staging-operator-id>'
export HELIXIS_CI_EXT07_CHANGE_TICKET='<approved-change-ticket-id>'
export HELIXIS_CI_EXT07_CONFIRM_REGISTER=REGISTER_SUSPENDED_EPIC_SOURCE

bun scripts/ops/ci-ext07-register-suspended-epic-source.ts
unset HELIXIS_CI_EXT07_CONFIRM_REGISTER
```

On success it creates only the source metadata `/tenants/{tenantId}/fhirSources/{sourceId}` and an immutable `fhirProvisioningEvents/{eventId}` record atomically, with source `SUSPENDED` and security review `PENDING`. Existing sources never get overwritten, and a project mismatch or a non-synthetic tenant/facility fails closed.

**Do not apply the plan by directly pasting it into Firestore.** If the tenant/facility does not have a trusted synthetic-only designation, stop and enroll a dedicated synthetic workspace using separately governed tenant provisioning.

**Required later transport promotion (NOT implemented in CI-EXT-07):** CI-EXT-04/05 synthetic protocol and site qualification currently require source `ACTIVE` and `securityReviewStatus=APPROVED`. That is a *transport-security* readiness gate, not final hospital approval. A future independently audited promotion operation must verify the exact staging IAM/egress/key/authorization evidence before enabling that state while keeping patient imports disabled. Only then can CI-EXT-05 collect separate clinical and security site decisions and issue final `siteApprovalId`. Neither this script nor direct Firestore Console edits may bypass this sequence.

## Scope synchronization and next qualification

Epic search qualification returned 1 Encounter and 7 vital-sign Observations for a known synthetic Patient. However, the CI-EXT-06C application broker must compare its **actual fresh returned scope strings** with the source-owned allowlist. This template initially permits only generic `.r` (read-by-ID) scopes. If fresh grants include `.s`, do not widen automatically: obtain the exact scope string and review/update the source registration and broker parser before attempting application-level requests.

Then:
1. Create a synthetic manifest from verified Epic fixture IDs and an operator authorization reference (never invent IDs).
2. Qualify OAuth/SMART discovery and the read-by-ID Patient/Encounter/Observation probe with no writes.
3. Establish network egress controls, site authorization, patient identity/consent, replay/idempotency, independently witnessed clinical/security review.
4. Enable external evidence import only in a separately authorized staging release. Do **not** promote held evidence into native Patient 360 or enable clinical drafting.

## Release evidence / rollback

```bash
bun test tests/ci-ext07-epic-source-provisioning.test.ts
bash -n scripts/ops/ci-ext07-epic-key-copy.sh
bun run typecheck
bun run lint
```

Keep external import flags disabled throughout. If copying the staging secret was premature, revoke the specific runtime IAM grant and disable its secret version **after checking active token issuance and coordinating with the operator**. Preserve immutable enrollment/audit evidence; never erase audit records as a rollback shortcut.

Production work requires a new institutional app registration, per-site signing key, agreement, staging-to-production qualification, egress controls and independent signoff. A public Epic sandbox is not a connected hospital.
