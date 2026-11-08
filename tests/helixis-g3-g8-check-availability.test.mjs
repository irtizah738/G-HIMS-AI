/**
 * Static release-governance assertions for the source-only workflow.
 * Not a substitute for GitHub's active ruleset or human approval.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/helixis-g3-g8-offline-qualification.yml', import.meta.url),
  'utf8',
);

test('G3-G8 workflow runs on every pull request targeting main, without path filters',()=>{
  assert.match(workflow,/^on:\n(?:  #[^\n]*\n)*  pull_request:\n    branches: \[main\]\n\npermissions:/m);
  const header=workflow.split(/^permissions:/m)[0];
  assert.equal(/\n\s+(?:paths|paths-ignore|types):/.test(header),false);
});
test('G3-G8 qualification has only read-only token permission',()=>{
  assert.match(workflow,/^permissions:\n  contents: read\n\nconcurrency:/m);
  assert.equal(/\n\s+id-token:\s*write/.test(workflow),false);
  assert.equal(/\n\s+secrets:/.test(workflow),false);
});
test('G3-G8 both stable required-check candidates exist as real jobs',()=>{
  assert.match(workflow,/^  synthetic-contracts:\n    name: G3-G8 offline contracts, security and typecheck/m);
  assert.match(workflow,/^  firestore-emulator:\n    name: G3-G8 atomicity and synthetic recovery emulator\n    needs: synthetic-contracts/m);
  assert.equal((workflow.match(/name: G3-G8 offline contracts, security and typecheck/g)||[]).length,1);
  assert.equal((workflow.match(/name: G3-G8 atomicity and synthetic recovery emulator/g)||[]).length,1);
});
test('G3-G8 remains test-only and cannot authorize production',()=>{
  assert.match(workflow,/GHIMS_RUNTIME_MODE: TEST/);
  assert.match(workflow,/FIREBASE_PROJECT_ID: ghims-p4-ci/);
  assert.match(workflow,/FIRESTORE_EMULATOR_HOST: '127\.0\.0\.1:8080'/);
  assert.match(workflow,/GHIMS_INTEGRATION_FHIR_R4_STATE: DISABLED/);
  assert.match(workflow,/GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED: 'false'/);
  assert.match(workflow,/PRODUCTION_RELEASE=NO_GO/);
  assert.doesNotMatch(workflow,/\b(?:gcloud|google-github-actions\/auth|firebase deploy|deploy --only)\b/i);
});
