import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { BuildingModelV2 } from '@designflow/shared';
import { generateBlueprint, generateBlueprintV2, generateParametricBlueprint, modifyParametricRequirements } from '@designflow/generator';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { solverInput } from '../../../test-support/solver-v2-fixtures.js';
import { CROSSING_WALLS, STUB_WALLS, TEST_CONCRETE, frameInput, segmentedBeamInput, withPartitions } from '../../../test-support/structural-fixtures.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { projectBim } from '../src/bim/project.js';
import { exportIfc } from '../src/bim/ifc.js';
import { digest, semanticId } from '../src/bim/core.js';
import type { BimModel } from '../src/bim/contracts.js';
import { AnalysisModelSchema, EXPANDED_MEMBER_LOADS, STRUCTURAL_LIMITS, StructuralError, StructuralInputSchema, type AnalysisModel, type StructuralInput, type StructuralModel } from '../src/structural/contracts.js';
import { buildStructuralModel, rectangleProperties, structuralId } from '../src/structural/model.js';
import { buildResults, runStructuralAnalysis, structuralInputHash, validateRawOutput } from '../src/structural/analysis.js';
import { REFERENCE_FRAME_SOLVER, type StructuralSolverAdapter } from '../src/structural/frame-solver.js';
import { validateStructuralModel, validateStructuralResults } from '../src/structural/validate.js';
import { STANDARD_GRAVITY, UnitError, convert, massFromDensity, selfWeightLineLoad } from '../src/structural/units.js';

const projectId = '11111111-1111-4111-8111-111111111111', revisionId = '22222222-2222-4222-8222-222222222222';
const binding = (m: BuildingModelV2, r = revisionId, p = projectId) => ({ projectId: p, revisionId: r, modelHash: modelHash(m), generatorVersion: m.provenance.generatorVersion ?? null,
  generationId: null, requirementsHash: null, parameterHash: m.parametricArchitecture ? digest(m.parametricArchitecture) : null });
const parse = (input: unknown) => StructuralInputSchema.parse(input);
function prepared(m: BuildingModelV2, input: StructuralInput = parse(frameInput(m)), r = revisionId, p = projectId) {
  const bim = projectBim(m, binding(m, r, p));
  return { bim, input, model: buildStructuralModel(bim, input) };
}
function analyzed(m: BuildingModelV2, input?: StructuralInput) {
  const p = prepared(m, input), run = runStructuralAnalysis(p.model);
  return { ...p, run, snapshot: { binding: p.model.binding, input: p.input, inputHash: structuralInputHash(p.model.binding, p.input), model: p.model, results: run.results, solver: run.solver } };
}
const codeOf = (fn: () => unknown) => { try { fn(); } catch (error) { return error instanceof StructuralError ? error.code : `other:${(error as Error).name}`; } return 'none'; };
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
const sid = (s: string) => `str-${createHash('sha256').update(s).digest('hex').slice(0, 40)}`;

// ---------------------------------------------------------------- analytical harness (solver-neutral model, independent closed forms)
type Restraint = [boolean, boolean, boolean, boolean, boolean, boolean];
function analysisModel(nodes: [string, number, number, number][], members: [string, string, string][], restraints: [string, Restraint][], cases: { nodal?: [string, [number, number, number]][]; member?: [string, [number, number, number]][] }[],
  p = { E: 200000, nu: 0.3, A: 5000, Iy: 2e7, Iz: 8e7, J: 1e6 }): AnalysisModel {
  return AnalysisModelSchema.parse({ version: 'structural-analysis-model-v1', analysisType: 'LINEAR_STATIC', formulation: 'EULER_BERNOULLI_3D_FRAME', joints: 'RIGID',
    units: { length: 'mm', force: 'N', moment: 'N*mm', stress: 'MPa', rotation: 'rad', lineLoad: 'N/mm' }, localAxes: 'REFERENCE_VECTOR_V1',
    nodes: nodes.map(([id, x, y, z]) => ({ id: sid(id), x, y, z })),
    members: members.map(([id, i, j]) => ({ id: sid(id), nodeI: sid(i), nodeJ: sid(j), E: p.E, G: p.E / (2 * (1 + p.nu)), A: p.A, Iy: p.Iy, Iz: p.Iz, J: p.J })),
    restraints: restraints.map(([n, dofs]) => ({ nodeId: sid(n), dofs })),
    loadCases: cases.map((c, i) => ({ id: sid(`case${i}`), nodalLoads: (c.nodal ?? []).map(([n, force]) => ({ nodeId: sid(n), force })), memberLoads: (c.member ?? []).map(([m, w]) => ({ memberId: sid(m), w })) })) });
}
function solve(am: AnalysisModel, combinations: StructuralModel['combinations'] = []) {
  const raw = validateRawOutput(REFERENCE_FRAME_SOLVER.analyze(am, { deadline: performance.now() + 10_000 }), am, REFERENCE_FRAME_SOLVER);
  const fake = { segments: am.members.map(m => ({ id: m.id, memberId: m.id })), combinations } as unknown as StructuralModel;
  return { raw, results: buildResults(fake, am, raw) };
}
const FIXED: Restraint = [true, true, true, true, true, true];
type Results = ReturnType<typeof solve>['results'];
const node = (r: Results, set: number, id: string) => r.sets[set]!.displacements.find(d => d.nodeId === sid(id))!;
const reaction = (r: Results, set: number, id: string) => r.sets[set]!.reactions.find(d => d.nodeId === sid(id))!;
const forces = (r: Results, set: number, id: string) => r.sets[set]!.memberForces.find(d => d.segmentId === sid(id))!.stations;

describe('Phase 24 units', () => {
  it('converts only within a dimension through exact powers of ten', () => {
    expect(convert(1500, 'mm', 'm')).toBe(1.5); expect(convert(1.5, 'm', 'mm')).toBe(1500);
    expect(convert(12.5, 'kN', 'N')).toBe(12500); expect(convert(45e6, 'N*mm', 'kN*m')).toBe(45);
    expect(convert(10, 'kN/m', 'N/mm')).toBe(10); expect(convert(1, 'MPa', 'Pa')).toBe(1e6); expect(convert(5, 'kPa', 'MPa')).toBe(0.005);
    expect(convert(8e7, 'mm4', 'm4')).toBeCloseTo(8e-5, 18); expect(convert(90_000, 'mm2', 'm2')).toBe(0.09); expect(convert(1e9, 'mm3', 'm3')).toBe(1);
    expect(convert(3, 'N/mm', 'kN/m')).toBe(3);
  });
  it('rejects cross-dimension and nonfinite conversions at compile and run time', () => {
    // @ts-expect-error mm is a length, kN is a force
    expect(() => convert(1, 'mm', 'kN')).toThrow(UnitError);
    // @ts-expect-error kg is a mass, N is a force: weight requires explicit gravity
    expect(() => convert(1, 'kg', 'N')).toThrow(UnitError);
    // @ts-expect-error N·mm is a moment, kN is a force
    expect(() => convert(1, 'N*mm', 'kN')).toThrow(UnitError);
    // @ts-expect-error Pa is a stress, kg/m3 is a density
    expect(() => convert(1, 'Pa', 'kg/m3')).toThrow(UnitError);
    expect(() => convert(Number.NaN, 'mm', 'm')).toThrow(UnitError); expect(() => convert(Infinity, 'kN', 'N')).toThrow(UnitError);
    expect(convert(1, 'MPa', 'Pa')).not.toBe(convert(1, 'Pa', 'Pa'));
  });
  it('derives self-weight and mass from explicit density and standard gravity', () => {
    expect(STANDARD_GRAVITY.value).toBe(9.80665);
    // 2400 kg/m³ × 9.80665 m/s² × 0.09 m² = 2118.2364 N/m = 2.1182364 N/mm.
    expect(rel(selfWeightLineLoad(2400, 90_000), 2.1182364)).toBeLessThan(1e-12);
    expect(rel(massFromDensity(2400, 0.09e9), 216)).toBeLessThan(1e-12);
  });
});

describe('Phase 24 structural input schema', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = () => frameInput(authored()) as unknown as Record<string, any>;
  it('accepts the explicit input and rejects nonfinite, impossible and oversized values', () => {
    expect(StructuralInputSchema.safeParse(base()).success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cases: [string, (i: Record<string, any>) => void][] = [
      ['NaN modulus', i => { i.materials[0].elasticModulus.value = Number.NaN; }], ['infinite modulus', i => { i.materials[0].elasticModulus.value = Infinity; }],
      ['negative modulus', i => { i.materials[0].elasticModulus.value = -1; }], ['Poisson 0.5', i => { i.materials[0].poissonRatio.value = 0.5; }],
      ['zero density', i => { i.materials[0].density.value = 0; }], ['wrong unit', i => { i.materials[0].elasticModulus.unit = 'Pa'; }],
      ['giant point load', i => { i.loadCases[0].loads.push({ key: 'p', application: 'POINT', target: { member: 'b-west', end: 'start' }, direction: 'GLOBAL_Y', magnitude: { value: 1e300, unit: 'kN' } }); }],
      ['zero load', i => { i.loadCases[0].loads[0].magnitude.value = 0; }], ['zero factor', i => { i.combinations[0].terms[0].factor = 0; }],
      ['factor 11', i => { i.combinations[0].terms[0].factor = 11; }], ['NaN factor', i => { i.combinations[0].terms[0].factor = Number.NaN; }],
      ['unknown field', i => { i.materials[0].strength = 30; }], ['wrong version', i => { i.version = 'structural-input-v2'; }],
      ['CUSTOM without restraints', i => { i.supports = [{ key: 's', at: { member: 'b-west', end: 'start' }, type: 'CUSTOM' }]; }],
      ['restraints on FIXED', i => { i.supports = [{ key: 's', at: { member: 'b-west', end: 'start' }, type: 'FIXED', restraints: ['UX'] }]; }],
      ['bad key', i => { i.materials[0].key = '../x'; }], ['huge member array', i => { i.members = Array.from({ length: STRUCTURAL_LIMITS.members + 1 }, (_, k) => ({ ...i.members[0], key: `m${k}` })); }],
      ['huge load array', i => { i.loadCases[0].loads = Array.from({ length: STRUCTURAL_LIMITS.loadsPerCase + 1 }, (_, k) => ({ ...i.loadCases[0].loads[0], key: `l${k}` })); }],
      ['too many cases', i => { i.loadCases = Array.from({ length: STRUCTURAL_LIMITS.loadCases + 1 }, (_, k) => ({ ...i.loadCases[0], key: `c${k}` })); }],
      ['too many combinations', i => { i.combinations = Array.from({ length: STRUCTURAL_LIMITS.combinations + 1 }, (_, k) => ({ ...i.combinations[0], key: `k${k}` })); }],
      ['too many total loads', i => { const many = Array.from({ length: 600 }, (_, k) => ({ ...i.loadCases[0].loads[0], key: `l${k}` })); i.loadCases = [0, 1, 2, 3].map(k => ({ key: `c${k}`, category: 'DEAD', loads: many })); }],
    ];
    for (const [name, mutate] of cases) { const i = base(); mutate(i); expect(StructuralInputSchema.safeParse(i).success, name).toBe(false); }
  });
});

describe('Phase 24 identity, mapping and Phase 23 preservation', () => {
  it('maps only explicitly named members with traceable provenance and storey-top geometry', () => {
    const m = authored(), input = parse({ ...frameInput(m), members: [
      { key: 'col', rule: 'COLUMN_AT_WALL_END', wallId: 'west', end: 'start', material: 'test-concrete', section: 'col' },
      { key: 'beam', rule: 'BEAM_ALONG_WALL', wallId: 'west', material: 'test-concrete', section: 'beam' }],
      autoSupports: null, supports: [{ key: 'base', at: { member: 'col', end: 'start' }, type: 'FIXED' }],
      loadCases: [{ key: 'DEAD', category: 'DEAD', selfWeight: false, loads: [{ key: 'w', application: 'MEMBER_DISTRIBUTED', target: { member: 'beam' }, direction: 'GLOBAL_Y', magnitude: { value: -2, unit: 'kN/m' } }] }], combinations: [] });
    const { bim, model } = prepared(m, input);
    expect(model.members.map(x => x.kind).sort()).toEqual(['BEAM', 'COLUMN']);
    const column = model.members.find(x => x.kind === 'COLUMN')!, beam = model.members.find(x => x.kind === 'BEAM')!;
    const at = (id: string) => model.nodes.find(n => n.id === id)!.coordinates;
    expect([at(column.startNodeId), at(column.endNodeId)]).toEqual([{ x: 100, y: 0, z: 100, unit: 'mm' }, { x: 100, y: 3000, z: 100, unit: 'mm' }]);
    expect([at(beam.startNodeId), at(beam.endNodeId)]).toEqual([{ x: 100, y: 3000, z: 100, unit: 'mm' }, { x: 100, y: 3000, z: 5900, unit: 'mm' }]);
    expect(beam.source).toEqual({ collection: 'walls', wallId: 'west', end: null, bimElementId: semanticId(projectId, 'wall', 'west') });
    expect(bim.elements.some(e => e.id === beam.source.bimElementId && e.kind === 'wall')).toBe(true);
    expect(beam.mapping).toEqual({ rule: 'BEAM_ALONG_WALL', ruleVersion: 1, provenance: 'EXPLICIT_USER_MAPPING', assumptionStatus: 'ASSUMED', assumptions: ['ANALYTICAL_AXIS_AT_WALL_CENTERLINE', 'ANALYTICAL_BEAM_LEVEL_AT_STOREY_TOP'] });
    expect(model.nodes.find(n => n.coordinates.y === 0)!.levelId).toBe('ground');
    expect(model.nodes.find(n => n.coordinates.y === 3000)!.levelId).toBeNull();
    expect(model.claims).toEqual({ designVerification: 'NOT_EVALUATED', codeCompliance: 'NOT_CLAIMED', certification: 'NOT_CLAIMED', constructionSuitability: 'NOT_CLAIMED' });
    expect(model.supports[0]).toMatchObject({ type: 'FIXED', provenance: 'USER_PROVIDED', rule: null });
  });
  it('uses deterministic identities independent of request keys and names, scoped by project', () => {
    const m = authored(), a = prepared(m).model, renamed = frameInput(m);
    renamed.members = renamed.members.map(x => ({ ...x, key: `renamed-${x.key}` }));
    renamed.loadCases = renamed.loadCases.map(c => ({ ...c, loads: c.loads.map(l => l.application === 'MEMBER_DISTRIBUTED' ? { ...l, target: { member: `renamed-${l.target.member}` } } : l) }));
    renamed.materials = [{ ...TEST_CONCRETE, name: 'A different display name' }];
    const b = prepared(m, parse(renamed)).model;
    expect(b.members.map(x => x.id)).toEqual(a.members.map(x => x.id)); expect(b.nodes.map(x => x.id)).toEqual(a.nodes.map(x => x.id));
    expect(b.materials[0]!.id).toBe(a.materials[0]!.id);
    expect(prepared(m).model).toEqual(a);
    const other = prepared(m, parse(frameInput(m)), revisionId, '33333333-3333-4333-8333-333333333333').model;
    expect(other.members.some(x => a.members.some(y => y.id === x.id))).toBe(false);
  });
  it('never mutates architecture, BIM or IFC output', () => {
    const m = generateParametricBlueprint(parametricInput(true)).model, source = JSON.stringify(m), hash = modelHash(m);
    const before = projectBim(m, binding(m)), ifc = exportIfc(before), frozen = JSON.stringify(before);
    const { bim } = analyzed(m);
    expect(JSON.stringify(m)).toBe(source); expect(modelHash(m)).toBe(hash); expect(JSON.stringify(bim)).toBe(frozen);
    expect(projectBim(m, binding(m))).toEqual(before); expect(exportIfc(projectBim(m, binding(m)))).toBe(ifc); expect(ifc).not.toMatch(/IFCBEAM|IFCCOLUMN|IFCSTRUCTURAL/);
  });
  it('rejects unsupported architectural sources truthfully', () => {
    const m = authored(), { bim, input } = prepared(m);
    const noHeight = structuredClone(bim); noHeight.geometry.levels[0]!.floorToFloorHeightMm = null;
    expect(codeOf(() => buildStructuralModel(noHeight, input))).toBe('STRUCTURAL_SOURCE_UNSUPPORTED');
    const unknownAxis = structuredClone(bim); unknownAxis.geometry.walls[0]!.pathReference = 'unspecified';
    expect(codeOf(() => buildStructuralModel(unknownAxis, input))).toBe('STRUCTURAL_SOURCE_UNSUPPORTED');
    const area = frameInput(m); area.loadCases[0]!.loads.push({ key: 'slab', application: 'AREA', target: { panel: 'floor' }, direction: 'GLOBAL_Y', magnitude: { value: -2, unit: 'kPa' } });
    expect(codeOf(() => buildStructuralModel(bim, parse(area)))).toBe('STRUCTURAL_SOURCE_UNSUPPORTED');
    const unknownWall = frameInput(m); unknownWall.members[0] = { ...unknownWall.members[0]!, wallId: 'not-a-wall' };
    expect(codeOf(() => buildStructuralModel(bim, parse(unknownWall)))).toBe('STRUCTURAL_MODEL_INVALID');
  });
});

describe('Phase 24 materials, sections, loads, combinations and supports', () => {
  const m = authored(), bim = projectBim(m, binding(m));
  const build = (mutate: (i: StructuralInput) => void) => { const i = parse(frameInput(m)); mutate(i); return () => buildStructuralModel(bim, i); };
  it('never infers engineering properties from names or architectural materials', () => {
    const named = build(i => { i.materials = [{ ...TEST_CONCRETE, name: 'Reinforced concrete M25', elasticModulus: null }]; });
    expect(codeOf(named)).toBe('STRUCTURAL_MATERIAL_MISSING');
    expect(codeOf(build(i => { i.materials = [{ ...TEST_CONCRETE, poissonRatio: null }]; }))).toBe('STRUCTURAL_MATERIAL_MISSING');
    expect(codeOf(build(i => { i.materials = [{ ...TEST_CONCRETE, density: null }]; }))).toBe('STRUCTURAL_MATERIAL_MISSING');
    const noDensity = parse(frameInput(m, { selfWeight: false })); noDensity.materials = [{ ...TEST_CONCRETE, density: null }];
    const model = buildStructuralModel(bim, noDensity);
    expect(model.materials[0]!.density).toEqual({ value: null, unit: 'kg/m3', provenance: 'NOT_SPECIFIED' });
    expect(model.members.every(x => x.quantities.mass.status === 'NOT_EVALUATED' && x.quantities.mass.value === null)).toBe(true);
    expect(model.loadCases.every(c => c.selfWeight === 'NOT_REQUESTED')).toBe(true);
    expect(codeOf(build(i => { i.materials = [{ ...TEST_CONCRETE, architecturalSpecificationId: 'missing-spec' }]; }))).toBe('STRUCTURAL_MODEL_INVALID');
    expect(codeOf(build(i => { i.members[0] = { ...i.members[0]!, material: 'unknown' }; }))).toBe('STRUCTURAL_MODEL_INVALID');
  });
  it('links a material to an architectural specification for traceability only', () => {
    const withSpec = authored(); withSpec.specifications = [{ id: 'spec-wall', name: 'Wall choice', material: 'Concrete', reference: 'architectural label only' }]; withSpec.walls[0]!.specificationId = 'spec-wall';
    const i = parse({ ...frameInput(withSpec), materials: [{ ...TEST_CONCRETE, architecturalSpecificationId: 'spec-wall' }] });
    const model = prepared(withSpec, i).model;
    expect(model.materials[0]).toMatchObject({ architecturalSpecificationId: 'spec-wall', bimMaterialId: semanticId(projectId, 'material', 'spec-wall'), elasticModulus: { value: 30000, provenance: 'USER_PROVIDED' } });
  });
  it('derives rectangle section properties exactly and labels the torsion approximation', () => {
    const p = rectangleProperties(230, 450);
    expect(p.area).toBe(103500); expect(p.iz).toBe(230 * 450 ** 3 / 12); expect(p.iy).toBe(450 * 230 ** 3 / 12);
    // Roark: J = h t³ [1/3 − 0.21 (t/h)(1 − t⁴/(12 h⁴))]; a square gives ≈ 0.1408 a⁴ against the tabulated exact 0.1406 a⁴.
    expect(rel(rectangleProperties(300, 300).j / 300 ** 4, 0.1406)).toBeLessThan(0.002);
    const model = prepared(m).model, beam = model.sections.find(s => s.requestKey === 'beam')!;
    expect(beam.j).toMatchObject({ provenance: 'DERIVED_FROM_SECTION_DIMENSIONS', method: 'roark-rectangle-torsion-approx' });
  });
  it('rejects orphan, duplicate and unsupported loads, cases and combinations', () => {
    expect(codeOf(build(i => { i.loadCases[0]!.loads[0] = { ...i.loadCases[0]!.loads[0]!, target: { member: 'ghost' } } as never; }))).toBe('STRUCTURAL_LOAD_INVALID');
    expect(codeOf(build(i => { i.loadCases[0]!.loads.push({ ...i.loadCases[0]!.loads[0]! }); }))).toBe('STRUCTURAL_LOAD_INVALID');
    expect(codeOf(build(i => { i.loadCases.push({ key: 'EMPTY', category: 'USER_DEFINED', selfWeight: false, loads: [] }); }))).toBe('STRUCTURAL_LOAD_INVALID');
    expect(codeOf(build(i => { i.loadCases.push({ ...i.loadCases[1]! }); }))).toBe('STRUCTURAL_LOAD_INVALID');
    expect(codeOf(build(i => { i.combinations[0]!.terms[0]!.loadCase = 'WIND'; }))).toBe('STRUCTURAL_LOAD_INVALID');
    expect(codeOf(build(i => { i.combinations[0]!.terms[1]!.loadCase = 'DEAD'; }))).toBe('STRUCTURAL_LOAD_INVALID');
    expect(codeOf(build(i => { i.loadCases[0]!.loads.push({ key: 'tip', application: 'POINT', target: { member: 'ghost', end: 'end' }, direction: 'GLOBAL_X', magnitude: { value: 1, unit: 'kN' } }); }))).toBe('STRUCTURAL_LOAD_INVALID');
    const model = buildStructuralModel(bim, parse(frameInput(m)));
    expect(model.combinations[0]).toMatchObject({ profile: 'PROJECT_DEFINED', codeCompliance: 'NOT_CLAIMED', method: 'LINEAR_SUPERPOSITION' });
    expect(model.combinations[0]!.terms.every(t => t.provenance === 'USER_PROVIDED')).toBe(true);
  });
  it('validates explicit and assumed supports', () => {
    const model = buildStructuralModel(bim, parse(frameInput(m)));
    expect(model.supports).toHaveLength(6);
    expect(model.supports.every(s => s.provenance === 'ASSUMED' && s.rule === 'BASE_OF_COLUMNS_AT_LOWEST_ELEVATION' && Object.values(s.restraints).every(Boolean))).toBe(true);
    expect(codeOf(build(i => { i.autoSupports = null; }))).toBe('STRUCTURAL_SUPPORT_INVALID');
    expect(codeOf(build(i => { i.supports = [{ key: 's', at: { member: 'ghost', end: 'start' }, type: 'FIXED' }]; }))).toBe('STRUCTURAL_SUPPORT_INVALID');
    const first = frameInput(m).members[0]!.key;
    expect(codeOf(build(i => { i.supports = [{ key: 's1', at: { member: first, end: 'start' }, type: 'FIXED' }, { key: 's2', at: { member: first, end: 'start' }, type: 'PINNED' }]; }))).toBe('STRUCTURAL_SUPPORT_INVALID');
    const custom = parse({ ...frameInput(m), supports: [{ key: 's', at: { member: first, end: 'start' }, type: 'CUSTOM', restraints: ['UX', 'UY', 'RZ'] }] });
    const s = buildStructuralModel(bim, custom).supports.find(x => x.provenance === 'USER_PROVIDED')!;
    expect(s.restraints).toEqual({ UX: true, UY: true, UZ: false, RX: false, RY: false, RZ: true });
  });
});

describe('Phase 24 topology', () => {
  const m = authored(), bim = projectBim(m, binding(m));
  it('rejects duplicate and overlapping members and floating parts', () => {
    const dup = parse(frameInput(m)); dup.members.push({ key: 'dup', rule: 'COLUMN_AT_WALL_END', wallId: 'south-b', end: 'end', material: 'test-concrete', section: 'col' });
    // south-b ends at the corner already occupied by the east wall's column.
    expect(codeOf(() => buildStructuralModel(bim, dup))).toBe('STRUCTURAL_MODEL_INVALID');
    const same = parse(frameInput(m)); same.members.push({ ...same.members.find(x => x.rule === 'BEAM_ALONG_WALL')!, key: 'again' });
    expect(codeOf(() => buildStructuralModel(bim, same))).toBe('STRUCTURAL_MODEL_INVALID');
    const overlapping = structuredClone(bim); overlapping.geometry.walls.push({ ...overlapping.geometry.walls.find(w => w.id === 'west')!, id: 'west-overlap', path: { start: { x: 100, z: 3000 }, end: { x: 100, z: 8000 } } });
    const overlapInput = parse(frameInput(m)); overlapInput.members.push({ key: 'ov', rule: 'BEAM_ALONG_WALL', wallId: 'west-overlap', material: 'test-concrete', section: 'beam' });
    expect(codeOf(() => buildStructuralModel(overlapping, overlapInput))).toBe('STRUCTURAL_MODEL_INVALID');
    const floating = parse({ ...frameInput(m), members: [
      { key: 'c1', rule: 'COLUMN_AT_WALL_END', wallId: 'east', end: 'start', material: 'test-concrete', section: 'col' },
      { key: 'c2', rule: 'COLUMN_AT_WALL_END', wallId: 'east', end: 'end', material: 'test-concrete', section: 'col' },
      { key: 'b-east', rule: 'BEAM_ALONG_WALL', wallId: 'east', material: 'test-concrete', section: 'beam' },
      { key: 'b-west', rule: 'BEAM_ALONG_WALL', wallId: 'west', material: 'test-concrete', section: 'beam' }], loadCases: [{ key: 'L', category: 'LIVE', loads: [
      { key: 'w', application: 'MEMBER_DISTRIBUTED', target: { member: 'b-east' }, direction: 'GLOBAL_Y', magnitude: { value: -1, unit: 'kN/m' } }] }], combinations: [] });
    expect(codeOf(() => buildStructuralModel(bim, floating))).toBe('STRUCTURAL_SYSTEM_DISCONNECTED');
  });
  it('detects mechanisms in the solver as unstable systems', () => {
    const beamOnly = parse({ ...frameInput(m), members: [{ key: 'b', rule: 'BEAM_ALONG_WALL', wallId: 'west', material: 'test-concrete', section: 'beam' }], autoSupports: null,
      supports: [{ key: 'a', at: { member: 'b', end: 'start' }, type: 'PINNED' }, { key: 'z', at: { member: 'b', end: 'end' }, type: 'PINNED' }],
      loadCases: [{ key: 'L', category: 'LIVE', loads: [{ key: 'w', application: 'MEMBER_DISTRIBUTED', target: { member: 'b' }, direction: 'GLOBAL_Y', magnitude: { value: -1, unit: 'kN/m' } }] }], combinations: [] });
    // Pins restrain translations only: rotation about the beam axis is a mechanism.
    expect(codeOf(() => runStructuralAnalysis(buildStructuralModel(bim, beamOnly)))).toBe('STRUCTURAL_SYSTEM_UNSTABLE');
  });
  it('splits members at interior nodes and reports dangling ends without using room adjacency', () => {
    const setback = generateParametricBlueprint(parametricInput(true)).model, { model } = prepared(setback);
    expect(model.topology.splitMemberIds.length).toBeGreaterThan(0); expect(model.segments.length).toBeGreaterThan(model.members.length);
    for (const id of model.topology.splitMemberIds) expect(model.members.find(x => x.id === id)!.segmentIds.length).toBeGreaterThan(1);
    // Level-1 columns at x=9400 land inside a level-0 beam (transfer condition), not on a column.
    const transfer = model.nodes.find(n => n.coordinates.x === 9400 && n.coordinates.y === 3000 && n.coordinates.z === 2450)!;
    expect(model.segments.filter(s => s.startNodeId === transfer.id || s.endNodeId === transfer.id).length).toBe(3);
    expect(runStructuralAnalysis(model).solver.warnings.join()).toContain('single member');
  });
});

describe('Phase 24 analytical verification (independent closed forms)', () => {
  const E = 200000, Iz = 8e7, Iy = 2e7, A = 5000;
  it('simply supported beam under uniform load: reactions wL/2, deflection 5wL⁴/384EI, moment wL²/8, end slope wL³/24EI', () => {
    const L = 6000, w = -10; // N/mm = kN/m
    const am = analysisModel([['A', 0, 0, 0], ['M', L / 2, 0, 0], ['B', L, 0, 0]], [['m1', 'A', 'M'], ['m2', 'M', 'B']],
      [['A', [true, true, true, true, false, false]], ['B', [false, true, true, false, false, false]]], [{ member: [['m1', [0, w, 0]], ['m2', [0, w, 0]]] }]);
    const { results } = solve(am), W = -w;
    expect(rel(node(results, 0, 'M').uy, -5 * W * L ** 4 / (384 * E * Iz))).toBeLessThan(1e-9);
    expect(rel(node(results, 0, 'A').rz, -W * L ** 3 / (24 * E * Iz))).toBeLessThan(1e-9);
    for (const n of ['A', 'B']) expect(rel(reaction(results, 0, n).fy, W * L / 2 / 1000)).toBeLessThan(1e-9);
    expect(rel(forces(results, 0, 'm1')[4]!.mz, W * L ** 2 / 8 / 1e6)).toBeLessThan(1e-9);
    expect(rel(forces(results, 0, 'm1')[2]!.mz, W * (L / 4) * (L - L / 4) / 2 / 1e6)).toBeLessThan(1e-9);
    expect(Math.abs(forces(results, 0, 'm1')[0]!.mz)).toBeLessThan(1e-9); expect(rel(Math.abs(forces(results, 0, 'm1')[0]!.vy), W * L / 2 / 1000)).toBeLessThan(1e-9);
  });
  it('cantilever with tip loads in both bending planes: PL³/3EI and fixed-end moment PL', () => {
    const L = 3000, Py = -20000, Pz = 4000;
    const am = analysisModel([['F', 0, 0, 0], ['T', L, 0, 0]], [['c', 'F', 'T']], [['F', FIXED]], [{ nodal: [['T', [0, Py, 0]]] }, { nodal: [['T', [0, 0, Pz]]] }]);
    const { results } = solve(am);
    expect(rel(node(results, 0, 'T').uy, Py * L ** 3 / (3 * E * Iz))).toBeLessThan(1e-9);
    // Reaction moment cancels r × F of the tip load about the support.
    expect(rel(reaction(results, 0, 'F').fy, -Py / 1000)).toBeLessThan(1e-9); expect(rel(reaction(results, 0, 'F').mz, -Py * L / 1e6)).toBeLessThan(1e-9);
    expect(rel(node(results, 1, 'T').uz, Pz * L ** 3 / (3 * E * Iy))).toBeLessThan(1e-9); expect(rel(reaction(results, 1, 'F').my, Pz * L / 1e6)).toBeLessThan(1e-9);
  });
  it('fixed-base column: axial shortening PL/EA, compression N = −P, biaxial tip drift on the documented local axes', () => {
    const L = 3000, P = 100000, Hx = 5000, Hz = 3000;
    const am = analysisModel([['B', 0, 0, 0], ['T', 0, L, 0]], [['col', 'B', 'T']], [['B', FIXED]], [{ nodal: [['T', [0, -P, 0]]] }, { nodal: [['T', [Hx, 0, Hz]]] }]);
    const { results } = solve(am);
    expect(rel(node(results, 0, 'T').uy, -P * L / (E * A))).toBeLessThan(1e-9);
    for (const st of forces(results, 0, 'col')) expect(rel(st.n, -P / 1000)).toBeLessThan(1e-9);
    // Vertical member: local y = global X (uses Iz), local z = −global Z (uses Iy).
    expect(rel(node(results, 1, 'T').ux, Hx * L ** 3 / (3 * E * Iz))).toBeLessThan(1e-9);
    expect(rel(node(results, 1, 'T').uz, Hz * L ** 3 / (3 * E * Iy))).toBeLessThan(1e-9);
  });
  it('two-span continuous beam: three-moment theorem reactions 3wL/8, 10wL/8 and support moment −wL²/8', () => {
    const L = 5000, w = -12;
    const am = analysisModel([['A', 0, 0, 0], ['B', L, 0, 0], ['C', 2 * L, 0, 0]], [['s1', 'A', 'B'], ['s2', 'B', 'C']],
      [['A', [true, true, true, true, false, false]], ['B', [false, true, true, false, false, false]], ['C', [false, true, true, false, false, false]]], [{ member: [['s1', [0, w, 0]], ['s2', [0, w, 0]]] }]);
    const { results } = solve(am), W = -w;
    expect(rel(reaction(results, 0, 'A').fy, 3 * W * L / 8 / 1000)).toBeLessThan(1e-9); expect(rel(reaction(results, 0, 'C').fy, 3 * W * L / 8 / 1000)).toBeLessThan(1e-9);
    expect(rel(reaction(results, 0, 'B').fy, 10 * W * L / 8 / 1000)).toBeLessThan(1e-9);
    expect(rel(forces(results, 0, 's1')[4]!.mz, -W * L * L / 8 / 1e6)).toBeLessThan(1e-9);
  });
  it('pinned-base portal frame under antisymmetric lateral load: statics give H/2 shears and hH/W uplift', () => {
    const h = 3000, W = 6000, H = 10000, pin: Restraint = [true, true, true, true, true, false];
    const am = analysisModel([['A', 0, 0, 0], ['B', 0, h, 0], ['C', W, h, 0], ['D', W, 0, 0]], [['ab', 'A', 'B'], ['bc', 'B', 'C'], ['dc', 'D', 'C']],
      [['A', pin], ['D', pin]], [{ nodal: [['B', [H / 2, 0, 0]], ['C', [H / 2, 0, 0]]] }]);
    const { results } = solve(am);
    for (const n of ['A', 'D']) { expect(rel(reaction(results, 0, n).fx, -H / 2 / 1000)).toBeLessThan(1e-9); expect(Math.abs(reaction(results, 0, n).mz)).toBe(0); }
    expect(rel(reaction(results, 0, 'D').fy, h * H / W / 1000)).toBeLessThan(1e-9); expect(rel(reaction(results, 0, 'A').fy, -h * H / W / 1000)).toBeLessThan(1e-9);
    expect(rel(Math.abs(forces(results, 0, 'ab')[4]!.mz), H / 2 * h / 1e6)).toBeLessThan(1e-9);
  });
  it('combinations equal a direct solve of the factored load vector', () => {
    const L = 4000, am = analysisModel([['A', 0, 0, 0], ['B', L, 0, 0]], [['c', 'A', 'B']], [['A', FIXED]], [{ member: [['c', [0, -3, 0]]] }, { nodal: [['B', [500, -2000, 700]]] }]);
    const combination = [{ id: sid('combo'), requestKey: 'k', profile: 'PROJECT_DEFINED', codeCompliance: 'NOT_CLAIMED', method: 'LINEAR_SUPERPOSITION',
      terms: [{ loadCaseId: sid('case0'), factor: 1.35, provenance: 'USER_PROVIDED' }, { loadCaseId: sid('case1'), factor: -1.5, provenance: 'USER_PROVIDED' }] }] as StructuralModel['combinations'];
    const combined = solve(am, combination).results.sets[2]!;
    const direct = solve(analysisModel([['A', 0, 0, 0], ['B', L, 0, 0]], [['c', 'A', 'B']], [['A', FIXED]], [{ member: [['c', [0, -3 * 1.35, 0]]], nodal: [['B', [-750, 3000, -1050]]] }])).results.sets[0]!;
    const flat = (s: typeof direct) => [...s.displacements.flatMap(d => [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]), ...s.reactions.flatMap(r => [r.fx, r.fy, r.fz, r.mx, r.my, r.mz]),
      ...s.memberForces.flatMap(f => f.stations.flatMap(st => [st.n, st.vy, st.vz, st.t, st.my, st.mz]))];
    const a = flat(combined), b = flat(direct), scale = Math.max(...b.map(Math.abs));
    a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(1e-9 * scale));
  });
  it('self-weight and line loads balance an independent hand total on the authored frame', () => {
    const { run, model } = analyzed(authored());
    const beamLengthM = (3900 * 4 + 5800 * 3) / 1000, columnLengthM = 6 * 3;
    const expected = 10 * beamLengthM + 2400 * 9.80665 * (0.23 * 0.45 * beamLengthM + 0.3 * 0.3 * columnLengthM) / 1000;
    const dead = run.results.sets[0]!, total = dead.reactions.reduce((s, r) => s + r.fy, 0);
    expect(rel(total, expected)).toBeLessThan(1e-9);
    // Symmetry about both centre lines: four equal corner and two equal middle reactions.
    const at = (x: number, z: number) => dead.reactions.find(r => { const n = model.nodes.find(k => k.id === r.nodeId)!.coordinates; return n.x === x && n.z === z; })!.fy;
    const corners = [at(100, 100), at(7900, 100), at(100, 5900), at(7900, 5900)];
    corners.forEach(c => expect(rel(c, corners[0]!)).toBeLessThan(1e-9)); expect(rel(at(4000, 100), at(4000, 5900))).toBeLessThan(1e-9);
  });
});

describe('Phase 24 solver adapter and untrusted output', () => {
  const m = authored(), { model } = prepared(m);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = (mutate: (raw: any) => void): StructuralSolverAdapter => ({ ...REFERENCE_FRAME_SOLVER, analyze: (am, o) => { const raw = REFERENCE_FRAME_SOLVER.analyze(am, o) as any; mutate(raw); return raw; } });
  it('exposes metadata, capabilities and deterministic execution', () => {
    expect(REFERENCE_FRAME_SOLVER.metadata).toMatchObject({ name: 'nekoarch-reference-frame-3d', version: '1.0.0', adapterVersion: 'structural-adapter-v1' });
    expect(REFERENCE_FRAME_SOLVER.capabilities.analysisTypes).toEqual(['LINEAR_STATIC']);
    const a = runStructuralAnalysis(model), b = runStructuralAnalysis(model);
    expect(b.analysisModelHash).toBe(a.analysisModelHash); expect(b.results).toEqual(a.results);
    expect(structuralInputHash(model.binding, prepared(m).input)).toBe(structuralInputHash(model.binding, prepared(m).input));
  });
  it('rejects malformed, nonfinite, foreign, miscounted or mislabelled solver output', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cases: [string, (raw: any) => void][] = [
      ['NaN', raw => { raw.cases[0].displacements[0][0] = Number.NaN; }], ['Infinity', raw => { raw.cases[0].reactions[0][1] = Infinity; }],
      ['missing node', raw => { raw.cases[0].displacements.pop(); }], ['extra member', raw => { raw.cases[0].memberEndForces.push(raw.cases[0].memberEndForces[0]); }],
      ['unknown case', raw => { raw.cases[0].loadCaseId = 'other'; }], ['missing case', raw => { raw.cases.pop(); }], ['wrong units', raw => { raw.units.force = 'kN'; }],
      ['wrong model hash', raw => { raw.analysisModelHash = '0'.repeat(64); }], ['wrong solver', raw => { raw.solver.version = '9.9.9'; }],
      ['short vector', raw => { raw.cases[0].reactions[0].pop(); }], ['unexpected field', raw => { raw.debug = true; }],
    ];
    for (const [name, mutate] of cases) expect(codeOf(() => runStructuralAnalysis(model, wrap(mutate))), name).toBe('STRUCTURAL_RESULT_INVALID');
    expect(codeOf(() => runStructuralAnalysis(model, { ...REFERENCE_FRAME_SOLVER, analyze: () => { throw new Error('native crash'); } }))).toBe('STRUCTURAL_SOLVER_FAILED');
    expect(codeOf(() => runStructuralAnalysis(model, REFERENCE_FRAME_SOLVER, 0))).toBe('STRUCTURAL_ANALYSIS_TIMEOUT');
    expect(codeOf(() => runStructuralAnalysis(model, { ...REFERENCE_FRAME_SOLVER, validateInput: () => ['Degree-of-freedom limit exceeded'] }))).toBe('STRUCTURAL_MODEL_INVALID');
  });
});

describe('Phase 24 independent validators', () => {
  const m = authored(), { snapshot, model, input, bim } = analyzed(m);
  it('accepts the projected model and validated results with recorded equilibrium residuals', () => {
    expect(validateStructuralModel(model, bim.geometry, input, model.binding)).toEqual({ validator: 'structural-model-validator-v2', status: 'VALID', diagnostics: [] });
    const v = validateStructuralResults(snapshot, { binding: model.binding });
    expect(v.status).toBe('VALID'); expect(v.equilibrium).toHaveLength(4);
    for (const e of v.equilibrium) { expect(e.forceResidual.value).toBeLessThanOrEqual(e.forceTolerance.value); expect(e.forceResidual.unit).toBe('kN'); }
  });
  const modelMutations: [string, (x: StructuralModel) => void][] = [
    ['node moved', x => { x.nodes[0]!.coordinates.x += 1; }], ['member endpoint swapped', x => { const k = x.members[0]!; [k.startNodeId, k.endNodeId] = [k.endNodeId, k.startNodeId]; }],
    ['duplicate member', x => { x.members.push(structuredClone(x.members[0]!)); }], ['missing member', x => { x.members.pop(); }],
    ['invented density', x => { x.materials[0]!.density = { value: 7850, unit: 'kg/m3', provenance: 'USER_PROVIDED' }; }],
    ['invented modulus provenance', x => { (x.materials[0]!.elasticModulus as { provenance: string }).provenance = 'VERSIONED_ENGINEERING_LIBRARY'; }],
    ['section altered', x => { x.sections[0]!.iz.value *= 2; }], ['missing support', x => { x.supports.pop(); }],
    ['support restraint altered', x => { x.supports[0]!.restraints.RZ = false; }], ['support provenance altered', x => { x.supports[0]!.provenance = 'USER_PROVIDED'; }],
    ['load magnitude altered', x => { (x.loadCases[0]!.loads[0]!.magnitude as { value: number }).value *= 2; }], ['orphan load target', x => { x.loadCases[0]!.loads[0]!.memberId = x.nodes[0]!.id; }],
    ['factor altered', x => { x.combinations[0]!.terms[0]!.factor = 2; }], ['unknown load case', x => { x.combinations[0]!.terms[0]!.loadCaseId = x.nodes[0]!.id; }],
    ['wrong revision', x => { x.binding.revisionId = '44444444-4444-4444-8444-444444444444'; }], ['wrong model hash', x => { x.binding.modelHash = '0'.repeat(64); }],
    ['segment removed', x => { x.segments.pop(); }], ['mass altered', x => { x.members[0]!.quantities.mass.value = 1; }], ['NaN', x => { x.nodes[0]!.coordinates.y = Number.NaN; }],
    ['wrong storey', x => { x.nodes.find(n => n.levelId)!.levelId = null; }], ['component count', x => { x.topology.components = 2; }],
    ['dangling report forged', x => { x.topology.danglingNodeIds = [x.nodes[0]!.id]; }], ['split report forged', x => { x.topology.splitMemberIds = [x.members[0]!.id]; }],
    ['model assumption removed', x => { x.assumptions = x.assumptions.filter(a => a !== 'RIGID_JOINTS'); }], ['member assumption removed', x => { x.members[0]!.mapping.assumptions = []; }],
  ];
  it.each(modelMutations)('model validator rejects %s', (_name, mutate) => { const x = structuredClone(model); mutate(x); expect(validateStructuralModel(x, bim.geometry, input, model.binding).status).toBe('INVALID'); });
  const resultMutations: [string, (s: typeof snapshot) => void][] = [
    ['reaction altered', s => { s.results.sets[0]!.reactions[0]!.fy += 1; }], ['moment reaction altered', s => { s.results.sets[2]!.reactions[0]!.mx += 1; }],
    ['station altered', s => { s.results.sets[0]!.memberForces[0]!.stations[4]!.mz += 1; }], ['displacement missing', s => { s.results.sets[0]!.displacements.pop(); }],
    ['restrained displacement', s => { s.results.sets[0]!.displacements.find(d => s.model.supports.some(x => x.nodeId === d.nodeId))!.ux = 0.1; }],
    ['set missing', s => { s.results.sets.pop(); }], ['wrong units', s => { (s.results.units as { force: string }).force = 'N'; }],
    ['wrong binding', s => { s.binding = { ...s.binding, revisionId: '44444444-4444-4444-8444-444444444444' }; }], ['wrong input hash', s => { s.inputHash = '0'.repeat(64); }],
    ['unknown solver', s => { s.solver = { ...s.solver, version: '0.0.1' }; }], ['station position', s => { (s.results.sets[0]!.memberForces[0]!.stations[1] as { position: number }).position = 0.3; }],
    ['NaN result', s => { s.results.sets[0]!.displacements[0]!.uy = Number.NaN; }],
    // Self-consistent per segment, but breaks joint equilibrium: a constant axial force added along one segment.
    ['constant axial offset', s => { for (const st of s.results.sets[1]!.memberForces[0]!.stations) st.n += 5; }],
    ['constant torsion offset', s => { for (const st of s.results.sets[3]!.memberForces[2]!.stations) st.t += 2; }],
  ];
  it.each(resultMutations)('result validator rejects %s', (_name, mutate) => { const s = structuredClone(snapshot); mutate(s); expect(validateStructuralResults(s, { binding: model.binding }).status).toBe('INVALID'); });
  it('binds results to one revision: the same geometry in another revision has a different input hash', () => {
    const other = prepared(m, input, '55555555-5555-4555-8555-555555555555').model;
    expect(structuralInputHash(other.binding, input)).not.toBe(snapshot.inputHash);
    expect(validateStructuralResults(snapshot, { binding: other.binding }).status).toBe('INVALID');
  });
});

describe('Phase 24 native NekoArch fixtures', () => {
  const { layoutV2: _layout, ...v1 } = solverInput();
  const maximum = parametricInput(); maximum.site.boundary = [{ x: 0, z: 0 }, { x: 60000, z: 0 }, { x: 60000, z: 60000 }, { x: 0, z: 60000 }];
  Object.assign(maximum.parametricArchitecture.floors[0]!, { widthMm: 55000, depthMm: 55000, westWingWidthMm: 27000, southWingDepthMm: 27000 }); maximum.rooms = [{ type: 'bedroom', count: 24 }];
  const fixtures: [string, () => BuildingModelV2][] = [['v1', () => generateBlueprint(v1).model], ['v2', () => generateBlueprintV2(solverInput()).model],
    ['L', () => generateParametricBlueprint(parametricInput()).model], ['setback', () => generateParametricBlueprint(parametricInput(true)).model],
    ['maximum-24', () => generateParametricBlueprint(maximum).model],
    ['west-wing-edit', () => generateParametricBlueprint(modifyParametricRequirements(parametricInput(true), { level: 0, parameter: 'westWingWidthMm', valueMm: 10000 })).model],
    ['authored', () => authored()]];
  it.each(fixtures)('%s maps, validates, analyses and passes independent equilibrium', (_name, make) => {
    const m = make(), { model, input, bim, run, snapshot } = analyzed(m);
    expect(validateStructuralModel(model, bim.geometry, input, model.binding).status).toBe('VALID');
    const v = validateStructuralResults(snapshot, { binding: model.binding });
    expect(v.status, JSON.stringify(v.diagnostics.slice(0, 3))).toBe('VALID');
    expect(model.members).toHaveLength(input.members.length); expect(run.results.sets).toHaveLength(4);
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(STRUCTURAL_LIMITS.outputBytes);
  });
  it('treats an edited west wing as a different structural source', () => {
    const a = generateParametricBlueprint(parametricInput(true)).model;
    const b = generateParametricBlueprint(modifyParametricRequirements(parametricInput(true), { level: 0, parameter: 'westWingWidthMm', valueMm: 10000 })).model;
    const ma = prepared(a).model, mb = prepared(b, parse(frameInput(b)), '66666666-6666-4666-8666-666666666666').model;
    expect(mb.binding.modelHash).not.toBe(ma.binding.modelHash);
    expect(validateStructuralModel(ma, b, parse(frameInput(a)), mb.binding).status).toBe('INVALID');
  });
});

// ---------------------------------------------------------------- Phase 24 audit repair: each test reproduces an audit finding (A01–A06)
describe('Phase 24 audit repair (A01–A06)', () => {
  type Loads = StructuralInput['loadCases'][number]['loads'];
  type Dir = 'GLOBAL_X' | 'GLOBAL_Y' | 'GLOBAL_Z';
  const beam = (key: string, wallId: string) => ({ key, rule: 'BEAM_ALONG_WALL' as const, wallId, material: 'test-concrete', section: 'beam' });
  const column = (key: string, wallId: string, end: 'start' | 'end' = 'start') => ({ key, rule: 'COLUMN_AT_WALL_END' as const, wallId, end, material: 'test-concrete', section: 'col' });
  const udl = (key: string, member: string, value: number, direction: Dir = 'GLOBAL_Y') => ({ key, application: 'MEMBER_DISTRIBUTED' as const, target: { member }, direction, magnitude: { value, unit: 'kN/m' as const } });
  const point = (key: string, member: string, end: 'start' | 'end', value: number, direction: Dir = 'GLOBAL_Y') => ({ key, application: 'POINT' as const, target: { member, end }, direction, magnitude: { value, unit: 'kN' as const } });
  const custom = (members: StructuralInput['members'], supports: [string, 'start' | 'end', 'FIXED' | 'PINNED' | 'ROLLER'][], cases: Loads[], combinations: StructuralInput['combinations'] = []) =>
    parse({ ...frameInput(authored()), members, autoSupports: null, supports: supports.map(([member, end, type]) => ({ key: `${member}-${end}`, at: { member, end }, type })),
      loadCases: cases.map((loads, i) => ({ key: `c${i}`, category: 'USER_DEFINED', selfWeight: false, loads })), combinations });
  const authoredBim = () => { const m = authored(); return projectBim(m, binding(m)); };
  // Extra walls added to the BIM geometry directly (as the overlap test does), so the builder sees them without architectural QA.
  const withWalls = (walls: { id: string; start: { x: number; z: number }; end: { x: number; z: number } }[]) => {
    const b = structuredClone(authoredBim()), west = b.geometry.walls.find(w => w.id === 'west')!;
    for (const w of walls) b.geometry.walls.push({ ...structuredClone(west), id: w.id, path: { start: w.start, end: w.end } });
    return b;
  };
  const run = (bim: BimModel, input: StructuralInput, adapter: StructuralSolverAdapter = REFERENCE_FRAME_SOLVER) => {
    const model = buildStructuralModel(bim, input), r = runStructuralAnalysis(model, adapter);
    return { model, run: r, snapshot: { binding: model.binding, input, inputHash: structuralInputHash(model.binding, input), model, results: r.results, solver: r.solver } };
  };
  const check = (s: ReturnType<typeof run>['snapshot']) => validateStructuralResults(s, { binding: s.model.binding });
  const codes = (v: { diagnostics: { code: string }[] }) => [...new Set(v.diagnostics.map(d => d.code))];
  const DISP = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const, FORCES = ['n', 'vy', 'vz', 't', 'my', 'mz'] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = (mutate: (raw: any) => void): StructuralSolverAdapter => ({ ...REFERENCE_FRAME_SOLVER, analyze: (am, o) => { const raw = REFERENCE_FRAME_SOLVER.analyze(am, o) as any; mutate(raw); return raw; } });

  describe('A01 results must be the elastic solution, not merely in equilibrium', () => {
    const { snapshot, model } = run(authoredBim(), parse(frameInput(authored())));
    const freeNodes = (s: typeof snapshot, set = 0) => s.results.sets[set]!.displacements.filter(d => !s.model.supports.some(x => x.nodeId === d.nodeId));
    it('accepts the reference solution (counter-control)', () => { expect(check(snapshot)).toMatchObject({ validator: 'structural-result-validator-v2', status: 'VALID', diagnostics: [] }); });
    it.each(DISP.flatMap(k => [[k, 0], [k, 2]] as const))('rejects a fabricated free-node %s in set %i', (k, set) => {
      const s = structuredClone(snapshot); freeNodes(s, set)[0]![k] += k.startsWith('r') ? 1e-4 : 0.05;
      const v = check(s); expect(v.status).toBe('INVALID'); expect(codes(v)).toContain('CONSTITUTIVE');
    });
    it('rejects a fabricated rotation at every free node, including nodes that only end segments (cantilever tip)', () => {
      for (const node of freeNodes(snapshot)) for (const k of ['rx', 'ry', 'rz'] as const) {
        const s = structuredClone(snapshot); s.results.sets[0]!.displacements.find(d => d.nodeId === node.nodeId)![k] += 1e-4;
        expect(check(s).status, `${node.nodeId} ${k}`).toBe('INVALID');
      }
      const c = run(authoredBim(), custom([beam('b', 'west')], [['b', 'start', 'FIXED']], [[udl('q', 'b', -2)]]));
      const tip = c.snapshot.results.sets[0]!.displacements.find(d => d.nodeId === c.model.members[0]!.endNodeId)!, EIz = 30000 * 230 * 450 ** 3 / 12;
      // Independent closed forms for the 5800 mm cantilever under 2 N/mm: tip deflection wL⁴/8EI, tip rotation wL³/6EI (about global X here).
      expect(tip.uy).toBeCloseTo(-2 * 5800 ** 4 / (8 * EIz), 9); expect(Math.abs(tip.rx)).toBeCloseTo(2 * 5800 ** 3 / (6 * EIz), 12);
      expect(check(c.snapshot).status).toBe('VALID');
      for (const k of ['rx', 'ry', 'rz'] as const) {
        const s = structuredClone(c.snapshot); s.results.sets[0]!.displacements.find(d => d.nodeId === tip.nodeId)![k] += 1e-4;
        expect(codes(check(s)), k).toEqual(['CONSTITUTIVE']);
      }
    });
    it('rejects the audit probe (uy = 1e12 mm, rx = 1e9 rad), swapped free-node rows and a uniformly scaled displacement field', () => {
      const huge = structuredClone(snapshot); Object.assign(freeNodes(huge)[0]!, { uy: 1e12, rx: 1e9 }); expect(check(huge).status).toBe('INVALID');
      const swapped = structuredClone(snapshot), [a, b] = freeNodes(swapped);
      for (const k of DISP) [a![k], b![k]] = [b![k], a![k]];
      expect(check(swapped).status).toBe('INVALID');
      const scaled = structuredClone(snapshot); for (const d of scaled.results.sets[0]!.displacements) for (const k of DISP) d[k] *= 2;
      expect(codes(check(scaled))).toContain('CONSTITUTIVE');
    });
    it('rejects an equilibrium-consistent solution of a different stiffness distribution (beam I × 100, relabelled hash)', () => {
      const beams = new Set(model.members.filter(x => x.kind === 'BEAM').flatMap(x => x.segmentIds));
      const forged: StructuralSolverAdapter = { ...REFERENCE_FRAME_SOLVER, analyze: (am, o) => {
        const stiff = structuredClone(am); for (const x of stiff.members) if (beams.has(x.id)) { x.Iy *= 100; x.Iz *= 100; }
        const raw = REFERENCE_FRAME_SOLVER.analyze(stiff, o) as { analysisModelHash: string }; raw.analysisModelHash = digest(am); return raw;
      } };
      const r = runStructuralAnalysis(model, forged); // element statics and counts are self-consistent, so the raw boundary admits it
      const v = check({ ...snapshot, results: r.results });
      expect(v.status).toBe('INVALID'); expect(codes(v)).toEqual(['CONSTITUTIVE']);
      // Equilibrium alone is satisfied: the reason the v1 validator certified it.
      for (const e of v.equilibrium) { expect(e.forceResidual.value).toBeLessThanOrEqual(e.forceTolerance.value); expect(e.momentResidual.value).toBeLessThanOrEqual(e.momentTolerance.value); }
      expect(Math.max(...r.results.sets[0]!.reactions.map((x, i) => Math.abs(x.fy - snapshot.results.sets[0]!.reactions[i]!.fy)))).toBeGreaterThan(0.1);
    });
    it('rejects raw J-end values that violate element statics although results are built from the I end', () => {
      for (const p of [6, 7, 8, 9, 10, 11]) expect(codeOf(() => runStructuralAnalysis(model, wrap(raw => {
        const f: number[] = raw.cases[0].memberEndForces[3]; f[p]! += 0.01 * Math.max(...f.map(Math.abs));
      }))), `index ${p}`).toBe('STRUCTURAL_RESULT_INVALID');
      expect(codeOf(() => runStructuralAnalysis(model, wrap(raw => { for (const c of raw.cases) for (const f of c.memberEndForces) for (let i = 6; i < 12; i++) f[i] = 1e20; })))).toBe('STRUCTURAL_RESULT_INVALID');
    });
    it('rejects a statics-preserving end-moment pair: raw statics hold, but the joints and the curvature do not', () => {
      const r = runStructuralAnalysis(model, wrap(raw => { const f: number[] = raw.cases[0].memberEndForces[3]; f[5]! += 5e6; f[11]! -= 5e6; }));
      expect(check({ ...snapshot, results: r.results }).status).toBe('INVALID');
    });
    it('rejects a combination that is not the superposition of its load cases, even when its own displacement is moved', () => {
      const s = structuredClone(snapshot); s.results.sets[3]!.reactions[0]!.fy += 0.5;
      expect(codes(check(s))).toContain('COMBINATION');
      const d = structuredClone(snapshot); freeNodes(d, 3)[0]!.uy += 0.05; expect(codes(check(d))).toEqual(expect.arrayContaining(['CONSTITUTIVE', 'COMBINATION']));
    });
    it('rejects a reaction on an unrestrained degree of freedom (pinned end moment)', () => {
      const p = run(authoredBim(), custom([beam('b', 'west')], [['b', 'start', 'FIXED'], ['b', 'end', 'PINNED']], [[udl('q', 'b', -2)]]));
      expect(check(p.snapshot).status).toBe('VALID');
      const pinned = p.model.supports.find(x => x.type === 'PINNED')!.nodeId, s = structuredClone(p.snapshot);
      s.results.sets[0]!.reactions.find(x => x.nodeId === pinned)!.mx = 1;
      expect(codes(check(s))).toContain('SUPPORT');
      // Propped cantilever closed forms, wL = 11.6 kN: 3wL/8 at the pin, 5wL/8 and wL²/8 at the fixed end.
      const reactions = p.snapshot.results.sets[0]!.reactions, at = (id: string) => reactions.find(x => x.nodeId === id)!;
      expect(at(pinned).fy).toBeCloseTo(3 * 11.6 / 8, 9); expect(reactions.find(x => x.nodeId !== pinned)!.fy).toBeCloseTo(5 * 11.6 / 8, 9);
      expect(Math.abs(reactions.find(x => x.nodeId !== pinned)!.mx)).toBeCloseTo(2 * 5.8 ** 2 / 8, 9);
    });
  });

  describe('A02 every reported station is checked against the member load', () => {
    const { snapshot } = run(authoredBim(), parse(frameInput(authored())));
    it('rejects any fabricated component at stations 0.25, 0.5 and 0.75 in load-case and combination sets', () => {
      for (const set of [0, 1, 2, 3]) for (const station of [1, 2, 3]) for (const k of FORCES) {
        const s = structuredClone(snapshot); s.results.sets[set]!.memberForces[0]!.stations[station]![k] += 0.1;
        const v = check(s); expect(v.status, `${set}/${station}/${k}`).toBe('INVALID'); expect(codes(v), `${set}/${station}/${k}`).toContain('EQUILIBRIUM');
      }
      const audit = structuredClone(snapshot); Object.assign(audit.results.sets[0]!.memberForces[0]!.stations[2]!, { n: 1e12, vy: -1e12, vz: 1e12, t: -1e12, my: 1e12, mz: 1e12 });
      expect(check(audit).status).toBe('INVALID');
    });
    it('rejects a curve that matches both ends but not the load (linear instead of parabolic moment)', () => {
      const s = structuredClone(snapshot), beams = new Set(s.model.members.filter(x => x.kind === 'BEAM').flatMap(x => x.segmentIds));
      const mf = s.results.sets[0]!.memberForces.find(f => beams.has(f.segmentId))!, a = { ...mf.stations[0]! }, b = { ...mf.stations[4]! };
      for (const st of mf.stations) for (const k of FORCES) st[k] = a[k] + (b[k] - a[k]) * st.position;
      expect(codes(check(s))).toContain('EQUILIBRIUM');
    });
  });

  describe('A03 same-plane crossings are connected through a node or rejected', () => {
    const [X, Z] = CROSSING_WALLS as [typeof CROSSING_WALLS[number], typeof CROSSING_WALLS[number]];
    const twoBeams = custom([beam('x', 'cross-x'), beam('z', 'cross-z')], [['x', 'start', 'FIXED'], ['z', 'start', 'FIXED']], [[udl('q', 'x', -5)]]);
    it('rejects an X crossing with no node, whatever the member order or direction', () => {
      for (const walls of [[X, Z], [Z, X], [X, { ...Z, start: Z.end, end: Z.start }], [{ ...X, start: X.end, end: X.start }, Z]])
        expect(codeOf(() => buildStructuralModel(withWalls(walls), twoBeams))).toBe('STRUCTURAL_MODEL_INVALID');
    });
    it('keeps T and corner junctions connected through the shared endpoint', () => {
      const t = run(withWalls([X, { ...Z, start: { x: 6000, z: 3000 } }]), twoBeams);
      expect(t.model.topology).toMatchObject({ components: 1, splitMemberIds: [t.model.members.find(x => x.requestKey === 'x')!.id] });
      const corner = run(withWalls([X, { ...Z, start: { x: 7500, z: 3000 }, end: { x: 7500, z: 4500 } }]), twoBeams);
      expect(corner.model.topology.components).toBe(1);
      for (const r of [t, corner]) expect(check(r.snapshot).status).toBe('VALID');
    });
    it('connects a crossing where a third member ends, and splitting the wall reproduces the audit counter-control reactions', () => {
      const stub = { id: 'stub', start: { x: 6000, z: 3000 }, end: { x: 6000, z: 3300 } };
      const resolved = run(withWalls([X, Z, stub]), custom([beam('x', 'cross-x'), beam('z', 'cross-z'), column('c', 'stub')], [['x', 'start', 'FIXED'], ['z', 'start', 'FIXED'], ['c', 'start', 'FIXED']], [[udl('q', 'x', -5)]]));
      expect(resolved.model.topology.components).toBe(1); expect(resolved.model.topology.splitMemberIds).toHaveLength(2); expect(check(resolved.snapshot).status).toBe('VALID');
      const split = run(withWalls([{ ...X, end: { x: 6000, z: 3000 } }, { id: 'cross-x2', start: { x: 6000, z: 3000 }, end: X.end }, Z]),
        custom([beam('x', 'cross-x'), beam('x2', 'cross-x2'), beam('z', 'cross-z')], [['x', 'start', 'FIXED'], ['z', 'start', 'FIXED']], [[udl('q', 'x', -5), udl('q2', 'x2', -5)]]));
      const fy = split.run.results.sets[0]!.reactions.map(r => r.fy).sort();
      expect(fy[0]).toBeCloseTo(7.192733544086128, 9); expect(fy[1]).toBeCloseTo(7.807266455913869, 9); expect(fy[0]! + fy[1]!).toBeCloseTo(15, 12);
      expect(check(split.snapshot).status).toBe('VALID');
    });
    it('independently rejects a model that leaves the crossing unconnected, and one that fabricates a connection', () => {
      const stub = { id: 'stub', start: { x: 6000, z: 3000 }, end: { x: 6000, z: 3300 } }, bim = withWalls([X, Z, stub]);
      const withColumn = buildStructuralModel(bim, custom([beam('x', 'cross-x'), beam('z', 'cross-z'), column('c', 'stub')], [['x', 'start', 'FIXED'], ['z', 'start', 'FIXED'], ['c', 'start', 'FIXED']], [[udl('q', 'x', -5)]]));
      const col = withColumn.members.find(x => x.requestKey === 'c')!;
      // The Phase 24 output for the two-beam input: beams unsplit, no node at the crossing, two components.
      const unconnected = structuredClone(withColumn);
      unconnected.members = unconnected.members.filter(x => x.id !== col.id);
      unconnected.nodes = unconnected.nodes.filter(n => n.id !== col.startNodeId && n.id !== col.endNodeId);
      unconnected.supports = unconnected.supports.filter(x => x.nodeId !== col.startNodeId);
      const seg = (x: StructuralModel['members'][number]) => structuralId(projectId, 'segment', x.id, x.startNodeId, x.endNodeId);
      unconnected.segments = unconnected.members.map(x => ({ id: seg(x), memberId: x.id, startNodeId: x.startNodeId, endNodeId: x.endNodeId, length: { ...x.quantities.length } }));
      for (const x of unconnected.members) x.segmentIds = [seg(x)];
      unconnected.topology = { components: 2, danglingNodeIds: unconnected.members.map(x => x.endNodeId).sort(), splitMemberIds: [] };
      const v = validateStructuralModel(unconnected, bim.geometry, twoBeams, unconnected.binding);
      expect(v.diagnostics.map(d => [d.code, d.message])).toEqual([['TOPOLOGY', 'Segments intersect away from a shared node']]);
      // A crossing node and splits that no input member supports.
      const fabricated = structuredClone(withColumn);
      fabricated.members = fabricated.members.filter(x => x.id !== col.id);
      fabricated.nodes = fabricated.nodes.filter(n => n.id !== col.startNodeId); fabricated.supports = fabricated.supports.filter(x => x.nodeId !== col.startNodeId);
      fabricated.segments = fabricated.segments.filter(x => x.memberId !== col.id);
      expect(validateStructuralModel(fabricated, bim.geometry, twoBeams, fabricated.binding).status).toBe('INVALID');
    });
    it('leaves members at separated elevations unconnected (storey-to-storey plan crossings on the setback fixture)', () => {
      const m = generateParametricBlueprint(parametricInput(true)).model, { model, bim, input } = prepared(m);
      const at = new Map(model.nodes.map(n => [n.id, n.coordinates])), ends = model.members.filter(x => x.kind === 'BEAM').map(x => [at.get(x.startNodeId)!, at.get(x.endNodeId)!] as const);
      const inside = (v: number, a: number, b: number) => v > Math.min(a, b) && v < Math.max(a, b);
      const planCrossings = ends.flatMap(([a, b], i) => ends.slice(i + 1).filter(([c, d]) => a.y !== c.y && a.x !== b.x && c.z !== d.z && inside(c.x, a.x, b.x) && inside(a.z, c.z, d.z)));
      expect(planCrossings.length).toBeGreaterThan(0);
      expect(validateStructuralModel(model, bim.geometry, input, model.binding).status).toBe('VALID');
    });
  });

  describe('A04 fully restrained systems are analysed, mechanisms still rejected', () => {
    const wL = 2 * 5.8, wL2 = 2 * 5.8 ** 2;
    it('fixed–fixed beam: zero displacement, wL/2 reactions and wL²/12 end moments in every direction, with combinations', () => {
      const input = custom([beam('b', 'west')], [['b', 'start', 'FIXED'], ['b', 'end', 'FIXED']],
        [[udl('q', 'b', -2)], [udl('h', 'b', 3, 'GLOBAL_X'), udl('a', 'b', 4, 'GLOBAL_Z')]],
        [{ key: 'combo', profile: 'PROJECT_DEFINED', terms: [{ loadCase: 'c0', factor: 1.5 }, { loadCase: 'c1', factor: -1 }] }]);
      const { snapshot, model } = run(authoredBim(), input);
      expect(validateStructuralModel(model, authored(), input, model.binding).status).toBe('VALID'); expect(check(snapshot).status).toBe('VALID');
      for (const set of snapshot.results.sets) for (const d of set.displacements) for (const k of DISP) expect(Math.abs(d[k])).toBe(0);
      const set = (key: string) => snapshot.results.sets.find(x => x.id === (model.loadCases.find(c => c.requestKey === key) ?? model.combinations.find(c => c.requestKey === key))!.id)!;
      const gravity = set('c0'), lateral = set('c1'), combo = set('combo');
      for (const r of gravity.reactions) { expect(r.fy).toBeCloseTo(wL / 2, 12); expect(Math.abs(r.mx)).toBeCloseTo(wL2 / 12, 12); }
      expect(gravity.reactions[0]!.mx).toBeCloseTo(-gravity.reactions[1]!.mx, 12);
      for (const r of lateral.reactions) { expect(r.fx).toBeCloseTo(-3 * 5.8 / 2, 12); expect(r.fz).toBeCloseTo(-4 * 5.8 / 2, 12); expect(Math.abs(r.my)).toBeCloseTo(3 * 5.8 ** 2 / 12, 12); }
      for (const [i, r] of combo.reactions.entries()) expect(r.fy).toBeCloseTo(1.5 * gravity.reactions[i]!.fy - lateral.reactions[i]!.fy, 12);
    });
    it('all-fixed frame with a point load on a restrained node: the load goes straight to that reaction', () => {
      const input = custom([column('c', 'west'), beam('b', 'west')], [['c', 'start', 'FIXED'], ['b', 'start', 'FIXED'], ['b', 'end', 'FIXED']], [[point('p', 'b', 'start', -7), udl('q', 'b', -2)]]);
      const { snapshot, model } = run(authoredBim(), input), top = model.members.find(x => x.kind === 'BEAM')!.startNodeId;
      expect(check(snapshot).status).toBe('VALID');
      expect(snapshot.results.sets[0]!.reactions.find(r => r.nodeId === top)!.fy).toBeCloseTo(7 + wL / 2, 12);
      for (const st of snapshot.results.sets[0]!.memberForces.find(f => f.memberId !== model.members.find(x => x.kind === 'BEAM')!.id)!.stations) for (const k of FORCES) expect(Math.abs(st[k])).toBe(0);
    });
    it('a beam pinned at both ends still twists freely and is rejected as a mechanism', () => {
      expect(codeOf(() => run(authoredBim(), custom([beam('b', 'west')], [['b', 'start', 'PINNED'], ['b', 'end', 'PINNED']], [[udl('q', 'b', -2)]])))).toBe('STRUCTURAL_SYSTEM_UNSTABLE');
    });
  });

  describe('A05 derived load expansion is preflighted as a typed resource limit', () => {
    const m = withPartitions(authored(), [CROSSING_WALLS[0]!, ...STUB_WALLS]), bim = projectBim(m, binding(m));
    const build = (loads: number, selfWeight = false) => buildStructuralModel(bim, parse(segmentedBeamInput(loads, selfWeight)));
    it('analyses exactly the limit and rejects one segment load past it, with and without self-weight', () => {
      expect(build(10).members.find(x => x.kind === 'BEAM')!.segmentIds).toHaveLength(8);
      expect(EXPANDED_MEMBER_LOADS).toBe(6000);
      const atLimit = runStructuralAnalysis(build(750)); // 750 × 8 = 6000
      expect(atLimit.analysisModel.loadCases[0]!.memberLoads).toHaveLength(6000);
      expect(codeOf(() => build(751))).toBe('STRUCTURAL_RESOURCE_LIMIT'); // 6008
      expect(runStructuralAnalysis(build(748, true)).analysisModel.loadCases[0]!.memberLoads).toHaveLength(5999); // 5984 + 15 segments
      expect(codeOf(() => build(749, true))).toBe('STRUCTURAL_RESOURCE_LIMIT'); // 5992 + 15
    });
    it('rejects the audit request (1,000 loads × 8 segments) in the builder, so /validate and /analyses agree', () => {
      const input = segmentedBeamInput(1000);
      expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(STRUCTURAL_LIMITS.inputBytes);
      expect(codeOf(() => parse(input))).toBe('none');
      expect(codeOf(() => build(1000))).toBe('STRUCTURAL_RESOURCE_LIMIT');
    });
  });

  describe('A06 descriptive section and mass fields must agree with the structured values', () => {
    const bim = authoredBim(), input = parse(frameInput(authored())), model = buildStructuralModel(bim, input);
    const rect = (x: StructuralModel) => x.sections.find(s => s.shape === 'RECTANGLE')!;
    const mutations: [string, (x: StructuralModel) => void][] = [
      ['rectangle dimensions changed, properties kept', x => { rect(x).dimensions = { width: { value: 9999, unit: 'mm' }, depth: { value: 1, unit: 'mm' } }; }],
      ['rectangle relabelled GENERIC without dimensions', x => { Object.assign(rect(x), { shape: 'GENERIC', dimensions: null }); }],
      ['derivation method relabelled', x => { rect(x).j.method = 'exact-rectangle'; }],
      ['derivation method removed', x => { rect(x).area.method = null; }],
      ['section request key relabelled', x => { rect(x).requestKey = 'other'; }],
      ['material request key relabelled', x => { x.materials[0]!.requestKey = 'other'; }],
      ['evaluated mass relabelled NOT_EVALUATED', x => { x.members[0]!.quantities.mass.status = 'NOT_EVALUATED'; }],
      ['evaluated mass value removed', x => { x.members[0]!.quantities.mass.value = null; }],
    ];
    it.each(mutations)('rejects: %s', (_name, mutate) => { const x = structuredClone(model); mutate(x); expect(validateStructuralModel(x, bim.geometry, input, model.binding).status).toBe('INVALID'); });
    it('keeps legitimate GENERIC sections and density-free NOT_EVALUATED mass valid, and rejects their contradictions', () => {
      const generic = parse({ ...frameInput(authored(), { selfWeight: false }), materials: [{ ...TEST_CONCRETE, density: null }],
        sections: [{ key: 'col', shape: 'GENERIC', area: { value: 90000, unit: 'mm2' }, iy: { value: 6.75e8, unit: 'mm4' }, iz: { value: 6.75e8, unit: 'mm4' }, j: { value: 1.1e9, unit: 'mm4' } },
          { key: 'beam', shape: 'RECTANGLE', width: { value: 230, unit: 'mm' }, depth: { value: 450, unit: 'mm' } }] });
      const g = buildStructuralModel(bim, generic), valid = (x: StructuralModel) => validateStructuralModel(x, bim.geometry, generic, g.binding).status;
      expect(valid(g)).toBe('VALID'); expect(g.members.every(x => x.quantities.mass.status === 'NOT_EVALUATED' && x.quantities.mass.value === null)).toBe(true);
      const gen = (x: StructuralModel) => x.sections.find(s => s.shape === 'GENERIC')!;
      const relabelled = structuredClone(g); Object.assign(gen(relabelled), { shape: 'RECTANGLE', dimensions: { width: { value: 300, unit: 'mm' }, depth: { value: 300, unit: 'mm' } } });
      const invented = structuredClone(g); invented.members[0]!.quantities.mass = { value: 1, unit: 'kg', status: 'EVALUATED' };
      for (const x of [relabelled, invented]) expect(valid(x)).toBe('INVALID');
    });
  });
});
