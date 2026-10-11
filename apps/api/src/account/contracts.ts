import { z } from 'zod';
import { JobKindSchema, JobStatusSchema } from '../jobs/contracts.js';
import { ReferenceMediaTypeSchema, ReferencePurposeSchema } from '../references/contracts.js';

export const CONTEXT_VERSION = 'project-context-v1';
export const ACCOUNT_LIMITS = Object.freeze({ projects: 200, referenceBytes: 1_073_741_824, activeJobs: 8 });
export const LIBRARY_LIMITS = Object.freeze({ tags: 10, query: 100, page: 50 });
export const BRIEF_LIMITS = Object.freeze({ summary: 2000, text: 300, notes: 1000, keywords: 10, constraints: 20, references: 20, bytes: 32_768 });
export const NOT_CLAIMED_CONTEXT = Object.freeze({ siteVerified: 'NOT_CLAIMED', budgetVerified: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', ownershipVerified: 'NOT_CLAIMED' } as const);

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), timestamp = z.string();
// User-stated text: NFKC, control/format characters removed, trimmed; it is data only and is never interpreted.
const text = (max: number) => z.string().transform(s => s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().min(1).max(max));

export const UnitsSchema = z.enum(['METRIC', 'IMPERIAL']);
export const LocaleSchema = z.enum(['en', 'en-IN', 'hi', 'hi-IN', 'hi-Latn']);
export const BuildingTypeSchema = z.enum(['residential', 'commercial', 'institutional']);
export const UserSettingsSchema = z.object({ units: UnitsSchema, locale: LocaleSchema, currency: z.literal('INR'),
  defaultRegion: text(100).nullable(), defaultBuildingType: BuildingTypeSchema.nullable() }).strict();
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export const DEFAULT_SETTINGS: UserSettings = Object.freeze({ units: 'METRIC', locale: 'en-IN', currency: 'INR', defaultRegion: null, defaultBuildingType: null }) as UserSettings;
export const SettingsDocumentSchema = z.object({ version: z.number().int().min(0), settings: UserSettingsSchema, updatedAt: timestamp.nullable(), isDefault: z.boolean() }).strict();
export const SettingsPatchSchema = z.object({ expectedVersion: z.number().int().min(0), settings: UserSettingsSchema.partial().strict()
  .refine(v => Object.keys(v).length > 0, 'Provide at least one setting') }).strict();

export const AccountUsageSchema = z.object({
  projects: z.object({ active: z.number().int().min(0), archived: z.number().int().min(0) }).strict(),
  revisions: z.number().int().min(0),
  references: z.object({ count: z.number().int().min(0), storedBytes: z.number().int().min(0) }).strict(),
  jobs: z.object({ active: z.number().int().min(0), submittedLast24h: z.number().int().min(0) }).strict(),
  limits: z.object({ projects: z.number().int(), referenceBytes: z.number().int(), activeJobs: z.number().int() }).strict(),
}).strict();

export const TagSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
export const LibraryQuerySchema = z.object({
  q: z.string().transform(s => s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().max(LIBRARY_LIMITS.query)).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'), visibility: z.enum(['PRIVATE', 'PUBLIC']).optional(),
  starred: z.enum(['true', 'false']).transform(v => v === 'true').optional(), tag: TagSchema.optional(),
  sort: z.enum(['updated', 'created', 'title']).default('updated'), limit: z.coerce.number().int().min(1).max(LIBRARY_LIMITS.page).default(20),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
export const LibraryCursorSchema = z.object({ sort: z.enum(['updated', 'created', 'title']), key: z.string().max(400), id }).strict();
export const LibraryItemSchema = z.object({ id, title: z.string(), status: z.enum(['ACTIVE', 'ARCHIVED']), visibility: z.enum(['PRIVATE', 'PUBLIC']),
  currentRevisionId: id.nullable(), revisionCount: z.number().int().min(0), createdAt: timestamp, updatedAt: timestamp, archivedAt: timestamp.nullable(),
  starred: z.boolean(), tags: z.array(TagSchema).max(LIBRARY_LIMITS.tags), referenceCount: z.number().int().min(0), briefVersion: z.number().int().min(0) }).strict();
export const LibraryListSchema = z.object({ items: z.array(LibraryItemSchema).max(LIBRARY_LIMITS.page), nextCursor: z.string().nullable() }).strict();
export const LibraryPatchSchema = z.object({ starred: z.boolean().optional(),
  tags: z.array(TagSchema).max(LIBRARY_LIMITS.tags).transform(t => [...new Set(t)].sort()).optional() }).strict()
  .refine(v => Object.keys(v).length > 0, 'Provide starred or tags');
export const LibraryEntrySchema = z.object({ projectId: id, starred: z.boolean(), tags: z.array(TagSchema), updatedAt: timestamp }).strict();

export const ProjectBriefSchema = z.object({
  summary: text(BRIEF_LIMITS.summary),
  site: z.object({ address: text(BRIEF_LIMITS.text).optional(),
    plot: z.object({ width: z.number().positive().max(100_000), depth: z.number().positive().max(100_000), unit: z.enum(['m', 'ft']) }).strict().optional(),
    orientationNote: text(BRIEF_LIMITS.text).optional() }).strict().default({}),
  program: z.object({ floors: z.number().int().min(1).max(200).optional(), bedrooms: z.number().int().min(0).max(100).optional(),
    bathrooms: z.number().int().min(0).max(100).optional(), notes: text(BRIEF_LIMITS.notes).optional() }).strict().default({}),
  budget: z.object({ amount: z.number().positive().max(1e12), currency: z.literal('INR'), flexibility: z.enum(['LOW', 'MEDIUM', 'HIGH']) }).strict().optional(),
  style: z.object({ keywords: z.array(text(40)).max(BRIEF_LIMITS.keywords).default([]) }).strict().default({}),
  constraints: z.array(text(BRIEF_LIMITS.text)).max(BRIEF_LIMITS.constraints).default([]),
  referenceIds: z.array(id).max(BRIEF_LIMITS.references).transform(r => [...new Set(r)]).default([]),
}).strict();
export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;
export const BriefCreateSchema = z.object({ expectedVersion: z.number().int().min(0), brief: ProjectBriefSchema }).strict();
export const BriefProvenanceSchema = z.object({ source: z.literal('USER_STATED'), verified: z.literal(false) }).strict();
export const BriefVersionSchema = z.object({ projectId: id, version: z.number().int().positive(), brief: ProjectBriefSchema, briefHash: hash, createdBy: id,
  createdAt: timestamp, provenance: BriefProvenanceSchema, claims: z.object(Object.fromEntries(Object.keys(NOT_CLAIMED_CONTEXT).map(k => [k, z.literal('NOT_CLAIMED')])) as
    Record<keyof typeof NOT_CLAIMED_CONTEXT, z.ZodLiteral<'NOT_CLAIMED'>>).strict() }).strict();
export const BriefCurrentSchema = z.object({ projectId: id, version: z.number().int().min(0), current: BriefVersionSchema.nullable() }).strict();
export const BriefSummarySchema = z.object({ version: z.number().int().positive(), briefHash: hash, createdBy: id, createdAt: timestamp }).strict();
export const BriefListSchema = z.object({ projectId: id, items: z.array(BriefSummarySchema).max(100), nextCursor: z.string().nullable() }).strict();
export const BriefVersionParamsSchema = z.object({ projectId: id, version: z.coerce.number().int().positive() }).strict();

export const ContextBundleSchema = z.object({
  contextVersion: z.literal(CONTEXT_VERSION), projectId: id, generatedAt: timestamp, contextHash: hash,
  project: z.object({ id, title: z.string(), status: z.enum(['ACTIVE', 'ARCHIVED']), visibility: z.enum(['PRIVATE', 'PUBLIC']), revisionCount: z.number().int().min(0),
    updatedAt: timestamp, starred: z.boolean(), tags: z.array(TagSchema) }).strict(),
  settings: z.object({ version: z.number().int().min(0), settings: UserSettingsSchema }).strict(),
  brief: BriefVersionSchema.nullable(),
  references: z.array(z.object({ id, purpose: ReferencePurposeSchema, displayName: z.string().nullable(), mediaType: ReferenceMediaTypeSchema, storedSha256: hash,
    boundRevisionId: id.nullable(), currency: z.enum(['CURRENT', 'STALE', 'PROJECT_SCOPED']), linkedFromBrief: z.boolean() }).strict()).max(50),
  currentRevision: z.object({ id, revisionNumber: z.number().int().positive(), qaStatus: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'FAIL']), modelHash: hash,
    createdAt: timestamp }).strict().nullable(),
  activeJobs: z.array(z.object({ id, kind: JobKindSchema, status: JobStatusSchema, createdAt: timestamp }).strict()).max(8),
  claims: z.object(Object.fromEntries(Object.keys(NOT_CLAIMED_CONTEXT).map(k => [k, z.literal('NOT_CLAIMED')])) as Record<keyof typeof NOT_CLAIMED_CONTEXT, z.ZodLiteral<'NOT_CLAIMED'>>).strict(),
}).strict();
export type ContextBundle = z.infer<typeof ContextBundleSchema>;
export const EmptyQuerySchema = z.object({}).strict();
