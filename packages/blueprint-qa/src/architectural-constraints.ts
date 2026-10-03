import { Context } from './context.js';
import { bounds, coversSegment, edgeList, isRectangle, positiveCollinearOverlap } from './geometry.js';

/** Reconstruct wall-face clearances from independently measured wall adjacency.
 * Doubled millimetres retain odd wall half-thickness exactly. No solver boxes. */
export function architecturalConstraintsAudit(c: Context): void {
  const cache = new Map<string, ReturnType<typeof reconstruct>>();
  function reconstruct(id: string) {
    const space = c.spaces.get(id);
    if (!space || !isRectangle(space.boundary)) return null;
    const b = bounds(space.boundary), inset = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    for (const [a, end] of edgeList(space.boundary)) {
      c.spend(c.model.walls.length);
      const walls = c.model.walls.filter(w => c.wallSpaces.get(w.id)?.includes(id) && w.thicknessMm !== null && positiveCollinearOverlap(a, end, w.path.start, w.path.end));
      if (!coversSegment(a, end, walls.map(w => [w.path.start, w.path.end]))) return null;
      const side = a.x === end.x ? (a.x === b.minX ? 'minX' : 'maxX') : (a.z === b.minZ ? 'minZ' : 'maxZ');
      inset[side] = Math.max(inset[side], ...walls.map(w => w.thicknessMm!));
    }
    return { minX: 2 * b.minX + inset.minX, maxX: 2 * b.maxX - inset.maxX, minZ: 2 * b.minZ + inset.minZ, maxZ: 2 * b.maxZ - inset.maxZ };
  }
  function clear(id: string) {
    if (!cache.has(id)) cache.set(id, reconstruct(id));
    return cache.get(id)!;
  }
  for (const requirement of c.options.requiredClearSpaces) {
    const b = clear(requirement.id), space = c.spaces.get(requirement.id);
    if (!b || (requirement.levelId && space?.levelId !== requirement.levelId)) {
      c.add('QA_REQUIRED_CLEAR_SPACE', 'spaces', [requirement.id], 'Required room must resolve on its requested level with complete rectangular wall-face evidence.'); continue;
    }
    const width2 = b.maxX - b.minX, depth2 = b.maxZ - b.minZ;
    if (width2 < 2 * requirement.minimumWidthMm || depth2 < 2 * requirement.minimumDepthMm || BigInt(width2) * BigInt(depth2) < 4n * BigInt(requirement.minimumAreaMm2 ?? 1)) {
      c.add('QA_REQUIRED_CLEAR_SPACE', 'spaces', [requirement.id], 'Reconstructed clear dimensions fail the declared hard room minimum.', { widthMm: requirement.minimumWidthMm, depthMm: requirement.minimumDepthMm, areaMm2: requirement.minimumAreaMm2 ?? 1 }, { width2Mm: width2, depth2Mm: depth2 });
    }
  }
  for (const relation of c.options.requiredSeparations) {
    const a = clear(relation.from), b = clear(relation.to), one = c.spaces.get(relation.from), two = c.spaces.get(relation.to);
    if (!a || !b || !one || !two) { c.add('QA_REQUIRED_SEPARATION', 'spaces', [relation.from, relation.to], 'Required separation lacks rectangular clear-space evidence.'); continue; }
    // Different levels satisfy zoning separation, not a physical/acoustic clearance claim.
    if (one.levelId !== two.levelId) continue;
    const distance2 = Math.max(0, a.minX - b.maxX, b.minX - a.maxX) + Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
    if (distance2 < 2 * relation.minimumClearDistanceMm) c.add('QA_REQUIRED_SEPARATION', 'spaces', [relation.from, relation.to], 'Minimum Manhattan distance between clear rectangles is not satisfied.', 2 * relation.minimumClearDistanceMm, distance2);
  }
}
