import { ArchitecturalBuildingModelV2Schema, polygonAreaMm2, ringContains, type BuildingModelV2 } from '@designflow/shared';
import { BlueprintError, type BlueprintResult, type CirculationAnalysis } from '../blueprint/types.js';
import { info, isResidential } from './catalog.js';
import { normalizeProgramRequirements, PROGRAM_VERSION, type NormalizedProgramRequirements } from './input.js';
import { assignLevels, expandUnits, footprint, rejections, solveLayouts, STAIR, unitArea } from './solve.js';
import { buildModel } from './build.js';

export interface ProgramRoom { spaceId: string; name: string; use: string; level: number; areaM2: number; widthM: number; depthM: number; targetAreaM2: number | null }
export interface ProgramReport { rooms: ProgramRoom[]; floors: number; footprintM: { width: number; depth: number }; builtUpAreaM2: number; carpetAreaM2: number; assumptions: string[]; warnings: string[] }
export type ProgramResult = BlueprintResult & { program: ProgramReport };

function circulation(model: BuildingModelV2, entranceSpaceId: string): CirculationAnalysis {
  const edges: CirculationAnalysis['edges'] = [];
  for (const o of model.openings.filter(o => o.kind === 'door' || (o.kind === 'opening' && o.purpose === 'passage'))) {
    const ids = model.walls.find(w => w.id === o.wallId)?.spaceIds ?? [];
    if (ids.length === 2) edges.push({ from: ids[0]!, to: ids[1]!, via: o.id });
  }
  for (const s of model.stairs) {
    const from = model.spaces.find(x => x.levelId === s.fromLevelId && x.classification === 'stairwell' && ringContains(x.boundary, s.footprint));
    const to = model.spaces.find(x => x.levelId === s.toLevelId && x.classification === 'stairwell' && ringContains(x.boundary, s.footprint));
    if (from && to) edges.push({ from: from.id, to: to.id, via: s.id });
  }
  const reached = new Set([entranceSpaceId]), queue = [entranceSpaceId];
  for (let i = 0; i < queue.length; i++) for (const e of edges) {
    const next = e.from === queue[i] ? e.to : e.to === queue[i] ? e.from : undefined;
    if (next && !reached.has(next)) { reached.add(next); queue.push(next); }
  }
  return { entranceSpaceId, edges, reachableSpaceIds: [...reached].sort(), unreachableSpaceIds: model.spaces.filter(s => !reached.has(s.id)).map(s => s.id).sort() };
}

/** Program engine: any described room program on a rectangular plot, one to ten storeys, zoned and stacked around a stair core. */
export function generateProgramBlueprint(input: unknown, _options: { timeoutMs?: number } = {}): ProgramResult {
  const r: NormalizedProgramRequirements = normalizeProgramRequirements(input);
  const units = expandUnits(r);
  const notes = assignLevels(units, r.floors, isResidential(r.program.buildingType));
  const fp = footprint(r, units, 100);
  const started = Date.now(), budget = Math.max(1000, _options.timeoutMs ?? 8000);
  // Several footprint sizes compete: tight footprints cost less to build, roomier ones fit the program more comfortably.
  const programArea = units.reduce((n, u) => n + unitArea(u), 0);
  const search = (): ReturnType<typeof solveLayouts> => {
    const all: ReturnType<typeof solveLayouts> = [];
    const seen = new Set<string>();
    for (const slack of [1, 1.12, 1.25, 1.45, 1.75, 2.2, 100]) {
      const f = footprint(r, units, slack), key = `${f.outer.w}x${f.outer.d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const found = solveLayouts(r, units, f);
      const envelope = f.center.w * f.center.d * r.floors;
      for (const l of found) { l.score += Math.max(0, envelope / Math.max(programArea, 1) - 1.4) * 3; l.assumptions = f.assumptions; }
      all.push(...found);
      if (all.length > 400) break;
    }
    return all.sort((x, y) => x.score - y.score || x.index - y.index);
  };
  let layouts = search();
  let compressed = false;
  if (!layouts.length) {
    // Too tight at target sizes: retry with every room at its catalog minimum so the program still fits where it physically can.
    for (const u of units) {
      const k = info(u.kind);
      u.areaMm2 = Math.min(u.areaMm2, k.minWidthMm * k.minDepthMm * 1.1);
    }
    layouts = search();
    compressed = true;
  }
  if (!layouts.length) {
    const need = Math.round(units.reduce((n, u) => n + unitArea(u), 0) * 1.2 / 1e6), available = Math.round(fp.center.w * fp.center.d * r.floors / 1e6);
    throw new BlueprintError('PROGRAM_DOES_NOT_FIT', `The requested rooms (about ${need} m² with circulation) do not fit ${r.floors} floor(s) of ${available} m² on this plot`, { requiredAreaM2: need, availableAreaM2: available, floors: r.floors, rejectedBy: [...rejections].map(([k, v]) => `${k}:${v}`) });
  }
  const failures = new Map<string, number>();
  for (const [attempt, layout] of layouts.entries()) {
    if (Date.now() - started > budget) break;
    try {
      const { model, warnings, entranceSpaceId } = buildModel(r, layout);
      const parsed = ArchitecturalBuildingModelV2Schema.safeParse(model);
      if (!parsed.success) { const key = parsed.error.issues[0]!.message; failures.set(key, (failures.get(key) ?? 0) + 1); continue; }
      const flow = circulation(model, entranceSpaceId);
      if (flow.unreachableSpaceIds.length) { failures.set('unreachable', (failures.get('unreachable') ?? 0) + 1); continue; }
      const H = r.floorToFloorHeightMm;
      const rooms: ProgramRoom[] = model.spaces.map(s => {
        const xs = s.boundary.map(p => p.x), zs = s.boundary.map(p => p.z), unit = units.find(u => `space-${u.key}` === s.id);
        return { spaceId: s.id, name: s.name, use: s.use ?? s.classification, level: Number(s.levelId.slice('level-'.length)), areaM2: Math.round(Number(polygonAreaMm2(s.boundary)) / 10_000) / 100,
          widthM: (Math.max(...xs) - Math.min(...xs)) / 1000, depthM: (Math.max(...zs) - Math.min(...zs)) / 1000, targetAreaM2: unit ? Math.round(unit.areaMm2 / 10_000) / 100 : null };
      });
      const footprintArea = layout.outer.w * layout.outer.d;
      const carpet = rooms.filter(x => !x.spaceId.startsWith('space-corridor') && !x.spaceId.startsWith('space-stairwell')).reduce((n, x) => n + x.areaM2, 0);
      const assumptions = [
        ...layout.assumptions, ...notes,
        ...(compressed ? ['Rooms were reduced toward their minimum sizes so the full program fits the plot.'] : []),
        `Load-bearing RCC frame with ${r.exteriorWallThicknessMm} mm exterior and ${r.interiorWallThicknessMm} mm interior masonry walls; ${H} mm floor-to-floor, ${r.slabThicknessMm} mm slabs.`,
        ...(r.floors > 1 ? [`Dog-leg stair: ${STAIR.riserCount} risers of about ${Math.round(H / STAIR.riserCount)} mm and ${STAIR.treadDepthMm} mm treads per flight, ${STAIR.widthMm} mm wide.`] : []),
        'Front of the building faces the minimum-z plot edge (street side); north is metadata only.',
        'Concept design for discussion: structure, services and statutory approvals need a licensed architect and structural engineer.',
      ];
      const report: ProgramReport = { rooms, floors: r.floors, footprintM: { width: layout.outer.w / 1000, depth: layout.outer.d / 1000 }, builtUpAreaM2: Math.round(footprintArea * r.floors / 10_000) / 100, carpetAreaM2: Math.round(carpet * 100) / 100, assumptions, warnings: [...layout.warnings, ...warnings] };
      const roomClear = rooms.filter(x => !x.spaceId.includes('corridor') && !x.spaceId.includes('stairwell')).reduce((n, x) => n + x.areaM2 * 1e6, 0);
      const corridorArea = rooms.filter(x => x.spaceId.includes('corridor')).reduce((n, x) => n + x.areaM2 * 1e6, 0), stairArea = rooms.filter(x => x.spaceId.includes('stairwell')).reduce((n, x) => n + x.areaM2 * 1e6, 0);
      return { model, program: report, metadata: {
        solverVersion: PROGRAM_VERSION, seed: r.seed, candidateAttempts: attempt + 1, iterations: layouts.length, validCandidates: layouts.length, selectedCandidate: layout.index, searchComplete: true,
        softPreferenceScore: Math.round(layout.score * 1000) / 1000, warnings: report.warnings, assumptions, circulation: flow,
        satisfiedHardConstraints: ['requested-room-program', 'room-minimum-sizes', 'site-and-setback-containment', 'entrance-reachability', 'architectural-v2-validation', ...(r.floors > 1 ? ['stair-rise-run-landings', 'stair-slab-void', 'cross-level-reachability'] : [])],
        roomDimensions: rooms.map(x => ({ spaceId: x.spaceId, clearWidthMm: Math.round(x.widthM * 1000), clearDepthMm: Math.round(x.depthM * 1000), clearAreaMm2: Math.round(x.areaM2 * 1e6) })),
        utilization: { siteAreaMm2: Number(polygonAreaMm2(r.site.boundary)), buildableAreaMm2: footprintArea, footprintAreaMm2: footprintArea, totalEnvelopeAreaMm2: footprintArea * r.floors,
          roomClearAreaMm2: Math.round(roomClear), circulationClearAreaMm2: Math.round(corridorArea), stairCoreClearAreaMm2: Math.round(stairArea), wallsAndResidualAreaMm2: Math.max(0, Math.round(footprintArea * r.floors - roomClear - corridorArea - stairArea)), unusedBuildableAreaMm2: 0 },
      } };
    } catch (error) {
      if (!(error instanceof BlueprintError)) throw error;
      failures.set(error.code, (failures.get(error.code) ?? 0) + 1);
    }
  }
  throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'No candidate layout produced a valid building model', { candidateAttempts: layouts.length, rejectedBy: [...failures].map(([k, v]) => `${k.slice(0, 80)}:${v}`) });
}
