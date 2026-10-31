/**
 * Local-only case adjudication integrity inspection.
 * Outputs coded counts and blockers only. Never a clinical clearance.
 */
import { readFile, stat } from 'node:fs/promises';
import { assessCiqpCaseAdjudication, type CiqpCaseAdjudication } from
  '@/lib/clinical/intelligence/ciqp-model-output-adjudication';

const path = String(process.argv[2] || '').trim();
if (!path) throw new Error('CIQP_ADJUDICATION_INPUT_PATH_REQUIRED');
const file = await stat(path);
if (!file.isFile() || file.size <= 0 || file.size > 4 * 1024 * 1024) {
  throw new Error('CIQP_ADJUDICATION_INPUT_SIZE_INVALID');
}
let report;
try {
  const input = JSON.parse(await readFile(path, 'utf8')) as CiqpCaseAdjudication;
  report = assessCiqpCaseAdjudication(input);
} catch {
  // No input text or personal/medical data in error logs.
  throw new Error('CIQP_ADJUDICATION_INPUT_PARSE_OR_VALIDATION_FAILURE');
}
const { caseId: _caseId, receiptSha256: _receipt, ...safe } = report;
process.stdout.write(JSON.stringify({
  ...safe,
  evidenceClass: 'CASE_REVIEW_METADATA_NOT_CLINICAL_CLEARANCE',
  externalCredentialVerification: 'NOT_PERFORMED',
  institutionalAuthorization: 'NOT_VERIFIED',
}, null, 2) + '\n');
if (report.status !== 'AWAITING_EXTERNAL_INSTITUTIONAL_VERIFICATION') {
  process.exitCode = 1;
}
