#!/usr/bin/env bash
# CI-EXT-13: READ-ONLY actual Cloud Run egress inventory. No deployment, DNS,
# outbound packets, IAM writes, secrets access, or SWP policy mutations.
set +x
set -Eeuo pipefail
umask 077

PROJECT="studio-1130431360-48a05"
REGION="us-central1"
SERVICE="helixis-epic-sealed-worker"
NETWORK="helixis-epic-egress"
SUBNET="helixis-epic-us-central1"
EXPECTED_SA="helixis-epic-staging-runtime@${PROJECT}.iam.gserviceaccount.com"
fail() { printf 'CI_EXT13_READONLY_FAILED=%s\n' "$1" >&2; exit 1; }

[[ "${GHIMS_RUNTIME_MODE:-}" == "STAGING" ]] || fail STAGING_REQUIRED
[[ "${HELIXIS_CI_EXT13_CONFIRM_PROJECT:-}" == "$PROJECT" ]] || fail EXPLICIT_PROJECT_CONFIRMATION_REQUIRED
[[ "${GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED:-false}" == "false" ]] || fail LIVE_IMPORT_FORBIDDEN
[[ "${GHIMS_INTEGRATION_FHIR_R4_STATE:-DISABLED}" == "DISABLED" ]] || fail LIVE_FHIR_FORBIDDEN
command -v gcloud >/dev/null || fail GCLOUD_MISSING
command -v node >/dev/null || fail NODE_MISSING
[[ "$(gcloud config get-value project 2>/dev/null)" == "$PROJECT" ]] || fail ACTIVE_PROJECT_MISMATCH

TMP="$(mktemp -d)" || fail TMPDIR_ERROR
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# Restrict external effects to Google Cloud describe/list/get-effective commands.
gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" --format=json > "$TMP/service.json" || fail SERVICE_READ
gcloud compute networks subnets describe "$SUBNET" --region="$REGION" --project="$PROJECT" --format=json > "$TMP/subnet.json" || fail SUBNET_READ
gcloud compute routes list --project="$PROJECT" --format=json > "$TMP/routes.json" || fail ROUTES_READ
gcloud compute firewall-rules list --project="$PROJECT" --format=json > "$TMP/firewalls.json" || fail FIREWALL_READ
gcloud compute network-firewall-policies get-effective-firewalls --network="$NETWORK" --region="$REGION" --project="$PROJECT" --format=json > "$TMP/effective.json" || fail EFFECTIVE_FIREWALL_READ

node scripts/ops/ci-ext13-assess-cloud-run-egress.mjs \
  "$TMP/service.json" "$TMP/subnet.json" "$TMP/routes.json" \
  "$TMP/firewalls.json" "$TMP/effective.json" \
  "$PROJECT" "$REGION" "$SERVICE" "$NETWORK" "$SUBNET" "$EXPECTED_SA"
printf 'CI_EXT13_CLOUD_MUTATIONS=NONE\n'
printf 'CI_EXT13_TEST_PACKETS=NONE\n'
printf 'CI_EXT13_PRODUCTION_RELEASE=NO_GO\n'
