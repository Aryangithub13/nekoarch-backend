import { costHash } from '@designflow/boq-cost';
import type { BuildingModelV2 } from '@designflow/shared';
import { Budget, area2, areaString, atLeast, absB, contains, coverage, floorDistance, gcd, isSimple, minRational, segmentDistance2, segmentsOf, shapeIsRectilinear,
  unionArea2, type Shape } from './geometry.js';
import { CHECK_ASSUMPTIONS, NOT_CLAIMED_VERIFICATION, SEVERITY_BY_STATUS, VERIFICATION_LIMITS, VERIFIER_VERSION, VerificationReportSchema, type Check, type VerificationReport } from './contracts.js';

type Level = BuildingModelV2['levels'][number];
type Limits = { maxCoverageRatio?: number | undefined; maxFar?: number | undefined };
type Method = 'RECTILINEAR_SLAB_UNION' | 'LEVEL_BOUNDARY_FALLBACK' | 'LEVEL_BOUNDARY_NO_FLOOR_SLABS';

/** Reduced fraction of two doubled areas plus a HALF_UP_4 decimal. */
export function ratio(num2: bigint, den2: bigint) {
  const g = gcd(num2, den2) || 1n, n = num2 / g, d = den2 / g;
  const scaled = (n * 20000n + d) / (2n * d); // round half up at 4 decimals
  return { numerator: n.toString(), denominator: d.toString(), decimal: `${scaled / 10000n}.${(scaled % 10000n).toString().padStart(4, '0')}`, rounding: 'HALF_UP_4' as const };
}
/** A declared decimal limit as an exact fraction over 10 000 (limits are validated as multiples of 0.0001). */
const limitFraction = (value: number) => BigInt(Math.round(value * 10_000));

export function verifyModel(model: BuildingModelV2, ids: { projectId: string; revisionId: string; modelHash: string }, declaredLimits: Limits | null): VerificationReport {
  const budget = new Budget(VERIFICATION_LIMITS.cellOperations), checks: Check[] = [];
  const add = (checkId: Check['checkId'], status: Check['status'], entityIds: string[], detail: string, measured: string | null = null, required: string | null = null) =>
    checks.push({ checkId, status, severity: SEVERITY_BY_STATUS[status], entityIds: entityIds.slice(0, 16), measured, required, detail,
      assumptions: [...CHECK_ASSUMPTIONS[checkId]] });
  const storeys = model.levels.filter(l => l.kind === 'storey').sort((a, b) => a.elevationMm - b.elevationMm || a.index - b.index);
  const plateLevels = storeys.length ? storeys : [...model.levels].sort((a, b) => a.elevationMm - b.elevationMm);
  const floorSlabs = (level: Level): Shape[] => model.slabs.filter(s => s.levelId === level.id && s.kind === 'floor').map(s => ({ outer: s.footprint.outer, voids: s.footprint.voids }));
  const boundaryShape = (level: Level): Shape => ({ outer: level.boundary, voids: [] });
  /** The floor plates that physically carry a level: its floor slabs when present, otherwise its plan envelope. */
  const carrier = (level: Level) => { const slabs = floorSlabs(level); return slabs.length ? slabs : [boundaryShape(level)]; };

  // ---- bases --------------------------------------------------------------------------------------------------------
  const plate = (level: Level): { area2: bigint; method: Method } => {
    const slabs = floorSlabs(level);
    if (!slabs.length) return { area2: absB(area2(level.boundary)), method: 'LEVEL_BOUNDARY_NO_FLOOR_SLABS' };
    const union = slabs.every(shapeIsRectilinear) ? unionArea2(slabs, budget) : null;
    return union === null ? { area2: absB(area2(level.boundary)), method: 'LEVEL_BOUNDARY_FALLBACK' } : { area2: union, method: 'RECTILINEAR_SLAB_UNION' };
  };
  const plates = plateLevels.map(level => ({ level, ...plate(level) }));
  const site = model.site, plot2 = site ? absB(area2(site.boundary)) : null;
  const ground = plates[0]!, gfa2 = plates.reduce((s, p) => s + p.area2, 0n);
  const storeyIds = new Set(plateLevels.map(l => l.id));
  const net2 = model.spaces.filter(s => storeyIds.has(s.levelId)).reduce((s, sp) => s + absB(area2(sp.boundary)), 0n);
  const bases = {
    plotAreaMm2: plot2 === null ? null : areaString(plot2), buildableAreaMm2: site?.buildableBoundary ? areaString(area2(site.buildableBoundary)) : null,
    groundCoverage: { levelId: ground.level.id, areaMm2: areaString(ground.area2), method: ground.method },
    levels: plates.map(p => ({ levelId: p.level.id, grossPlateAreaMm2: areaString(p.area2), method: p.method })),
    grossFloorAreaMm2: areaString(gfa2), netSpaceAreaMm2: areaString(net2),
    coverageRatio: plot2 ? ratio(ground.area2, plot2) : null, far: plot2 ? ratio(gfa2, plot2) : null,
    formulas: {
      plotArea: 'Shoelace area of site.boundary (mm², exact)',
      groundCoverage: 'Union area of floor slab footprints (outer minus voids) on the lowest storey; level boundary when absent or non-rectilinear',
      grossPlate: 'Per storey: union area of floor slab footprints; level boundary when absent or non-rectilinear',
      grossFloorArea: 'Sum of gross plates over storey levels',
      netSpaceArea: 'Sum of space boundary areas on storey levels (as modeled; no wall deduction)',
      coverageRatio: 'groundCoverage / plotArea', far: 'grossFloorArea / plotArea (FSI is the same ratio)',
    },
  };

  // ---- site ---------------------------------------------------------------------------------------------------------
  if (!site) add('SITE_POLYGON', 'NOT_APPLICABLE', [], 'No site is supplied; site checks and ratios are not applicable');
  else {
    add('SITE_POLYGON', isSimple(site.boundary) ? 'PASS' : 'FAIL', [site.id], 'Site boundary is a simple polygon with non-zero area');
    if (site.buildableBoundary) add('BUILDABLE_WITHIN_SITE', contains(site.boundary, site.buildableBoundary) ? 'PASS' : 'FAIL', [site.id], 'Buildable boundary lies within the site');
    else add('BUILDABLE_WITHIN_SITE', 'NOT_APPLICABLE', [site.id], 'No buildable boundary is declared');
    const permitted = site.buildableBoundary ?? site.boundary;
    for (const level of plateLevels) add('LEVEL_WITHIN_PERMITTED', contains(permitted, level.boundary) ? 'PASS' : 'FAIL', [level.id],
      site.buildableBoundary ? 'Level envelope lies within the buildable boundary' : 'Level envelope lies within the site boundary');
    const envelope = plateLevels.flatMap(l => segmentsOf(l.boundary));
    for (const setback of site.setbacks) {
      const a = site.boundary[setback.boundaryEdgeStart], b = site.boundary[(setback.boundaryEdgeStart + 1) % site.boundary.length];
      if (!a || !b) { add('SETBACK_DISTANCE', 'FAIL', [site.id, setback.id], 'The setback references a boundary edge that does not exist'); continue; }
      const distance = minRational(envelope.map(([c, d]) => segmentDistance2(a, b, c, d)));
      add('SETBACK_DISTANCE', atLeast(distance, setback.minimumMm) ? 'PASS' : 'FAIL', [site.id, setback.id],
        `Minimum distance from boundary edge ${setback.boundaryEdgeStart} to every storey envelope edge (any polygon; exact squared comparison)`,
        `${floorDistance(distance)} mm`, `${setback.minimumMm} mm`);
    }
  }

  // ---- floor support ------------------------------------------------------------------------------------------------
  const levelById = new Map(model.levels.map(l => [l.id, l]));
  // A stairwell legitimately sits over a slab void: the stair serving that level carries it, so stair footprints count as support.
  const stairsAt = (levelId: string): Shape[] => model.stairs.filter(s => s.fromLevelId === levelId || s.toLevelId === levelId).map(s => ({ outer: s.footprint, voids: [] }));
  for (const space of model.spaces) {
    const level = levelById.get(space.levelId);
    const slabs = level ? floorSlabs(level) : [], support = [...slabs, ...stairsAt(space.levelId)];
    const target: Shape = { outer: space.boundary, voids: [] };
    if (!slabs.length) { add('SPACE_ON_PLATES', 'NOT_EVALUATED', [space.id], 'No floor slab is modeled on this level; physical support is unknown'); continue; }
    if (!shapeIsRectilinear(target) || !support.every(shapeIsRectilinear)) { add('SPACE_ON_PLATES', 'NOT_EVALUATED', [space.id], 'Exact union support is implemented for rectilinear geometry only'); continue; }
    const result = coverage([target], support, budget);
    if (!result) { add('SPACE_ON_PLATES', 'NOT_EVALUATED', [space.id], 'Operation budget exhausted'); continue; }
    add('SPACE_ON_PLATES', result.uncovered2 === 0n ? 'PASS' : 'FAIL', [space.id],
      'Space lies within the union of its level\'s floor slabs (outer minus voids) and the footprints of stairs serving the level',
      `${areaString(result.uncovered2)} mm² unsupported`, '0 mm²');
  }
  for (let k = 1; k < plateLevels.length; k++) {
    const upper = carrier(plateLevels[k]!), lower = carrier(plateLevels[k - 1]!), ids = [plateLevels[k]!.id, plateLevels[k - 1]!.id];
    if (![...upper, ...lower].every(shapeIsRectilinear)) { add('UPPER_PLATE_SUPPORT', 'NOT_EVALUATED', ids, 'Exact overhang is implemented for rectilinear geometry only'); continue; }
    const result = coverage(upper, lower, budget);
    if (!result) { add('UPPER_PLATE_SUPPORT', 'NOT_EVALUATED', ids, 'Operation budget exhausted'); continue; }
    add('UPPER_PLATE_SUPPORT', result.uncovered2 === 0n ? 'PASS' : 'WARNING', ids,
      'Area of this storey\'s plates beyond the plates of the storey below (an overhang needs engineering review; structural adequacy is not claimed)',
      `${areaString(result.uncovered2)} mm² overhang`, null);
  }

  // ---- openings on any host direction -------------------------------------------------------------------------------
  const wallById = new Map(model.walls.map(w => [w.id, w]));
  for (const opening of model.openings) {
    const host = wallById.get(opening.wallId);
    if (!host || host.levelId !== opening.levelId) { add('OPENING_WITHIN_HOST', 'FAIL', [opening.id, opening.wallId], 'The host wall is missing or on another level'); continue; }
    const dx = BigInt(host.path.end.x - host.path.start.x), dz = BigInt(host.path.end.z - host.path.start.z), reach = BigInt(opening.offsetMm + opening.widthMm);
    add('OPENING_WITHIN_HOST', reach * reach <= dx * dx + dz * dz ? 'PASS' : 'FAIL', [opening.id, host.id],
      'offset + width does not exceed the host path length (exact squared comparison; any host direction)', `${opening.offsetMm + opening.widthMm} mm`, null);
  }

  // ---- declared (never statutory) limits ----------------------------------------------------------------------------
  const limits = declaredLimits && Object.keys(declaredLimits).length ? declaredLimits : null;
  const declared = (label: string, num2: bigint, limit: number) => plot2
    ? add('DECLARED_LIMIT', num2 * 10_000n <= limitFraction(limit) * plot2 ? 'PASS' : 'FAIL', [], `${label} against the caller-declared limit (not a statutory determination)`,
      ratio(num2, plot2).decimal, limit.toFixed(4))
    : add('DECLARED_LIMIT', 'NOT_EVALUATED', [], `${label} needs a site plot area`);
  if (limits?.maxCoverageRatio !== undefined) declared('Coverage ratio', ground.area2, limits.maxCoverageRatio);
  if (limits?.maxFar !== undefined) declared('FAR/FSI', gfa2, limits.maxFar);

  const count = (s: Check['status']) => checks.filter(c => c.status === s).length;
  const summary = { pass: count('PASS'), fail: count('FAIL'), warning: count('WARNING'), notEvaluated: count('NOT_EVALUATED'), notApplicable: count('NOT_APPLICABLE') };
  const status = summary.fail ? 'FAILED' : summary.notEvaluated || budget.exhausted ? 'PARTIAL' : summary.warning ? 'VERIFIED_WITH_WARNINGS' : 'VERIFIED';
  return VerificationReportSchema.parse({ verifierVersion: VERIFIER_VERSION, ...ids, inputHash: costHash({ verifierVersion: VERIFIER_VERSION, modelHash: ids.modelHash, declaredLimits: limits }),
    status, bases, checks, summary, declaredLimits: limits,
    budget: { operations: budget.operations, limit: budget.limit, exhausted: budget.exhausted }, claims: { ...NOT_CLAIMED_VERIFICATION } });
}
