import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateG1ProbeConfig } from '../services/g1-swp-probe/probe.mjs';

const base = {
  HELIXIS_G1_DISPOSABLE_LAB: 'true',
  GHIMS_RUNTIME_MODE: 'STAGING',
  GOOGLE_CLOUD_PROJECT: 'studio-1130431360-48a05',
  GHIMS_INTEGRATION_FHIR_R4_STATE: 'DISABLED',
  GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED: 'false',
};
test('G1: only fixed public synthetic origin probes are accepted', () => {
  for (const c of ['approved-origin','unapproved-origin','wrong-sni','missing-sni','wrong-port','direct-ip']) {
    const result=validateG1ProbeConfig(base,[c]);
    assert.equal(result.testCase,c);
    assert.ok(['fhir.epic.com','example.com'].includes(result.hostname));
  }
  for (const arg of ['http://evil.test','https://metadata.google.internal','--host=169.254.169.254','g1-bypass']) {
    assert.throws(()=>validateG1ProbeConfig(base,[arg]),/G1_PROBE_CASE_NOT_APPROVED/);
  }
  assert.throws(()=>validateG1ProbeConfig(base,['approved-origin','other']),/G1_PROBE_CASE_NOT_APPROVED/);
});
test('G1: production, FHIR live, unapproved projects and absent consent marker cannot probe',()=>{
  const invalid=[
    {HELIXIS_G1_DISPOSABLE_LAB:'false'},
    {GHIMS_RUNTIME_MODE:'PRODUCTION'},
    {GOOGLE_CLOUD_PROJECT:'g-hims-ai'},
    {GHIMS_INTEGRATION_FHIR_R4_STATE:'LIVE'},
    {GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED:'true'},
  ];
  for (const variant of invalid) {
    assert.throws(()=>validateG1ProbeConfig({...base,...variant},['approved-origin']),
      /G1_PROBE_DISPOSABLE_SYNTHETIC_ONLY/);
  }
});
test('G1: no bearer, FHIR payload, secret or browser code in probe',()=>{
  const content=readFileSync('services/g1-swp-probe/probe.mjs','utf8');
  assert.doesNotMatch(content,/process\.env\.(?:GOOGLE_APPLICATION_CREDENTIALS|EPIC_CLIENT_SECRET|FHIR_ACCESS_TOKEN)/);
  assert.doesNotMatch(content,/\bfetch\s*\(/);
  assert.doesNotMatch(content,/Authorization\s*:/);
  assert.match(content,/productionRelease: 'NO_GO'/);
});
