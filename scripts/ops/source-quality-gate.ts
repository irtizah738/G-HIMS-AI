import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOTS = ['app', 'components', 'lib', 'server', 'types', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const FORBIDDEN = [
  { id: 'MERGE_CONFLICT', regex: /^(?:<<<<<<<|=======|>>>>>>>)/m },
  { id: 'TS_NOCHECK', regex: /@ts-nocheck\b/ },
  { id: 'DYNAMIC_EVAL', regex: /\beval\s*\(/ },
  { id: 'DYNAMIC_FUNCTION', regex: /\bnew\s+Function\s*\(/ },
  { id: 'FAIL_OPEN_FIRESTORE', regex: /allow\s+(?:read|write|read,\s*write)\s*:\s*if\s+true\b/ },
];

async function collect(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

const files: string[] = [];
for (const root of ROOTS) await collect(path.join(process.cwd(), root), files);

const findings: Array<{
  file: string;
  kind: string;
  line?: number;
  message: string;
}> = [];

for (const file of files.sort()) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');

  for (const rule of FORBIDDEN) {
    // The quality gate necessarily contains literal representations of the
    // forbidden patterns it is looking for. Do not self-report those rule
    // definitions, but still parse this file for syntax diagnostics below.
    if (relative === 'scripts/ops/source-quality-gate.ts') break;
    const match = source.match(rule.regex);
    if (match?.index !== undefined) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      findings.push({
        file: relative,
        kind: rule.id,
        line,
        message: `Forbidden source pattern: ${rule.id}`,
      });
    }
  }

  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  });

  for (const diagnostic of result.diagnostics || []) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    findings.push({
      file: relative,
      kind: 'TYPESCRIPT_PARSE',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    });
  }
}

if (findings.length > 0) {
  process.stderr.write(
    JSON.stringify({ success: false, findingCount: findings.length, findings }, null, 2) +
      '\n'
  );
  process.exit(1);
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      scannedSourceFiles: files.length,
      rules: FORBIDDEN.map((rule) => rule.id),
    },
    null,
    2
  ) + '\n'
);
