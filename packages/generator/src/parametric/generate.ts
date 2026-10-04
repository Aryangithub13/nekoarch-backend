import { describeParametricWings, type ParametricWing } from './components.js';
import { ArchitecturalBuildingModelV2Schema, polygonAreaMm2, ringContains, ringsOverlap, dimensionMeasurements, type RingMm, type BuildingModelV2, type BuildingDimension } from '@designflow/shared';
import { constructModel } from '../blueprint/entities.js';
import { bounds, rectangle, reconcilePartition } from '../blueprint/geometry.js';
import { scoreCandidate } from '../blueprint/layout.js';
import { analyzeCirculation } from '../blueprint/validation.js';
import { BlueprintError, type BlueprintResult, type Box, type Candidate, type Constraints, type RoomIntent, type SolvedSpace } from '../blueprint/types.js';
import { seededRandom, shuffled } from '../random.js';
import { PARAMETRIC_VERSION, footprint, normalizeParametricRequirements, type NormalizedParametricRequirements } from './input.js';
import type { SolverV2Execution } from '../solver-v2/generate.js';

function program(r: NormalizedParametricRequirements): RoomIntent[] {
  const counts: Record<string, number> = {}, loads = [0, 0], result: RoomIntent[] = [];
  for (const room of r.rooms) if (room.level !== undefined) loads[room.level]! += room.count;
  for (const requirement of r.rooms) for (let i = 0; i < requirement.count; i++) {
    const level = requirement.level ?? (r.floors === 2 && loads[1]! < loads[0]! ? 1 : 0);
    if (requirement.level === undefined) loads[level]!++;
    counts[requirement.type] = (counts[requirement.type] ?? 0) + 1;
    result.push({ key: `${requirement.type}-${counts[requirement.type]}`, level, requirement });
  }
  if (loads.slice(0, r.floors).some(n => n < 2)) throw new BlueprintError('PROGRAM_DOES_NOT_FIT', 'The L allocator requires at least two occupied rooms per floor, one in each wing');
  return result;
}
function allocate(r: NormalizedParametricRequirements, rooms: RoomIntent[], splits: number[], index: number): Candidate {
  const e = r.exteriorWallThicknessMm, p = r.interiorWallThicknessMm, spaces: SolvedSpace[] = [];
  const add = (key: string, level: number, role: SolvedSpace['role'], classification: string, boundary: RingMm, clear?: Box) => {
    const box = bounds(boundary);
    spaces.push({ key, role, box, clear: clear ?? { x: box.x + e / 2, z: box.z + e / 2, w: box.w - e, d: box.d - e },
      entity: { id: `space-${key}`, name: key, classification, levelId: `level-${level}`, boundary, boundaryBasis: 'wall-centerline' } });
  };
  for (let level = 0; level < r.floors; level++) {
    const f = r.parametricArchitecture.floors[level]!, origin = r.parametricArchitecture.origin;
    const x0 = origin.x + e / 2, z0 = origin.z + e / 2, xW = origin.x + f.widthMm - e / 2, zD = origin.z + f.depthMm - e / 2;
    const xA = origin.x + f.westWingWidthMm - e / 2, zB = origin.z + f.southWingDepthMm - e / 2;
    const xS = x0 + (r.stair ? r.stair.widthMm + (e + p) / 2 : 0);
    const xC = xS + r.circulationWidthMm + (r.stair ? p : (e + p) / 2), zH = z0 + r.circulationWidthMm + (e + p) / 2;
    if (xA - xC <= e || zB - zH <= e || xW - xA <= e) throw new BlueprintError('PROGRAM_DOES_NOT_FIT', 'Wing widths leave no room bank after circulation and wall reservations');
    const corridor = [{ x: x0, z: z0 }, { x: xW, z: z0 }, { x: xW, z: zH }, { x: xC, z: zH }, { x: xC, z: zD }, { x: xS, z: zD },
      ...(r.stair ? [{ x: xS, z: zH }, { x: x0, z: zH }] : [])];
    add(`corridor-${level}`, level, 'circulation', 'circulation', corridor);
    if (r.stair) {
      const core = { x: x0, z: zH, w: xS - x0, d: zD - zH };
      const clear = { x: x0 + e / 2, z: zH + p / 2, w: r.stair.widthMm, d: core.d - (p + e) / 2 };
      const run = (r.stair.riserCount - 1) * r.stair.treadDepthMm;
      if (clear.d < run + 2 * Math.max(r.stair.landingDepthMm, r.door.widthMm + 2 * r.door.jambMm)) throw new BlueprintError('STAIR_PLACEMENT_FAILED', 'Straight stair and accessible landings exceed the common west core');
      add(`stairwell-${level}`, level, 'stair', 'stairwell', rectangle(core), clear);
    }
    const requested = rooms.filter(room => room.level === level), split = splits[level]!;
    for (const [bank, box, along] of [
      [requested.slice(0, split), { x: xC, z: zH, w: xA - xC, d: zD - zH }, 'z'],
      [requested.slice(split), { x: xA, z: zH, w: xW - xA, d: zB - zH }, 'x'],
    ] as const) {
      const crossSize = (along === 'z' ? box.w : box.d) - e;
      if (bank.some(room => crossSize < (along === 'z' ? room.requirement.minWidthMm : room.requirement.minDepthMm))) throw new BlueprintError('PROGRAM_DOES_NOT_FIT', 'Wing bank cannot satisfy clear room width/depth');
      const parts = reconcilePartition(along === 'z' ? box.d : box.w, bank.map(room => e + Math.max(
        along === 'z' ? room.requirement.minDepthMm : room.requirement.minWidthMm,
        Math.ceil((room.requirement.minAreaMm2 ?? 1) / crossSize), r.door.widthMm + 2 * r.door.jambMm)));
      let cursor = box[along];
      bank.forEach((room, i) => {
        const actual = { ...box, [along]: cursor, [along === 'z' ? 'd' : 'w']: parts[i]! };
        add(room.key, level, 'room', room.requirement.type, rectangle(actual)); cursor += parts[i]!;
      });
    }
  }
  return { index, axis: 'z', spaces, score: 0, warnings: [] };
}
/** Orthogonal cell difference: cells are disjoint, bounded by the two six-vertex rings. */
function roofDifference(lower: RingMm, upper: RingMm): RingMm[] {
  const xs = [...new Set([...lower, ...upper].map(p => p.x))].sort((a, b) => a - b), zs = [...new Set([...lower, ...upper].map(p => p.z))].sort((a, b) => a - b), result: RingMm[] = [];
  for (let i = 1; i < xs.length; i++) for (let j = 1; j < zs.length; j++) {
    const cell = rectangle({ x: xs[i - 1]!, z: zs[j - 1]!, w: xs[i]! - xs[i - 1]!, d: zs[j]! - zs[j - 1]! });
    if (ringContains(lower, cell) && !ringsOverlap(upper, cell)) result.push(cell);
  }
  return result;
}
function dimensions(model: BuildingModelV2): void {
  const add = (d: Omit<BuildingDimension, 'id' | 'constraint'>) => {
    const value: BuildingDimension = { ...d, id: `dimension-${model.dimensions.length}`, constraint: { mode: 'derived' } };
    value.constraint = { mode: 'controlling', ...dimensionMeasurements(model, value) }; model.dimensions.push(value);
  };
  for (const level of model.levels) for (const axis of ['x', 'z'] as const) {
    const points = [...level.boundary].sort((a, b) => a[axis] - b[axis]);
    const start = points[0]!, end = points.at(-1)!;
    add({ levelId: level.id, purpose: 'overall', axis, anchors: [start[axis], end[axis]].map(value => ({ kind: 'point', point: { ...start, [axis]: value, y: level.elevationMm } })) });
  }
  for (const space of model.spaces.filter(s => s.classification !== 'circulation')) for (const [axis, indices] of [['x', [0, 1]], ['z', [1, 2]]] as const)
    add({ levelId: space.levelId, purpose: 'room', axis, anchors: indices.map(vertexIndex => ({ kind: 'space-vertex', spaceId: space.id, vertexIndex })) });
  for (const wall of model.walls) add({ levelId: wall.levelId, purpose: 'wall', axis: wall.path.start.x === wall.path.end.x ? 'z' : 'x', anchors: [{ kind: 'wall-end', wallId: wall.id, end: 'start' }, { kind: 'wall-end', wallId: wall.id, end: 'end' }] });
}
export interface ParametricResult extends BlueprintResult {
  components: ParametricWing[];
  diagnostics: { operations: number; rejectedBy: Record<string, number>; timingsMs: Record<string, number>; componentCount: number };
}
export function generateParametricBlueprint(input: unknown, execution: SolverV2Execution = {}): ParametricResult {
  const now = () => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();
  const started = now();
  if (execution.timeoutMs !== undefined && (!Number.isInteger(execution.timeoutMs) || execution.timeoutMs < 1 || execution.timeoutMs > 30000)) throw new BlueprintError('INVALID_REQUIREMENTS', 'Timeout must be 1–30000 ms');
  const check = () => {
    if (execution.signal?.aborted) throw new BlueprintError('SOLVER_CANCELLED', 'Parametric generation cancelled');
    if (now() - started >= (execution.timeoutMs ?? 10000)) throw new BlueprintError('SOLVER_TIMEOUT', 'Parametric generation deadline exceeded');
  };
  check();
  const r = normalizeParametricRequirements(input), normalizedAt = now(), rooms = program(r), boundaries = r.parametricArchitecture.floors.map((_, i) => footprint(r.parametricArchitecture, i));
  const outer = bounds(boundaries[0]!), e = r.exteriorWallThicknessMm;
  const c: Constraints = { outer, center: { x: outer.x + e / 2, z: outer.z + e / 2, w: outer.w - e, d: outer.d - e }, rooms, siteBoundary: r.site.boundary, buildableBoundary: r.site.buildableBoundary ?? r.site.boundary };
  const failures: Record<string, number> = {}, random = seededRandom(`${PARAMETRIC_VERSION}:${r.seed}`);
  let attempts = 0, operations = 0, valid = 0, complete = true, layoutMs = 0, constructionMs = 0;
  let best: { candidate: Candidate; model: BuildingModelV2 } | undefined;
  const charge = (n: number) => { check(); if (operations + n > r.solver.maxIterations) throw new BlueprintError('SEARCH_LIMIT_EXHAUSTED', 'Parametric operation budget exhausted'); operations += n; };
  const counts = boundaries.map((_, level) => rooms.filter(room => room.level === level).length);
  search: for (let round = 0; round < 4; round++) {
    const ordered = round === 0 ? rooms : shuffled(rooms, random);
    for (let a = 1; a < counts[0]!; a++) for (let b = 1; b < (counts[1] ?? 2); b++) {
      if (attempts >= r.solver.maxCandidates) { complete = false; break search; }
      const index = attempts++;
      try {
        charge(rooms.length * rooms.length + 1);
        const before = now(), candidate = allocate(r, ordered, [a, b], index);
        layoutMs += now() - before; scoreCandidate(r, c, candidate);
        const constructionStart = now();
        const model = constructModel(r, c, candidate, { generatorVersion: PARAMETRIC_VERSION, floorBoundaries: boundaries });
        model.parametricArchitecture = r.parametricArchitecture;
        if (r.floors === 2) roofDifference(boundaries[0]!, boundaries[1]!).forEach((ring, i) => model.slabs.push({ id: `roof-exposed-${i}`, levelId: 'level-0', kind: 'flat-roof', footprint: { outer: ring, voids: [] }, topOffsetMm: r.floorToFloorHeightMm, thicknessMm: r.slabThicknessMm }));
        // Geometry-addressed wall/opening identities are replaced when their geometry changes.
        const oldWalls = new Map(model.walls.map(w => [w.id, w]));
        for (const wall of model.walls) wall.id = `wall-${wall.levelId}-${wall.path.start.x}-${wall.path.start.z}-${wall.path.end.x}-${wall.path.end.z}`;
        for (const opening of model.openings) { opening.wallId = oldWalls.get(opening.wallId)!.id; opening.id = `${opening.kind}-${opening.wallId}-${opening.offsetMm}-${opening.widthMm}`; }
        const entry = model.openings.find(o => o.kind === 'door' && o.levelId === 'level-0' && model.walls.some(w => w.id === o.wallId && w.classification === 'exterior'))!;
        model.site!.primaryEntryOpeningId = entry.id;
        dimensions(model);
        charge(model.walls.length * model.spaces.length + model.openings.length + model.dimensions.length);
        ArchitecturalBuildingModelV2Schema.parse(model);
        const circulation = analyzeCirculation(model);
        if (circulation.unreachableSpaceIds.length) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'Disconnected parametric circulation');
        constructionMs += now() - constructionStart; valid++;
        if (!best || candidate.score < best.candidate.score) best = { candidate, model };
      } catch (error) {
        if (!(error instanceof BlueprintError)) throw error;
        if (error.code === 'SEARCH_LIMIT_EXHAUSTED') { complete = false; break search; }
        if (['SOLVER_TIMEOUT', 'SOLVER_CANCELLED'].includes(error.code)) throw error;
        failures[error.code] = (failures[error.code] ?? 0) + 1;
      }
    }
  }
  if (!best) throw new BlueprintError(complete ? 'PROGRAM_DOES_NOT_FIT' : 'SEARCH_LIMIT_EXHAUSTED', 'No feasible L-wing allocation within the supported family and budget', { candidateAttempts: attempts, operations, rejectedBy: Object.keys(failures).sort() });
  const { model, candidate } = best, totalArea = boundaries.reduce((n, ring) => n + Number(polygonAreaMm2(ring)), 0), area = Number(polygonAreaMm2(boundaries[0]!));
  check();
  const clearArea = (role: SolvedSpace['role']) => candidate.spaces.filter(s => s.role === role).reduce((n, s) => n + s.clear.w * s.clear.d, 0);
  // Conservative clear polygon: offset every face by the maximum wall half-thickness.
  const circulationArea = candidate.spaces.filter(s => s.role === 'circulation').reduce((n, s) => {
    const ring = s.entity.boundary;
    const inset = ring.map((point, i) => {
      const previous = ring[(i + ring.length - 1) % ring.length]!, next = ring[(i + 1) % ring.length]!;
      const vertical = previous.x === point.x ? [previous, point] : [point, next];
      const horizontal = previous.z === point.z ? [previous, point] : [point, next];
      return { x: point.x - Math.sign(vertical[1]!.z - vertical[0]!.z) * e / 2, z: point.z + Math.sign(horizontal[1]!.x - horizontal[0]!.x) * e / 2 };
    });
    return n + Number(polygonAreaMm2(inset));
  }, 0);
  return { model, components: describeParametricWings(r.parametricArchitecture), metadata: { solverVersion: PARAMETRIC_VERSION, seed: r.seed, candidateAttempts: attempts, iterations: operations, validCandidates: valid, selectedCandidate: candidate.index, searchComplete: complete,
    softPreferenceScore: candidate.score, warnings: [...candidate.warnings, ...(!complete ? ['Search budget reached; best feasible candidate retained.'] : [])],
    assumptions: ['Axis-aligned L footprints; two rectangular room banks connected by an L corridor.', 'Room clear dimensions conservatively reserve the exterior thickness on each face.', 'Clear areas conservatively reserve exterior wall thickness on every face; stair cores are not occupied rooms.', 'Exposed lower roofs are flat roofs, not accessible terraces.', 'No structural, regulatory, BIM or engineering certification.'],
    satisfiedHardConstraints: ['room-program', 'clear-room-minimums', 'connected-wings', 'nested-floor-footprints', 'stair-void', 'entrance-reachability'], circulation: analyzeCirculation(model),
    roomDimensions: candidate.spaces.filter(s => s.role === 'room').map(s => ({ spaceId: s.entity.id, clearWidthMm: s.clear.w, clearDepthMm: s.clear.d, clearAreaMm2: s.clear.w * s.clear.d })),
    utilization: { siteAreaMm2: Number(polygonAreaMm2(r.site.boundary)), buildableAreaMm2: Number(polygonAreaMm2(c.buildableBoundary)), footprintAreaMm2: area, totalEnvelopeAreaMm2: totalArea,
      roomClearAreaMm2: clearArea('room'), circulationClearAreaMm2: circulationArea, stairCoreClearAreaMm2: clearArea('stair'), wallsAndResidualAreaMm2: totalArea - clearArea('room') - circulationArea - clearArea('stair'), unusedBuildableAreaMm2: Number(polygonAreaMm2(c.buildableBoundary)) - area } },
    diagnostics: { operations, rejectedBy: failures, componentCount: model.spaces.length + model.walls.length + model.openings.length + model.slabs.length + model.stairs.length,
      timingsMs: { normalization: normalizedAt - started, layout: layoutMs, construction: constructionMs, total: now() - started } } };
}
