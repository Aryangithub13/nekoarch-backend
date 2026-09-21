import { type HostedOpening } from '@designflow/shared';
import { Context } from './context.js';
import { coversSegment, edgeList, openingEnds, wallSquare } from './geometry.js';

export const traversable = (o: HostedOpening): boolean => o.kind === 'door' || (o.kind === 'opening' && o.purpose === 'passage');
export function openingsAudit(c: Context): void {
  for (const o of c.model.openings) {
    const w = c.walls.get(o.wallId), l = w && c.levels.get(w.levelId);
    const base = l && w && w.baseOffsetMm !== null ? l.elevationMm + w.baseOffsetMm + o.sillMm : null;
    c.report.measurements.openings.push({ entityId: o.id, areaMm2: (BigInt(o.widthMm) * BigInt(o.heightMm)).toString(), baseMm: base, topMm: base === null ? null : base + o.heightMm });
    const fail = (code: string, message: string, expected: number | string | null, actual: number | string | null) => {
      c.invalidOpenings.add(o.id); c.add(code, 'openings', [o.id, o.wallId], message, expected, actual);
    };
    if (!w) { fail('QA_OPENING_HOST_MISSING', 'Opening host does not exist.', 'existing wall', o.wallId); continue; }
    if (o.levelId !== w.levelId) fail('QA_OPENING_LEVEL_MISMATCH', 'Opening and wall must be on the same level.', w.levelId, o.levelId);
    if (w.pathReference !== 'centerline' || w.heightMm === null || w.baseOffsetMm === null || w.thicknessMm === null) fail('QA_OPENING_HOST_INCOMPLETE', 'Opening requires complete host construction geometry.', 'complete wall', null);
    if (BigInt(o.offsetMm + o.widthMm) ** 2n > wallSquare(w)) fail('QA_OPENING_OUTSIDE_HOST', 'Opening horizontal extent exceeds the exact host length.', `squared length ${wallSquare(w)}`, `squared end offset ${BigInt(o.offsetMm + o.widthMm) ** 2n}`);
    if (w.heightMm !== null && o.sillMm + o.heightMm > w.heightMm) fail('QA_OPENING_ABOVE_HOST', 'Opening sill plus height exceeds host wall height.', w.heightMm, o.sillMm + o.heightMm);
    const ends = openingEnds(w, o.offsetMm, o.widthMm);
    if (!ends) {
      c.add('QA_OPENING_TOPOLOGY_NOT_EVALUATED', 'coverage', [o.id], 'Opening topology on a nonorthogonal host is not implemented.', 'orthogonal host', 'nonorthogonal host', {}, 'WARNING');
      c.partial('openings', `Unsupported opening topology: ${o.id}`); continue;
    }
    const adjacent = c.model.spaces.filter(s => {
      c.spend(s.boundary.length);
      return s.levelId === o.levelId && coversSegment(ends[0], ends[1], edgeList(s.boundary));
    }).map(s => s.id).sort();
    c.openingSpaces.set(o.id, adjacent);
    if (adjacent.length > 2) fail('QA_OPENING_TOPOLOGY', 'Opening connects more than two overlapping space boundaries.', 2, adjacent.length);
    if (w.spaceIds && w.spaceIds.some(id => !adjacent.includes(id))) fail('QA_OPENING_SPACE_RELATIONSHIP', 'Opening interval does not adjoin every host-referenced space.', 'geometrically adjoining spaces', adjacent.join('|'));
    if (traversable(o) && (o.sillMm !== 0 || w.baseOffsetMm !== 0)) c.add('QA_RAISED_PASSAGE_NOT_CONNECTED', 'circulation', [o.id], 'Raised door/passage threshold is excluded from level-floor connectivity; step access is not represented.', { sillMm: 0, wallBaseOffsetMm: 0 }, { sillMm: o.sillMm, wallBaseOffsetMm: w.baseOffsetMm }, {}, 'WARNING');
  }
  for (let i = 0; i < c.model.openings.length; i++) for (let j = 0; j < i; j++) {
    c.spend(); const a = c.model.openings[i]!, b = c.model.openings[j]!;
    if (a.wallId === b.wallId && Math.min(a.offsetMm + a.widthMm, b.offsetMm + b.widthMm) > Math.max(a.offsetMm, b.offsetMm)
      && Math.min(a.sillMm + a.heightMm, b.sillMm + b.heightMm) > Math.max(a.sillMm, b.sillMm)) {
      c.add('QA_OPENING_OVERLAP', 'openings', [a.id, b.id], 'Hosted opening rectangles overlap in both horizontal and vertical extent.', 'disjoint interiors', 'overlap', { wallId: a.wallId });
      c.invalidOpenings.add(a.id); c.invalidOpenings.add(b.id);
    }
  }
}
