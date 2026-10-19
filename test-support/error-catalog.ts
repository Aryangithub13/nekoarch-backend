import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * INT-B-012: the error-code catalog (docs/modernization/error-codes.json), derived from the API source with the TypeScript checker, so it lists
 * every code a response can carry and the statuses each one is sent with.
 * - `new ApiError(status, code, …)`: the code argument's type is a string literal, or a union of them. Inside `if (error instanceof XError)` the
 *   checker narrows `error.code` to XError's declared code union, so engine codes passed through are listed exactly. The status argument is a
 *   number literal (or a union), `error.code === 'C' ? a : b`, or `STATUS[error.code]` over an object literal in the same file.
 * - `new ApiError(...entry)`: the SQLSTATE tables, `{ P1234: [status, 'CODE', message] }`.
 * A site whose code or status cannot be resolved is listed under `unresolved`, so the catalog never claims more than the source shows.
 */
export type ErrorCatalog = {
  method: string;
  codes: { code: string; statuses: number[]; sources: string[] }[];
  unresolved: { file: string; expression: string; reason: string }[];
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE = /^[A-Z][A-Z0-9_]+$/;

export function errorCatalog(): ErrorCatalog {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(root, 'apps/api/tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined })!;
  const program = ts.createProgram(config.fileNames.filter(f => f.includes('/apps/api/src/')), config.options);
  const checker = program.getTypeChecker();
  const found = new Map<string, { statuses: Set<number>; sources: Set<string> }>();
  const unresolved: ErrorCatalog['unresolved'] = [];
  const add = (code: string, status: number, source: string) => {
    const entry = found.get(code) ?? { statuses: new Set(), sources: new Set() };
    entry.statuses.add(status); entry.sources.add(source); found.set(code, entry);
  };
  const literals = (node: ts.Node, flag: ts.TypeFlags): (string | number)[] | null => {
    const type = checker.getTypeAtLocation(node);
    const parts = type.isUnion() ? type.types : [type];
    return parts.every(t => t.flags & flag) ? parts.map(t => (t as ts.LiteralType).value as string | number) : null;
  };
  const objectLiteral = (file: ts.SourceFile, name: string) => {
    let result: ts.ObjectLiteralExpression | undefined;
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && ts.isObjectLiteralExpression(n.initializer)) result = n.initializer;
      ts.forEachChild(n, visit);
    };
    visit(file);
    return result;
  };
  /** The status for each code the site can send: `undefined` key means "every code of the site". */
  const statusesFor = (file: ts.SourceFile, expr: ts.Expression): Map<string | undefined, number[]> | null => {
    const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
    // Before the plain check: the type of `c === 'X' ? 409 : 422` is 409 | 422, which would give both statuses to every code.
    if (ts.isConditionalExpression(e) && ts.isBinaryExpression(e.condition) && e.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && ts.isStringLiteral(e.condition.right)) {
      const yes = literals(e.whenTrue, ts.TypeFlags.NumberLiteral), no = literals(e.whenFalse, ts.TypeFlags.NumberLiteral);
      if (yes && no) return new Map([[e.condition.right.text, yes as number[]], [undefined, no as number[]]]);
    }
    const plain = literals(e, ts.TypeFlags.NumberLiteral);
    if (plain) return new Map([[undefined, plain as number[]]]);
    const lookup = ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? e.left : e;
    const fallback = lookup !== e ? literals((e as ts.BinaryExpression).right, ts.TypeFlags.NumberLiteral) : null;
    if (ts.isElementAccessExpression(lookup) && ts.isIdentifier(lookup.expression)) {
      const table = objectLiteral(file, lookup.expression.text);
      if (table) {
        const map = new Map<string | undefined, number[]>();
        for (const p of table.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ts.isNumericLiteral(p.initializer)) map.set(p.name.text, [Number(p.initializer.text)]);
        if (fallback) map.set(undefined, fallback as number[]);
        return map;
      }
    }
    return null;
  };
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || !file.fileName.includes('/apps/api/src/')) continue;
    const rel = path.relative(root, file.fileName);
    const visit = (node: ts.Node) => {
      // SQLSTATE tables: { P1234: [status, 'CODE', message] }.
      if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && /^[0-9A-Z]{5}$/.test(node.name.text)
        && ts.isArrayLiteralExpression(node.initializer)) {
        const [status, code] = node.initializer.elements;
        if (status && code && ts.isNumericLiteral(status) && ts.isStringLiteral(code) && CODE.test(code.text)) add(code.text, Number(status.text), rel);
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ApiError' && node.arguments?.length) {
        // File and expression, not a line number, so unrelated edits do not churn the catalog.
        const site = { file: rel, expression: node.getText(file).replace(/\s+/g, ' ').slice(0, 160) };
        const [statusArg, codeArg] = node.arguments;
        if (ts.isSpreadElement(statusArg!) && !codeArg) return; // `new ApiError(...entry)`: a SQLSTATE table entry, read above.
        const codes = codeArg ? literals(codeArg, ts.TypeFlags.StringLiteral) as string[] | null : null;
        const statuses = statusArg && !ts.isSpreadElement(statusArg) ? statusesFor(file, statusArg) : null;
        if (!codes) unresolved.push({ ...site, reason: `code is ${checker.typeToString(checker.getTypeAtLocation(codeArg ?? statusArg!))}, not a literal or literal union` });
        else if (!statuses) unresolved.push({ ...site, reason: `status \`${statusArg!.getText(file)}\` is ${checker.typeToString(checker.getTypeAtLocation(statusArg!))}, not a literal` });
        else for (const code of codes) for (const status of statuses.get(code) ?? statuses.get(undefined) ?? []) add(code, status, rel);
        if (codes && statuses && codes.some(code => !statuses.has(code) && !statuses.has(undefined))) unresolved.push({ ...site, reason: 'a code has no status' });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return {
    method: 'Generated from apps/api/src by test-support/error-catalog.ts (TypeScript checker): every new ApiError(status, code) site and every SQLSTATE table entry',
    codes: [...found].map(([code, e]) => ({ code, statuses: [...e.statuses].sort((a, b) => a - b), sources: [...e.sources].sort() })).sort((a, b) => a.code.localeCompare(b.code, 'en')),
    unresolved: unresolved.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.expression.localeCompare(b.expression, 'en')),
  };
}
