import { MAX_MM, type BuildingDimension, type Point3Mm } from '@designflow/shared';
import { Context } from './context.js';
import { openingEnds } from './geometry.js';

type Resolved = { point: Point3Mm; levelId?: string };
function resolve(c: Context, anchor: BuildingDimension['anchors'][number]): Resolved | null {
  if (anchor.kind === 'point') return { point: anchor.point };
  if (anchor.kind === 'level') {
    const l = c.levels.get(anchor.levelId);
    return l ? { point: { x: 0, y: l.elevationMm, z: 0 }, levelId: l.id } : null;
  }
  if (anchor.kind === 'space-vertex') {
    const s = c.spaces.get(anchor.spaceId), p = s?.boundary[anchor.vertexIndex], l = s && c.levels.get(s.levelId);
    return p && l ? { point: { ...p, y: l.elevationMm }, levelId: l.id } : null;
  }
  if (anchor.kind === 'wall-end') {
    const w = c.walls.get(anchor.wallId), l = w && c.levels.get(w.levelId);
    return w && l && w.baseOffsetMm !== null ? { point: { ...w.path[anchor.end], y: l.elevationMm + w.baseOffsetMm }, levelId: l.id } : null;
  }
  const o = c.openings.get(anchor.openingId), w = o && c.walls.get(o.wallId), l = w && c.levels.get(w.levelId);
  if (!o || !w || !l || w.baseOffsetMm === null) return null;
  const ends = openingEnds(w, o.offsetMm, o.widthMm);
  return ends ? { point: { ...ends[anchor.edge === 'start' ? 0 : 1], y: l.elevationMm + w.baseOffsetMm + o.sillMm }, levelId: l.id } : null;
}
export function dimensionsAudit(c: Context): void {
  for (const d of c.model.dimensions) {
    const points: Resolved[] = [];
    d.anchors.forEach((a, index) => {
      const value = resolve(c, a);
      if (!value) c.add('QA_DIMENSION_ANCHOR_UNRESOLVED', 'dimensions', [d.id], 'Dimension anchor cannot resolve to supported geometry.', 'existing supported anchor geometry', a, { anchorIndex: index });
      else points.push(value);
    });
    if (points.length !== d.anchors.length) continue;
    if (points.some(p => Object.values(p.point).some(n => Math.abs(n) > MAX_MM))) c.add('QA_DIMENSION_ANCHOR_RANGE', 'dimensions', [d.id], 'Resolved dimension anchor exceeds the coordinate envelope.', MAX_MM, points.map(p => p.point));
    if (d.levelId && points.some(p => p.levelId && p.levelId !== d.levelId)) c.add('QA_DIMENSION_LEVEL_MISMATCH', 'dimensions', [d.id], 'Dimension references geometry on another level.', d.levelId, points.map(p => p.levelId ?? null));
    if (d.axis !== 'y' && d.anchors.some(a => a.kind === 'level')) c.add('QA_DIMENSION_AXIS', 'dimensions', [d.id], 'Level anchors support elevation dimensions only.', 'y', d.axis);
    const values = points.map(p => p.point[d.axis]);
    const deltas = values.slice(1).map((n, i) => n - values[i]!);
    const segmentsMm = deltas.map(Math.abs), overallMm = Math.abs(values.at(-1)! - values[0]!);
    const deltaMm = d.constraint.mode === 'controlling' ? overallMm - d.constraint.overallMm : null;
    c.report.measurements.dimensions.push({ entityId: d.id, overallMm, segmentsMm, deltaMm });
    if (!deltas.every(n => n > 0) && !deltas.every(n => n < 0)) c.add('QA_DIMENSION_CHAIN_ORDER', 'dimensions', [d.id], 'Anchor order duplicates or reverses a segment along the measured axis.', 'strictly monotonic anchors', values);
    if (d.constraint.mode === 'controlling') {
      const declared = d.constraint, sum = declared.segmentsMm.reduce((a, b) => a + b, 0);
      if (declared.segmentsMm.length !== segmentsMm.length || sum !== declared.overallMm) c.add('QA_DIMENSION_CHAIN_RECONCILIATION', 'dimensions', [d.id], 'Declared child segments must be present exactly once and sum to the controlling total.', { segmentCount: segmentsMm.length, overallMm: declared.overallMm }, { segmentCount: declared.segmentsMm.length, segmentSumMm: sum }, { deltaMm: sum - declared.overallMm });
      if (overallMm !== declared.overallMm || segmentsMm.length !== declared.segmentsMm.length || segmentsMm.some((n, i) => n !== declared.segmentsMm[i])) c.add('QA_DIMENSION_MISMATCH', 'dimensions', [d.id], 'Controlling dimensions disagree with independently resolved anchor geometry.', { overallMm: declared.overallMm, segmentsMm: declared.segmentsMm }, { overallMm, segmentsMm }, { deltaMm, axis: d.axis, anchorCoordinatesMm: values });
    }
  }
}
