import { readFile } from 'node:fs/promises';
import { ClinicalIntelligenceClinicalEvaluator } from '../../lib/clinical/intelligence/clinical-evaluation-framework';
import type { ClinicalEvaluationDataset } from '../../types/clinical-intelligence-evaluation';

const path = String(process.argv[2] || '').trim();
if (!path) {
  throw new Error(
    'CI_EVALUATION_DATASET_PATH_REQUIRED: usage bun run ops:ci:evaluate <dataset.json>'
  );
}

const dataset = JSON.parse(
  await readFile(path, 'utf8')
) as ClinicalEvaluationDataset;

const report = ClinicalIntelligenceClinicalEvaluator.evaluate(dataset);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');

if (!report.passed) {
  process.exitCode = 1;
}
