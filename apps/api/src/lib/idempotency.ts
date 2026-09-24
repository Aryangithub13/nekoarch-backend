import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { DurableWrite, Repository, IdempotencyContext } from './repository.js';
import { ApiError } from './errors.js';

// Hash validated/defaulted input, sorting objects recursively; array order is meaningful.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function durablePost<T>(request: FastifyRequest, repository: Repository, input: unknown,
  run: (repository: Repository) => Promise<T>): Promise<T> {
  const key = request.headers['idempotency-key'];
  if (key === undefined) return run(repository);
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must contain 1–128 letters, digits, dots, underscores, colons or hyphens');
  }
  if (!repository.lookupIdempotency || !repository.commitIdempotency) throw new ApiError(503, 'IDEMPOTENCY_UNAVAILABLE', 'Retry protection is unavailable');
  const context = { operation: request.routeOptions.url!, keyHash: hash(key), fingerprint: hash(canonical(input)) };
  const cached = await repository.lookupIdempotency(context);
  if (cached) {
    if (cached.fingerprint !== context.fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was used for a different request');
    return cached.response as T;
  }
  let write: DurableWrite | undefined;
  // Stage the single creation while preserving existing validation and calculation services.
  // The RPC commits the write, audit trigger, and response in one PostgreSQL transaction.
  const staged = Object.create(repository) as Repository;
  staged.insertPlan = async row => {
    if (write) throw new Error('Multiple durable writes are unsupported');
    write = { kind: 'plan', row };
    return { id: randomUUID(), plan_data: row.plan_data };
  };
  staged.insertEstimate = async row => {
    if (write) throw new Error('Multiple durable writes are unsupported');
    write = { kind: 'estimate', row };
  };
  const response = await run(staged);
  if (!write) throw new Error('Missing durable write');
  return await repository.commitIdempotency(context, write, response) as T;
}

/** Reuses Phase 8 canonical identity and durable receipts for commands whose
 * response (including DB timestamps) is assembled inside their atomic RPC. */
export async function durableCommand<T>(request: FastifyRequest, repository: Repository, input: unknown,
  run: (context?: IdempotencyContext) => Promise<T>): Promise<T> {
  const key = request.headers['idempotency-key'];
  if (key === undefined) return run();
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must contain 1–128 letters, digits, dots, underscores, colons or hyphens');
  }
  if (!repository.lookupIdempotency) throw new ApiError(503, 'IDEMPOTENCY_UNAVAILABLE', 'Retry protection is unavailable');
  const context = { operation: request.routeOptions.url!, keyHash: hash(key), fingerprint: hash(canonical(input)) };
  const cached = await repository.lookupIdempotency(context);
  if (cached) {
    if (cached.fingerprint !== context.fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was used for a different request');
    return cached.response as T;
  }
  return run(context);
}
