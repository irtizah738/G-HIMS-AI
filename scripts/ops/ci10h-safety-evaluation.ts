import { runClinicalSafetyReleaseSuite } from '@/lib/clinical/intelligence/clinical-safety-evaluation-suite';

const report = runClinicalSafetyReleaseSuite(Date.now());

console.log(JSON.stringify(report, null, 2));

if (!report.passed) {
  console.error('CI10H_SAFETY_RELEASE_GATE_FAILED');
  process.exit(1);
}

console.log(
  [
    'CI10H_SAFETY_RELEASE_GATE_PASSED',
    `cases=${report.caseCount}`,
    `unsafeBlockRate=${report.unsafeCaseBlockRate}`,
    `safePassRate=${report.safeCasePassRate}`,
    `hallucination=${report.hallucinationContainmentRate}`,
    `omission=${report.criticalOmissionContainmentRate}`,
    `promptInjection=${report.promptInjectionContainmentRate}`,
    `staleEvidence=${report.staleEvidenceContainmentRate}`,
    `providerDegradation=${report.providerDegradationContainmentRate}`,
    `medicationSafety=${report.medicationSafetyContainmentRate}`,
  ].join(' ')
);
