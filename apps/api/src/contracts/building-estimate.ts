import { z } from 'zod';

/** Response of GET /api/projects/:projectId/revisions/:revisionId/engineering-estimate (see estimate/building-estimate.ts). */
const n = z.number().nonnegative(), int = z.number().int().nonnegative(), label = z.string().max(400);
export const BuildingEstimateQuerySchema = z.object({
  tier: z.enum(['economy', 'standard', 'premium', 'luxury']).optional(),
  city: z.string().trim().min(1).max(60).optional(),
  budgetInr: z.coerce.number().int().positive().max(100_000_000_000).optional(),
  soilBearingKnM2: z.coerce.number().min(50).max(600).optional(),
}).strict();
export const BuildingEstimateSchema = z.object({
  schemaVersion: z.literal(1), basis: label, currency: z.literal('INR'),
  areas: z.object({ plotM2: n, footprintM2: n, builtUpM2: n, builtUpSqft: int, carpetM2: n, carpetSqft: int, floors: z.number().int().min(1).max(10), groundCoveragePct: n, far: n }).strict(),
  structure: z.object({
    system: label, concreteGrade: z.string().max(10), steelGrade: z.string().max(10), liveLoadKnM2: n, deadLoadKnM2: n, factoredLoadKnM2: n,
    slab: z.object({ thicknessMm: int, maxSpanM: n, rule: label }).strict(),
    beams: z.object({ sizeMm: z.string().max(40), maxSpanM: n, rule: label }).strict(),
    columns: z.object({ count: int, sizeMm: z.string().max(40), maxFactoredLoadKn: int, rule: label }).strict(),
    footings: z.object({ type: label, sizeM: z.string().max(40), depthM: n, soilBearingKnM2: n, rule: label }).strict(),
    stair: z.object({ risers: int, riserMm: int, treadMm: int, widthMm: int, check: label }).strict().nullable(),
  }).strict(),
  quantities: z.object({ concreteM3: n, steelKg: int, steelTonnes: n, bricks: int, cementBags: int, sandM3: n, aggregateM3: n, plasterM2: int, flooringM2: n, wallTileM2: n, paintM2: int,
    waterproofingM2: n, doors: int, windows: int, windowAreaM2: n, excavationM3: n }).strict(),
  boq: z.array(z.object({ code: z.string().max(10), category: z.string().max(60), item: label, unit: z.string().max(10), quantity: n, rateInr: int, amountInr: int }).strict()).max(80),
  summary: z.object({ subtotalInr: int, contractorMarginInr: int, contingencyInr: int, gstInr: int, totalInr: int, perSqftInr: int, perM2Inr: int,
    rangeInr: z.array(int).length(2), cityFactor: n, byCategory: z.array(z.object({ category: z.string().max(60), amountInr: int, sharePct: n }).strict()).max(20) }).strict(),
  budget: z.object({ budgetInr: int, differenceInr: z.number().int(), status: z.enum(['WITHIN', 'TIGHT', 'OVER']) }).strict().nullable(),
  timeline: z.object({ months: z.number().int().positive(), phases: z.array(z.object({ phase: label, weeks: int }).strict()).max(12) }).strict(),
  assumptions: z.array(label).max(20),
}).strict();
export const BuildingEstimateResponseSchema = z.object({
  projectId: z.string().uuid(), revisionId: z.string().uuid(), revisionNumber: z.number().int().positive(), generatorVersion: z.string().nullable(),
  buildingType: z.string().max(40).nullable(), estimate: BuildingEstimateSchema,
}).strict();
