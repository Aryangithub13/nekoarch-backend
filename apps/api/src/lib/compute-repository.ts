import { z } from 'zod';
import type { Repository } from './repository.js';
import { ApiError } from './errors.js';
import { jobDatabaseError, type Attestation } from './job-repository.js';
import { DispatchSchema, SubmitResponseSchema } from '../compute/contracts.js';

export function computeDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P3601: [429, 'COMPUTE_LIMIT_EXCEEDED', 'The compute consent or active-job limit for this account is reached'],
    P3602: [409, 'COMPUTE_QUOTE_CONFLICT', 'The quote was already used for different work'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  // The nested B32 submission raises job errors (e.g. the per-project job limit); they keep their B32 meaning.
  jobDatabaseError(error);
}

/** Storage boundary for consented dispatches (migration 0025). */
export class ComputeRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'compute_read' | 'compute_write', args: Record<string, unknown>) {
    if (!this.repository.computeRpc) throw new ApiError(503, 'COMPUTE_UNAVAILABLE', 'Compute persistence is unavailable');
    return this.repository.computeRpc(name, args);
  }
  async submit(input: Record<string, unknown>, jobCall: Record<string, unknown>, attestation: Attestation) {
    return SubmitResponseSchema.parse(await this.rpc('compute_write', { p_action: 'submit', p_input: input, p_job_call: jobCall, p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
  async dispatches(projectId: string, jobId: string) {
    return z.array(DispatchSchema).max(100).parse(await this.rpc('compute_read', { p_action: 'job', p_project_id: projectId, p_job_id: jobId }));
  }
}
