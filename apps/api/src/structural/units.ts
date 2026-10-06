/** Explicit engineering unit boundary. Each unit is a dimension plus an exact power-of-ten factor to SI. */
export const UNITS = {
  mm: { dimension: 'length', exponent: -3 }, m: { dimension: 'length', exponent: 0 },
  mm2: { dimension: 'area', exponent: -6 }, m2: { dimension: 'area', exponent: 0 },
  mm3: { dimension: 'volume', exponent: -9 }, m3: { dimension: 'volume', exponent: 0 },
  mm4: { dimension: 'second-moment', exponent: -12 }, m4: { dimension: 'second-moment', exponent: 0 },
  N: { dimension: 'force', exponent: 0 }, kN: { dimension: 'force', exponent: 3 },
  'N*mm': { dimension: 'moment', exponent: -3 }, 'kN*m': { dimension: 'moment', exponent: 3 },
  'N/mm': { dimension: 'line-load', exponent: 3 }, 'kN/m': { dimension: 'line-load', exponent: 3 },
  Pa: { dimension: 'stress', exponent: 0 }, kPa: { dimension: 'stress', exponent: 3 }, MPa: { dimension: 'stress', exponent: 6 },
  'N/m3': { dimension: 'weight-density', exponent: 0 }, 'N/mm3': { dimension: 'weight-density', exponent: 9 },
  kg: { dimension: 'mass', exponent: 0 }, 'kg/m3': { dimension: 'density', exponent: 0 },
  'm/s2': { dimension: 'acceleration', exponent: 0 }, rad: { dimension: 'angle', exponent: 0 }, '1': { dimension: 'ratio', exponent: 0 },
} as const;
export type Unit = keyof typeof UNITS;
type DimensionOf<U extends Unit> = (typeof UNITS)[U]['dimension'];
export type UnitOf<D> = { [U in Unit]: DimensionOf<U> extends D ? U : never }[Unit];

export class UnitError extends Error { constructor(message: string) { super(message); this.name = 'UnitError'; } }

/** Same-dimension conversion only; the type parameter rejects cross-dimension calls at compile time. */
export function convert<F extends Unit>(value: number, from: F, to: UnitOf<DimensionOf<F>>): number {
  const a = UNITS[from], b = UNITS[to as Unit];
  if (!a || !b || a.dimension !== b.dimension) throw new UnitError(`Cannot convert ${String(from)} to ${String(to)}`);
  if (!Number.isFinite(value)) throw new UnitError('Nonfinite quantity');
  const shift = a.exponent - b.exponent;
  // One multiplication or division by an exactly representable power of ten.
  return shift >= 0 ? value * 10 ** shift : value / 10 ** -shift;
}

/** Standard gravity is a defined constant (3rd CGPM, 1901), not an engineering assumption. */
export const STANDARD_GRAVITY = { value: 9.80665, unit: 'm/s2', provenance: 'DEFINED_CONSTANT_STANDARD_GRAVITY', direction: 'GLOBAL_-Y' } as const;

/** ρ [kg/m³] · g [m/s²] · A [mm²] → uniform weight per member length [N/mm]. */
export function selfWeightLineLoad(densityKgPerM3: number, areaMm2: number, gravity = STANDARD_GRAVITY.value): number {
  return convert(densityKgPerM3 * gravity, 'N/m3', 'N/mm3') * areaMm2;
}

/** ρ [kg/m³] · V [mm³] → mass [kg]. */
export function massFromDensity(densityKgPerM3: number, volumeMm3: number): number {
  return densityKgPerM3 * convert(volumeMm3, 'mm3', 'm3');
}
