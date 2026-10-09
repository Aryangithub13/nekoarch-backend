import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ApiError } from '../src/lib/errors.js';
import type { Backend, Repository } from '../src/lib/repository.js';
import { CAPABILITIES, MODES } from '../src/workflows/registry.js';
import { AI_CAPABILITIES } from '../src/ai/orchestration/registry.js';
import { DISCOVERY_VERSION, MEDIA, SERVICES } from '../src/services/overview-service.js';
import { SCENE_COMPILER_VERSION, SceneInputSchema } from '../src/scene3d/contracts.js';
import { CreateProjectRequestSchema, GenerateRevisionRequestSchema } from '../src/contracts/projects.js';
import { WorkflowRequestSchema } from '../src/contracts/workflows.js';
import { CONTRACTS, jsonSchema, openApiDocument } from '../../../test-support/openapi.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
// Test-only: Ajv 6 (draft-07) is already in the lockfile through the lint toolchain; it independently checks the exported JSON Schema.
import Ajv from 'ajv';

/** Source-derived route catalog (docs/modernization/api-routes.json). Regenerate with UPDATE_ROUTE_CATALOG=1 after an intentional API change. */
const CATALOG = new URL('../../../docs/modernization/api-routes.json', import.meta.url), OPENAPI = new URL('../../../docs/modernization/openapi.json', import.meta.url);
const notFound = () => { throw new ApiError(404, 'NOT_FOUND', 'Resource not found'); };
const repository = new Proxy({}, { get: () => async () => notFound() }) as Repository;
const backend: Backend = { authenticate: async () => ({ id: randomUUID() }), repository: () => repository, ready: async () => undefined };
const app = buildApp({ env: parseEnv({ NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false' }),
  backend, captureError: () => undefined });
const routes: { method: string; url: string }[] = [];
app.addHook('onRoute', r => { for (const method of [r.method].flat()) if (method !== 'OPTIONS') routes.push({ method, url: r.url }); });
const concrete = (url: string) => url.replace(/:elementId/g, `bim-${'a'.repeat(40)}`).replace(/:[A-Za-z]+/g, () => randomUUID());

describe('modernization R01/R06: source-derived API catalog and anonymous-access inventory', () => {
  let catalog: { method: string; url: string; anonymous: number }[];
  beforeAll(async () => {
    await app.ready();
    catalog = [];
    for (const r of [...routes].sort((a, b) => a.url.localeCompare(b.url, 'en') || a.method.localeCompare(b.method, 'en'))) {
      const res = await app.inject({ method: r.method as 'GET', url: concrete(r.url), ...(r.method === 'GET' ? {} : { payload: {} }) });
      catalog.push({ ...r, anonymous: res.statusCode });
    }
    if (process.env.UPDATE_ROUTE_CATALOG === '1') {
      writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + '\n');
      writeFileSync(OPENAPI, JSON.stringify(openApiDocument(catalog), null, 1) + '\n');
    }
  });
  afterAll(async () => { await app.close(); });

  it('matches the checked-in catalog (no undocumented route, no silently removed route)', () => {
    expect(catalog).toEqual(JSON.parse(readFileSync(CATALOG, 'utf8')));
  });
  it('requires a session on every project-scoped route; anonymous access is limited to an explicit allowlist', () => {
    const open = catalog.filter(r => r.anonymous !== 401).map(r => `${r.method} ${r.url}`).sort();
    const anonymousReads = ['GET /api/capabilities', 'GET /api/plans/:id', 'GET /api/projects/:projectId/public', 'GET /api/regions', 'GET /health/live', 'GET /health/ready'];
    // Phase 5 routes that parse the body before authenticating (an empty body is a 400 before the 401); they still require a session. Finding R06-F1.
    const validateBeforeAuth = ['POST /api/estimates', 'POST /api/plans', 'POST /api/plans/generate', 'PATCH /api/plans/:id'];
    expect(open).toEqual([...anonymousReads, ...validateBeforeAuth].sort());
    for (const r of validateBeforeAuth) expect(catalog.find(c => `${c.method} ${c.url}` === r)?.anonymous, r).toBe(400);
    expect(catalog.filter(r => r.url.startsWith('/api/projects/:projectId/') && !r.url.endsWith('/public')).every(r => r.anonymous === 401)).toBe(true);
  });
  it('advertises only services that are registered routes, with engine versions taken from source', async () => {
    const body = (await app.inject('/api/capabilities')).json();
    // Phase 16 fields are unchanged; discovery fields are additive.
    expect({ workflowVersion: body.workflowVersion, modes: body.modes, capabilities: body.capabilities })
      .toEqual(JSON.parse(JSON.stringify({ workflowVersion: 'workflow-v1', modes: MODES, capabilities: CAPABILITIES })));
    expect(body).toMatchObject({ discoveryVersion: DISCOVERY_VERSION, services: JSON.parse(JSON.stringify(SERVICES)), media: JSON.parse(JSON.stringify(MEDIA)),
      aiCapabilities: JSON.parse(JSON.stringify(AI_CAPABILITIES)) });
    for (const s of SERVICES) expect(catalog.some(r => r.url.startsWith(s.route)), s.serviceId).toBe(true);
    expect(SERVICES.find(s => s.serviceId === 'SCENE_3D')).toMatchObject({ status: 'AVAILABLE', version: SCENE_COMPILER_VERSION, workflowCapability: null });
    // The workflow registry still reports SCENE_3D as a planned workflow step; discovery does not contradict it.
    expect(CAPABILITIES.find(c => c.capabilityId === 'SCENE_3D')?.implementationStatus).toBe('PLANNED');
  });
  it('never presents a render, panorama or video as available, and only intent extraction among AI capabilities', () => {
    expect(MEDIA.filter(m => m.status === 'AVAILABLE').map(m => m.media)).toEqual(['INTERACTIVE_3D_MODEL']);
    for (const m of MEDIA.filter(m => m.status === 'UNSUPPORTED')) expect([m.serviceId, m.provider, m.mimeType, typeof m.reason]).toEqual([null, null, null, 'string']);
    expect(AI_CAPABILITIES.filter(c => c.status === 'AVAILABLE').map(c => c.capability)).toEqual(['ARCHITECTURAL_INTENT_EXTRACTION']);
  });

  it('R01-G3: the OpenAPI document is regenerated from the live routes and Zod contracts without drift, and the mapping is complete and not stale', () => {
    expect(openApiDocument(catalog)).toEqual(JSON.parse(readFileSync(OPENAPI, 'utf8')));
    const keys = new Set(catalog.map(r => `${r.method} ${r.url}`));
    expect(Object.keys(CONTRACTS).filter(k => !keys.has(k))).toEqual([]);
    expect([...keys].filter(k => !(k in CONTRACTS))).toEqual([]);
    expect(catalog.filter(r => ['POST', 'PATCH'].includes(r.method) && !CONTRACTS[`${r.method} ${r.url}`]!.body).map(r => r.url)).toEqual([]);
  });
  it('R01-G3: the exported JSON Schema accepts and rejects the same payloads as the Zod contracts', () => {
    const ajv = new Ajv({ allErrors: true });
    const cases: [import('zod').ZodTypeAny, unknown[]][] = [
      [GenerateRevisionRequestSchema, [{ requirements: parametricInput(true) }, { requirements: parametricInput(true), extra: 1 }, { requirements: { ...parametricInput(true), floors: 9 } }, {}]],
      [CreateProjectRequestSchema, [{ title: 'Villa' }, { title: '' }, { title: 'Villa', owner: 'x' }]],
      [WorkflowRequestSchema, [{ mode: 'BLUEPRINT_ONLY', source: { kind: 'REVISION', sourceRevisionId: randomUUID() } }, { mode: 'BLUEPRINT_ONLY', source: { kind: 'REVISION', sourceRevisionId: 'nope' } },
        { mode: 'TELEPORT', source: { kind: 'REVISION', sourceRevisionId: randomUUID() } }]],
      [SceneInputSchema, [{}, { lod: 3 }]],
    ];
    for (const [schema, samples] of cases) {
      const validate = ajv.compile(jsonSchema(schema, 'jsonSchema7'));
      for (const sample of samples) expect(validate(sample), JSON.stringify(sample).slice(0, 120)).toBe(schema.safeParse(sample).success);
    }
  });
});
