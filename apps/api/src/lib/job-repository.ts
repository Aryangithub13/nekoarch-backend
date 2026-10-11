import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { JobCursorSchema, JobDetailSchema, JobEventListSchema, JobLeaseSchema, JobSummarySchema } from '../jobs/contracts.js';

export function jobDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P3201: [404, 'JOB_NOT_FOUND', 'Job not found'],
    P3202: [409, 'JOB_INVALID_TRANSITION', 'The job cannot change to that state'],
    P3203: [409, 'JOB_LEASE_LOST', 'The job lease is no longer held'],
    P3204: [429, 'JOB_LIMIT_EXCEEDED', 'The project job limit is reached'],
    P3205: [409, 'JOB_NOT_RETRYABLE', 'The job cannot be retried'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
export type Attestation = { envelope: string; signature: string };
export type JobAction = 'submit' | 'cancel' | 'retry' | 'recover' | 'start' | 'progress' | 'heartbeat' | 'complete' | 'fail' | 'cancelled' | 'release';

/** Storage boundary for durable jobs: the Supabase and pg-backend adapters implement `jobRpc`. */
export class JobRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'job_read' | 'job_write', args: Record<string, unknown>) {
    if (!this.repository.jobRpc) throw new ApiError(503, 'JOBS_UNAVAILABLE', 'Job persistence is unavailable');
    return this.repository.jobRpc(name, args);
  }
  async get(projectId: string, jobId: string) {
    return JobDetailSchema.parse(await this.rpc('job_read', { p_action: 'get', p_project_id: projectId, p_job_id: jobId }));
  }
  async events(projectId: string, jobId: string, after: number, limit: number) {
    return JobEventListSchema.parse(await this.rpc('job_read', { p_action: 'events', p_project_id: projectId, p_job_id: jobId, p_limit: limit, p_filter: { after } }));
  }
  async list(projectId: string, query: { limit: number; cursor?: string | undefined; status?: string | undefined; kind?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(JobCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(JobSummarySchema).max(100), nextCursor: JobCursorSchema.nullable() }).strict().parse(
      await this.rpc('job_read', { p_action: 'list', p_project_id: projectId, p_limit: query.limit, p_cursor: cursor,
        p_filter: { status: query.status ?? null, kind: query.kind ?? null } }));
    return { ...raw, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
  write(action: JobAction, input: Record<string, unknown>, attestation: Attestation, context?: IdempotencyContext): Promise<unknown> {
    return this.rpc('job_write', { p_action: action, p_input: input, p_context: context ?? null, p_envelope: attestation.envelope, p_signature: attestation.signature });
  }
  async detail(action: JobAction, input: Record<string, unknown>, attestation: Attestation, context?: IdempotencyContext) {
    return JobDetailSchema.parse(await this.write(action, input, attestation, context));
  }
  async lease(input: Record<string, unknown>, attestation: Attestation) {
    return JobLeaseSchema.parse(await this.write('start', input, attestation));
  }
  async recover(input: Record<string, unknown>, attestation: Attestation) {
    return z.object({ recovered: z.number().int().min(0), due: z.array(z.string().uuid()).max(4) }).strict().parse(await this.write('recover', input, attestation));
  }
}
