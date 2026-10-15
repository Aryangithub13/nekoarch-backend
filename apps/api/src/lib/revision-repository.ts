import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { AppearanceManifestSchema, AppearanceSchema, LockSchema, OPERATION_STATUSES, PreflightSchema } from '../revision/contracts.js';
import { RevisionCommitResponseSchema } from '../contracts/projects.js';

export function revisionDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P3001: [404, 'REVISION_OPERATION_NOT_FOUND', 'Revision operation not found'],
    P3002: [409, 'REVISION_OPERATION_INVALID_STATE', 'The operation does not allow this transition'],
    P3003: [409, 'REVISION_OPERATION_ALREADY_COMMITTED', 'The operation has already been committed'],
    P3005: [409, 'REVISION_CONSENT_MISMATCH', 'The request does not match the reviewed preflight or candidate'],
    P3006: [429, 'REVISION_LIMIT_EXCEEDED', 'Too many active or recent revision operations for this project'],
    P3007: [422, 'REVISION_LOCK_VIOLATION', 'The commit violates the operation preservation lock'],
    P3008: [422, 'REVISION_CANDIDATE_INVALID', 'The candidate or preflight is not bound to this operation'],
    P3009: [500, 'REVISION_ARTIFACT_INTEGRITY', 'Revision artifact integrity failure'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), ts = z.string();
export const OperationSummarySchema = z.object({ id: uuid, projectId: uuid, baseRevisionId: uuid, kind: z.enum(['APPEARANCE_MODIFY', 'RESTORE', 'INTERIOR_FINISH_MODIFY']).nullable(), status: z.enum(OPERATION_STATUSES),
  operationVersion: z.literal('revision-operation-v1'), preflightHash: hash, appearanceHash: hash.nullable(), restoreSourceRevisionId: uuid.nullable(), candidateHash: hash.nullable(),
  committedRevisionId: uuid.nullable(), createdAt: ts, updatedAt: ts, expiresAt: ts }).strict();
export const CandidateSummarySchema = z.object({ id: uuid, operationId: uuid, manifestVersion: z.literal('appearance-scene-manifest-v1'), compilerVersion: z.literal('appearance-compiler-v1'),
  validatorVersion: z.literal('revision-appearance-validator-v1'), modelHash: hash, appearanceHash: hash, binarySha256: hash, binaryBytes: z.number().int().positive(), createdAt: ts }).strict();
export const OperationDetailSchema = OperationSummarySchema.extend({ request: z.unknown(), preflight: PreflightSchema, validation: z.record(z.unknown()).nullable(),
  failure: z.object({ code: z.string(), message: z.string() }).strict().nullable(), approvedBy: uuid.nullable(), candidate: CandidateSummarySchema.nullable() }).strict();
export type OperationDetail = z.infer<typeof OperationDetailSchema>;
const Conflict = z.object({ conflict: z.enum(['STALE_BASE', 'EXPIRED']), operation: OperationDetailSchema }).strict();
const Cursor = z.object({ createdAt: z.string().datetime({ offset: true }), id: uuid }).strict();
export const AppearanceReadSchema = z.object({ revisionId: uuid, appearance: AppearanceSchema.nullable(), appearanceHash: hash.nullable(), modelHash: hash.nullable(), operationId: uuid.nullable(),
  artifact: CandidateSummarySchema.nullable(), manifest: AppearanceManifestSchema.nullable() }).strict();

export const OperationListSchema = z.object({ items: z.array(OperationSummarySchema).max(100), nextCursor: z.string().nullable() }).strict();
export const RevisionEventSchema = z.object({ id: uuid, eventType: z.string(), actor: uuid.nullable(), detail: z.record(z.unknown()), createdAt: ts }).strict();
export const ValidationEvidenceSchema = z.object({ operationId: uuid, status: z.enum(OPERATION_STATUSES), preflightHash: hash, candidateHash: hash.nullable(), validation: z.record(z.unknown()).nullable(),
  failure: z.object({ code: z.string(), message: z.string() }).strict().nullable(), verifications: z.array(z.string()).max(24), locks: z.array(LockSchema).max(32), events: z.array(RevisionEventSchema).max(50) }).strict();
export const AppearanceResponseSchema = AppearanceReadSchema.extend({ status: z.enum(['APPEARANCE_VARIANT', 'DEFAULT_PLACEHOLDER']),
  lineage: z.object({ operation: OperationSummarySchema.nullable(), modelEquivalentToBase: z.boolean().nullable() }).strict() }).strict();
export const CandidateManifestResponseSchema = z.object({ acceptance: z.enum(['COMMITTED', 'CANDIDATE_PREVIEW_NOT_ACCEPTED']), operation: OperationSummarySchema, artifact: CandidateSummarySchema, manifest: AppearanceManifestSchema }).strict();

/** Storage boundary for Phase 30 operations; every write is a signed SECURITY DEFINER call that re-validates bindings in SQL. */
export class RevisionRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'revision_operation_read' | 'revision_operation_write', args: Record<string, unknown>) {
    if (!this.repository.revisionRpc) throw new ApiError(503, 'REVISION_UNAVAILABLE', 'Revision persistence is unavailable');
    return this.repository.revisionRpc(name, args);
  }
  private conflict(raw: unknown) {
    const c = Conflict.safeParse(raw);
    if (!c.success) return;
    if (c.data.conflict === 'STALE_BASE') throw new ApiError(409, 'REVISION_BASE_STALE', 'The accepted base revision changed; the operation can no longer be committed');
    throw new ApiError(409, 'REVISION_OPERATION_EXPIRED', 'The operation expired');
  }
  async write(action: 'preflight' | 'candidate' | 'fail' | 'approve' | 'reject' | 'cancel', input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    const raw = await this.rpc('revision_operation_write', { p_action: action, p_input: input, p_context: context ?? null, p_envelope: attestation.envelope, p_signature: attestation.signature });
    this.conflict(raw);
    return raw;
  }
  async preflight(input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return OperationDetailSchema.parse(await this.write('preflight', input, attestation, context));
  }
  async transition(action: 'candidate' | 'fail' | 'reject' | 'cancel', input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return OperationDetailSchema.parse(await this.write(action, input, attestation, context));
  }
  async approve(input: unknown, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return z.object({ operation: OperationDetailSchema, commit: RevisionCommitResponseSchema }).strict().parse(await this.write('approve', input, attestation, context));
  }
  async get(projectId: string, operationId: string) {
    return OperationDetailSchema.parse(await this.rpc('revision_operation_read', { p_action: 'get', p_project_id: projectId, p_operation_id: operationId }));
  }
  async events(projectId: string, operationId: string) {
    return z.array(RevisionEventSchema).max(50)
      .parse(await this.rpc('revision_operation_read', { p_action: 'events', p_project_id: projectId, p_operation_id: operationId }));
  }
  async candidate(projectId: string, operationId: string) {
    return z.object({ operation: OperationSummarySchema, artifact: CandidateSummarySchema, manifest: AppearanceManifestSchema }).strict()
      .parse(await this.rpc('revision_operation_read', { p_action: 'candidate', p_project_id: projectId, p_operation_id: operationId }));
  }
  async candidateGlb(projectId: string, operationId: string) {
    const r = z.object({ operation: OperationSummarySchema, artifact: CandidateSummarySchema, glbBase64: z.string().max(23_000_000) }).strict()
      .parse(await this.rpc('revision_operation_read', { p_action: 'candidate-glb', p_project_id: projectId, p_operation_id: operationId }));
    return { operation: r.operation, artifact: r.artifact, glb: Buffer.from(r.glbBase64, 'base64') };
  }
  async appearance(projectId: string, revisionId: string) {
    return AppearanceReadSchema.parse(await this.rpc('revision_operation_read', { p_action: 'appearance', p_project_id: projectId, p_revision_id: revisionId }));
  }
  async appearanceGlb(projectId: string, revisionId: string) {
    const { glbBase64, ...artifact } = CandidateSummarySchema.extend({ glbBase64: z.string().max(23_000_000) }).strict()
      .parse(await this.rpc('revision_operation_read', { p_action: 'appearance-glb', p_project_id: projectId, p_revision_id: revisionId }));
    return { artifact, glb: Buffer.from(glbBase64, 'base64') };
  }
  async lineage(projectId: string, revisionId: string) {
    return z.object({ operation: OperationSummarySchema.nullable(), modelEquivalentToBase: z.boolean().nullable() }).strict()
      .parse(await this.rpc('revision_operation_read', { p_action: 'lineage', p_project_id: projectId, p_revision_id: revisionId }));
  }
  async list(projectId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(Cursor, cursor);
    }
    const raw = z.object({ items: z.array(OperationSummarySchema).max(100), nextCursor: Cursor.nullable() }).strict()
      .parse(await this.rpc('revision_operation_read', { p_action: 'list', p_project_id: projectId, p_limit: query.limit, p_cursor: cursor }));
    return { items: raw.items, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
}
