import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { generateBlueprint, generateBlueprintV2, generateParametricBlueprint, modifyParametricRequirements } from '@designflow/generator';
import { parametricInput } from '../test-support/parametric-fixtures.js';
import { solverInput } from '../test-support/solver-v2-fixtures.js';
import { environmentalInput, syntheticWeather } from '../test-support/environmental-fixtures.js';
import { authored } from '../packages/blueprint-qa/tests/fixtures.js';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { digest } from '../apps/api/src/bim/core.js';
import { projectBim } from '../apps/api/src/bim/project.js';
import { EnvironmentalInputSchema, SnapshotSchema, CLAIMS, LIMITATIONS } from '../apps/api/src/environmental/contracts.js';
import { buildEnvironmentalModel } from '../apps/api/src/environmental/model.js';
import { environmentalInputHash, resolveAnalysisInput, runEnvironmentalAnalysis } from '../apps/api/src/environmental/analysis.js';
import { validateEnvironmentalModel, validateEnvironmentalResults } from '../apps/api/src/environmental/validate.js';
import { samplePoints } from '../apps/api/src/environmental/shading.js';

const maximum = parametricInput(); maximum.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
Object.assign(maximum.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 }); maximum.rooms = [{ type: 'bedroom', count: 24 }];
const { layoutV2: _layout, ...v1 } = solverInput();
const hours24 = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
const year = syntheticWeather(Date.parse('2025-12-31T18:30:00Z'), 8760, i => ({ dryBulb: 22 + 8 * Math.sin(i / 8760 * 2 * Math.PI) + 4 * Math.sin(i / 24 * 2 * Math.PI), dni: null }));
const cases: [string, () => ReturnType<typeof authored>, unknown][] = [
  ['v1', () => generateBlueprint(v1).model, environmentalInput()], ['v2', () => generateBlueprintV2(solverInput()).model, environmentalInput()],
  ['L', () => generateParametricBlueprint(parametricInput()).model, environmentalInput()], ['setback', () => generateParametricBlueprint(parametricInput(true)).model, environmentalInput()],
  ['maximum-24', () => generateParametricBlueprint(maximum).model, environmentalInput()],
  ['west-wing-edit', () => generateParametricBlueprint(modifyParametricRequirements(parametricInput(true), { level: 0, parameter: 'westWingWidthMm', valueMm: 10000 })).model, environmentalInput()],
  ['authored', () => authored(), environmentalInput()],
  ['maximum-24 × 24 instants', () => generateParametricBlueprint(maximum).model, environmentalInput({ instants: hours24, date: '2026-06-21' })],
  ['setback × 8760 h weather', () => generateParametricBlueprint(parametricInput(true)).model, { ...environmentalInput({ instants: [] }),
    thermalCases: [{ key: 'year', inside: { value: 24, unit: 'degC' }, outside: { kind: 'WEATHER' }, ground: { value: 22, unit: 'degC' } }], weather: year }],
];
const rows: Record<string, unknown>[] = [];
for (const [name, make, raw] of cases) {
  const m = make(), b = { projectId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', modelHash: modelHash(m),
    generatorVersion: m.provenance.generatorVersion ?? null, generationId: null, requirementsHash: null, parameterHash: m.parametricArchitecture ? digest(m.parametricArchitecture) : null };
  const input = EnvironmentalInputSchema.parse(raw), bim = projectBim(m, b);
  let t = performance.now(); const model = buildEnvironmentalModel(bim, input); const projectionMs = performance.now() - t;
  t = performance.now(); const mv = validateEnvironmentalModel(model, bim.geometry, input, model.binding); const modelValidationMs = performance.now() - t;
  t = performance.now(); const ai = resolveAnalysisInput(model, input); const preflightMs = performance.now() - t;
  const run = runEnvironmentalAnalysis(ai);
  const draft = { version: 'environmental-analysis-v1' as const, binding: model.binding, inputHash: environmentalInputHash(model.binding, input), analysisInputHash: run.analysisInputHash, input, model, calculator: run.calculator, results: run.results };
  t = performance.now(); const rv = validateEnvironmentalResults(draft, { binding: model.binding }); const resultValidationMs = performance.now() - t;
  t = performance.now(); const snapshot = SnapshotSchema.parse({ ...draft, validation: { model: mv, results: rv }, status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, claims: CLAIMS, limitations: LIMITATIONS });
  const bytes = Buffer.byteLength(JSON.stringify(snapshot)); const serializationMs = performance.now() - t;
  if (mv.status !== 'VALID' || rv.status !== 'VALID') throw new Error(`${name} failed validation`);
  rows.push({ name, sample: 1, zones: model.zones.length, surfaces: model.surfaces.length, apertures: model.surfaces.filter(s => s.hostSurfaceId).length,
    raySamples: model.surfaces.reduce((n, s) => n + samplePoints(s).length, 0), instants: ai.instants.length, weatherSamples: input.weather?.samples.length ?? 0, thermalCases: input.thermalCases.length,
    projectionMs, modelValidationMs, preflightMs, calculationMs: run.calculator.executionMs, resultValidationMs, serializationMs, resultBytes: bytes,
    solarMaxDeviationDeg: rv.solarMaxDeviation?.value ?? null, rssBytes: process.memoryUsage().rss });
}
await mkdir('docs/phase25/evidence', { recursive: true });
await writeFile('docs/phase25/evidence/benchmark.json', JSON.stringify({ runtime: process.version, platform: process.platform, note: 'Single-process, single-sample observations; not production SLOs.', rows }, null, 2) + '\n');
console.table(rows.map(r => ({ name: r.name, surfaces: r.surfaces, samples: r.raySamples, instants: r.instants, calcMs: Math.round(r.calculationMs as number), validateMs: Math.round(r.resultValidationMs as number), bytes: r.resultBytes })));
