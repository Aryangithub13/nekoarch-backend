import { z } from 'zod';
import { RevisionParamsSchema } from './projects.js';
import { SCHEDULE_IDS } from '../documents/schedules.js';
import { CAUSE_CODES, NODE_STATES } from './dependency-graph.js';

/** Phase 38: construction documents, derived on read from one stored revision. Provenance only: no compliance or review is claimed. */
export const DOCUMENTS_VERSION = 'construction-documents-v1';
const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), entityId = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const DocumentsQuerySchema = z.object({ require: z.literal('current').optional() }).strict();
export const PlanSheetParamsSchema = RevisionParamsSchema.extend({ levelId: entityId }).strict();
export const ScheduleParamsSchema = RevisionParamsSchema.extend({ schedule: z.enum(SCHEDULE_IDS) }).strict();

export const DocumentBindingSchema = z.object({ projectId: id, revisionId: id, revisionNumber: z.number().int().positive(), modelHash: hash,
  acceptanceQaId: id, qaStatus: z.enum(['PASS', 'PASS_WITH_WARNINGS']) }).strict();
export const DocumentFreshnessSchema = z.object({
  documentStatus: z.enum(['CURRENT_REVISION', 'HISTORICAL_SNAPSHOT']), projectCurrentRevisionId: id,
  revision: z.object({ state: z.enum(NODE_STATES), causes: z.array(z.object({ code: z.enum(CAUSE_CODES), nodeId: z.string() }).strict()) }).strict(),
  acceptanceQa: z.object({ state: z.enum(NODE_STATES), causes: z.array(z.object({ code: z.enum(CAUSE_CODES), nodeId: z.string() }).strict()) }).strict(),
}).strict();
const incomplete = z.object({ reason: z.enum(['WALL_THICKNESS_UNSPECIFIED', 'SPACE_AREA_BASIS_UNSPECIFIED']), entityIds: z.array(entityId) }).strict();
export const DocumentEntrySchema = z.object({
  documentId: z.string().max(260), kind: z.enum(['PLAN_SHEET', 'SCHEDULE_SET', 'SCHEDULE']), title: z.string().max(400),
  mediaType: z.enum(['image/svg+xml', 'application/json', 'text/csv']), href: z.string().nullable(),
  status: z.enum(['COMPLETE', 'INCOMPLETE', 'UNAVAILABLE']), unavailableReason: z.enum(['DOCUMENT_GEOMETRY_INCONSISTENT', 'DOCUMENT_RESOURCE_LIMIT']).nullable(),
  contentHash: hash.nullable(), bytes: z.number().int().nonnegative().nullable(), incomplete: z.array(incomplete),
  levelId: entityId.nullable(), scheduleId: z.enum(SCHEDULE_IDS).nullable(), rowCount: z.number().int().nonnegative().nullable(),
}).strict();
export const FORMAT_SUPPORT = Object.freeze([
  { format: 'SVG', status: 'AVAILABLE', note: 'Storey plan sheets drawn from stored geometry only' },
  { format: 'CSV', status: 'AVAILABLE', note: 'RFC 4180 schedules; spreadsheet formula prefixes neutralised' },
  { format: 'JSON', status: 'AVAILABLE', note: 'Schedules and this manifest' },
  { format: 'IFC', status: 'AVAILABLE_ELSEWHERE', note: 'GET …/bim/export.ifc (Phase 23), within the bounded BIM profile; unchanged by Phase 38' },
  { format: 'PDF', status: 'UNSUPPORTED', note: 'NO_PDF_WRITER: no PDF library or independent validator is in the stack' },
  { format: 'DXF', status: 'UNSUPPORTED', note: 'NO_VALIDATED_DXF_WRITER: no DXF writer or independent validator is in the stack' },
] as const);
export const DOCUMENT_CLAIMS = Object.freeze({ professionalReview: 'NOT_RECORDED', codeCompliance: 'NOT_CLAIMED', structuralAdequacy: 'NOT_CLAIMED',
  permitReadiness: 'NOT_CLAIMED', constructionReadiness: 'NOT_CLAIMED' } as const);
export const DocumentsManifestSchema = z.object({
  documentsVersion: z.literal(DOCUMENTS_VERSION), binding: DocumentBindingSchema, freshness: DocumentFreshnessSchema,
  documents: z.array(DocumentEntrySchema),
  notDrawnLevels: z.array(z.object({ levelId: entityId, kind: z.enum(['roof', 'datum']) }).strict()),
  formats: z.array(z.object({ format: z.string(), status: z.enum(['AVAILABLE', 'AVAILABLE_ELSEWHERE', 'UNSUPPORTED']), note: z.string() }).strict()),
  limitations: z.array(z.string().max(400)),
  claims: z.object({ professionalReview: z.literal('NOT_RECORDED'), codeCompliance: z.literal('NOT_CLAIMED'), structuralAdequacy: z.literal('NOT_CLAIMED'),
    permitReadiness: z.literal('NOT_CLAIMED'), constructionReadiness: z.literal('NOT_CLAIMED') }).strict(),
  manifestHash: hash,
}).strict();
const cell = z.union([z.string(), z.number(), z.null()]);
export const ScheduleSchema = z.object({ scheduleId: z.enum(SCHEDULE_IDS), title: z.string(), rowCount: z.number().int().nonnegative(), scheduleHash: hash,
  columns: z.array(z.object({ key: z.string(), label: z.string(), kind: z.enum(['text', 'number']), unit: z.enum(['mm', 'm2']).nullable() }).strict()),
  rows: z.array(z.record(cell)) }).strict();
export const SchedulesResponseSchema = z.object({ schedulesVersion: z.literal('construction-schedules-v1'), binding: DocumentBindingSchema, freshness: DocumentFreshnessSchema,
  schedules: z.array(ScheduleSchema), claims: DocumentsManifestSchema.shape.claims }).strict();
export type DocumentsManifest = z.infer<typeof DocumentsManifestSchema>;
