import { performance } from 'node:perf_hooks';
import { digest } from '../bim/core.js';
import { STRUCTURAL_ADAPTER_VERSION, STRUCTURAL_LIMITS, StructuralError, type AnalysisModel } from './contracts.js';

/** Solver-neutral boundary. Domain types never depend on a solver's internal representation. */
export interface StructuralSolverAdapter {
  metadata: { name: string; version: string; adapterVersion: typeof STRUCTURAL_ADAPTER_VERSION; settings: Record<string, string | number> };
  capabilities: { analysisTypes: readonly string[]; formulations: readonly string[]; loadTypes: readonly string[]; maxDof: number };
  validateInput(model: AnalysisModel): string[];
  /** Raw output is untrusted by callers and validated before use. */
  analyze(model: AnalysisModel, options: { deadline: number }): unknown;
}

type Vec3 = [number, number, number];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };

/** REFERENCE_VECTOR_V1: x = I→J; reference global +Y, or global +X when x is vertical; z = x × ref; y = z × x. */
export function localAxes(dx: number, dy: number, dz: number): [Vec3, Vec3, Vec3] {
  const ex = unit([dx, dy, dz]), ref: Vec3 = Math.abs(ex[1]) > 1 - 1e-9 ? [1, 0, 0] : [0, 1, 0];
  const ez = unit(cross(ex, ref));
  return [ex, cross(ez, ex), ez];
}

/** 12×12 Euler-Bernoulli element stiffness in local axes; DOF order per node UX UY UZ RX RY RZ. */
export function localStiffness(E: number, G: number, A: number, Iy: number, Iz: number, J: number, L: number) {
  const k = new Float64Array(144), set = (i: number, j: number, v: number) => { k[i * 12 + j] = v; k[j * 12 + i] = v; };
  const ea = E * A / L, gj = G * J / L, z12 = 12 * E * Iz / L ** 3, z6 = 6 * E * Iz / L ** 2, y12 = 12 * E * Iy / L ** 3, y6 = 6 * E * Iy / L ** 2;
  set(0, 0, ea); set(6, 6, ea); set(0, 6, -ea);
  set(3, 3, gj); set(9, 9, gj); set(3, 9, -gj);
  set(1, 1, z12); set(7, 7, z12); set(1, 7, -z12); set(1, 5, z6); set(1, 11, z6); set(5, 7, -z6); set(7, 11, -z6);
  set(5, 5, 4 * E * Iz / L); set(11, 11, 4 * E * Iz / L); set(5, 11, 2 * E * Iz / L);
  set(2, 2, y12); set(8, 8, y12); set(2, 8, -y12); set(2, 4, -y6); set(2, 10, -y6); set(4, 8, y6); set(8, 10, y6);
  set(4, 4, 4 * E * Iy / L); set(10, 10, 4 * E * Iy / L); set(4, 10, 2 * E * Iy / L);
  return k;
}

/** End actions exerted by fixed supports on a member under a uniform local load q (force per length). */
export function fixedEndForces(q: Vec3, L: number) {
  const f = new Float64Array(12);
  f[0] = f[6] = -q[0] * L / 2;
  f[1] = f[7] = -q[1] * L / 2; f[5] = -q[1] * L * L / 12; f[11] = q[1] * L * L / 12;
  f[2] = f[8] = -q[2] * L / 2; f[4] = q[2] * L * L / 12; f[10] = -q[2] * L * L / 12;
  return f;
}

const SETTINGS = { method: 'DIRECT_STIFFNESS', factorization: 'SKYLINE_LDLT', ordering: 'REVERSE_CUTHILL_MCKEE', pivotTolerance: 1e-9, residualTolerance: 1e-8 } as const;

function validateInput(model: AnalysisModel): string[] {
  const errors: string[] = [], nodes = new Map(model.nodes.map(n => [n.id, n]));
  if (nodes.size !== model.nodes.length) errors.push('Duplicate node identifiers');
  if (new Set(model.members.map(m => m.id)).size !== model.members.length) errors.push('Duplicate member identifiers');
  for (const m of model.members) {
    const a = nodes.get(m.nodeI), b = nodes.get(m.nodeJ);
    if (!a || !b || m.nodeI === m.nodeJ) errors.push('Member has missing or identical end nodes');
    else if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) <= 0) errors.push('Zero-length member');
  }
  if (model.restraints.some(r => !nodes.has(r.nodeId)) || new Set(model.restraints.map(r => r.nodeId)).size !== model.restraints.length) errors.push('Invalid restraint');
  const members = new Set(model.members.map(m => m.id));
  for (const c of model.loadCases) if (c.nodalLoads.some(l => !nodes.has(l.nodeId)) || c.memberLoads.some(l => !members.has(l.memberId))) errors.push('Load references unknown entity');
  if (model.nodes.length * 6 > REFERENCE_FRAME_SOLVER.capabilities.maxDof) errors.push('Degree-of-freedom limit exceeded');
  return errors;
}

function analyze(model: AnalysisModel, { deadline }: { deadline: number }) {
  const check = () => { if (performance.now() > deadline) throw new StructuralError('STRUCTURAL_ANALYSIS_TIMEOUT', 'Structural analysis exceeded its time budget'); };
  const index = new Map(model.nodes.map((n, i) => [n.id, i])), memberIndex = new Map(model.members.map((m, i) => [m.id, i])), count = model.nodes.length;
  const elements = model.members.map(m => {
    const i = index.get(m.nodeI)!, j = index.get(m.nodeJ)!, a = model.nodes[i]!, b = model.nodes[j]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), R = localAxes(b.x - a.x, b.y - a.y, b.z - a.z);
    const k = localStiffness(m.E, m.G, m.A, m.Iy, m.Iz, m.J, L), kg = new Float64Array(144);
    // kg = Tᵀ k T with T = diag(R, R, R, R).
    for (let p = 0; p < 12; p++) for (let q = 0; q < 12; q++) {
      const bp = p - p % 3, bq = q - q % 3; let s = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s += R[r]![p % 3]! * k[(bp + r) * 12 + bq + c]! * R[c]![q % 3]!;
      kg[p * 12 + q] = s;
    }
    return { i, j, L, R, k, kg };
  });
  // Reverse Cuthill–McKee node ordering bounds the skyline profile.
  const adjacency: number[][] = Array.from({ length: count }, () => []);
  for (const e of elements) { adjacency[e.i]!.push(e.j); adjacency[e.j]!.push(e.i); }
  const degree = (n: number) => adjacency[n]!.length, order: number[] = [], visited = new Uint8Array(count);
  for (const root of [...Array(count).keys()].sort((a, b) => degree(a) - degree(b) || a - b)) {
    if (visited[root]) continue;
    visited[root] = 1; const queue = [root];
    for (let head = 0; head < queue.length; head++) {
      const n = queue[head]!; order.push(n);
      for (const next of [...new Set(adjacency[n])].sort((a, b) => degree(a) - degree(b) || a - b)) if (!visited[next]) { visited[next] = 1; queue.push(next); }
    }
  }
  order.reverse();
  const restrained = new Uint8Array(count * 6);
  for (const r of model.restraints) r.dofs.forEach((fixed, d) => { if (fixed) restrained[index.get(r.nodeId)! * 6 + d] = 1; });
  const eq = new Int32Array(count * 6).fill(-1); let n = 0;
  for (const node of order) for (let d = 0; d < 6; d++) if (!restrained[node * 6 + d]) eq[node * 6 + d] = n++;
  // n === 0 is a fully restrained system, not a mechanism: U stays zero, element forces reduce to the fixed-end actions and reactions
  // to their resultants. Instability is detected only by the pivot test below, which has meaning only once a free DOF exists.
  const dofsOf = (e: (typeof elements)[number]) => Array.from({ length: 12 }, (_, p) => (p < 6 ? e.i : e.j) * 6 + p % 6);
  const top = Int32Array.from({ length: n }, (_, j) => j);
  for (const e of elements) {
    const eqs = dofsOf(e).map(d => eq[d]!).filter(v => v >= 0), low = Math.min(...eqs);
    for (const v of eqs) if (low < top[v]!) top[v] = low;
  }
  const start = new Float64Array(n + 1);
  for (let j = 0; j < n; j++) start[j + 1] = start[j]! + j - top[j]! + 1;
  if (start[n]! > STRUCTURAL_LIMITS.skylineEntries) throw new StructuralError('STRUCTURAL_RESOURCE_LIMIT', 'Stiffness profile exceeds the solver memory budget');
  const a = new Float64Array(start[n]!), at = (i: number, j: number) => start[j]! + i - top[j]!;
  for (const e of elements) {
    const dofs = dofsOf(e);
    for (let p = 0; p < 12; p++) for (let q = 0; q < 12; q++) {
      const r = eq[dofs[p]!]!, c = eq[dofs[q]!]!;
      if (r >= 0 && c >= 0 && r <= c) a[at(r, c)]! += e.kg[p * 12 + q]!;
    }
  }
  check();
  const diagonal = Float64Array.from({ length: n }, (_, j) => a[at(j, j)]!);
  // Skyline LDLᵀ (active column). Column j holds g above the diagonal, then l = g/d, and finally pivot d.
  for (let j = 0; j < n; j++) {
    check();
    for (let i = top[j]! + 1; i < j; i++) {
      let s = 0;
      for (let r = Math.max(top[i]!, top[j]!); r < i; r++) s += a[at(r, i)]! * a[at(r, j)]!;
      a[at(i, j)]! -= s;
    }
    let d = a[at(j, j)]!;
    for (let i = top[j]!; i < j; i++) { const g = a[at(i, j)]!, l = g / a[at(i, i)]!; a[at(i, j)] = l; d -= g * l; }
    if (!Number.isFinite(d) || d <= SETTINGS.pivotTolerance * Math.abs(diagonal[j]!)) throw new StructuralError('STRUCTURAL_SYSTEM_UNSTABLE', 'The stiffness matrix is singular or not positive definite; the structure is a mechanism');
    a[at(j, j)] = d;
  }
  const cases = model.loadCases.map(lc => {
    check();
    const full = new Float64Array(count * 6), fixed = new Map<number, Float64Array>();
    for (const l of lc.nodalLoads) for (let d = 0; d < 3; d++) full[index.get(l.nodeId)! * 6 + d]! += l.force[d]!;
    for (const l of lc.memberLoads) {
      const m = memberIndex.get(l.memberId)!, e = elements[m]!, R = e.R;
      const f = fixedEndForces([0, 1, 2].map(r => R[r]![0] * l.w[0] + R[r]![1] * l.w[1] + R[r]![2] * l.w[2]) as Vec3, e.L);
      const sum = fixed.get(m) ?? new Float64Array(12); f.forEach((v, p) => { sum[p]! += v; }); fixed.set(m, sum);
      const dofs = dofsOf(e);
      // Equivalent nodal loads = −Tᵀ f.
      for (let p = 0; p < 12; p++) { const block = p - p % 3; let g = 0; for (let r = 0; r < 3; r++) g += R[r]![p % 3]! * f[block + r]!; full[dofs[p]!]! -= g; }
    }
    const u = new Float64Array(n);
    for (let dof = 0; dof < count * 6; dof++) if (eq[dof]! >= 0) u[eq[dof]!] = full[dof]!;
    const rhs = Float64Array.from(u);
    for (let j = 0; j < n; j++) { let s = u[j]!; for (let r = top[j]!; r < j; r++) s -= a[at(r, j)]! * u[r]!; u[j] = s; }
    for (let j = 0; j < n; j++) u[j]! /= a[at(j, j)]!;
    for (let j = n - 1; j >= 0; j--) for (let r = top[j]!; r < j; r++) u[r]! -= a[at(r, j)]! * u[j]!;
    const U = new Float64Array(count * 6);
    for (let dof = 0; dof < count * 6; dof++) if (eq[dof]! >= 0) U[dof] = u[eq[dof]!]!;
    // Element-wise K·U is independent of the factorisation: residual at free DOFs, reactions at restrained DOFs.
    const internal = new Float64Array(count * 6);
    const forces = elements.map((e, m) => {
      const dofs = dofsOf(e), ue = dofs.map(d => U[d]!);
      for (let p = 0; p < 12; p++) { let s = 0; for (let q = 0; q < 12; q++) s += e.kg[p * 12 + q]! * ue[q]!; internal[dofs[p]!]! += s; }
      const local = ue.map((_, p) => { const block = p - p % 3; let s = 0; for (let c = 0; c < 3; c++) s += e.R[p % 3]![c]! * ue[block + c]!; return s; });
      const f = fixed.get(m);
      return Array.from({ length: 12 }, (_, p) => { let s = f?.[p] ?? 0; for (let q = 0; q < 12; q++) s += e.k[p * 12 + q]! * local[q]!; return s; });
    });
    let residual = 0, scale = 0;
    for (let dof = 0; dof < count * 6; dof++) if (eq[dof]! >= 0) { residual = Math.max(residual, Math.abs(internal[dof]! - full[dof]!)); scale = Math.max(scale, Math.abs(rhs[eq[dof]!]!)); }
    if (!(residual <= SETTINGS.residualTolerance * Math.max(scale, 1e-12))) throw new StructuralError('STRUCTURAL_SOLVER_FAILED', 'Solution residual exceeds the numerical tolerance');
    return { loadCaseId: lc.id,
      displacements: model.nodes.map((_, i) => Array.from(U.subarray(i * 6, i * 6 + 6))),
      memberEndForces: forces,
      reactions: model.restraints.map(r => { const base = index.get(r.nodeId)! * 6; return r.dofs.map((fixedDof, d) => fixedDof ? internal[base + d]! - full[base + d]! : 0); }) };
  });
  return { solver: { name: REFERENCE_FRAME_SOLVER.metadata.name, version: REFERENCE_FRAME_SOLVER.metadata.version }, analysisModelHash: digest(model), units: model.units, cases };
}

export const REFERENCE_FRAME_SOLVER: StructuralSolverAdapter = {
  metadata: { name: 'nekoarch-reference-frame-3d', version: '1.0.0', adapterVersion: STRUCTURAL_ADAPTER_VERSION, settings: SETTINGS },
  capabilities: { analysisTypes: ['LINEAR_STATIC'], formulations: ['EULER_BERNOULLI_3D_FRAME'], loadTypes: ['NODAL_FORCE', 'MEMBER_UNIFORM_GLOBAL'], maxDof: 6 * (STRUCTURAL_LIMITS.segments + 1) },
  validateInput, analyze,
};
