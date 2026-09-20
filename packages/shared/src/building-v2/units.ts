import { z } from 'zod';

/** Engineering envelope, not a regulation: ±100 km; individual lengths ≤100 km. */
export const MAX_MM = 100_000_000;
export const CoordinateMmSchema = z.number().finite().int().min(-MAX_MM).max(MAX_MM);
export const LengthMmSchema = z.number().finite().int().positive().max(MAX_MM);
export const OffsetMmSchema = z.number().finite().int().nonnegative().max(MAX_MM);
export const DisplayUnitSchema = z.enum(['mm', 'cm', 'm', 'ft', 'in']);
export type DisplayUnit = z.infer<typeof DisplayUnitSchema>;
const factors: Record<DisplayUnit, readonly [bigint, bigint]> = {
  mm: [1n, 1n], cm: [10n, 1n], m: [1000n, 1n], ft: [1524n, 5n], in: [127n, 5n],
};

export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive');
  const magnitude = numerator < 0n ? -numerator : numerator;
  const rounded = (magnitude * 2n + denominator) / (denominator * 2n);
  return numerator < 0n ? -rounded : rounded;
}

/** Exact base-ten input. Number inputs mean their ECMAScript decimal serialization. */
export function decimalRatio(value: string | number): readonly [bigint, bigint] {
  const text = String(value);
  if (text.length > 128) throw new RangeError('Decimal input too long');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new RangeError('Expected a finite decimal');
  const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) throw new RangeError('Decimal exponent out of range');
  let numerator = BigInt(match[2]! + (match[3] ?? '')) * (match[1] === '-' ? -1n : 1n);
  let denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator = 10n ** BigInt(-exponent);
  return [numerator, denominator];
}

/** Round once at a system boundary, nearest integer mm, ties away from zero. */
export function toMillimetres(value: string | number, unit: DisplayUnit): number {
  const [n, d] = decimalRatio(value);
  const [fn, fd] = factors[DisplayUnitSchema.parse(unit)];
  return CoordinateMmSchema.parse(Number(roundRatio(n * fn, d * fd)));
}

/** Display only; exact fixed-decimal string, never fed back into geometry implicitly. */
export function fromMillimetres(mm: number, unit: DisplayUnit, decimalPlaces = 3): string {
  CoordinateMmSchema.parse(mm);
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 12) throw new RangeError('Display precision must be 0–12');
  const [n, d] = factors[DisplayUnitSchema.parse(unit)];
  const scaled = roundRatio(BigInt(mm) * d * 10n ** BigInt(decimalPlaces), n);
  const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(decimalPlaces + 1, '0');
  return (scaled < 0n ? '-' : '') + (decimalPlaces === 0 ? digits : `${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`);
}

export function feetAndInchesToMillimetres(feet: string | number, inches: string | number): number {
  const [f, fd] = decimalRatio(feet); const [i, id] = decimalRatio(inches);
  // Signed additive components; round their combined length only once.
  return CoordinateMmSchema.parse(Number(roundRatio(f * id * 1524n + i * fd * 127n, fd * id * 5n)));
}

export function reconcileDimensions(overallMm: number, segmentsMm: readonly number[]): boolean {
  LengthMmSchema.parse(overallMm);
  if (segmentsMm.length === 0) return false;
  return segmentsMm.reduce((sum, value) => sum + BigInt(LengthMmSchema.parse(value)), 0n) === BigInt(overallMm);
}
