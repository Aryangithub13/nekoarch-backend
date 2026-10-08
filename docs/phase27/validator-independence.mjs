// Release gate G-indep (design §16): the independent validator must not reach evaluator logic, transitively.
import console from 'node:console';
import { readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import path from 'node:path';

const root = process.cwd(), knowledge = path.join(root, 'apps/api/src/knowledge');
const start = path.join(knowledge, 'validate.ts');
const FORBIDDEN = ['facts.ts', 'evaluate.ts', 'conflicts.ts', 'units.ts'].map(f => path.join(knowledge, f));
const imports = file => [...readFileSync(file, 'utf8').matchAll(/^\s*import\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map(m => ({ typeOnly: !!m[1], spec: m[2] }));
const resolve = (from, spec) => spec.startsWith('.') ? path.resolve(path.dirname(from), spec.replace(/\.js$/, '.ts')) : null;

const violations = [], reached = new Set(), stack = [start];
// Direct imports of the validator: only contracts (data), schema-only phase contracts, hashing and zod-free package constants.
for (const { typeOnly, spec } of imports(start)) {
  const target = resolve(start, spec);
  const allowed = target ? /\/(knowledge|bim|structural|environmental|systems)\/contracts\.ts$/.test(target)
    : ['node:crypto', '@designflow/boq-cost', '@designflow/quantity-takeoff'].includes(spec) || (typeOnly && spec === '@designflow/shared');
  if (!allowed) violations.push(`validate.ts imports ${spec}`);
}
while (stack.length) {
  const file = stack.pop();
  if (reached.has(file)) continue;
  reached.add(file);
  for (const { spec } of imports(file)) { const next = resolve(file, spec); if (next) stack.push(next); }
}
for (const f of FORBIDDEN) if (reached.has(f)) violations.push(`validate.ts transitively reaches ${path.relative(root, f)}`);
for (const f of readdirSync(knowledge).filter(f => f.endsWith('.ts'))) {
  const src = readFileSync(path.join(knowledge, f), 'utf8');
  if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) violations.push(`${f} contains eval or new Function`);
}
const out = { ok: violations.length === 0, reached: [...reached].map(f => path.relative(root, f)).sort(), violations };
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
