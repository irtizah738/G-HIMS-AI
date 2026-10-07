import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const binaryExtensions = /\.(?:png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz|tgz|lock)$/i;
const patterns = [
  { id: 'PRIVATE_KEY', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'GITHUB_CLASSIC_TOKEN', regex: /\bghp_[A-Za-z0-9]{30,}\b/ },
  { id: 'GITHUB_FINE_GRAINED_TOKEN', regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { id: 'AWS_ACCESS_KEY', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'SLACK_TOKEN', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  {
    id: 'NONEMPTY_SECRET_ASSIGNMENT',
    regex:
      /(?:FIREBASE_PRIVATE_KEY|GEMINI_API_KEY|GHIMS_HL7_INGEST_API_KEY|GHIMS_DEVICE_TELEMETRY_INGEST_API_KEY|GHIMS_EDI_CLEARINGHOUSE_API_KEY|GHIMS_EDI_835_INGEST_API_KEY)\s*=\s*[^\s#]{8,}/,
  },
];

const findings: Array<{ file: string; line: number; pattern: string }> = [];

for (const file of files) {
  if (binaryExtensions.test(file) || file.startsWith('node_modules/')) continue;

  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    continue;
  }

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of patterns) {
      if (pattern.regex.test(lines[index])) {
        findings.push({
          file,
          line: index + 1,
          pattern: pattern.id,
        });
      }
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(
    JSON.stringify(
      {
        success: false,
        findingCount: findings.length,
        findings,
        note: 'Secret values are intentionally omitted from scanner output.',
      },
      null,
      2
    ) + '\n'
  );
  process.exit(1);
}

process.stdout.write(
  JSON.stringify({ success: true, scannedFiles: files.length }, null, 2) + '\n'
);
