#!/usr/bin/env bash
# CI-EXT-07 Epic developer sandbox key copy.
# NO Firestore writes, feature-flag changes, IAM grants or Epic calls.
# Default: read-only plan. Explicit 'copy' creates exactly one new, isolated
# version-1 secret (or verifies the existing version-1 fingerprint).
set +x
set -Eeuo pipefail
umask 077

ACTION="${1:-plan}"
TENANT="${HELIXIS_CI_EXT07_TENANT_ID:-}"
SOURCE="${HELIXIS_CI_EXT07_SOURCE_ID:-}"
PROJECT="studio-1130431360-48a05"
SOURCE_SECRET="helixis-epic-sandbox-rs384"
EXPECTED_SHA="ec114bb777b7cd2aeda2e27be9c7d5eec771cdfc290ed62c5b783406fd599d2f"

fail() { printf 'CI_EXT07_FAILED=%s\n' "$1" >&2; exit 1; }
[[ "$ACTION" == plan || "$ACTION" == copy ]] || fail "ACTION_INVALID"
[[ "${GHIMS_RUNTIME_MODE:-}" == "STAGING" ]] || fail "STAGING_RUNTIME_REQUIRED"
[[ "${HELIXIS_CI_EXT07_CONFIRM_PROJECT:-}" == "$PROJECT" ]] || fail "PROJECT_CONFIRMATION_REQUIRED"
[[ "$TENANT" =~ ^[a-zA-Z0-9._-]{1,128}$ && "$TENANT" != . && "$TENANT" != .. ]] || fail "TENANT_INVALID"
[[ "$SOURCE" =~ ^[a-zA-Z0-9._-]{1,128}$ && "$SOURCE" != . && "$SOURCE" != .. ]] || fail "SOURCE_INVALID"
command -v gcloud >/dev/null || fail "GCLOUD_NOT_INSTALLED"
command -v node >/dev/null || fail "NODE_NOT_INSTALLED"
command -v openssl >/dev/null || fail "OPENSSL_NOT_INSTALLED"
command -v sha256sum >/dev/null || fail "SHA256SUM_NOT_INSTALLED"

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null)"
[[ "$ACTIVE_PROJECT" == "$PROJECT" ]] || fail "GCLOUD_PROJECT_MISMATCH"

DIGEST="$(node -e 'const {createHash}=require("node:crypto");process.stdout.write(createHash("sha256").update(JSON.stringify(process.argv.slice(1))).digest("hex").slice(0,32))' "$TENANT" "$SOURCE")"
DEST="helixis-fhir-${DIGEST}"
[[ "$DEST" =~ ^helixis-fhir-[a-f0-9]{32}$ ]] || fail "DERIVED_SECRET_INVALID"

# Hash only the PUBLIC DER SubjectPublicKeyInfo. Neither key nor JWT is logged.
fingerprint_secret() {
  local name="$1"
  gcloud secrets versions access 1 --secret="$name" --project="$PROJECT" 2>/dev/null |
    openssl pkey -pubout -outform DER 2>/dev/null |
    sha256sum | awk '{print $1}'
}

SOURCE_FP="$(fingerprint_secret "$SOURCE_SECRET")" || fail "SOURCE_SECRET_UNAVAILABLE"
[[ "$SOURCE_FP" == "$EXPECTED_SHA" ]] || fail "PUBLIC_KEY_FINGERPRINT_MISMATCH"
printf 'PROJECT=STAGING_CONFIRMED\nSOURCE_PUBLIC_KEY_MATCH=PASS\nTENANT_ID=%s\nSOURCE_ID=%s\nTARGET_SECRET=%s\n' "$TENANT" "$SOURCE" "$DEST"

if [[ "$ACTION" == plan ]]; then
  printf 'PROVISIONING=PLAN_ONLY\nSECRET_COPY=NOT_PERFORMED\n'
  exit 0
fi

[[ "${HELIXIS_CI_EXT07_CONFIRM_COPY:-}" == "COPY_VERIFIED_EPIC_SANDBOX_KEY" ]] ||
  fail "EXPLICIT_COPY_APPROVAL_REQUIRED"

# Distinguish NOT_FOUND from authorization/transport failures. Never overwrite
# an existing secret or silently create a second version of the source key.
if DESCRIPTION="$(gcloud secrets describe "$DEST" --project="$PROJECT" --format='value(name)' 2>&1)"; then
  DEST_FP="$(fingerprint_secret "$DEST")" || fail "TARGET_VERSION_UNAVAILABLE"
  [[ "$DEST_FP" == "$EXPECTED_SHA" ]] || fail "TARGET_SECRET_COLLISION"
  printf 'SECRET_COPY=ALREADY_EXISTS_VERIFIED\n'
else
  [[ "$DESCRIPTION" == *"NOT_FOUND"* ]] || fail "TARGET_DESCRIBE_FAILED"
  gcloud secrets versions access 1 --secret="$SOURCE_SECRET" --project="$PROJECT" 2>/dev/null |
    gcloud secrets create "$DEST" --project="$PROJECT" \
      --replication-policy=automatic --data-file=- >/dev/null ||
      fail "SECRET_CREATION_FAILED"
  DEST_FP="$(fingerprint_secret "$DEST")" || fail "COPIED_SECRET_UNREADABLE"
  [[ "$DEST_FP" == "$EXPECTED_SHA" ]] || fail "COPIED_KEY_FINGERPRINT_MISMATCH"
  printf 'SECRET_COPY=CREATED_AND_VERIFIED\n'
fi
printf 'TARGET_VERSION=1\nIAM_GRANTS=NOT_CHANGED\nFIRESTORE=NOT_CHANGED\nIMPORT_ENABLED=NO\n'
