# CI-EXT-07D — Dedicated synthetic Epic integration workspace

**Status:** staging bootstrap procedure. No Firestore data is written by CI, and a GitHub green check is not authorization to execute the creation command.

## Decision

The existing `ciqp-synthetic-hospital0` tenant is explicitly synthetic-only but has no facility documents. The `govt-gynae-hospital` tenant does not carry an explicit synthetic-only marker. **Do not modify either tenant to satisfy Epic provisioning.**

Instead create precisely one isolated tenant and facility in the existing staging project:

| Item | Fixed ID |
|---|---|
| GCP project | `studio-1130431360-48a05` |
| Firestore database | `(default)` |
| Tenant | `helixis-epic-sandbox` |
| Facility | `helixis-epic-test-facility` |
| Audit event | `epic-synthetic-workspace-created-v1` |

The bootstrap creates only **three Firestore documents**: the tenant, an active synthetic facility (required for the existing CI-EXT-07 read-only verifier), and an immutable provisioning event. No patient records, user memberships, clinical notes, OAuth keys, grants, source registrations, or imported clinical evidence are created. `syntheticOnly=true` and `clinicalImportsEnabled=false` are explicit markers, NOT a substitute for separate security rules, project IAM, or clinical authorization.

## Architecture and guards

- Fixed project, tenant, facility, event ID: no caller-provided paths or endpoints.
- `GHIMS_RUNTIME_MODE=STAGING`, exact project confirmation and currently selected `gcloud` project required.
- No Vercel, emulators, service-account impersonation, or `GOOGLE_APPLICATION_CREDENTIALS` on this operator command.
- Verifies the authenticated gcloud user account and requires a human-operator identity for the audit metadata.
- Read-only `plan` is the default; `create` requires an exact explicit confirmation and a nonempty change reference.
- Checks tenant/facility/event absence and rejects orphaned subcollections. Creates using Firestore REST `documents:commit` with three create-if-absent preconditions, preventing partial or colliding workspace creation.
- Verifies created tenant/facility and immutable audit event from Firestore before reporting success.
- Never touches `ciqp-synthetic-hospital0`, `govt-gynae-hospital`, or production `g-hims-ai`.

Google's `documents:commit` API guarantees writes in one commit are atomic; `currentDocument.exists=false` disallows overwrites.

## Stage 1 — read-only plan

In the Cloud Shell working tree, fetch the reviewed CI-EXT-07D PR branch. You can clone a separate copy to avoid changing earlier test scripts.

```bash
git clone --single-branch \
  --branch feat/ci-ext07d-dedicated-epic-synthetic-tenant-20261101 \
  https://github.com/irtizah738/G-HIMS-AI.git \
  ~/helixis-epic-workspace

cd ~/helixis-epic-workspace
bun install --frozen-lockfile
gcloud config set project studio-1130431360-48a05

export GHIMS_RUNTIME_MODE=STAGING
export HELIXIS_CI_EXT07D_CONFIRM_PROJECT=studio-1130431360-48a05
export GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=false
export GHIMS_INTEGRATION_FHIR_R4_STATE=DISABLED

bun scripts/ops/ci-ext07d-epic-workspace.ts plan
```

Expected only if the three document paths and tenant subcollections are absent:

```text
CI_EXT07D_PROJECT=studio-1130431360-48a05
CI_EXT07D_TENANT=tenants/helixis-epic-sandbox
CI_EXT07D_FACILITY=tenants/helixis-epic-sandbox/facilities/helixis-epic-test-facility
CI_EXT07D_COLLISIONS=NONE
CI_EXT07D_MODE=PLAN_ONLY
CI_EXT07D_FIRESTORE_WRITES=0
```

Any `CI_EXT07D_...` error is a hard stop; do not bypass. If the workspace already exists, use the read-only CI-EXT-07 inspector and investigate the audit event rather than overwrite.

## Stage 2 — explicit create, after operator review

Only after reviewing the plan and having a valid internal change reference, run:

```bash
export HELIXIS_CI_EXT07D_CHANGE_TICKET='<recorded-change-reference>'
export HELIXIS_CI_EXT07D_CONFIRM_CREATE=CREATE_SYNTHETIC_EPIC_WORKSPACE
bun scripts/ops/ci-ext07d-epic-workspace.ts create
unset HELIXIS_CI_EXT07D_CONFIRM_CREATE
```

Expected: `CI_EXT07D_WORKSPACE_CREATED=PASS`, `CI_EXT07D_ATOMIC_DOCUMENTS=3`, `CI_EXT07D_FHIR_SOURCE=NOT_CREATED`, `CI_EXT07D_IMPORT_ENABLED=NO`. This is a **real staging Firestore mutation**: it must be performed only by an authorized operator. Don't put a key or credential in `HELIXIS_CI_EXT07D_CHANGE_TICKET`; it is non-secret audit metadata.

## Stage 3 — rerun existing verifier

```bash
export HELIXIS_CI_EXT07_CONFIRM_PROJECT=studio-1130431360-48a05
export HELIXIS_CI_EXT07_TENANT_ID=helixis-epic-sandbox
bun scripts/ops/ci-ext07-inspect-synthetic-tenant.ts
```

Expected: `CI_EXT07_TENANT_SYNTHETIC_ONLY=YES`, `CI_EXT07_ELIGIBLE_FACILITY_ID=helixis-epic-test-facility`, `CI_EXT07_FACILITY_SCAN_COMPLETE=YES`.

**Then** prepare the Secret Manager copy plan; set `HELIXIS_CI_EXT07_SOURCE_ID=epic-sandbox` and `HELIXIS_CI_EXT07_FACILITY_ID=helixis-epic-test-facility`. Verify the existing Epic sandbox private-key fingerprint before copying it into the per-source secret. Do not run the copy automatically.

## Remaining hard gates

- Dedicated source-specific IAM and WIF credentials and network egress isolation.
- Match the Epic token's *actual* read/search grants against the application source-owned allowlist.
- Registered `fhirSources` record must start `SUSPENDED` / `PENDING`.
- Independent clinical and security site review before imports or external Patient 360 projection.
- Live vendor connection success is **not** production permission, institutional HIS onboarding or proof of clinical safety.
