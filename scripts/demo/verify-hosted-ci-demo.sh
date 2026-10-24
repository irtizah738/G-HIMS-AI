#!/usr/bin/env bash
# No hosted writes. Read-only qualification of the already-seeded DEMO Auth and Firestore records.
set -euo pipefail
demo_project='g-hims-ci-demo'
demo_tenant='central-metro-hospital'
cd "$(dirname "$0")/../.."
[[ "$(git branch --show-current)" == 'fundraising/clinical-intelligence-demo-20261025' ]] || { echo 'CI_DEMO_WRONG_BRANCH' >&2; exit 1; }
for cmd in bun gcloud git; do command -v "$cmd" >/dev/null || { echo "CI_DEMO_MISSING_TOOL:$cmd" >&2; exit 1; }; done
if [[ -n "${VERCEL:-}" || -n "${CI:-}" || -n "${FIRESTORE_EMULATOR_HOST:-}" ||
      -n "${FIREBASE_AUTH_EMULATOR_HOST:-}" || -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ||
      -n "${FIREBASE_PRIVATE_KEY:-}" || -n "${FIREBASE_CLIENT_EMAIL:-}" ||
      -n "${GHIMS_DEMO_BOOTSTRAP_PASSWORD:-}" || -n "${GHIMS_DEMO_HOSTED_WRITE_ACK:-}" ]]; then
  echo 'CI_DEMO_READONLY_ENV_CONFLICT' >&2
  exit 1
fi
if [[ "${DEVSHELL_PROJECT_ID:-}" != "$demo_project" ]] ||
   [[ "$(gcloud config get-value project 2>/dev/null)" != "$demo_project" ]]; then
  echo 'CI_DEMO_CLOUD_SHELL_PROJECT_NOT_VERIFIED' >&2
  exit 1
fi
if ! gcloud firestore databases describe --project="$demo_project" --database='(default)' \
   --format='value(name)' 2>/dev/null | grep -Fxq "projects/$demo_project/databases/(default)"; then
  echo 'CI_DEMO_FIRESTORE_PROJECT_NOT_VERIFIED' >&2
  exit 1
fi
export DEVSHELL_PROJECT_ID="$demo_project"
export GHIMS_DEMO_USE_CLOUD_SHELL_CLI=true
export GHIMS_RUNTIME_MODE=DEMO
export NEXT_PUBLIC_GHIMS_RUNTIME_MODE=DEMO
export GHIMS_DEMO_TENANT_ID="$demo_tenant"
export FIREBASE_PROJECT_ID="$demo_project"
export NEXT_PUBLIC_FIREBASE_PROJECT_ID="$demo_project"
export GHIMS_FIREBASE_PROJECT_ID_DEMO="$demo_project"
export NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO="$demo_project"
export GHIMS_FIREBASE_PROJECT_ID_PRODUCTION='g-hims-ai'
export NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION='g-hims-ai'
export GHIMS_FIREBASE_PROJECT_ID_STAGING='studio-1130431360-48a05'
export NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING='studio-1130431360-48a05'
export FIRESTORE_DATABASE_ID='(default)'
export NEXT_PUBLIC_FIRESTORE_DATABASE_ID='(default)'
unset GHIMS_FIREBASE_PROJECT_ID_TEST NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST
bun scripts/demo/verify-hosted-ci-demo.ts
