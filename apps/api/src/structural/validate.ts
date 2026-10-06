import { createHash } from 'node:crypto';
import type { BuildingModelV2 } from '@designflow/shared';
import { digest, semanticId } from '../bim/core.js';
import { MEMBER_ASSUMPTIONS, MODEL_ASSUMPTIONS, ModelValidationSchema, ResultValidationSchema, ResultsSchema, STATIONS, STRUCTURAL_ANALYSIS_VERSION, STRUCTURAL_MODEL_VERSION, StructuralModelSchema,
  type ModelValidation, type ResultValidation, type StructuralBinding, type StructuralInput, type StructuralModel } from './contracts.js';

/** Independent verifier. Deliberately imports nothing from model.ts, analysis.ts or the solver; it re-derives every expectation. */
const SOLVERS: Record<string, string[]> = { 'nekoarch-reference-frame-3d': ['1.0.0'] };
type Diagnostic = ModelValidation['diagnostics'][number];
const recorder = () => {
  const diagnostics: Diagnostic[] = [];
  return { diagnostics, error: (code: string, message: string, targetId: string | null = null) => { if (diagnostics.length < 199) diagnostics.push({ code, targetId, message, severity: 'ERROR' }); } };
};
const sameSet = (a: Iterable<string>, b: Iterable<string>) => { const x = [...a].sort(), y = [...b].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
const close = (a: number, b: number, rel = 1e-12) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

export function validateStructuralModel(candidate: unknown, source: BuildingModelV2, input: StructuralInput, binding: StructuralBinding): ModelValidation {
  const { diagnostics, error } = recorder();
  const done = () => ModelValidationSchema.parse({ validator: 'structural-model-validator-v1', status: diagnostics.some(d => d.severity === 'ERROR') ? 'INVALID' : 'VALID', diagnostics });
  const parsed = StructuralModelSchema.safeParse(candidate);
  if (!parsed.success) { error('SCHEMA', 'Structural model schema, unit or finite-value violation'); return done(); }
  const m = parsed.data, pid = binding.projectId;
  const sid = (...parts: (string | number | null)[]) => `str-${createHash('sha256').update(JSON.stringify([pid, STRUCTURAL_MODEL_VERSION, ...parts])).digest('hex').slice(0, 40)}`;
  if (digest(m.binding) !== digest(binding) || binding.structuralModelVersion !== STRUCTURAL_MODEL_VERSION) error('BINDING', 'Model is bound to a different revision, hash or version');

  // Members and their endpoints, recomputed from the authoritative wall/level geometry.
  type P = [number, number, number];
  const expectedMembers = new Map<string, { kind: string; a: P; b: P; levelId: string; wallId: string; end: string | null; material: string; section: string; key: string; rule: string }>();
  for (const im of input.members) {
    const wall = source.walls.find(w => w.id === im.wallId), level = source.levels.find(l => l.id === wall?.levelId);
    if (!wall || !level || level.floorToFloorHeightMm === null) { error('REFERENCE', 'Input member has no valid architectural source'); continue; }
    const yTop = level.elevationMm + level.floorToFloorHeightMm, column = im.rule === 'COLUMN_AT_WALL_END';
    const p = column ? (im.end === 'start' ? wall.path.start : wall.path.end) : null;
    const a: P = p ? [p.x, level.elevationMm, p.z] : [wall.path.start.x, yTop, wall.path.start.z], b: P = p ? [p.x, yTop, p.z] : [wall.path.end.x, yTop, wall.path.end.z];
    expectedMembers.set(sid('member', column ? 'COLUMN' : 'BEAM', im.rule, 'walls', wall.id, column ? im.end : null, level.id),
      { kind: column ? 'COLUMN' : 'BEAM', a, b, levelId: level.id, wallId: wall.id, end: column ? im.end : null, material: sid('material', im.material), section: sid('section', im.section), key: im.key, rule: im.rule });
  }
  const byKey = new Map([...expectedMembers].map(([id, e]) => [e.key, { id, ...e }]));
  const nodeKey = (p: P) => sid('node', p[0], p[1], p[2]);
  if (!sameSet(expectedMembers.keys(), m.members.map(x => x.id)) || m.members.length !== input.members.length) error('IDENTITY', 'Member inventory differs from the explicit mapping');
  const nodes = new Map(m.nodes.map(n => [n.id, n]));
  const expectedNodes = new Map<string, P>();
  for (const e of expectedMembers.values()) { expectedNodes.set(nodeKey(e.a), e.a); expectedNodes.set(nodeKey(e.b), e.b); }
  if (!sameSet(expectedNodes.keys(), nodes.keys()) || nodes.size !== m.nodes.length) error('IDENTITY', 'Node inventory differs from member endpoints');
  for (const [id, p] of expectedNodes) {
    const n = nodes.get(id);
    if (n && (n.coordinates.x !== p[0] || n.coordinates.y !== p[1] || n.coordinates.z !== p[2])) error('GEOMETRY', 'Node coordinates differ from source geometry', id);
    if (n && n.levelId !== (source.levels.filter(l => l.elevationMm === p[1]).map(l => l.id).sort()[0] ?? null)) error('GEOMETRY', 'Node storey context is wrong', id);
  }
  const sections = new Map(m.sections.map(s => [s.id, s])), materials = new Map(m.materials.map(x => [x.id, x]));
  for (const mm of m.members) {
    const e = expectedMembers.get(mm.id); if (!e) continue;
    if (mm.kind !== e.kind || mm.startNodeId !== nodeKey(e.a) || mm.endNodeId !== nodeKey(e.b) || mm.levelId !== e.levelId || mm.requestKey !== e.key || mm.mapping.rule !== e.rule) error('GEOMETRY', 'Member kind, endpoints, storey or rule differ from mapping', mm.id);
    if (mm.source.wallId !== e.wallId || mm.source.end !== e.end || mm.source.bimElementId !== semanticId(pid, 'wall', e.wallId)) error('REFERENCE', 'Member source reference is wrong', mm.id);
    if (mm.materialId !== e.material || mm.sectionId !== e.section || !materials.has(mm.materialId) || !sections.has(mm.sectionId)) error('REFERENCE', 'Member material or section reference is wrong', mm.id);
    const length = Math.abs(e.b[0] - e.a[0]) + Math.abs(e.b[1] - e.a[1]) + Math.abs(e.b[2] - e.a[2]);
    if (length <= 0 || [0, 1, 2].filter(i => e.a[i] !== e.b[i]).length !== 1) error('GEOMETRY', 'Member is zero-length or not axis-aligned', mm.id);
    const section = sections.get(mm.sectionId), material = materials.get(mm.materialId);
    if (section && material) {
      const volume = section.area.value * length / 1e9;
      if (mm.quantities.length.value !== length || mm.quantities.sectionArea.value !== section.area.value || !close(mm.quantities.volume.value, volume)
        || (material.density.value === null ? mm.quantities.mass.value !== null || mm.quantities.mass.status !== 'NOT_EVALUATED' : !close(mm.quantities.mass.value ?? NaN, material.density.value * volume)))
        error('QUANTITY', 'Structural quantity differs from geometry, section and density', mm.id);
      if (material.elasticModulus.value === null || material.poissonRatio.value === null) error('MATERIAL', 'Member material lacks stiffness properties', mm.id);
    }
  }
  for (const n of m.nodes) if (!sameSet(n.source.memberIds, m.members.filter(x => x.startNodeId === n.id || x.endNodeId === n.id).map(x => x.id))) error('REFERENCE', 'Node provenance lists wrong members', n.id);

  // Duplicates/overlaps and segmentation, by parametric projection on each member (integer coordinates: off-line points are ≥ 1 mm away).
  const coord = (id: string): P => { const n = nodes.get(id)!; return [n.coordinates.x, n.coordinates.y, n.coordinates.z]; };
  const expectedSegments = new Map<string, { member: string; a: string; b: string; length: number }>();
  for (const mm of m.members) {
    if (!nodes.has(mm.startNodeId) || !nodes.has(mm.endNodeId)) continue;
    const a = coord(mm.startNodeId), b = coord(mm.endNodeId), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const inside = m.nodes.map(n => coord(n.id)).map(p => {
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) + (p[2] - a[2]) * (b[2] - a[2])) / (L * L);
      return { p, t, off: Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1]), p[2] - a[2] - t * (b[2] - a[2])) };
    }).filter(x => x.off < 0.5 && x.t > 0 && x.t < 1).sort((x, y) => x.t - y.t).map(x => x.p);
    const chain = [a, ...inside, b];
    for (let i = 1; i < chain.length; i++) { const s = nodeKey(chain[i - 1]!), e = nodeKey(chain[i]!);
      expectedSegments.set(sid('segment', mm.id, s, e), { member: mm.id, a: s, b: e, length: Math.hypot(chain[i]![0] - chain[i - 1]![0], chain[i]![1] - chain[i - 1]![1], chain[i]![2] - chain[i - 1]![2]) }); }
  }
  const pairs = new Set<string>();
  for (const e of expectedSegments.values()) { const k = [e.a, e.b].sort().join(); if (pairs.has(k)) error('TOPOLOGY', 'Duplicate or overlapping members share a segment'); pairs.add(k); }
  if (!sameSet(expectedSegments.keys(), m.segments.map(s => s.id)) || m.segments.length !== expectedSegments.size) error('TOPOLOGY', 'Analysis segments differ from independent splitting');
  for (const s of m.segments) { const e = expectedSegments.get(s.id);
    if (e && (s.memberId !== e.member || s.startNodeId !== e.a || s.endNodeId !== e.b || s.length.value !== e.length)) error('TOPOLOGY', 'Segment endpoints or length differ', s.id); }
  for (const mm of m.members) if (!sameSet(mm.segmentIds, [...expectedSegments].filter(([, e]) => e.member === mm.id).map(([id]) => id))) error('TOPOLOGY', 'Member segment list differs', mm.id);

  // Materials and sections: exact transcription of user input; derived section properties recomputed.
  for (const im of input.materials) {
    const x = materials.get(sid('material', im.key)), spec = im.architecturalSpecificationId ? source.specifications.find(s => s.id === im.architecturalSpecificationId) : null;
    const prop = (q: { value: number } | null, p: { value: number | null; provenance: string }) => q ? p.value === q.value && p.provenance === 'USER_PROVIDED' : p.value === null && p.provenance === 'NOT_SPECIFIED';
    if (!x || x.category !== im.category || x.name !== im.name || !prop(im.elasticModulus, x.elasticModulus) || !prop(im.poissonRatio, x.poissonRatio) || !prop(im.density, x.density)
      || x.architecturalSpecificationId !== (spec?.id ?? null) || x.bimMaterialId !== (spec?.material ? semanticId(pid, 'material', spec.id) : null)) error('MATERIAL', 'Material differs from explicit input or invents a property', x?.id ?? null);
  }
  if (m.materials.length !== input.materials.length) error('MATERIAL', 'Unexpected material');
  for (const is of input.sections) {
    const x = sections.get(sid('section', is.key));
    if (!x) { error('SECTION', 'Missing section'); continue; }
    const want = is.shape === 'GENERIC' ? { A: is.area.value, Iy: is.iy.value, Iz: is.iz.value, J: is.j.value, p: 'USER_PROVIDED' } : (() => {
      const b = is.width.value, d = is.depth.value, t = Math.min(b, d), h = Math.max(b, d), ratio = t / h;
      return { A: b * d, Iz: b * d * d * d / 12, Iy: d * b * b * b / 12, J: h * t * t * t * (1 / 3 - 0.21 * ratio * (1 - ratio ** 4 / 12)), p: 'DERIVED_FROM_SECTION_DIMENSIONS' };
    })();
    if (!close(x.area.value, want.A) || !close(x.iy.value, want.Iy) || !close(x.iz.value, want.Iz) || !close(x.j.value, want.J, 1e-9) || [x.area, x.iy, x.iz, x.j].some(p => p.provenance !== want.p)) error('SECTION', 'Section property differs from input', x.id);
  }
  if (m.sections.length !== input.sections.length) error('SECTION', 'Unexpected section');

  // Supports.
  const endNode = (key: string, end: 'start' | 'end') => { const e = byKey.get(key); return e ? nodeKey(end === 'start' ? e.a : e.b) : null; };
  const dofs: Record<string, string[]> = { FIXED: ['UX', 'UY', 'UZ', 'RX', 'RY', 'RZ'], PINNED: ['UX', 'UY', 'UZ'], ROLLER: ['UY'] };
  const expectedSupports = new Map<string, { type: string; restraints: string[]; provenance: string }>();
  for (const s of input.supports) { const n = endNode(s.at.member, s.at.end); if (n) expectedSupports.set(n, { type: s.type, restraints: s.restraints ?? dofs[s.type]!, provenance: 'USER_PROVIDED' }); }
  if (input.autoSupports) {
    const bases = [...expectedMembers.values()].filter(e => e.kind === 'COLUMN'), low = Math.min(...bases.map(e => e.a[1]));
    for (const e of bases) if (e.a[1] === low && !expectedSupports.has(nodeKey(e.a))) expectedSupports.set(nodeKey(e.a), { type: input.autoSupports.type, restraints: dofs[input.autoSupports.type]!, provenance: 'ASSUMED' });
  }
  if (!sameSet(expectedSupports.keys(), m.supports.map(s => s.nodeId)) || m.supports.length !== expectedSupports.size || !m.supports.length) error('SUPPORT', 'Support inventory differs from input');
  for (const s of m.supports) { const e = expectedSupports.get(s.nodeId);
    if (s.id !== sid('support', s.nodeId) || !nodes.has(s.nodeId) || (e && (s.type !== e.type || s.provenance !== e.provenance || !sameSet(Object.entries(s.restraints).filter(([, v]) => v).map(([k]) => k), e.restraints)))) error('SUPPORT', 'Support identity, node, type or restraints are wrong', s.id); }

  // Loads, cases and combinations.
  if (m.loadCases.length !== input.loadCases.length) error('LOAD', 'Load case inventory differs');
  for (const ic of input.loadCases) {
    const c = m.loadCases.find(x => x.id === sid('loadCase', ic.key));
    if (!c || c.category !== ic.category || c.selfWeight !== (ic.selfWeight ? 'INCLUDED' : 'NOT_REQUESTED') || c.loads.length !== ic.loads.length) { error('LOAD', 'Load case differs from input', c?.id ?? null); continue; }
    if (ic.selfWeight && m.members.some(x => materials.get(x.materialId)?.density.value === null)) error('MATERIAL', 'Self-weight requested without density', c.id);
    for (const il of ic.loads) {
      const l = c.loads.find(x => x.id === sid('load', ic.key, il.key));
      const target = il.application === 'POINT' ? endNode(il.target.member, il.target.end) : il.application === 'MEMBER_DISTRIBUTED' ? byKey.get(il.target.member)?.id : null;
      if (!l || l.application !== il.application || l.direction !== il.direction || l.magnitude.value !== il.magnitude.value || l.magnitude.unit !== il.magnitude.unit || !target
        || (l.application === 'POINT' ? l.nodeId !== target : l.memberId !== target)) error('LOAD', 'Load differs from input or targets a missing entity', l?.id ?? null);
    }
  }
  if (m.combinations.length !== input.combinations.length) error('COMBINATION', 'Combination inventory differs');
  for (const ic of input.combinations) {
    const c = m.combinations.find(x => x.id === sid('combination', ic.key));
    if (!c || c.terms.length !== ic.terms.length || new Set(ic.terms.map(t => t.loadCase)).size !== ic.terms.length
      || ic.terms.some((t, i) => c.terms[i]!.loadCaseId !== sid('loadCase', t.loadCase) || c.terms[i]!.factor !== t.factor || !input.loadCases.some(x => x.key === t.loadCase) || t.factor === 0 || !Number.isFinite(t.factor)))
      error('COMBINATION', 'Combination terms or factors differ from input', c?.id ?? null);
  }

  // Connectivity by union-find; each component needs a support.
  const parent = new Map(m.nodes.map(n => [n.id, n.id]));
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  for (const s of m.segments) if (parent.has(s.startNodeId) && parent.has(s.endNodeId)) parent.set(find(s.startNodeId), find(s.endNodeId));
  const roots = new Set(m.nodes.map(n => find(n.id))), supportedRoots = new Set(m.supports.filter(s => parent.has(s.nodeId)).map(s => find(s.nodeId)));
  if ([...roots].some(r => !supportedRoots.has(r))) error('TOPOLOGY', 'A connected component has no support');
  if (m.topology.components !== roots.size) error('TOPOLOGY', 'Component count differs');
  const degree = new Map<string, number>();
  for (const s of m.segments) for (const n of [s.startNodeId, s.endNodeId]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const supported = new Set(m.supports.map(s => s.nodeId));
  if (!sameSet(m.topology.danglingNodeIds, [...degree].filter(([n, d]) => d === 1 && !supported.has(n)).map(([n]) => n))) error('TOPOLOGY', 'Dangling node report differs');
  if (!sameSet(m.topology.splitMemberIds, m.members.filter(x => x.segmentIds.length > 1).map(x => x.id))) error('TOPOLOGY', 'Split member report differs');
  if (m.assumptions.join() !== MODEL_ASSUMPTIONS.join() || m.members.some(x => x.mapping.assumptions.join() !== MEMBER_ASSUMPTIONS.join())) error('ASSUMPTION', 'Declared assumptions were removed or altered');
  return done();
}

/** Results: references, units, provenance, revision identity, global equilibrium and per-segment equilibrium against semantic loads. */
export function validateStructuralResults(snapshot: { binding: StructuralBinding; input: StructuralInput; inputHash: string; model: StructuralModel; results: unknown;
  solver: { name: string; version: string; adapterVersion: string; settings: Record<string, string | number> } }, expected: { binding: StructuralBinding }): ResultValidation {
  const { diagnostics, error } = recorder(), equilibrium: ResultValidation['equilibrium'] = [];
  const done = () => ResultValidationSchema.parse({ validator: 'structural-result-validator-v1', status: diagnostics.some(d => d.severity === 'ERROR') ? 'INVALID' : 'VALID', diagnostics, equilibrium });
  const parsed = ResultsSchema.safeParse(snapshot.results);
  if (!parsed.success) { error('SCHEMA', 'Result schema, unit or finite-value violation'); return done(); }
  const results = parsed.data, m = snapshot.model;
  if (digest(snapshot.binding) !== digest(expected.binding) || digest(m.binding) !== digest(expected.binding)) error('BINDING', 'Results are bound to a different revision or model hash');
  if (!SOLVERS[snapshot.solver.name]?.includes(snapshot.solver.version)) error('PROVENANCE', 'Unknown solver identity');
  const inputHash = digest({ structuralModelVersion: STRUCTURAL_MODEL_VERSION, analysisVersion: STRUCTURAL_ANALYSIS_VERSION, binding: expected.binding, input: snapshot.input,
    solver: { name: snapshot.solver.name, version: snapshot.solver.version, adapterVersion: snapshot.solver.adapterVersion, settings: snapshot.solver.settings } });
  if (inputHash !== snapshot.inputHash) error('PROVENANCE', 'Input hash does not match binding, input and solver');
  const expectedSets = [...m.loadCases.map(c => `LOAD_CASE:${c.id}`), ...m.combinations.map(c => `COMBINATION:${c.id}`)];
  if (results.sets.map(s => `${s.kind}:${s.id}`).join() !== expectedSets.join()) { error('REFERENCE', 'Result sets do not match load cases and combinations'); return done(); }

  type V = [number, number, number];
  const nodes = new Map(m.nodes.map(n => [n.id, [n.coordinates.x / 1000, n.coordinates.y / 1000, n.coordinates.z / 1000] as V])); // metres
  const members = new Map(m.members.map(x => [x.id, x])), materials = new Map(m.materials.map(x => [x.id, x])), sections = new Map(m.sections.map(x => [x.id, x]));
  const segments = new Map(m.segments.map(s => [s.id, s]));
  const axis = { GLOBAL_X: 0, GLOBAL_Y: 1, GLOBAL_Z: 2 } as const;
  // Applied loads in kN at points (m): point loads, member line-load resultants at member midpoints, self-weight ρ·g·A·L.
  const applied = new Map<string, { at: V; f: V }[]>(), lineLoads = new Map<string, Map<string, V>>();
  for (const c of m.loadCases) {
    const list: { at: V; f: V }[] = [], lines = new Map<string, V>();
    const addLine = (memberId: string, w: V) => { const s = lines.get(memberId) ?? [0, 0, 0]; lines.set(memberId, [s[0] + w[0], s[1] + w[1], s[2] + w[2]]); };
    for (const l of c.loads) {
      const f: V = [0, 0, 0]; f[axis[l.direction]] = l.magnitude.value;
      if (l.application === 'POINT') list.push({ at: nodes.get(l.nodeId)!, f }); else addLine(l.memberId, f);
    }
    if (c.selfWeight === 'INCLUDED') for (const x of m.members) addLine(x.id, [0, -materials.get(x.materialId)!.density.value! * 9.80665 * sections.get(x.sectionId)!.area.value * 1e-9, 0]);
    for (const [id, w] of lines) { const x = members.get(id)!, a = nodes.get(x.startNodeId)!, b = nodes.get(x.endNodeId)!, L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      list.push({ at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], f: [w[0] * L, w[1] * L, w[2] * L] }); }
    applied.set(c.id, list); lineLoads.set(c.id, lines);
  }
  for (const c of m.combinations) {
    applied.set(c.id, c.terms.flatMap(t => applied.get(t.loadCaseId)!.map(p => ({ at: p.at, f: p.f.map(v => v * t.factor) as V }))));
    const lines = new Map<string, V>();
    for (const t of c.terms) for (const [id, w] of lineLoads.get(t.loadCaseId)!) { const s = lines.get(id) ?? [0, 0, 0]; lines.set(id, [s[0] + t.factor * w[0], s[1] + t.factor * w[1], s[2] + t.factor * w[2]]); }
    lineLoads.set(c.id, lines);
  }
  const cross = (r: V, f: V): V => [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const segmentIds = m.segments.map(s => s.id), supportIds = m.supports.map(s => s.nodeId), nodeIds = m.nodes.map(n => n.id);
  const supports = new Map(m.supports.map(s => [s.nodeId, s.restraints]));
  for (const set of results.sets) {
    if (!sameSet(set.displacements.map(d => d.nodeId), nodeIds) || set.displacements.length !== nodeIds.length) error('REFERENCE', 'Displacements do not cover each node exactly once', set.id);
    if (!sameSet(set.reactions.map(r => r.nodeId), supportIds) || set.reactions.length !== supportIds.length) error('REFERENCE', 'Reactions do not cover each support exactly once', set.id);
    if (!sameSet(set.memberForces.map(f => f.segmentId), segmentIds) || set.memberForces.length !== segmentIds.length) error('REFERENCE', 'Member forces do not cover each segment exactly once', set.id);
    for (const d of set.displacements) { const r = supports.get(d.nodeId);
      if (r && (['UX', 'UY', 'UZ', 'RX', 'RY', 'RZ'] as const).some((k, i) => r[k] && [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz][i] !== 0)) error('SUPPORT', 'Restrained displacement is non-zero', d.nodeId); }
    // Global equilibrium.
    const F: V = [0, 0, 0], M: V = [0, 0, 0]; let fScale = 0, mScale = 0;
    const add = (at: V, f: V, moment: V = [0, 0, 0]) => {
      const rxf = cross(at, f);
      for (let i = 0; i < 3; i++) { F[i]! += f[i]!; M[i]! += rxf[i]! + moment[i]!; }
      fScale += Math.hypot(...f); mScale += Math.hypot(...at) * Math.hypot(...f) + Math.hypot(...moment);
    };
    for (const p of applied.get(set.id)!) add(p.at, p.f);
    for (const r of set.reactions) if (nodes.has(r.nodeId)) add(nodes.get(r.nodeId)!, [r.fx, r.fy, r.fz], [r.mx, r.my, r.mz]);
    const fTol = 1e-6 * Math.max(1, fScale), mTol = 1e-6 * Math.max(1, mScale), fRes = Math.hypot(...F), mRes = Math.hypot(...M);
    equilibrium.push({ setId: set.id, forceResidual: { value: fRes, unit: 'kN' }, momentResidual: { value: mRes, unit: 'kN*m' }, forceTolerance: { value: fTol, unit: 'kN' }, momentTolerance: { value: mTol, unit: 'kN*m' } });
    if (!(fRes <= fTol) || !(mRes <= mTol)) error('EQUILIBRIUM', 'Reactions do not balance the applied loads', set.id);
    // Per-segment equilibrium of reported station forces under the uniform member load (independently derived local axes),
    // then joint equilibrium: end actions on each node balance applied nodal loads and reactions.
    const joint = new Map<string, { f: V; m: V; scale: number }>();
    const atJoint = (nodeId: string, f: V, mo: V) => { const j = joint.get(nodeId) ?? { f: [0, 0, 0], m: [0, 0, 0], scale: 0 }; for (let i = 0; i < 3; i++) { j.f[i]! += f[i]!; j.m[i]! += mo[i]!; } j.scale += Math.hypot(...f) + Math.hypot(...mo); joint.set(nodeId, j); };
    for (const p of set.kind === 'LOAD_CASE' ? m.loadCases.find(c => c.id === set.id)!.loads.map(l => ({ l, factor: 1 })) : m.combinations.find(c => c.id === set.id)!.terms.flatMap(t => m.loadCases.find(c => c.id === t.loadCaseId)!.loads.map(l => ({ l, factor: t.factor }))))
      if (p.l.application === 'POINT') { const f: V = [0, 0, 0]; f[axis[p.l.direction]] = -p.l.magnitude.value * p.factor; atJoint(p.l.nodeId, f, [0, 0, 0]); }
    for (const r of set.reactions) atJoint(r.nodeId, [-r.fx, -r.fy, -r.fz], [-r.mx, -r.my, -r.mz]);
    for (const mf of set.memberForces) {
      const s = segments.get(mf.segmentId); if (!s || s.memberId !== mf.memberId) { error('REFERENCE', 'Segment/member mismatch', mf.segmentId); continue; }
      if (mf.stations.some((st, i) => st.position !== STATIONS[i])) error('REFERENCE', 'Unexpected station positions', mf.segmentId);
      const a = nodes.get(s.startNodeId)!, b = nodes.get(s.endNodeId)!, L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const ex: V = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L], ref: V = Math.abs(ex[1]) > 1 - 1e-9 ? [1, 0, 0] : [0, 1, 0];
      const zRaw = cross(ex, ref), zn = Math.hypot(...zRaw), ez: V = [zRaw[0] / zn, zRaw[1] / zn, zRaw[2] / zn], ey = cross(ez, ex);
      const w = lineLoads.get(set.id)!.get(s.memberId) ?? [0, 0, 0], dot = (u: V) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2], qx = dot(ex), qy = dot(ey), qz = dot(ez);
      const s0 = mf.stations[0]!, s1 = mf.stations[STATIONS.length - 1]!;
      const checks: [number, number][] = [[s1.n - s0.n, -qx * L], [s1.vy - s0.vy, -qy * L], [s1.vz - s0.vz, -qz * L], [s1.t - s0.t, 0],
        [s1.mz - s0.mz, -L * s0.vy + qy * L * L / 2], [s1.my - s0.my, L * s0.vz - qz * L * L / 2]];
      const scale = Math.max(1, ...mf.stations.flatMap(st => [st.n, st.vy, st.vz, st.t, st.my, st.mz].map(Math.abs)), Math.abs(qx * L), Math.abs(qy * L), Math.abs(qz * L));
      if (checks.some(([got, want]) => !(Math.abs(got - want) <= 1e-6 * scale * Math.max(1, L)))) error('EQUILIBRIUM', 'Segment station forces are not in equilibrium with the member load', mf.segmentId);
      // Node-on-member actions: start = −internal(0), end = +internal(1), rotated to global axes.
      const global = (x: number, y: number, z: number): V => [ex[0] * x + ey[0] * y + ez[0] * z, ex[1] * x + ey[1] * y + ez[1] * z, ex[2] * x + ey[2] * y + ez[2] * z];
      atJoint(s.startNodeId, global(-s0.n, -s0.vy, -s0.vz), global(-s0.t, -s0.my, -s0.mz));
      atJoint(s.endNodeId, global(s1.n, s1.vy, s1.vz), global(s1.t, s1.my, s1.mz));
    }
    for (const [nodeId, j] of joint) if (!(Math.hypot(...j.f) <= 1e-6 * Math.max(1, j.scale)) || !(Math.hypot(...j.m) <= 1e-6 * Math.max(1, j.scale))) error('EQUILIBRIUM', 'Joint is not in equilibrium', nodeId);
  }
  return done();
}
