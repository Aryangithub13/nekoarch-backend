import { abs, integerSqrt, lengthSquared, signedArea2, type RingMm, type SegmentMm, type FootprintMm } from '@designflow/shared';
import { quantityUnits, TakeoffError, type Unit } from './report.js';

/** Internal quantities are doubled base units, including exact half-mm²/mm³. */
export const decimal = (doubled: bigint): string => {
  if (doubled < 0n) throw new TakeoffError('TAKEOFF_INVARIANT_FAILED', 'Negative geometric quantity');
  return `${doubled / 2n}${doubled % 2n ? '.5' : ''}`;
};
export const doubled = (value: string): bigint => BigInt(value.split('.')[0]!) * 2n + (value.endsWith('.5') ? 1n : 0n);
export const area = (ring: RingMm): bigint => abs(signedArea2(ring));
export const plateArea = (shape: FootprintMm) => {
  const gross = area(shape.outer), voids = shape.voids.reduce((sum, ring) => sum + area(ring), 0n);
  return { gross, voids, net: gross - voids };
};
export function length(segment: SegmentMm) {
  const squared = lengthSquared(segment), floor = integerSqrt(squared);
  const mm = 4n * squared >= (2n * floor + 1n) ** 2n ? floor + 1n : floor;
  return { mm, rounded: floor * floor !== squared };
}
export function perimeter(ring: RingMm) {
  const spans = ring.map((start, i) => length({ start, end: ring[(i + 1) % ring.length]! }));
  return { mm: spans.reduce((sum, span) => sum + span.mm, 0n), rounded: spans.some(s => s.rounded) };
}
export function quantity(value: bigint, unit: Unit, places: number) {
  const divisor = { mm: 1000n, mm2: 1000000n, mm3: 1000000000n, each: 1n }[unit];
  const digits = unit === 'each' ? 0 : places;
  const scale = 10n ** BigInt(digits), denominator = divisor * 2n;
  const rounded = (value * scale * 2n + denominator) / (2n * denominator);
  const text = rounded.toString().padStart(digits + 1, '0');
  return { value: decimal(value), unit, dimension: quantityUnits[unit], display: {
    value: digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text,
    unit: ({ mm: 'm', mm2: 'm2', mm3: 'm3', each: 'each' } as const)[unit],
  } };
}
