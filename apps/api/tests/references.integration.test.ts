import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { jpeg, pdf, png } from '../../../test-support/reference-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { REFERENCE_ROOT, downloadToken } from '../src/services/reference-service.js';
import { inspectReference } from '../src/references/inspect.js';
import { REFERENCE_LIMITS } from '../src/references/contracts.js';

const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

describe('Phase 31 reference ingestion on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const project = async (title = 'Phase 31 references') => {
    const p = await app.inject({ method: 'POST', url: '/api/projects', headers: owner, payload: { title } });
    expect(p.statusCode, p.body).toBe(201);
    return { id: p.json().id as string, root: `/api/projects/${p.json().id}/references` };
  };
  const upload = (root: string, bytes: Buffer, type: string, query = 'purpose=SITE_PHOTO', headers: Record<string, string> = owner) =>
    app.inject({ method: 'POST', url: `${root}?${query}`, headers: { ...headers, 'content-type': type }, payload: bytes });
  const count = async (sql: string, values: unknown[]) => Number((await db.pool.query(sql, values)).rows[0].n);

  it('stores an inspected file privately with provenance, metadata removed, and serves the exact stored bytes', async () => {
    const { id, root } = await project(), bytes = png({ text: true });
    const res = await upload(root, bytes, 'image/png', 'purpose=SITE_PHOTO&displayName=North%20boundary%20wall&note=Taken%20from%20the%20gate');
    expect(res.statusCode, res.body).toBe(201);
    const ref = res.json();
    expect(ref).toMatchObject({ projectId: id, status: 'ACTIVE', purpose: 'SITE_PHOTO', displayName: 'North boundary wall', mediaType: 'image/png',
      originalSha256: sha(bytes), originalBytes: bytes.length, storageLocator: 'postgres-bytea', boundRevisionId: null, uploadedBy: ownerId, deduplicated: false,
      currency: { status: 'PROJECT_SCOPED', boundRevisionId: null } });
    expect(ref.storedBytes).toBeLessThan(bytes.length);
    expect(ref.provenance).toMatchObject({ sourceKind: 'USER_UPLOAD', transformations: ['METADATA_REMOVED'],
      inspection: { verdict: 'ACCEPTED', malwareScan: { status: 'NOT_PERFORMED' }, claims: { malwareFree: 'NOT_CLAIMED' } } });
    expect(ref.events.map((e: { eventType: string }) => e.eventType)).toEqual(['UPLOADED']);

    const content = await app.inject({ url: `${root}/${ref.id}/content`, headers: owner });
    expect(content.statusCode).toBe(200);
    expect([sha(content.rawPayload), content.rawPayload.includes('28.6139')]).toEqual([ref.storedSha256, false]);
    expect(content.headers).toMatchObject({ 'content-type': 'image/png', etag: `"${ref.storedSha256}"`, 'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'", 'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="reference-${ref.id}.png"` });
    expect((await app.inject({ url: `${root}/${ref.id}/content`, headers: { ...owner, 'if-none-match': `"${ref.storedSha256}"` } })).statusCode).toBe(304);
    expect((await app.inject({ url: root, headers: owner })).json().items.map((i: { id: string }) => i.id)).toEqual([ref.id]);
    expect((await app.inject({ url: `${root}/usage`, headers: owner })).json()).toMatchObject({ projectId: id, references: 1, storedBytes: ref.storedBytes, attemptsLastHour: 1,
      malwareScan: 'NOT_PERFORMED' });
    // The raw tables are invisible to the API roles: bytes only through the definer functions.
    await expect(asPrincipal(db.pool, ownerId, c => c.query('select bytes from public.project_reference_blobs'))).rejects.toMatchObject({ code: '42501' });
    expect((await asPrincipal(db.pool, otherId, c => c.query('select id from public.project_references where id=$1', [ref.id]))).rows).toHaveLength(0);
  });

  it('deduplicates identical stored bytes within a project and records the attempt', async () => {
    const { root } = await project(), first = await upload(root, jpeg({ exif: true }), 'image/jpeg');
    const second = await upload(root, jpeg({ exif: true }), 'image/jpeg', 'purpose=OTHER');
    expect([first.statusCode, second.statusCode, second.json().id, second.json().deduplicated]).toEqual([201, 200, first.json().id, true]);
    expect(second.json().events.map((e: { eventType: string }) => e.eventType)).toEqual(['DEDUPLICATED', 'UPLOADED']);
  });

  it('refuses a hostile file with typed findings, audits it by hash only and stores no bytes', async () => {
    const { id, root } = await project(), bytes = pdf({ catalog: '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>' });
    const blobs = await count('select count(*) n from public.project_reference_blobs', []);
    const res = await upload(root, bytes, 'application/pdf', 'purpose=DOCUMENT');
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'REFERENCE_REJECTED', fieldErrors: { PDF_ACTIVE_CONTENT: ['Active content /OpenAction'] } });
    expect(await count('select count(*) n from public.project_references where project_id=$1', [id])).toBe(0);
    expect(await count('select count(*) n from public.project_reference_blobs', [])).toBe(blobs);
    const audit = (await db.pool.query("select detail from public.project_reference_events where project_id=$1 and event_type='REJECTED'", [id])).rows;
    expect(audit).toEqual([{ detail: { originalSha256: sha(bytes), originalBytes: bytes.length, codes: ['PDF_ACTIVE_CONTENT'] } }]);
    // Mislabelled content is refused by inspection; an unsupported declared type never reaches it.
    expect((await upload(root, png(), 'image/jpeg')).json().error.fieldErrors).toHaveProperty('TYPE_MISMATCH');
    for (const type of ['text/html', 'image/svg+xml', 'application/zip']) {
      expect((await upload(root, Buffer.from('<html/>'), type)).json().error.code, type).toBe('REFERENCE_TYPE_UNSUPPORTED');
    }
    expect((await app.inject({ method: 'POST', url: `${root}?purpose=SKETCH`, headers: owner, payload: { not: 'a file' } })).statusCode).toBe(415);
    const tooLarge = await upload(root, Buffer.alloc(REFERENCE_LIMITS.maxBytes + 1), 'image/png');
    expect([tooLarge.statusCode, tooLarge.json().error.code]).toEqual([400, 'PAYLOAD_TOO_LARGE']);
  });

  it('validate inspects without storing or auditing anything', async () => {
    const { id, root } = await project(), res = await app.inject({ method: 'POST', url: `${root}/validate`, headers: { ...owner, 'content-type': 'image/jpeg' },
      payload: jpeg({ exif: true, comment: true }) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ stored: false, report: { verdict: 'ACCEPTED', metadata: { removed: [{ segment: 'APP1' }, { segment: 'COM' }] } } });
    expect(await count('select count(*) n from public.project_reference_events where project_id=$1', [id])).toBe(0);
  });

  it('hides every reference route from another user (404), and anonymous callers get 401', async () => {
    const { root } = await project(), ref = (await upload(root, png(), 'image/png')).json();
    const item = `${root}/${ref.id}`;
    const attempts = [
      app.inject({ url: root, headers: other }), app.inject({ url: `${root}/usage`, headers: other }), app.inject({ url: item, headers: other }),
      app.inject({ url: `${item}/content`, headers: other }), app.inject({ method: 'PATCH', url: item, headers: other, payload: { status: 'ARCHIVED' } }),
      app.inject({ method: 'DELETE', url: item, headers: other }), app.inject({ method: 'POST', url: `${item}/download-links`, headers: other, payload: {} }),
      upload(root, jpeg(), 'image/jpeg', 'purpose=OTHER', other),
      app.inject({ method: 'POST', url: `${root}/validate`, headers: { ...other, 'content-type': 'image/png' }, payload: png() }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.statusCode, res.body).toBe(404);
    expect((await app.inject({ url: item })).statusCode).toBe(401);
    expect((await app.inject({ url: item, headers: owner })).json().status).toBe('ACTIVE');
  });

  it('enforces the lifecycle in the API and in the database', async () => {
    const { root } = await project(), ref = (await upload(root, png({ width: 5 }), 'image/png', 'purpose=SKETCH')).json(), item = `${root}/${ref.id}`;
    const patch = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: item, headers: owner, payload });
    expect((await patch({ status: 'ARCHIVED', displayName: 'Old sketch' })).json()).toMatchObject({ status: 'ARCHIVED', displayName: 'Old sketch' });
    expect((await app.inject({ url: root, headers: owner })).json().items).toEqual([]);
    expect((await app.inject({ url: `${root}?status=ARCHIVED`, headers: owner })).json().items.map((i: { id: string }) => i.id)).toEqual([ref.id]);
    expect((await app.inject({ url: `${item}/content`, headers: owner })).statusCode).toBe(200); // archived is still downloadable
    expect((await patch({ status: 'ACTIVE', displayName: null })).json()).toMatchObject({ status: 'ACTIVE', displayName: null });
    expect((await patch({})).statusCode).toBe(400);
    const deleted = await app.inject({ method: 'DELETE', url: item, headers: owner });
    expect(deleted.json()).toMatchObject({ status: 'DELETED', storedSha256: ref.storedSha256 });
    expect(deleted.json().deletedAt).not.toBeNull();
    // Newest first; within one PATCH the status event is written before the metadata event.
    expect(deleted.json().events.map((e: { eventType: string }) => e.eventType)).toEqual(['DELETED', 'METADATA_UPDATED', 'RESTORED', 'METADATA_UPDATED', 'ARCHIVED', 'UPLOADED']);
    expect(await count('select count(*) n from public.project_reference_blobs where reference_id=$1', [ref.id])).toBe(0);
    expect((await app.inject({ url: `${item}/content`, headers: owner })).statusCode).toBe(404);
    expect((await app.inject({ url: item, headers: owner })).json().status).toBe('DELETED'); // tombstone keeps provenance
    for (const res of [await app.inject({ method: 'DELETE', url: item, headers: owner }), await patch({ status: 'ACTIVE' })])
      expect([res.statusCode, res.json().error.code]).toEqual([409, 'REFERENCE_INVALID_TRANSITION']);
    // The same bytes can be uploaded again once the previous reference is deleted.
    expect((await upload(root, png({ width: 5 }), 'image/png')).statusCode).toBe(201);
    // Database guards apply to every role, including direct SQL.
    await expect(db.pool.query("update public.project_references set status='ACTIVE' where id=$1", [ref.id])).rejects.toMatchObject({ code: 'P3106' });
    await expect(db.pool.query('delete from public.project_references where id=$1', [ref.id])).rejects.toMatchObject({ code: '23514' });
    const live = (await app.inject({ url: root, headers: owner })).json().items[0].id;
    await expect(db.pool.query("update public.project_references set stored_sha256=repeat('0',64) where id=$1", [live])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('delete from public.project_reference_blobs where reference_id=$1', [live])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query("update public.project_reference_events set detail='{}' where reference_id=$1", [live])).rejects.toThrow();
  });

  it('binds a reference to a revision and reports currency as the project moves on', async () => {
    const { id, root } = await project(), path = `/api/projects/${id}/revisions/generate`;
    const first = await app.inject({ method: 'POST', url: path, headers: owner, payload: { requirements: parametricInput(true) } });
    expect(first.statusCode, first.body.slice(0, 300)).toBe(201);
    const revisionId = first.json().revision.id as string, ref = (await upload(root, jpeg(), 'image/jpeg', `purpose=SITE_PLAN&revisionId=${revisionId}`)).json();
    expect(ref.currency).toEqual({ status: 'CURRENT', boundRevisionId: revisionId, projectCurrentRevisionId: revisionId });
    const second = await app.inject({ method: 'POST', url: path, headers: owner, payload: { requirements: parametricInput(true), baseRevisionId: revisionId } });
    expect(second.statusCode, second.body.slice(0, 300)).toBe(201);
    const listed = (await app.inject({ url: `${root}?revisionId=${revisionId}`, headers: owner })).json().items;
    expect(listed.map((i: { id: string; currency: { status: string } }) => [i.id, i.currency.status])).toEqual([[ref.id, 'STALE']]);
    const foreign = (await project('Other project')).id;
    const res = await upload(root, png({ width: 7 }), 'image/png', `purpose=SITE_PLAN&revisionId=${(await app.inject({ method: 'POST', url: `/api/projects/${foreign}/revisions/generate`,
      headers: owner, payload: { requirements: parametricInput(true) } })).json().revision.id}`);
    expect([res.statusCode, res.json().error.code]).toEqual([404, 'REVISION_NOT_FOUND']);
  });

  it('enforces per-project limits: hourly attempts (rejections included), count and stored bytes', async () => {
    const a = await project('Hourly'), refuse = pdf({ catalog: '/OpenAction 5 0 R /AA << >>' });
    await db.pool.query("insert into public.project_reference_events(project_id,actor,event_type,detail) select $1,$2,'REJECTED','{}' from generate_series(1,29)", [a.id, ownerId]);
    expect((await upload(a.root, refuse, 'application/pdf')).statusCode).toBe(422); // the 30th attempt is still accepted for inspection and audited
    const limited = await upload(a.root, png(), 'image/png');
    expect([limited.statusCode, limited.json().error.code]).toEqual([429, 'REFERENCE_LIMIT_EXCEEDED']);

    const clone = async (projectId: string, referenceId: string, copies: number, storedBytes?: number) => db.pool.query(`insert into public.project_references(project_id,uploaded_by,status,
      purpose,media_type,original_sha256,original_bytes,stored_sha256,stored_bytes,storage_locator,inspector_version,provenance_json)
      select project_id,uploaded_by,'ACTIVE',purpose,media_type,original_sha256,original_bytes,md5(g::text)||md5(g::text),coalesce($3,stored_bytes),storage_locator,inspector_version,
      jsonb_set(jsonb_set(provenance_json,'{stored,sha256}',to_jsonb(md5(g::text)||md5(g::text))),'{stored,bytes}',to_jsonb(coalesce($3,stored_bytes)))
      from public.project_references, generate_series(1,$4::integer) g where project_id=$1 and id=$2`, [projectId, referenceId, storedBytes ?? null, copies]);
    const b = await project('Count'), first = (await upload(b.root, png(), 'image/png')).json();
    await clone(b.id, first.id, REFERENCE_LIMITS.perProjectReferences - 1);
    expect((await upload(b.root, jpeg(), 'image/jpeg')).json().error.code).toBe('REFERENCE_LIMIT_EXCEEDED');
    const c = await project('Bytes'), seed = (await upload(c.root, png(), 'image/png')).json();
    await clone(c.id, seed.id, 20, 10_485_760);
    expect((await upload(c.root, jpeg(), 'image/jpeg')).json().error.code).toBe('REFERENCE_LIMIT_EXCEEDED');
    expect((await app.inject({ url: `${c.root}/usage`, headers: owner })).json().references).toBe(21);
  });

  it('replays an idempotent upload and refuses a reused key for a different file', async () => {
    const { root } = await project(), key = { 'idempotency-key': 'phase31-upload-1' };
    const one = await upload(root, png({ width: 6 }), 'image/png', 'purpose=SKETCH', { ...owner, ...key });
    const two = await upload(root, png({ width: 6 }), 'image/png', 'purpose=SKETCH', { ...owner, ...key });
    expect([one.statusCode, two.statusCode]).toEqual([201, 201]);
    expect(two.json()).toEqual(one.json());
    const conflict = await upload(root, png({ width: 8 }), 'image/png', 'purpose=SKETCH', { ...owner, ...key });
    expect([conflict.statusCode, conflict.json().error.code]).toEqual([409, 'IDEMPOTENCY_CONFLICT']);
  });

  it('SQL accepts only signed writes whose bytes hash to the signed inspection', async () => {
    const { id } = await project(), bytes = png({ width: 10 }), { report, stored } = inspectReference(bytes, 'image/png');
    const input = { action: 'upload', projectId: id, purpose: 'OTHER', displayName: null, note: null, revisionId: null, mediaType: 'image/png',
      provenance: { sourceKind: 'USER_UPLOAD', uploadedBy: ownerId, original: report.original, stored: report.stored, transformations: [], inspection: report } };
    const write = (user: string, b64: string, signature?: { envelope: string; signature: string }) => asPrincipal(db.pool, user, c =>
      c.query('select public.reference_write($1,$2,$3,$4,$5,$6) response', ['upload', JSON.stringify(input), b64, null, signature?.envelope ?? null, signature?.signature ?? null]));
    const signed = signProjectCommit(secret, ownerId, REFERENCE_ROOT, input);
    await expect(write(ownerId, Buffer.from(stored!).toString('base64'))).rejects.toMatchObject({ code: '42501' });
    await expect(write(otherId, Buffer.from(stored!).toString('base64'), signed)).rejects.toMatchObject({ code: '42501' });
    const swapped = Buffer.from(stored!), at = swapped.length - 20; swapped[at] = swapped[at]! ^ 1;
    await expect(write(ownerId, swapped.toString('base64'), signed)).rejects.toMatchObject({ code: 'P3103' });
    expect((await write(ownerId, Buffer.from(stored!).toString('base64'), signed)).rows[0].response).toMatchObject({ storedSha256: sha(stored!), deduplicated: false });
  });

  it('issues short-lived signed download links that SQL verifies and revokes', async () => {
    const { id, root } = await project(), ref = (await upload(root, jpeg({ icc: true }), 'image/jpeg')).json(), item = `${root}/${ref.id}`;
    const link = await app.inject({ method: 'POST', url: `${item}/download-links`, headers: owner, payload: { expiresInSeconds: 120 } });
    expect(link.statusCode, link.body).toBe(201);
    expect(link.json()).toMatchObject({ referenceId: ref.id, storedSha256: ref.storedSha256 });
    expect(Date.parse(link.json().expiresAt) - Date.now()).toBeGreaterThan(100_000);
    const download = await app.inject({ url: link.json().url }); // anonymous
    expect(download.statusCode).toBe(200);
    expect([sha(download.rawPayload), download.headers['content-disposition'], download.headers['x-content-type-options']])
      .toEqual([ref.storedSha256, `attachment; filename="reference-${ref.id}.jpg"`, 'nosniff']);
    expect((await app.inject({ url: `${item}`, headers: owner })).json().events[0].eventType).toBe('DOWNLOAD_LINK_ISSUED');

    const invalid = async (url: string) => { const res = await app.inject({ url }); expect([res.statusCode, res.json().error.code], url.slice(0, 80)).toEqual([404, 'REFERENCE_LINK_INVALID']); };
    const token = new URL(link.json().url, 'http://x').searchParams.get('token')!, base = { r: ref.id, p: id, u: ownerId, s: ref.storedSha256 };
    await invalid(`/api/reference-downloads?token=${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`); // tampered signature
    await invalid(`/api/reference-downloads?token=${downloadToken('ab'.repeat(32), { ...base, e: now() + 60 })}`); // wrong key
    await invalid(`/api/reference-downloads?token=${downloadToken(secret, { ...base, e: now() - 1 })}`); // expired
    await invalid(`/api/reference-downloads?token=${downloadToken(secret, { ...base, e: now() + 5_000 })}`); // beyond the 15 min ceiling
    await invalid(`/api/reference-downloads?token=${downloadToken(secret, { ...base, u: otherId, e: now() + 60 })}`); // not the owner
    await invalid(`/api/reference-downloads?token=${downloadToken(secret, { ...base, s: '0'.repeat(64), e: now() + 60 })}`); // other bytes
    await invalid('/api/reference-downloads?token=not-a-token');
    expect((await app.inject({ method: 'POST', url: `${item}/download-links`, headers: owner, payload: { expiresInSeconds: 30 } })).statusCode).toBe(400);

    // Revocation: transferring the project or deleting the reference kills existing links.
    const moved = await project('Moved'), movedRef = (await upload(moved.root, png({ width: 11 }), 'image/png')).json();
    const movedLink = (await app.inject({ method: 'POST', url: `${moved.root}/${movedRef.id}/download-links`, headers: owner, payload: {} })).json().url as string;
    expect((await app.inject({ url: movedLink })).statusCode).toBe(200);
    await db.pool.query('update public.projects set owner_id=$2 where id=$1', [moved.id, otherId]);
    await invalid(movedLink);
    await app.inject({ method: 'DELETE', url: item, headers: owner });
    await invalid(link.json().url);
  });
});
