import { FLOAT_BOUNDARY_ULPS, UNIT_DIMENSIONS, type Unit } from './contracts.js';

// Evaluator-side exact arithmetic (knowledge-units-v1). The result validator owns a separate implementation (§11, §16).
/** Exact rational [numerator, denominator], denominator > 0, always reduced. */
export type Q = readonly [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
export function q(n: bigint, d: bigint = 1n): Q {
  if (d === 0n) throw new RangeError('Zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d); return [n / g, d / g];
}
export const mul = (a: Q, b: Q) => q(a[0] * b[0], a[1] * b[1]);
export const div = (a: Q, b: Q) => q(a[0] * b[1], a[1] * b[0]);
export const sub = (a: Q, b: Q) => q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
export const abs = (a: Q): Q => a[0] < 0n ? [-a[0], a[1]] : a;
export const cmp = (a: Q, b: Q) => { const l = a[0] * b[1], r = b[0] * a[1]; return l < r ? -1 : l > r ? 1 : 0; };
export const isZero = (a: Q) => a[0] === 0n;

/** Parses a canonical decimal, a JSON number serialization (exponent allowed) or a reduced "n/d" exact string. */
export function parseExact(text: string): Q {
  if (text.length > 400) throw new RangeError('Number text too long');
  const fraction = /^(-?\d+)\/(\d+)$/.exec(text);
  if (fraction) return q(BigInt(fraction[1]!), BigInt(fraction[2]!));
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) throw new RangeError(`Not an exact number: ${text}`);
  const decimals = m[3] ?? '', exponent = Number(m[4] ?? '0') - decimals.length;
  if (Math.abs(exponent) > 400) throw new RangeError('Exponent out of range');
  let n = BigInt(m[2]! + decimals) * (m[1] ? -1n : 1n), d = 1n;
  if (exponent >= 0) n *= 10n ** BigInt(exponent); else d = 10n ** BigInt(-exponent);
  return q(n, d);
}
/** The exact rational of a stored JSON number's ECMAScript serialization (never the binary value, never rounded). */
export const fromStored = (value: number): Q => { if (!Number.isFinite(value)) throw new RangeError('Nonfinite stored value'); return parseExact(String(value)); };

/** Canonical text: terminating decimals print in full, everything else as reduced "n/d". */
export function show(r: Q): string {
  let rest = r[1], twos = 0, fives = 0;
  while (rest % 2n === 0n) { rest /= 2n; twos++; }
  while (rest % 5n === 0n) { rest /= 5n; fives++; }
  if (rest !== 1n) return `${r[0]}/${r[1]}`;
  const places = Math.max(twos, fives), scaled = r[0] * 10n ** BigInt(places) / r[1], negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, '0');
  return (negative ? '-' : '') + (places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits);
}

/** Exact factor from each unit to its dimension's canonical unit (§11). */
const FACTOR: Record<Unit, Q> = { mm: [1n, 1n], m: [1000n, 1n], mm2: [1n, 1n], m2: [1_000_000n, 1n], mm3: [1n, 1n], m3: [1_000_000_000n, 1n], W: [1n, 1n], kW: [1000n, 1n],
  VA: [1n, 1n], kVA: [1000n, 1n], 'L/s': [1n, 1n], 'm3/s': [1000n, 1n], 'm/s': [1n, 1n], '1': [1n, 1n], '%': [1n, 100n], count: [1n, 1n], MONEY: [1n, 1n] };
const CANONICAL: Record<string, Unit> = { length: 'mm', area: 'mm2', volume: 'mm3', power: 'W', 'apparent-power': 'VA', flow: 'L/s', velocity: 'm/s', ratio: '1', count: 'count', money: 'MONEY' };
export const factor = (u: Unit): Q => FACTOR[u];
export const canonicalUnit = (u: Unit): Unit => CANONICAL[UNIT_DIMENSIONS[u]]!;
export const sameDimension = (a: Unit, b: Unit) => UNIT_DIMENSIONS[a] === UNIT_DIMENSIONS[b];
export const toCanonical = (r: Q, u: Unit): Q => mul(r, FACTOR[u]);

/** IEEE-754 binary64 spacing at r (§10.1), found by walking powers of two. */
export function ulp(r: Q): Q {
  const a = abs(r);
  if (isZero(a)) return q(1n, 1n << 1074n);
  const pow = (e: number): Q => e >= 0 ? [1n << BigInt(e), 1n] : [1n, 1n << BigInt(-e)];
  let e = 0;
  if (cmp(a, pow(0)) >= 0) { while (cmp(pow(e + 1), a) <= 0) e++; }
  else { while (cmp(pow(e), a) > 0) e--; }
  return pow(Math.max(e, -1022) - 52);
}
/** §10.1 representation-boundary test: the band is K spacings of the stored value, scaled into canonical units. */
export function floatBand(stored: Q, storedUnit: Unit, threshold: Q) {
  const f = FACTOR[storedUnit], spacing = mul(ulp(stored), f), band = mul(q(BigInt(FLOAT_BOUNDARY_ULPS)), spacing);
  const diff = abs(sub(mul(stored, f), threshold));
  return { ambiguous: cmp(diff, band) <= 0, ulp: spacing, band, diff };
}
