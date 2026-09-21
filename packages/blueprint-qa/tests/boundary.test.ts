import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
it('production dependency boundary contains only QA files, generic V2 contracts and Zod', () => {
  const dir = new URL('../src/', import.meta.url), files = readdirSync(dir).filter(f => f.endsWith('.ts'));
  const permittedShared = new Set(['BuildingModelShapeSchema', 'EntityIdSchema', 'LengthMmSchema', 'MAX_MM', 'cross', 'onSegment', 'pointLocation', 'segmentsCross', 'segmentInRing', 'ringContains', 'ringsOverlap']);
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    expect(source).not.toMatch(/@designflow\/generator|blueprint\/validation|analyzeCirculation|validateBlueprint|dimensionMeasurements|wallSpaceIds/);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const path = node.moduleSpecifier.text;
        expect(path === '@designflow/shared' || path === 'zod' || /^\.\/[^/]+\.js$/.test(path)).toBe(true);
        if (path === '@designflow/shared' && ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
          const bindings = node.importClause.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) if (!e.isTypeOnly) expect(permittedShared.has(e.propertyName?.text ?? e.name.text)).toBe(true);
        }
      }
      if (ts.isCallExpression(node)) {
        expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        if (ts.isIdentifier(node.expression)) expect(['require', 'eval', 'Function']).not.toContain(node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
  expect(Object.keys(pkg.dependencies).sort()).toEqual(['@designflow/shared', 'zod']);
});
