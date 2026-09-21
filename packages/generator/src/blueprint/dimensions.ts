import { dimensionMeasurements, reconcileDimensions, type BuildingDimension, type BuildingModelV2 } from '@designflow/shared';
import { BlueprintError, type Candidate, type Constraints } from './types.js';
export function constructDimensions(model: BuildingModelV2, c: Constraints, candidate: Candidate): void {
  function add(d: Omit<BuildingDimension, 'id' | 'constraint'>): void {
    const dimension: BuildingDimension = { ...d, id: `dimension-${model.dimensions.length}`, constraint: { mode: 'derived' } };
    const actual = dimensionMeasurements(model, dimension);
    if (!reconcileDimensions(actual.overallMm, actual.segmentsMm)) throw new BlueprintError('DIMENSION_RECONCILIATION_FAILED', 'Dimension differs from geometry');
    dimension.constraint = { mode: 'controlling', ...actual };
    model.dimensions.push(dimension);
  }
  for (const level of model.levels) {
    for (const axis of ['x', 'z'] as const) {
      const start = axis === 'x' ? c.outer.x : c.outer.z, size = axis === 'x' ? c.outer.w : c.outer.d;
      const point = (value: number): BuildingDimension['anchors'][number] => ({ kind: 'point', point: { x: c.outer.x, z: c.outer.z, y: level.elevationMm, [axis]: value } });
      add({ levelId: level.id, purpose: 'overall', axis, anchors: [point(start), point(start + size)] });
      const cuts = [...new Set([start, start + size, ...candidate.spaces.filter(s => s.entity.levelId === level.id).flatMap(s => s.entity.boundary.map(p => p[axis]))])].sort((a, b) => a - b);
      add({ levelId: level.id, purpose: 'chain', axis, anchors: cuts.map(point) });
    }
  }
  for (const s of model.spaces) for (const [axis, indices] of [['x', [0, 1]], ['z', [1, 2]]] as const) add({ levelId: s.levelId, purpose: 'room', axis, anchors: indices.map(vertexIndex => ({ kind: 'space-vertex', spaceId: s.id, vertexIndex })) });
  for (const wall of model.walls) {
    const axis = wall.path.start.x === wall.path.end.x ? 'z' : 'x';
    add({ levelId: wall.levelId, purpose: 'wall', axis, anchors: [{ kind: 'wall-end', wallId: wall.id, end: 'start' }, { kind: 'wall-end', wallId: wall.id, end: 'end' }] });
    for (const o of model.openings.filter(o => o.wallId === wall.id)) add({ levelId: wall.levelId, purpose: 'opening-offset', axis,
      anchors: [{ kind: 'wall-end', wallId: wall.id, end: 'start' }, { kind: 'opening-edge', openingId: o.id, edge: 'start' }, { kind: 'opening-edge', openingId: o.id, edge: 'end' }, { kind: 'wall-end', wallId: wall.id, end: 'end' }] });
  }
  if (model.levels.length === 2) add({ purpose: 'elevation', axis: 'y', anchors: model.levels.map(l => ({ kind: 'level', levelId: l.id })) });
  for (const stair of model.stairs) {
    const from = model.levels.find(l => l.id === stair.fromLevelId)!;
    const axis = stair.direction.endsWith('z') ? 'z' : 'x';
    const sorted = [...stair.footprint].sort((a, b) => a[axis] - b[axis]);
    add({ purpose: 'overall', axis, levelId: from.id, anchors: [sorted[0]!, sorted.at(-1)!].map(p => ({ kind: 'point', point: { ...p, y: from.elevationMm } })) });
  }
}
