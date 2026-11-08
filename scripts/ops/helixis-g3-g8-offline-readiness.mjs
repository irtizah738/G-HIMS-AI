/**
 * Source-only offline G3–G8 qualification report. No network or cloud mutations.
 * Node 22: node --experimental-strip-types scripts/ops/helixis-g3-g8-offline-readiness.mjs <dossier.json>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateG3G8Offline } from '../../lib/clinical/intelligence/external-fhir-g3-g8-qualification.ts';

const file = process.argv[2];
if (!file || process.argv.length !== 3) {
  console.error('USAGE: node --experimental-strip-types scripts/ops/helixis-g3-g8-offline-readiness.mjs <metadata-only-dossier.json>');
  process.exitCode = 2;
} else {
  try {
    const data = JSON.parse(readFileSync(resolve(file), 'utf8'));
    const evaluation = evaluateG3G8Offline(data);
    const report = {
      scope: evaluation.scope,
      gateStates: evaluation.gates.map(g => ({
        gate: g.gate, status: g.status, passedControls: g.passedControls,
        requiredControls: g.requiredControls,
      })),
      blockers: evaluation.blockers,
      dossierSha256: evaluation.evidenceFingerprint,
      offlineStatus: evaluation.status,
      productionDecision: evaluation.productionDecision,
      cloudMutations: 'NONE',
      featureFlagsChanged: false,
      limitation: 'Self-reported dossier metadata is not independently authenticated; never authorize deployment from this report.',
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    // For CI, only the synthetic qualification module can pass its own tests.
    // Missing evidence and cost-gated work intentionally fail this CLI.
    if (evaluation.status === 'BLOCKED') process.exitCode = 2;
  } catch (err) {
    console.error('G3_G8_OFFLINE_REPORT_FAILED:',err instanceof Error?err.message:'UNKNOWN');
    process.exitCode = 2;
  }
}
