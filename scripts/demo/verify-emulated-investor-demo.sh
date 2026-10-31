#!/usr/bin/env bash
# Isolated G-HIMS AI investor-demo smoke test. Intended for GitHub Actions
# with Firebase Auth + Firestore emulators; never write to hosted Firebase.
set -euo pipefail

test "${GHIMS_RUNTIME_MODE:-}" = DEMO
test "${NEXT_PUBLIC_GHIMS_RUNTIME_MODE:-}" = DEMO
test "${FIREBASE_PROJECT_ID:-}" = ghims-investor-demo-2026
test "${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-}" = ghims-investor-demo-2026
test "${GHIMS_FIREBASE_PROJECT_ID_DEMO:-}" = ghims-investor-demo-2026
test "${NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO:-}" = ghims-investor-demo-2026
test "${GHIMS_DEMO_CONFIRM_TENANT:-}" = central-metro-hospital
test "${GHIMS_DEMO_TENANT_ID:-}" = central-metro-hospital
test "${FIREBASE_AUTH_EMULATOR_HOST:-}" = 127.0.0.1:9099
test "${FIRESTORE_EMULATOR_HOST:-}" = 127.0.0.1:8080
test "${NEXT_PUBLIC_GHIMS_DEMO_EMULATORS:-}" = true
test -z "${GHIMS_DEMO_HOSTED_WRITE_ACK:-}"
test -n "${GHIMS_DEMO_BOOTSTRAP_PASSWORD:-}"

bun run demo:provision-identities > /tmp/ci-investor-demo-identities.json
bun run demo:clinical-intelligence > /tmp/ci-investor-demo-projection.json

# Verify the synthetic data was actually created and Patient 360 projection built.
node - <<'NODE'
const fs = require('node:fs');
const identities = JSON.parse(fs.readFileSync('/tmp/ci-investor-demo-identities.json','utf8'));
const projection = JSON.parse(fs.readFileSync('/tmp/ci-investor-demo-projection.json','utf8'));
if (!identities.success || !projection.success || !projection.syntheticOnly ||
    projection.patientId !== 'demo-ci-patient-001' ||
    projection.tenantId !== 'central-metro-hospital' ||
    identities.users.length !== 8 ||
    !projection.patient360 || !projection.patient360.revision) {
  throw new Error('INVESTOR_DEMO_SEED_OR_PROJECTION_NOT_READY');
}
process.stdout.write('SYNTHETIC_DEMO_SEED_AND_PROJECTION=PASS\n');
NODE

curl --silent --show-error --fail \
  'http://127.0.0.1:8080/v1/projects/ghims-investor-demo-2026/databases/(default)/documents/tenants/central-metro-hospital/patients/demo-ci-patient-001' \
  -o /tmp/ci-investor-demo-patient.json
node - <<'NODE'
const fs = require('node:fs');
const doc = JSON.parse(fs.readFileSync('/tmp/ci-investor-demo-patient.json','utf8'));
if (doc.fields?.fullName?.stringValue !== 'Amina Shah (Synthetic)' ||
    doc.fields?.mrn?.stringValue !== 'CI-DEMO-001' ||
    doc.fields?.syntheticDemoRecord?.booleanValue !== true) {
  throw new Error('INVESTOR_DEMO_PATIENT_NOT_SYNTHETIC');
}
process.stdout.write('SYNTHETIC_DEMO_PATIENT=PASS\n');
NODE

# The actual Next.js route must build/respond under DEMO runtime.
bun run dev > /tmp/ci-investor-demo-next.log 2>&1 &
next_pid=$!
cleanup() {
  kill "$next_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT
ok=0
for i in $(seq 1 72); do
  if curl --silent --show-error --fail --max-time 6 \
    'http://127.0.0.1:3000/central-metro-hospital/clinical-intelligence' \
    -o /tmp/ci-investor-demo-landing.html 2>/dev/null; then
    ok=1
    break
  fi
  if ! kill -0 "$next_pid" 2>/dev/null; then
    tail -n 60 /tmp/ci-investor-demo-next.log >&2
    exit 1
  fi
  sleep 2
done
if [[ $ok -ne 1 ]]; then
  tail -n 60 /tmp/ci-investor-demo-next.log >&2
  echo 'INVESTOR_DEMO_NEXT_ROUTE_NOT_READY' >&2
  exit 1
fi
grep -q 'G-HIMS Clinical Intelligence' /tmp/ci-investor-demo-landing.html
grep -q 'Amina Shah (Synthetic)' /tmp/ci-investor-demo-landing.html
grep -q 'SYNTHETIC DEMO' /tmp/ci-investor-demo-landing.html

curl --silent --show-error --fail --max-time 20 \
  'http://127.0.0.1:3000/api/auth/facilities' \
  -o /tmp/ci-investor-demo-facilities.json
node - <<'NODE'
const fs=require('node:fs');
const data=JSON.parse(fs.readFileSync('/tmp/ci-investor-demo-facilities.json','utf8'));
if (!Array.isArray(data.facilities) ||
    !data.facilities.some(x=>x.tenantId==='central-metro-hospital')) {
  throw new Error('INVESTOR_DEMO_TENANT_DIRECTORY_NOT_READY');
}
process.stdout.write('INVESTOR_DEMO_FACILITY_DIRECTORY=PASS\n');
NODE

mkdir -p artifacts/investor-demo
# Exact application URL and real rendered browser screenshot; no simulated UI.
bunx playwright screenshot --browser chromium --wait-for-timeout 1800 --full-page \
  'http://127.0.0.1:3000/central-metro-hospital/clinical-intelligence' \
  artifacts/investor-demo/clinical-intelligence-landing-synthetic.png

test -s artifacts/investor-demo/clinical-intelligence-landing-synthetic.png
echo 'INVESTOR_DEMO_REAL_APP_LANDING_SCREENSHOT=PASS'
echo 'INVESTOR_DEMO_EMULATOR_SMOKE=PASS'
