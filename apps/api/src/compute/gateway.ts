import { createHmac, timingSafeEqual } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import type { Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { ComputeRepository } from '../lib/compute-repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { signProjectCommit } from '../services/project-service.js';
import { readRevisionModel } from '../services/verification-service.js';
import { validateScene } from '../services/scene-service.js';
import { validateOptimization } from '../services/optimization-service.js';
import { readJob, signedJobSubmission } from '../services/job-service.js';
import { JOB_LIMITS, type JobDetail, type JobRequest } from '../jobs/contracts.js';
import type { JobRunner } from '../jobs/runner.js';
import { SCENE_COMPILER_VERSION } from '../scene3d/contracts.js';
import { SCENE_POOL_DEFAULTS } from '../scene3d/pool.js';
import { OPTIMIZER_VERSION } from '../optimization/contracts.js';
import { POOL_DEFAULTS as OPTIMIZATION_POOL_DEFAULTS } from '../optimization/pool.js';
import { COMPUTE_CLAIMS, COMPUTE_JOBS, ComputeJobSchema, ComputeQuoteSchema, ELIGIBLE_KINDS, GATEWAY_VERSION, QUOTE_VERSION,
  type ComputePolicy, type ComputeQuote, type EligibleKind } from './contracts.js';

type QuoteBody = { request: JobRequest; placement: 'LOCAL' | 'REMOTE' };
type SubmitBody = { quote: ComputeQuote; consent: { quoteHash: string; acceptQuote: true; acceptLocalExecution: true } };

/** Bounds of the existing local pools, declared to the owner; the pools enforce them (timeouts, queue limits, worker heap). */
const LOCAL: Record<EligibleKind, { engine: string; version: string; maxWallMs: number; poolSize: number; queueLimit: number }> = {
  SCENE_COMPILE: { engine: 'scene-compiler', version: SCENE_COMPILER_VERSION, maxWallMs: SCENE_POOL_DEFAULTS.timeoutMs, poolSize: SCENE_POOL_DEFAULTS.size,
    queueLimit: SCENE_POOL_DEFAULTS.queueLimit },
  OPTIMIZATION_STUDY: { engine: 'optimization-engine', version: OPTIMIZER_VERSION, maxWallMs: OPTIMIZATION_POOL_DEFAULTS.timeoutMs,
    poolSize: OPTIMIZATION_POOL_DEFAULTS.size, queueLimit: OPTIMIZATION_POOL_DEFAULTS.queueLimit },
};

const need = (secret?: string): string => { if (!secret) throw new ApiError(503, 'COMPUTE_UNAVAILABLE', 'Compute dispatch is not configured'); return secret; };

/** Server signature over the quote and the requesting user (domain-separated from commit envelopes). Clients cannot mint or alter a quote. */
export function quoteSignature(secret: string, userId: string, quote: Omit<ComputeQuote, 'quoteHash'>) {
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(`${QUOTE_VERSION}\n${userId}\n${costHash(quote)}`).digest('hex');
}
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

/** Fail closed: placement, kind and policy are checked before anything is read or computed. */
function eligible(policy: ComputePolicy, body: QuoteBody): EligibleKind {
  if (body.placement !== 'LOCAL') throw new ApiError(422, 'COMPUTE_PLACEMENT_DISABLED', 'Remote execution is disabled; only LOCAL placement is available');
  const kind = body.request.kind;
  if (!(ELIGIBLE_KINDS as readonly string[]).includes(kind) || !policy.kinds.includes(kind as EligibleKind))
    throw new ApiError(422, 'COMPUTE_KIND_UNSUPPORTED', `${kind} is not eligible for gateway execution`);
  if (Buffer.byteLength(JSON.stringify(body.request)) > JOB_LIMITS.requestBytes) throw new ApiError(400, 'COMPUTE_REQUEST_TOO_LARGE', 'The job request exceeds the request limit');
  return kind as EligibleKind;
}

/** The engine's own read-only validation (no compute, nothing stored), so invalid work is refused before consent is asked for. */
async function validate(repository: Repository, projectId: string, request: JobRequest) {
  if (request.kind === 'REVISION_EXECUTE') throw new ApiError(422, 'COMPUTE_KIND_UNSUPPORTED', 'REVISION_EXECUTE is not eligible for gateway execution');
  if (request.kind === 'SCENE_COMPILE') await validateScene(repository, projectId, request.revisionId, {});
  else await validateOptimization(repository, projectId, request.revisionId, request.input);
  const { hash } = await readRevisionModel(repository, projectId, request.revisionId);
  return { revisionId: request.revisionId, modelHash: hash };
}

/** A signed, expiring statement of exactly what would run, where, within which bounds, and at what cost. It authorizes nothing. */
export async function createQuote(repository: Repository, userId: string, projectId: string, body: QuoteBody, policy: ComputePolicy, secret?: string, now = new Date()) {
  const key = need(secret), kind = eligible(policy, body), source = await validate(repository, projectId, body.request), local = LOCAL[kind];
  const content: Omit<ComputeQuote, 'quoteHash'> = {
    quoteVersion: QUOTE_VERSION, gatewayVersion: GATEWAY_VERSION, projectId, kind, request: body.request, inputHash: costHash(body.request), placement: 'LOCAL',
    provider: { providerId: 'local-pool', type: 'LOCAL_POOL' }, source, algorithm: { engine: local.engine, version: local.version },
    execution: { maxWallMs: local.maxWallMs, poolSize: local.poolSize, queueLimit: local.queueLimit, maxAttempts: JOB_LIMITS.maxAttempts,
      maxActivePerProject: JOB_LIMITS.activePerProject, maxActivePerOwner: policy.maxActivePerOwner, maxConsentedPerOwnerPerDay: policy.maxConsentedPerOwnerPerDay,
      requestBytes: JOB_LIMITS.requestBytes },
    cost: { costClass: 'FREE', ceilingMinor: 0, currency: 'INR', basis: 'LOCAL_POOL_NO_EXTERNAL_SPEND' }, dataTransfer: 'NONE',
    runtime: { node: process.version, reproducibility: 'NOT_CLAIMED' },
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + policy.quoteTtlSeconds * 1000).toISOString(),
    authorization: 'NOT_AUTHORIZED_UNTIL_CONSENT', claims: { ...COMPUTE_CLAIMS },
  };
  return ComputeQuoteSchema.parse({ ...content, quoteHash: quoteSignature(key, userId, content) });
}

/** Checks a returned quote and its consent; throws a typed 409 for anything that is not exactly what this user was quoted. */
export function verifyConsent(secret: string, userId: string, projectId: string, body: SubmitBody, now = new Date()) {
  const { quoteHash, ...content } = body.quote;
  if (body.consent.quoteHash !== quoteHash) throw new ApiError(409, 'COMPUTE_CONSENT_MISMATCH', 'The consent does not name this quote');
  if (content.projectId !== projectId || !sameHash(quoteSignature(secret, userId, content), quoteHash))
    throw new ApiError(409, 'COMPUTE_QUOTE_INVALID', 'The quote was not issued for this request; obtain a new quote');
  if (Date.parse(content.expiresAt) <= now.getTime()) throw new ApiError(409, 'COMPUTE_QUOTE_EXPIRED', 'The quote has expired; obtain a new quote');
}

/**
 * Explicit consent → one durable B32 job plus its consent record, committed together. Placement, kind and policy are re-checked against the
 * current policy; the source is re-validated. A repeated consent (same quote) returns the job it started instead of running again.
 */
export async function submitConsent(repository: Repository, runner: JobRunner, userId: string, projectId: string, body: SubmitBody, policy: ComputePolicy, secret?: string, now = new Date()) {
  const key = need(secret);
  // Ownership first (RLS read): another user's project is a 404, as on every project route, before any quote is examined.
  await new ProjectRepository(repository).read('get', projectId);
  verifyConsent(key, userId, projectId, body, now);
  const quote = body.quote;
  eligible(policy, { request: quote.request, placement: quote.placement });
  const source = await validate(repository, projectId, quote.request);
  if (source.revisionId !== quote.source.revisionId || source.modelHash !== quote.source.modelHash)
    throw new ApiError(409, 'COMPUTE_QUOTE_STALE', 'The source revision no longer matches the quote');
  const job = signedJobSubmission(userId, projectId, quote.request, key);
  const { request: _request, ...stored } = quote;
  const input = { projectId, quoteHash: quote.quoteHash, kind: quote.kind, request: quote.request, inputHash: quote.inputHash, placement: 'LOCAL', providerId: 'local-pool',
    sourceRevisionId: quote.source.revisionId, modelHash: quote.source.modelHash, costClass: 'FREE', costCeilingMinor: 0, currency: 'INR', dataTransfer: 'NONE',
    quote: stored, limits: { maxConsentedPerOwnerPerDay: policy.maxConsentedPerOwnerPerDay, maxActivePerOwner: policy.maxActivePerOwner } };
  const result = await new ComputeRepository(repository).submit(input, { p_action: 'submit', p_input: job.input, p_envelope: job.attestation.envelope,
    p_signature: job.attestation.signature }, signProjectCommit(key, userId, COMPUTE_JOBS, input));
  if (result.job.status === 'QUEUED') runner.dispatch(repository, userId, projectId, result.job.id);
  return result;
}

const resultCheck = (job: JobDetail) => job.status === 'SUCCEEDED'
  ? { status: 'ACCEPTED_BY_SERVICE_VALIDATOR' as const, detail: 'The engine service re-validated the worker output and stored it through its own signed write. This is a software check of the artifact, not an engineering validation.' }
  : job.status === 'FAILED' || job.status === 'CANCELLED' ? { status: 'NO_RESULT' as const, detail: `The job is ${job.status}; no result was stored.` }
    : { status: 'PENDING' as const, detail: 'Not finished; poll again. Reads also recover jobs whose worker was lost.' };

/** Polling: the B32 read (with recovery on read) plus the consent records for the job. */
export async function readComputeJob(repository: Repository, runner: JobRunner, userId: string, projectId: string, jobId: string, secret?: string) {
  const job = await readJob(repository, runner, userId, projectId, jobId, secret);
  const dispatches = await new ComputeRepository(repository).dispatches(projectId, jobId);
  if (!dispatches.length) throw new ApiError(404, 'COMPUTE_JOB_NOT_FOUND', 'No gateway dispatch exists for this job');
  return ComputeJobSchema.parse({ gatewayVersion: GATEWAY_VERSION, job, dispatches, resultCheck: resultCheck(job), claims: { ...COMPUTE_CLAIMS } });
}
