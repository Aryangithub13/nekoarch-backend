import { QuantityTakeoffReportSchema, type QuantityItem } from '@designflow/quantity-takeoff';
import { R, type Rational } from './precision.js';
import { CONSTRUCTION_ENGINE_VERSION, CONSTRUCTION_LIMITS, ConstructionError, ConstructionOptionsSchema,
  SUPPORTED_BASES, boundedJson, compare, normalizeConstructionSpecification, type ConstructionSpecification } from './specification.js';
import { CONSTRUCTION_RECIPE_PACK, MATERIAL_UNITS, type MaterialCode } from './recipes.js';
import { ConstructionReportSchema, type ConstructionReport, type CalculationItem, type Material, type MaterialTotal } from './report.js';

type Assignment = ConstructionSpecification['assignments'][number];
const priority = { entity: 5, specification: 4, classification: 3, level: 2, default: 1 };
const zero = () => R('0');
function fail(message: string): never { throw new ConstructionError('CONSTRUCTION_SPEC_INVALID', message); }
function limit(condition: boolean) { if (condition) throw new ConstructionError('CONSTRUCTION_RESOURCE_LIMIT', 'Construction calculation resource limit exceeded'); }
function matches(a: Assignment, item: QuantityItem) {
  const s = a.selector;
  switch (s.kind) {
    case 'default': return true;
    case 'entity': return item.sourceEntityIds[0] === s.value;
    case 'specification': return item.specificationId === s.value;
    case 'classification': return item.classification === s.value;
    case 'level': return item.levelId === s.value;
  }
}
function totals(materials: Material[], places: number): MaterialTotal[] {
  const grouped = new Map<string, Material[]>();
  for (const m of materials) { const group = grouped.get(m.materialCode) ?? []; group.push(m); grouped.set(m.materialCode, group); }
  return [...grouped].sort(([a],[b]) => compare(a,b)).map(([code, lines]) => {
    let theoretical = zero(), wastage = zero(), final = zero();
    const purchases = new Map<string, { unit: 'bag'|'piece'|'each'; bagMassKg: string|null; quantity: bigint }>();
    for (const m of lines) {
      theoretical = theoretical.add(R(m.theoretical)); wastage = wastage.add(R(m.wastage)); final = final.add(R(m.final));
      if (m.purchase) {
        const key = `${m.purchase.unit}:${m.purchase.bagMassKg ?? ''}`, old = purchases.get(key);
        purchases.set(key, { unit: m.purchase.unit, bagMassKg: m.purchase.bagMassKg, quantity: (old?.quantity ?? 0n) + BigInt(m.purchase.quantity) });
      }
    }
    return { materialCode: code as MaterialCode, unit: MATERIAL_UNITS[code as MaterialCode], theoretical: theoretical.decimal(places),
      wastage: wastage.decimal(places), final: final.decimal(places), purchases: [...purchases].sort(([a],[b])=>compare(a,b)).map(([,p])=>({...p,quantity:p.quantity.toString()})) };
  });
}

/** Pure material recipes over authoritative takeoff quantities; no inferred specifications or prices. */
export function calculateConstruction(takeoffInput: unknown, specificationInput: unknown, optionsInput: unknown = {}): ConstructionReport {
  boundedJson(takeoffInput, CONSTRUCTION_LIMITS.takeoffBytes);
  const parsed = QuantityTakeoffReportSchema.safeParse(takeoffInput);
  if (!parsed.success) throw new ConstructionError('TAKEOFF_NOT_ACCEPTED', 'Expected a supported quantity takeoff report');
  const takeoff = parsed.data, specification = normalizeConstructionSpecification(specificationInput);
  const optionsResult = ConstructionOptionsSchema.safeParse(optionsInput);
  if (!optionsResult.success) fail('Invalid construction calculation options');
  const options = optionsResult.data, places = options.quantityDecimalPlaces;
  if (specification.recipePack.id !== CONSTRUCTION_RECIPE_PACK.id || specification.recipePack.version !== CONSTRUCTION_RECIPE_PACK.version)
    throw new ConstructionError('CONSTRUCTION_RECIPE_NOT_FOUND', 'Unknown construction recipe pack');
  if (new Set(takeoff.items.map(i=>i.id)).size !== takeoff.items.length) fail('Duplicate takeoff item identity');
  const sourceBases = new Set<string>();
  for (const item of takeoff.items) {
    const key = JSON.stringify([item.itemCode,item.sourceEntityIds[0]]);
    if (sourceBases.has(key)) fail('Duplicate takeoff source basis');
    sourceBases.add(key);
  }
  const assemblies = new Map(specification.assemblies.map(a=>[a.id,a]));
  const items: CalculationItem[] = [], materials: Material[] = [], warnings: ConstructionReport['warnings'] = [];
  const coverage: ConstructionReport['coverage'] = takeoff.coverage.map(c=>({category:`upstream:${c.category}`,status:c.status,reason:c.reason,itemCount:c.entityCount}));
  let work = 0;
  const basisCounts = new Map<string, { eligible: number; evaluated: number; partial: boolean }>();
  for (const basis of SUPPORTED_BASES) basisCounts.set(basis,{eligible:0,evaluated:0,partial:false});
  for (const item of [...takeoff.items].sort((a,b)=>compare(a.id,b.id))) {
    const count = basisCounts.get(item.itemCode);
    if (!count) continue;
    count.eligible++;
    const layers = new Map<string, Assignment[]>();
    for (const assignment of specification.assignments) {
      limit(++work > CONSTRUCTION_LIMITS.matchingWork);
      if (assignment.basis !== item.itemCode || !matches(assignment,item)) continue;
      const key = JSON.stringify([assemblies.get(assignment.assemblyId)!.kind,assignment.layerId]);
      const candidates = layers.get(key) ?? []; candidates.push(assignment); layers.set(key,candidates);
    }
    if (!layers.size || item.status === 'NOT_EVALUATED') { warnings.push({code:'UNASSIGNED_OR_UNSUPPORTED_BASIS',takeoffItemId:item.id}); continue; }
    const selected: Assignment[] = [];
    for (const candidates of layers.values()) {
      candidates.sort((a,b)=>priority[b.selector.kind]-priority[a.selector.kind]);
      if (candidates.length > 1 && priority[candidates[0]!.selector.kind] === priority[candidates[1]!.selector.kind]) fail('Ambiguous equal-precedence assignment');
      selected.push(candidates[0]!);
    }
    const families = new Map<string,number>();
    for (const a of selected) { const kind = assemblies.get(a.assemblyId)!.kind; families.set(kind,(families.get(kind) ?? 0)+1); }
    if (!specification.allowMultipleLayers && [...families.values()].some(n=>n>1)) fail('Multiple physical layers require allowMultipleLayers');
    count.evaluated++;
    for (const assignment of selected.sort((a,b)=>compare(a.id,b.id))) {
      limit(items.length >= CONSTRUCTION_LIMITS.calculations);
      const assembly = assemblies.get(assignment.assemblyId)!;
      const recipe = CONSTRUCTION_RECIPE_PACK.recipes.find(r=>r.kind===assembly.kind)!;
      const id = `calculation-${items.length+1}`;
      const calculation: CalculationItem = { id,takeoffItemId:item.id,takeoffItemCode:item.itemCode,sourceEntityIds:[...item.sourceEntityIds],
        levelId:item.levelId,specificationId:item.specificationId,assemblyId:assembly.id,layerId:assignment.layerId,assignmentId:assignment.id,
        recipeId:recipe.id,status:item.status==='PARTIAL'||recipe.status==='PARTIAL'?'PARTIAL':'EVALUATED',
        basis:{value:item.quantity.value,unit:item.quantity.unit as 'mm2'|'mm3'|'each'},evidence:{},
        assumptions:[...item.assumptions,recipe.assumption,...(assignment.selector.kind==='default'?['Explicit default assignment applied.']:[])] };
      function emit(code: MaterialCode, quantity: Rational, bagMass?: string, coatingId: string|null = null) {
        limit(materials.length >= CONSTRUCTION_LIMITS.materials);
        const adjusted = quantity.mul(R('1').add(R(assembly.wastagePercent).div(R('100'))));
        const theoretical = quantity.decimal(places), final = adjusted.decimal(places), unit = MATERIAL_UNITS[code];
        const purchaseUnit = bagMass ? 'bag' : unit==='piece'||unit==='each' ? unit : null;
        const divisor = R(bagMass ?? '1');
        materials.push({ id:`material-${materials.length+1}`, calculationItemId:id,coatingId,materialCode:code,unit,theoretical,final,
          wastage:R(final).sub(R(theoretical)).decimal(places),theoreticalExact:quantity.exact(),finalExact:adjusted.exact(),
          purchase:purchaseUnit ? {unit:purchaseUnit,quantity:adjusted.div(divisor).ceil().toString(),bagMassKg:bagMass ?? null,
            theoreticalEquivalent:quantity.div(divisor).decimal(places),adjustedEquivalent:adjusted.div(divisor).decimal(places)} : null });
      }
      function mix(wetM3: Rational, data: { dryVolumeFactor:string;cementParts:string;sandParts:string;cementBulkDensityKgPerM3:string;bagMassKg:string;coarseAggregateParts?:string }) {
        const dry = wetM3.mul(R(data.dryVolumeFactor)), total = R(data.cementParts).add(R(data.sandParts)).add(R(data.coarseAggregateParts ?? '0'));
        calculation.evidence.wetVolumeM3 = wetM3.exact(); calculation.evidence.dryVolumeM3 = dry.exact(); calculation.evidence.totalMixParts = total.exact();
        emit('CEMENT',dry.mul(R(data.cementParts)).div(total).mul(R(data.cementBulkDensityKgPerM3)),data.bagMassKg);
        emit('SAND',dry.mul(R(data.sandParts)).div(total));
        if (data.coarseAggregateParts) emit('COARSE_AGGREGATE',dry.mul(R(data.coarseAggregateParts)).div(total));
      }
      const value = R(item.quantity.value);
      switch (assembly.kind) {
        case 'masonry': {
          if (item.thicknessMm !== assembly.unitDepthMm) fail('Masonry thickness must equal configured unit depth');
          const module = R(assembly.unitLengthMm).add(R(assembly.longitudinalJointMm)).mul(R(assembly.unitHeightMm).add(R(assembly.bedJointMm))).mul(R(assembly.unitDepthMm));
          const units = value.div(module), envelope = R(assembly.unitLengthMm).mul(R(assembly.unitHeightMm)).mul(R(assembly.unitDepthMm));
          const wet = value.sub(units.mul(envelope)).div(R('1000000000'));
          calculation.evidence.moduleVolumeMm3 = module.exact(); calculation.evidence.unitEnvelopeMm3 = envelope.exact(); calculation.evidence.wetMortarM3 = wet.exact();
          emit(assembly.materialCode,units);
          if (assembly.mortar) mix(wet,assembly.mortar);
          else { calculation.assumptions.push('Mortar is not evaluated without a configured mix.'); warnings.push({code:'MORTAR_NOT_EVALUATED',takeoffItemId:item.id}); }
          break;
        }
        case 'plaster': mix(value.mul(R(assembly.sides)).mul(R(assembly.thicknessMm)).div(R('1000000000')),assembly.mix); break;
        case 'flooring': emit('FLOOR_TILE',value.div(R(assembly.tileLengthMm).mul(R(assembly.tileWidthMm)))); break;
        case 'paint':
          for (const coating of assembly.coatings) {
            const quantity = value.div(R('1000000')).mul(R(assembly.sides)).mul(R(coating.coats)).div(R(coating.coverageM2PerUnit));
            calculation.evidence[`coating:${coating.id}`] = quantity.exact(); emit(coating.materialCode,quantity,undefined,coating.id);
          }
          break;
        case 'concrete':
          if (assembly.mode.type === 'READY_MIX_VOLUME_ONLY') emit('READY_MIX_CONCRETE',value.div(R('1000000000')));
          else mix(value.div(R('1000000000')),assembly.mode.mix);
          break;
        case 'component': emit(assembly.materialCode,value); break;
      }
      if (calculation.status==='PARTIAL') count.partial = true;
      items.push(calculation);
    }
  }
  for (const [category,c] of basisCounts) coverage.push({ category,status:c.evaluated===0?'NOT_EVALUATED':c.evaluated<c.eligible||c.partial?'PARTIAL':'EVALUATED',
    reason:c.eligible===0?'No represented quantity basis.':`${c.evaluated} of ${c.eligible} bases assigned and evaluated.`,itemCount:c.eligible });
  for (const category of ['STRUCTURAL_REINFORCEMENT','FOUNDATIONS_EXCAVATION','MEP','STRUCTURAL_STAIRS','CEILINGS','WATERPROOFING','PITCHED_ROOFS','ADHESIVE_GROUT','HARDWARE_GLAZING','CUTTING_OPTIMIZATION'])
    coverage.push({category,status:'NOT_EVALUATED',reason:'Outside supported construction recipes.',itemCount:0});
  limit(warnings.length > CONSTRUCTION_LIMITS.warnings);
  const sections: ConstructionReport['sections'] = [];
  const materialByItem = new Map<string,Material[]>();
  for (const m of materials) { const group = materialByItem.get(m.calculationItemId) ?? []; group.push(m); materialByItem.set(m.calculationItemId,group); }
  for (const dimension of ['level','assembly','specification'] as const) {
    const groups = new Map<string|null,Material[]>();
    for (const i of items) {
      const key = dimension==='level'?i.levelId:dimension==='assembly'?i.assemblyId:i.specificationId;
      const group = groups.get(key) ?? []; group.push(...(materialByItem.get(i.id) ?? [])); groups.set(key,group);
    }
    for (const [key,lines] of [...groups].sort(([a],[b])=>compare(a ?? '',b ?? ''))) {
      limit(sections.length >= CONSTRUCTION_LIMITS.sections); sections.push({dimension,key,totals:totals(lines,places)});
    }
  }
  const report: ConstructionReport = { engineVersion:CONSTRUCTION_ENGINE_VERSION,takeoffEngineVersion:takeoff.engineVersion,
    measurementPolicyVersion:takeoff.measurementPolicyVersion,recipePack:{id:CONSTRUCTION_RECIPE_PACK.id,version:CONSTRUCTION_RECIPE_PACK.version},specification,options,
    summary:{calculationCount:items.length,materialCount:materials.length,warningCount:warnings.length,status:items.length===0?'NOT_EVALUATED':coverage.some(c=>c.status!=='EVALUATED')?'PARTIAL':'EVALUATED',totals:totals(materials,places)},
    items,materials,sections,coverage,warnings };
  boundedJson(report,CONSTRUCTION_LIMITS.reportBytes);
  return ConstructionReportSchema.parse(report);
}
