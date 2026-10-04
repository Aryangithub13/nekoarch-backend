import { z } from 'zod';
import { ParametricArchitectureSchema } from './parametric.js';
import { EntityIdSchema, LabelSchema, ProvenanceSchema, SpecificationSchema } from './common.js';
import { SiteSchema } from './site.js';
import { LevelSchema } from './levels.js';
import { SpaceSchema } from './spaces.js';
import { WallSchema } from './walls.js';
import { HostedOpeningSchema } from './openings.js';
import { SlabSchema, ColumnSchema } from './slabs.js';
import { StairSchema } from './stairs.js';
import { DimensionSchema } from './dimensions.js';
export const BuildingModelShapeSchema = z.object({
  schemaVersion: z.literal(2), id: EntityIdSchema, name: LabelSchema,
  completeness: z.enum(['architectural', 'legacy-planar']),
  units: z.literal('mm'), coordinateSystem: z.literal('x-right-y-up-z-depth'),
  site: SiteSchema.nullable(), levels: z.array(LevelSchema).min(1).max(256),
  spaces: z.array(SpaceSchema).max(4096), walls: z.array(WallSchema).max(8192),
  openings: z.array(HostedOpeningSchema).max(8192), stairs: z.array(StairSchema).max(1024),
  slabs: z.array(SlabSchema).max(4096), columns: z.array(ColumnSchema).max(4096),
  dimensions: z.array(DimensionSchema).max(8192), specifications: z.array(SpecificationSchema).max(4096),
  provenance: ProvenanceSchema,
  parametricArchitecture: ParametricArchitectureSchema.optional(),
}).strict();
export type BuildingModelV2 = z.infer<typeof BuildingModelShapeSchema>;
