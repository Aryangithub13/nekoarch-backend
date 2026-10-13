import { costHash } from '@designflow/boq-cost';
import type { IdempotencyContext, Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { JobRepository } from '../lib/job-repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { RevisionRepository } from '../lib/revision-repository.js';
import { signProjectCommit } from './project-service.js';
import { JobDetailSchema, type JobRequest } from '../jobs/contracts.js';
import type { JobRunner } from '../jobs/runner.js';

export const JOB_ROOT = '/api/projects/:projectId/jobs';
export const JOB_ITEM = `${JOB_ROOT}/:jobId`;

const need = (secret?: string): string => { if (!secret) throw new ApiError(503, 'JOBS_UNAVAILABLE', 'Job persistence is not configured'); return secret; };
/** Replays return the stored shape; the API never exposes a lease token. */
export const presentJob = (stored: unknown) => JobDetailSchema.parse(stored);

/** A job for a missing target is refused at submission (404), not after it has queued. Execution re-checks everything. */
async function precheck(repository: Repository, projectId: string, request: JobRequest) {
  if (request.kind === 'REVISION_EXECUTE') await new RevisionRepository(repository).get(projectId, request.operationId);
  else await new ProjectRepository(repository).read('revision', projectId, request.revisionId);
}

/** The signed B32 submission for a request, built once here so the Phase 36 gateway submits exactly what this route would (no second job path). */
export function signedJobSubmission(userId: string, projectId: string, request: JobRequest, secret: string, context?: IdempotencyContext) {
  const input = { action: 'submit', projectId, kind: request.kind, request, inputHash: costHash(request) };
  return { input, attestation: signProjectCommit(secret, userId, JOB_ROOT, input, context) };
}

/** Returns the stored detail (the route presents it, also for idempotent replays). */
export async function submitJob(repository: Repository, runner: JobRunner, userId: string, projectId: string, request: JobRequest, secret?: string, context?: IdempotencyContext) {
  const key = need(secret);
  await precheck(repository, projectId, request);
  const { input, attestation } = signedJobSubmission(userId, projectId, request, key, context);
  const detail = await new JobRepository(repository).detail('submit', input, attestation, context);
  if (detail.status === 'QUEUED') runner.dispatch(repository, userId, projectId, detail.id);
  return detail;
}

/**
 * Recovery on read (design §6): expired leases are requeued or failed in SQL, then due jobs are dispatched with the reader's credentials.
 * Without the commit secret nothing can be recovered or dispatched, and reads still work.
 */
async function recover(repository: Repository, runner: JobRunner, userId: string, projectId: string, secret?: string) {
  if (!secret) return;
  const input = { action: 'recover', projectId };
  const { due } = await new JobRepository(repository).recover(input, signProjectCommit(secret, userId, 'job-recover', input));
  for (const jobId of due) runner.dispatch(repository, userId, projectId, jobId);
}

export async function readJob(repository: Repository, runner: JobRunner, userId: string, projectId: string, jobId: string, secret?: string) {
  const jobs = new JobRepository(repository);
  await jobs.get(projectId, jobId); // ownership and existence before any write
  await recover(repository, runner, userId, projectId, secret);
  return jobs.get(projectId, jobId);
}
export async function listJobs(repository: Repository, runner: JobRunner, userId: string, projectId: string,
  query: { limit: number; cursor?: string | undefined; status?: string | undefined; kind?: string | undefined }, secret?: string) {
  await new ProjectRepository(repository).read('get', projectId);
  await recover(repository, runner, userId, projectId, secret);
  return new JobRepository(repository).list(projectId, query);
}
export async function jobEvents(repository: Repository, runner: JobRunner, userId: string, projectId: string, jobId: string, after: number, limit: number, secret?: string) {
  const jobs = new JobRepository(repository);
  await jobs.get(projectId, jobId);
  await recover(repository, runner, userId, projectId, secret);
  return jobs.events(projectId, jobId, after, limit);
}

export async function cancelJob(repository: Repository, runner: JobRunner, userId: string, projectId: string, jobId: string, secret?: string) {
  const input = { action: 'cancel', projectId, jobId };
  const detail = await new JobRepository(repository).detail('cancel', input, signProjectCommit(need(secret), userId, `${JOB_ITEM}/cancel`, input));
  runner.requestCancel(jobId);
  return detail;
}
export async function retryJob(repository: Repository, runner: JobRunner, userId: string, projectId: string, jobId: string, secret?: string) {
  const input = { action: 'retry', projectId, jobId };
  const detail = await new JobRepository(repository).detail('retry', input, signProjectCommit(need(secret), userId, `${JOB_ITEM}/retry`, input));
  runner.dispatch(repository, userId, projectId, jobId);
  return detail;
}
