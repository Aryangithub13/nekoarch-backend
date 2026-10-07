import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pointLocation, type BuildingModelV2 } from '@designflow/shared';
import { generateBlueprintV2, generateParametricBlueprint } from '@designflow/generator';
import { parametricInput } from '../test-support/parametric-fixtures.js';
import { solverInput } from '../test-support/solver-v2-fixtures.js';
import { systemsInput, wetFrameInput, wetTwoStorey } from '../test-support/systems-fixtures.js';
import { environmentalInput } from '../test-support/environmental-fixtures.js';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { digest } from '../apps/api/src/bim/core.js';
import { projectBim } from '../apps/api/src/bim/project.js';
import type { StructuralSnapshot } from '../apps/api/src/structural/contracts.js';
import { buildStructuralModel } from '../apps/api/src/structural/model.js';
import { structuralInputHash } from '../apps/api/src/structural/analysis.js';
import { EnvironmentalInputSchema, type EnvironmentalSnapshot } from '../apps/api/src/environmental/contracts.js';
import { buildEnvironmentalModel } from '../apps/api/src/environmental/model.js';
import { environmentalInputHash, resolveAnalysisInput as resolveEnvironmental, runEnvironmentalAnalysis } from '../apps/api/src/environmental/analysis.js';
import { CLAIMS, LIMITATIONS, SnapshotSchema, SystemsInputSchema, type SystemsInput } from '../apps/api/src/systems/contracts.js';
import { buildSystemsModel, type Upstream } from '../apps/api/src/systems/model.js';
import { resolveAnalysisInput, runSystemsAnalysis, systemsInputHash } from '../apps/api/src/systems/analysis.js';
import { validateSystemsModel, validateSystemsResults } from '../apps/api/src/systems/validate.js';

const maximum = parametricInput(); maximum.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
Object.assign(maximum.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 }); maximum.rooms = [{ type: 'bedroom', count: 24 }];
const user = 'USER_PROVIDED' as const;

/** A representative explicit input for any fixture: one load per room, a fixture in every third room, ducts to up to six rooms, a lift on two-storey models. */
function synthesized(m: BuildingModelV2): SystemsInput {
  // Distinct interior points on a 600 mm grid, each at least 400 mm from every wall of its space; the k-th one for the k-th terminal of a space.
  const pointsOf = new Map<string, { x: number; z: number }[]>();
  const inside = (s: BuildingModelV2['spaces'][number], k = 0) => {
    if (!pointsOf.has(s.id)) {
      const xs = s.boundary.map(p => p.x), zs = s.boundary.map(p => p.z), found: { x: number; z: number }[] = [];
      for (let x = Math.min(...xs) + 450; x < Math.max(...xs); x += 600) for (let z = Math.min(...zs) + 450; z < Math.max(...zs); z += 600)
        if ([[0, 0], [400, 0], [-400, 0], [0, 400], [0, -400]].every(([dx, dz]) => pointLocation({ x: x + dx!, z: z + dz! }, s.boundary) === 1)) found.push({ x, z });
      pointsOf.set(s.id, found);
    }
    return pointsOf.get(s.id)![k] ?? null;
  };
  const lowest = [...m.levels].sort((a, b) => a.index - b.index)[0]!;
  const hub = m.spaces.find(s => ['circulation', 'corridor'].includes(s.classification) && s.levelId === lowest.id) ?? m.spaces[0]!;
  const rooms = m.spaces.filter(s => !['circulation', 'corridor', 'stairwell'].includes(s.classification)).filter(s => inside(s));
  const at = (s: typeof hub, elevationMm: number, k: number) => ({ spaceId: s.id, point: inside(s, k), elevationMm });
  const elevations = (rel: number, upper: number) => m.levels.map(l => ({ levelId: l.id, elevationMm: l.id === lowest.id ? rel : upper }));
  const exit = m.site?.primaryEntryOpeningId ?? m.openings.filter(o => o.kind === 'door').map(o => o.id).sort()[0]!;
  return SystemsInputSchema.parse({ version: 'building-systems-input-v1',
    plumbing: { fixtures: rooms.filter((_, i) => i % 3 === 0).map((s, i) => ({ key: `f${i}`, kind: 'OTHER', spaceId: s.id, connections: [{ service: 'SANITARY', point: inside(s, 0), elevationMm: 0 },
      { service: 'COLD_WATER', point: inside(s, 1), elevationMm: 800 }].filter(c => c.point), provenance: user })),
      coldWaterSource: { key: 'main', ...at(hub, 300, 0), provenance: user }, sanitaryOutlet: { key: 'out', ...at(hub, -800, 1), provenance: user },
      minimumSlope: { rise: 1, run: 100, provenance: user }, coldWater: { elevations: elevations(2200, -700), size: { shape: 'ROUND', diameterMm: 20 } },
      sanitary: { bands: m.levels.map(l => ({ levelId: l.id, topMm: l.id === lowest.id ? -300 : -250, bottomMm: l.id === lowest.id ? -1500 : -500 })), size: { shape: 'ROUND', diameterMm: 100 } },
      clearance: { value: 25, unit: 'mm', provenance: user } },
    electrical: { supply: { key: 'mains', systemVoltage: { value: 230, unit: 'V' }, phaseSystem: 'SINGLE_PHASE', frequencyHz: { value: 50, unit: 'Hz' }, ...at(hub, 1500, 2), provenance: user },
      panels: [{ key: 'db', ...at(hub, 1500, 3), provenance: user }],
      circuits: m.levels.map(l => ({ key: `c-${l.id}`, panel: 'db', loads: rooms.filter(s => s.levelId === l.id).map(s => `l-${s.id}`) })).filter(c => c.loads.length),
      loads: rooms.map(s => ({ key: `l-${s.id}`, kind: 'SOCKET', ...at(s, 300, 2), power: { value: 500, unit: 'W' }, provenance: user })),
      feeder: { elevations: elevations(2500, 2500) }, circuitRouting: { elevations: elevations(2500, 2500), size: { shape: 'ROUND', diameterMm: 25 } }, clearance: { value: 25, unit: 'mm', provenance: user } },
    hvac: { equipment: [{ key: 'ahu', kind: 'AIR_HANDLING_UNIT', ...at(hub, 2300, 4), provenance: user }],
      systems: [{ key: 'sa', kind: 'SUPPLY', equipment: 'ahu', connection: { point: inside(hub, 5), elevationMm: 2300 },
        terminals: rooms.filter(s => s.levelId === lowest.id).slice(0, 6).map(s => ({ key: `t-${s.id}`, ...at(s, 2700, 3), airflow: { value: 100, unit: 'L/s', provenance: user } })),
        ductSection: { shape: 'RECTANGULAR', widthMm: 300, heightMm: 200 }, elevations: [{ levelId: lowest.id, elevationMm: 2400 }] }], clearance: { value: 50, unit: 'mm', provenance: user } },
    lifeSafety: { exits: { mode: 'EXPLICIT', openingIds: [exit] } },
    verticalTransport: m.levels.length > 1 ? { elevators: [{ key: 'lift', servedLevelIds: m.levels.map(l => l.id), shaft: { widthMm: 1600, depthMm: 1600 },
      door: { side: '+z', widthMm: 900 }, placement: { mode: 'PLANNER_SELECTED' }, provenance: user }] } : null });
}

const ids = { projectId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222' };
const bimOf = (m: BuildingModelV2) => projectBim(m, { ...ids, modelHash: modelHash(m), generatorVersion: m.provenance.generatorVersion ?? null, generationId: null, requirementsHash: null,
  parameterHash: m.parametricArchitecture ? digest(m.parametricArchitecture) : null });
const wet = wetTwoStorey(), wetBim = bimOf(wet);
const structural = (() => { const input = wetFrameInput(), model = buildStructuralModel(wetBim, input), inputHash = structuralInputHash(model.binding, input);
  return { analysisId: '33333333-3333-4333-8333-333333333333', inputHash, snapshot: { binding: model.binding, inputHash, model } as unknown as StructuralSnapshot }; })();
const environmental = (() => { const input = EnvironmentalInputSchema.parse(environmentalInput()), model = buildEnvironmentalModel(wetBim, input), run = runEnvironmentalAnalysis(resolveEnvironmental(model, input));
  const inputHash = environmentalInputHash(model.binding, input);
  return { analysisId: '44444444-4444-4444-8444-444444444444', inputHash, snapshot: { binding: model.binding, inputHash, results: run.results } as unknown as EnvironmentalSnapshot }; })();
const none: Upstream = { structural: null, environmental: null };
const cases: [string, () => BuildingModelV2, (m: BuildingModelV2) => SystemsInput, Upstream][] = [
  ['small 1-storey (v2)', () => generateBlueprintV2(solverInput()).model, synthesized, none],
  ['L-shaped', () => generateParametricBlueprint(parametricInput()).model, synthesized, none],
  ['parametric setback', () => generateParametricBlueprint(parametricInput(true)).model, synthesized, none],
  ['maximum-24-room', () => generateParametricBlueprint(maximum).model, synthesized, none],
  ['typical 2-storey (wet)', () => wet, () => SystemsInputSchema.parse(systemsInput()), none],
  ['wet + structure', () => wet, () => SystemsInputSchema.parse(systemsInput({ structuralAnalysisId: structural.analysisId })), { structural, environmental: null }],
  ['wet + environmental', () => wet, () => SystemsInputSchema.parse(systemsInput({ environmentalAnalysisId: environmental.analysisId })), { structural: null, environmental }],
  ['multi-discipline full (wet + structure + environmental)', () => wet,
    () => SystemsInputSchema.parse(systemsInput({ structuralAnalysisId: structural.analysisId, environmentalAnalysisId: environmental.analysisId })), { structural, environmental }],
];
const rows: Record<string, unknown>[] = [];
for (const [name, make, inputOf, upstream] of cases) {
  const m = make(), bim = m === wet ? wetBim : bimOf(m), input = inputOf(m);
  let t = performance.now(); const model = buildSystemsModel(bim, input, upstream); const projectionMs = performance.now() - t;
  t = performance.now(); const mv = validateSystemsModel(model, bim.geometry, input, model.binding, upstream.structural?.snapshot ?? null); const modelValidationMs = performance.now() - t;
  t = performance.now(); const ai = resolveAnalysisInput(model, input, upstream.environmental); const preflightMs = performance.now() - t;
  const stats = { searchStates: 0 }, run = runSystemsAnalysis(ai, undefined, undefined, stats);
  const draft = { version: 'building-systems-analysis-v1' as const, binding: model.binding, inputHash: systemsInputHash(model.binding, input), analysisInputHash: run.analysisInputHash,
    input, model, calculator: run.calculator, results: run.results };
  t = performance.now(); const rv = validateSystemsResults(draft, { binding: model.binding, environmental: upstream.environmental }); const resultValidationMs = performance.now() - t;
  t = performance.now(); const snapshot = SnapshotSchema.parse({ ...draft, validation: { model: mv, results: rv }, status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, claims: CLAIMS, limitations: LIMITATIONS });
  const bytes = Buffer.byteLength(JSON.stringify(snapshot)); const serializationMs = performance.now() - t;
  if (mv.status !== 'VALID' || rv.status !== 'VALID') throw new Error(`${name} failed validation: ${JSON.stringify([...mv.diagnostics, ...rv.diagnostics].slice(0, 3))}`);
  const r = run.results;
  rows.push({ name, sample: 1, levels: model.levels.length, spaces: model.spaces.length, terminals: model.terminals.length, networks: model.networks.length,
    routed: r.networks.filter(n => n.status === 'ROUTED').length, notRouted: r.networks.filter(n => n.status !== 'ROUTED').map(n => `${model.networks.find(x => x.id === n.networkId)!.key}:${n.status}:${n.failure?.message ?? ""}`),
    segments: rv.recomputed.segments, searchStates: stats.searchStates, clashes: r.coordination.clashes.length, blocking: r.coordination.blocking, penetrations: r.coordination.penetrations.length,
    egressNodes: r.lifeSafety.nodes, elevatorCandidates: r.verticalTransport.elevators[0]?.candidatesEvaluated ?? 0,
    projectionMs, modelValidationMs, preflightMs, calculationMs: run.calculator.executionMs, resultValidationMs, serializationMs, snapshotBytes: bytes, rssBytes: process.memoryUsage().rss });
}
await mkdir('docs/phase26/evidence', { recursive: true });
await writeFile('docs/phase26/evidence/benchmark.json', JSON.stringify({ runtime: process.version, platform: process.platform, note: 'Single-process, single-sample observations; not production SLOs.', rows }, null, 2) + '\n');
console.table(rows.map(r => ({ name: r.name, terminals: r.terminals, routed: `${r.routed}/${r.networks}`, states: r.searchStates, clashes: r.clashes, egress: r.egressNodes,
  calcMs: Math.round(r.calculationMs as number), validateMs: Math.round(r.resultValidationMs as number), kb: Math.round((r.snapshotBytes as number) / 1024) })));
