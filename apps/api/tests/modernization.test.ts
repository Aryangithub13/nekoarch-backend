import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ApiError } from '../src/lib/errors.js';
import type { Backend, Repository } from '../src/lib/repository.js';
import { CAPABILITIES, MODES } from '../src/workflows/registry.js';
import { AI_CAPABILITIES } from '../src/ai/orchestration/registry.js';
import { OPENAPI_SHA256 } from '../src/delivery/openapi-hash.js';
import { DISCOVERY_VERSION, MEDIA, SERVICES } from '../src/services/overview-service.js';
import { SpecialistParamsSchema } from '../src/contracts/specialists.js';
import { SCENE_COMPILER_VERSION, SceneInputSchema } from '../src/scene3d/contracts.js';
import { CreateProjectRequestSchema, GenerateRevisionRequestSchema } from '../src/contracts/projects.js';
import { WorkflowRequestSchema } from '../src/contracts/workflows.js';
import { CONTRACTS, ERROR_CODES, PATH_PARAMS, jsonSchema, openApiDocument } from '../../../test-support/openapi.js';
import { errorCatalog, type ErrorCatalog } from '../../../test-support/error-catalog.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { fixturePlan } from '../../../test-support/fixtures.js';
// Test-only: Ajv 6 (draft-07) is already in the lockfile through the lint toolchain; it independently checks the exported JSON Schema.
import Ajv from 'ajv';

/** Source-derived route catalog (docs/modernization/api-routes.json). Regenerate with UPDATE_ROUTE_CATALOG=1 after an intentional API change. */
const CATALOG = new URL('../../../docs/modernization/api-routes.json', import.meta.url), OPENAPI = new URL('../../../docs/modernization/openapi.json', import.meta.url);
const OPENAPI_HASH = new URL('../src/delivery/openapi-hash.ts', import.meta.url);
const notFound = () => { throw new ApiError(404, 'NOT_FOUND', 'Resource not found'); };
const repository = new Proxy({}, { get: () => async () => notFound() }) as Repository;
const backend: Backend = { authenticate: async () => ({ id: randomUUID() }), repository: () => repository, ready: async () => undefined };
const app = buildApp({ env: parseEnv({ NODE_ENV: 'test', SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false' }),
  backend, captureError: () => undefined });
const routes: { method: string; url: string }[] = [];
app.addHook('onRoute', r => { for (const method of [r.method].flat()) if (method !== 'OPTIONS') routes.push({ method, url: r.url }); });
const concrete = (url: string) => url.replace(/:elementId/g, `bim-${'a'.repeat(40)}`).replace(/:[A-Za-z]+/g, () => randomUUID());

describe('modernization R01/R06: source-derived API catalog and anonymous-access inventory', () => {
  let catalog: { method: string; url: string; anonymous: number }[], errors: ErrorCatalog;
  beforeAll(async () => {
    errors = errorCatalog();
    await app.ready();
    catalog = [];
    for (const r of [...routes].sort((a, b) => a.url.localeCompare(b.url, 'en') || a.method.localeCompare(b.method, 'en'))) {
      const res = await app.inject({ method: r.method as 'GET', url: concrete(r.url), ...(r.method === 'GET' ? {} : { payload: {} }) });
      catalog.push({ ...r, anonymous: res.statusCode });
    }
    if (process.env.UPDATE_ROUTE_CATALOG === '1') {
      writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + '\n');
      writeFileSync(ERROR_CODES, JSON.stringify(errors, null, 1) + '\n'); // before the OpenAPI document, which embeds it
      const document = JSON.stringify(openApiDocument(catalog), null, 1) + '\n';
      writeFileSync(OPENAPI, document);
      writeFileSync(OPENAPI_HASH, readFileSync(OPENAPI_HASH, 'utf8').replace(/'[a-f0-9]{64}'/, `'${createHash('sha256').update(document).digest('hex')}'`));
    }
  }, 60_000);
  afterAll(async () => { await app.close(); });

  it('matches the checked-in catalog (no undocumented route, no silently removed route)', () => {
    expect(catalog).toEqual(JSON.parse(readFileSync(CATALOG, 'utf8')));
  });
  it('requires a session on every project-scoped route; anonymous access is limited to an explicit allowlist', () => {
    const open = catalog.filter(r => r.anonymous !== 401).map(r => `${r.method} ${r.url}`).sort();
    const anonymousReads = ['GET /api/capabilities', 'GET /api/plans/:id', 'GET /api/projects/:projectId/public', 'GET /api/regions', 'GET /health/live', 'GET /health/ready',
      'HEAD /health/live', 'HEAD /health/ready'];
    // Phase 5 routes that parse the body before authenticating (an empty body is a 400 before the 401); they still require a session. Finding R06-F1.
    const validateBeforeAuth = ['POST /api/estimates', 'POST /api/plans', 'POST /api/plans/generate', 'PATCH /api/plans/:id'];
    // Phase 31: the signed reference link is its own authorization; anything that is not a valid token is the uniform 404.
    const tokenAuthorized = ['GET /api/reference-downloads'];
    expect(open).toEqual([...anonymousReads, ...validateBeforeAuth, ...tokenAuthorized].sort());
    for (const r of validateBeforeAuth) expect(catalog.find(c => `${c.method} ${c.url}` === r)?.anonymous, r).toBe(400);
    for (const r of tokenAuthorized) expect(catalog.find(c => `${c.method} ${c.url}` === r)?.anonymous, r).toBe(404);
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
  it('never presents a render, panorama or video as available, and only intent extraction and the Phase 39 design concepts among AI capabilities', () => {
    // Phase 30 adds the bounded exterior appearance variant (still a visual 3D model, never a render).
    expect(MEDIA.filter(m => m.status === 'AVAILABLE').map(m => m.media)).toEqual(['INTERACTIVE_3D_MODEL', 'APPEARANCE_VARIANT_3D_MODEL']);
    for (const m of MEDIA.filter(m => m.status === 'UNSUPPORTED')) expect([m.serviceId, m.provider, m.mimeType, typeof m.reason]).toEqual([null, null, null, 'string']);
    // Phase 39 concepts are structured advisory text; image, render and 3D generation stay planned.
    expect(AI_CAPABILITIES.filter(c => c.status === 'AVAILABLE').map(c => c.capability)).toEqual(['ARCHITECTURAL_INTENT_EXTRACTION', 'INTERIOR_DESIGN_CONCEPT', 'EXTERIOR_DESIGN_CONCEPT']);
    for (const c of ['INTERIOR_VISUALIZATION', 'EXTERIOR_VISUALIZATION', 'IMAGE_CONCEPT_GENERATION', 'MODEL_3D_GENERATION', 'DOCUMENT_ANALYSIS', 'ENGINEERING_ASSISTANCE'])
      expect(AI_CAPABILITIES.find(x => x.capability === c)?.status).toBe('PLANNED');
  });

  it('R01-G3: the OpenAPI document is regenerated from the live routes and Zod contracts without drift, and the mapping is complete and not stale', () => {
    expect(openApiDocument(catalog)).toEqual(JSON.parse(readFileSync(OPENAPI, 'utf8')));
    const keys = new Set(catalog.map(r => `${r.method} ${r.url}`));
    expect(Object.keys(CONTRACTS).filter(k => !keys.has(k))).toEqual([]);
    expect([...keys].filter(k => !(k in CONTRACTS))).toEqual([]);
    // Every write documents its request body: a JSON contract, or (Phase 31 uploads) the accepted raw media types.
    expect(catalog.filter(r => ['POST', 'PATCH'].includes(r.method) && !CONTRACTS[`${r.method} ${r.url}`]!.body && !CONTRACTS[`${r.method} ${r.url}`]!.rawBody).map(r => r.url)).toEqual([]);
  });
  it('INT-B-005: every documented path parameter schema is the one the handler enforces', async () => {
    // Values drawn from the PUBLISHED parameter schema must pass the handler's own params parsing; a value outside it must be refused for that parameter.
    const doc = openApiDocument(catalog) as { paths: Record<string, Record<string, { parameters: { name: string; in: string; schema: Record<string, unknown> }[] }>> };
    const samples = (schema: Record<string, unknown>): string[] => schema.format === 'uuid' ? [randomUUID()] : Array.isArray(schema.enum) ? schema.enum.map(String)
      : schema.type === 'integer' ? ['1'] : [`bim-${'a'.repeat(40)}`, 'level-1'].filter(v => new RegExp(String(schema.pattern)).test(v)).slice(0, 1);
    const published = (r: { method: string; url: string }) => Object.fromEntries(doc.paths[r.url.replace(/:([A-Za-z]+)/g, '{$1}')]![r.method.toLowerCase()]!
      .parameters.filter(p => p.in === 'path').map(p => [p.name, p.schema]));
    const fieldErrors = async (method: string, url: string) => {
      const res = await app.inject({ method: method as 'GET', url, headers: { authorization: 'Bearer conformance' }, ...(['GET', 'HEAD', 'DELETE'].includes(method) ? {} : { payload: {} }) });
      return (res.json() as { error?: { fieldErrors?: Record<string, string[]> } }).error?.fieldErrors ?? {};
    };
    let checked = 0;
    for (const r of catalog.filter(c => c.url.includes(':') && c.method !== 'HEAD')) {
      const names = [...r.url.matchAll(/:([A-Za-z]+)/g)].map(m => m[1]!), schemas = published(r);
      expect(Object.keys(schemas).sort(), `${r.method} ${r.url}`).toEqual([...names].sort());
      const fill = (target: string, value: string) => r.url.replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(name === target ? value : samples(schemas[name]!)[0]!));
      for (const name of names) {
        const valid = samples(schemas[name]!);
        expect(valid.length, `${r.method} ${r.url} :${name} has a sample`).toBeGreaterThan(0);
        for (const value of valid) expect(await fieldErrors(r.method, fill(name, value)), `${r.method} ${r.url} :${name}=${value}`).not.toHaveProperty(name);
        if (r.method === 'GET' || r.method === 'DELETE') expect(await fieldErrors(r.method, fill(name, 'not~valid')), `${r.method} ${r.url} :${name} refuses a value outside its schema`).toHaveProperty(name);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(250);
    // The three parameters that were wrongly published as UUIDs; the source table must agree with the document.
    for (const [name, schema] of Object.entries(PATH_PARAMS)) expect(JSON.stringify(jsonSchema(schema)), name).not.toContain('uuid');
    const param = (path: string, name: string) => Object.values(doc.paths[path]!)[0]!.parameters.find(p => p.name === name)!.schema;
    expect(param('/api/projects/{projectId}/specialists/{module}/requests', 'module').enum).toEqual(SpecialistParamsSchema.shape.module.options);
    expect(param('/api/projects/{projectId}/revisions/{revisionId}/documents/schedules/{schedule}/csv', 'schedule')).toHaveProperty('enum');
    expect(param('/api/projects/{projectId}/revisions/{revisionId}/documents/plan-sheets/{levelId}', 'levelId')).toMatchObject({ type: 'string', pattern: expect.any(String) });
  }, 120_000);
  it('INT-B-006: every route that requires a session is documented with bearer security, including the four that validate first', async () => {
    const doc = openApiDocument(catalog) as { paths: Record<string, Record<string, { security?: unknown }>> };
    for (const r of catalog) {
      const op = doc.paths[r.url.replace(/:([A-Za-z]+)/g, '{$1}')]![r.method.toLowerCase()]!;
      expect([`${r.method} ${r.url}`, 'security' in op]).toEqual([`${r.method} ${r.url}`, r.anonymous === 401 || CONTRACTS[`${r.method} ${r.url}`]!.auth === true]);
    }
    // R06-F1 (accepted) keeps their validate-then-authenticate order; a VALID body without a session proves the session requirement that `auth` declares.
    const valid: Record<string, [string, unknown]> = {
      'POST /api/estimates': ['/api/estimates', { location: 'Pune', buildingType: 'residential', builtUpAreaSqft: 1200 }],
      'POST /api/plans': ['/api/plans', { plan: fixturePlan() }], 'POST /api/plans/generate': ['/api/plans/generate', { prompt: '2BHK with open kitchen' }],
      'PATCH /api/plans/:id': [`/api/plans/${randomUUID()}`, { isPublic: true }] };
    expect(Object.entries(CONTRACTS).filter(([, op]) => op.auth).map(([key]) => key).sort()).toEqual(Object.keys(valid).sort());
    for (const [key, [url, payload]] of Object.entries(valid)) {
      const res = await app.inject({ method: key.split(' ')[0] as 'POST', url, payload: payload as Record<string, unknown> });
      expect([key, res.statusCode]).toEqual([key, 401]);
    }
  });
  it('INT-B-007: documents every success status a handler can choose', () => {
    const routesDir = new URL('../src/routes/', import.meta.url);
    const source = readdirSync(routesDir).map(file => readFileSync(new URL(file, routesDir), 'utf8')).join('\n');
    const pair = (statuses: (number | string)[]) => statuses.map(String).sort().join('/');
    const chosen = [...source.matchAll(/code\([^)?]*\?\s*(\d{3})\s*:\s*(\d{3})\s*\)/g)].map(([, a, b]) => pair([a!, b!])).sort();
    const documented = Object.values(CONTRACTS).filter(op => op.alternatives?.some(a => a.body !== false))
      .map(op => pair([op.status ?? 200, ...op.alternatives!.map(a => a.status)])).sort();
    expect(chosen.length).toBeGreaterThan(0);
    expect(documented).toEqual(chosen);
    const delivery = (openApiDocument(catalog) as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> })
      .paths['/api/projects/{projectId}/revisions/{revisionId}/scene/delivery']!.get!.responses;
    expect(Object.keys(delivery).sort()).toEqual(['200', '304', 'default']);
  });
  it('INT-B-008: no new JSON route ships without a response schema, and the version names the live route catalog', async () => {
    // Shrink this list as response schemas are exported; a new untyped JSON route fails here.
    const untyped = ['GET /api/capabilities', 'GET /api/projects/:projectId/workflows', 'GET /api/projects/:projectId/revisions/:revisionId/overview',
      ...['', '/diff/:otherRevisionId', '/elements', '/elements/:elementId', '/export.json', '/relationships', '/validation'].map(v => `GET /api/projects/:projectId/revisions/:revisionId/bim${v}`),
      ...['environmental', 'knowledge', 'structural', 'systems'].flatMap(e => [`GET /api/projects/:projectId/revisions/:revisionId/${e}/analyses`,
        `GET /api/projects/:projectId/revisions/:revisionId/${e}/status`, `POST /api/projects/:projectId/revisions/:revisionId/${e}/validate`]),
      'GET /api/projects/:projectId/revisions/:revisionId/knowledge/packs', 'GET /api/projects/:projectId/revisions/:revisionId/optimization/status',
      'GET /api/projects/:projectId/revisions/:revisionId/optimization/studies', 'POST /api/projects/:projectId/revisions/:revisionId/optimization/validate',
      'GET /api/projects/:projectId/revisions/:revisionId/scene/artifacts', 'GET /api/projects/:projectId/revisions/:revisionId/scene/status',
      'POST /api/projects/:projectId/revisions/:revisionId/scene/validate'];
    expect(catalog.filter(r => r.method !== 'HEAD' && !CONTRACTS[`${r.method} ${r.url}`]!.media && !CONTRACTS[`${r.method} ${r.url}`]!.response)
      .map(r => `${r.method} ${r.url}`).sort()).toEqual(untyped.sort());
    const live = (await app.inject({ method: 'GET', url: '/api/compatibility', headers: { authorization: 'Bearer conformance' } })).json();
    expect(openApiDocument(catalog).info.version).toBe(`${live.compatibilityVersion}+${live.routeCatalog.routes}.${String(live.routeCatalog.sha256).slice(0, 12)}`);
  });
  it('INT-B-012: the error-code catalog lists every code the source can send, with each status it is sent with', () => {
    expect(errors).toEqual(JSON.parse(readFileSync(ERROR_CODES, 'utf8')));
    expect(errors.codes.length).toBeGreaterThan(250);
    for (const { code, statuses } of errors.codes) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(statuses.length, code).toBeGreaterThan(0);
      for (const status of statuses) expect(status >= 400 && status <= 599, `${code} ${status}`).toBe(true);
    }
    const statuses = (code: string) => errors.codes.find(c => c.code === code)?.statuses;
    // Codes reached through the checker's narrowing of engine errors, SQLSTATE tables and per-code status maps.
    expect(statuses('STRUCTURAL_RESULT_STALE')).toEqual([409]);
    expect(statuses('STRUCTURAL_SOLVER_FAILED')).toEqual([422]);
    expect(statuses('REFERENCE_LIMIT_EXCEEDED')).toEqual([429]);
    expect(statuses('SCENE_INPUT_INVALID')).toEqual([400]);
    expect(statuses('COMMIT_ATTESTATION_UNAVAILABLE')).toEqual([503]);
    // The audit's inconsistency stays visible rather than hidden: one code, two statuses.
    expect(statuses('SCENE_SOURCE_MISMATCH')).toEqual([409, 422]);
    // The only sites the checker cannot resolve, and why: Fastify's own 4xx status, and worker-reported refusal codes typed as string.
    expect(errors.unresolved.map(u => u.file)).toEqual(['apps/api/src/app.ts', 'apps/api/src/services/revision-service.ts']);
    expect((openApiDocument(catalog) as { components: { 'x-error-codes': unknown } }).components['x-error-codes'])
      .toEqual(errors.codes.map(({ code, statuses }) => ({ code, statuses })));
  });
  it('every $ref in the OpenAPI document resolves (1,007 of 2,754 on the base branch pointed nowhere)', () => {
    const doc = openApiDocument(catalog), refs: string[] = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (k === '$ref') refs.push(v as string); else walk(v); }
    };
    walk(doc);
    const resolves = (ref: string) => ref.startsWith('#/') && ref.slice(2).split('/').reduce<unknown>((at, part) =>
      at && typeof at === 'object' ? (at as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined, doc) !== undefined;
    expect(refs.length).toBeGreaterThan(100);
    expect([...new Set(refs.filter(ref => !resolves(ref)))]).toEqual([]);
  });
  it('INT-B-021: the published contract says that FAILED does not mean "nothing changed", and which field does', () => {
    type Schema = { properties: Record<string, { description?: string }> };
    const doc = openApiDocument(catalog) as { paths: Record<string, Record<string, { responses: Record<string, { description: string; content?: { 'application/json': { schema: Schema } } }> }>> };
    const props = (path: string) => doc.paths[path]!.post!.responses['201']!.content!['application/json'].schema.properties;
    const specialist = props('/api/projects/{projectId}/specialists/{module}/requests'), integration = props('/api/projects/{projectId}/integration/plans/execute');
    expect(specialist.resultRevisionId!.description).toMatch(/non-null even when status is FAILED/);
    expect(specialist.written!.description).toMatch(/whatever its status/);
    expect(integration.committedRevisionId!.description).toMatch(/non-null also when status is FAILED or PARTIAL/);
    expect(doc.paths['/api/projects/{projectId}/integration/plans/execute']!.post!.responses['200']!.description).toMatch(/nothing was written/);
  });
  it('INT-B-022: /api/compatibility publishes the sha256 of the checked-in OpenAPI document, so a schema change is visible, not only a route change', async () => {
    const document = readFileSync(OPENAPI, 'utf8');
    expect(document).toBe(JSON.stringify(openApiDocument(catalog), null, 1) + '\n');
    expect(OPENAPI_SHA256).toBe(createHash('sha256').update(document).digest('hex'));
    const live = (await app.inject({ method: 'GET', url: '/api/compatibility', headers: { authorization: 'Bearer conformance' } })).json();
    expect(live.openapi).toEqual({ sha256: OPENAPI_SHA256 });
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
