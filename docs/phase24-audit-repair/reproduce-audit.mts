// Re-runs the independent audit's A01–A06 probes (same inputs and mutations) against the current source and asserts the repaired
// outcome. Exit 1 if any probe regresses. Evidence: docs/phase24-audit-repair/evidence/reproductions.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { authored } from '../../packages/blueprint-qa/tests/fixtures.js';
import { CROSSING_WALLS, STUB_WALLS, frameInput, segmentedBeamInput, withPartitions } from '../../test-support/structural-fixtures.js';
import { projectBim } from '../../apps/api/src/bim/project.js';
import { modelHash } from '../../apps/api/src/lib/generation-identity.js';
import { digest } from '../../apps/api/src/bim/core.js';
import { StructuralError, StructuralInputSchema, type StructuralInput } from '../../apps/api/src/structural/contracts.js';
import { buildStructuralModel } from '../../apps/api/src/structural/model.js';
import { runStructuralAnalysis, structuralInputHash, toAnalysisModel, validateRawOutput } from '../../apps/api/src/structural/analysis.js';
import { REFERENCE_FRAME_SOLVER, type StructuralSolverAdapter } from '../../apps/api/src/structural/frame-solver.js';
import { validateStructuralModel, validateStructuralResults } from '../../apps/api/src/structural/validate.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const binding = (m: ReturnType<typeof authored>) => ({ projectId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', modelHash: modelHash(m),
  generatorVersion: m.provenance.generatorVersion ?? null, generationId: null, requirementsHash: null, parameterHash: null });
const outcome = (fn: () => unknown) => { try { const v: any = fn(); return v?.status ?? 'ACCEPTED'; } catch (e) { return e instanceof StructuralError ? e.code : `UNEXPECTED:${(e as Error).name}`; } };
const source = authored(), bim = projectBim(source, binding(source)), input = StructuralInputSchema.parse(frameInput(source));
const model = buildStructuralModel(bim, input), run = runStructuralAnalysis(model);
const snapshot = { binding: model.binding, input, inputHash: structuralInputHash(model.binding, input), model, results: run.results, solver: run.solver };
const validate = (s: any) => validateStructuralResults(s, { binding: model.binding });
const freeNode = (s: any) => s.results.sets[0].displacements.find((d: any) => !model.supports.some(r => r.nodeId === d.nodeId));
const mutated = (change: (s: any) => void) => { const s: any = structuredClone(snapshot); change(s); return validate(s); };
const adapter = (analyze: StructuralSolverAdapter['analyze']): StructuralSolverAdapter => ({ ...REFERENCE_FRAME_SOLVER, analyze });
const beams = new Set(model.members.filter(m => m.kind === 'BEAM').flatMap(m => m.segmentIds));
const crossingSource = withPartitions(authored(), CROSSING_WALLS), crossingBim = projectBim(crossingSource, binding(crossingSource));
const crossingInput = (members: string[], loads: string[]): StructuralInput => StructuralInputSchema.parse({ ...frameInput(source, { selfWeight: false }), autoSupports: null, combinations: [],
  members: members.map(wallId => ({ key: wallId, rule: 'BEAM_ALONG_WALL', wallId, material: 'test-concrete', section: 'beam' })),
  supports: CROSSING_WALLS.map(w => ({ key: w.id, at: { member: w.id, end: 'start' }, type: 'FIXED' })),
  loadCases: [{ key: 'q', category: 'USER_DEFINED', loads: loads.map(member => ({ key: member, application: 'MEMBER_DISTRIBUTED', target: { member }, direction: 'GLOBAL_Y', magnitude: { value: -5, unit: 'kN/m' } })) }] });
const fixedBeam = StructuralInputSchema.parse({ ...frameInput(source, { selfWeight: false }), autoSupports: null, combinations: [], members: [{ key: 'beam', rule: 'BEAM_ALONG_WALL', wallId: 'west', material: 'test-concrete', section: 'beam' }],
  supports: ['start', 'end'].map(end => ({ key: end, at: { member: 'beam', end }, type: 'FIXED' })),
  loadCases: [{ key: 'q', category: 'USER_DEFINED', loads: [{ key: 'q', application: 'MEMBER_DISTRIBUTED', target: { member: 'beam' }, direction: 'GLOBAL_Y', magnitude: { value: -2, unit: 'kN/m' } }] }] });
const expanded = withPartitions(authored(), [CROSSING_WALLS[0]!, ...STUB_WALLS]), expandedBim = projectBim(expanded, binding(expanded));
const am = toAnalysisModel(model), raw: any = REFERENCE_FRAME_SOLVER.analyze(am, { deadline: performance.now() + 10_000 });
const rawControl = (change: (r: any) => void) => { const r = structuredClone(raw); change(r); return validateRawOutput(r, am, REFERENCE_FRAME_SOLVER); };

const probes: [string, string, string, () => unknown][] = [
  ['control', 'baseline reference results', 'VALID', () => validate(snapshot)],
  ['A01', 'free-node uy = 1e12 mm, rx = 1e9 rad', 'INVALID', () => mutated(s => Object.assign(freeNode(s), { uy: 1e12, rx: 1e9 }))],
  ['A01', 'free-node uy + 0.05 mm', 'INVALID', () => mutated(s => { freeNode(s).uy += 0.05; })],
  ['A01', 'beam Iy, Iz × 100 solution relabelled with the true model hash', 'INVALID', () => {
    const r = runStructuralAnalysis(model, adapter((a, o) => { const c = structuredClone(a); for (const m of c.members) if (beams.has(m.id)) { m.Iy *= 100; m.Iz *= 100; }
      const x: any = REFERENCE_FRAME_SOLVER.analyze(c, o); x.analysisModelHash = digest(a); return x; }));
    return validate({ ...snapshot, results: r.results });
  }],
  ['A01', 'raw J-end force indices 6–11 = 1e20', 'STRUCTURAL_RESULT_INVALID', () => runStructuralAnalysis(model, adapter((a, o) => {
    const x: any = REFERENCE_FRAME_SOLVER.analyze(a, o); for (const c of x.cases) for (const f of c.memberEndForces) for (let i = 6; i < 12; i++) f[i] = 1e20; return x; }))],
  ['A01', 'counter: restrained displacement corrupted', 'INVALID', () => mutated(s => { s.results.sets[0].displacements.find((d: any) => model.supports.some(r => r.nodeId === d.nodeId)).uy = 1e12; })],
  ['A01', 'counter: raw NaN', 'STRUCTURAL_RESULT_INVALID', () => rawControl(r => { r.cases[0].displacements[0][0] = NaN; })],
  ['A01', 'counter: raw wrong model hash', 'STRUCTURAL_RESULT_INVALID', () => rawControl(r => { r.analysisModelHash = '0'.repeat(64); })],
  ['A01', 'counter: raw wrong units', 'STRUCTURAL_RESULT_INVALID', () => rawControl(r => { r.units.force = 'kN'; })],
  ['A01', 'counter: raw missing case', 'STRUCTURAL_RESULT_INVALID', () => rawControl(r => { r.cases.pop(); })],
  ['A02', 'station 0.5 components = ±1e12', 'INVALID', () => mutated(s => Object.assign(s.results.sets[0].memberForces[0].stations[2], { n: 1e12, vy: -1e12, vz: 1e12, t: -1e12, my: 1e12, mz: 1e12 }))],
  ...[1, 3].map(i => ['A02', `station ${i / 4} mz + 0.1 kN·m`, 'INVALID', () => mutated(s => { s.results.sets[0].memberForces[0].stations[i].mz += 0.1; })] as [string, string, string, () => unknown]),
  ['A02', 'counter: end station mz + 10 kN·m', 'INVALID', () => mutated(s => { s.results.sets[0].memberForces[0].stations[4].mz += 10; })],
  ['A03', 'unconnected X crossing on an accepted architecture', 'STRUCTURAL_MODEL_INVALID', () => buildStructuralModel(crossingBim, crossingInput(['cross-x', 'cross-z'], ['cross-x']))],
  ['A03', 'counter: crossing wall split at the intersection (connected)', 'VALID', () => {
    const split = structuredClone(crossingSource), x = split.walls.find(w => w.id === 'cross-x')!;
    split.walls.push({ ...structuredClone(x), id: 'cross-x2', path: { start: { x: 6000, z: 3000 }, end: x.path.end } }); x.path.end = { x: 6000, z: 3000 };
    const i = crossingInput(['cross-x', 'cross-x2', 'cross-z'], ['cross-x', 'cross-x2']), m = buildStructuralModel(projectBim(split, binding(split)), i), r = runStructuralAnalysis(m);
    if (m.topology.components !== 1) throw new Error('expected one component');
    return validateStructuralResults({ binding: m.binding, input: i, inputHash: structuralInputHash(m.binding, i), model: m, results: r.results, solver: r.solver }, { binding: m.binding });
  }],
  ['A04', 'fixed–fixed 5800 mm beam under 2 kN/m', 'VALID', () => {
    const m = buildStructuralModel(bim, fixedBeam), r = runStructuralAnalysis(m);
    if (r.results.sets[0]!.reactions.some(x => Math.abs(x.fy - 5.8) > 1e-9 || Math.abs(Math.abs(x.mx) - 2 * 5.8 ** 2 / 12) > 1e-9)) throw new Error('fixed-end closed form');
    return validateStructuralResults({ binding: m.binding, input: fixedBeam, inputHash: structuralInputHash(m.binding, fixedBeam), model: m, results: r.results, solver: r.solver }, { binding: m.binding });
  }],
  ['A04', 'counter: pinned–pinned beam (torsion mechanism)', 'STRUCTURAL_SYSTEM_UNSTABLE', () => runStructuralAnalysis(buildStructuralModel(bim, StructuralInputSchema.parse({ ...fixedBeam,
    supports: fixedBeam.supports.map(s => ({ ...s, type: 'PINNED' })) })))],
  ['A05', '1,000 uniform loads on an eight-segment beam', 'STRUCTURAL_RESOURCE_LIMIT', () => buildStructuralModel(expandedBim, StructuralInputSchema.parse(segmentedBeamInput(1000)))],
  ['A05', 'counter: 10 loads on the same beam', 'ACCEPTED', () => runStructuralAnalysis(buildStructuralModel(expandedBim, StructuralInputSchema.parse(segmentedBeamInput(10))))],
  ['A06', 'rectangle width 9999 / depth 1 with original properties', 'INVALID', () => { const m: any = structuredClone(model), s = m.sections.find((x: any) => x.shape === 'RECTANGLE');
    s.dimensions.width.value = 9999; s.dimensions.depth.value = 1; return validateStructuralModel(m, bim.geometry, input, m.binding); }],
  ['A06', 'rectangle relabelled GENERIC, dimensions null', 'INVALID', () => { const m: any = structuredClone(model); Object.assign(m.sections[0], { shape: 'GENERIC', dimensions: null });
    return validateStructuralModel(m, bim.geometry, input, m.binding); }],
  ['A06', 'evaluated mass relabelled NOT_EVALUATED', 'INVALID', () => { const m: any = structuredClone(model); m.members[0].quantities.mass.status = 'NOT_EVALUATED';
    return validateStructuralModel(m, bim.geometry, input, m.binding); }],
  ['A06', 'counter: section Iz doubled', 'INVALID', () => { const m: any = structuredClone(model); m.sections[0].iz.value *= 2; return validateStructuralModel(m, bim.geometry, input, m.binding); }],
];
const rows = probes.map(([finding, probe, expected, fn]) => { const observed = outcome(fn); return { finding, probe, expected, observed, pass: observed === expected }; });
mkdirSync('docs/phase24-audit-repair/evidence', { recursive: true });
writeFileSync('docs/phase24-audit-repair/evidence/reproductions.json', JSON.stringify(rows, null, 2) + '\n');
for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.finding}  ${r.probe}: expected ${r.expected}, observed ${r.observed}`);
console.log(JSON.stringify({ probes: rows.length, failed: rows.filter(r => !r.pass).length }));
process.exit(rows.every(r => r.pass) ? 0 : 1);
