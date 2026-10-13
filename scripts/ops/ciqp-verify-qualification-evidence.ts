/**
 * Offline CIQP-05 evidence completeness audit.
 *
 * No network, Firestore writes, patient data reads or release authorizations.
 * Even a complete manifest requires independent artifact/signature validation.
 */
import { readFile } from 'node:fs/promises';
import {
  assessCiqpQualificationEvidence,
  type CiqpQualificationEvidence,
} from '@/lib/clinical/patient360/ciqp-qualification-evidence';

export async function verifyCiqpEvidenceManifest(filePath: string): Promise<void> {
  if (!filePath || !filePath.endsWith('.json')) {
    throw new Error('CIQP_EVIDENCE_JSON_FILE_REQUIRED');
  }
  const data = JSON.parse(await readFile(filePath, 'utf8')) as CiqpQualificationEvidence;
  const report = assessCiqpQualificationEvidence(data);
  console.log(JSON.stringify(report, null, 2));
  if (report.documentationStatus === 'INCOMPLETE') process.exitCode = 1;
}

if (import.meta.main) {
  verifyCiqpEvidenceManifest(String(process.argv[2] || '')).catch(() => {
    // Untrusted input contents and file paths must not enter CI logs.
    console.error('CIQP_EVIDENCE_MANIFEST_INVALID');
    process.exitCode = 1;
  });
}
