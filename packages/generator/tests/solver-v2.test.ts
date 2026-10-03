import { Worker } from 'node:worker_threads';
import { solverV2QaOptions } from '../../../apps/api/src/services/solver-v2-qa.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ArchitecturalBuildingModelV2Schema, polygonAreaMm2, ringContains } from '@designflow/shared';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { generateBlueprint, generateBlueprintV2, generateBlueprintForVersion, normalizeBlueprintV2Requirements, SelectedBlueprintRequirementsSchema, cardinalForSide } from '../src/index.js';
import { solverInput, rectangleSite, lSite, uSite, relationshipInput } from '../../../test-support/solver-v2-fixtures.js';
import { modelHash, requirementsHash } from '../../../apps/api/src/lib/generation-identity.js';

const qaOptions = (r: ReturnType<typeof normalizeBlueprintV2Requirements>) => ({ requireReachability: true, requiredRelationships: r.relationships.filter(e => e.strength === 'hard').map(e => ({ from: `space-${e.from.type}-${e.from.ordinal}`, to: `space-${e.to.type}-${e.to.ordinal}`, kind: e.kind })) });
function accepted(input = solverInput()) {
  const result = generateBlueprintV2(input);
  expect(ArchitecturalBuildingModelV2Schema.safeParse(result.model).success).toBe(true);
  const qa = auditBlueprint(result.model, { ...qaOptions(normalizeBlueprintV2Requirements(input)), ...solverV2QaOptions(normalizeBlueprintV2Requirements(input)) });
  expect(qa.findings.filter(f => f.severity === 'ERROR')).toEqual([]);
  expect(qa.circulation.unreachableSpaceIds).toEqual([]);
  expect(result.metadata.circulation.unreachableSpaceIds).toEqual([]);
  return result;
}
describe('Precision Solver V2 geometry and independent evidence', () => {
  it.each([['rectangle', rectangleSite()], ['non-square', rectangleSite(9000, 18000)], ['L', lSite], ['U', uSite]])('accepts real %s site output', (_name, boundary) => {
    const result = accepted(solverInput({ site: { boundary, northMilliDegrees: 90000 } }));
    expect(result.metadata.utilization.siteAreaMm2).toBe(Number(polygonAreaMm2(boundary)));
    expect(ringContains(boundary, result.model.levels[0]!.boundary)).toBe(true);
    expect(result.model.site!.boundary).toEqual(normalizeBlueprintV2Requirements(solverInput({ site: { boundary, northMilliDegrees: 90000 } })).site.boundary);
    const u = result.metadata.utilization;
    expect(u.roomClearAreaMm2 + u.circulationClearAreaMm2 + u.stairCoreClearAreaMm2 + u.wallsAndResidualAreaMm2).toBe(u.totalEnvelopeAreaMm2);
  });
  it('preserves the incoming historical V1 model and metadata fixtures exactly', () => {
    const fixtures = JSON.parse(readFileSync(new URL('../../../docs/phase19-evidence/v1-fixtures.json', import.meta.url), 'utf8')) as { requirements: unknown; result: unknown; requirementsHash: string; modelHash: string }[];
    for (const fixture of fixtures) {
      const result = generateBlueprint(fixture.requirements);
      expect(result).toEqual(fixture.result);
      expect(requirementsHash(fixture.requirements)).toBe(fixture.requirementsHash);
      expect(modelHash(result.model)).toBe(fixture.modelHash);
    }
  });
  it('keeps the version helper default and unmarked input on V1', () => {
    const { layoutV2: _layout, ...input } = solverInput();
    expect(generateBlueprintForVersion(input)).toEqual(generateBlueprint(input));
    expect(SelectedBlueprintRequirementsSchema.parse(input)).not.toHaveProperty('layoutV2');
    expect(SelectedBlueprintRequirementsSchema.parse(solverInput())).toHaveProperty('layoutV2.version', 2);
  });
  it('canonicalizes both permitted winding directions, cyclic origins, room order and relationship direction without mutating input', () => {
    const input = relationshipInput(), copy = structuredClone(input);
    const changed = structuredClone(input);
    changed.site.boundary = [...input.site.boundary.slice(1), input.site.boundary[0]!].reverse();
    changed.rooms.reverse(); changed.relationships!.reverse();
    changed.relationships = changed.relationships!.map(e => ({ ...e, from: e.to, to: e.from }));
    expect(generateBlueprintV2(input)).toEqual(generateBlueprintV2(changed));
    expect(input).toEqual(copy);
    expect(requirementsHash(input)).toBe(requirementsHash(changed));
  });
  it.each([
    ['duplicate closing vertex', [...rectangleSite(), rectangleSite()[0]!]],
    ['zero edge', [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 1, z: 1 }]],
    ['self intersection', [{ x: 0, z: 0 }, { x: 10000, z: 10000 }, { x: 0, z: 10000 }, { x: 10000, z: 0 }]],
    ['zero area', [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]],
    ['diagonal site', [{ x: 0, z: 0 }, { x: 12000, z: 0 }, { x: 14000, z: 12000 }, { x: 0, z: 12000 }]],
  ])('rejects %s without invented output', (_name, boundary) => {
    expect(() => generateBlueprintV2(solverInput({ site: { boundary, northMilliDegrees: null } }))).toThrow();
  });
  it('rejects oversized rings before polygon work and explicit unsupported nonrectangular setbacks', () => {
    expect(() => generateBlueprintV2(solverInput({ site: { boundary: Array.from({ length: 33 }, (_, x) => ({ x, z: 0 })), northMilliDegrees: null } }))).toThrowError(expect.objectContaining({ code: 'SITE_TOO_COMPLEX' }));
    expect(() => generateBlueprintV2(solverInput({ site: { boundary: lSite, northMilliDegrees: null, setbacks: [{ boundaryEdgeStart: 0, minimumMm: 100 }] } }))).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_SITE_GEOMETRY' }));
  });
  it('reconciles explicit buildable regions with rectangular setbacks and preserves translated survey origin', () => {
    const offset = (ring: typeof lSite) => ring.map(p => ({ x: p.x - 3000, z: p.z + 2000 }));
    const input = solverInput({ site: { boundary: offset(rectangleSite(16000, 20000)), buildableBoundary: offset(lSite), northMilliDegrees: 0,
      referenceOrigin: { datum: 'survey', buildingOrigin: { x: 100, y: 0, z: 200 } }, setbacks: [{ boundaryEdgeStart: 0, minimumMm: 500 }] } });
    const result = accepted(input);
    expect(Math.min(...result.model.levels[0]!.boundary.map(p => p.z))).toBeGreaterThanOrEqual(2500);
    expect(result.model.site!.referenceOrigin).toEqual(input.site.referenceOrigin);
  });
  it('rejects infeasible setbacks, outside buildable boundaries and impossible area', () => {
    for (const site of [{ boundary: rectangleSite(), northMilliDegrees: null, setbacks: [{ boundaryEdgeStart: 0, minimumMm: 20000 }] }, { boundary: rectangleSite(), buildableBoundary: rectangleSite(20000, 20000), northMilliDegrees: null }]) expect(() => generateBlueprintV2(solverInput({ site }))).toThrow();
    expect(() => generateBlueprintV2(solverInput({ site: { boundary: rectangleSite(2500, 2500), northMilliDegrees: null } }))).toThrowError(expect.objectContaining({ code: 'PROGRAM_DOES_NOT_FIT' }));
  });
  it('constructs and independently checks connected versus passage relationships', () => {
    const input = relationshipInput(), result = accepted(input);
    expect(result.diagnostics.winner.relationships.every(e => e.satisfied)).toBe(true);
    const connected = result.diagnostics.winner.relationships.find(e => e.kind === 'connected')!;
    const changed = structuredClone(result.model);
    changed.openings = changed.openings.filter(o => !connected.openingIds.includes(o.id));
    const report = auditBlueprint(changed, qaOptions(normalizeBlueprintV2Requirements(input)));
    expect(report.findings.some(f => f.code === 'QA_REQUIRED_RELATIONSHIP')).toBe(true);
    const adjacent = auditBlueprint(changed, { requiredRelationships: [{ from: connected.from, to: connected.to, kind: 'adjacent' }] });
    expect(adjacent.findings.some(f => f.code === 'QA_REQUIRED_RELATIONSHIP')).toBe(false);
  });
  it('rejects mandatory relationships across explicitly different floors', () => {
    const input = solverInput({ floors: 2, rooms: [{ type: 'bedroom', count: 1, level: 0 }, { type: 'living', count: 1, level: 1 }], relationships: [{ from: { type: 'bedroom' }, to: { type: 'living' }, strength: 'hard' }] });
    expect(() => generateBlueprintV2(input)).toThrowError(expect.objectContaining({ code: 'HARD_RELATIONSHIP_UNSATISFIABLE' }));
  });
  it('coordinates exact stair rise, landings, upper slab void and actual upper access', () => {
    const result = accepted(solverInput({ floors: 2, floorToFloorHeightMm: 3001, rooms: [{ type: 'bedroom', count: 1, level: 1 }, { type: 'living', count: 1, level: 0 }, { type: 'bathroom', count: 1, level: 0 }, { type: 'bathroom', count: 1, level: 1 }] }));
    const stair = result.model.stairs[0]!;
    expect(stair.riserHeightsMm.reduce((a, b) => a + b, 0)).toBe(3001);
    expect(stair.landings).toHaveLength(2);
    expect(result.model.slabs.find(s => s.levelId === 'level-1' && s.kind === 'floor')!.footprint.voids).toContainEqual(stair.footprint);
    expect(result.diagnostics.winner.verticalService).toHaveLength(1);
    const broken = structuredClone(result.model); broken.slabs.find(s => s.levelId === 'level-1' && s.kind === 'floor')!.footprint.voids = [];
    expect(auditBlueprint(broken, { requireReachability: true }).status).toBe('FAIL');
  });
  it.each(['min-z', 'max-z', 'min-x', 'max-x'] as const)('validates entry approach for %s', accessSide => {
    accepted(solverInput({ layoutV2: { accessSide, forbidPrivateThroughAccess: true } }));
  });
  it('models conceptual parking and explicitly excludes construction quantities', () => {
    const result = accepted(solverInput({ layoutV2: { accessSide: 'min-z', parking: { count: 1 } } }));
    expect(result.model.site!.parkingZones).toHaveLength(1);
    expect(calculateQuantityTakeoff(result.model).coverage).toContainEqual(expect.objectContaining({ category: 'parking_construction', status: 'NOT_EVALUATED', entityCount: 1 }));
    const broken = structuredClone(result.model); broken.site!.parkingZones![0]!.widthMm++;
    expect(ArchitecturalBuildingModelV2Schema.safeParse(broken).success).toBe(false);
    expect(auditBlueprint(broken).findings.some(f => f.code === 'QA_PARKING_DIMENSIONS')).toBe(true);
  });
  it('exposes geometric privacy/exposure metrics with simulation limitations and real openings', () => {
    const result = accepted(solverInput({ layoutV2: { forbidPrivateThroughAccess: true, objectives: { privacy: 10 } } }));
    expect(result.diagnostics.winner.circulation.privateThroughAccessCount).toBe(0);
    expect(result.diagnostics.winner.notEvaluated).toEqual(expect.arrayContaining(['DAYLIGHT_SIMULATION', 'AIRFLOW_SIMULATION', 'CLIMATE']));
    for (const exposure of result.diagnostics.winner.exposure) for (const id of exposure.windowOpeningIds) expect(result.model.openings.some(o => o.id === id && o.kind === 'window')).toBe(true);
    expect(result.diagnostics.winner.total).toBe(Math.min(...result.diagnostics.evaluations.map(e => e.total)));
    const noWindows = accepted(solverInput({ windows: { enabled: false } }));
    expect(noWindows.diagnostics.winner.exposure.every(e => !e.windowOpeningIds.length)).toBe(true);
  });
  it('applies exact north conversions without assuming climate or unsupported angles', () => {
    expect(cardinalForSide('max-x', 90000)).toBe('north');
    const input = solverInput({ layoutV2: { cardinalPreferences: [{ room: { type: 'bedroom' }, direction: 'east' }] } });
    expect(accepted(input).diagnostics.winner.orientation).toHaveLength(1);
    input.site.northMilliDegrees = 45000;
    expect(() => generateBlueprintV2(input)).toThrowError(expect.objectContaining({ code: 'INVALID_REQUIREMENTS' }));
  });
  it('enforces explicit hard separation and independently reconstructed clear room minima', () => {
    const input = solverInput({ layoutV2: { separations: [{ from: { type: 'bedroom' }, to: { type: 'living' }, strength: 'hard', minimumClearDistanceMm: 1000 }] } });
    const result = accepted(input);
    expect(result.diagnostics.winner.separations[0]!.satisfied).toBe(true);
    const options = solverV2QaOptions(normalizeBlueprintV2Requirements(input));
    options.requiredClearSpaces![0]!.minimumWidthMm = 60000;
    expect(auditBlueprint(result.model, options).findings.some(f => f.code === 'QA_REQUIRED_CLEAR_SPACE')).toBe(true);
    options.requiredSeparations![0]!.minimumClearDistanceMm = 60000;
    expect(auditBlueprint(result.model, options).findings.some(f => f.code === 'QA_REQUIRED_SEPARATION')).toBe(true);
    input.layoutV2!.separations![0]!.minimumClearDistanceMm = 60000;
    expect(() => generateBlueprintV2(input)).toThrowError(expect.objectContaining({ code: 'SEARCH_LIMIT_EXHAUSTED' }));
  });
  it('independently rejects forbidden private transit rather than assuming corridor access', () => {
    const result = accepted();
    const qa = auditBlueprint(result.model, { requireReachability: true, forbiddenTransitSpaceIds: ['space-corridor-0'] });
    expect(qa.findings.some(f => f.code === 'QA_PRIVATE_THROUGH_ACCESS')).toBe(true);
  });
  it('reports cancellation and execution deadline explicitly without returning partial geometry', () => {
    const controller = new AbortController(); controller.abort();
    expect(() => generateBlueprintV2(solverInput(), { signal: controller.signal })).toThrowError(expect.objectContaining({ code: 'SOLVER_CANCELLED' }));
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(2);
    try { expect(() => generateBlueprintV2(solverInput(), { timeoutMs: 1 })).toThrowError(expect.objectContaining({ code: 'SOLVER_TIMEOUT' })); }
    finally { now.mockRestore(); }
  });
  it('bounds candidate/operation search and reports exhaustion without claiming infeasibility', () => {
    const r = accepted(solverInput({ solver: { maxCandidates: 1 } }));
    expect(r.metadata.candidateAttempts).toBe(1); expect(r.metadata.searchComplete).toBe(false);
    expect(r.metadata.iterations).toBeLessThanOrEqual(20000);
    expect(() => generateBlueprintV2(solverInput({ solver: { maxIterations: 1 } }))).toThrowError(expect.objectContaining({ code: 'SEARCH_LIMIT_EXHAUSTED' }));
  });
  it('repeats deterministically across independent concurrent calls and hashes version/seed correctly', async () => {
    const input = solverInput({ solver: { maxCandidates: 4 } });
    const results = await Promise.all(Array.from({ length: 3 }, () => new Promise<ReturnType<typeof generateBlueprintV2>>((resolve, reject) => {
      const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads'); import('@designflow/generator').then(g => parentPort.postMessage(g.generateBlueprintV2(workerData)));`, { eval: true, workerData: input });
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
    })));
    expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2]);
    expect(modelHash(results[0]!.model)).toBe(modelHash(results[2]!.model));
    expect(requirementsHash(input)).toBe(requirementsHash({ ...input, seed: 'different' }));
    const { layoutV2: _layout, ...v1 } = input;
    expect(requirementsHash(input)).not.toBe(requirementsHash(v1));
  });
});
