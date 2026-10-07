import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { digest } from '../bim/core.js';
import { AnalysisModelSchema, RESULT_UNITS, ResultsSchema, STATIONS, STRUCTURAL_ANALYSIS_MODEL_VERSION, STRUCTURAL_ANALYSIS_VERSION, STRUCTURAL_LIMITS, STRUCTURAL_MODEL_VERSION,
  StructuralError, type AnalysisModel, type ResultSet, type StructuralBinding, type StructuralInput, type StructuralModel, type StructuralResults } from './contracts.js';
import { REFERENCE_FRAME_SOLVER, localAxes, type StructuralSolverAdapter } from './frame-solver.js';
import { STANDARD_GRAVITY, convert, selfWeightLineLoad } from './units.js';

const AXIS = { GLOBAL_X: 0, GLOBAL_Y: 1, GLOBAL_Z: 2 } as const;

/** Semantic model → solver-neutral analysis model in N, mm, MPa. Self-weight is generated here, only when requested. */
export function toAnalysisModel(model: StructuralModel): AnalysisModel {
  const members = new Map(model.members.map(m => [m.id, m]));
  const materials = new Map(model.materials.map(m => [m.id, m])), sections = new Map(model.sections.map(s => [s.id, s]));
  const property = (memberId: string) => {
    const m = members.get(memberId)!, mat = materials.get(m.materialId)!, sec = sections.get(m.sectionId)!;
    if (mat.elasticModulus.value === null || mat.poissonRatio.value === null) throw new StructuralError('STRUCTURAL_MATERIAL_MISSING', 'Material stiffness is not specified');
    return { E: mat.elasticModulus.value, G: mat.elasticModulus.value / (2 * (1 + mat.poissonRatio.value)), A: sec.area.value, Iy: sec.iy.value, Iz: sec.iz.value, J: sec.j.value, density: mat.density.value };
  };
  return AnalysisModelSchema.parse({
    version: STRUCTURAL_ANALYSIS_MODEL_VERSION, analysisType: 'LINEAR_STATIC', formulation: 'EULER_BERNOULLI_3D_FRAME', joints: 'RIGID',
    units: { length: 'mm', force: 'N', moment: 'N*mm', stress: 'MPa', rotation: 'rad', lineLoad: 'N/mm' }, localAxes: 'REFERENCE_VECTOR_V1',
    nodes: model.nodes.map(n => ({ id: n.id, x: n.coordinates.x, y: n.coordinates.y, z: n.coordinates.z })),
    members: model.segments.map(s => { const { density: _density, ...p } = property(s.memberId); return { id: s.id, nodeI: s.startNodeId, nodeJ: s.endNodeId, ...p }; }),
    restraints: model.supports.map(s => ({ nodeId: s.nodeId, dofs: [s.restraints.UX, s.restraints.UY, s.restraints.UZ, s.restraints.RX, s.restraints.RY, s.restraints.RZ] })),
    loadCases: model.loadCases.map(c => {
      const nodalLoads: AnalysisModel['loadCases'][number]['nodalLoads'] = [], memberLoads: AnalysisModel['loadCases'][number]['memberLoads'] = [];
      for (const l of c.loads) {
        const v: [number, number, number] = [0, 0, 0];
        if (l.application === 'POINT') { v[AXIS[l.direction]] = convert(l.magnitude.value, 'kN', 'N'); nodalLoads.push({ nodeId: l.nodeId, force: v }); continue; }
        v[AXIS[l.direction]] = convert(l.magnitude.value, 'kN/m', 'N/mm');
        for (const segment of members.get(l.memberId)!.segmentIds) memberLoads.push({ memberId: segment, w: [...v] });
      }
      if (c.selfWeight === 'INCLUDED') for (const s of model.segments) {
        const p = property(s.memberId);
        memberLoads.push({ memberId: s.id, w: [0, -selfWeightLineLoad(p.density!, p.A, STANDARD_GRAVITY.value), 0] });
      }
      return { id: c.id, nodalLoads, memberLoads };
    }),
  });
}

const finite = z.number().finite();
const RawOutputSchema = z.object({ solver: z.object({ name: z.string().max(100), version: z.string().max(100) }).strict(), analysisModelHash: z.string().regex(/^[a-f0-9]{64}$/),
  units: AnalysisModelSchema.shape.units, cases: z.array(z.object({ loadCaseId: z.string().max(64), displacements: z.array(z.array(finite).length(6)),
    memberEndForces: z.array(z.array(finite).length(12)), reactions: z.array(z.array(finite).length(6)) }).strict()).max(STRUCTURAL_LIMITS.loadCases) }).strict();
export type RawSolverOutput = z.infer<typeof RawOutputSchema>;

/** Solver output is untrusted input: identity, model hash, units, case/entity counts and finite values. */
export function validateRawOutput(raw: unknown, analysisModel: AnalysisModel, adapter: StructuralSolverAdapter): RawSolverOutput {
  const parsed = RawOutputSchema.safeParse(raw);
  const invalid = (message: string): never => { throw new StructuralError('STRUCTURAL_RESULT_INVALID', message); };
  if (!parsed.success) return invalid('Solver output is malformed, nonfinite or uses unexpected units');
  const out = parsed.data;
  if (out.solver.name !== adapter.metadata.name || out.solver.version !== adapter.metadata.version) invalid('Solver identity mismatch');
  if (out.analysisModelHash !== digest(analysisModel)) invalid('Solver output belongs to a different analysis model');
  if (out.cases.length !== analysisModel.loadCases.length || out.cases.some((c, i) => c.loadCaseId !== analysisModel.loadCases[i]!.id)) invalid('Solver output load cases differ from the analysis model');
  for (const c of out.cases) if (c.displacements.length !== analysisModel.nodes.length || c.memberEndForces.length !== analysisModel.members.length || c.reactions.length !== analysisModel.restraints.length)
    invalid('Solver output entity counts differ from the analysis model');
  // Element statics: the J-end half of each 12-vector is fixed by the I-end half and the uniform member load. Results are built from
  // the I end only, so without this the J end is unchecked. Forces (N) and moments (N·mm) get separate scales.
  const nodeById = new Map(analysisModel.nodes.map(n => [n.id, n]));
  for (const [ci, c] of out.cases.entries()) {
    const q = new Map<string, [number, number, number]>();
    for (const l of analysisModel.loadCases[ci]!.memberLoads) { const s = q.get(l.memberId) ?? [0, 0, 0]; q.set(l.memberId, [s[0] + l.w[0], s[1] + l.w[1], s[2] + l.w[2]]); }
    for (const [mi, mem] of analysisModel.members.entries()) {
      const a = nodeById.get(mem.nodeI)!, b = nodeById.get(mem.nodeJ)!, L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), R = localAxes(b.x - a.x, b.y - a.y, b.z - a.z);
      const w = q.get(mem.id) ?? [0, 0, 0], [qx, qy, qz] = [0, 1, 2].map(r => R[r]![0] * w[0] + R[r]![1] * w[1] + R[r]![2] * w[2]) as [number, number, number], f = c.memberEndForces[mi]!;
      const fScale = Math.max(1, ...[0, 1, 2, 6, 7, 8].map(i => Math.abs(f[i]!)), Math.hypot(qx, qy, qz) * L), mScale = Math.max(fScale * L, ...[3, 4, 5, 9, 10, 11].map(i => Math.abs(f[i]!)));
      const forces = [f[0]! + f[6]! + qx * L, f[1]! + f[7]! + qy * L, f[2]! + f[8]! + qz * L], moments = [f[3]! + f[9]!, f[5]! + f[11]! + L * f[7]! + qy * L * L / 2, f[4]! + f[10]! - L * f[8]! - qz * L * L / 2];
      if (forces.some(r => !(Math.abs(r) <= 1e-6 * fScale)) || moments.some(r => !(Math.abs(r) <= 1e-6 * mScale))) invalid('Solver member end forces violate element statics');
    }
  }
  return out;
}

/** Internal forces on the positive cut face at x from the I end, from validated end forces and the uniform local load. */
function station(f: number[], q: [number, number, number], x: number) {
  return { n: -(f[0]! + q[0] * x), vy: -(f[1]! + q[1] * x), vz: -(f[2]! + q[2] * x), t: -f[3]!,
    my: -(f[4]! + x * f[2]! + q[2] * x * x / 2), mz: -(f[5]! - x * f[1]! - q[1] * x * x / 2) };
}

export function buildResults(model: StructuralModel, analysisModel: AnalysisModel, raw: RawSolverOutput): StructuralResults {
  const nodes = new Map(analysisModel.nodes.map(n => [n.id, n])), segments = new Map(model.segments.map(s => [s.id, s]));
  const kN = (v: number) => convert(v, 'N', 'kN'), kNm = (v: number) => convert(v, 'N*mm', 'kN*m');
  const caseSets: ResultSet[] = raw.cases.map((c, ci) => {
    const lc = analysisModel.loadCases[ci]!, q = new Map<string, [number, number, number]>();
    for (const l of lc.memberLoads) { const s = q.get(l.memberId) ?? [0, 0, 0]; q.set(l.memberId, [s[0] + l.w[0], s[1] + l.w[1], s[2] + l.w[2]]); }
    return { id: c.loadCaseId, kind: 'LOAD_CASE',
      displacements: analysisModel.nodes.map((n, i) => { const d = c.displacements[i]!; return { nodeId: n.id, ux: d[0]!, uy: d[1]!, uz: d[2]!, rx: d[3]!, ry: d[4]!, rz: d[5]! }; }),
      reactions: analysisModel.restraints.map((r, i) => { const v = c.reactions[i]!; return { nodeId: r.nodeId, fx: kN(v[0]!), fy: kN(v[1]!), fz: kN(v[2]!), mx: kNm(v[3]!), my: kNm(v[4]!), mz: kNm(v[5]!) }; }),
      memberForces: analysisModel.members.map((m, i) => {
        const a = nodes.get(m.nodeI)!, b = nodes.get(m.nodeJ)!, L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), R = localAxes(b.x - a.x, b.y - a.y, b.z - a.z), w = q.get(m.id) ?? [0, 0, 0];
        const local = [0, 1, 2].map(r => R[r]![0] * w[0] + R[r]![1] * w[1] + R[r]![2] * w[2]) as [number, number, number];
        return { segmentId: m.id, memberId: segments.get(m.id)!.memberId, stations: STATIONS.map(position => {
          const s = station(c.memberEndForces[i]!, local, position * L);
          return { position, n: kN(s.n), vy: kN(s.vy), vz: kN(s.vz), t: kNm(s.t), my: kNm(s.my), mz: kNm(s.mz) };
        }) };
      }) };
  });
  const byCase = new Map(caseSets.map(s => [s.id, s]));
  // Linear superposition of validated case results; valid only for this linear-static analysis.
  const combine = (combo: StructuralModel['combinations'][number], value: (s: ResultSet) => number) => combo.terms.reduce((acc, t) => acc + t.factor * value(byCase.get(t.loadCaseId)!), 0);
  const combinationSets: ResultSet[] = model.combinations.map(combo => {
    const first = byCase.get(combo.terms[0]!.loadCaseId)!;
    return { id: combo.id, kind: 'COMBINATION',
      displacements: first.displacements.map((d, i) => ({ nodeId: d.nodeId, ...Object.fromEntries((['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const).map(k => [k, combine(combo, s => s.displacements[i]![k])])) }) as ResultSet['displacements'][number]),
      reactions: first.reactions.map((r, i) => ({ nodeId: r.nodeId, ...Object.fromEntries((['fx', 'fy', 'fz', 'mx', 'my', 'mz'] as const).map(k => [k, combine(combo, s => s.reactions[i]![k])])) }) as ResultSet['reactions'][number]),
      memberForces: first.memberForces.map((mf, i) => ({ segmentId: mf.segmentId, memberId: mf.memberId, stations: mf.stations.map((st, j) => ({ position: st.position,
        ...Object.fromEntries((['n', 'vy', 'vz', 't', 'my', 'mz'] as const).map(k => [k, combine(combo, s => s.memberForces[i]!.stations[j]![k])])) }) as ResultSet['memberForces'][number]['stations'][number]) })) };
  });
  return ResultsSchema.parse({ units: RESULT_UNITS, memberForceConvention: 'LOCAL_AXES_POSITIVE_CUT_FACE', sets: [...caseSets, ...combinationSets] });
}

export function structuralInputHash(binding: StructuralBinding, input: StructuralInput, adapter: StructuralSolverAdapter = REFERENCE_FRAME_SOLVER) {
  return digest({ structuralModelVersion: STRUCTURAL_MODEL_VERSION, analysisVersion: STRUCTURAL_ANALYSIS_VERSION, binding, input, solver: adapter.metadata });
}

/** Analysis model → adapter → untrusted output validation → result DTO. */
export function runStructuralAnalysis(model: StructuralModel, adapter: StructuralSolverAdapter = REFERENCE_FRAME_SOLVER, budgetMs: number = STRUCTURAL_LIMITS.solverMs) {
  const timings = { analysisModelMs: 0, solverMs: 0, outputValidationMs: 0, resultBuildMs: 0 };
  let t = performance.now();
  const analysisModel = toAnalysisModel(model);
  const diagnostics = adapter.validateInput(analysisModel);
  if (diagnostics.length) throw new StructuralError('STRUCTURAL_MODEL_INVALID', `Solver rejected the analysis model: ${diagnostics[0]}`);
  timings.analysisModelMs = performance.now() - t; t = performance.now();
  let raw: unknown;
  try { raw = adapter.analyze(analysisModel, { deadline: t + budgetMs }); }
  catch (error) { if (error instanceof StructuralError) throw error; throw new StructuralError('STRUCTURAL_SOLVER_FAILED', 'The structural solver failed'); }
  timings.solverMs = performance.now() - t; t = performance.now();
  const validated = validateRawOutput(raw, analysisModel, adapter);
  timings.outputValidationMs = performance.now() - t; t = performance.now();
  const results = buildResults(model, analysisModel, validated);
  timings.resultBuildMs = performance.now() - t;
  const { name, version, adapterVersion, settings } = adapter.metadata;
  return { analysisModel, analysisModelHash: digest(analysisModel), results, timings,
    solver: { name, version, adapterVersion, settings, executionMs: timings.solverMs,
      warnings: model.topology.danglingNodeIds.length ? [`${model.topology.danglingNodeIds.length} unsupported member end node(s) connect to a single member`] : [] } };
}
