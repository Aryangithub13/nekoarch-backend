import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { asPrincipal, createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { png } from '../../../test-support/reference-fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { REFERENCE_ROOT, downloadToken } from '../src/services/reference-service.js';
import { inspectReference } from '../src/references/inspect.js';

// Exercises public.reference_download directly in SQL, so the signature check (migration 0024's keyed double-HMAC
// comparison) is covered without the HTTP layer or the inspection worker.
const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

describe('reference_download token signature check', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, ownerId: string, otherId: string, secret: string;
  let base: { r: string; p: string; u: string; s: string }, storedSha: string;
  beforeAll(async () => {
    db = await startTestDatabase(); ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined });
    await app.ready();
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers: { authorization: 'Bearer owner' }, payload: { title: 'Download token' } });
    expect(created.statusCode, created.body).toBe(201);
    const projectId = created.json().id as string, bytes = png({ width: 12 }), { report, stored } = inspectReference(bytes, 'image/png');
    const input = { action: 'upload', projectId, purpose: 'OTHER', displayName: null, note: null, revisionId: null, mediaType: 'image/png',
      provenance: { sourceKind: 'USER_UPLOAD', uploadedBy: ownerId, original: report.original, stored: report.stored, transformations: [], inspection: report } };
    const signed = signProjectCommit(secret, ownerId, REFERENCE_ROOT, input);
    const written = await asPrincipal(db.pool, ownerId, c => c.query('select public.reference_write($1,$2,$3,$4,$5,$6) response',
      ['upload', JSON.stringify(input), Buffer.from(stored!).toString('base64'), null, signed.envelope, signed.signature]));
    storedSha = sha(stored!);
    base = { r: written.rows[0].response.id, p: projectId, u: ownerId, s: storedSha };
  });
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const download = (token: string, user: string | null = null) => asPrincipal(db.pool, user, c => c.query('select public.reference_download($1) response', [token]));
  const flip = (token: string) => `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;

  it('compares the signature through a keyed double HMAC, not a plain text comparison', async () => {
    const { prosrc } = (await db.pool.query("select prosrc from pg_proc where proname = 'reference_download' and pronamespace = 'public'::regnamespace")).rows[0];
    expect(prosrc).toMatch(/is distinct from extensions\.hmac\(/);
    expect(prosrc).not.toMatch(/sig\s*<>/);
  });

  it('returns the stored bytes for a correctly signed, unexpired token, anonymously', async () => {
    const response = (await download(downloadToken(secret, { ...base, e: now() + 60 }))).rows[0].response;
    expect(response).toMatchObject({ id: base.r, storedSha256: storedSha });
    expect(sha(Buffer.from(response.bytesBase64, 'base64'))).toBe(storedSha);
  });

  it('refuses every other token with the same P3107, whichever check fails', async () => {
    const good = downloadToken(secret, { ...base, e: now() + 60 });
    const bodyPart = good.split('.')[0]!;
    const cases: Record<string, string> = {
      'tampered last signature character': flip(good),
      'tampered first signature character': `${bodyPart}.${good.split('.')[1]!.replace(/^./, c => (c === '0' ? '1' : '0'))}`,
      'signature of another body': `${bodyPart}.${downloadToken(secret, { ...base, e: now() + 61 }).split('.')[1]}`,
      'wrong key': downloadToken('ab'.repeat(32), { ...base, e: now() + 60 }),
      'expired': downloadToken(secret, { ...base, e: now() - 1 }),
      'beyond the 15 minute ceiling': downloadToken(secret, { ...base, e: now() + 5_000 }),
      'not the owner': downloadToken(secret, { ...base, u: otherId, e: now() + 60 }),
      'other bytes': downloadToken(secret, { ...base, s: '0'.repeat(64), e: now() + 60 }),
    };
    for (const [name, token] of Object.entries(cases)) await expect(download(token), name).rejects.toMatchObject({ code: 'P3107' });
  });
});
