# CI-EXT-07F — sealed Epic Cloud Run worker

**Engineering candidate. CI-EXT-07F initial deployment previously failed on an unsupported `--no-traffic` flag; inspect actual service inventory before retry. Synthetic STAGING only.**
The CI-EXT-07E Cloud Run Job produced `EGRESS_TEST=PASS_NO_TCP_CONNECTION`.
It proves that TCP connection failed in that job, not whether the cause was
the firewall or absent NAT. No real Epic HTTPS test has been qualified here.

## Exact trust boundary

- GCP project `studio-1130431360-48a05`, region `us-central1`.
- Identity `helixis-epic-staging-runtime@studio-1130431360-48a05.iam.gserviceaccount.com`.
- VPC `helixis-epic-egress`, subnet `helixis-epic-us-central1`, IPv4 only,
  `all-traffic` Direct VPC egress.
- Existing egress firewall `helixis-epic-deny-egress`: priority 1000,
  DENY all IPv4 traffic. No Cloud NAT, proxy or internet allowance is created.
- New service `helixis-epic-sealed-worker` only: internal ingress,
  authenticated invocation with IAM check, default URL disabled, manual
  scaling **zero instances** (service disabled). Cloud Run may still assign
  100% route allocation to the first revision; zero-instance manual scaling
  means it cannot serve requests. This is not a zero-percent-traffic release.
- Standalone Node built-in HTTP application with only `GET /healthz`;
  all other routes return HTTP 403. No FHIR, OAuth, Secret Manager, Firestore,
  request-body logging, patient identifiers or outbound client.
- Epic signing key is not mounted; no IAM changes are made.
- External FHIR import, integration and SMART authentication remain DISABLED.
- Deployment refuses production, TEST, incorrect GCP project, tag-only images,
  previously existing service, missing deny rule, unexpected user-managed
  keys, or direct secret/project IAM bindings.
- Script direct-binding checks cannot prove absence of inherited IAM roles;
  independently review inherited/group/org IAM before a deployment.

## Code qualification (no GCP access)

```bash
node --test tests/ci-ext07f-sealed-worker.test.mjs
bash -n scripts/ops/ci-ext07f-sealed-worker.sh
GHIMS_RUNTIME_MODE=TEST bash scripts/ops/ci-ext07f-sealed-worker.sh deploy
# Last command must fail: CI_EXT07F_FAILED=STAGING_RUNTIME_REQUIRED
```

CI is TEST-only, runs tests and shell syntax, and cannot deploy.

## Artifact build (operator approval; billable actions)

`services/epic-sealed-worker/Dockerfile` is now pinned to the exact
Docker Official Image **linux/amd64** manifest observed in the operator's
2026-11-01 Docker inspection:

- AMD64 OCI manifest: `sha256:4eefa1bfce4197942661ef9148247d779ddf1bb0ee006d3294a467609de60724`
- Multi-platform index: `sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85`

The Dockerfile pins the **AMD64 manifest**, not the multi-platform index.
Digest pinning prevents tag drift; it is **not** proof of vulnerability-free
content, safe provenance, or a reviewed SBOM. Independently review the image
before building a release artifact. Build only the isolated
`services/epic-sealed-worker` directory, never the complete clinical app.
Create a dedicated Artifact Registry repository after reviewing the change;
do not reuse the existing `gcf-artifacts` repository.

```bash
PROJECT=studio-1130431360-48a05
REGION=us-central1
REPO=helixis-epic-staging
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/epic-sealed-worker"

gcloud artifacts repositories describe "$REPO" --project="$PROJECT" --location="$REGION"
# Only on confirmed NOT_FOUND and with approved change ticket:
gcloud artifacts repositories create "$REPO" --project="$PROJECT" \
  --location="$REGION" --repository-format=docker \
  --description="Helixis synthetic Epic staging artifacts"

# After confirming Dockerfile AMD64 digest, provenance and approval:
gcloud builds submit services/epic-sealed-worker \
  --project="$PROJECT" --region="$REGION" \
  --tag="$IMAGE:ci-ext07f-sealed-v1"
gcloud artifacts docker images list "$IMAGE" --project="$PROJECT" \
  --include-tags --format="table(package,version,tags)"
```

Capture the exact **sha256 digest** from Artifact Registry. Never use a
mutable tag in the staging deployment. Do not grant project Editor to
repair Cloud Build permission failures.

## Read-only deployment plan

```bash
export GHIMS_RUNTIME_MODE=STAGING
export HELIXIS_CI_EXT07F_CONFIRM_PROJECT=studio-1130431360-48a05
export GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=false
export GHIMS_INTEGRATION_FHIR_R4_STATE=DISABLED
export GHIMS_CI_FHIR_AUTH_MODE=DISABLED
export HELIXIS_CI_EXT07F_IMAGE='us-central1-docker.pkg.dev/studio-1130431360-48a05/helixis-epic-staging/epic-sealed-worker@sha256:<actual-64-hex-digest>'
gcloud config set project studio-1130431360-48a05
bash scripts/ops/ci-ext07f-sealed-worker.sh plan
```

Expected: `CI_EXT07F_ACTION=PLAN_ONLY`, `CI_EXT07F_CLOUD_RUN_WRITE=NO`,
`CI_EXT07F_SECRET_GRANTS=NOT_CHANGED`, `CI_EXT07F_IMPORT_ENABLED=NO`.

## Deployment: independent explicit approval

After reviewing the exact image digest, upstream provenance, project policies
and approved recorded change:

```bash
export HELIXIS_CI_EXT07F_CHANGE_TICKET='<actual-approved-reference>'
export HELIXIS_CI_EXT07F_CONFIRM_DEPLOY=DEPLOY_SEALED_EPIC_WORKER
bash scripts/ops/ci-ext07f-sealed-worker.sh deploy
unset HELIXIS_CI_EXT07F_CONFIRM_DEPLOY
```

This is **first deployment only**. It will not update existing services.
The first revision may receive **100% routing allocation**, because
`--no-traffic` is unsupported when **creating** a service. The first deployment
therefore uses `--scaling=0` to **disable the entire service** immediately,
`--no-default-url` to disable the default endpoint, `--ingress=internal`,
`--no-allow-unauthenticated`, `--invoker-iam-check`, and
`--no-deploy-health-check`. The last option prevents Cloud Run's default
single-instance deployment readiness check from starting the otherwise
disabled workload. The operator must separately qualify startup when
activation becomes authorized.
No Epic credentials are attached. Deployment success does not qualify live
outbound Epic connectivity. Do not add a traffic tag: tag-based routing may
bypass some service-level disabled-instance semantics.


### First-deployment failure: `--no-traffic` unsupported

On 2026-11-01 the initial `gcloud run deploy` returned:
`--no-traffic not supported when creating a new service.` The command was
rejected, but its response alone does **not** prove zero resources were
created. First inspect regional service inventory; the operator script itself
refuses to proceed if the service already exists. Never delete a partially
created service automatically. Review and document it before any remediation.

### Second first-deployment failure: gen2 memory lower bound

On 2026-11-01 the next `gcloud run deploy` attempt was rejected:
`spec.template.spec.containers.resources.limits.memory: Total memory < 512 Mi is not supported with gen2 execution environment.`

The reviewed command now uses `--execution-environment=gen2 --memory=512Mi --cpu=1`.
For gen2, 512 MiB is the documented minimum; this is a resource bound
fix only and does not change workload behavior or the published OCI image.
Do not retry until read-only regional inventory confirms the worker service
was not partially created and new CI checks have passed.

## Mandatory post-deployment inspection

```bash
PROJECT=studio-1130431360-48a05
SERVICE=helixis-epic-sealed-worker
gcloud run services describe "$SERVICE" --project="$PROJECT" \
  --region=us-central1 --format=yaml
gcloud run services get-iam-policy "$SERVICE" --project="$PROJECT" \
  --region=us-central1 --format=json
gcloud secrets get-iam-policy helixis-fhir-0db9e82fc4db981ae88c2ffdd1acc15a \
  --project="$PROJECT" --format=json
```

Confirm no allUsers/allAuthenticatedUsers grants, manual scaling=0,
**no default URL**, no traffic tags, internal ingress, invoker IAM check,
all-traffic VPC attachment, correct SA, no secret env or volumes, and disabled
imports. Do not mistake an initial 100% route allocation for a running service.
If any check fails, halt; do not activate or loosen ingress. Record output with digest, operator, timestamp and change approval.

## Later, separate CI-EXT-07G gate

Specify, cost-review and qualify a controlled HTTPS egress gateway with an
Epic sandbox host allowlist, no direct bypass, DNS/TLS checks, observability
and negative-destination tests from the **actual deployed workload**.
Only after those tests may a separate reviewed IAM change grant
`roles/secretmanager.secretAccessor` for the single Epic staging secret.
Then verify denied cross-tenant secret access, identity/consent constraints,
source/site security review, and any clinical import release separately.
