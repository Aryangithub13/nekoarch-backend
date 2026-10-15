// B39 staging proof of the six specialists (ROADMAP §K L788 and the B39 gate L297; owner decision D-10: prepared, not yet run).
// Runs workflow W-B39 from docs/release/b39-release-gates-runbook.md §2 against an authorized, disposable staging API, as two dedicated
// test users, through the public API only. It creates one project, archives it at the end (history is kept), and never deletes data,
// applies migrations, changes secrets or calls a database directly. It stops at the first unexpected response and never retries a write.
// Staging must carry migrations 0001–0029 (0029: the Interior operation) before the API is deployed.
//
//   STAGING_API_URL=https://… STAGING_OWNER_TOKEN=… STAGING_OTHER_TOKEN=… STAGING_CONFIRM=disposable-staging \
//     node scripts/staging-workflow-b39.mjs > docs/phase39/evidence/staging-<date>.json
//
// The evidence names no host, token or key: the base URL is recorded as `<staging>`. Exit 0: every check passed.
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { sampleCostingPolicy } from '@designflow/boq-cost';
import { checkTarget, REQUIREMENTS, SPECIFICATION } from './staging-workflow-b37.mjs';

export { checkTarget };
export const STAGING_EVIDENCE_VERSION = 'staging-workflow-b39-v1';
const ENVELOPE = 'specialist-request-v1';
const CONSENT = { acceptLocks: true, acceptQuote: true };
const CLADDING = { appearance: { target: { kind: 'EXTERIOR_WALLS', facades: ['NORTH', 'EAST', 'SOUTH', 'WEST'] }, finish: { presetId: 'warm-render' } } };
/** Demonstration values supplied with the request, as the structural route requires; not a product, standard or certified property. */
const DEMO_CONCRETE = { key: 'demo-concrete', category: 'CONCRETE', name: 'Staging demonstration concrete (not a design value)',
  elasticModulus: { value: 30000, unit: 'MPa' }, poissonRatio: { value: 0.2, unit: '1' }, density: { value: 2400, unit: 'kg/m3' }, architecturalSpecificationId: null };

/** A column at every distinct wall end per storey and a beam along every wall; the linear static engine (B24) is the only solver. */
export function frameInput(model) {
  const columns = new Map();
  for (const wall of [...model.walls].sort((a, b) => (a.id < b.id ? -1 : 1))) for (const end of ['start', 'end']) {
    const p = wall.path[end], key = `c-${wall.levelId}-${p.x}-${p.z}`;
    if (!columns.has(key)) columns.set(key, { key, rule: 'COLUMN_AT_WALL_END', wallId: wall.id, end, material: 'demo-concrete', section: 'col' });
  }
  const beams = model.walls.map(w => ({ key: `b-${w.id}`, rule: 'BEAM_ALONG_WALL', wallId: w.id, material: 'demo-concrete', section: 'beam' }));
  const load = (prefix, value) => beams.map(b => ({ key: `${prefix}-${b.key}`, application: 'MEMBER_DISTRIBUTED', target: { member: b.key }, direction: 'GLOBAL_Y',
    magnitude: { value, unit: 'kN/m' } }));
  return { version: 'structural-input-v1', materials: [DEMO_CONCRETE],
    sections: [{ key: 'col', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 300, unit: 'mm' } },
      { key: 'beam', shape: 'RECTANGLE', width: { value: 230, unit: 'mm' }, depth: { value: 450, unit: 'mm' } }],
    members: [...columns.values(), ...beams], supports: [], autoSupports: { rule: 'BASE_OF_COLUMNS_AT_LOWEST_ELEVATION', type: 'FIXED' },
    loadCases: [{ key: 'DEAD', category: 'DEAD', selfWeight: true, loads: load('d', -10) }, { key: 'LIVE', category: 'LIVE', selfWeight: false, loads: load('l', -5) }],
    combinations: [{ key: 'D-plus-L', profile: 'PROJECT_DEFINED', terms: [{ loadCase: 'DEAD', factor: 1 }, { loadCase: 'LIVE', factor: 1 }] }] };
}

/** The model with every space's finishes removed: what an interior finish change may not alter. */
const withoutFinishes = model => JSON.stringify({ ...model, spaces: model.spaces.map(s => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'finishes'))) });

export async function runWorkflow({ baseUrl, ownerToken, otherToken, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  const steps = [], checks = [], startedAt = now().toISOString();
  const evidence = { evidenceVersion: STAGING_EVIDENCE_VERSION, target: '<staging>', startedAt, finishedAt: null, ok: false, failedAt: null, steps, checks,
    ids: {}, specialists: {}, latencyMs: null };
  const call = async (label, method, path, body, { token = ownerToken, expect: expected = method === 'POST' ? 201 : 200 } = {}) => {
    const t0 = performance.now();
    const res = await fetchImpl(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' });
    const ms = Math.round(performance.now() - t0), text = await res.text();
    steps.push({ step: label, method, path: path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id'), status: res.status,
      requestId: res.headers.get('x-request-id'), ms });
    if (res.status !== expected) throw Object.assign(new Error(`unexpected ${res.status}`), { step: label });
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  };
  const check = (name, pass) => { checks.push({ check: name, pass: !!pass }); if (!pass) throw Object.assign(new Error(`check failed: ${name}`), { step: name }); };
  /** One specialist request; the result's status, reasons and written flag are recorded (no artifact content). */
  const specialist = async (label, p, module, body, expected) => {
    const r = await call(label, 'POST', `/api/projects/${p}/specialists/${module}/requests`, { envelopeVersion: ENVELOPE, preserveScopes: [], ...body }, { expect: expected });
    evidence.specialists[label] = { module, status: r.status, reasons: r.reasons.map(x => x.code), written: r.written };
    return r;
  };
  const manifest = (label, p, revisionId) => call(label, 'GET', `/api/projects/${p}/revisions/${revisionId}/manifest`);
  const freshness = (m, artifactId) => m.modules.flatMap(x => x.artifacts ?? []).find(a => a.artifactId === artifactId)?.freshness;
  /** Consent, execute, compare and approve a stored Phase 30 preflight through the existing routes; returns the committed revision. */
  const complete = async (label, r) => {
    const next = r.details.next;
    const cand = await call(`${label}: execute`, 'POST', next.executeHref, { preflightHash: r.details.preflightHash, consent: CONSENT }, { expect: 200 });
    const cmp = await call(`${label}: compare`, 'GET', next.comparisonHref);
    const commit = await call(`${label}: approve`, 'POST', next.approveHref, { preflightHash: r.details.preflightHash, candidateHash: cand.candidateHash });
    return { cmp, revision: commit.commit.revision };
  };
  try {
    const ready = await call('health ready', 'GET', '/health/ready');
    check('health ready', ready?.status === 'ok');
    const caps = await call('capabilities', 'GET', '/api/capabilities');
    check('discovery lists SPECIALISTS', (caps?.services ?? []).some(s => s.serviceId === 'SPECIALISTS' && s.status === 'AVAILABLE'));
    const p = (await call('create project', 'POST', '/api/projects', { title: `B39 staging proof ${startedAt}` })).id;
    const revA = (await call('generate revision A', 'POST', `/api/projects/${p}/revisions/generate`, { requirements: REQUIREMENTS })).revision;
    Object.assign(evidence.ids, { projectId: p, revisionA: revA.id });

    // Materials, Budget and Structural on A: one source revision across their artifacts and the manifest (gate L297).
    const mat = await specialist('MATERIALS on A', p, 'MATERIALS', { baseRevisionId: revA.id, operation: 'recompute', targetScopes: ['quantities'],
      outputConfig: { specification: SPECIFICATION } }, 201);
    check('Materials artifacts are on A and current', mat.artifacts.length === 2 && mat.artifacts.every(a => a.sourceRevisionId === revA.id && a.freshness === 'current'));
    const [takeoff, construction] = mat.artifacts;
    const budget = await specialist('BUDGET on A', p, 'BUDGET', { baseRevisionId: revA.id, operation: 'recompute', targetScopes: ['cost'],
      outputConfig: { takeoffId: takeoff.artifactId, constructionCalculationId: construction.artifactId, rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() } }, 201);
    check('Budget on synthetic rates requires review and never states a complete total for partial coverage', budget.status === 'REQUIRES_REVIEW'
      && budget.details.rateBookSynthetic === true && (budget.details.completeTotal === null) === (budget.details.coverage !== 'FULLY_PRICED'));
    const structural = await specialist('STRUCTURAL on A', p, 'STRUCTURAL', { baseRevisionId: revA.id, operation: 'recompute', targetScopes: ['engineering.structural'],
      outputConfig: { analysisType: 'LINEAR_STATIC', input: frameInput(revA.model) } }, 201);
    check('Structural requires review and certifies nothing', structural.status === 'REQUIRES_REVIEW' && structural.details.engineClaims.certification === 'NOT_CLAIMED'
      && Object.values(structural.claims).every(c => c === 'NOT_CLAIMED'));
    const mA = await manifest('manifest A', p, revA.id);
    check('A manifest holds every specialist artifact, current', [...mat.artifacts, ...budget.artifacts, ...structural.artifacts]
      .every(a => freshness(mA, a.artifactId)?.state === 'current'));

    // Interior on A (scenario 33): a finish-only candidate, completed through the existing Phase 30 routes.
    const space = revA.model.spaces[0];
    const interior = await specialist('INTERIOR on A', p, 'INTERIOR', { baseRevisionId: revA.id, operation: 'modify', targetScopes: ['interior.materials'],
      preserveScopes: ['building.structure'], outputConfig: { finishes: [{ spaceId: space.id, finishes: { floor: 'ceramic-tile', walls: 'paint-white' } }] } }, 201);
    check('Interior awaits consent with its system locks', interior.status === 'AWAITING_CONSENT' && interior.details.operationKind === 'INTERIOR_FINISH_MODIFY'
      && ['BUILDING_GEOMETRY', 'EXTERIOR', 'STRUCTURE'].every(s => interior.locks.some(l => l.origin === 'SYSTEM' && l.scope === s)));
    const i = await complete('INTERIOR', interior);
    const revB = i.revision;
    evidence.ids.revisionB = revB.id;
    check('Interior comparison: geometry identical, the space changed', i.cmp.changes.geometryIdentical === true && i.cmp.changes.spaces.some(s => s.spaceId === space.id));
    check('B differs from A only in space finishes', withoutFinishes(revB.model) === withoutFinishes(revA.model)
      && revB.model.spaces.find(s => s.id === space.id).finishes.floor === 'ceramic-tile');
    const mA2 = await manifest('manifest A after Interior', p, revA.id);
    check('A outputs are stale against B (the model changed)', [...mat.artifacts, ...budget.artifacts, ...structural.artifacts]
      .every(a => { const f = freshness(mA2, a.artifactId); return f?.state === 'stale' && f.targetRevisionId === revB.id; }));

    // Materials on B, then Exterior cladding on B (scenarios 34 and 42), completed to C: U2 keeps B's quantities current.
    const matB = await specialist('MATERIALS on B', p, 'MATERIALS', { baseRevisionId: revB.id, operation: 'recompute', targetScopes: ['quantities'],
      outputConfig: { specification: SPECIFICATION } }, 201);
    const exterior = await specialist('EXTERIOR on B', p, 'EXTERIOR', { baseRevisionId: revB.id, operation: 'modify', targetScopes: ['exterior.facade'],
      preserveScopes: ['building.structure', 'building.floor_plans'], outputConfig: CLADDING }, 201);
    check('Exterior awaits consent', exterior.status === 'AWAITING_CONSENT' && exterior.details.operationKind === 'APPEARANCE_MODIFY');
    const e = await complete('EXTERIOR', exterior);
    const revC = e.revision;
    evidence.ids.revisionC = revC.id;
    check('Exterior comparison: model and geometry identical', e.cmp.hashes.modelIdentical === true && e.cmp.hashes.geometryIdentical === true);
    const mB = await manifest('manifest B after Exterior', p, revB.id);
    check('U2: B quantities stay current against C (identical model)', matB.artifacts.every(a => { const f = freshness(mB, a.artifactId);
      return f?.state === 'current' && f.targetRevisionId === revC.id && f.reasons.some(r => r.code === 'SOURCE_MODEL_EQUIVALENT'); }));
    const mC = await manifest('manifest C', p, revC.id);
    check('C links its appearance variant and the Exterior operation', mC.modules.find(x => x.module === 'APPEARANCE_VARIANT')?.freshness?.state === 'current'
      && mC.lineage.operation?.operationId === exterior.operationId);

    // Blueprint on C (scenario 35): one new revision D, no render job; C is then a stale dependency for further specialist runs.
    const blueprint = await specialist('BLUEPRINT on C', p, 'BLUEPRINT', { baseRevisionId: revC.id, operation: 'regenerate', targetScopes: ['building.floor_plans'],
      outputConfig: { requirements: REQUIREMENTS } }, 201);
    evidence.ids.revisionD = blueprint.resultRevisionId;
    check('Blueprint commits one revision without a render job', blueprint.resultRevisionId !== null && blueprint.details.renderJobs === 0 && blueprint.jobIds.length === 0);
    evidence.blueprintVerificationStatus = blueprint.details.verificationStatus;
    const staleC = await specialist('MATERIALS on superseded C', p, 'MATERIALS', { baseRevisionId: revC.id, operation: 'recompute', targetScopes: ['quantities'],
      outputConfig: { specification: SPECIFICATION } }, 200);
    check('A superseded base is a stale dependency and stores nothing', staleC.status === 'STALE_DEPENDENCY' && staleC.written === false);

    // Typed refusals (scenario 46) and isolation.
    const planning = await specialist('INTERIOR space planning', p, 'INTERIOR', { baseRevisionId: blueprint.resultRevisionId, operation: 'modify',
      targetScopes: ['interior.layout'], outputConfig: {} }, 200);
    check('Space planning asks for scope expansion', planning.status === 'UNSUPPORTED' && planning.reasons[0]?.code === 'SCOPE_EXPANSION_REQUIRED' && !planning.written);
    const seismic = await specialist('STRUCTURAL seismic', p, 'STRUCTURAL', { baseRevisionId: blueprint.resultRevisionId, operation: 'recompute',
      targetScopes: ['engineering.structural'], outputConfig: { analysisType: 'SEISMIC', input: {} } }, 200);
    check('A validated-solver request is refused by type', seismic.status === 'UNSUPPORTED' && seismic.reasons[0]?.code === 'NO_VALIDATED_SOLVER' && !seismic.written);
    await call('other user: specialist request is refused', 'POST', `/api/projects/${p}/specialists/MATERIALS/requests`, { envelopeVersion: ENVELOPE, baseRevisionId: blueprint.resultRevisionId,
      operation: 'recompute', targetScopes: ['quantities'], preserveScopes: [], outputConfig: { specification: SPECIFICATION } }, { token: otherToken, expect: 404 });
    await call('other user: manifest is refused', 'GET', `/api/projects/${p}/revisions/${revA.id}/manifest`, undefined, { token: otherToken, expect: 404 });

    const times = [];
    for (let n = 0; n < 10; n++) { const t0 = performance.now(); await manifest(`manifest D read ${n + 1}`, p, blueprint.resultRevisionId); times.push(Math.round(performance.now() - t0)); }
    times.sort((a, b) => a - b);
    evidence.latencyMs = { reads: times.length, median: times[Math.floor(times.length / 2)], max: times.at(-1) };
    await call('archive the test project', 'PATCH', `/api/projects/${p}`, { status: 'ARCHIVED' }, { expect: 200 });
    evidence.ok = true;
  } catch (error) {
    evidence.failedAt = error?.step ?? 'request';
  }
  evidence.finishedAt = now().toISOString();
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const baseUrl = checkTarget(process.env);
    const evidence = await runWorkflow({ baseUrl, ownerToken: process.env.STAGING_OWNER_TOKEN, otherToken: process.env.STAGING_OTHER_TOKEN });
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = evidence.ok ? 0 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Staging workflow could not start');
    process.exitCode = 1;
  }
}
