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

## Stage 1: read-only plan and public-key verification

Clone or pull the CI-EXT-07 branch in Cloud Shell. Set these reviewed **non-secret** identifiers in your terminal:

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

## Stage 4: source registration (still disabled)

The metadata-only plan contains the exact Firestore path `/tenants/{tenantId}/fhirSources/{sourceId}`, `baseUrl`, `oauth` registration and disabled source state. A separate audited privileged staging-enrollment operation (not added here) must verify that the tenant and facility already exist, confirm absence of source ID collision, check Secret Manager public-key fingerprint and required IAM/egress evidence, then atomically create source metadata and an immutable enrollment event.

The source **must remain** `status=SUSPENDED` and `securityReviewStatus=PENDING` after registration. Changing to `ACTIVE/APPROVED` requires the explicit site approval and synthetic qualification workflow from CI-EXT-05, not direct Admin SDK edits or a manual Firestore Console toggle.

**Do not apply the plan by directly pasting it into Firestore.**

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
