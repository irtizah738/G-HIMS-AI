# CI-EXT-07G-D0 — disposable Cloud Run Direct VPC denial probe

Status: **prepared only**. No job, gateway, NAT, routes, IAM grants or cloud probes have been deployed by this PR. Existing Epic worker/VPC are unchanged. This stage validates **negative TCP reachability only**, not firewall causality.

## Preconditions

1. Confirm `studio-1130431360-48a05`, region `us-central1`, isolated `helixis-epic-lab-net`/ `helixis-epic-lab-subnet` `10.250.240.0/24`, and effective priority-1000 `helixis-epic-lab-deny-egress`. Stop on any unknown inherited allow rules.
2. Review this exact PR SHA and security boundaries, have an independent security reviewer approve lab job's new **keyless, no-roles service account**. Do not attach or impersonate the sealed Epic runtime identity.
3. Confirm the paid SWP has **not** been deployed. Its two-hour testing window and teardown are a separate gate. No production or Epic calls.
4. No customer/patient identifiers, bearer tokens, keys, Firestore data or Vercel changes.

## Build just the probe (after review)

```bash
REPO_DIR="$HOME/helixis-epic-probe-20261102"
git clone --depth=1 --single-branch \
  --branch feat/ci-ext07gd-direct-vpc-deny-probe-20261102 \
  https://github.com/irtizah738/G-HIMS-AI.git "$REPO_DIR"
cd "$REPO_DIR" || exit
node --test tests/ci-ext07gd-deny-only-probe.test.mjs
PROJECT=studio-1130431360-48a05
REGION=us-central1
IMAGE="$REGION-docker.pkg.dev/$PROJECT/helixis-epic-staging/epic-egress-deny-probe"
gcloud artifacts repositories describe helixis-epic-staging --project="$PROJECT" --location="$REGION"
gcloud builds submit services/epic-egress-probe --project="$PROJECT" --region="$REGION" --tag="$IMAGE:ci-ext07gd-deny-v1"
gcloud artifacts docker images list "$IMAGE" --project="$PROJECT" --include-tags --format='table(package,version,tags)'
```

Capture, review and use the *actual immutable image digest*, not a tag. If the existing dedicated Artifact Registry does not exist, stop; do not create or grant broad IAM automatically.

## Candidate job deployment (must pass separate security/operator review)

```bash
PROJECT=studio-1130431360-48a05
REGION=us-central1
SA="helixis-epic-lab-probe@$PROJECT.iam.gserviceaccount.com"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/helixis-epic-staging/epic-egress-deny-probe@sha256:<actual-64-hex-image-digest>"

gcloud iam service-accounts create helixis-epic-lab-probe --project="$PROJECT" --display-name='Isolated no-credentials deny-only lab probe'
gcloud iam service-accounts keys list --iam-account="$SA" --managed-by=user --project="$PROJECT" --format='value(name)'

gcloud run jobs create helixis-epic-lab-deny-probe \
  --project="$PROJECT" --region="$REGION" --image="$IMAGE" --service-account="$SA" \
  --network=helixis-epic-lab-net --subnet=helixis-epic-lab-subnet \
  --network-tags=helixis-epic-lab-probe --vpc-egress=all-traffic \
  --tasks=1 --max-retries=0 --task-timeout=60s \
  --set-env-vars=GHIMS_RUNTIME_MODE=STAGING,HELIXIS_EPIC_PROBE_MODE=DENY_ONLY,HELIXIS_EPIC_PROBE_PROJECT=studio-1130431360-48a05,GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=false

gcloud run jobs describe helixis-epic-lab-deny-probe --project="$PROJECT" --region="$REGION" --format=json
# Confirm exact job identity, image digest, VPC, mode, absent secrets, and retry/timeout before execution.
gcloud run jobs execute helixis-epic-lab-deny-probe --project="$PROJECT" --region="$REGION" --wait
```

**Expected:** `PASS_NO_PUBLIC_TCP_CONNECTION` with two `reachable:false` results. **Any reachable:true, execution error, inability to verify identity, unexpected artifact, or network route means STOP.** This can be caused by no NAT rather than deny firewall: no causal proof is claimed.

### Mandatory cleanup before deleting isolated VPC

```bash
PROJECT=studio-1130431360-48a05
REGION=us-central1
SA="helixis-epic-lab-probe@$PROJECT.iam.gserviceaccount.com"
gcloud run jobs delete helixis-epic-lab-deny-probe --project="$PROJECT" --region="$REGION" --quiet
gcloud run jobs list --project="$PROJECT" --region="$REGION" --format='table(metadata.name)'
gcloud iam service-accounts delete "$SA" --project="$PROJECT" --quiet
```

Cloud Run may hold subnet IP allocations up to 1–2 hours after job deletion; never remove the deny-all firewall to accelerate teardown. Audit/remove only the exact associated probe artifact later. If subsequent SWP and auto-NAT resources have been created, their **separately reviewed** teardown must complete before deleting the VPC.

## Qualification not yet delivered

- Actual packet-level denial at the Cloud Run workload (not VM-only)
- Causal proof under NAT present, proxy route disabled/removed and gateway unhealthy
- Secure Web Proxy host/SNI policy and all-path anti-bypass behavior
- Positive live Epic sandbox OAuth/FHIR connection, synthetic import and sidecar
- Independent clinical and security release approvals

See https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc and https://docs.cloud.google.com/secure-web-proxy/docs/deploy-next-hop.
