import { decimalRatio } from '@designflow/shared';

/** Exact rational [numerator, denominator], denominator > 0, always reduced. */
export type Rational = readonly [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
export function rational(n: bigint, d: bigint = 1n): Rational {
  if (d === 0n) throw new RangeError('Zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d); return [n / g, d / g];
}
export const ZERO = rational(0n);
export const add = (a: Rational, b: Rational) => rational(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
export const mul = (a: Rational, b: Rational) => rational(a[0] * b[0], a[1] * b[1]);
export const div = (a: Rational, b: Rational) => rational(a[0] * b[1], a[1] * b[0]);
/** A finite JSON number read as its exact ECMAScript decimal serialization. */
export const fromNumber = (value: number): Rational => { const [n, d] = decimalRatio(value); return rational(n, d); };
export const toNumber = (r: Rational) => Number(r[0]) / Number(r[1]);
/** Terminating decimals print exactly; other rationals print as "n/d". */
export function toExact(r: Rational): string {
  let d = r[1], twos = 0, fives = 0;
  while (d % 2n === 0n) { d /= 2n; twos++; }
  while (d % 5n === 0n) { d /= 5n; fives++; }
  if (d !== 1n) return `${r[0]}/${r[1]}`;
  const places = Math.max(twos, fives), scaled = r[0] * 10n ** BigInt(places) / r[1], negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, '0');
  return (negative ? '-' : '') + (places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits);
}
export const exact = <U extends string>(r: Rational, unit: U) => ({ value: toNumber(r), exact: toExact(r), unit });
export const LITRES_PER_CUBIC_METRE = 1000n, MM2_PER_M2 = 1_000_000n;
