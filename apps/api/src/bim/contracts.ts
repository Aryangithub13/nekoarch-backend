import { z } from 'zod';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { QuantityTakeoffReportSchema } from '@designflow/quantity-takeoff';
export const BIM_VERSION = 'bim-semantic-v1';
export const BIM_LIMITS = { inputBytes: 2_097_152, outputBytes: 8_388_608, exportBytes: 8_388_608, nodes: 150000, depth: 24, elements: 1500, relationships: 6000 } as const;
export class BimError extends Error {
  constructor(readonly code: 'BIM_INVALID_SOURCE' | 'BIM_INVALID_MODEL' | 'BIM_SOURCE_MISMATCH' | 'BIM_RESOURCE_LIMIT' | 'BIM_UNSUPPORTED_MODEL' | 'BIM_UNSUPPORTED_EXPORT', message: string) { super(message); this.name = 'BimError'; }
}
const id = z.string().min(1).max(240);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const BimBindingSchema = z.object({ projectId: z.string().uuid(), revisionId: z.string().uuid(), modelHash: hash,
  generatorVersion: z.string().max(200).nullable(), generationId: z.string().uuid().nullable(), requirementsHash: hash.nullable(),
  parameterHash: hash.nullable() }).strict();
export type BimBinding = z.infer<typeof BimBindingSchema>;
export const BimKindSchema = z.enum(['project','site','building','level','space','wall','opening','door','window','slab','roof','stair','landing','void','group']);
export const SourceRefSchema = z.object({ collection: z.enum(['project','site','building','levels','spaces','walls','openings','slabs','stairs','landings','voids','groups']), id, parentId: id.nullable(), index: z.number().int().min(0).max(64).nullable() }).strict();
export type SourceRef = z.infer<typeof SourceRefSchema>;
export const PropertySchema = z.object({ key: z.enum(['classification','elevation','height','thickness','width','sill','offset','orientation','roofRole','material','engineering','boundaryBasis','rise','run','treadDepth']),
  state: z.enum(['known','derived','assumed','not_available','not_evaluated']), value: z.union([z.string().max(500),z.number().finite(),z.null()]),
  unit: z.enum(['mm','text','not_applicable']), provenance: z.enum(['native','geometry','unspecified']) }).strict();
export type BimProperty = z.infer<typeof PropertySchema>;
export const BimElementSchema = z.object({ id, kind: BimKindSchema, name: z.string().min(1).max(200), source: SourceRefSchema,
  floorId: id.nullable(), parentId: id.nullable(), geometryHash: hash.nullable(), properties: z.array(PropertySchema).max(24),
  materialIds: z.array(id).max(1), quantityIds: z.array(z.string().max(300)).max(64) }).strict();
export type BimElement = z.infer<typeof BimElementSchema>;
export const RelationshipSchema = z.object({ id, kind: z.enum(['contains','hosts','fills','bounds','connects_level','accesses','uses_material','group_member','voids','serves_void']), from: id, to: id }).strict();
export type BimRelationship = z.infer<typeof RelationshipSchema>;
export const MaterialSchema = z.object({ id, name: z.string().min(1).max(200), state: z.enum(['specified','derived','unspecified']),
  sourceSpecificationId: z.string().max(200).nullable(), reference: z.string().max(500).nullable() }).strict();
export const BimModelSchema = z.object({ version: z.literal(BIM_VERSION), propertyVersion: z.literal(1), units: z.literal('mm'),
  coordinateSystem: z.literal('x-right-y-up-z-depth'), binding: BimBindingSchema,
  geometry: ArchitecturalBuildingModelV2Schema, elements: z.array(BimElementSchema).max(BIM_LIMITS.elements),
  relationships: z.array(RelationshipSchema).max(BIM_LIMITS.relationships), materials: z.array(MaterialSchema).max(256),
  quantities: QuantityTakeoffReportSchema, completeness: z.literal('architectural_incomplete_engineering') }).strict();
export type BimModel = z.infer<typeof BimModelSchema>;
export const ValidationSchema = z.object({ version: z.literal('bim-validator-v1'), status: z.enum(['INVALID','VALID_BOUNDED','VALID_WITH_INCOMPLETE_DATA']),
  diagnostics: z.array(z.object({ code: z.enum(['SCHEMA','SOURCE','IDENTITY','REFERENCE','HIERARCHY','SEMANTICS','GEOMETRY','PROPERTY','MATERIAL','QUANTITY','ORDER','INCOMPLETE']), elementId: id.nullable(), message: z.string().max(300), severity: z.enum(['ERROR','INFO']) }).strict()).max(200),
  export: z.object({ profile: z.literal('nekoarch-ifc4-architectural-v1'), status: z.enum(['SUPPORTED','UNSUPPORTED']), limitations: z.array(z.string().max(300)).max(16) }).strict() }).strict();
export type BimValidation = z.infer<typeof ValidationSchema>;
