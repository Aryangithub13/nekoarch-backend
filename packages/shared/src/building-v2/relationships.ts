import type { BuildingModelV2 } from './model-shape.js';
import type { BuildingDimension } from './dimensions.js';
import type { BuildingWall } from './walls.js';
import { edges, onSegment, type Point3Mm, type Point2Mm } from './geometry.js';

export function wallSpaceIds(model: BuildingModelV2, wall: BuildingWall): string[] {
  // A room edge may contain redundant collinear vertices; collect covered spans.
  return model.spaces.filter(space => {
    if (space.levelId !== wall.levelId) return false;
    const { start, end } = wall.path;
    const cuts = [start, end, ...space.boundary.filter(p => onSegment(p, start, end))];
    cuts.sort((a, b) => start.x !== end.x ? a.x - b.x : a.z - b.z);
    return cuts.slice(1).every((p, i) => {
      const q = cuts[i]!;
      const midpoint: Point2Mm = { x: p.x + q.x, z: p.z + q.z };
      return edges(space.boundary).some(([a, b]) => onSegment(midpoint, { x: a.x * 2, z: a.z * 2 }, { x: b.x * 2, z: b.z * 2 }));
    });
  }).map(space => space.id).sort();
}
export function wallOpenings(model: BuildingModelV2, wallId: string) {
  return model.openings.filter(opening => opening.wallId === wallId);
}
export function openingSpaceIds(model: BuildingModelV2, openingId: string): string[] {
  const opening = model.openings.find(o => o.id === openingId);
  const wall = model.walls.find(w => w.id === opening?.wallId);
  if (!wall) throw new RangeError('Unknown opening or host');
  return wallSpaceIds(model, wall);
}

export function dimensionPoints(model: BuildingModelV2, dimension: BuildingDimension): Point3Mm[] {
  return dimension.anchors.map(anchor => {
    if (anchor.kind === 'point') return anchor.point;
    if (anchor.kind === 'level') {
      const level = model.levels.find(l => l.id === anchor.levelId);
      if (!level) throw new RangeError('Unresolved dimension level');
      return { x: 0, z: 0, y: level.elevationMm };
    }
    if (anchor.kind === 'space-vertex') {
      const space = model.spaces.find(s => s.id === anchor.spaceId);
      const point = space?.boundary[anchor.vertexIndex];
      const level = model.levels.find(l => l.id === space?.levelId);
      if (!point || !level) throw new RangeError('Unresolved space vertex');
      return { ...point, y: level.elevationMm };
    }
    if (anchor.kind === 'opening-edge') {
      const opening = model.openings.find(o => o.id === anchor.openingId);
      const wall = model.walls.find(w => w.id === opening?.wallId);
      const level = model.levels.find(l => l.id === wall?.levelId);
      if (!opening || !wall || !level || wall.baseOffsetMm === null) throw new RangeError('Unresolved opening geometry');
      const { start, end } = wall.path;
      if (start.x !== end.x && start.z !== end.z) throw new RangeError('Opening edge axis dimensions require an axis-aligned host');
      const offset = opening.offsetMm + (anchor.edge === 'end' ? opening.widthMm : 0);
      return { x: start.x + Math.sign(end.x - start.x) * offset, z: start.z + Math.sign(end.z - start.z) * offset,
        y: level.elevationMm + wall.baseOffsetMm + opening.sillMm };
    }
    const wall = model.walls.find(w => w.id === anchor.wallId);
    const level = model.levels.find(l => l.id === wall?.levelId);
    if (!wall || !level || wall.baseOffsetMm === null) throw new RangeError('Unresolved dimension wall base');
    return { ...wall.path[anchor.end], y: level.elevationMm + wall.baseOffsetMm };
  });
}
export function dimensionMeasurements(model: BuildingModelV2, dimension: BuildingDimension) {
  const points = dimensionPoints(model, dimension);
  const values = points.map(p => p[dimension.axis]);
  return { overallMm: Math.abs(values.at(-1)! - values[0]!), segmentsMm: values.slice(1).map((n, i) => Math.abs(n - values[i]!)) };
}
