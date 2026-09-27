import { z } from 'zod';
import { CONSTRUCTION_ENGINE_VERSION, CONSTRUCTION_LIMITS, ConstructionOptionsSchema, ConstructionSpecificationSchema } from './specification.js';
import { MATERIAL_UNITS, type MaterialCode } from './recipes.js';
const text = z.string().min(1).max(500);
const decimal = z.string().max(200).regex(/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/);
const integer = z.string().max(300).regex(/^(0|[1-9][0-9]*)$/);
const exact = z.object({ numerator: integer, denominator: integer.refine(v => v !== '0') }).strict();
export const ConstructionStatusSchema = z.enum(['EVALUATED', 'PARTIAL', 'NOT_EVALUATED']);
export const MaterialSchema = z.object({
  id: text, calculationItemId: text, coatingId: text.nullable(), materialCode: z.enum(Object.keys(MATERIAL_UNITS) as [MaterialCode, ...MaterialCode[]]),
  unit: z.enum(['kg','m3','piece','l','each']), theoretical: decimal, wastage: decimal, final: decimal,
  theoreticalExact: exact, finalExact: exact,
  purchase: z.object({ unit: z.enum(['bag','piece','each']), quantity: integer, bagMassKg: decimal.nullable(),
    theoreticalEquivalent: decimal, adjustedEquivalent: decimal }).strict().nullable(),
}).strict().superRefine((m, ctx) => {
  if (MATERIAL_UNITS[m.materialCode] !== m.unit) ctx.addIssue({ code: 'custom', message: 'Material/unit mismatch' });
});
export const CalculationItemSchema = z.object({
  id: text, takeoffItemId: text, takeoffItemCode: text, sourceEntityIds: z.array(text).min(1).max(2),
  levelId: text.nullable(), specificationId: text.nullable(), assemblyId: text, layerId: text,
  assignmentId: text, recipeId: text, status: ConstructionStatusSchema,
  basis: z.object({ value: decimal, unit: z.enum(['mm2','mm3','each']) }).strict(),
  evidence: z.record(z.union([z.string().max(500), z.number().finite(), exact])),
  assumptions: z.array(z.string().max(500)).max(16),
}).strict();
export const MaterialTotalSchema = z.object({ materialCode: MaterialSchema.innerType().shape.materialCode,
  unit: MaterialSchema.innerType().shape.unit, theoretical: decimal, wastage: decimal, final: decimal,
  purchases: z.array(z.object({ unit: z.enum(['bag','piece','each']), bagMassKg: decimal.nullable(), quantity: integer }).strict()).max(CONSTRUCTION_LIMITS.materials),
}).strict();
export const ConstructionReportSchema = z.object({
  engineVersion: z.literal(CONSTRUCTION_ENGINE_VERSION), takeoffEngineVersion: text, measurementPolicyVersion: text,
  recipePack: z.object({ id: text, version: text }).strict(), specification: ConstructionSpecificationSchema,
  options: ConstructionOptionsSchema,
  summary: z.object({ calculationCount: z.number().int().nonnegative(), materialCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(), status: ConstructionStatusSchema, totals: z.array(MaterialTotalSchema).max(32) }).strict(),
  items: z.array(CalculationItemSchema).max(CONSTRUCTION_LIMITS.calculations), materials: z.array(MaterialSchema).max(CONSTRUCTION_LIMITS.materials),
  sections: z.array(z.object({ dimension: z.enum(['level','assembly','specification']), key: text.nullable(),
    totals: z.array(MaterialTotalSchema).max(32) }).strict()).max(CONSTRUCTION_LIMITS.sections),
  coverage: z.array(z.object({ category: text, status: ConstructionStatusSchema, reason: z.string().max(500),
    itemCount: z.number().int().nonnegative() }).strict()).max(128),
  warnings: z.array(z.object({ code: text, takeoffItemId: text.nullable() }).strict()).max(CONSTRUCTION_LIMITS.warnings),
}).strict();
export type ConstructionReport = z.infer<typeof ConstructionReportSchema>;
export type CalculationItem = z.infer<typeof CalculationItemSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type MaterialTotal = z.infer<typeof MaterialTotalSchema>;
