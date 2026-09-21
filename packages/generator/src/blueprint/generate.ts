import { polygonAreaMm2 } from '@designflow/shared';
import { BLUEPRINT_VERSION, normalizeBlueprintRequirements } from './input.js';
import { buildConstraints } from './geometry.js';
import { allocateCandidate, candidateSchedule, spend } from './layout.js';
import { constructModel } from './entities.js';
import { constructDimensions } from './dimensions.js';
import { analyzeCirculation, validateBlueprint } from './validation.js';
import { BlueprintError, type BlueprintResult, type Candidate } from './types.js';

/** Pure architectural generation; throws portable BlueprintError failures. */
export function generateBlueprint(input: unknown): BlueprintResult {
  const r = normalizeBlueprintRequirements(input), constraints = buildConstraints(r);
  const budget = { candidates: 0, iterations: 0 };
  let best: { candidate: Candidate; model: BlueprintResult['model'] } | undefined;
  let complete = true, valid = 0;
  const failures = new Map<string, number>();
  for (const proposal of candidateSchedule(r, constraints)) {
    if (budget.candidates >= r.solver.maxCandidates || budget.iterations >= r.solver.maxIterations) { complete = false; break; }
    const index = budget.candidates++;
    try {
      spend(budget, r);
      const candidate = allocateCandidate(r, constraints, proposal.ordered, proposal.axis, proposal.split, index, budget);
      const model = constructModel(r, constraints, candidate);
      if (analyzeCirculation(model).unreachableSpaceIds.length) throw new BlueprintError('IMPOSSIBLE_LAYOUT', 'Candidate circulation is disconnected');
      valid++;
      if (!best || candidate.score < best.candidate.score) best = { candidate, model };
    } catch (error) {
      if (!(error instanceof BlueprintError)) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Unexpected solver construction failure');
      if (error.code === 'SEARCH_LIMIT_EXHAUSTED') { complete = false; break; }
      if (error.code === 'DIMENSION_RECONCILIATION_FAILED' || error.code === 'BLUEPRINT_INVARIANT_FAILED') throw error;
      failures.set(error.code, (failures.get(error.code) ?? 0) + 1);
    }
  }
  if (!best) {
    const code = !complete ? 'SEARCH_LIMIT_EXHAUSTED' : failures.size === 1 && failures.has('STAIR_PLACEMENT_FAILED') ? 'STAIR_PLACEMENT_FAILED' : failures.has('UNSATISFIED_HARD_CONSTRAINT') ? 'UNSATISFIED_HARD_CONSTRAINT' : 'IMPOSSIBLE_LAYOUT';
    throw new BlueprintError(code, complete ? 'No feasible layout in the supported candidate family' : 'No feasible layout found within search limits', { candidateAttempts: budget.candidates, iterations: budget.iterations, rejectedBy: [...failures].map(([reason, count]) => `${reason}:${count}`) });
  }
  const { candidate, model } = best;
  constructDimensions(model, constraints, candidate);
  const circulation = validateBlueprint(model, r, constraints, candidate);
  const areaFor = (role: Candidate['spaces'][number]['role']) => candidate.spaces.filter(s => s.role === role).reduce((sum, s) => sum + s.clear.w * s.clear.d, 0);
  const footprintAreaMm2 = constraints.outer.w * constraints.outer.d;
  const roomClearAreaMm2 = areaFor('room'), circulationClearAreaMm2 = areaFor('circulation'), stairCoreClearAreaMm2 = areaFor('stair');
  const warnings = [...candidate.warnings];
  if (!complete) warnings.push('Search budget reached; returning the best feasible candidate evaluated, without an optimality claim');
  return { model, metadata: {
    solverVersion: BLUEPRINT_VERSION, seed: r.seed, candidateAttempts: budget.candidates, iterations: budget.iterations, validCandidates: valid, selectedCandidate: candidate.index, searchComplete: complete,
    softPreferenceScore: candidate.score, warnings, circulation,
    assumptions: [
      `Effective wall thicknesses: exterior ${r.exteriorWallThicknessMm} mm, interior ${r.interiorWallThicknessMm} mm (defaults 200/100)`,
      `Effective door ${r.door.widthMm} x ${r.door.heightMm} mm, jamb ${r.door.jambMm} mm (defaults 900/2100/100); schematic hinged operation`,
      `Effective window ${r.windows.widthMm} x ${r.windows.heightMm} mm, sill ${r.windows.sillMm} mm; enabled=${r.windows.enabled} (defaults 1200/1200/900/true)`,
      `Effective floor height ${r.floorToFloorHeightMm} mm, slab ${r.slabThicknessMm} mm, minimum clear corridor ${r.circulationWidthMm} mm (defaults 3000/150/1200)`,
      'Room minimum dimensions and areas use clear wall faces; V2 space dimensions use wall centerlines',
      'Footprint fills the rectangular permitted region; no implicit municipal setbacks',
      'Front is the minimum world-z side; entrance is at the corridor start; north is metadata',
      'Stair core is reserved circulation/void geometry, not an occupied room; no code, headroom or structural certification',
      ...(r.stair ? [`Effective straight stair width ${r.stair.widthMm} mm, risers ${r.stair.riserCount}, tread ${r.stair.treadDepthMm} mm, minimum landing ${r.stair.landingDepthMm} mm (defaults 1000/16/280/1200)`] : []),
    ],
    satisfiedHardConstraints: ['requested-room-counts', 'room-levels', 'clear-room-minimums', 'site-and-setback-containment', 'physical-wall-containment', 'opening-hosts-and-clearance', 'entrance-reachability', 'controlling-dimension-reconciliation', 'architectural-v2-validation', ...r.relationships.filter(e => e.strength === 'hard').map(e => `${e.kind}:${selectorKeyForMetadata(e.from)}:${selectorKeyForMetadata(e.to)}`), ...(r.floors === 2 ? ['stair-rise-run-landings', 'stair-slab-void', 'cross-level-reachability'] : [])],
    roomDimensions: candidate.spaces.filter(s => s.role === 'room').map(s => ({ spaceId: s.entity.id, clearWidthMm: s.clear.w, clearDepthMm: s.clear.d, clearAreaMm2: s.clear.w * s.clear.d })),
    utilization: { siteAreaMm2: Number(polygonAreaMm2(constraints.siteBoundary)), buildableAreaMm2: footprintAreaMm2, footprintAreaMm2, totalEnvelopeAreaMm2: footprintAreaMm2 * r.floors,
      roomClearAreaMm2, circulationClearAreaMm2, stairCoreClearAreaMm2, wallsAndResidualAreaMm2: footprintAreaMm2 * r.floors - roomClearAreaMm2 - circulationClearAreaMm2 - stairCoreClearAreaMm2, unusedBuildableAreaMm2: 0 },
  } };
}
function selectorKeyForMetadata(s: { type: string; ordinal: number }): string { return `${s.type}-${s.ordinal}`; }
