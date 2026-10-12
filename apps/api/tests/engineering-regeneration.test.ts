import { describe, expect, it } from 'vitest';
import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { tower, withIntermediateLevel, withTwoRooms, withWindows } from '../../../test-support/tower-fixtures.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { revisionQaReport } from '../src/services/project-service.js';
import { ZoneRequestError, type ZoneContext } from '../src/engineering/zones.js';
import { preservationCheck, regenerate, runRegeneration, verifyRegeneration, type QaRunner } from '../src/engineering/regeneration.js';
import { RegenerationRequestSchema } from '../src/engineering/regeneration-contracts.js';
import { partitionZones } from '../src/engineering/partitions.js';
import { PartitionRequestSchema } from '../src/engineering/partition-contracts.js';

const PROJECT = '00000000-0000-4000-8000-000000000001', BASE = '00000000-0000-4000-8000-000000000002', CHILD = '00000000-0000-4000-8000-000000000003';
const ctx = (model: BuildingModelV2, revisionId = BASE): ZoneContext => {
  const ids = { projectId: PROJECT, revisionId, modelHash: modelHash(model) };
  return { ids, model, generatedAt: '2026-10-12T00:00:00.000Z', sourceRevision: { revisionId, revisionNumber: 1, parentRevisionId: null, modelHash: ids.modelHash },
    currency: { status: 'CURRENT', artifactRevisionId: revisionId, projectCurrentRevisionId: revisionId } };
};
/** The QA a supplied revision is saved with (the save route's own function). */
const qa: QaRunner = m => revisionQaReport(m as never, null, null);
const run = (model: BuildingModelV2, body: unknown, runner = qa) => regenerate(ctx(model), RegenerationRequestSchema.parse(body), { qa: runner });
const z = (key: string, from: number, to: number) => ({ key, fromLevelId: `storey-${from}`, toLevelId: `storey-${to}` });
const THREE = [z('LOW', 0, 1), z('MID', 2, 5), z('HIGH', 6, 7)];
/** An 8-storey tower whose storey 2 has a two-room layout (west and east offices, an interior wall and a door): the template. */
const typical = () => { const m = withTwoRooms(tower({ storeys: 8 }), 2); m.site!.northMilliDegrees = 0; return m; };
/** A storey's layout without identities: what TYPICAL_FLOOR must reproduce on every target storey. */
const layout = (m: BuildingModelV2, levelId: string) => ({
  spaces: m.spaces.filter(s => s.levelId === levelId).map(({ boundary, classification, name }) => costHash({ boundary, classification, name })).sort(),
  walls: m.walls.filter(w => w.levelId === levelId).map(({ path, thicknessMm, heightMm, classification }) => costHash({ path, thicknessMm, heightMm, classification })).sort(),
  openings: m.openings.filter(o => o.levelId === levelId).map(({ offsetMm, widthMm, heightMm, kind }) => costHash({ offsetMm, widthMm, heightMm, kind })).sort(),
});
const fixedOn = (m: BuildingModelV2, levelId: string) => costHash({ level: m.levels.find(l => l.id === levelId), slabs: m.slabs.filter(s => s.levelId === levelId),
  stairs: m.stairs.filter(s => s.fromLevelId === levelId || s.toLevelId === levelId), columns: m.columns.filter(c => c.levelId === levelId) });

describe('Phase 35 TYPICAL_FLOOR regeneration of a zone or section', () => {
  it('copies the template storey layout to every target storey, keeps everything else identical, and passes the save route QA', () => {
    const base = typical(), before = structuredClone(base);
    expect(revisionQaReport(base as never, null, null).status).not.toBe('FAIL');
    const r = run(base, { zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    expect(r.status).toBe('CANDIDATE_READY');
    expect(r.refusals).toEqual([]);
    expect(r.target).toMatchObject({ kind: 'ZONE', zoneKey: 'MID', levelIds: ['storey-2', 'storey-3', 'storey-4', 'storey-5'] });
    expect(r.changes!.regeneratedLevelIds).toEqual(['storey-3', 'storey-4', 'storey-5']);
    expect(r.changes!.levels[0]).toEqual({ levelId: 'storey-3', removed: { spaces: 1, walls: 4, openings: 0, dimensions: 0 }, added: { spaces: 2, walls: 7, openings: 1, dimensions: 0 } });
    const m = r.candidate!.model;
    expect(r.candidate!.modelHash).toBe(modelHash(m));
    for (const id of ['storey-3', 'storey-4', 'storey-5']) {
      expect(layout(m, id)).toEqual(layout(base, 'storey-2'));
      expect(fixedOn(m, id)).toBe(fixedOn(base, id));
    }
    for (const id of ['storey-0', 'storey-1', 'storey-2', 'storey-6', 'storey-7']) expect(layout(m, id)).toEqual(layout(base, id));
    // Preservation is proven by entity, and the untouched zones are identical.
    expect(r.preservation!.check).toEqual({ status: 'WITHIN_SCOPE', basis: 'ENTITY_CANONICAL_HASH', added: 30, removed: 15, changed: 0, outOfScope: 0, violations: [] });
    expect(r.preservation!.preservedZones.map(p => [p.zoneKey, p.identical])).toEqual([['LOW', true], ['HIGH', true]]);
    expect(r.qa!.status).not.toBe('FAIL');
    expect(revisionQaReport(m as never, null, null).status).toBe(r.qa!.status);
    expect(r.commit).toMatchObject({ method: 'POST', route: `/api/projects/${PROJECT}/revisions`, baseRevisionId: BASE, expectedModelHash: r.candidate!.modelHash });
    expect(r.claims).toEqual({ revisionCreated: 'NOT_CLAIMED', engineeringValidity: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', designSuitability: 'NOT_CLAIMED' });
    expect(base).toEqual(before);
  });

  it('is deterministic and idempotent: the same request gives the same candidate, and regenerating the result again changes nothing', () => {
    const body = { zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } };
    const a = run(typical(), body), b = run(typical(), { ...body, zones: [...THREE].reverse() });
    expect([b.inputHash, b.resultHash, b.candidate!.modelHash]).toEqual([a.inputHash, a.resultHash, a.candidate!.modelHash]);
    const again = run(a.candidate!.model, body);
    expect([again.status, again.candidate, again.commit]).toEqual(['NO_CHANGE', null, null]);
  });

  it('regenerates an undeclared section, preserving the storeys below and above it', () => {
    const r = run(typical(), { target: { kind: 'SECTION', fromLevelId: 'storey-3', toLevelId: 'storey-4' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    expect(r.status).toBe('CANDIDATE_READY');
    expect(r.changes!.regeneratedLevelIds).toEqual(['storey-3', 'storey-4']);
    expect(r.preservation!.preservedZones.map(p => [p.levelIds[0], p.levelIds.at(-1), p.identical])).toEqual([['storey-0', 'storey-2', true], ['storey-5', 'storey-7', true]]);
  });

  it('refuses storeys whose fixed geometry differs from the template, naming each reason, and produces no candidate', () => {
    // Storey 0 has no stair void and no arriving flight; storey 7 has no departing flight: neither can take storey 2's layout.
    const r = run(typical(), { target: { kind: 'ZONE', zoneKey: 'ALL' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    expect([r.status, r.candidate, r.commit, r.preservation]).toEqual(['REFUSED', null, null, null]);
    const details = r.refusals.map(x => `${x.code}: ${x.detail}`);
    expect(details).toEqual(expect.arrayContaining([expect.stringMatching(/^STOREY_INCOMPATIBLE: Its slabs .*storey storey-0,/), expect.stringMatching(/^STOREY_INCOMPATIBLE: The stair flights .*storey storey-0,/),
      expect.stringMatching(/^STOREY_INCOMPATIBLE: The stair flights .*storey storey-7,/)]));
    const taller = typical();
    taller.levels.find(l => l.id === 'storey-2')!.boundary = [{ x: 0, z: 0 }, { x: 20_000, z: 0 }, { x: 40_000, z: 0 }, { x: 40_000, z: 30_000 }, { x: 0, z: 30_000 }];
    expect(run(taller, { zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } }).status)
      .toBe('CANDIDATE_READY'); // the same region with a redundant vertex is the same envelope
    const columns = typical();
    columns.columns.push({ id: 'storey-4-column', levelId: 'storey-4', crossSection: { outer: [{ x: 30_000, z: 15_000 }, { x: 30_400, z: 15_000 }, { x: 30_400, z: 15_400 }, { x: 30_000, z: 15_400 }], voids: [] },
      baseOffsetMm: 0, heightMm: 3800 });
    const c = run(columns, { zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    expect(c.refusals.map(x => x.detail)).toEqual([expect.stringMatching(/^Its columns differ .*storey storey-4,/)]);
  });

  it('refuses to copy an exterior door to an upper storey, and a dimension outside the target that measures a replaced entity', () => {
    const door = typical();
    door.openings.push({ id: 'storey-2-balcony', kind: 'door', wallId: 'storey-2-east', levelId: 'storey-2', offsetMm: 10_000, widthMm: 900, heightMm: 2100, sillMm: 0, type: 'balcony',
      operation: { kind: 'unspecified' } });
    const d = run(door, { zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    expect(d.refusals.map(x => x.code)).toEqual(['STOREY_INCOMPATIBLE', 'STOREY_INCOMPATIBLE', 'STOREY_INCOMPATIBLE']);
    expect(d.refusals.every(x => x.detail.startsWith('The template has a door in an exterior wall'))).toBe(true);
    const dim = typical();
    dim.dimensions.push({ id: 'facade-length', purpose: 'overall', axis: 'x', anchors: [{ kind: 'wall-end', wallId: 'storey-4-south', end: 'start' }, { kind: 'wall-end', wallId: 'storey-4-south', end: 'end' }],
      constraint: { mode: 'derived' } });
    expect(ArchitecturalBuildingModelV2Schema.safeParse(dim).success).toBe(true);
    const r = run(dim, { zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    expect(r.refusals).toEqual([{ code: 'DIMENSION_DEPENDS_ON_REPLACED_ENTITY', detail: 'Dimension facade-length is outside the regenerated storeys but measures an entity they replace' }]);
  });

  it('refuses a parametric model, rejects a template that is not a storey with a typed error, and returns NO_CHANGE when only the template is targeted', () => {
    const parametric = { ...typical(), parametricArchitecture: {} } as unknown as BuildingModelV2;
    expect(run(parametric, { zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } }).refusals[0]!.code).toBe('PARAMETRIC_MODEL');
    const datum = withIntermediateLevel(typical(), { storey: 7, offsetMm: 2000, declare: true });
    const code = (templateLevelId: string) => { try { run(datum, { target: { kind: 'SECTION', fromLevelId: 'storey-3', toLevelId: 'storey-4' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId } }); return null; }
      catch (e) { return e instanceof ZoneRequestError ? e.code : String(e); } };
    expect([code('datum-above-7'), code('nowhere')]).toEqual(['REGENERATION_TEMPLATE_INVALID', 'REGENERATION_TEMPLATE_INVALID']);
    const self = run(typical(), { target: { kind: 'SECTION', fromLevelId: 'storey-2', toLevelId: 'storey-2' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    expect([self.status, self.changes!.regeneratedLevelIds]).toEqual(['NO_CHANGE', []]);
  });

  it('refuses a candidate the save route QA would reject, and never returns it', () => {
    const failing: QaRunner = m => ({ ...revisionQaReport(m as never, null, null), status: 'FAIL', summary: { ...revisionQaReport(m as never, null, null).summary, errors: 1 },
      findings: [{ code: 'QA_TEST_FAILURE', severity: 'ERROR', category: 'core', entityIds: ['x'], message: 'injected', expected: null, actual: null, details: {} } as never] });
    const r = run(typical(), { zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } }, failing);
    expect([r.status, r.candidate, r.commit]).toEqual(['REFUSED', null, null]);
    expect(r.refusals).toEqual([{ code: 'QA_REJECTED', detail: 'Acceptance QA rejects the candidate with 1 error(s); the findings are listed under qa' }]);
    expect(r.qa).toMatchObject({ status: 'FAIL', errors: 1, findings: [{ code: 'QA_TEST_FAILURE', severity: 'ERROR', entityIds: ['x'] }] });
    expect(r.preservation!.check.status).toBe('WITHIN_SCOPE');
  });
});

describe('Phase 35 FENESTRATION regeneration of an exterior skin', () => {
  const rule = { widthMm: 1500, heightMm: 1800, sillMm: 900, gapMm: 900, edgeClearanceMm: 600 };
  it('lays out windows by the stated rule on the requested façades only (independent arithmetic), keeping doors and everything else', () => {
    const base = typical();
    base.openings.push({ id: 'old-east-window', kind: 'window', wallId: 'storey-3-east', levelId: 'storey-3', offsetMm: 5000, widthMm: 1000, heightMm: 1000, sillMm: 1000, type: 'w' },
      { id: 'old-north-window', kind: 'window', wallId: 'storey-3-north', levelId: 'storey-3', offsetMm: 5000, widthMm: 1000, heightMm: 1000, sillMm: 1000, type: 'w' });
    // Site north 0: the walls at z = 100 face -z (NORTH in model terms); EAST walls are at x = W - 100.
    const r = run(base, { zones: THREE, target: { kind: 'EXTERIOR_SKIN', zoneKey: 'MID', facades: ['EAST'] }, operation: { kind: 'FENESTRATION', window: rule } });
    expect(r.status).toBe('CANDIDATE_READY');
    expect(r.target.facades).toEqual(['EAST']);
    // An east wall runs 29 800 mm between corner walls 200 mm thick: blocked [0, 100 + 600] and [29 800 - 700, 29 800]; free 28 400 mm;
    // n = ⌊(28 400 + 900) / (1 500 + 900)⌋ = 12; the group is 12 × 1 500 + 11 × 900 = 27 900 mm, centred: first offset 700 + ⌊500 / 2⌋ = 950.
    const offsets = (m: BuildingModelV2, wallId: string) => m.openings.filter(o => o.wallId === wallId && o.kind === 'window').map(o => o.offsetMm).sort((a, b) => a - b);
    expect(offsets(r.candidate!.model, 'storey-3-east')).toEqual(Array.from({ length: 12 }, (_, k) => 950 + k * 2400));
    expect(r.candidate!.model.openings.find(o => o.id === 'old-east-window')).toBeUndefined();
    expect(r.candidate!.model.openings.find(o => o.id === 'old-north-window')).toEqual(base.openings.find(o => o.id === 'old-north-window'));
    expect(r.changes!.wallsRegenerated).toBe(4);
    expect(r.changes!.levels.find(l => l.levelId === 'storey-3')).toEqual({ levelId: 'storey-3', removed: { spaces: 0, walls: 0, openings: 1, dimensions: 0 }, added: { spaces: 0, walls: 0, openings: 12, dimensions: 0 } });
    expect(r.preservation!.check).toMatchObject({ status: 'WITHIN_SCOPE', added: 48, removed: 1, changed: 0, outOfScope: 0 });
    expect(r.preservation!.preservedZones.every(p => p.identical)).toBe(true);
    expect(r.qa!.status).not.toBe('FAIL');
  });

  it('lays windows around kept doors and walls meeting the façade (interior wall T-junction, split exterior walls)', () => {
    const base = typical();
    const r = run(base, { zones: THREE, target: { kind: 'EXTERIOR_SKIN', zoneKey: 'LOW', facades: ['NORTH'] }, operation: { kind: 'FENESTRATION', window: rule } });
    expect(r.status).toBe('CANDIDATE_READY');
    const wins = (wallId: string) => r.candidate!.model.openings.filter(o => o.wallId === wallId).map(o => [o.kind, o.offsetMm]).sort((a, b) => Number(a[1]) - Number(b[1]));
    // storey-0-south runs 39 800 mm with the entrance at [5 000, 6 000]: blocked [4 100, 6 900] with the 900 mm gap.
    // Free [700, 4 100] → 1 window at 700 + ⌊(3 400 - 1 500) / 2⌋ = 1 650; free [6 900, 39 100] → ⌊33 100 / 2 400⌋ = 13, slack 32 200 - 30 300 = 1 900 → 7 850.
    expect(wins('storey-0-south')).toEqual([['window', 1650], ['door', 5000], ...Array.from({ length: 13 }, (_, k) => ['window', 7850 + k * 2400])]);
    expect(r.candidate!.model.openings.find(o => o.id === 'entry-door')).toEqual(base.openings.find(o => o.id === 'entry-door'));
    for (const w of r.candidate!.model.walls) expect(w).toEqual(base.walls.find(x => x.id === w.id));
  });

  it('skips walls the rule does not fit and refuses when nothing is left, or when façades cannot be resolved; refuses a dimension on a replaced window', () => {
    const tall = run(typical(), { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' }, operation: { kind: 'FENESTRATION', window: { ...rule, sillMm: 3000 } } });
    expect([tall.status, tall.refusals[0]!.code]).toEqual(['REFUSED', 'NO_EXTERIOR_WALLS_IN_SCOPE']);
    const unknown = tower({ storeys: 3 });
    const u = run(unknown, { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL', facades: ['NORTH'] }, operation: { kind: 'FENESTRATION', window: rule } });
    expect(u.refusals.map(x => x.code)).toEqual(['FACADE_ORIENTATION_UNKNOWN']);
    expect(run(unknown, { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' }, operation: { kind: 'FENESTRATION', window: rule } }).status).toBe('CANDIDATE_READY');
    const dim = typical();
    dim.openings.push({ id: 'measured-window', kind: 'window', wallId: 'storey-4-east', levelId: 'storey-4', offsetMm: 5000, widthMm: 1000, heightMm: 1000, sillMm: 1000, type: 'w' });
    dim.dimensions.push({ id: 'window-width', levelId: 'storey-4', purpose: 'opening-offset', axis: 'z', anchors: [{ kind: 'opening-edge', openingId: 'measured-window', edge: 'start' },
      { kind: 'opening-edge', openingId: 'measured-window', edge: 'end' }], constraint: { mode: 'derived' } });
    expect(ArchitecturalBuildingModelV2Schema.safeParse(dim).success).toBe(true);
    expect(run(dim, { zones: THREE, target: { kind: 'EXTERIOR_SKIN', zoneKey: 'MID' }, operation: { kind: 'FENESTRATION', window: rule } }).refusals.map(x => x.code))
      .toEqual(['DIMENSION_DEPENDS_ON_REPLACED_ENTITY']);
  });

  it('refuses a candidate that exceeds acceptance QA\'s own resource budget, exactly as the save route would refuse the model', () => {
    // 256 storeys × 24 windows: the save route's QA reports QA_RESOURCE_LIMIT, so the candidate is never offered for commit.
    const r = run(tower({ storeys: 256 }), { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' }, operation: { kind: 'FENESTRATION', window: { ...rule, gapMm: 4000 } } });
    expect([r.status, r.candidate, r.commit, r.refusals.map(x => x.code)]).toEqual(['REFUSED', null, null, ['QA_REJECTED']]);
    expect(r.qa!.findings.map(f => f.code)).toContain('QA_RESOURCE_LIMIT');
    expect(r.preservation!.check).toMatchObject({ status: 'WITHIN_SCOPE', added: 6143 });
  }, 60_000);

  it('rejects mismatched target and operation kinds, and out-of-range rules, at the schema boundary', () => {
    const bad = [
      { target: { kind: 'ZONE', zoneKey: 'ALL' }, operation: { kind: 'FENESTRATION', window: rule } },
      { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-1' } },
      { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' }, operation: { kind: 'FENESTRATION', window: { ...rule, widthMm: 299 } } },
      { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' }, operation: { kind: 'FENESTRATION', window: { ...rule, gapMm: 1.5 } } },
      { target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' }, operation: { kind: 'FENESTRATION', window: { ...rule, glazing: 'triple' } } },
    ];
    for (const body of bad) expect(RegenerationRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    expect(RegenerationRequestSchema.parse({ target: { kind: 'EXTERIOR_SKIN', zoneKey: 'ALL' }, operation: { kind: 'FENESTRATION', window: rule } }).operation).toMatchObject({ window: { type: 'window' } });
  });
});

describe('Phase 35 preservation check and regeneration verification', () => {
  it('compares every entity by canonical hash; site and document changes are never in scope; provenance and topology order are not identity', () => {
    const a = typical(), none = () => false;
    expect(preservationCheck(a, structuredClone(a), none)).toMatchObject({ status: 'IDENTICAL', outOfScope: 0 });
    const reordered = structuredClone(a);
    reordered.walls.find(w => w.id === 'storey-2-partition')!.spaceIds!.reverse();
    reordered.provenance = { ...reordered.provenance, seed: 'other' };
    expect(preservationCheck(a, reordered, none).status).toBe('IDENTICAL');
    const changed = structuredClone(a);
    changed.slabs[3]!.thicknessMm = 250; changed.name = 'Renamed'; changed.site!.northMilliDegrees = 90_000;
    expect(preservationCheck(a, changed, (c) => c === 'slabs')).toMatchObject({ status: 'OUT_OF_SCOPE_CHANGES', changed: 3, outOfScope: 2,
      violations: [{ collection: 'site', entityId: 'plot', change: 'CHANGED' }, { collection: 'document', entityId: a.id, change: 'CHANGED' }] });
  });

  it('VERIFIES a committed candidate, lists every deviation of a tampered commit (MISMATCH), and reports NO_PARENT and NOT_REPRODUCIBLE', () => {
    const base = typical(), request = RegenerationRequestSchema.parse({ zones: THREE, target: { kind: 'ZONE', zoneKey: 'MID' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    const candidate = runRegeneration(ctx(base), request, { qa }).candidate!;
    const committed = (m: BuildingModelV2) => ({ ids: { projectId: PROJECT, revisionId: CHILD, modelHash: modelHash(m) }, model: m });
    const ok = verifyRegeneration(committed(candidate), ctx(base), request, { qa }, '2026-10-12T00:00:00.000Z');
    expect(ok).toMatchObject({ status: 'VERIFIED', parentRevisionId: BASE, recomputed: { status: 'CANDIDATE_READY', modelHash: modelHash(candidate) },
      preservation: { status: 'WITHIN_SCOPE', outOfScope: 0 }, deviation: { status: 'IDENTICAL' } });
    const tampered = structuredClone(candidate);
    tampered.slabs.find(s => s.id === 'storey-0-floor')!.thicknessMm = 300;
    const bad = verifyRegeneration(committed(tampered), ctx(base), request, { qa }, '2026-10-12T00:00:00.000Z');
    expect(bad).toMatchObject({ status: 'MISMATCH', preservation: { status: 'OUT_OF_SCOPE_CHANGES', violations: [{ collection: 'slabs', entityId: 'storey-0-floor', change: 'CHANGED' }] },
      deviation: { status: 'OUT_OF_SCOPE_CHANGES', changed: 1, violations: [{ collection: 'slabs', entityId: 'storey-0-floor', change: 'CHANGED' }] } });
    expect(verifyRegeneration(committed(candidate), null, request, { qa }, '2026-10-12T00:00:00.000Z').status).toBe('NO_PARENT');
    const nothing = RegenerationRequestSchema.parse({ target: { kind: 'ZONE', zoneKey: 'ALL' }, operation: { kind: 'TYPICAL_FLOOR', templateLevelId: 'storey-2' } });
    expect(verifyRegeneration(committed(candidate), ctx(base), nothing, { qa }, '2026-10-12T00:00:00.000Z')).toMatchObject({ status: 'NOT_REPRODUCIBLE', recomputed: { status: 'REFUSED' } });
  });
});

describe('Phase 35 partitioned processing (each zone as its own model)', () => {
  const partition = (model: BuildingModelV2, body: unknown) => partitionZones(ctx(model), PartitionRequestSchema.parse(body));
  // Independent arithmetic for the 40 m × 30 m tower: each plate is 1.2 × 10⁹ mm²; every plate above the first has a 24 × 280 mm by 1 200 mm stair void.
  const PLATE = 1_200_000_000n, VOID = 24n * 280n * 1200n;
  it('partitions zones into self-contained models whose areas, plates and volume reconcile exactly with the whole model', () => {
    const m = tower({ storeys: 8 }), r = partition(m, { zones: [0, 2, 4, 6].map(i => z(`Z${i}`, i, i + 1)) });
    expect(r.status).toBe('RECONCILED');
    expect(r.partitions.map(p => [p.key, p.storeyLevelIds])).toEqual([['Z0', ['storey-0', 'storey-1']], ['Z2', ['storey-2', 'storey-3']], ['Z4', ['storey-4', 'storey-5']], ['Z6', ['storey-6', 'storey-7']]]);
    expect(r.interfaceElements).toMatchObject({ stairCount: 3, dimensionCount: 0, stairs: [{ stairId: 'stair-1', lowerZoneKey: 'Z0', upperZoneKey: 'Z2' }, { stairId: 'stair-3' }, { stairId: 'stair-5' }] });
    expect(r.reconciliation.coverage).toEqual({ status: 'COMPLETE', modelEntities: 64, partitionEntities: 61, interfaceEntities: 3, missing: [], duplicated: [] });
    const gfa = PLATE * 8n - VOID * 7n;
    expect(r.reconciliation.grossFloorArea).toEqual({ wholeModelMm2: gfa.toString(), sumOfPartitionsMm2: gfa.toString(), equal: true });
    expect(r.reconciliation.plates).toEqual({ compared: 8, equal: 8 });
    expect(r.reconciliation.grossVolume).toEqual({ wholeModelMm3: (gfa * 4000n).toString(), sumOfPartitionsMm3: (gfa * 4000n).toString(), equal: true });
    expect(r.partitions[1]!.quantities.grossVolumeMm3).toBe(((PLATE - VOID) * 2n * 4000n).toString());
    for (const p of r.partitions) expect([p.schema.status, p.verification!.status, p.takeoff!.status]).toEqual(['VALID', 'VERIFIED', 'EVALUATED']);
  });

  it('runs BIM on each partition the bounded profile admits and reports the truthful refusal of the others', () => {
    const r = partition(tower({ storeys: 8 }), { zones: [0, 2, 4, 6].map(i => z(`Z${i}`, i, i + 1)) });
    expect(r.partitions[0]!.bim).toMatchObject({ eligibility: 'ELIGIBLE', projection: { validation: 'VALID_WITH_INCOMPLETE_DATA', elements: 29 } });
    // Above the lowest zone, the slab void serves a stair from the zone below, which is an interface element: alone, the partition has an
    // unexplained floor void, so QA rejects it and so does the BIM profile. That is reported, never hidden.
    for (const p of r.partitions.slice(1)) {
      expect(p.qa).toMatchObject({ status: 'FAIL', findingCodes: expect.arrayContaining(['QA_SPACE_FLOOR_VOID']) });
      expect(p.bim).toEqual({ eligibility: 'REFUSED', refusalCode: 'BIM_INVALID_SOURCE', projection: null });
    }
    expect(r.services.find(s => s.serviceId === 'BIM')!.perPartition).toBe('EVALUATED_WHERE_ELIGIBLE');
    expect(r.services.filter(s => s.perPartition === 'NOT_PARTITIONED').map(s => s.serviceId)).toEqual(['SCENE_3D', 'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS',
      'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE', 'BOQ_COST', 'DESIGN_OPTIMIZATION']);
  });

  it('measures by zone a model the whole-model takeoff refuses for size', () => {
    const big = withWindows(tower({ storeys: 128 }), 8);
    const zones = Array.from({ length: 8 }, (_, k) => z(`Z${k}`, k * 16, k * 16 + 15));
    const r = partition(big, { zones });
    expect(() => calculateQuantityTakeoff(big)).toThrow(expect.objectContaining({ code: 'RESOURCE_LIMIT_EXCEEDED' }));
    expect(r.status).toBe('RECONCILED');
    expect(r.partitions.map(p => p.takeoff!.status)).toEqual(Array(8).fill('EVALUATED'));
    const windows = r.partitions.map(p => Number(p.takeoff!.totals.find(t => t.itemCode === 'WINDOW_COUNT')?.value ?? -1));
    expect(windows.reduce((a, b) => a + b, 0)).toBe(big.openings.filter(o => o.kind === 'window').length);
  }, 60_000);

  it('verifies each partition exactly where the whole-model verifier falls back on its budget, and reports the difference instead of reconciling', () => {
    // 1 100 floor strips of 36 mm × 30 000 mm per storey: the exact union costs about 1.2 million cells per storey, so the shared 2 million budget
    // of a whole-model verification runs out on the second storey (boundary fallback), while each one-storey partition is verified exactly.
    const m = tower({ storeys: 2 });
    m.slabs = m.levels.flatMap(l => Array.from({ length: 1100 }, (_, i) => ({ id: `${l.id}-strip-${i}`, levelId: l.id, kind: 'floor' as const,
      footprint: { outer: [{ x: 36 * i, z: 0 }, { x: 36 * i + 36, z: 0 }, { x: 36 * i + 36, z: 30_000 }, { x: 36 * i, z: 30_000 }], voids: [] }, topOffsetMm: 0, thicknessMm: 200 })));
    const r = partition(m, { zones: [z('S0', 0, 0), z('S1', 1, 1)] });
    const exact = (1100n * 36n * 30_000n).toString();
    expect(r.partitions.map(p => p.verification!.plates[0])).toEqual([
      { levelId: 'storey-0', grossPlateAreaMm2: exact, method: 'RECTILINEAR_SLAB_UNION', wholeModelPlateAreaMm2: exact, wholeModelMethod: 'RECTILINEAR_SLAB_UNION', equal: true },
      { levelId: 'storey-1', grossPlateAreaMm2: exact, method: 'RECTILINEAR_SLAB_UNION', wholeModelPlateAreaMm2: PLATE.toString(), wholeModelMethod: 'LEVEL_BOUNDARY_FALLBACK', equal: false }]);
    expect([r.status, r.reconciliation.plates, r.reconciliation.grossFloorArea.equal]).toEqual(['NOT_RECONCILED', { compared: 2, equal: 1 }, false]);
  }, 60_000);

  it('keeps a datum level with the zone below it, returns partition models on request, and is the whole model for the default zone', () => {
    const m = withIntermediateLevel(tower({ storeys: 4 }), { storey: 1, offsetMm: 2000, declare: true });
    const r = partition(m, { zones: [z('LOW', 0, 1), z('HIGH', 2, 3)], includeModels: true });
    expect(r.partitions[0]!.levelIds).toEqual(['storey-0', 'storey-1', 'datum-above-1']);
    expect(r.status).toBe('RECONCILED');
    for (const p of r.partitions) {
      expect(ArchitecturalBuildingModelV2Schema.safeParse(p.model).success).toBe(true);
      expect(modelHash(p.model!)).toBe(p.partitionModelHash);
    }
    expect(r.partitions[1]!.model!.walls.every(w => ['storey-2', 'storey-3'].includes(w.levelId))).toBe(true);
    const whole = partition(tower({ storeys: 2 }), {});
    expect(whole.partitions.map(p => [p.key, p.partitionModelHash])).toEqual([['ALL', modelHash(tower({ storeys: 2 }))]]);
    expect(whole.partitions[0]!).toMatchObject({ model: null, bim: { eligibility: 'ELIGIBLE' }, qa: { status: 'PASS_WITH_WARNINGS' } });
  });

  it('is deterministic, never mutates the model, and refuses an invalid declaration with a typed error', () => {
    const m = tower({ storeys: 6 }), before = structuredClone(m), body = { zones: [z('A', 0, 2), z('B', 3, 5)] };
    const a = partition(m, body), b = partition(m, { zones: [...body.zones].reverse() });
    expect([b.inputHash, b.resultHash]).toEqual([a.inputHash, a.resultHash]);
    expect(m).toEqual(before);
    expect(() => partition(m, { zones: [z('A', 0, 2)] })).toThrow(ZoneRequestError);
  });
});
