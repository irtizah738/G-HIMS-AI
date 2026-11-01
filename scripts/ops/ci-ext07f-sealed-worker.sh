#!/usr/bin/env bash
# CI-EXT-07F — first-deploy-only, fail-closed sealed Epic worker.
# No IAM grants, secret mounts, outbound gateway, patient data, or clinical imports.
set +x
set -Eeuo pipefail
umask 077
fail(){ printf 'CI_EXT07F_FAILED=%s\n' "$1" >&2; exit 1; }
ACTION="${1:-plan}"
[[ "$ACTION" == plan || "$ACTION" == deploy ]] || fail ACTION_INVALID
PROJECT=studio-1130431360-48a05
REGION=us-central1
SERVICE=helixis-epic-sealed-worker
NETWORK=helixis-epic-egress
SUBNET=helixis-epic-us-central1
SA="helixis-epic-staging-runtime@$PROJECT.iam.gserviceaccount.com"
EPIC_RESOURCE_NAME=helixis-fhir-0db9e82fc4db981ae88c2ffdd1acc15a
IMAGE="${HELIXIS_CI_EXT07F_IMAGE:-}"
[[ "${GHIMS_RUNTIME_MODE:-}" == STAGING ]] || fail STAGING_RUNTIME_REQUIRED
[[ "${HELIXIS_CI_EXT07F_CONFIRM_PROJECT:-}" == "$PROJECT" ]] || fail PROJECT_CONFIRMATION_REQUIRED
[[ "${GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED:-}" == false ]] || fail IMPORT_MUST_BE_DISABLED
[[ "${GHIMS_INTEGRATION_FHIR_R4_STATE:-}" == DISABLED ]] || fail FHIR_INTEGRATION_MUST_BE_DISABLED
[[ "${GHIMS_CI_FHIR_AUTH_MODE:-}" == DISABLED ]] || fail FHIR_AUTH_MUST_BE_DISABLED
[[ "$IMAGE" =~ ^us-central1-docker\.pkg\.dev/studio-1130431360-48a05/helixis-epic-staging/epic-sealed-worker@sha256:[a-f0-9]{64}$ ]] || fail PINNED_ARTIFACT_IMAGE_REQUIRED
for bin in gcloud jq; do command -v "$bin" >/dev/null || fail "TOOL_MISSING_$bin"; done
[[ "$(gcloud config get-value project 2>/dev/null)" == "$PROJECT" ]] || fail GCLOUD_PROJECT_MISMATCH
if output="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(metadata.name)' 2>&1)"; then
  fail SERVICE_ALREADY_EXISTS
elif [[ "$output" != *NOT_FOUND* && "$output" != *"not found"* ]]; then
  fail SERVICE_EXISTENCE_NOT_VERIFIABLE
fi
[[ "$(gcloud compute networks subnets describe "$SUBNET" --project="$PROJECT" --region="$REGION" --format='value(stackType)')" == IPV4_ONLY ]] || fail SUBNET_NOT_IPV4_ONLY
[[ "$(gcloud compute networks subnets describe "$SUBNET" --project="$PROJECT" --region="$REGION" --format='value(network)')" == *"/networks/$NETWORK" ]] || fail SUBNET_NETWORK_MISMATCH
[[ "$(gcloud iam service-accounts describe "$SA" --project="$PROJECT" --format='value(disabled)')" != True ]] || fail SERVICE_ACCOUNT_DISABLED
[[ -z "$(gcloud iam service-accounts keys list --iam-account="$SA" --project="$PROJECT" --managed-by=user --format='value(name)')" ]] || fail USER_MANAGED_SA_KEYS_FOUND
gcloud compute firewall-rules describe helixis-epic-deny-egress --project="$PROJECT" --format=json |
  jq -e --arg network "$NETWORK" '(.direction=="EGRESS") and (.priority==1000) and
    (.network | endswith("/networks/" + $network)) and
    ((.destinationRanges // []) | index("0.0.0.0/0") != null) and
    ((.denied // []) | any(.IPProtocol == "all"))' >/dev/null || fail FIREWALL_DENY_NOT_VERIFIED
gcloud secrets get-iam-policy "$EPIC_RESOURCE_NAME" --project="$PROJECT" --format=json |
  jq -e --arg member "serviceAccount:$SA" '([.bindings[]?.members[]? | select(. == $member)] | length) == 0' >/dev/null || fail EXISTING_SECRET_IAM_ACCESS
gcloud projects get-iam-policy "$PROJECT" --format=json |
  jq -e --arg member "serviceAccount:$SA" '([.bindings[]?.members[]? | select(. == $member)] | length) == 0' >/dev/null || fail EXISTING_PROJECT_IAM_ROLE
printf 'CI_EXT07F_PROJECT=STAGING_CONFIRMED\nCI_EXT07F_SERVICE=%s\nCI_EXT07F_IMAGE=%s\nCI_EXT07F_EGRESS=all-traffic\nCI_EXT07F_INGRESS=internal\n' "$SERVICE" "$IMAGE"
if [[ "$ACTION" == plan ]]; then
  printf 'CI_EXT07F_ACTION=PLAN_ONLY\nCI_EXT07F_CLOUD_RUN_WRITE=NO\nCI_EXT07F_SECRET_GRANTS=NOT_CHANGED\nCI_EXT07F_IMPORT_ENABLED=NO\n'
  exit 0
fi
[[ "${HELIXIS_CI_EXT07F_CONFIRM_DEPLOY:-}" == DEPLOY_SEALED_EPIC_WORKER ]] || fail EXPLICIT_DEPLOY_APPROVAL_REQUIRED
[[ "${HELIXIS_CI_EXT07F_CHANGE_TICKET:-}" =~ ^[A-Za-z0-9._-]{8,128}$ ]] || fail CHANGE_TICKET_INVALID
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --image="$IMAGE" \
  --execution-environment=gen2 --service-account="$SA" \
  --network="$NETWORK" --subnet="$SUBNET" --network-tags=helixis-epic-worker \
  --vpc-egress=all-traffic --ingress=internal \
  --no-allow-unauthenticated --no-traffic \
  --min-instances=0 --max-instances=1 --concurrency=1 \
  --memory=256Mi --cpu=1 --timeout=10s --port=8080 \
  --set-env-vars="NODE_ENV=production,HELIXIS_EPIC_WORKER_MODE=SEALED,HELIXIS_EPIC_PROJECT=$PROJECT,GHIMS_RUNTIME_MODE=STAGING,GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=false,GHIMS_INTEGRATION_FHIR_R4_STATE=DISABLED,GHIMS_CI_FHIR_AUTH_MODE=DISABLED" \
  --quiet
printf 'CI_EXT07F_DEPLOY_SUBMITTED=PASS\nCI_EXT07F_SECRET_GRANTS=NOT_CHANGED\nCI_EXT07F_IMPORT_ENABLED=NO\nCI_EXT07F_POST_DEPLOY_VERIFICATION=REQUIRED\n'
