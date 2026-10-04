import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { generateBlueprintV2, generateParametricBlueprint, normalizeParametricRequirements, modifyParametricRequirements } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { parametricInput } from '../test-support/parametric-fixtures.js';
import { solverInput } from '../test-support/solver-v2-fixtures.js';
import { projectQaOptions } from '../apps/api/src/services/project-service.js';
import { parametricQaOptions } from '../apps/api/src/services/parametric-qa.js';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
const maximum = parametricInput();
maximum.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
Object.assign(maximum.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 });
maximum.rooms = [{ type: 'bedroom', count: 24 }];
const cases = [
  { name: 'rectangular-v2-baseline', v2: true, input: solverInput() },
  { name: 'L-four-rooms', input: parametricInput() },
  { name: 'L-widened-west', input: modifyParametricRequirements(parametricInput(), { level: 0, parameter: 'westWingWidthMm', valueMm: 10000 }) },
  { name: 'two-floor-setback', input: parametricInput(true) },
  { name: 'dense-minimums', input: { ...parametricInput(), rooms: [{ type: 'bedroom', count: 4, minWidthMm: 3000, minDepthMm: 3000 }] } },
  { name: 'maximum-24-rooms', input: maximum },
  { name: 'infeasible-width', input: { ...parametricInput(), circulationWidthMm: 59000 } },
  { name: 'operation-exhaustion', input: { ...parametricInput(), solver: { maxIterations: 1 } } },
];
const rows = [];
for (const item of cases) for (let repeat = 0; repeat < 3; repeat++) {
  const start = performance.now(), before = process.memoryUsage().heapUsed;
  try {
    const result = item.v2 ? generateBlueprintV2(item.input) : generateParametricBlueprint(item.input), generated = performance.now();
    const report = auditBlueprint(result.model, { ...projectQaOptions(result.model), ...(!item.v2 ? parametricQaOptions(normalizeParametricRequirements(item.input)) : {}) });
    if (report.status === 'FAIL') throw new Error(`Independent QA failed: ${report.findings.filter(f => f.severity === 'ERROR').map(f => f.code).join(',')}`);
    rows.push({ case: item.name, repeat, outcome: report.status, generationMs: generated - start, qaMs: performance.now() - generated, fullMs: performance.now() - start,
      heapDeltaBytes: process.memoryUsage().heapUsed - before, rssBytes: process.memoryUsage().rss, candidateCount: result.metadata.candidateAttempts, operations: result.metadata.iterations,
      modelHash: modelHash(result.model), phases: 'timingsMs' in result.diagnostics ? result.diagnostics.timingsMs : null });
  } catch (error) {
    rows.push({ case: item.name, repeat, outcome: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'ERROR', message: error instanceof Error ? error.message : '', fullMs: performance.now() - start });
  }
}
await mkdir('docs/phase22-evidence', { recursive: true });
await writeFile('docs/phase22-evidence/benchmark.json', JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, measurements: rows }, null, 2) + '\n');
console.log(JSON.stringify(rows));
if (rows.some(r => r.outcome === 'ERROR' || (!['infeasible-width', 'operation-exhaustion'].includes(r.case) && !r.outcome.startsWith('PASS')))) process.exitCode = 1;
