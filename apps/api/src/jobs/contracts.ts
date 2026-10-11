import { z } from 'zod';

export const JOB_VERSION = 'durable-job-v1';
export const JOB_LIMITS = Object.freeze({ maxAttempts: 3, maxUserRetries: 3, activePerProject: 4, submissionsPerHour: 120, leaseSeconds: 30, heartbeatMs: 5_000,
  backoffSeconds: [2, 8] as readonly number[], requestBytes: 65_536, shutdownGraceMs: 5_000 });
export const JobKindSchema = z.enum(['SCENE_COMPILE', 'OPTIMIZATION_STUDY', 'REVISION_EXECUTE']);
export type JobKind = z.infer<typeof JobKindSchema>;
export const JobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export const JobStageSchema = z.enum(['QUEUED', 'VALIDATING', 'COMPUTING', 'PERSISTING', 'DONE']);
export const STAGE_PERCENT: Readonly<Record<z.infer<typeof JobStageSchema>, number>> = Object.freeze({ QUEUED: 0, VALIDATING: 10, COMPUTING: 30, PERSISTING: 90, DONE: 100 });

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Requests reuse the synchronous routes' inputs; the executors re-validate them exactly as those routes do. */
export const JobRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SCENE_COMPILE'), revisionId: id }).strict(),
  z.object({ kind: z.literal('OPTIMIZATION_STUDY'), revisionId: id, input: z.record(z.unknown()) }).strict(),
  z.object({ kind: z.literal('REVISION_EXECUTE'), operationId: id, preflightHash: hash, consent: z.object({ acceptLocks: z.literal(true), acceptQuote: z.literal(true) }).strict() }).strict(),
]);
export type JobRequest = z.infer<typeof JobRequestSchema>;
export const JobProgressSchema = z.object({ stage: JobStageSchema, percent: z.number().int().min(0).max(100), message: z.string().max(200) }).strict();
export const JobFailureSchema = z.object({ code: z.string().regex(/^[A-Z0-9_]{1,64}$/), message: z.string().max(300), retryable: z.boolean(), attempt: z.number().int().min(0) }).strict();
export const JobResultSchema = z.object({ resultKind: z.enum(['SCENE_ARTIFACT', 'OPTIMIZATION_STUDY', 'REVISION_OPERATION']), resultId: id, href: z.string().startsWith('/api/projects/') }).strict();
export type JobResult = z.infer<typeof JobResultSchema>;
export const JobSummarySchema = z.object({
  id, projectId: id, ownerId: id, kind: JobKindSchema, status: JobStatusSchema, jobVersion: z.literal(JOB_VERSION), inputHash: hash,
  attempt: z.number().int().min(0), maxAttempts: z.number().int().positive(), userRetries: z.number().int().min(0), notBefore: z.string(),
  leaseExpiresAt: z.string().nullable(), cancelRequested: z.boolean(), progress: JobProgressSchema, result: JobResultSchema.nullable(),
  failure: JobFailureSchema.nullable(), lastFailure: JobFailureSchema.nullable(), createdAt: z.string(), updatedAt: z.string(), finishedAt: z.string().nullable(),
}).strict();
export const JobDetailSchema = JobSummarySchema.extend({ request: JobRequestSchema, deduplicated: z.boolean().optional() }).strict();
export type JobDetail = z.infer<typeof JobDetailSchema>;
/** What the runner needs to fence its writes; returned only by `start`, never by reads. */
export const JobLeaseSchema = JobDetailSchema.extend({ leaseToken: id }).strict();
export const JobEventSchema = z.object({ seq: z.number().int().positive(), eventType: z.enum(['SUBMITTED', 'DEDUPLICATED', 'STARTED', 'PROGRESS', 'CANCEL_REQUESTED', 'REQUEUED',
  'LEASE_EXPIRED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETRIED', 'RELEASED']), detail: z.record(z.unknown()), createdAt: z.string() }).strict();
export const JobListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().min(1).max(512).optional(),
  status: JobStatusSchema.optional(), kind: JobKindSchema.optional() }).strict();
export const JobEventsQuerySchema = z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();
export const JobParamsSchema = z.object({ projectId: id, jobId: id }).strict();
export const JobCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id }).strict();
export const JobListSchema = z.object({ items: z.array(JobSummarySchema).max(100), nextCursor: z.string().nullable() }).strict();
export const JobEventListSchema = z.object({ jobId: id, status: JobStatusSchema, events: z.array(JobEventSchema).max(200), nextAfter: z.number().int().min(0) }).strict();
export const EmptyBodySchema = z.object({}).strict();
