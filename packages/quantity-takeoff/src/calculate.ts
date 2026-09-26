import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2 } from '@designflow/shared';
import { ITEM_UNITS, LIMITS, MEASUREMENT_POLICY_VERSION, TAKEOFF_ENGINE_VERSION, TakeoffError, TakeoffOptionsSchema,
  QuantityTakeoffReportSchema, type ItemCode, type QuantityItem, type QuantityTakeoffReport, type TakeoffOptions } from './report.js';
import { area, decimal, doubled, length, perimeter, plateArea, quantity } from './precision.js';

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const assumptions = [
  { code: 'SEGMENT_PRISM', description: 'Wall prisms are summed independently. T/cross/corner junction overlaps are not unioned; this is not physical masonry union volume.' },
  { code: 'SINGLE_LONGITUDINAL_FACE', description: 'One longitudinal wall face; no reveals, end/top faces or finish assembly assignment. Classification does not assign a face to interior/exterior finishes.' },
  { code: 'CENTERLINE_SPACE', description: 'Space polygons use wall centerlines, not net usable finished boundaries. Floor finish basis is an alternative use of the same area; do not add these bases.' },
  { code: 'PLATE_MINUS_VOIDS', description: 'Explicit plate outer area minus disjoint modeled voids. Floor, flat roof and ceiling plates are separate categories; no implicit ceiling assembly is invented.' },
  { code: 'GEOMETRIC_GFA', description: 'Sum of floor-plate net areas only. No statutory FAR/FSI interpretation.' },
  { code: 'ARCHITECTURAL_GEOMETRY', description: 'Columns/stairs are architectural geometry, not structural design. Intersections between different entity types are not boolean-unioned.' },
  { code: 'SPECIFICATION_UNKNOWN', description: 'Null specificationId means unknown; no material or assembly is inferred.' },
  { code: 'DIAGONAL_NEAREST_MM', description: 'Irrational segment lengths round per segment to nearest mm, ties upward, before dependent face/volume quantities. Exact polygon areas are not rounded.' },
  { code: 'DISPLAY_ONLY', description: 'SI display values round half upward at the configured precision. Base-unit decimal strings control aggregation.' },
];
function jsonBytes(value: unknown): number {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TakeoffError('INVALID_BUILDING_MODEL', 'Expected a JSON document');
  let bytes = 0;
  for (const character of text) { const n = character.codePointAt(0)!; bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4; }
  return bytes;
}
function preflight(input: unknown) {
  let bytes;
  try { bytes = jsonBytes(input); } catch { throw new TakeoffError('INVALID_BUILDING_MODEL', 'Expected a JSON-safe document'); }
  if (bytes > LIMITS.inputBytes) throw new TakeoffError('RESOURCE_LIMIT_EXCEEDED', 'Input size limit exceeded');
  if (!input || typeof input !== 'object') return;
  const collections = ['levels','spaces','walls','openings','slabs','columns','stairs','dimensions','specifications'];
  const sizes = collections.map(key => { const value = (input as Record<string, unknown>)[key]; return Array.isArray(value) ? value.length : 0; });
  if (sizes.reduce((a,b) => a+b, 0) > LIMITS.entities || sizes.reduce((a,b) => a+b*b, 0) > LIMITS.pairs) {
    throw new TakeoffError('RESOURCE_LIMIT_EXCEEDED', 'Entity/validation work limit exceeded');
  }
  let vertices = 0, geometryWork = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (value[0] && typeof value[0] === 'object' && 'x' in value[0] && 'z' in value[0]) { vertices += value.length; geometryWork += value.length ** 2; }
      value.forEach(visit);
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(input);
  if (vertices > LIMITS.vertices || geometryWork > LIMITS.pairs) throw new TakeoffError('RESOURCE_LIMIT_EXCEEDED', 'Geometry validation work limit exceeded');
}

export function calculateQuantityTakeoff(input: unknown, options: TakeoffOptions = {}): QuantityTakeoffReport {
  preflight(input);
  if (input && typeof input === 'object' && 'completeness' in input && input.completeness === 'legacy-planar') {
    throw new TakeoffError('INCOMPLETE_MODEL', 'Complete architectural geometry is required');
  }
  const parsed = ArchitecturalBuildingModelV2Schema.safeParse(input);
  if (!parsed.success) throw new TakeoffError('INVALID_BUILDING_MODEL', 'Building Model V2 validation failed');
  const parsedOptions = TakeoffOptionsSchema.safeParse(options);
  if (!parsedOptions.success) throw new TakeoffError('INVALID_TAKEOFF_OPTIONS', 'Invalid measurement options');
  const model: BuildingModelV2 = parsed.data, normalizedOptions = parsedOptions.data, places = normalizedOptions.displayDecimalPlaces;
  const items: QuantityItem[] = [], warnings: QuantityTakeoffReport['warnings'] = [];
  const warn = (code: string, ids: string[] = []) => warnings.push({ code, sourceEntityIds: ids });
  type Source = { id: string; levelId?: string; specificationId?: string | undefined; classification?: string; thicknessMm?: number | null };
  const add = (itemCode: ItemCode, value: bigint, source: Source, category: QuantityItem['category'], evidence: QuantityItem['evidence'], assumptionCodes: string[] = [], rounded = false, extraSourceId?: string) => {
    if (items.length >= LIMITS.items) throw new TakeoffError('RESOURCE_LIMIT_EXCEEDED', 'Item limit exceeded');
    items.push({ id: `${itemCode}:${source.id}`, itemCode, category, quantity: quantity(value, ITEM_UNITS[itemCode], places),
      sourceEntityIds: extraSourceId ? [source.id, extraSourceId] : [source.id], levelId: source.levelId ?? null, specificationId: source.specificationId ?? null,
      classification: source.classification ?? null, thicknessMm: source.thicknessMm ?? null, evidence,
      assumptions: [...assumptionCodes, ...(rounded ? ['DIAGONAL_NEAREST_MM'] : [])], status: rounded ? 'PARTIAL' : 'EVALUATED' });
  };
  const byHost = new Map<string, { area: bigint; count: number }>();
  const schedules: QuantityTakeoffReport['schedules'] = { entries: [], groups: [] };
  for (const opening of model.openings) {
    const a = BigInt(opening.widthMm) * BigInt(opening.heightMm) * 2n;
    const existing = byHost.get(opening.wallId) ?? { area: 0n, count: 0 };
    byHost.set(opening.wallId, { area: existing.area + a, count: existing.count + 1 });
    const prefix = opening.kind === 'door' ? 'DOOR' : opening.kind === 'window' ? 'WINDOW' : 'OPENING';
    const source = { ...opening, classification: opening.type };
    const evidence = { widthMm: opening.widthMm, heightMm: opening.heightMm, sillMm: opening.sillMm, wallId: opening.wallId };
    add(`${prefix}_COUNT`, 2n, source, 'OPENING', evidence, [], false, opening.wallId);
    add(`${prefix}_AREA`, a, source, 'OPENING', evidence, [], false, opening.wallId);
    schedules.entries.push({ id: opening.id, kind: opening.kind, levelId: opening.levelId, wallId: opening.wallId,
      widthMm: opening.widthMm, heightMm: opening.heightMm, sillMm: opening.sillMm, type: opening.type,
      operation: opening.kind === 'door' ? opening.operation.kind : opening.kind === 'opening' ? opening.purpose : null,
      specificationId: opening.specificationId ?? null, area: quantity(a, 'mm2', places) });
  }
  for (const wall of model.walls) {
    const measured = length(wall.path), height = BigInt(wall.heightMm!), thickness = BigInt(wall.thicknessMm!);
    const openings = byHost.get(wall.id) ?? { area: 0n, count: 0 };
    const grossFace = measured.mm * height * 2n, netFace = grossFace - openings.area;
    const evidence = { lengthMm: measured.mm.toString(), thicknessMm: wall.thicknessMm, heightMm: wall.heightMm,
      openingCount: openings.count, openingAreaMm2: decimal(openings.area), grossFaceAreaMm2: decimal(grossFace),
      grossVolumeMm3: decimal(grossFace * thickness), openingVolumeMm3: decimal(openings.area * thickness) };
    if (measured.rounded) warn('TAKEOFF_DIAGONAL_ROUNDING', [wall.id]);
    add('WALL_CENTERLINE_LENGTH', measured.mm * 2n, wall, 'WALL', evidence, [], measured.rounded);
    add('WALL_SEGMENT_GROSS_VOLUME', grossFace * thickness, wall, 'WALL', evidence, ['SEGMENT_PRISM'], measured.rounded);
    add('WALL_OPENING_VOLUME', openings.area * thickness, wall, 'WALL', evidence, ['SEGMENT_PRISM']);
    add('WALL_SEGMENT_NET_VOLUME', netFace * thickness, wall, 'WALL', evidence, ['SEGMENT_PRISM'], measured.rounded);
    add('WALL_SINGLE_FACE_GROSS_AREA', grossFace, wall, 'WALL', evidence, ['SINGLE_LONGITUDINAL_FACE'], measured.rounded);
    add('WALL_SINGLE_FACE_OPENING_AREA', openings.area, wall, 'WALL', evidence, ['SINGLE_LONGITUDINAL_FACE']);
    add('WALL_SINGLE_FACE_NET_AREA', netFace, wall, 'WALL', evidence, ['SINGLE_LONGITUDINAL_FACE'], measured.rounded);
  }
  if (model.walls.length) warn('TAKEOFF_WALL_JUNCTION_OVERLAP_POLICY');
  for (const space of model.spaces) {
    const a = area(space.boundary), p = perimeter(space.boundary), evidence = { areaMm2: decimal(a), boundaryBasis: space.boundaryBasis };
    add('SPACE_FLOOR_AREA', a, space, 'SPACE', evidence, ['CENTERLINE_SPACE']);
    add('FLOOR_FINISH_BASE_AREA', a, space, 'SPACE', evidence, ['CENTERLINE_SPACE']);
    add('SPACE_PERIMETER', p.mm * 2n, space, 'SPACE', { perimeterMm: p.mm.toString() }, ['CENTERLINE_SPACE'], p.rounded);
    if (p.rounded) warn('TAKEOFF_DIAGONAL_ROUNDING', [space.id]);
  }
  for (const slab of model.slabs) {
    const a = plateArea(slab.footprint), prefix = slab.kind === 'floor' ? 'FLOOR_PLATE' : slab.kind === 'flat-roof' ? 'ROOF' : 'CEILING_PLATE';
    const evidence = { grossAreaMm2: decimal(a.gross), voidAreaMm2: decimal(a.voids), netAreaMm2: decimal(a.net), thicknessMm: slab.thicknessMm, voidCount: slab.footprint.voids.length };
    const source = { ...slab, classification: slab.kind };
    add(`${prefix}_GROSS_AREA`, a.gross, source, 'PLATE', evidence, ['PLATE_MINUS_VOIDS']);
    add(`${prefix}_VOID_AREA`, a.voids, source, 'PLATE', evidence, ['PLATE_MINUS_VOIDS']);
    add(`${prefix}_NET_AREA`, a.net, source, 'PLATE', evidence, ['PLATE_MINUS_VOIDS']);
    add(`${prefix}_VOLUME`, a.net * BigInt(slab.thicknessMm), source, 'PLATE', evidence, ['PLATE_MINUS_VOIDS']);
    if (slab.kind === 'floor') add('GEOMETRIC_GROSS_FLOOR_AREA', a.net, source, 'PLATE', evidence, ['GEOMETRIC_GFA']);
  }
  for (const stair of model.stairs) {
    const source = { ...stair, levelId: stair.fromLevelId }, evidence = { fromLevelId: stair.fromLevelId, toLevelId: stair.toLevelId,
      riserCount: stair.riserHeightsMm.length, treadDepthMm: stair.treadDepthMm, riseMm: stair.riseMm, runMm: stair.runMm, widthMm: stair.widthMm };
    const values: [ItemCode, bigint][] = [['STAIR_FLIGHT_COUNT', 2n], ['STAIR_RISER_COUNT', BigInt(stair.riserHeightsMm.length)*2n],
      ['STAIR_TREAD_COUNT', BigInt(stair.riserHeightsMm.length-1)*2n], ['STAIR_RISE', BigInt(stair.riseMm)*2n], ['STAIR_RUN', BigInt(stair.runMm)*2n],
      ['STAIR_WIDTH', BigInt(stair.widthMm)*2n], ['STAIR_FOOTPRINT_AREA', area(stair.footprint)]];
    for (const [code,value] of values) add(code,value,source,'STAIR',evidence,['ARCHITECTURAL_GEOMETRY']);
    for (const landing of stair.landings) add('STAIR_LANDING_AREA', area(landing.footprint), { ...source, id: landing.id,
      levelId: landing.elevationOffsetMm === 0 ? stair.fromLevelId : stair.toLevelId }, 'STAIR', { stairId: stair.id, elevationOffsetMm: landing.elevationOffsetMm }, ['ARCHITECTURAL_GEOMETRY'], false, stair.id);
  }
  for (const column of model.columns) {
    const a = plateArea(column.crossSection), evidence = { crossSectionAreaMm2: decimal(a.net), heightMm: column.heightMm };
    add('COLUMN_COUNT',2n,column,'COLUMN',evidence,['ARCHITECTURAL_GEOMETRY']);
    add('COLUMN_CROSS_SECTION_AREA',a.net,column,'COLUMN',evidence,['ARCHITECTURAL_GEOMETRY']);
    add('COLUMN_HEIGHT',BigInt(column.heightMm)*2n,column,'COLUMN',evidence,['ARCHITECTURAL_GEOMETRY']);
    add('COLUMN_GEOMETRIC_VOLUME',a.net*BigInt(column.heightMm),column,'COLUMN',evidence,['ARCHITECTURAL_GEOMETRY']);
  }
  if (model.site) {
    add('SITE_AREA',area(model.site.boundary),model.site,'SITE',{ source: 'site.boundary' });
    if (model.site.buildableBoundary) add('BUILDABLE_AREA',area(model.site.buildableBoundary),model.site,'SITE',{ source: 'site.buildableBoundary' });
  }
  for (const level of model.levels) add('LEVEL_ENVELOPE_AREA',area(level.boundary),{ ...level, levelId: level.id, classification: level.kind },'LEVEL',{ source: 'level.boundary' });
  for (const entity of [...model.walls,...model.openings,...model.spaces,...model.slabs,...model.stairs,...model.columns]) {
    if (!entity.specificationId) warn('TAKEOFF_SPECIFICATION_UNKNOWN',[entity.id]);
  }
  warn('TAKEOFF_PARTIAL_CEILING_BASIS');
  items.sort((a,b) => compare(a.id,b.id));
  warnings.sort((a,b) => compare(`${a.code}:${a.sourceEntityIds.join(':')}`,`${b.code}:${b.sourceEntityIds.join(':')}`));
  const aggregate = (members: QuantityItem[]) => {
    const map = new Map<ItemCode, { value: bigint; count: number; partial: boolean }>();
    for (const item of members) {
      const previous = map.get(item.itemCode) ?? { value: 0n, count: 0, partial: false };
      map.set(item.itemCode, { value: previous.value + doubled(item.quantity.value), count: previous.count+1, partial: previous.partial || item.status !== 'EVALUATED' });
    }
    return [...map].sort(([a],[b]) => compare(a,b)).map(([itemCode, total]) => ({ itemCode, quantity: quantity(total.value,ITEM_UNITS[itemCode],places),
      itemCount: total.count, status: total.partial ? 'PARTIAL' as const : 'EVALUATED' as const }));
  };
  const sections: QuantityTakeoffReport['sections'] = [{ dimension: 'project', key: model.id, totals: aggregate(items) }];
  for (const dimension of ['level','specification','classification','thickness'] as const) {
    const groups = new Map<string | null, QuantityItem[]>();
    for (const item of items) {
      if (dimension === 'thickness' && item.category !== 'WALL') continue;
      const key = dimension === 'level' ? item.levelId : dimension === 'specification' ? item.specificationId : dimension === 'classification' ? item.classification : String(item.thicknessMm);
      const group = groups.get(key) ?? []; group.push(item); groups.set(key,group);
    }
    for (const [key,members] of [...groups].sort(([a],[b]) => compare(a ?? '',b ?? ''))) sections.push({ dimension,key,totals: aggregate(members) });
  }
  schedules.entries.sort((a,b) => compare(a.id,b.id));
  const scheduleGroups = new Map<string, QuantityTakeoffReport['schedules']['groups'][number]>();
  for (const entry of schedules.entries) {
    const { kind,widthMm,heightMm,type,operation,specificationId } = entry;
    const key = JSON.stringify([kind,widthMm,heightMm,type,operation,specificationId]);
    const old = scheduleGroups.get(key), count = (old?.count ?? 0)+1;
    scheduleGroups.set(key,{kind,widthMm,heightMm,type,operation,specificationId,count,area:quantity(BigInt(widthMm)*BigInt(heightMm)*BigInt(count)*2n,'mm2',places)});
  }
  schedules.groups = [...scheduleGroups].sort(([a],[b]) => compare(a,b)).map(([,group]) => group);
  const coverage: QuantityTakeoffReport['coverage'] = [];
  const cover = (category: string, count: number, partial: boolean, reason: string) => coverage.push({category,entityCount:count,status:count ? partial ? 'PARTIAL' : 'EVALUATED' : 'NOT_EVALUATED',reason});
  cover('wall_centerline_and_segment_prism',model.walls.length,items.some(i => i.category === 'WALL' && i.status === 'PARTIAL'),'Explicit wall segments; junction overlap policy applies');
  cover('wall_union_solid',model.walls.length,true,'No boolean union; segment-prism basis only');
  cover('single_wall_faces',model.walls.length,items.some(i => i.category === 'WALL' && i.status === 'PARTIAL'),'One longitudinal face, no finish assignment');
  cover('spaces',model.spaces.length,items.some(i => i.category === 'SPACE' && i.status === 'PARTIAL'),'Centerline-space area and perimeter');
  cover('floor_plates',model.slabs.filter(s => s.kind === 'floor').length,false,'Explicit net floor plates and geometric GFA');
  cover('flat_roofs',model.slabs.filter(s => s.kind === 'flat-roof').length,false,'Explicit flat-roof plates only');
  cover('ceiling_plates',model.slabs.filter(s => s.kind === 'ceiling').length,false,'Explicit ceiling plates only');
  cover('openings',model.openings.length,false,'Hosted door/window/generic entities counted and deducted once');
  cover('stairs',model.stairs.length,false,'Explicit straight flights and landings, no physical solids');
  cover('columns',model.columns.length,false,'Architectural column geometry only');
  cover('site',model.site ? 1 : 0,false,'Explicit site boundary');
  cover('buildable_area',model.site?.buildableBoundary ? 1 : 0,false,'Explicit buildable boundary only');
  cover('level_envelopes',model.levels.length,false,'Plan envelopes, not physical plates');
  for (const category of ['implicit_ceiling_finish','pitched_roofs','building_footprint_union','structural_engineering','mep','material_recipes','prices']) cover(category,0,false,'Not represented/evaluated by this measurement policy');
  const report = { engineVersion: TAKEOFF_ENGINE_VERSION, modelSchemaVersion: 2 as const, measurementPolicyVersion: MEASUREMENT_POLICY_VERSION,
    options: normalizedOptions, summary: { itemCount:items.length,warningCount:warnings.length,totals:sections[0]!.totals }, sections,items,schedules,warnings,coverage,assumptions };
  if (warnings.length > LIMITS.warnings || sections.length > LIMITS.sections || jsonBytes(report) > LIMITS.reportBytes) throw new TakeoffError('RESOURCE_LIMIT_EXCEEDED','Report size limit exceeded');
  return QuantityTakeoffReportSchema.parse(report);
}
