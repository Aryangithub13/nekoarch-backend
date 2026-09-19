import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as generator from '@designflow/generator';
import { ApiErrorResponseSchema, CreatePlanResponseSchema } from '@designflow/shared';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ApiError } from '../src/lib/errors.js';
import { createLogger } from '../src/lib/logger.js';
import type { Backend, Repository, PlanInsert } from '../src/lib/repository.js';

const env = parseEnv({ NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test', LOG_LEVEL: 'silent' });
const owner = randomUUID();
const headers = { authorization: 'Bearer verified-session' };
const prompt = '2BHK with open kitchen';
const requirements = generator.parseRequirements(prompt);
const applications: ReturnType<typeof buildApp>[] = [];
function setup(overrides: Partial<Repository> = {}) {
  const insertPlan = vi.fn(async (row: PlanInsert) => ({ id: randomUUID(), plan_data: row.plan_data }));
  const repository: Repository = { insertPlan, getPlan: async () => null, patchPlan: async () => null,
    getRateVersions: async () => [], getRateEntries: async () => [], insertEstimate: async () => undefined, ...overrides };
  const backend: Backend = { authenticate: vi.fn(async token => {
    if (token !== 'verified-session') throw new ApiError(401, 'UNAUTHORIZED', 'A valid Supabase session is required');
    return { id: owner };
  }), repository: vi.fn(() => repository) };
  const lines: string[] = [];
  const captureError = vi.fn();
  const app = buildApp({ env, backend, captureError,
    logger: createLogger({ ...env, LOG_LEVEL: 'info' }, { write: chunk => { lines.push(chunk); } }) });
  applications.push(app);
  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/plans/generate', payload: JSON.stringify(payload),
    headers: { ...headers, 'content-type': 'application/json' } });
  return { app, post, insertPlan, backend, lines, captureError };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(applications.splice(0).map(app => app.close())); });

describe('generation HTTP orchestration', () => {
  it.each([{ requirements, seed: 'explicit', variant: 2 }, { prompt, seed: 'explicit', variant: 2 }])('generates canonical output and forwards verified identity/JWT: %j', async payload => {
    const { post, insertPlan, backend } = setup();
    const response = await post(payload);
    expect(response.statusCode).toBe(201);
    const result = CreatePlanResponseSchema.parse(response.json());
    const expected = generator.generatePlan(requirements, { seed: 'explicit', variant: 2 });
    expect(result.plan).toEqual({ ...expected, id: result.plan.id });
    expect(result.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(backend.authenticate).toHaveBeenCalledWith('verified-session');
    expect(backend.repository).toHaveBeenCalledWith('verified-session');
    expect(insertPlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user_id: owner, plan_data: expected, share_token: result.shareToken }));
  });

  it('exposes the default effective seed in the Plan and permits exact replay', async () => {
    const { post } = setup();
    const first = CreatePlanResponseSchema.parse((await post({ prompt })).json());
    const second = CreatePlanResponseSchema.parse((await post({ prompt, seed: first.plan.seed })).json());
    expect(first.plan.seed).toMatch(/^df6-/);
    expect(second.plan).toEqual({ ...first.plan, id: second.plan.id });
    expect(second.plan.id).not.toBe(first.plan.id);
    expect(second.shareToken).not.toBe(first.shareToken);
  });

  const invalid = [null, {}, { prompt, requirements }, { prompt: '' }, { prompt: '   ' }, { prompt: 'x'.repeat(501) },
    { prompt, seed: '' }, { prompt, seed: 'x'.repeat(129) }, { prompt, variant: 0 }, { prompt, variant: 2_147_483_648 },
    { requirements: { ...requirements, rooms: [{ type: 'garage', count: 1 }] } },
    { requirements: { ...requirements, rooms: [{ type: 'bedroom', count: 9 }] } },
    { requirements: { ...requirements, bounds: { ...requirements.bounds, w: 2 } } },
    { requirements: { ...requirements, floors: 2 } },
    { requirements: { ...requirements, user_id: randomUUID() } },
    ...['owner_id', 'user_id', 'created_by', 'isPublic', 'shareToken', 'id'].map(key => ({ prompt, [key]: 'untrusted-private-value' }))];
  it.each(invalid)('rejects malformed/ambiguous/spoofed input before generating: %j', async payload => {
    const spy = vi.spyOn(generator, 'generatePlan');
    const { post, insertPlan } = setup();
    const response = await post(payload);
    expect(response.statusCode).toBe(400);
    const body = ApiErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
    expect(body.error.fieldErrors).toBeDefined();
    expect(response.body).not.toContain('untrusted-private-value');
    expect(spy).not.toHaveBeenCalled(); expect(insertPlan).not.toHaveBeenCalled();
  });

  it.each([{}, { authorization: 'Bearer invalid' }, { authorization: 'invalid' }])('requires verified auth before generation: %j', async authHeaders => {
    const spy = vi.spyOn(generator, 'generatePlan');
    const { app, insertPlan } = setup();
    const response = await app.inject({ method: 'POST', url: '/api/plans/generate', headers: authHeaders, payload: { prompt } });
    expect(response.statusCode).toBe(401);
    expect(ApiErrorResponseSchema.parse(response.json()).error.code).toBe('UNAUTHORIZED');
    expect(spy).not.toHaveBeenCalled(); expect(insertPlan).not.toHaveBeenCalled();
  });

  it.each([
    ['INVALID_INPUT', 400, 'VALIDATION_ERROR'],
    ['UNSUPPORTED_REQUIREMENT', 422, 'UNSUPPORTED_REQUIREMENT'],
    ['IMPOSSIBLE_LAYOUT', 422, 'IMPOSSIBLE_LAYOUT'],
    ['INVARIANT_FAILURE', 500, 'GENERATION_FAILED'],
    ['GENERATION_FAILED', 500, 'GENERATION_FAILED'],
  ] as const)('maps %s without leaking internals or persisting', async (code, status, expectedCode) => {
    vi.spyOn(generator, 'generatePlan').mockImplementation(() => { throw new generator.GenerationError(code, 'internal-private-secret', { secret: ['internal-private-secret'] }); });
    const { post, insertPlan, captureError } = setup();
    const response = await post({ prompt });
    expect(response.statusCode).toBe(status);
    expect(ApiErrorResponseSchema.parse(response.json()).error).toMatchObject({ code: expectedCode, requestId: response.headers['x-request-id'] });
    expect(response.body).not.toContain('internal-private-secret');
    expect(insertPlan).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledTimes(status === 500 ? 1 : 0);
  });

  it('sanitizes unexpected generator exceptions', async () => {
    vi.spyOn(generator, 'generatePlan').mockImplementation(() => { throw new Error('private-stack-details'); });
    const { post, insertPlan } = setup();
    const response = await post({ prompt });
    expect(response.statusCode).toBe(500); expect(response.json().error.code).toBe('INTERNAL_ERROR');
    expect(response.body).not.toContain('private-stack-details'); expect(insertPlan).not.toHaveBeenCalled();
  });

  it('rejects invalid canonical generator output before persistence', async () => {
    const plan = generator.generatePlan(requirements);
    vi.spyOn(generator, 'generatePlan').mockReturnValue({ ...plan, rooms: [{ ...plan.rooms[0]!, rect: { x: 0, z: 0, w: -1, d: 1 } }] });
    const { post, insertPlan } = setup();
    const response = await post({ prompt });
    expect(response.statusCode).toBe(500); expect(response.json().error.code).toBe('INTERNAL_ERROR');
    expect(insertPlan).not.toHaveBeenCalled();
  });

  it('waits for persistence and returns no success on database failure', async () => {
    let fail!: (reason: Error) => void;
    const pending = new Promise<never>((_resolve, reject) => { fail = reject; });
    let started!: () => void;
    const inserting = new Promise<void>(resolve => { started = resolve; });
    const { post } = setup({ insertPlan: () => { started(); return pending; } });
    let finished = false;
    const response = post({ prompt }).then(value => { finished = true; return value; });
    await inserting;
    expect(finished).toBe(false);
    fail(new ApiError(500, 'DATABASE_ERROR', 'The database operation could not be completed'));
    const result = await response;
    expect(result.statusCode).toBe(500); expect(result.json().error.code).toBe('DATABASE_ERROR');
    expect(result.body).not.toContain('shareToken');
  });

  it('correlates safe logs and request IDs without recording prompts, seeds or capabilities', async () => {
    const { post, lines } = setup();
    const response = await post({ prompt: 'private-prompt-secret 2BHK', seed: 'private-seed-secret' });
    expect(response.statusCode).toBe(201);
    const logs = lines.map(line => JSON.parse(line));
    expect(logs).toContainEqual(expect.objectContaining({ route: '/api/plans/generate', reqId: response.headers['x-request-id'], statusCode: 201 }));
    expect(lines.join('')).not.toContain('private-prompt-secret'); expect(lines.join('')).not.toContain('private-seed-secret');
    expect(lines.join('')).not.toContain(response.json().shareToken);
  });
});
