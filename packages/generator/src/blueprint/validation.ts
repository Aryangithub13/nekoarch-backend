import { ArchitecturalBuildingModelV2Schema, BuildingModelV2Schema, ringContains, ringsOverlap, type BuildingModelV2 } from '@designflow/shared';
import { landingDoorFits } from './entities.js';
import { bounds, rectangle } from './geometry.js';
import { selectorKey, type NormalizedBlueprintRequirements } from './input.js';
import { BlueprintError, type Candidate, type CirculationAnalysis, type Constraints } from './types.js';

export function analyzeCirculation(model: BuildingModelV2): CirculationAnalysis {
  const entranceSpaceId = 'space-corridor-0', edges: CirculationAnalysis['edges'] = [];
  let entrance = false;
  for (const o of model.openings.filter(o => o.kind === 'door' || (o.kind === 'opening' && o.purpose === 'passage'))) {
    const wall = model.walls.find(w => w.id === o.wallId);
    if (!wall || o.sillMm !== 0 || o.levelId !== wall.levelId) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Circulation opening has invalid host or threshold');
    const ids = wall.spaceIds ?? [];
    if (ids.length === 1 && ids[0] === entranceSpaceId && wall.classification === 'exterior') entrance = true;
    if (ids.length === 2) edges.push({ from: ids[0]!, to: ids[1]!, via: o.id });
  }
  for (const stair of model.stairs) {
    const source = model.spaces.find(s => s.levelId === stair.fromLevelId && s.classification === 'stairwell' && ringContains(s.boundary, stair.footprint));
    const target = model.spaces.find(s => s.levelId === stair.toLevelId && s.classification === 'stairwell' && ringContains(s.boundary, stair.footprint));
    if (!source || !target) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Stair does not resolve to source and destination cores');
    for (const [space, offset] of [[source, 0], [target, stair.riseMm]] as const) {
      const landing = stair.landings.find(l => l.elevationOffsetMm === offset);
      if (!landing || !model.openings.some(o => o.kind === 'door' && o.levelId === space.levelId && model.walls.some(w => w.id === o.wallId && w.spaceIds?.includes(space.id) && w.spaceIds.length === 2) && landingDoorFits(model, o, landing))) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Stair requires door access at the correct landing');
    }
    edges.push({ from: source.id, to: target.id, via: stair.id });
  }
  const reached = new Set<string>(entrance ? [entranceSpaceId] : []), queue = [...reached];
  for (let i = 0; i < queue.length; i++) for (const edge of edges) {
    const next = edge.from === queue[i] ? edge.to : edge.to === queue[i] ? edge.from : undefined;
    if (next && !reached.has(next)) { reached.add(next); queue.push(next); }
  }
  return { entranceSpaceId, edges, reachableSpaceIds: [...reached].sort(), unreachableSpaceIds: model.spaces.filter(s => !reached.has(s.id)).map(s => s.id).sort() };
}
export function validateBlueprint(model: BuildingModelV2, r: NormalizedBlueprintRequirements, c: Constraints, candidate: Candidate): CirculationAnalysis {
  // Phase 9 contracts stay authoritative. This adds only solver-specific checks.
  for (const schema of [BuildingModelV2Schema, ArchitecturalBuildingModelV2Schema]) {
    const result = schema.safeParse(model);
    if (!result.success) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Generated blueprint failed V2 validation', { fields: result.error.issues.slice(0, 12).map(i => `${i.path.join('.')}: ${i.message}`) });
  }
  for (const room of c.rooms) {
    const matches = candidate.spaces.filter(s => s.key === room.key && s.role === 'room'), s = matches[0];
    if (matches.length !== 1 || !s || s.entity.levelId !== `level-${room.level}` || s.clear.w < room.requirement.minWidthMm || s.clear.d < room.requirement.minDepthMm || s.clear.w * s.clear.d < (room.requirement.minAreaMm2 ?? 1)) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Requested room dimensions/count/level were not preserved');
  }
  if (candidate.spaces.filter(s => s.role === 'room').length !== c.rooms.length) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Unexpected room count');
  for (const wall of model.walls) {
    const b = bounds([wall.path.start, wall.path.end]), t = wall.thicknessMm! / 2;
    // Butt-ended wall prism; perpendicular thickness is physical, not just a path.
    const solid = b.w === 0 ? { x: b.x - t, z: b.z, w: 2 * t, d: b.d } : { x: b.x, z: b.z - t, w: b.w, d: 2 * t };
    if (!ringContains(c.buildableBoundary, rectangle(solid))) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Physical wall exceeds buildable region');
    if (candidate.spaces.some(s => s.entity.levelId === wall.levelId && ringsOverlap(rectangle(s.clear), rectangle(solid)))) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Wall intrudes into declared clear space');
  }
  for (const stair of model.stairs) {
    if (!model.slabs.some(s => s.levelId === stair.toLevelId && s.kind === 'floor' && s.footprint.voids.some(v => ringContains(v, stair.footprint)))) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Stair has no corresponding slab void');
    if (candidate.spaces.some(s => s.role !== 'stair' && ringsOverlap(s.entity.boundary, stair.footprint))) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Stair collides with an occupied space or corridor');
  }
  for (const relation of r.relationships.filter(e => e.strength === 'hard' && e.kind !== 'adjacent')) {
    if (!model.openings.some(o => (relation.kind === 'passage' ? o.kind === 'opening' && o.purpose === 'passage' : o.kind === 'door') && model.walls.some(w => w.id === o.wallId && w.spaceIds?.includes(`space-${selectorKey(relation.from)}`) && w.spaceIds.includes(`space-${selectorKey(relation.to)}`)))) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Required connection missing from final model');
  }
  const circulation = analyzeCirculation(model);
  if (circulation.unreachableSpaceIds.length) throw new BlueprintError('BLUEPRINT_INVARIANT_FAILED', 'Generated spaces are unreachable', { spaces: circulation.unreachableSpaceIds });
  return circulation;
}
