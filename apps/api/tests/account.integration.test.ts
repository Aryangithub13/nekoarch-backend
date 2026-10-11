import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { png } from '../../../test-support/reference-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { modelHash } from '../src/lib/generation-identity.js';

// Same convention as the Phase 30 suite: untyped JSON bodies in assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' }, quota = { authorization: 'Bearer quota' };

describe('Phase 33 account, library, briefs and context on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, quotaId: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool); quotaId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId, quota: quotaId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Json, headers: Record<string, string> = owner) =>
    app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  const project = async (title: string, headers = owner) => {
    const res = await call('POST', '/api/projects', { title }, headers);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  };
  const reference = async (projectId: string, width: number) => {
    const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/references?purpose=SITE_PHOTO`, headers: { ...owner, 'content-type': 'image/png' }, payload: png({ width }) });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  };

  it('settings: defaults, saved versions, stale writes refused, per user', async () => {
    expect((await call('GET', '/api/me/settings')).json()).toEqual({ version: 0, isDefault: true, updatedAt: null,
      settings: { units: 'METRIC', locale: 'en-IN', currency: 'INR', defaultRegion: null, defaultBuildingType: null } });
    const saved = await call('PATCH', '/api/me/settings', { expectedVersion: 0, settings: { units: 'IMPERIAL', defaultRegion: 'India baseline (illustrative)' } });
    expect(saved.json()).toMatchObject({ version: 1, isDefault: false, settings: { units: 'IMPERIAL', locale: 'en-IN', defaultRegion: 'India baseline (illustrative)' } });
    const stale = await call('PATCH', '/api/me/settings', { expectedVersion: 0, settings: { locale: 'hi' } });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);
    expect((await call('PATCH', '/api/me/settings', { expectedVersion: 1, settings: { locale: 'hi', defaultRegion: null } })).json())
      .toMatchObject({ version: 2, settings: { units: 'IMPERIAL', locale: 'hi', defaultRegion: null } });
    expect((await call('GET', '/api/me/settings', undefined, other)).json()).toMatchObject({ version: 0, isDefault: true });
    expect((await call('GET', '/api/me/settings', undefined, {})).statusCode).toBe(401);
    await expect(db.pool.query(`insert into public.user_settings(user_id,version,settings_json) values($1,1,'{"units":"METRIC"}')`, [randomUUID()])).rejects.toMatchObject({ code: '23514' });
  });

  it('library: escaped substring search, tags, stars, status, sort and keyset pagination, owner-only', async () => {
    const ids = { alpha: await project('Villa Alpha'), beta: await project('villa beta'), office: await project('100%_Office'), plain: await project('Plain house') };
    expect((await call('PATCH', `/api/projects/${ids.alpha}/library`, { starred: true, tags: ['g-plus-1', 'villa'] })).json())
      .toMatchObject({ projectId: ids.alpha, starred: true, tags: ['g-plus-1', 'villa'] });
    await call('PATCH', `/api/projects/${ids.plain}/library`, { tags: ['villa'] });
    await call('PATCH', `/api/projects/${ids.beta}`, { status: 'ARCHIVED' });
    const search = async (query: string, headers = owner) => (await call('GET', `/api/library/projects?${query}`, undefined, headers)).json() as Json;
    const titles = (body: Json) => body.items.map((i: Json) => i.title).sort();
    expect(titles(await search('q=VILLA&status=ALL'))).toEqual(['Plain house', 'Villa Alpha', 'villa beta']); // title or tag match
    expect(titles(await search('q=VILLA'))).toEqual(['Plain house', 'Villa Alpha']); // archived excluded by default
    expect(titles(await search(`q=${encodeURIComponent('%')}`))).toEqual(['100%_Office']); // a literal %, not a wildcard
    expect(titles(await search('q=_'))).toEqual(['100%_Office']);
    expect(titles(await search('starred=true'))).toEqual(['Villa Alpha']);
    expect(titles(await search('tag=g-plus-1'))).toEqual(['Villa Alpha']);
    expect(titles(await search('status=ARCHIVED'))).toEqual(['villa beta']);
    const ordered = (await search('sort=title&status=ALL')).items.map((i: Json) => i.title);
    expect(ordered.slice(0, 4)).toEqual(['100%_Office', 'Plain house', 'Villa Alpha', 'villa beta']);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Json = await search(`sort=title&status=ALL&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.items.map((i: Json) => i.title));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ordered);
    expect((await call('GET', `/api/library/projects?sort=updated&cursor=${Buffer.from(JSON.stringify({ sort: 'title', key: 'a', id: randomUUID() })).toString('base64url')}`)).statusCode).toBe(400);
    expect((await search('q=villa', other)).items).toEqual([]);
    expect((await call('PATCH', `/api/projects/${ids.alpha}/library`, { starred: false }, other)).statusCode).toBe(404);
    expect((await search('q=Alpha')).items[0]).toMatchObject({ referenceCount: 0, briefVersion: 0, revisionCount: 0 });
  });

  it('briefs: immutable versions with concurrency control and validated reference links', async () => {
    const projectId = await project('Brief house'), foreign = await project('Other house'), brief = `/api/projects/${projectId}/brief`;
    const ref = await reference(projectId, 12), foreignRef = await reference(foreign, 13), doomed = await reference(projectId, 14);
    expect((await call('GET', brief)).json()).toEqual({ projectId, version: 0, current: null });
    const v1 = await call('POST', `${brief}/versions`, { expectedVersion: 0, brief: { summary: '3BHK for a family of four', site: { plot: { width: 30, depth: 50, unit: 'ft' } },
      budget: { amount: 4500000, currency: 'INR', flexibility: 'MEDIUM' } } });
    expect(v1.statusCode, v1.body).toBe(201);
    expect(v1.json()).toMatchObject({ projectId, version: 1, createdBy: ownerId, provenance: { source: 'USER_STATED', verified: false }, claims: { budgetVerified: 'NOT_CLAIMED' },
      brief: { summary: '3BHK for a family of four', site: { plot: { width: 30, depth: 50, unit: 'ft' } }, program: {}, constraints: [], referenceIds: [] } });
    expect(v1.json().briefHash).toMatch(/^[a-f0-9]{64}$/);
    const stale = await call('POST', `${brief}/versions`, { expectedVersion: 0, brief: { summary: 'conflicting edit' } });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);
    for (const bad of [foreignRef, randomUUID()]) {
      const res = await call('POST', `${brief}/versions`, { expectedVersion: 1, brief: { summary: 'x', referenceIds: [bad] } });
      expect([res.statusCode, res.json().error.code]).toEqual([422, 'BRIEF_REFERENCE_INVALID']);
    }
    await call('DELETE', `/api/projects/${projectId}/references/${doomed}`);
    expect((await call('POST', `${brief}/versions`, { expectedVersion: 1, brief: { summary: 'x', referenceIds: [doomed] } })).statusCode).toBe(422);
    const key = { ...owner, 'idempotency-key': 'phase33-brief-2' }, payload = { expectedVersion: 1, brief: { summary: 'Add a home office', referenceIds: [ref] } };
    const v2 = await call('POST', `${brief}/versions`, payload, key), replay = await call('POST', `${brief}/versions`, payload, key);
    expect([v2.statusCode, replay.statusCode, replay.json()]).toEqual([201, 201, v2.json()]);
    expect((await call('GET', brief)).json()).toMatchObject({ version: 2, current: { version: 2, brief: { referenceIds: [ref] } } });
    expect((await call('GET', `${brief}/versions`)).json().items.map((i: Json) => i.version)).toEqual([2, 1]);
    expect((await call('GET', `${brief}/versions/1`)).json().brief.summary).toBe('3BHK for a family of four');
    expect((await call('GET', `${brief}/versions/99`)).json().error.code).toBe('BRIEF_VERSION_NOT_FOUND');
    for (const res of [await call('GET', brief, undefined, other), await call('POST', `${brief}/versions`, { expectedVersion: 2, brief: { summary: 'x' } }, other)])
      expect(res.statusCode).toBe(404);
    await expect(db.pool.query('update public.project_briefs set brief_json = $2 where project_id = $1', [projectId, { summary: 'rewritten' }])).rejects.toThrow();
  });

  it('context: one consistent, hashed snapshot whose model hash matches the TypeScript identity', async () => {
    const projectId = await project('Context house');
    const generated = await call('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true) });
    expect(generated.statusCode, generated.body.slice(0, 300)).toBe(201);
    const ref = await reference(projectId, 15);
    await call('POST', `/api/projects/${projectId}/brief/versions`, { expectedVersion: 0, brief: { summary: 'Context brief', referenceIds: [ref] } });
    const first = (await call('GET', `/api/projects/${projectId}/context`)).json(), again = (await call('GET', `/api/projects/${projectId}/context`)).json();
    expect(first).toMatchObject({ contextVersion: 'project-context-v1', projectId, brief: { version: 1 }, settings: { version: 2, settings: { units: 'IMPERIAL' } },
      currentRevision: { id: generated.json().revision.id, revisionNumber: 1, qaStatus: expect.stringMatching(/^PASS/) },
      references: [{ id: ref, linkedFromBrief: true, currency: 'PROJECT_SCOPED' }], activeJobs: [], claims: { siteVerified: 'NOT_CLAIMED' } });
    expect(first.currentRevision.modelHash).toBe(modelHash(generated.json().revision.model));
    expect(again.contextHash).toBe(first.contextHash);
    await call('POST', `/api/projects/${projectId}/brief/versions`, { expectedVersion: 1, brief: { summary: 'Changed brief' } });
    const changed = (await call('GET', `/api/projects/${projectId}/context`)).json();
    expect([changed.brief.version, changed.contextHash === first.contextHash, changed.references[0].linkedFromBrief]).toEqual([2, false, false]);
    expect((await call('GET', `/api/projects/${projectId}/context`, undefined, other)).statusCode).toBe(404);
    expect((await call('GET', `/api/projects/${projectId}/context`, undefined, {})).statusCode).toBe(401);
  });

  it('usage and account quotas, enforced on the base tables', async () => {
    const usage = (await call('GET', '/api/me/usage')).json();
    // Earlier tests in this file: 7 projects (1 archived), 1 revision, 3 live references (one more was deleted).
    expect(usage).toMatchObject({ projects: { active: 6, archived: 1 }, revisions: 1, references: { count: 3 }, jobs: { active: 0 },
      limits: { projects: 200, referenceBytes: 1_073_741_824, activeJobs: 8 } });
    // Projects: 200 per owner, whichever path inserts them.
    await db.pool.query("insert into public.projects(owner_id,title) select $1, 'bulk ' || g from generate_series(1,200) g", [quotaId]);
    const refused = await call('POST', '/api/projects', { title: 'one too many' }, quota);
    expect([refused.statusCode, refused.json().error.code]).toEqual([429, 'ACCOUNT_QUOTA_EXCEEDED']);
    await expect(db.pool.query("insert into public.projects(owner_id,title) values ($1,'direct')", [quotaId])).rejects.toMatchObject({ code: 'P3304' });
    // Active jobs: 8 per owner across projects (the per-project limit of 4 is separate).
    const projects = (await db.pool.query('select id from public.projects where owner_id=$1 order by title limit 3', [quotaId])).rows.map(r => r.id as string);
    const job = (projectId: string) => db.pool.query(`insert into public.project_jobs(project_id,owner_id,kind,status,job_version,request_json,input_hash,progress_json)
      values ($1,$2,'SCENE_COMPILE','QUEUED','durable-job-v1',jsonb_build_object('kind','SCENE_COMPILE','revisionId',gen_random_uuid()),encode(extensions.gen_random_bytes(32),'hex'),
      '{"stage":"QUEUED","percent":0,"message":"q"}')`, [projectId, quotaId]);
    for (let i = 0; i < 8; i++) await job(projects[i % 3]!);
    await expect(job(projects[0]!)).rejects.toMatchObject({ code: 'P3304' });
    // Reference bytes: 1 GiB per owner across projects.
    const seed = await reference(await project('Quota refs'), 16);
    await db.pool.query(`insert into public.project_references(project_id,uploaded_by,status,purpose,media_type,original_sha256,original_bytes,stored_sha256,stored_bytes,
      storage_locator,inspector_version,provenance_json)
      select project_id,uploaded_by,'ACTIVE',purpose,media_type,original_sha256,original_bytes,md5(g::text)||md5(g::text),10485760,storage_locator,inspector_version,
      jsonb_set(jsonb_set(provenance_json,'{stored,sha256}',to_jsonb(md5(g::text)||md5(g::text))),'{stored,bytes}','10485760')
      from public.project_references, generate_series(1,102) g where id=$1`, [seed]);
    // Top the owner up to 10 bytes below 1 GiB, so the next real upload is the one that crosses it.
    await db.pool.query(`insert into public.project_references(project_id,uploaded_by,status,purpose,media_type,original_sha256,original_bytes,stored_sha256,stored_bytes,
      storage_locator,inspector_version,provenance_json)
      select r.project_id,r.uploaded_by,'ACTIVE',r.purpose,r.media_type,r.original_sha256,r.original_bytes,repeat('e',64),t.fill,r.storage_locator,r.inspector_version,
      jsonb_set(jsonb_set(r.provenance_json,'{stored,sha256}',to_jsonb(repeat('e',64))),'{stored,bytes}',to_jsonb(t.fill))
      from public.project_references r, (select (1073741824 - 10 - sum(x.stored_bytes))::integer fill from public.project_references x join public.projects p on p.id=x.project_id
        where p.owner_id=$2 and x.status<>'DELETED') t where r.id=$1`, [seed, ownerId]);
    const over = await app.inject({ method: 'POST', url: `/api/projects/${await project('Quota refs 2')}/references?purpose=OTHER`, headers: { ...owner, 'content-type': 'image/png' },
      payload: png({ width: 17 }) });
    expect([over.statusCode, over.json().error.code]).toEqual([429, 'ACCOUNT_QUOTA_EXCEEDED']);
    expect((await asPrincipal(db.pool, otherId, c => c.query('select * from public.project_library'))).rows).toEqual([]);
  });
});
