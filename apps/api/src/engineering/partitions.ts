import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2 } from '@designflow/shared';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { TAKEOFF_ENGINE_VERSION, TakeoffError, calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { costHash } from '@designflow/boq-cost';
import { modelHash } from '../lib/generation-identity.js';
import { verifyModel } from '../verification/verify.js';
import { VERIFIER_VERSION } from '../verification/contracts.js';
import { projectBim } from '../bim/project.js';
import { validateBim } from '../bim/validate.js';
import { BIM_VERSION, BimError } from '../bim/contracts.js';
import { digest } from '../bim/core.js';
import { bimProfile } from './capability-limits.js';
import { FORMULAS } from './contracts.js';
import { areaString, doubled, grossVolume2 } from './geometry.js';
import { ZoneRequestError, canonicalDeclarations, prepare, zoneId, type ZoneContext } from './zones.js';
import { NOT_CLAIMED_PARTITIONS, PARTITION_LIMITS, PARTITION_VERSION, PartitionReportSchema, type Partition, type PartitionReport, type PartitionRequest } from './partition-contracts.js';

type Model = BuildingModelV2;
type Dimension = Model['dimensions'][number];
const COLLECTIONS = ['levels', 'spaces', 'walls', 'openings', 'slabs', 'columns', 'stairs', 'dimensions'] as const;

export const PARTITION_LIMITATIONS = [
  'A partition is a zone\'s storeys, any datum or roof level up to the next zone\'s lowest storey, and every entity on those levels. A stair crossing a zone boundary belongs to both zones, so it is listed as an interface element and processed in neither.',
  'Per-partition QA uses the BIM source options: entrance reachability is not evaluated, because only the lowest partition holds the entrance. The revision itself was accepted by whole-model QA, which includes reachability.',
  'Partition volumes use the whole-model storey heights, because a partition\'s uppermost storey is measured to the next zone\'s floor, which the partition does not contain.',
  'Verification, takeoff and BIM of a partition describe that partition alone. Loads, structure, shafts and services crossing zones are not represented, because Building Model V2 has no such elements.',
  'Scene, structural, environmental, building-systems, knowledge, cost and optimization services store artifacts bound to a stored revision and are not run per partition.',
  'RECONCILED is a quantity and coverage reconciliation; it says nothing about whether a partition passes QA or BIM on its own (see validity). Coverage is a self-check of the assignment, which by construction places every entity.',
  'Nothing is stored: the report is derived on read and is deterministic for (model, canonical declaration, includeModels).',
];

const SERVICES: PartitionReport['services'] = [
  { serviceId: 'BLUEPRINT_QA', perPartition: 'EVALUATED', detail: 'Independent QA of each partition model with the BIM source options (no entrance reachability)' },
  { serviceId: 'COMPLEX_VERIFICATION', perPartition: 'EVALUATED', detail: 'Phase 34 verification of each partition; plates are compared exactly with the whole-model verification' },
  { serviceId: 'ENGINEERING_QUANTITIES', perPartition: 'EVALUATED', detail: 'Gross floor area and gross volume (model-height-v2 storey heights of the whole model), reconciled exactly' },
  { serviceId: 'QUANTITY_TAKEOFF', perPartition: 'EVALUATED', detail: 'Phase 13 takeoff of each partition, within the takeoff\'s own entity and size limits; project totals only, nothing stored' },
  { serviceId: 'BIM', perPartition: 'EVALUATED_WHERE_ELIGIBLE', detail: 'BIM projection and its independent validator for each partition the bounded BIM profile admits (≤ 2 storeys, orthogonal, one stair, no columns)' },
  ...['SCENE_3D', 'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS', 'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE', 'BOQ_COST', 'DESIGN_OPTIMIZATION'].map(serviceId => ({ serviceId,
    perPartition: 'NOT_PARTITIONED' as const, detail: 'Stores artifacts bound to a stored revision; a partition is not a stored revision, so this service is not run per partition' })),
];

/** Specification ids an entity list refers to. */
const specRefs = (m: Model) => new Set(COLLECTIONS.flatMap(c => (m[c] as { specificationId?: string | undefined }[]).map(e => e.specificationId).filter((s): s is string => !!s)));

/**
 * Partitioned processing (Phase 35, R1b): each validated zone becomes its own Building Model V2 document, which is validated, QA-checked,
 * verified, measured and (where the bounded profile admits it) projected to BIM on its own. The results are reconciled exactly with the
 * whole model: every entity is in one partition or is a listed interface element, and areas, plates and volume add up. Derived on read.
 */
export function partitionZones(ctx: ZoneContext, request: PartitionRequest): PartitionReport {
  const { model, ids } = ctx, { verification, height, resolved } = prepare(model, ids, request.zones);
  if (resolved.issues.length) throw new ZoneRequestError('ZONE_DECLARATION_INVALID', 'The zone declaration is invalid for this model', resolved.issues.map(i => `${i.code}: ${i.detail}`));
  const zones = resolved.zones, bottoms = zones.map(z => z.storeys[0]!.elevationMm);
  // A level belongs to the zone whose lowest storey is the highest at or below it (anything below the lowest zone joins the first).
  const zoneOfElevation = (e: number) => { let k = 0; for (let i = 0; i < bottoms.length; i++) if (bottoms[i]! <= e) k = i; return k; };
  const levelZone = new Map(model.levels.map(l => [l.id, zoneOfElevation(l.elevationMm)]));
  const entityLevel = new Map<string, string>([...model.spaces, ...model.walls, ...model.openings].map(e => [e.id, e.levelId]));
  const dimensionZone = (d: Dimension): number | null => {
    if (d.levelId !== undefined) return levelZone.get(d.levelId) ?? null;
    const refs = new Set(d.anchors.flatMap(a => a.kind === 'level' ? [a.levelId] : a.kind === 'wall-end' ? [entityLevel.get(a.wallId)] : a.kind === 'space-vertex' ? [entityLevel.get(a.spaceId)]
      : a.kind === 'opening-edge' ? [entityLevel.get(a.openingId)] : []).map(l => l === undefined ? -1 : levelZone.get(l) ?? -1));
    return refs.size === 1 && !refs.has(-1) ? [...refs][0]! : null;
  };
  const interfaceStairs = model.stairs.filter(s => levelZone.get(s.fromLevelId) !== levelZone.get(s.toLevelId)).sort((a, b) => a.id < b.id ? -1 : 1);
  const zoneOfDimension = new Map(model.dimensions.map(d => [d.id, dimensionZone(d)])); // resolved once, not once per partition
  const interfaceDimensions = model.dimensions.filter(d => zoneOfDimension.get(d.id) === null).map(d => d.id).sort();
  const wholePlates = new Map(verification.bases.levels.map(p => [p.levelId, p]));
  const storeyHeight = new Map(height.storeys.map(s => [s.levelId, s.storeyHeightMm]));
  const seen = new Map<string, number>();

  const partitions: Partition[] = zones.map((zone, k) => {
    const inZone = (levelId: string) => levelZone.get(levelId) === k, on = <T extends { levelId: string }>(xs: readonly T[]) => xs.filter(x => inZone(x.levelId));
    const base: Model = { ...model, levels: model.levels.filter(l => inZone(l.id)), spaces: on(model.spaces), walls: on(model.walls), openings: on(model.openings),
      slabs: on(model.slabs), columns: on(model.columns), stairs: model.stairs.filter(s => inZone(s.fromLevelId) && inZone(s.toLevelId)),
      dimensions: model.dimensions.filter(d => zoneOfDimension.get(d.id) === k) };
    const refs = specRefs(base);
    // The site is shared, but its primary entrance is a door of one storey: only the partition holding that door keeps the reference.
    const entry = model.site?.primaryEntryOpeningId, site = model.site && entry && !base.openings.some(o => o.id === entry)
      ? (({ primaryEntryOpeningId: _e, ...s }) => s)(model.site) : model.site;
    const { parametricArchitecture: _p, ...rest } = { ...base, site, specifications: model.specifications.filter(s => refs.has(s.id)) };
    // The parametric submodel describes the whole building; it is kept only when the partition is the whole building.
    const pm: Model = zones.length === 1 && model.parametricArchitecture ? { ...rest, parametricArchitecture: model.parametricArchitecture } : rest;
    for (const c of COLLECTIONS) for (const e of pm[c] as { id: string }[]) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    const hash = modelHash(pm), parsed = ArchitecturalBuildingModelV2Schema.safeParse(pm);
    const storeyIds = zone.storeys.map(s => s.levelId);
    const entities = { levels: pm.levels.length, spaces: pm.spaces.length, walls: pm.walls.length, openings: pm.openings.length, slabs: pm.slabs.length,
      columns: pm.columns.length, stairs: pm.stairs.length, dimensions: pm.dimensions.length, specifications: pm.specifications.length };
    const common = { key: zone.key, zoneId: zoneId(storeyIds), levelIds: [...pm.levels].sort((a, b) => a.elevationMm - b.elevationMm).map(l => l.id), storeyLevelIds: storeyIds,
      partitionModelHash: hash, entities };
    if (!parsed.success) return { ...common, schema: { status: 'INVALID' as const, issues: parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.') || '(model)'}: ${i.message}`.slice(0, 300)) },
      qa: null, verification: null, quantities: { grossVolumeMm3: null, heightBasis: 'WHOLE_MODEL_STOREY_HEIGHTS' as const }, takeoff: null, bim: null, model: null };
    const p = parsed.data, qa = auditBlueprint(p), v = verifyModel(p, { projectId: ids.projectId, revisionId: ids.revisionId, modelHash: hash }, null);
    // Every partition storey is a whole-model storey, so its whole-model plate exists (B34 reports a plate for every storey).
    const plates = v.bases.levels.map(pl => { const whole = wholePlates.get(pl.levelId)!;
      return { levelId: pl.levelId, grossPlateAreaMm2: pl.grossPlateAreaMm2, method: pl.method, wholeModelPlateAreaMm2: whole.grossPlateAreaMm2, wholeModelMethod: whole.method,
        equal: whole.grossPlateAreaMm2 === pl.grossPlateAreaMm2 }; });
    const volume2 = plates.some(pl => (storeyHeight.get(pl.levelId) ?? null) === null) ? null
      : plates.reduce((s, pl) => s + doubled(pl.grossPlateAreaMm2) * BigInt(storeyHeight.get(pl.levelId)!), 0n);
    let takeoff: Partition['takeoff'];
    try {
      const t = calculateQuantityTakeoff(p);
      takeoff = { status: 'EVALUATED', refusalCode: null, itemCount: t.summary.itemCount, warningCount: t.summary.warningCount,
        totals: t.summary.totals.slice(0, PARTITION_LIMITS.totals).map(x => ({ itemCode: x.itemCode, value: x.quantity.value, unit: x.quantity.unit, itemCount: x.itemCount, status: x.status })) };
    } catch (error) {
      if (!(error instanceof TakeoffError)) throw error;
      takeoff = { status: 'REFUSED', refusalCode: error.code, itemCount: 0, warningCount: 0, totals: [] };
    }
    const profile = bimProfile(p);
    let bim: NonNullable<Partition['bim']> = profile.eligible ? { eligibility: 'ELIGIBLE', refusalCode: null, projection: null } : { eligibility: 'REFUSED', refusalCode: profile.refusalCode, projection: null };
    if (profile.eligible) {
      const binding = { projectId: ids.projectId, revisionId: ids.revisionId, modelHash: hash, generatorVersion: null, generationId: null, requirementsHash: null,
        parameterHash: p.parametricArchitecture ? digest(p.parametricArchitecture) : null };
      try {
        const projected = projectBim(p, binding), validation = validateBim(projected, p, binding);
        bim = { eligibility: 'ELIGIBLE', refusalCode: null, projection: { validation: validation.status, elements: projected.elements.length,
          relationships: projected.relationships.length, diagnostics: validation.diagnostics.length, bimHash: digest(projected) } };
      } catch (error) {
        if (!(error instanceof BimError)) throw error;
        bim = { eligibility: 'REFUSED', refusalCode: error.code, projection: null };
      }
    }
    const codes = [...new Set(qa.findings.filter(f => f.severity !== 'INFO').map(f => f.code))].slice(0, PARTITION_LIMITS.listed);
    return { ...common, schema: { status: 'VALID' as const, issues: [] },
      qa: { status: qa.status, errors: qa.summary.errors, warnings: qa.summary.warnings, findingCodes: codes },
      verification: { status: v.status, grossFloorAreaMm2: v.bases.grossFloorAreaMm2, plates },
      quantities: { grossVolumeMm3: volume2 === null ? null : areaString(volume2), heightBasis: 'WHOLE_MODEL_STOREY_HEIGHTS' as const },
      takeoff, bim, model: request.includeModels ? p : null };
  });

  const modelEntities = COLLECTIONS.reduce((n, c) => n + model[c].length, 0), partitionEntities = partitions.reduce((n, p) =>
    n + p.entities.levels + p.entities.spaces + p.entities.walls + p.entities.openings + p.entities.slabs + p.entities.columns + p.entities.stairs + p.entities.dimensions, 0);
  const interfaceIds = new Set([...interfaceStairs.map(s => s.id), ...interfaceDimensions]);
  const missing = COLLECTIONS.flatMap(c => (model[c] as { id: string }[]).map(e => e.id)).filter(id => !seen.has(id) && !interfaceIds.has(id)).sort();
  const duplicated = [...seen].filter(([, n]) => n > 1).map(([id]) => id).sort();
  const gfa2 = partitions.reduce((s, p) => s + (p.verification ? doubled(p.verification.grossFloorAreaMm2) : 0n), 0n);
  const plateRows = partitions.flatMap(p => p.verification?.plates ?? []);
  const whole2 = grossVolume2(height), parts = partitions.map(p => p.quantities.grossVolumeMm3);
  const sumVolume2 = parts.some(v => v === null) ? null : parts.reduce((s, v) => s + doubled(v!), 0n);
  const reconciliation = {
    coverage: { status: missing.length || duplicated.length || partitionEntities + interfaceIds.size !== modelEntities ? 'INCOMPLETE' as const : 'COMPLETE' as const,
      modelEntities, partitionEntities, interfaceEntities: interfaceIds.size, missing: missing.slice(0, PARTITION_LIMITS.listed), duplicated: duplicated.slice(0, PARTITION_LIMITS.listed) },
    grossFloorArea: { wholeModelMm2: verification.bases.grossFloorAreaMm2, sumOfPartitionsMm2: areaString(gfa2),
      equal: partitions.every(p => p.verification) && areaString(gfa2) === verification.bases.grossFloorAreaMm2 },
    plates: { compared: plateRows.length, equal: plateRows.filter(r => r.equal).length },
    grossVolume: { wholeModelMm3: whole2 === null ? null : areaString(whole2), sumOfPartitionsMm3: sumVolume2 === null ? null : areaString(sumVolume2),
      equal: whole2 === null || sumVolume2 === null ? null : whole2 === sumVolume2 },
  };
  const reconciled = reconciliation.coverage.status === 'COMPLETE' && reconciliation.grossFloorArea.equal && reconciliation.plates.compared === height.storeys.length
    && reconciliation.plates.equal === reconciliation.plates.compared && reconciliation.grossVolume.equal !== false && (whole2 === null) === (sumVolume2 === null);
  const inputHash = costHash({ partitionVersion: PARTITION_VERSION, modelHash: ids.modelHash, verifierInputHash: verification.inputHash, zones: canonicalDeclarations(request.zones),
    includeModels: request.includeModels });
  const body = {
    partitionVersion: PARTITION_VERSION, ...ids, inputHash,
    engine: { partitionVersion: PARTITION_VERSION, verifierVersion: VERIFIER_VERSION, takeoffVersion: TAKEOFF_ENGINE_VERSION, bimVersion: BIM_VERSION,
      formulas: { height: FORMULAS.height, areaVolume: FORMULAS.areaVolume } },
    sourceRevision: ctx.sourceRevision, status: reconciled ? 'RECONCILED' as const : 'NOT_RECONCILED' as const,
    declaration: { source: resolved.source, status: 'VALID' as const, issues: [] }, partitions,
    interfaceElements: {
      stairs: interfaceStairs.slice(0, PARTITION_LIMITS.interfaceStairs).map(s => {
        const a = levelZone.get(s.fromLevelId)!, b = levelZone.get(s.toLevelId)!;
        return { stairId: s.id, fromLevelId: s.fromLevelId, toLevelId: s.toLevelId, lowerZoneKey: zones[Math.min(a, b)]!.key, upperZoneKey: zones[Math.max(a, b)]!.key };
      }),
      stairCount: interfaceStairs.length, dimensionIds: interfaceDimensions.slice(0, PARTITION_LIMITS.listed), dimensionCount: interfaceDimensions.length,
    },
    reconciliation,
    validity: { partitions: partitions.length, schemaValid: partitions.filter(p => p.schema.status === 'VALID').length,
      qaNotFailed: partitions.filter(p => p.qa && p.qa.status !== 'FAIL').length, bimProjected: partitions.filter(p => p.bim?.projection).length },
    services: SERVICES, limitations: PARTITION_LIMITATIONS, claims: { ...NOT_CLAIMED_PARTITIONS },
  };
  // Partition models are identified by partitionModelHash (canonical), so the result hash never depends on their array order.
  const resultHash = costHash({ ...body, partitions: body.partitions.map(p => ({ ...p, model: null })) });
  return PartitionReportSchema.parse({ ...body, resultHash, currency: ctx.currency, generatedAt: ctx.generatedAt });
}
