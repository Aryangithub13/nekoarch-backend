// B37 staging proof of one live user workflow (ROADMAP §K L788; owner decision D-10: prepared, not yet run).
// Runs workflow W-B37 from docs/phase37/phase37-acceptance-gap-report.md §8 against an authorized, disposable staging
// API, as two dedicated test users, through the public API only. It creates its own project and archives it at the end
// (history is kept). It never deletes data, applies migrations, changes secrets or calls a database directly. It stops
// at the first unexpected response and never retries a write.
//
//   STAGING_API_URL=https://… STAGING_OWNER_TOKEN=… STAGING_OTHER_TOKEN=… STAGING_CONFIRM=disposable-staging \
//     node scripts/staging-workflow-b37.mjs > docs/phase37/evidence/staging-<date>.json
//
// The evidence names no host, token or key: the base URL is recorded as `<staging>`. Exit 0: every check passed.
import process from 'node:process';
import console from 'node:console';
import { URL, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { sampleCostingPolicy } from '@designflow/boq-cost';

export const STAGING_EVIDENCE_VERSION = 'staging-workflow-b37-v1';
const CONFIRM = 'disposable-staging';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
/** Two-storey parametric request (same shape as the repository's acceptance fixture). */
export const REQUIREMENTS = { site: { boundary: [{ x: 0, z: 0 }, { x: 22000, z: 0 }, { x: 22000, z: 22000 }, { x: 0, z: 22000 }], northMilliDegrees: 0 },
  floors: 2, rooms: [{ type: 'bedroom', count: 2, level: 1 }, { type: 'living', count: 1, level: 0 }, { type: 'kitchen', count: 1, level: 0 }],
  seed: 'staging-b37', parametricArchitecture: { version: 1, shape: 'L', origin: { x: 1000, z: 1000 }, floors: [
    { level: 0, widthMm: 18000, depthMm: 18000, westWingWidthMm: 9000, southWingDepthMm: 8000 },
    { level: 1, widthMm: 16000, depthMm: 16000, westWingWidthMm: 8500, southWingDepthMm: 7000 }] } };
/** Demonstration construction specification; the costs it produces use the sample rate book and are not real prices. */
export const SPECIFICATION = { id: 'staging-spec', version: '1', recipePack: { id: 'construction-recipes', version: '1' }, assemblies: [
  { id: 'concrete', kind: 'concrete', wastagePercent: '5', mode: { type: 'READY_MIX_VOLUME_ONLY' } },
  { id: 'tile', kind: 'flooring', wastagePercent: '10', tileLengthMm: 500, tileWidthMm: 500 },
  { id: 'door', kind: 'component', wastagePercent: '0', materialCode: 'DOOR_UNIT' }], assignments: [
  { id: 'slab', basis: 'FLOOR_PLATE_VOLUME', assemblyId: 'concrete', layerId: 'structure', selector: { kind: 'default' } },
  { id: 'floor', basis: 'FLOOR_FINISH_BASE_AREA', assemblyId: 'tile', layerId: 'finish', selector: { kind: 'default' } },
  { id: 'doors', basis: 'DOOR_COUNT', assemblyId: 'door', layerId: 'component', selector: { kind: 'default' } }] };
const EDIT = 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, '
  + 'structure, building dimensions, and existing interior unchanged.';

/** Refuses anything but an explicitly confirmed HTTPS staging URL (plain HTTP only on loopback, for local rehearsal). */
export function checkTarget(env) {
  if (env.STAGING_CONFIRM !== CONFIRM) throw new Error(`Set STAGING_CONFIRM=${CONFIRM} to confirm the target is an authorized, disposable staging deployment`);
  for (const k of ['STAGING_API_URL', 'STAGING_OWNER_TOKEN', 'STAGING_OTHER_TOKEN']) if (!env[k]) throw new Error(`Set ${k}`);
  const url = new URL(env.STAGING_API_URL);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('STAGING_API_URL must be a bare origin');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('STAGING_API_URL must use HTTPS');
  if (env.STAGING_OWNER_TOKEN === env.STAGING_OTHER_TOKEN) throw new Error('The two test users must be different');
  return url.origin;
}

export async function runWorkflow({ baseUrl, ownerToken, otherToken, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  const steps = [], checks = [], startedAt = now().toISOString();
  const evidence = { evidenceVersion: STAGING_EVIDENCE_VERSION, target: '<staging>', startedAt, finishedAt: null, ok: false, failedAt: null, steps, checks,
    ids: {}, manifestHashes: {}, latencyMs: null };
  const call = async (label, method, path, body, { token = ownerToken, expect: expected = method === 'POST' ? 201 : 200 } = {}) => {
    const t0 = performance.now();
    const res = await fetchImpl(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' });
    const ms = Math.round(performance.now() - t0), text = await res.text();
    steps.push({ step: label, method, path: path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id'), status: res.status,
      requestId: res.headers.get('x-request-id'), ms });
    if (res.status !== expected) throw Object.assign(new Error(`${label}: expected ${expected}, got ${res.status}`), { step: label });
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  };
  const check = (name, pass, detail = null) => { checks.push({ check: name, pass: !!pass, detail }); if (!pass) throw Object.assign(new Error(`check failed: ${name}`), { step: name }); };
  try {
    const ready = await call('health ready', 'GET', '/health/ready');
    check('health ready', ready?.status === 'ok');
    const caps = await call('capabilities', 'GET', '/api/capabilities');
    check('discovery lists PROJECT_MANIFEST', (caps?.services ?? []).some(s => s.serviceId === 'PROJECT_MANIFEST' && s.status === 'AVAILABLE'));
    const project = await call('create project', 'POST', '/api/projects', { title: `B37 staging proof ${startedAt}` });
    const p = project.id, revA = (await call('generate revision A', 'POST', `/api/projects/${p}/revisions/generate`, { requirements: REQUIREMENTS })).revision;
    Object.assign(evidence.ids, { projectId: p, revisionA: revA.id });
    const A = `/api/projects/${p}/revisions/${revA.id}`;
    const takeoff = await call('takeoff', 'POST', `${A}/takeoffs`, {});
    const construction = await call('construction calculation', 'POST', `${A}/takeoffs/${takeoff.id}/construction-calculations`, { specification: SPECIFICATION });
    await call('cost estimate (sample rate book)', 'POST', `${A}/takeoffs/${takeoff.id}/construction-calculations/${construction.id}/cost-estimates`,
      { rateBookId: 'sample-inr-v1', costingPolicy: sampleCostingPolicy() });
    await call('scene', 'POST', `${A}/scene/artifacts`, {});
    const m1 = await call('manifest A', 'GET', `${A}/manifest`);
    evidence.manifestHashes.aBefore = m1.manifestHash;
    check('A is current', m1.identity.revisionCurrency === 'CURRENT');
    check('every A output is current or not generated', m1.modules.every(x => x.freshness === null || x.freshness.state === 'current'));
    const assigned = m1.modules.flatMap(x => [x.freshness?.state, ...(x.artifacts ?? []).map(a => a.freshness.state)]);
    check('no output is verified or not_applicable', !assigned.includes('verified') && !assigned.includes('not_applicable'));
    const ops = `/api/projects/${p}/revision-operations`;
    const pre = await call('appearance preflight', 'POST', ops, { baseRevisionId: revA.id, request: { text: EDIT } });
    check('preflight awaits consent', pre.status === 'AWAITING_CONSENT');
    const m2 = await call('manifest A with candidate', 'GET', `${A}/manifest`);
    check('candidate listed, not accepted', m2.candidates.items.length === 1 && m2.candidates.items[0].acceptance === 'NOT_ACCEPTED');
    check('a candidate never changes the modules', JSON.stringify(m2.modules) === JSON.stringify(m1.modules));
    const cand = await call('execute', 'POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent: { acceptLocks: true, acceptQuote: true } }, { expect: 200 });
    const revB = (await call('approve', 'POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash })).commit.revision;
    evidence.ids.revisionB = revB.id;
    const B = `/api/projects/${p}/revisions/${revB.id}`;
    const m3 = await call('manifest A after the edit', 'GET', `${A}/manifest`);
    evidence.manifestHashes.aAfter = m3.manifestHash;
    check('every A output is stale against B', m3.modules.filter(x => x.freshness).every(x => x.freshness.state === 'stale' && x.freshness.targetRevisionId === revB.id));
    const superseded = m3.freshnessImpact.disciplines.flatMap(d => d.superseded), regenerate = m3.freshnessImpact.disciplines.flatMap(d => d.regenerate);
    check('model and QA superseded, never regenerated', superseded.includes('BUILDING_MODEL') && !regenerate.includes('BUILDING_MODEL'));
    check('dependent outputs listed to regenerate', ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'SCENE_3D'].every(n => regenerate.includes(n)));
    const mB = await call('manifest B', 'GET', `${B}/manifest`);
    evidence.manifestHashes.b = mB.manifestHash;
    const appearance = mB.modules.find(x => x.module === 'APPEARANCE_VARIANT');
    check('B links its visible 3D object', appearance?.availability === 'AVAILABLE' && appearance.freshness?.state === 'current');
    check('B lineage records the operation', mB.lineage.status === 'LINKED' && mB.lineage.operation.status === 'RECORDED');
    const read = await call('appearance', 'GET', `${B}/appearance`);
    check('appearance is bound to B and its model', read.revisionId === revB.id && read.modelHash === mB.identity.modelHash && read.artifact?.id === appearance.artifacts[0].artifactId);
    const part = await call('partial view', 'GET', `${A}/manifest?discipline=QUANTITIES_AND_COST&artifacts=omit`);
    check('partial view keeps the full hash', part.manifestHash === m3.manifestHash && part.view.scope === 'PARTIAL');
    await call('other user is refused', 'GET', `${A}/manifest`, undefined, { token: otherToken, expect: 404 });
    const times = [];
    for (let i = 0; i < 20; i++) { const t0 = performance.now(); await call(`manifest B read ${i + 1}`, 'GET', `${B}/manifest`); times.push(Math.round(performance.now() - t0)); }
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
