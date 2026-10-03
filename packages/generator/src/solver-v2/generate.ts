import { polygonAreaMm2, ringContains, ringsOverlap, type BuildingModelV2 } from '@designflow/shared';
import { allocateCandidate } from '../blueprint/layout.js';
import { constructModel } from '../blueprint/entities.js';
import { constructDimensions } from '../blueprint/dimensions.js';
import { validateBlueprint } from '../blueprint/validation.js';
import { bounds, rectangle } from '../blueprint/geometry.js';
import { BlueprintError, type BlueprintResult, type Candidate, type Constraints } from '../blueprint/types.js';
import { BLUEPRINT_V2_VERSION, normalizeBlueprintV2Requirements } from './input.js';
import { decomposeSite, work, type V2Budget, type SiteProposal } from './site.js';
import { programGraph, topologySchedule, zone } from './topology.js';
import { compareText, evaluateCandidate, type CandidateEvaluation } from './evaluate.js';

export interface BlueprintV2Result extends BlueprintResult {
  diagnostics: { scoreVersion: string; operationCount: number; decompositionCells: number; envelopes: number; topologyCount: number;
    rejectedBy: Record<string, number>; evaluations: { candidate: number; total: number; components: CandidateEvaluation['components'] }[];
    winner: CandidateEvaluation; program: { key: string; level: number; zone: string }[] };
}
function entryApproachFits(model: BuildingModelV2, proposal: SiteProposal): boolean {
  const site = model.site!, side = site.accessSide;
  if (!side) return true;
  const entry = model.openings.find(o => o.id === site.primaryEntryOpeningId)!, wall = model.walls.find(w => w.id === entry.wallId)!;
  const siteBox = bounds(site.boundary), vertical = side.endsWith('z');
  const axis = vertical ? 'z' : 'x', cross = vertical ? 'x' : 'z', size = vertical ? 'd' : 'w';
  const edge = siteBox[axis] + (side.startsWith('max') ? siteBox[size] : 0), wallAt = wall.path.start[axis];
  const lo = Math.min(edge, wallAt), distance = Math.abs(edge - wallAt);
  if (!distance) return true;
  const start = wall.path.start[cross] + entry.offsetMm;
  const approach = rectangle(vertical ? { x: start, z: lo, w: entry.widthMm, d: distance } : { x: lo, z: start, w: distance, d: entry.widthMm });
  return ringContains(site.boundary, approach) && !proposal.parking.some(p => ringsOverlap(p.boundary, approach));
}
/** Best valid candidate found within configured deterministic search bounds. */
export interface SolverV2Execution { signal?: { readonly aborted: boolean }; timeoutMs?: number }
export function generateBlueprintV2(input: unknown, execution: SolverV2Execution = {}): BlueprintV2Result {
  if (execution.timeoutMs !== undefined && (!Number.isInteger(execution.timeoutMs) || execution.timeoutMs < 1 || execution.timeoutMs > 30000)) throw new BlueprintError('INVALID_REQUIREMENTS', 'Execution timeout must be an integer between 1 and 30000 ms');
  const clock = (globalThis as { performance?: { now(): number } }).performance;
  const now = () => clock?.now() ?? Date.now();
  const started = now();
  const checkExecution = () => {
    if (execution.signal?.aborted) throw new BlueprintError('SOLVER_CANCELLED', 'Solver execution was cancelled');
    if (execution.timeoutMs !== undefined && now() - started >= execution.timeoutMs) throw new BlueprintError('SOLVER_TIMEOUT', 'Solver execution exceeded the configured deadline');
  };
  checkExecution();
  const r = normalizeBlueprintV2Requirements(input), budget: V2Budget = { candidates: 0, iterations: 0, operations: 0, checkExecution };
  const graph = programGraph(r), proposals = decomposeSite(r, budget);
  const minimumArea = r.rooms.reduce((sum, room) => sum + room.count * Math.max(room.minAreaMm2 ?? 0, room.minWidthMm * room.minDepthMm), 0);
  if (minimumArea > Number(polygonAreaMm2(r.site.buildableBoundary ?? r.site.boundary)) * r.floors) throw new BlueprintError('PROGRAM_DOES_NOT_FIT', 'Requested clear minimum areas exceed total permitted floor area');
  const failures: Record<string, number> = {}, evaluations: BlueprintV2Result['diagnostics']['evaluations'] = [];
  let best: { model: BuildingModelV2; candidate: Candidate; constraints: Constraints; evaluation: CandidateEvaluation; fingerprint: string } | undefined;
  let complete = true, topologyCount = 0;
  try {
    search: for (const topology of topologySchedule(r, graph, budget)) {
      topologyCount++;
      for (const proposal of proposals) {
        if (budget.candidates >= r.solver.maxCandidates) { complete = false; break search; }
        const index = budget.candidates++;
        work(budget, r);
        const e = r.exteriorWallThicknessMm, outer = proposal.outer;
        const constraints: Constraints = { outer, center: { x: outer.x + e / 2, z: outer.z + e / 2, w: outer.w - e, d: outer.d - e }, rooms: topology.ordered,
          siteBoundary: r.site.boundary, buildableBoundary: r.site.buildableBoundary ?? r.site.boundary };
        try {
          const before = budget.iterations;
          let candidate: Candidate;
          try { candidate = allocateCandidate(r, constraints, topology.ordered, topology.axis, topology.split, index, budget, topology.leftSharePermille); }
          finally { work(budget, r, budget.iterations - before); }
          const model = constructModel(r, constraints, candidate, { generatorVersion: BLUEPRINT_V2_VERSION, entranceEnd: r.layoutV2.accessSide?.startsWith('max') ? 'max' : 'min', stairPosition: topology.stairPosition, rankWindows: true });
          const entry = model.openings.find(o => o.kind === 'door' && o.levelId === 'level-0' && model.walls.some(w => w.id === o.wallId && w.classification === 'exterior'))!;
          model.site!.primaryEntryOpeningId = entry.id;
          if (r.layoutV2.accessSide) model.site!.accessSide = r.layoutV2.accessSide;
          if (proposal.parking.length) model.site!.parkingZones = proposal.parking;
          if (!entryApproachFits(model, proposal)) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'Entry approach crosses excluded site or parking geometry');
          work(budget, r, model.walls.length + model.openings.length + model.spaces.length);
          constructDimensions(model, constraints, candidate);
          validateBlueprint(model, r, constraints, candidate);
          const evaluation = evaluateCandidate(r, constraints, candidate, model);
          if (!evaluation.hardValidity) throw new BlueprintError('UNSATISFIED_HARD_CONSTRAINT', 'Mandatory final-model relationship or privacy evidence is missing');
          evaluations.push({ candidate: index, total: evaluation.total, components: evaluation.components });
          const fingerprint = JSON.stringify(model);
          if (!best || evaluation.total < best.evaluation.total || (evaluation.total === best.evaluation.total && compareText(fingerprint, best.fingerprint) < 0)) best = { model, candidate, constraints, evaluation, fingerprint };
        } catch (error) {
          if (!(error instanceof BlueprintError)) throw error;
          if (['BLUEPRINT_INVARIANT_FAILED', 'DIMENSION_RECONCILIATION_FAILED', 'SEARCH_LIMIT_EXHAUSTED', 'SOLVER_CANCELLED', 'SOLVER_TIMEOUT'].includes(error.code)) throw error;
          failures[error.code] = (failures[error.code] ?? 0) + 1;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof BlueprintError) || error.code !== 'SEARCH_LIMIT_EXHAUSTED') throw error;
    complete = false;
  }
  if (!best) throw new BlueprintError('SEARCH_LIMIT_EXHAUSTED', 'No valid candidate was found within configured deterministic search bounds; this is not proof of impossibility', { candidateAttempts: budget.candidates, operations: budget.operations, rejectedBy: Object.keys(failures).sort().map(key => `${key}:${failures[key]}`) });
  const { model, candidate, constraints: c, evaluation } = best;
  const circulation = validateBlueprint(model, r, c, candidate);
  const areaFor = (role: 'room' | 'circulation' | 'stair') => candidate.spaces.filter(s => s.role === role).reduce((sum, s) => sum + s.clear.w * s.clear.d, 0);
  const footprintAreaMm2 = c.outer.w * c.outer.d, buildableAreaMm2 = Number(polygonAreaMm2(c.buildableBoundary));
  checkExecution();
  return { model, metadata: {
    solverVersion: BLUEPRINT_V2_VERSION, seed: r.seed, candidateAttempts: budget.candidates, iterations: budget.operations, validCandidates: evaluations.length, selectedCandidate: candidate.index, searchComplete: complete, softPreferenceScore: evaluation.total,
    warnings: [...candidate.warnings.filter(w => !/^Unmet (front|rear)/.test(w)), ...(!complete ? ['Search bound reached; returning the best valid candidate found within configured deterministic search bounds.'] : [])],
    assumptions: ['Inscribed rectangular building envelopes within exact orthogonal site polygons; multi-wing footprints are not searched.', 'All room minimums use clear wall faces; space polygons use wall centerlines.', 'Privacy, wet clustering, DAYLIGHT_POTENTIAL and VENTILATION_POTENTIAL are design heuristics, not simulation or certification.', 'Parking product default is 2500 x 5000 mm; conceptual direct-frontage allocation only. Pavement, turning paths, gradients and code compliance are NOT_EVALUATED.', 'North=0 points to world -z; positive north rotates clockwise. Cardinal preferences support quarter turns only.', 'Front/rear and parking use explicit accessSide; absent access does not imply a geographic front.', 'Straight stairs retain exact risers/run, landings and slab voids; front/center/rear locations, no headroom or structural certification.', 'No optimality claim; candidate ties use lexicographic canonical construction JSON.'],
    satisfiedHardConstraints: ['requested-room-counts', 'room-levels', 'clear-room-minimums', 'exact-site-containment', 'physical-wall-containment', 'entrance-reachability', 'controlling-dimension-reconciliation', ...evaluation.relationships.filter(e => e.strength === 'hard').map(e => `${e.kind}:${e.from}:${e.to}`), ...(r.layoutV2.parking.count ? ['parking-site-allocation'] : [])],
    circulation, roomDimensions: candidate.spaces.filter(s => s.role === 'room').map(s => ({ spaceId: s.entity.id, clearWidthMm: s.clear.w, clearDepthMm: s.clear.d, clearAreaMm2: s.clear.w * s.clear.d })),
    utilization: { siteAreaMm2: Number(polygonAreaMm2(r.site.boundary)), buildableAreaMm2, footprintAreaMm2, totalEnvelopeAreaMm2: footprintAreaMm2 * r.floors,
      roomClearAreaMm2: areaFor('room'), circulationClearAreaMm2: areaFor('circulation'), stairCoreClearAreaMm2: areaFor('stair'), wallsAndResidualAreaMm2: footprintAreaMm2 * r.floors - areaFor('room') - areaFor('circulation') - areaFor('stair'), unusedBuildableAreaMm2: buildableAreaMm2 - footprintAreaMm2 },
  }, diagnostics: { scoreVersion: evaluation.scoreVersion, operationCount: budget.operations, decompositionCells: Math.max(0, ...proposals.map(p => p.cells)), envelopes: proposals.length, topologyCount, rejectedBy: failures, evaluations, winner: evaluation,
    program: c.rooms.map(room => ({ key: room.key, level: room.level, zone: zone(room.requirement.type) })) } };
}
