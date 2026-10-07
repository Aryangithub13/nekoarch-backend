import { createHash } from 'node:crypto';
import type { BimModel } from '../bim/contracts.js';
import { semanticId } from '../bim/core.js';
import { CLAIMS, DOFS, EXPANDED_MEMBER_LOADS, MEMBER_ASSUMPTIONS, MODEL_ASSUMPTIONS, STRUCTURAL_LIMITS, STRUCTURAL_MODEL_VERSION, StructuralError, StructuralModelSchema,
  type StructuralErrorCode, type StructuralInput, type StructuralModel } from './contracts.js';
import { STANDARD_GRAVITY, convert, massFromDensity } from './units.js';

type Point = { x: number; y: number; z: number };
type Model = StructuralModel;
const fail = (code: StructuralErrorCode, message: string): never => { throw new StructuralError(code, message); };
const byId = <T extends { id: string }>(items: T[]) => items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const structuralId = (projectId: string, ...parts: (string | number | null)[]) =>
  `str-${createHash('sha256').update(JSON.stringify([projectId, STRUCTURAL_MODEL_VERSION, ...parts])).digest('hex').slice(0, 40)}`;
const RESTRAINTS = { FIXED: DOFS, PINNED: ['UX', 'UY', 'UZ'], ROLLER: ['UY'] } as const;

/** Exact rectangle properties; torsion constant by the Roark/Young approximation for a solid rectangle. */
export function rectangleProperties(widthMm: number, depthMm: number) {
  const long = Math.max(widthMm, depthMm), short = Math.min(widthMm, depthMm);
  return { area: widthMm * depthMm, iz: widthMm * depthMm ** 3 / 12, iy: depthMm * widthMm ** 3 / 12,
    j: long * short ** 3 * (1 / 3 - 0.21 * (short / long) * (1 - short ** 4 / (12 * long ** 4))) };
}

function unique<T>(items: T[], keyOf: (item: T) => string, code: StructuralErrorCode, label: string) {
  const seen = new Set<string>();
  for (const item of items) { const k = keyOf(item); if (seen.has(k)) fail(code, `Duplicate ${label} key`); seen.add(k); }
}

/** Architecture + explicit engineering input → structural semantic model. Never mutates its inputs. */
export function buildStructuralModel(bim: BimModel, input: StructuralInput): Model {
  const g = bim.geometry, projectId = bim.binding.projectId, id = (...parts: (string | number | null)[]) => structuralId(projectId, ...parts);
  unique(input.materials, m => m.key, 'STRUCTURAL_MODEL_INVALID', 'material'); unique(input.sections, s => s.key, 'STRUCTURAL_MODEL_INVALID', 'section');
  unique(input.members, m => m.key, 'STRUCTURAL_MODEL_INVALID', 'member'); unique(input.supports, s => s.key, 'STRUCTURAL_SUPPORT_INVALID', 'support');
  unique(input.loadCases, c => c.key, 'STRUCTURAL_LOAD_INVALID', 'load case'); unique(input.combinations, c => c.key, 'STRUCTURAL_LOAD_INVALID', 'combination');
  for (const c of input.loadCases) {
    unique(c.loads, l => l.key, 'STRUCTURAL_LOAD_INVALID', 'load');
    if (c.loads.some(l => l.application === 'AREA')) fail('STRUCTURAL_SOURCE_UNSUPPORTED', 'Area loads require analytical panels, which structural-model-v1 does not provide');
  }

  const materials: Model['materials'] = input.materials.map(m => {
    const spec = m.architecturalSpecificationId === null ? null : g.specifications.find(s => s.id === m.architecturalSpecificationId);
    if (spec === undefined) fail('STRUCTURAL_MODEL_INVALID', 'Material references an unknown architectural specification');
    const prop = <U extends string>(q: { value: number; unit: U } | null, unit: U) => q ? { value: q.value, unit, provenance: 'USER_PROVIDED' as const } : { value: null, unit, provenance: 'NOT_SPECIFIED' as const };
    return { id: id('material', m.key), requestKey: m.key, category: m.category, name: m.name, elasticModulus: prop(m.elasticModulus, 'MPa'),
      poissonRatio: prop(m.poissonRatio, '1'), density: prop(m.density, 'kg/m3'), architecturalSpecificationId: spec?.id ?? null,
      bimMaterialId: spec?.material ? semanticId(projectId, 'material', spec.id) : null };
  });
  const sections: Model['sections'] = input.sections.map(s => {
    if (s.shape === 'GENERIC') {
      const user = <U extends 'mm2' | 'mm4'>(value: number, unit: U) => ({ value, unit, provenance: 'USER_PROVIDED' as const, method: null });
      return { id: id('section', s.key), requestKey: s.key, shape: s.shape, dimensions: null, area: user(s.area.value, 'mm2'),
        iy: user(s.iy.value, 'mm4'), iz: user(s.iz.value, 'mm4'), j: user(s.j.value, 'mm4') };
    }
    const p = rectangleProperties(s.width.value, s.depth.value), derived = 'DERIVED_FROM_SECTION_DIMENSIONS' as const;
    return { id: id('section', s.key), requestKey: s.key, shape: s.shape, dimensions: { width: { value: s.width.value, unit: 'mm' as const }, depth: { value: s.depth.value, unit: 'mm' as const } },
      area: { value: p.area, unit: 'mm2' as const, provenance: derived, method: 'exact-rectangle' as const }, iy: { value: p.iy, unit: 'mm4' as const, provenance: derived, method: 'exact-rectangle' as const },
      iz: { value: p.iz, unit: 'mm4' as const, provenance: derived, method: 'exact-rectangle' as const }, j: { value: p.j, unit: 'mm4' as const, provenance: derived, method: 'roark-rectangle-torsion-approx' as const } };
  });
  const materialOf = new Map(input.materials.map((m, i) => [m.key, materials[i]!])), sectionOf = new Map(input.sections.map((s, i) => [s.key, sections[i]!]));

  // Members by explicit rule. Endpoints are integer millimetres in global axes.
  const nodes = new Map<string, { point: Point; memberIds: Set<string> }>();
  const nodeId = (p: Point) => { const k = `${p.x},${p.y},${p.z}`; if (!nodes.has(k)) nodes.set(k, { point: p, memberIds: new Set() }); return id('node', p.x, p.y, p.z); };
  const members = input.members.map(m => {
    const wall = g.walls.find(w => w.id === m.wallId) ?? fail('STRUCTURAL_MODEL_INVALID', 'Member references an unknown wall');
    const level = g.levels.find(l => l.id === wall.levelId)!;
    if (wall.pathReference !== 'centerline' || level.floorToFloorHeightMm === null) fail('STRUCTURAL_SOURCE_UNSUPPORTED', 'Mapping requires a centerline wall on a storey with a known floor-to-floor height');
    const material = materialOf.get(m.material) ?? fail('STRUCTURAL_MODEL_INVALID', 'Member references an unknown material');
    const section = sectionOf.get(m.section) ?? fail('STRUCTURAL_MODEL_INVALID', 'Member references an unknown section');
    if (material.elasticModulus.value === null || material.poissonRatio.value === null) fail('STRUCTURAL_MATERIAL_MISSING', 'A used material lacks elastic modulus or Poisson ratio');
    const top = level.elevationMm + level.floorToFloorHeightMm!;
    const [start, end]: [Point, Point] = m.rule === 'COLUMN_AT_WALL_END'
      ? [{ x: wall.path[m.end].x, y: level.elevationMm, z: wall.path[m.end].z }, { x: wall.path[m.end].x, y: top, z: wall.path[m.end].z }]
      : [{ x: wall.path.start.x, y: top, z: wall.path.start.z }, { x: wall.path.end.x, y: top, z: wall.path.end.z }];
    const differing = (['x', 'y', 'z'] as const).filter(a => start[a] !== end[a]).length;
    if (differing === 0) fail('STRUCTURAL_MODEL_INVALID', 'Zero-length member');
    if (differing !== 1) fail('STRUCTURAL_SOURCE_UNSUPPORTED', 'Only axis-aligned members are supported');
    const kind = m.rule === 'COLUMN_AT_WALL_END' ? 'COLUMN' as const : 'BEAM' as const, wallEnd = m.rule === 'COLUMN_AT_WALL_END' ? m.end : null;
    return { input: m, kind, wall, level, material, section, memberId: id('member', kind, m.rule, 'walls', wall.id, wallEnd, level.id), wallEnd, start, end,
      startNodeId: nodeId(start), endNodeId: nodeId(end) };
  });
  unique(members, m => m.memberId, 'STRUCTURAL_MODEL_INVALID', 'member mapping');
  if (members.length !== new Set(members.map(m => [m.startNodeId, m.endNodeId].sort().join())).size) fail('STRUCTURAL_MODEL_INVALID', 'Duplicate member between the same nodes');
  for (const m of members) { nodes.get(`${m.start.x},${m.start.y},${m.start.z}`)!.memberIds.add(m.memberId); nodes.get(`${m.end.x},${m.end.y},${m.end.z}`)!.memberIds.add(m.memberId); }

  // Collinear overlap and interior-node splitting on exact integer lines.
  const axisOf = (m: (typeof members)[number]) => (['x', 'y', 'z'] as const).find(a => m.start[a] !== m.end[a])!;
  const lineKey = (axis: 'x' | 'y' | 'z', p: Point) => `${axis}:${(['x', 'y', 'z'] as const).filter(a => a !== axis).map(a => p[a]).join(',')}`;
  const lines = new Map<string, (typeof members)[number][]>();
  for (const m of members) { const k = lineKey(axisOf(m), m.start); lines.set(k, [...(lines.get(k) ?? []), m]); }
  for (const [k, list] of lines) {
    const axis = k[0] as 'x' | 'y' | 'z', spans = list.map(m => [Math.min(m.start[axis], m.end[axis]), Math.max(m.start[axis], m.end[axis])] as const).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) if (spans[i]![0] < spans[i - 1]![1]) fail('STRUCTURAL_MODEL_INVALID', 'Overlapping collinear members');
  }
  // Two members on different axes whose axes meet strictly inside both spans are joined only if a node already exists there (an
  // endpoint of a third member, which the splitting below then shares). Otherwise the crossing could be a rigid joint or a pass-by;
  // structural-model-v1 has no input to say which, so it is rejected rather than guessed. Endpoint-on-member (T) junctions are
  // unaffected: the endpoint is a node and splitting connects it, as before.
  // ponytail: O(members²) pair scan, bounded by 800 members; bucket by plane if that limit grows.
  const strictlyInside = (v: number, m: (typeof members)[number], a: 'x' | 'y' | 'z') => v > Math.min(m.start[a], m.end[a]) && v < Math.max(m.start[a], m.end[a]);
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    const p = members[i]!, q = members[j]!, pa = axisOf(p), qa = axisOf(q);
    if (pa === qa) continue;
    const plane = (['x', 'y', 'z'] as const).find(a => a !== pa && a !== qa)!, at: Point = { ...p.start, [pa]: q.start[pa] };
    if (p.start[plane] === q.start[plane] && strictlyInside(at[pa], p, pa) && strictlyInside(at[qa], q, qa) && !nodes.has(`${at.x},${at.y},${at.z}`))
      fail('STRUCTURAL_MODEL_INVALID', 'Members cross without a shared node; split a wall at the crossing to connect them, or map only one of them');
  }
  // ponytail: O(members × nodes) interior-node scan; bounded by 800 members × 1600 nodes, index by line if limits grow.
  const segments: Model['segments'] = [], splitMemberIds: string[] = [], memberSegments = new Map<string, string[]>();
  for (const m of members) {
    const axis = axisOf(m), sign = Math.sign(m.end[axis] - m.start[axis]), k = lineKey(axis, m.start);
    const interior = [...nodes.values()].map(n => n.point).filter(p => lineKey(axis, p) === k && (p[axis] - m.start[axis]) * sign > 0 && (m.end[axis] - p[axis]) * sign > 0)
      .sort((a, b) => (a[axis] - b[axis]) * sign);
    if (interior.length) splitMemberIds.push(m.memberId);
    const chain = [m.start, ...interior, m.end], ids: string[] = [];
    for (let i = 1; i < chain.length; i++) {
      const a = id('node', chain[i - 1]!.x, chain[i - 1]!.y, chain[i - 1]!.z), b = id('node', chain[i]!.x, chain[i]!.y, chain[i]!.z), segmentId = id('segment', m.memberId, a, b);
      segments.push({ id: segmentId, memberId: m.memberId, startNodeId: a, endNodeId: b, length: { value: Math.abs(chain[i]![axis] - chain[i - 1]![axis]), unit: 'mm' } }); ids.push(segmentId);
    }
    memberSegments.set(m.memberId, ids);
  }
  if (segments.length > STRUCTURAL_LIMITS.segments) fail('STRUCTURAL_RESOURCE_LIMIT', 'Too many analysis segments');

  const memberByKey = new Map(members.map(m => [m.input.key, m]));
  const nodeAt = (memberKey: string, end: 'start' | 'end', code: StructuralErrorCode) => {
    const m = memberByKey.get(memberKey) ?? fail(code, 'Reference to an unknown member');
    return end === 'start' ? m.startNodeId : m.endNodeId;
  };
  const restraint = (dofs: readonly string[]) => Object.fromEntries(DOFS.map(d => [d, dofs.includes(d)])) as Model['supports'][number]['restraints'];
  const supports: Model['supports'] = input.supports.map(s => {
    const node = nodeAt(s.at.member, s.at.end, 'STRUCTURAL_SUPPORT_INVALID');
    return { id: id('support', node), requestKey: s.key, nodeId: node, type: s.type, restraints: restraint(s.type === 'CUSTOM' ? s.restraints! : RESTRAINTS[s.type]),
      provenance: 'USER_PROVIDED' as const, rule: null };
  });
  unique(supports, s => s.nodeId, 'STRUCTURAL_SUPPORT_INVALID', 'support node');
  if (input.autoSupports) {
    const columns = members.filter(m => m.kind === 'COLUMN'), base = Math.min(...columns.map(m => m.start.y));
    for (const node of new Set(columns.filter(m => m.start.y === base).map(m => m.startNodeId))) if (!supports.some(s => s.nodeId === node))
      supports.push({ id: id('support', node), requestKey: null, nodeId: node, type: input.autoSupports.type, restraints: restraint(RESTRAINTS[input.autoSupports.type]), provenance: 'ASSUMED', rule: input.autoSupports.rule });
  }
  if (!supports.length) fail('STRUCTURAL_SUPPORT_INVALID', 'The structure has no supports');

  const loadCases: Model['loadCases'] = input.loadCases.map(c => {
    if (!c.loads.length && !c.selfWeight) fail('STRUCTURAL_LOAD_INVALID', 'A load case has no loads');
    if (c.selfWeight && members.some(m => m.material.density.value === null)) fail('STRUCTURAL_MATERIAL_MISSING', 'Self-weight requires a specified density for every member material');
    return { id: id('loadCase', c.key), requestKey: c.key, category: c.category, selfWeight: c.selfWeight ? 'INCLUDED' as const : 'NOT_REQUESTED' as const, source: 'USER_PROVIDED' as const, version: 1 as const,
      loads: c.loads.map(l => {
        const loadId = id('load', c.key, l.key);
        if (l.application === 'POINT') return { id: loadId, requestKey: l.key, application: 'POINT' as const, nodeId: nodeAt(l.target.member, l.target.end, 'STRUCTURAL_LOAD_INVALID'),
          memberId: memberByKey.get(l.target.member)!.memberId, direction: l.direction, magnitude: { value: l.magnitude.value, unit: 'kN' as const }, provenance: 'USER_PROVIDED' as const };
        if (l.application !== 'MEMBER_DISTRIBUTED') return fail('STRUCTURAL_SOURCE_UNSUPPORTED', 'Unsupported load application');
        const m = memberByKey.get(l.target.member) ?? fail('STRUCTURAL_LOAD_INVALID', 'Reference to an unknown member');
        return { id: loadId, requestKey: l.key, application: 'MEMBER_DISTRIBUTED' as const, memberId: m.memberId, direction: l.direction,
          magnitude: { value: l.magnitude.value, unit: 'kN/m' as const }, provenance: 'USER_PROVIDED' as const };
      }) };
  });
  // Preflight the derived analysis-model size: distributed loads and self-weight expand onto every segment of their member, a
  // product the public per-case limits do not bound. Rejecting here, before any solver work, keeps a request inside the documented
  // limits a typed resource error (and /validate in agreement with /analyses) instead of an internal schema failure.
  for (const c of loadCases) {
    const expanded = c.loads.reduce((n, l) => n + (l.application === 'MEMBER_DISTRIBUTED' ? memberSegments.get(l.memberId)!.length : 0), 0)
      + (c.selfWeight === 'INCLUDED' ? segments.length : 0);
    if (expanded > EXPANDED_MEMBER_LOADS) fail('STRUCTURAL_RESOURCE_LIMIT', `A load case expands to ${expanded} segment loads; the analysis limit is ${EXPANDED_MEMBER_LOADS}`);
  }
  const caseOf = new Map(input.loadCases.map((c, i) => [c.key, loadCases[i]!.id]));
  const combinations: Model['combinations'] = input.combinations.map(c => {
    unique(c.terms, t => t.loadCase, 'STRUCTURAL_LOAD_INVALID', 'combination term');
    return { id: id('combination', c.key), requestKey: c.key, profile: c.profile, codeCompliance: 'NOT_CLAIMED' as const, method: 'LINEAR_SUPERPOSITION' as const,
      terms: c.terms.map(t => ({ loadCaseId: caseOf.get(t.loadCase) ?? fail('STRUCTURAL_LOAD_INVALID', 'Combination references an unknown load case'), factor: t.factor, provenance: 'USER_PROVIDED' as const })) };
  });

  // Connectivity on the analysis graph; each component needs at least one support.
  const adjacency = new Map<string, string[]>();
  for (const s of segments) { adjacency.set(s.startNodeId, [...(adjacency.get(s.startNodeId) ?? []), s.endNodeId]); adjacency.set(s.endNodeId, [...(adjacency.get(s.endNodeId) ?? []), s.startNodeId]); }
  const supported = new Set(supports.map(s => s.nodeId)), seen = new Set<string>(); let components = 0;
  for (const start of [...adjacency.keys()].sort()) {
    if (seen.has(start)) continue;
    components++; let hasSupport = false; const stack = [start]; seen.add(start);
    while (stack.length) { const n = stack.pop()!; hasSupport ||= supported.has(n); for (const next of adjacency.get(n)!) if (!seen.has(next)) { seen.add(next); stack.push(next); } }
    if (!hasSupport) fail('STRUCTURAL_SYSTEM_DISCONNECTED', 'A connected part of the structure has no support');
  }

  const levels = [...g.levels].sort((a, b) => a.id < b.id ? -1 : 1);
  return StructuralModelSchema.parse({
    version: STRUCTURAL_MODEL_VERSION, units: { length: 'mm' }, coordinateSystem: 'x-right-y-up-z-depth',
    binding: { ...bim.binding, bimVersion: bim.version, structuralModelVersion: STRUCTURAL_MODEL_VERSION },
    nodes: byId([...nodes.values()].map(n => ({ id: id('node', n.point.x, n.point.y, n.point.z), coordinates: { ...n.point, unit: 'mm' },
      levelId: levels.find(l => l.elevationMm === n.point.y)?.id ?? null, source: { derivation: 'MEMBER_ENDPOINT', memberIds: [...n.memberIds].sort() } }))),
    members: byId(members.map(m => {
      const length = Math.abs(m.end.x - m.start.x) + Math.abs(m.end.y - m.start.y) + Math.abs(m.end.z - m.start.z), area = m.section.area.value, volumeMm3 = area * length;
      return { id: m.memberId, requestKey: m.input.key, kind: m.kind, startNodeId: m.startNodeId, endNodeId: m.endNodeId, materialId: m.material.id, sectionId: m.section.id,
        orientation: 'REFERENCE_VECTOR_V1', levelId: m.level.id, source: { collection: 'walls', wallId: m.wall.id, end: m.wallEnd, bimElementId: semanticId(projectId, 'wall', m.wall.id) },
        mapping: { rule: m.input.rule, ruleVersion: 1, provenance: 'EXPLICIT_USER_MAPPING', assumptionStatus: 'ASSUMED', assumptions: [...MEMBER_ASSUMPTIONS] },
        quantities: { length: { value: length, unit: 'mm' }, sectionArea: { value: area, unit: 'mm2' }, volume: { value: convert(volumeMm3, 'mm3', 'm3'), unit: 'm3' },
          mass: m.material.density.value === null ? { value: null, unit: 'kg', status: 'NOT_EVALUATED' }
            : { value: massFromDensity(m.material.density.value, volumeMm3), unit: 'kg', status: 'EVALUATED' } },
        segmentIds: memberSegments.get(m.memberId)! };
    })),
    segments: byId(segments), materials: byId(materials), sections: byId(sections), supports: byId(supports), loadCases: byId(loadCases), combinations: byId(combinations),
    constants: { gravity: STANDARD_GRAVITY }, assumptions: [...MODEL_ASSUMPTIONS],
    topology: { components, danglingNodeIds: [...adjacency].filter(([n, next]) => next.length === 1 && !supported.has(n)).map(([n]) => n).sort(), splitMemberIds: splitMemberIds.sort() },
    claims: CLAIMS,
  });
}
