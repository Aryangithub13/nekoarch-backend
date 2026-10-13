import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { DocumentsManifestSchema, SchedulesResponseSchema } from '../src/contracts/documents.js';
import { readDocumentsManifest } from '../src/services/documents-service.js';
import { ApiError } from '../src/lib/errors.js';
import type { Repository } from '../src/lib/repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('Phase 38 construction documents on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, backend: ReturnType<typeof createPgBackend>;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), otherId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    backend = createPgBackend(db.pool, { owner: ownerId, other: otherId });
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
      PROJECT_COMMIT_SECRET: secret }), backend, captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const ok = async (method: 'GET' | 'POST', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await app.inject({ method, url, headers: owner, ...(payload === undefined ? {} : { payload: payload as Json }) });
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 400)}`).toBe(status);
    return r;
  };
  const project = async (title: string, model: unknown = authored()) => {
    const projectId = (await ok('POST', '/api/projects', { title })).json().id as string;
    const revision = (await ok('POST', `/api/projects/${projectId}/revisions`, { model })).json().revision as Json;
    return { projectId, revision, base: `/api/projects/${projectId}/revisions/${revision.id}` };
  };
  const failure = async (url: string, headers = owner) => { const r = await app.inject({ url, headers }); return [r.statusCode, r.json().error?.code ?? null]; };

  let a: Awaited<ReturnType<typeof project>>;
  it('D1/D2/D9: the manifest lists every sheet and schedule; each contentHash is the sha256 of the bytes its href serves; reads are byte-identical', async () => {
    a = await project('Phase 38 documents');
    const first = await ok('GET', `${a.base}/documents`), m = DocumentsManifestSchema.parse(first.json());
    expect(m).toMatchObject({ documentsVersion: 'construction-documents-v1', binding: { projectId: a.projectId, revisionId: a.revision.id, revisionNumber: 1,
      modelHash: a.revision.identity.modelHash, acceptanceQaId: a.revision.qa.id }, freshness: { documentStatus: 'CURRENT_REVISION', projectCurrentRevisionId: a.revision.id,
      revision: { state: 'CURRENT' }, acceptanceQa: { state: 'CURRENT' } }, claims: { professionalReview: 'NOT_RECORDED', codeCompliance: 'NOT_CLAIMED' } });
    expect(m.documents.map(d => d.documentId)).toEqual(['plan-sheet:ground', 'schedules', 'schedule:levels', 'schedule:rooms', 'schedule:doors', 'schedule:windows', 'schedule:openings']);
    expect(m.formats.filter(f => f.status === 'UNSUPPORTED').map(f => f.format)).toEqual(['PDF', 'DXF']);
    for (const d of m.documents) {
      const r = await ok('GET', d.href!);
      expect([sha(r.body), Buffer.byteLength(r.body)], d.documentId).toEqual([d.contentHash, d.bytes]);
      expect(r.headers['content-type'], d.documentId).toContain(d.mediaType);
      if (d.mediaType !== 'application/json') {
        expect(r.headers['content-disposition'], d.documentId).toMatch(/^attachment; filename="[a-z0-9-]+\.(svg|csv)"$/);
        expect(r.headers['x-content-type-options']).toBe('nosniff');
      }
    }
    expect((await ok('GET', `${a.base}/documents`)).body).toBe(first.body);
    const schedules = SchedulesResponseSchema.parse((await ok('GET', `${a.base}/documents/schedules`)).json());
    const model = a.revision.model as Json, rooms = schedules.schedules.find(s => s.scheduleId === 'rooms')!;
    expect(rooms.rows.map(r => r.spaceId)).toEqual(model.spaces.map((s: Json) => s.id).sort());
    expect(schedules.schedules.find(s => s.scheduleId === 'doors')!.rows.map(r => [r.openingId, r.widthMm])).toEqual(
      model.openings.filter((o: Json) => o.kind === 'door').map((o: Json) => [o.id, o.widthMm]).sort());
  });

  it('E8-style ownership and strict inputs on every documents route', async () => {
    const b = await project('Phase 38 other');
    for (const path of ['/documents', '/documents/plan-sheets/ground', '/documents/schedules', '/documents/schedules/rooms/csv']) {
      expect((await app.inject({ url: `${a.base}${path}` })).statusCode, path).toBe(401);
      expect(await failure(`${a.base}${path}`, other), path).toEqual([404, 'PROJECT_NOT_FOUND']);
      expect(await failure(`/api/projects/${a.projectId}/revisions/${b.revision.id}${path}`), path).toEqual([404, 'REVISION_NOT_FOUND']);
      expect((await app.inject({ url: `${a.base}${path}?expand=1`, headers: owner })).statusCode, path).toBe(400);
    }
    expect(await failure(`${a.base}/documents/plan-sheets/no-such-level`)).toEqual([404, 'DOCUMENT_NOT_FOUND']);
    expect(await failure(`${a.base}/documents/plan-sheets/..%2F..%2Fetc`)).toEqual([400, 'VALIDATION_ERROR']);
    expect(await failure(`${a.base}/documents/schedules/stairs/csv`)).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('D8: a superseded revision is a HISTORICAL_SNAPSHOT; require=current refuses it with 409', async () => {
    await ok('POST', `/api/projects/${a.projectId}/revisions`, { model: authored(), baseRevisionId: a.revision.id });
    const m = DocumentsManifestSchema.parse((await ok('GET', `${a.base}/documents`)).json());
    expect(m.freshness).toMatchObject({ documentStatus: 'HISTORICAL_SNAPSHOT', revision: { state: 'STALE_SOURCE_CHANGED', causes: [{ code: 'SOURCE_REVISION_SUPERSEDED' }] } });
    expect(m.binding.revisionId).toBe(a.revision.id);
    for (const path of ['/documents', '/documents/plan-sheets/ground', '/documents/schedules', '/documents/schedules/doors/csv'])
      expect(await failure(`${a.base}${path}?require=current`), path).toEqual([409, 'DOCUMENT_SOURCE_STALE']);
    // The historical sheet itself is still served, labelled by its own revision.
    expect((await ok('GET', `${a.base}/documents/plan-sheets/ground`)).body).toContain(`Revision 1 · ${a.revision.id}`);
  });

  it('D6: names cannot inject markup into a sheet or formulas into a CSV, end to end', async () => {
    const model = authored() as Json;
    model.spaces[0].name = '<script>alert(1)</script>'; model.spaces[1].name = '=cmd|"/c calc"!A1';
    const p = await project('Phase 38 escaping', model);
    const svg = (await ok('GET', `${p.base}/documents/plan-sheets/ground`)).body, csv = (await ok('GET', `${p.base}/documents/schedules/rooms/csv`)).body;
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
  });

  it('a generated two-storey revision gets one sheet per storey, each bound to its level', async () => {
    const projectId = (await ok('POST', '/api/projects', { title: 'Phase 38 storeys' })).json().id as string;
    const r = (await ok('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true) })).json().revision as Json;
    const m = DocumentsManifestSchema.parse((await ok('GET', `/api/projects/${projectId}/revisions/${r.id}/documents`)).json());
    const storeys = (r.model.levels as Json[]).filter(l => l.kind === 'storey');
    expect(m.documents.filter(d => d.kind === 'PLAN_SHEET').map(d => d.levelId).sort()).toEqual(storeys.map(l => l.id).sort());
    for (const d of m.documents.filter(x => x.kind === 'PLAN_SHEET')) expect((await ok('GET', d.href!)).body).toContain(`"levelId":"${d.levelId}"`.replace(/"/g, '&quot;'));
  }, 120_000);

  it('D7: an unverifiable identity, an unaccepted QA or a missing current revision fails closed with no document', async () => {
    const repo = backend.repository('owner'), p = await project('Phase 38 unverified');
    const refusal = async (r: Repository) => readDocumentsManifest(r, p.projectId, p.revision.id, false).then(() => 'PRODUCED',
      (e: unknown) => (e instanceof ApiError ? [e.statusCode, e.code, e.fieldErrors?.causes?.[0] ?? null] : e));
    const revisionReads = (patch: (r: Json) => Json): Repository => ({ ...repo, projectRpc: async (name, args) => {
      const r = await repo.projectRpc!(name, args) as Json;
      return args.p_action === 'revision' ? patch(r) : r;
    } });
    expect(await refusal(revisionReads(r => ({ ...r, identity: { ...r.identity, modelHash: 'f'.repeat(64) } }))))
      .toEqual([422, 'DOCUMENT_SOURCE_UNVERIFIED', `REVISION:${p.revision.id}: REVISION_IDENTITY_INCONSISTENT`]);
    expect(await refusal(revisionReads(r => ({ ...r, qaRuns: r.qaRuns.map((q: Json) => ({ ...q, status: 'FAIL' })) }))))
      .toEqual([422, 'DOCUMENT_SOURCE_UNVERIFIED', `ACCEPTANCE_QA:${p.revision.qa.id}: QA_NOT_ACCEPTED`]);
    const noCurrent: Repository = { ...repo, accountRpc: async (name, args) => {
      const r = await repo.accountRpc!(name, args) as Json;
      return name === 'context_read' ? { ...r, currentRevision: null } : r;
    } };
    expect((await refusal(noCurrent) as unknown[]).slice(0, 2)).toEqual([422, 'DOCUMENT_SOURCE_UNVERIFIED']);
    expect(await refusal(repo)).toBe('PRODUCED');
  });
});
