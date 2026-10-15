import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleCostingPolicy, costHash } from '@designflow/boq-cost';
import { createTestUser, startTestDatabase } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { frameInput } from '../../../test-support/structural-fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { EvidenceDetailSchema, EvidenceListSchema } from '../src/contracts/evidence.js';
import { AssessmentRequestSchema } from '../src/engineering/contracts.js';
import { buildEvidencePackage, EVIDENCE_ROOT } from '../src/services/evidence-service.js';
import { EvidenceRepository } from '../src/lib/evidence-repository.js';
import { signProjectCommit } from '../src/services/project-service.js';
import { ApiError } from '../src/lib/errors.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = { authorization: 'Bearer owner' }, other = { authorization: 'Bearer other' };
const SCOPE = { scope: ['WIND_LOADS', 'SEISMIC_LOADS', 'MEMBER_DESIGN'] };

describe('Phase 38 engineering evidence packages on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof startTestDatabase>>, app: ReturnType<typeof buildApp>, backend: ReturnType<typeof createPgBackend>;
  let ownerId: string, otherId: string, secret: string;
  beforeAll(async () => {
    db = await startTestDatabase();
    ownerId = await createTestUser(db.pool); otherId = await createTestUser(db.pool);
    secret = (await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    backend = createPgBackend(db.pool, { owner: ownerId, other: otherId });
    app = buildApp({ env: parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false',
      PROJECT_COMMIT_SECRET: secret }), backend, captureError: () => undefined });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  const ok = async (method: 'GET' | 'POST', url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
    const r = await app.inject({ method, url, headers: owner, ...(payload === undefined ? {} : { payload: payload as Json }) });
    expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 500)}`).toBe(status);
    return r;
  };
  const fail = async (method: 'GET' | 'POST', url: string, payload?: unknown, headers = owner) => {
    const r = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Json }) });
    return [r.statusCode, r.json().error?.code ?? null];
  };
  const project = async (title: string) => {
    const projectId = (await ok('POST', '/api/projects', { title })).json().id as string;
    const revision = (await ok('POST', `/api/projects/${projectId}/revisions`, { model: authored() })).json().revision as Json;
    return { projectId, revision, base: `/api/projects/${projectId}/revisions/${revision.id}` };
  };
  const artifacts = async (base: string, revision: Json) => {
    const takeoff = (await ok('POST', `${base}/takeoffs`, {})).json();
    const construction = (await ok('POST', `${base}/takeoffs/${takeoff.id}/construction-calculations`, { specification: specification() })).json();
    await ok('POST', `${base}/takeoffs/${takeoff.id}/construction-calculations/${construction.id}/cost-estimates`, { rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() });
    await ok('POST', `${base}/structural/analyses`, frameInput(revision.model as never));
    return { takeoff };
  };
  const rows = async () => Number((await db.pool.query('select count(*)::int n from public.project_revision_evidence_packages')).rows[0].n);
  const refusal = (p: Promise<unknown>) => p.then(() => 'STORED', (e: unknown) => (e instanceof ApiError ? [e.statusCode, e.code] : String(e)));

  let a: Awaited<ReturnType<typeof project>>, created: Json;
  it('E1/E7: a package binds the verified graph, the assessment with its flags verbatim and the document manifest; every hash recomputes', async () => {
    a = await project('Phase 38 evidence');
    await artifacts(a.base, a.revision);
    created = EvidenceDetailSchema.parse((await ok('POST', `${a.base}/evidence-packages`, { assessment: SCOPE })).json());
    const pkg = created.package;
    expect(created).toMatchObject({ projectRevisionId: a.revision.id, acceptanceQaId: a.revision.qa.id, createdAs: 'CURRENT_REVISION', modelHash: a.revision.identity.modelHash,
      currency: { status: 'CURRENT', packageRevisionId: a.revision.id, projectCurrentRevisionId: a.revision.id } });
    expect(pkg.binding).toEqual({ projectId: a.projectId, revisionId: a.revision.id, revisionNumber: 1, modelHash: a.revision.identity.modelHash,
      acceptanceQaId: a.revision.qa.id, qaStatus: a.revision.qa.status });
    // Independent reads of the same sources give the same hashes.
    const graph = (await ok('GET', `${a.base}/dependency-graph`)).json(), docs = (await ok('GET', `${a.base}/documents`)).json();
    const assessment = (await ok('POST', `${a.base}/engineering-assessment`, SCOPE, 200)).json();
    expect([pkg.dependencyGraph.graphHash, pkg.documents.manifestHash, pkg.assessment.resultHash]).toEqual([graph.graphHash, docs.manifestHash, assessment.resultHash]);
    expect(pkg.dependencyGraph.nodes.every((n: Json) => n.state === 'CURRENT')).toBe(true);
    const { contentHash, ...body } = pkg;
    expect(contentHash).toBe(costHash(body));
    // Flags are copied verbatim: nothing is upgraded, and nothing is claimed or reviewed.
    expect(pkg.assessment.domains).toEqual(assessment.domains);
    expect(pkg.evidenceIndex.assessmentDomains.map((d: Json) => [d.domain, d.status, d.assuranceLevel, d.evidenceClass])).toEqual(
      assessment.domains.map((d: Json) => [d.domain, d.status, d.assuranceLevel, d.evidenceClass]));
    // The solver-dependent domains keep their NO_VALIDATED_SOLVER blockers and a non-evaluated status (REQUIRES_INPUTS takes precedence here).
    const solverBound = pkg.evidenceIndex.assessmentDomains.filter((d: Json) => d.blockerKinds.includes('NO_VALIDATED_SOLVER'));
    expect(solverBound.map((d: Json) => d.domain)).toEqual(['WIND_LOADS', 'SEISMIC_LOADS']);
    expect(solverBound.every((d: Json) => !['EVALUATED', 'PARTIALLY_EVALUATED'].includes(d.status))).toBe(true);
    expect(pkg.professionalReview.status).toBe('NOT_RECORDED');
    expect(Object.values(pkg.claims)).toEqual(Array(6).fill('NOT_CLAIMED'));
    expect(pkg.evidenceIndex.computedArtifacts.map((x: Json) => [x.family, x.kind]).sort()).toEqual([['BOQ_COST', 'DETERMINISTIC_ENGINE'],
      ['CONSTRUCTION_CALCULATION', 'DETERMINISTIC_ENGINE'], ['QUANTITY_TAKEOFF', 'DETERMINISTIC_ENGINE'], ['STRUCTURAL_ANALYSIS', 'SOLVER_OR_CALCULATOR']]);
    expect(pkg.evidenceIndex.sourceInputs.find((s: Json) => s.kind === 'ASSESSMENT_REQUEST').provenance).toBe('USER_DECLARED_NOT_VERIFIED');
    // Reads return the stored package unchanged.
    expect(EvidenceDetailSchema.parse((await ok('GET', `${a.base}/evidence-packages/${created.id}`)).json())).toEqual(created);
    expect(EvidenceListSchema.parse((await ok('GET', `${a.base}/evidence-packages`)).json()).items.map(i => i.id)).toEqual([created.id]);
  }, 180_000);

  it('E6: identical requests converge on one immutable package; the table refuses UPDATE and DELETE', async () => {
    const again = (await ok('POST', `${a.base}/evidence-packages`, { assessment: SCOPE })).json();
    expect([again.id, again.contentHash]).toEqual([created.id, created.contentHash]);
    expect(await rows()).toBe(1);
    await expect(db.pool.query(`update public.project_revision_evidence_packages set created_as = 'HISTORICAL_SNAPSHOT' where id = $1`, [created.id])).rejects.toThrow();
    await expect(db.pool.query('delete from public.project_revision_evidence_packages where id = $1', [created.id])).rejects.toThrow();
    // A different assessment request is a different package.
    const scoped = (await ok('POST', `${a.base}/evidence-packages`, { assessment: { scope: ['WIND_LOADS'] } })).json();
    expect(scoped.id).not.toBe(created.id);
  }, 120_000);

  it('E8: owner-only and strict on every evidence route', async () => {
    const b = await project('Phase 38 evidence other');
    const urls: [('GET' | 'POST'), string][] = [['POST', `${a.base}/evidence-packages`], ['GET', `${a.base}/evidence-packages`], ['GET', `${a.base}/evidence-packages/${created.id}`]];
    for (const [method, url] of urls) {
      expect((await app.inject({ method, url, ...(method === 'POST' ? { payload: {} } : {}) })).statusCode, url).toBe(401);
      expect(await fail(method, url, method === 'POST' ? {} : undefined, other), url).toEqual([404, 'PROJECT_NOT_FOUND']);
    }
    expect(await fail('GET', `/api/projects/${a.projectId}/revisions/${b.revision.id}/evidence-packages/${created.id}`)).toEqual([404, 'REVISION_NOT_FOUND']);
    expect(await fail('GET', `${b.base}/evidence-packages/${created.id}`)).toEqual([404, 'EVIDENCE_PACKAGE_NOT_FOUND']);
    expect(await fail('GET', `/api/projects/${b.projectId}/revisions/${a.revision.id}/evidence-packages`)).toEqual([404, 'REVISION_NOT_FOUND']);
    expect(await fail('POST', `${a.base}/evidence-packages`, { mode: 'CERTIFIED' })).toEqual([400, 'VALIDATION_ERROR']);
    expect(await fail('POST', `${a.base}/evidence-packages`, { professionalReview: { status: 'RECORDED' } })).toEqual([400, 'VALIDATION_ERROR']);
    expect(await fail('GET', `${a.base}/evidence-packages?expand=1`)).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('E4/E5: tampered, unsigned or foreign writes and a revision committed mid-assembly are refused by SQL; nothing is stored', async () => {
    const p = await project('Phase 38 evidence writes'), repo = backend.repository('owner'), store = new EvidenceRepository(repo);
    await artifacts(p.base, p.revision);
    const pkg = await buildEvidencePackage(repo, p.projectId, p.revision.id, 'CURRENT_REVISION', AssessmentRequestSchema.parse({}));
    const write = (mutate: (x: Json) => void, signer = ownerId, rehash = true) => {
      const copy = structuredClone(pkg) as Json; mutate(copy);
      if (rehash) { const { contentHash: _old, ...body } = copy; void _old; copy.contentHash = costHash(body); }
      const input = { projectId: p.projectId, projectRevisionId: p.revision.id, package: copy };
      return refusal(store.write(input, signProjectCommit(secret, signer, EVIDENCE_ROOT, input)));
    };
    const before = await rows();
    // A flag upgraded after assembly no longer matches the assessment's own resultHash.
    const upgrade = (x: Json) => { const d = x.assessment.domains.find((y: Json) => y.blockers.some((b: Json) => b.kind === 'NO_VALIDATED_SOLVER'));
      d.status = 'EVALUATED'; d.blockers = []; };
    expect(await write(upgrade)).toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    expect(await write(x => { upgrade(x); x.evidenceIndex.assessmentDomains = x.assessment.domains.map((d: Json) => ({ domain: d.domain, assuranceLevel: d.assuranceLevel,
      status: d.status, evidenceClass: d.evidenceClass, blockerKinds: [] })); })).toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    // The index alone restating a flag or a state is caught too: SQL rebuilds it from the embedded assessment and graph.
    expect(await write(x => { const d = x.evidenceIndex.assessmentDomains.find((y: Json) => y.blockerKinds.includes('NO_VALIDATED_SOLVER')); d.status = 'EVALUATED'; d.blockerKinds = []; }))
      .toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    expect(await write(x => { x.evidenceIndex.computedArtifacts = []; })).toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    expect(await write(x => { x.binding.modelHash = 'f'.repeat(64); })).toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    expect(await write(x => { x.dependencyGraph.nodes[0].state = 'STALE_SOURCE_CHANGED'; })).toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    expect(await write(x => { x.documents.documents[0].contentHash = 'e'.repeat(64); })).toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    expect(await write(x => { x.professionalReview.status = 'RECORDED'; })).toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    expect(await write(x => { x.createdAs = 'HISTORICAL_SNAPSHOT'; })).toEqual([422, 'EVIDENCE_PACKAGE_INVALID']);
    expect(await write(() => undefined, ownerId, false).then(r => r)).toBe('STORED');
    expect(await rows()).toBe(before + 1);
    expect(await write(() => undefined, otherId)).toEqual([403, 'FORBIDDEN']);
    const input = { projectId: p.projectId, projectRevisionId: p.revision.id, package: pkg };
    expect(await refusal(store.write(input, { envelope: JSON.stringify({ userId: ownerId }), signature: '0'.repeat(64) }))).toEqual([403, 'FORBIDDEN']);
    // E4: assembled while current, committed after a new revision landed: the SQL write rechecks currency in its transaction.
    const q = await project('Phase 38 evidence race'), stale = await buildEvidencePackage(repo, q.projectId, q.revision.id, 'CURRENT_REVISION', AssessmentRequestSchema.parse({}));
    await ok('POST', `/api/projects/${q.projectId}/revisions`, { model: authored(), baseRevisionId: q.revision.id });
    const late = { projectId: q.projectId, projectRevisionId: q.revision.id, package: stale };
    expect(await refusal(store.write(late, signProjectCommit(secret, ownerId, EVIDENCE_ROOT, late)))).toEqual([409, 'EVIDENCE_SOURCE_STALE']);
    expect(await rows()).toBe(before + 1);
  }, 180_000);

  it('an analysis committed between the graph read and the assessment read is a 409, never a package that disagrees with itself', async () => {
    const p = await project('Phase 38 evidence read race'), repo = backend.repository('owner');
    await artifacts(p.base, p.revision);
    // The assessment's status read sees one more structural analysis than the graph listed.
    const late = { ...repo, structuralRpc: async (name: never, args: Record<string, unknown>) => {
      const r = await repo.structuralRpc!(name, args) as Json;
      return args.p_action === 'status' ? { ...r, analyses: [...r.analyses, r.analyses[0]] } : r;
    } };
    expect(await refusal(buildEvidencePackage(late as never, p.projectId, p.revision.id, 'CURRENT_REVISION', AssessmentRequestSchema.parse({}))))
      .toEqual([409, 'EVIDENCE_READ_INCONSISTENT']);
    expect(await refusal(buildEvidencePackage(repo, p.projectId, p.revision.id, 'CURRENT_REVISION', AssessmentRequestSchema.parse({})).then(() => { throw new ApiError(200, 'BUILT', ''); })))
      .toEqual([200, 'BUILT']);
  }, 180_000);

  it('E3: a superseded revision refuses CURRENT_REVISION, accepts a labelled HISTORICAL_SNAPSHOT, and old packages read as historical', async () => {
    // A real model change (U2: an identical model would leave model-only outputs source-equivalent; see the U2 case).
    const b = (await ok('POST', `/api/projects/${a.projectId}/revisions`, { model: { ...authored(), name: 'Authored fixture, edited' }, baseRevisionId: a.revision.id })).json().revision as Json;
    expect(await fail('POST', `${a.base}/evidence-packages`, {})).toEqual([409, 'EVIDENCE_SOURCE_STALE']);
    const snapshot = EvidenceDetailSchema.parse((await ok('POST', `${a.base}/evidence-packages`, { mode: 'HISTORICAL_SNAPSHOT' })).json());
    expect(snapshot).toMatchObject({ createdAs: 'HISTORICAL_SNAPSHOT', currency: { status: 'HISTORICAL', projectCurrentRevisionId: b.id } });
    expect(snapshot.package.dependencyGraph.nodes.every(n => n.state.startsWith('STALE_'))).toBe(true);
    expect(await fail('POST', `/api/projects/${a.projectId}/revisions/${b.id}/evidence-packages`, { mode: 'HISTORICAL_SNAPSHOT' })).toEqual([422, 'EVIDENCE_MODE_INVALID']);
    const old = EvidenceDetailSchema.parse((await ok('GET', `${a.base}/evidence-packages/${created.id}`)).json());
    expect([old.createdAs, old.currency.status]).toEqual(['CURRENT_REVISION', 'HISTORICAL']);
    expect(await fail('GET', `${a.base}/evidence-packages/${created.id}?require=current`)).toEqual([409, 'EVIDENCE_SOURCE_STALE']);
  }, 180_000);

  it('E2: an unverified source refuses the package, naming the node; nothing is stored', async () => {
    const t = await project('Phase 38 evidence tamper'), { takeoff } = await artifacts(t.base, t.revision);
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      await client.query('update project_revision_takeoffs set input_fingerprint = $1 where id = $2', ['f'.repeat(64), takeoff.id]);
      await client.query('commit');
    } finally { client.release(); }
    const before = await rows();
    const r = await app.inject({ method: 'POST', url: `${t.base}/evidence-packages`, headers: owner, payload: {} });
    expect([r.statusCode, r.json().error.code]).toEqual([422, 'EVIDENCE_SOURCE_UNVERIFIED']);
    expect(r.json().error.fieldErrors.nodes).toContain(`QUANTITY_TAKEOFF:${takeoff.id}: FINGERPRINT_MISMATCH`);
    expect(await rows()).toBe(before);
  }, 180_000);
});
