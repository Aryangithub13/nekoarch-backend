import { z } from 'zod';
export const EntityIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const LabelSchema = z.string().trim().min(1).max(200);
export const SpecReferenceFields = { specificationId: EntityIdSchema.optional() };
export const SpecificationSchema = z.object({
  id: EntityIdSchema, name: LabelSchema, material: LabelSchema.optional(),
  reference: z.string().min(1).max(500).optional(),
}).strict();
export const ProvenanceSchema = z.object({
  creationMode: z.enum(['authored', 'generated', 'legacy-adapter']),
  generatorVersion: LabelSchema.optional(), seed: z.string().max(500).optional(),
  sourcePlanId: z.string().uuid().optional(), sourceVariant: z.number().int().positive().max(2_147_483_647).optional(),
  adapterVersion: z.literal('v1-to-v2/1').optional(),
  measurementVersion: z.literal('mm-exact/1'),
}).strict();
