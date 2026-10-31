#!/usr/bin/env bash
# This harness must run *inside* firebase emulators:exec with disposable fixtures.
# Never execute against staging, production or a hosted Firestore project.
set -euo pipefail

test "${GHIMS_RUNTIME_MODE:-}" = TEST
test "${NEXT_PUBLIC_GHIMS_RUNTIME_MODE:-}" = TEST
test "${NODE_ENV:-}" = development
test "${FIREBASE_PROJECT_ID:-}" = ghims-dev-sandbox-local
test "${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-}" = ghims-dev-sandbox-local
test "${GHIMS_FIREBASE_PROJECT_ID_TEST:-}" = ghims-dev-sandbox-local
test "${NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST:-}" = ghims-dev-sandbox-local
test "${GHIMS_DEV_SANDBOX_TENANT_ID:-}" = dev-sandbox-hospital
test "${GHIMS_DEV_SANDBOX_ACK:-}" = I_CONFIRM_DISPOSABLE_LOCAL_EMULATORS_ONLY
test "${NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS:-}" = true
test "${FIREBASE_AUTH_EMULATOR_HOST:-}" = 127.0.0.1:9099
test "${FIRESTORE_EMULATOR_HOST:-}" = 127.0.0.1:8080
test -z "${GOOGLE_APPLICATION_CREDENTIALS:-}"
test -z "${FIREBASE_SERVICE_ACCOUNT_KEY:-}"
test "${#GHIMS_DEV_SANDBOX_PASSWORD}" -ge 16

bun run dev:sandbox:seed >/tmp/ciqp-clinician-seed.log
bun run dev:sandbox:verify >/tmp/ciqp-clinician-verify.log
bun run dev:sandbox:rehearse >/tmp/ciqp-clinician-rehearse.log
bun scripts/ci/seed-synthetic-clinician-browser-patient.ts >/tmp/ciqp-clinician-patient360.log
bun scripts/ci/seed-synthetic-clinician-browser-draft.ts >/tmp/ciqp-clinician-draft-fixture.log

bun run dev --hostname 127.0.0.1 > /tmp/ciqp-clinician-next.log 2>&1 &
next_pid=$!
cleanup() { kill "$next_pid" >/dev/null 2>&1 || true; }
trap cleanup EXIT

ready=0
for i in $(seq 1 90); do
  if curl -sS -f --max-time 5 http://127.0.0.1:3000/api/health -o /dev/null 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$next_pid" 2>/dev/null; then
    tail -n 80 /tmp/ciqp-clinician-next.log >&2
    exit 1
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  tail -n 80 /tmp/ciqp-clinician-next.log >&2
  echo CIQP_CLINICIAN_APP_NOT_READY >&2
  exit 1
fi

bunx playwright test --config playwright.ciqp-clinician.config.ts
echo CIQP_AUTHENTICATED_CLINICIAN_BROWSER=PASS
