import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { pdf } from '../../../test-support/reference-fixtures.js';
import { tower } from '../../../test-support/tower-fixtures.js';
import { buildApp } from '../src/app.js';
import { InspectionPool } from '../src/references/pool.js';
import { parseEnv } from '../src/config/env.js';
import { modelHash } from '../src/lib/generation-identity.js';

const env = (secret: string) => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false', PROJECT_COMMIT_SECRET: secret });
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const IN = { country: 'IN', subdivision: 'Maharashtra', locality: 'Mumbai' };
const testSource = { kind: 'USER_SUPPLIED', title: 'Integration-test rate (not a real rate)', jurisdiction: 'IN', retrievedOn: '2026-10-01' };

describe('Phase 35 engineering assessment over HTTP on stored revisions', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, inspectionPool: InspectionPool;
  beforeAll(async () => {
    db = await startTestDatabase();
    const ownerId = await createTestUser(db.pool), otherId = await createTestUser(db.pool);
    const secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    // The real worker-isolated inspector, started through a bootstrap that registers tsx inside the worker (see test-support/tsx-worker.mjs).
    inspectionPool = new InspectionPool({ worker: { url: new URL('../../../test-support/tsx-worker.mjs', import.meta.url), execArgv: [],
      workerData: { entry: new URL('../src/references/worker.ts', import.meta.url).href } } });
    app = buildApp({ env: env(secret), backend: createPgBackend(db.pool, { owner: ownerId, other: otherId }), captureError: () => undefined, inspectionPool });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await inspectionPool?.close(); await db?.stop(); });

  async function project(title: string, headers = owner) {
    const res = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { title } });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
    const id = res.json().id as string;
    return { id, root: (revisionId: string) => `/api/projects/${id}/revisions/${revisionId}/engineering-assessment` };
  }

  it('assesses a generated revision bound to its model hash, deterministically, and changes nothing', async () => {
    const { id, root } = await project('Generated');
    const revision = (await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions/generate`, headers: owner,
      payload: { requirements: parametricInput(true), baseRevisionId: null } })).json().revision;
    const first = await app.inject({ url: root(revision.id), headers: owner });
    expect(first.statusCode, first.body.slice(0, 300)).toBe(200);
    expect(first.json()).toMatchObject({ projectId: id, revisionId: revision.id, modelHash: modelHash(revision.model), consistency: 'CONSISTENT', cost: null,
      verification: { status: 'VERIFIED', route: `/api/projects/${id}/revisions/${revision.id}/verification` },
      claims: { structuralSafety: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', statutoryApproval: 'NOT_CLAIMED', professionalCertification: 'NOT_CLAIMED' } });
    // The B34 verifier over the same revision reports the same gross floor area.
    const verification = (await app.inject({ url: `/api/projects/${id}/revisions/${revision.id}/verification`, headers: owner })).json();
    expect(first.json().areas.grossFloorAreaMm2).toBe(verification.bases.grossFloorAreaMm2);
    const second = (await app.inject({ method: 'POST', url: root(revision.id), headers: owner, payload: {} })).json();
    expect([second.inputHash, second.resultHash]).toEqual([first.json().inputHash, first.json().resultHash]);
    expect((await app.inject({ url: `/api/projects/${id}`, headers: owner })).json().currentRevisionId).toBe(revision.id);
    expect((await app.inject({ url: `/api/projects/${id}/revisions`, headers: owner })).json().items).toHaveLength(1);
  });

  it('assesses a stored 163-storey supplied tower with declared inputs, linked evidence, the brief and a sourced conceptual cost', async () => {
    const { id, root } = await project('Supertall concept');
    const saved = await app.inject({ method: 'POST', url: `/api/projects/${id}/revisions`, headers: owner, payload: { model: tower({ storeys: 163, storeyHeightMm: 5120 }) } });
    expect(saved.statusCode, saved.body.slice(0, 500)).toBe(201);
    const revisionId = saved.json().revision.id as string;
    const brief = await app.inject({ method: 'POST', url: `/api/projects/${id}/brief/versions`, headers: owner,
      payload: { expectedVersion: 0, brief: { summary: 'Supertall office concept', program: { floors: 160 } } } });
    expect(brief.statusCode, brief.body.slice(0, 300)).toBe(201);
    const upload = await app.inject({ method: 'POST', url: `/api/projects/${id}/references?purpose=DOCUMENT&displayName=Soil%20report`, headers: { ...owner, 'content-type': 'application/pdf' },
      payload: pdf() });
    expect(upload.statusCode, upload.body.slice(0, 300)).toBe(201);
    const reference = upload.json();
    const body = { jurisdiction: IN, occupancy: { primary: 'OFFICE' }, structuralSystem: { primaryMaterial: 'REINFORCED_CONCRETE', description: 'Concept only' },
      declared: { heightMm: 834_560, storeys: 163 }, evidence: [{ kind: 'GEOTECHNICAL_INVESTIGATION', referenceId: reference.id }],
      cost: { currency: 'INR', components: [{ code: 'ALL', label: 'All-in test rate', scope: 'WHOLE_BUILDING', basis: 'GROSS_FLOOR_AREA_M2', rate: '1000',
        includes: { gst: 'INCLUDED', overheadAndProfit: 'INCLUDED' }, source: testSource }],
      adjustments: [{ code: 'CONT', label: 'Test contingency', category: 'CONTINGENCY', order: 1, kind: 'PERCENT', direction: 'ADD', basis: 'BASE', value: '10', source: testSource }] } };
    const started = Date.now();
    const res = await app.inject({ method: 'POST', url: root(revisionId), headers: owner, payload: body });
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
    expect(Date.now() - started).toBeLessThan(10_000);
    const r = res.json();
    // GFA = 163 × 1.2e9 − 162 × (31 × 280 × 1200) mm² = 193 912 608 000 mm² = 193 912.608 m²; × 1000 = 193 912 608.00; + 10 % = 213 303 868.80.
    expect(r).toMatchObject({ consistency: 'CONSISTENT', height: { storeyCount: 163, heightMm: 834_560 }, areas: { grossFloorAreaMm2: '193912608000' },
      context: { briefVersion: 1, briefFloors: 160, briefHash: brief.json().briefHash, jurisdiction: IN, occupancy: 'OFFICE' },
      evidence: [{ kind: 'GEOTECHNICAL_INVESTIGATION', referenceId: reference.id, reference: { purpose: 'DOCUMENT', mediaType: 'application/pdf', storedSha256: reference.storedSha256 },
        verification: 'USER_DECLARED', contentInterpreted: false }],
      cost: { status: 'COMPLETE', baseSubtotal: '193912608.00', pricedTotal: '213303868.80', completeTotal: '213303868.80', taxBasis: 'INCLUSIVE_OF_GST' } });
    expect(r.findings.find((f: { findingId: string }) => f.findingId === 'BRIEF_FLOORS')).toMatchObject({ status: 'WARNING', measured: '163', required: '160' });
    const status = (d: string) => r.domains.find((x: { domain: string }) => x.domain === d).status;
    expect([status('GEOTECHNICAL_AND_FOUNDATIONS'), status('SEISMIC_LOADS'), status('MEMBER_DESIGN'), status('PRELIMINARY_COST')])
      .toEqual(['REQUIRES_SOLVER', 'REQUIRES_SOURCE_VERIFICATION', 'UNSUPPORTED', 'EVALUATED']);
    const structural = r.domains.find((x: { domain: string }) => x.domain === 'GRAVITY_LOADS').relatedServices[0];
    expect(structural).toMatchObject({ serviceId: 'STRUCTURAL_ANALYSIS', artifactsForRevision: 0, route: `/api/projects/${id}/revisions/${revisionId}/structural` });
    // The assessment is not persisted and does not alter the revision or the brief.
    expect((await app.inject({ url: `/api/projects/${id}/brief`, headers: owner })).json().version).toBe(1);
  }, 60_000);

  it('refuses evidence that is not a live reference of this project and enforces ownership, validation and size limits', async () => {
    const mine = await project('Mine'), theirs = await project('Theirs', other);
    const revision = (await app.inject({ method: 'POST', url: `/api/projects/${mine.id}/revisions`, headers: owner, payload: { model: tower({ storeys: 2 }) } })).json().revision;
    const foreignRef = (await app.inject({ method: 'POST', url: `/api/projects/${theirs.id}/references?purpose=DOCUMENT`, headers: { ...other, 'content-type': 'application/pdf' },
      payload: pdf() })).json();
    expect(foreignRef.id).toEqual(expect.any(String));
    for (const referenceId of [randomUUID(), foreignRef.id]) {
      const res = await app.inject({ method: 'POST', url: mine.root(revision.id), headers: owner, payload: { evidence: [{ kind: 'GEOTECHNICAL_INVESTIGATION', referenceId }] } });
      expect(res.statusCode, res.body.slice(0, 300)).toBe(422);
      expect(res.json().error.code).toBe('ASSESSMENT_EVIDENCE_NOT_FOUND');
    }
    expect((await app.inject({ url: mine.root(revision.id), headers: other })).statusCode).toBe(404);
    expect((await app.inject({ url: mine.root(revision.id) })).statusCode).toBe(401);
    expect((await app.inject({ url: mine.root(randomUUID()), headers: owner })).statusCode).toBe(404);
    expect((await app.inject({ url: `${mine.root(revision.id)}?verbose=1`, headers: owner })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: mine.root(revision.id), headers: owner, payload: { cost: { currency: 'INR', components: [] } } })).statusCode).toBe(400);
    const oversized = await app.inject({ method: 'POST', url: mine.root(revision.id), headers: owner, payload: { padding: 'x'.repeat(70_000) } });
    expect([oversized.statusCode, oversized.json().error.code]).toEqual([400, 'PAYLOAD_TOO_LARGE']); // the app maps 413 to its uniform 400 with its own code (app.ts, INT-B-010)
  }, 60_000);
});
