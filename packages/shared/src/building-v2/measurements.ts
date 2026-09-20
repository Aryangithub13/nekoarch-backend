import { abs, FootprintMmSchema, RingMmSchema, SegmentMmSchema, segmentLengthMm, signedArea2, type FootprintMm, type RingMm } from './geometry.js';
import type { BuildingModelV2 } from './model-shape.js';
import { BuildingModelV2Schema } from './building-model.js';

/** Exact decimal mm² string, including the possible half-mm² on an integer grid. */
export function areaFromDoubledMm2(doubled: bigint): string {
  if (doubled < 0n) throw new RangeError('Negative area');
  return `${doubled / 2n}${doubled % 2n ? '.5' : ''}`;
}
export function polygonAreaMm2(ring: RingMm): string {
  RingMmSchema.parse(ring);
  return areaFromDoubledMm2(abs(signedArea2(ring)));
}
export function footprintAreaMm2(footprint: FootprintMm): string {
  FootprintMmSchema.parse(footprint);
  return areaFromDoubledMm2(abs(signedArea2(footprint.outer)) - footprint.voids.reduce((sum, hole) => sum + abs(signedArea2(hole)), 0n));
}
/** Sum of independently rounded segment lengths; exact for integer-length edges. */
export function polygonPerimeterMm(ring: RingMm): number {
  RingMmSchema.parse(ring);
  return ring.reduce((sum, start, i) => sum + segmentLengthMm({ start, end: ring[(i + 1) % ring.length]! }), 0);
}
export function openingAreaMm2(model: BuildingModelV2, openingId: string): string {
  const parsed = BuildingModelV2Schema.parse(model);
  const opening = parsed.openings.find(o => o.id === openingId);
  if (!opening) throw new RangeError('Unknown opening');
  return (BigInt(opening.widthMm) * BigInt(opening.heightMm)).toString();
}
export function wallMeasurements(model: BuildingModelV2, wallId: string) {
  const parsed = BuildingModelV2Schema.parse(model);
  const wall = parsed.walls.find(w => w.id === wallId);
  if (!wall) throw new RangeError('Unknown wall');
  const lengthMm = segmentLengthMm(SegmentMmSchema.parse(wall.path));
  if (wall.heightMm === null || wall.thicknessMm === null) return { lengthMm, grossFaceAreaMm2: null, netFaceAreaMm2: null, netPrismVolumeMm3: null };
  const gross = BigInt(lengthMm) * BigInt(wall.heightMm);
  const openings = parsed.openings.filter(o => o.wallId === wall.id).reduce((n, o) => n + BigInt(o.widthMm) * BigInt(o.heightMm), 0n);
  return { lengthMm, grossFaceAreaMm2: gross.toString(), netFaceAreaMm2: (gross - openings).toString(), netPrismVolumeMm3: ((gross - openings) * BigInt(wall.thicknessMm)).toString() };
}
/** Geometric floor-plate area (voids deducted), not a jurisdiction's legal GFA. */
export function grossFloorAreaMm2(model: BuildingModelV2): string {
  const parsed = BuildingModelV2Schema.parse(model);
  const floors = parsed.slabs.filter(s => s.kind === 'floor');
  if (floors.length === 0) throw new RangeError('Floor plate geometry is unknown');
  // Distinct plates must not be summed twice; model validation enforces this.
  const doubled = floors.reduce((sum, slab) => sum + abs(signedArea2(slab.footprint.outer)) - slab.footprint.voids.reduce((holes, h) => holes + abs(signedArea2(h)), 0n), 0n);
  return areaFromDoubledMm2(doubled);
}
