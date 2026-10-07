import * as ts from 'typescript';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface Finding {
  file: string;
  line: number;
  column: number;
  rule: string;
  message: string;
}

const ROOTS = ['app', 'components', 'lib', 'server'];
const findings: Finding[] = [];

async function collect(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(full);
    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) return [full];
    return [];
  }));
  return nested.flat();
}

function location(sourceFile: ts.SourceFile, node: ts.Node) {
  const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: point.line + 1, column: point.character + 1 };
}

function report(sourceFile: ts.SourceFile, node: ts.Node, rule: string, message: string) {
  const loc = location(sourceFile, node);
  findings.push({
    file: path.relative(process.cwd(), sourceFile.fileName).replaceAll('\\', '/'),
    ...loc,
    rule,
    message,
  });
}

function isIdentifierText(node: ts.Node | undefined, value: string): boolean {
  return Boolean(node && ts.isIdentifier(node) && node.text === value);
}

function scan(sourceFile: ts.SourceFile) {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (['child_process', 'node:child_process'].includes(node.moduleSpecifier.text)) {
        report(
          sourceFile,
          node,
          'GHIMS-SAST-001',
          'Runtime application code must not invoke operating-system child processes.'
        );
      }
    }

    if (ts.isCallExpression(node)) {
      if (isIdentifierText(node.expression, 'eval')) {
        report(sourceFile, node, 'GHIMS-SAST-002', 'eval() is forbidden in trusted runtime code.');
      }

      if (
        ts.isPropertyAccessExpression(node.expression) &&
        isIdentifierText(node.expression.expression, 'document') &&
        node.expression.name.text === 'write'
      ) {
        report(sourceFile, node, 'GHIMS-SAST-003', 'document.write() is forbidden.');
      }
    }

    if (
      ts.isNewExpression(node) &&
      isIdentifierText(node.expression, 'Function')
    ) {
      report(sourceFile, node, 'GHIMS-SAST-004', 'Dynamic Function construction is forbidden.');
    }

    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === 'dangerouslySetInnerHTML'
    ) {
      report(
        sourceFile,
        node,
        'GHIMS-SAST-005',
        'dangerouslySetInnerHTML requires a dedicated reviewed sanitizer boundary and is forbidden by default.'
      );
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'innerHTML'
    ) {
      report(sourceFile, node, 'GHIMS-SAST-006', 'Direct innerHTML assignment is forbidden.');
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

const files = (await Promise.all(ROOTS.map(collect))).flat().sort();
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  scan(sourceFile);
}

await mkdir('artifacts/security', { recursive: true });
await writeFile(
  'artifacts/security/sast-findings.json',
  JSON.stringify({ scannedFiles: files.length, findings }, null, 2) + '\n',
  'utf8'
);

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} ${finding.rule} ${finding.message}`
    );
  }
  console.error(`SAST failed with ${findings.length} finding(s).`);
  process.exit(1);
}

console.log(`SAST passed: ${files.length} runtime TypeScript/TSX files scanned; 0 findings.`);
