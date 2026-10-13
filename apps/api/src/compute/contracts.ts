import { z } from 'zod';
import { JobDetailSchema, JobRequestSchema } from '../jobs/contracts.js';

// Phase 36, first slice: docs/phase36/phase36-design.md. Literals change only with semantics.
export const GATEWAY_VERSION = 'compute-gateway-v1';
export const QUOTE_VERSION = 'compute-quote-v1';
export const POLICY_VERSION = 'compute-policy-v1';
export const COMPUTE_ROOT = '/api/projects/:projectId/compute';
export const COMPUTE_QUOTES = `${COMPUTE_ROOT}/quotes`;
export const COMPUTE_JOBS = `${COMPUTE_ROOT}/jobs`;
export const COMPUTE_JOB = `${COMPUTE_JOBS}/:jobId`;
/** A quote carries the job request (≤ 64 KiB, B32) plus fixed metadata; submission carries the quote plus consent. */
export const COMPUTE_LIMITS = Object.freeze({ quoteBodyBytes: 70_000, submitBodyBytes: 81_920 });

/**
 * Job kinds the gateway may run. Each was inspected: a deterministic engine whose worker output the pool re-validates and the service persists
 * through its own signed SQL write as a derived artifact of the source revision (no model is changed). REVISION_EXECUTE is excluded: it has its
 * own Phase 30 preflight, quote and consent, and cannot be cancelled once running. No solver kind exists or is added.
 */
export const ELIGIBLE_KINDS = ['SCENE_COMPILE', 'OPTIMIZATION_STUDY'] as const;
export const EligibleKindSchema = z.enum(ELIGIBLE_KINDS);
export type EligibleKind = z.infer<typeof EligibleKindSchema>;

/**
 * Server-owned policy (`COMPUTE_POLICY`, JSON). Remote execution is a literal `DISABLED` in this slice: a configuration that tries to enable it
 * is rejected at startup (fail closed), because no remote adapter, credential or budget has been approved.
 */
export const ComputePolicySchema = z.object({
  policyVersion: z.literal(POLICY_VERSION).default(POLICY_VERSION),
  remoteExecution: z.literal('DISABLED').default('DISABLED'),
  kinds: z.array(EligibleKindSchema).min(1).max(ELIGIBLE_KINDS.length).transform(k => ELIGIBLE_KINDS.filter(x => k.includes(x))).default([...ELIGIBLE_KINDS]),
  quoteTtlSeconds: z.number().int().min(60).max(3600).default(900),
  maxConsentedPerOwnerPerDay: z.number().int().min(1).max(500).default(50),
  maxActivePerOwner: z.number().int().min(1).max(8).default(2),
}).strict();
export type ComputePolicy = z.infer<typeof ComputePolicySchema>;

export const PlacementSchema = z.enum(['LOCAL', 'REMOTE']);
export const PROVIDERS = Object.freeze([
  Object.freeze({ providerId: 'local-pool', type: 'LOCAL_POOL', placement: 'LOCAL', costClass: 'FREE', dataTransfer: 'NONE', status: 'AVAILABLE',
    reason: 'Existing bounded in-process worker pools (Phases 28–29); no external service, account or spend' }),
  Object.freeze({ providerId: 'remote-http-worker', type: 'REMOTE_HTTP_WORKER', placement: 'REMOTE', costClass: 'NOT_CONFIGURED', dataTransfer: 'REMOTE_PROVIDER', status: 'DISABLED',
    reason: 'REMOTE_EXECUTION_DISABLED: no remote adapter, provider, credential or budget is approved in this release' }),
] as const);

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const notClaimed = z.literal('NOT_CLAIMED');
export const COMPUTE_CLAIMS = Object.freeze({ engineeringValidity: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED',
  environmentReproducibility: 'NOT_CLAIMED' } as const);
const ClaimsSchema = z.object({ engineeringValidity: notClaimed, solverValidation: notClaimed, professionalReview: notClaimed, environmentReproducibility: notClaimed }).strict();

export const QuoteRequestSchema = z.object({ request: JobRequestSchema, placement: PlacementSchema.default('LOCAL') }).strict();

/** What the owner is asked to consent to. Signed by the server (`quoteHash`); obtaining a quote authorizes nothing. */
export const ComputeQuoteSchema = z.object({
  quoteVersion: z.literal(QUOTE_VERSION), gatewayVersion: z.literal(GATEWAY_VERSION), projectId: id,
  kind: EligibleKindSchema, request: JobRequestSchema, inputHash: hash, placement: z.literal('LOCAL'),
  provider: z.object({ providerId: z.literal('local-pool'), type: z.literal('LOCAL_POOL') }).strict(),
  source: z.object({ revisionId: id, modelHash: hash }).strict(),
  algorithm: z.object({ engine: z.string().max(64), version: z.string().max(64) }).strict(),
  execution: z.object({ maxWallMs: z.number().int().positive(), poolSize: z.number().int().positive(), queueLimit: z.number().int().min(0), maxAttempts: z.number().int().positive(),
    maxActivePerProject: z.number().int().positive(), maxActivePerOwner: z.number().int().positive(), maxConsentedPerOwnerPerDay: z.number().int().positive(),
    requestBytes: z.number().int().positive() }).strict(),
  cost: z.object({ costClass: z.literal('FREE'), ceilingMinor: z.literal(0), currency: z.literal('INR'), basis: z.literal('LOCAL_POOL_NO_EXTERNAL_SPEND') }).strict(),
  dataTransfer: z.literal('NONE'),
  runtime: z.object({ node: z.string().max(40), reproducibility: z.literal('NOT_CLAIMED') }).strict(),
  issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  authorization: z.literal('NOT_AUTHORIZED_UNTIL_CONSENT'), claims: ClaimsSchema, quoteHash: hash,
}).strict();
export type ComputeQuote = z.infer<typeof ComputeQuoteSchema>;

export const ConsentSchema = z.object({ quoteHash: hash, acceptQuote: z.literal(true), acceptLocalExecution: z.literal(true) }).strict();
export const SubmitRequestSchema = z.object({ quote: ComputeQuoteSchema, consent: ConsentSchema }).strict();

export const DispatchSchema = z.object({ dispatchVersion: z.literal('compute-dispatch-v1'), quoteHash: hash, jobId: id, projectId: id, ownerId: id,
  kind: EligibleKindSchema, placement: z.literal('LOCAL'), providerId: z.literal('local-pool'), inputHash: hash, sourceRevisionId: id, modelHash: hash,
  costClass: z.literal('FREE'), costCeilingMinor: z.literal(0), currency: z.literal('INR'), dataTransfer: z.literal('NONE'), quote: z.record(z.unknown()), consentedAt: z.string() }).strict();
export const SubmitResponseSchema = z.object({ job: JobDetailSchema, dispatch: DispatchSchema, replayed: z.boolean() }).strict();
/** Polling view. `resultCheck` reports what the service validated, never engineering validity. */
export const ComputeJobSchema = z.object({ gatewayVersion: z.literal(GATEWAY_VERSION), job: JobDetailSchema, dispatches: z.array(DispatchSchema).max(100),
  resultCheck: z.object({ status: z.enum(['PENDING', 'ACCEPTED_BY_SERVICE_VALIDATOR', 'NO_RESULT']), detail: z.string().max(400) }).strict(), claims: ClaimsSchema }).strict();
export const ComputeJobParamsSchema = z.object({ projectId: id, jobId: id }).strict();
