/**
 * ORC-6: executable inventory, not a production-readiness endorsement.
 * The canonical 52-domain directory is a UI registry and must never be
 * interpreted as evidence that any domain has been hydrated or qualified.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

export interface OrcDomainEvidenceRow {
  domainNumber: number;
  id: string;
  name: string;
  registryStatus: string;
  uiTarget?: string;
  operationalQualification: 'UNVERIFIED';
}

function property(
  node: ts.ObjectLiteralExpression,
  key: string
): ts.Expression | undefined {
  const found = node.properties.find(
    (member) =>
      ts.isPropertyAssignment(member) &&
      ((ts.isIdentifier(member.name) && member.name.text === key) ||
        (ts.isStringLiteral(member.name) && member.name.text === key))
  );
  return found && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}

function literalString(node?: ts.Expression): string {
  return node && ts.isStringLiteral(node) ? node.text : '';
}

export function auditDomainRegistry(
  text: string
): OrcDomainEvidenceRow[] {
  const tree = ts.createSourceFile(
    'all-modules-directory.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const rows: OrcDomainEvidenceRow[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const number = property(node, 'domainNumber');
      if (number) {
        if (!ts.isNumericLiteral(number)) {
          throw new Error('ORC_DOMAIN_NUMBER_NOT_LITERAL');
        }
        const domainNumber = Number(number.text);
        const id = literalString(property(node, 'id'));
        const name = literalString(property(node, 'name'));
        const registryStatus = literalString(property(node, 'status'));
        const uiTarget =
          literalString(property(node, 'targetTab')) ||
          literalString(property(node, 'directHref')) ||
          undefined;
        if (!id || !name || !registryStatus) {
          throw new Error('ORC_DOMAIN_REGISTRY_INVALID:' + domainNumber);
        }
        rows.push({
          domainNumber, id, name, registryStatus, uiTarget,
          operationalQualification: 'UNVERIFIED',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

  const numbers = rows.map((x) => x.domainNumber).sort((a,b)=>a-b);
  const ids = new Set(rows.map((x) => x.id));
  if (
    rows.length !== 52 ||
    ids.size !== 52 ||
    numbers.some((value, i) => value !== i + 1)
  ) {
    throw new Error('ORC_DOMAIN_COVERAGE_INVALID: expected exactly 52 unique numbered domains');
  }
  return rows.sort((a,b)=>a.domainNumber-b.domainNumber);
}

if (import.meta.main) {
  const input = readFileSync(
    join(process.cwd(), 'components/views/all-modules-directory.tsx'),
    'utf8'
  );
  process.stdout.write(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      registryCount: 52,
      evidenceScope: 'UI_REGISTRY_ONLY',
      hydrationSurfaces: 8,
      operationalQualification: 'NOT_ASSERTED',
      domains: auditDomainRegistry(input),
    }, null, 2) + '\n'
  );
}
