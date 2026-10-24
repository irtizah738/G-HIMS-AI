#!/usr/bin/env bash
# Operator-run, one-time synthetic-only seed for the isolated g-hims-ci-demo Firebase project.
# This requires the human operator's own scoped Google Cloud Application Default
# Credentials (ADC). It never uses, requests, or prints a service-account private key.
set -euo pipefail
umask 077

demo_project='g-hims-ci-demo'
demo_tenant='central-metro-hospital'
current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "fundraising/clinical-intelligence-demo-20261025" ]]; then
  echo "ERROR: checkout the reviewed G-HIMS-AI investor-demo branch before seeding" >&2
  exit 1
fi
for cmd in bun gcloud git; do
  command -v "$cmd" >/dev/null || { echo "ERROR: required command not found: $cmd" >&2; exit 1; }
done
if [[ -n "${FIRESTORE_EMULATOR_HOST:-}" || -n "${FIREBASE_AUTH_EMULATOR_HOST:-}" ||
      -n "${GHIMS_DEMO_BOOTSTRAP_PASSWORD:-}" || -n "${GHIMS_DEMO_HOSTED_WRITE_ACK:-}" ||
      -n "${FIREBASE_PRIVATE_KEY:-}" || -n "${FIREBASE_CLIENT_EMAIL:-}" || -n "${VERCEL:-}" ]]; then
  echo "ERROR: unsafe/stale emulator, credential, password or hosted-write environment variables present" >&2
  exit 1
fi

export GHIMS_RUNTIME_MODE=DEMO
export NEXT_PUBLIC_GHIMS_RUNTIME_MODE=DEMO
export GHIMS_DEMO_TENANT_ID="$demo_tenant"
export GHIMS_DEMO_CONFIRM_TENANT="$demo_tenant"
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
export GHIMS_INTEGRATION_AI_STATE=DISABLED
export NEXT_PUBLIC_GHIMS_DEMO_EMULATORS=false
unset GHIMS_FIREBASE_PROJECT_ID_TEST NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST
unset NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS

selected_project="$(gcloud config get-value project 2>/dev/null)"
actual_project="$(gcloud projects describe "$demo_project" --format='value(projectId)' 2>/dev/null || true)"
if [[ "$selected_project" != "$demo_project" || "$actual_project" != "$demo_project" ]]; then
  echo "ERROR: gcloud active and verified project must both be $demo_project" >&2
  echo "Select it with: gcloud config set project $demo_project" >&2
  exit 1
fi

# ADC must be obtained by the operator using `gcloud auth application-default login`.
# The G-HIMS Admin SDK explicitly requires a real path for non-Vercel ADC.
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"
if [[ ! -r "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo 'ERROR: Google Application Default Credentials file is not present or readable.' >&2
  echo 'Use: gcloud auth application-default login --project g-hims-ci-demo' >&2
  exit 1
fi

# Verify the dedicated Firestore database exists before any write. Never
# create/modify Firestore resources or rules as a side effect of seeding.
if ! gcloud firestore databases describe --database='(default)' --project="$demo_project" \
  --format='value(name)' 2>/dev/null | grep -Fxq "projects/$demo_project/databases/(default)"; then
  echo 'ERROR: target Firestore (default) database does not exist or is inaccessible' >&2
  exit 1
fi

printf 'Authorized synthetic-only target: Firebase %s, tenant %s, database (default)\n' "$demo_project" "$demo_tenant"
printf 'This operation creates 8 DEMO identities, synthetic credentials and a synthetic Patient 360 chart.\n'
printf 'No clinical validation or real patient data will be created.\n'
read -r -p "Type the exact approval: $demo_project/$demo_tenant : " confirmation
if [[ "$confirmation" != "$demo_project/$demo_tenant" ]]; then
  echo 'ERROR: target confirmation not accepted' >&2
  exit 1
fi
read -r -s -p 'Choose a unique DEMO-only password (at least 12 characters): ' GHIMS_DEMO_BOOTSTRAP_PASSWORD
echo
if [[ "${#GHIMS_DEMO_BOOTSTRAP_PASSWORD}" -lt 12 ]]; then
  echo 'ERROR: password must have at least 12 characters' >&2
  exit 1
fi
export GHIMS_DEMO_BOOTSTRAP_PASSWORD
export GHIMS_DEMO_HOSTED_WRITE_ACK=I_ACCEPT_SYNTHETIC_DEMO_WRITES

# Never log the password, ADC path contents or tokens. The bootstrap makes
# changes only inside the already-selected synthetic tenant and Firebase project.
bun run demo:provision-identities
bun run demo:clinical-intelligence
unset GHIMS_DEMO_BOOTSTRAP_PASSWORD GHIMS_DEMO_HOSTED_WRITE_ACK
echo 'G_HIMS_CI_HOSTED_SYNTHETIC_SEED=COMPLETED (verify the printed results)'
echo 'Important: Vercel still requires independently provisioned server-side Firebase Admin authentication.'
