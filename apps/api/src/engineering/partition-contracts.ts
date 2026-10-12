import { z } from 'zod';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { AreaMethodSchema } from '../verification/contracts.js';
import { FORMULAS } from './contracts.js';
import { CurrencySchema, DeclarationSchema, SourceRevisionSchema, ZONE_LIMITS, ZoneDeclarationsSchema, ZoneKeySchema } from './zone-contracts.js';

// Normative specification: docs/phase35-1/regeneration-and-partitions.md (partitioned processing). Literals change only with semantics.
export const PARTITION_VERSION = 'zone-partitions-v1';
export const PARTITION_LIMITS = Object.freeze({ bodyBytes: 32_768, listed: 16, totals: 64, interfaceStairs: 256 });

const hash = z.string().regex(/^[a-f0-9]{64}$/), entityId = z.string().min(1).max(200);
const area = z.string().regex(/^\d+(\.5)?$/);
const count = z.number().int().min(0);

/** Omitted `zones` means one zone over every storey (the partition is then the whole model). `includeModels` returns each partition model. */
export const PartitionRequestSchema = z.object({ zones: ZoneDeclarationsSchema.optional(), includeModels: z.boolean().default(false) }).strict();
export type PartitionRequest = z.infer<typeof PartitionRequestSchema>;

export const NOT_CLAIMED_PARTITIONS = Object.freeze({ structuralAdequacy: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', partitionIndependence: 'NOT_CLAIMED' } as const);
const notClaimed = <T extends Record<string, string>>(o: T) => z.object(Object.fromEntries(Object.keys(o).map(k => [k, z.literal('NOT_CLAIMED')])) as
  Record<keyof T, z.ZodLiteral<'NOT_CLAIMED'>>).strict();

const entities = z.object({ levels: count, spaces: count, walls: count, openings: count, slabs: count, columns: count, stairs: count, dimensions: count, specifications: count }).strict();
export type PartitionEntities = z.infer<typeof entities>;
const total = z.object({ itemCode: z.string().max(100), value: z.string().max(80), unit: z.enum(['mm', 'mm2', 'mm3', 'each']), itemCount: count, status: z.string().max(40) }).strict();

export const PartitionSchema = z.object({
  key: ZoneKeySchema, zoneId: hash,
  /** Every level of the partition: its storeys plus any datum or roof level between its lowest storey and the next zone's. */
  levelIds: z.array(entityId).max(256), storeyLevelIds: z.array(entityId).max(256),
  partitionModelHash: hash, entities,
  schema: z.object({ status: z.enum(['VALID', 'INVALID']), issues: z.array(z.string().max(300)).max(3) }).strict(),
  /** Acceptance QA with the BIM source options (no entrance reachability: only the lowest partition holds the entrance). Null if the schema fails. */
  qa: z.object({ status: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'FAIL']), errors: count, warnings: count, findingCodes: z.array(z.string().max(100)).max(PARTITION_LIMITS.listed) }).strict().nullable(),
  /** Phase 34 verification of the partition alone; each plate is compared with the same storey's plate in the whole-model verification. */
  verification: z.object({ status: z.enum(['VERIFIED', 'VERIFIED_WITH_WARNINGS', 'PARTIAL', 'FAILED']), grossFloorAreaMm2: area,
    /** A plate can differ only where the whole-model verifier fell back from the exact slab union (method), for example on an exhausted budget. */
    plates: z.array(z.object({ levelId: entityId, grossPlateAreaMm2: area, method: AreaMethodSchema, wholeModelPlateAreaMm2: area, wholeModelMethod: AreaMethodSchema,
      equal: z.boolean() }).strict()).max(256) }).strict().nullable(),
  /** Volume from the partition's plates and the whole-model storey heights (a storey's height runs to the next storey, which may be in the next zone). */
  quantities: z.object({ grossVolumeMm3: area.nullable(), heightBasis: z.literal('WHOLE_MODEL_STOREY_HEIGHTS') }).strict(),
  /** Phase 13 quantity takeoff of the partition alone (project totals only); refused partitions carry the takeoff's typed code. */
  takeoff: z.object({ status: z.enum(['EVALUATED', 'REFUSED']), refusalCode: z.string().max(60).nullable(), itemCount: count, warningCount: count,
    totals: z.array(total).max(PARTITION_LIMITS.totals) }).strict().nullable(),
  /** The bounded BIM profile applied to the partition; when admitted, the projection and its independent validator run on it. */
  bim: z.object({ eligibility: z.enum(['ELIGIBLE', 'REFUSED']), refusalCode: z.string().max(60).nullable(),
    projection: z.object({ validation: z.enum(['VALID_BOUNDED', 'VALID_WITH_INCOMPLETE_DATA', 'INVALID']), elements: count, relationships: count, diagnostics: count, bimHash: hash }).strict().nullable() }).strict().nullable(),
  model: ArchitecturalBuildingModelV2Schema.nullable(),
}).strict();
export type Partition = z.infer<typeof PartitionSchema>;

export const PartitionReportSchema = z.object({
  partitionVersion: z.literal(PARTITION_VERSION), projectId: z.string().uuid(), revisionId: z.string().uuid(), modelHash: hash, inputHash: hash, resultHash: hash, generatedAt: z.string(),
  engine: z.object({ partitionVersion: z.literal(PARTITION_VERSION), verifierVersion: z.string(), takeoffVersion: z.string(), bimVersion: z.string(),
    formulas: z.object({ height: z.literal(FORMULAS.height), areaVolume: z.literal(FORMULAS.areaVolume) }).strict() }).strict(),
  sourceRevision: SourceRevisionSchema, currency: CurrencySchema,
  /** RECONCILED: every entity is in exactly one partition or listed as an interface element, and areas, plates and volume add up exactly. */
  status: z.enum(['RECONCILED', 'NOT_RECONCILED']),
  declaration: DeclarationSchema,
  partitions: z.array(PartitionSchema).max(ZONE_LIMITS.zones),
  /** Elements that belong to two partitions and are therefore in neither: stairs crossing a zone boundary, and level-less dimensions spanning zones. */
  interfaceElements: z.object({
    stairs: z.array(z.object({ stairId: entityId, fromLevelId: entityId, toLevelId: entityId, lowerZoneKey: ZoneKeySchema, upperZoneKey: ZoneKeySchema }).strict()).max(PARTITION_LIMITS.interfaceStairs),
    stairCount: count, dimensionIds: z.array(entityId).max(PARTITION_LIMITS.listed), dimensionCount: count,
  }).strict(),
  reconciliation: z.object({
    coverage: z.object({ status: z.enum(['COMPLETE', 'INCOMPLETE']), modelEntities: count, partitionEntities: count, interfaceEntities: count,
      missing: z.array(entityId).max(PARTITION_LIMITS.listed), duplicated: z.array(entityId).max(PARTITION_LIMITS.listed) }).strict(),
    grossFloorArea: z.object({ wholeModelMm2: area, sumOfPartitionsMm2: area, equal: z.boolean() }).strict(),
    plates: z.object({ compared: count, equal: count }).strict(),
    grossVolume: z.object({ wholeModelMm3: area.nullable(), sumOfPartitionsMm3: area.nullable(), equal: z.boolean().nullable() }).strict(),
  }).strict(),
  services: z.array(z.object({ serviceId: z.string().max(60), perPartition: z.enum(['EVALUATED', 'EVALUATED_WHERE_ELIGIBLE', 'NOT_PARTITIONED']), detail: z.string().max(400) }).strict()).max(16),
  limitations: z.array(z.string().max(400)).max(8), claims: notClaimed(NOT_CLAIMED_PARTITIONS),
}).strict();
export type PartitionReport = z.infer<typeof PartitionReportSchema>;
