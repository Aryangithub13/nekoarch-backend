import { describe, expect, it } from 'vitest';
import type { BuildingModelV2 } from '@designflow/shared';
import { generateBlueprintV2 } from '@designflow/generator';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { solverInput } from '../../../test-support/solver-v2-fixtures.js';
import { systemsInput, wetTwoStorey } from '../../../test-support/systems-fixtures.js';
import { TEST_CONCRETE } from '../../../test-support/structural-fixtures.js';
import { environmentalInput } from '../../../test-support/environmental-fixtures.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { projectBim } from '../src/bim/project.js';
import { digest } from '../src/bim/core.js';
import type { BimModel } from '../src/bim/contracts.js';
import { buildStructuralModel } from '../src/structural/model.js';
import { structuralInputHash } from '../src/structural/analysis.js';
import type { StructuralInput, StructuralSnapshot } from '../src/structural/contracts.js';
import { EnvironmentalInputSchema, type EnvironmentalSnapshot } from '../src/environmental/contracts.js';
import { buildEnvironmentalModel } from '../src/environmental/model.js';
import { environmentalInputHash, resolveAnalysisInput as resolveEnvironmental, runEnvironmentalAnalysis } from '../src/environmental/analysis.js';
import { CLAIMS, NOT_EVALUATED, SYSTEMS_LIMITS, SnapshotSchema, SystemsError, SystemsInputSchema, type SystemsInput, type SystemsResults } from '../src/systems/contracts.js';
import { buildSystemsModel, systemsId, type Upstream } from '../src/systems/model.js';
import { REFERENCE_CALCULATOR, calculate, resolveAnalysisInput, runSystemsAnalysis, systemsInputHash, type SystemsCalculatorAdapter } from '../src/systems/analysis.js';
import { measure } from '../src/systems/routing.js';
import { clippedArea } from '../src/systems/vertical.js';
import { validateSystemsModel, validateSystemsResults } from '../src/systems/validate.js';

const projectId = '11111111-1111-4111-8111-111111111111', revisionId = '22222222-2222-4222-8222-222222222222';
const bimOf = (m: BuildingModelV2, r = revisionId): BimModel => projectBim(m, { projectId, revisionId: r, modelHash: modelHash(m), generatorVersion: m.provenance.generatorVersion ?? null,
  generationId: null, requirementsHash: null, parameterHash: m.parametricArchitecture ? digest(m.parametricArchitecture) : null });
const parse = (input: unknown) => SystemsInputSchema.parse(input);
const codeOf = (fn: () => unknown) => { try { fn(); } catch (error) { return error instanceof SystemsError ? error.code : `other:${(error as Error).message}`; } return 'none'; };
const WET = wetTwoStorey(), WET_BIM = bimOf(WET);
const keyOf = (model: ReturnType<typeof buildSystemsModel>, networkId: string) => model.networks.find(n => n.id === networkId)!.key;

function analyse(input: SystemsInput, bim: BimModel = WET_BIM, upstream: Upstream = { structural: null, environmental: null }, adapter: SystemsCalculatorAdapter = REFERENCE_CALCULATOR) {
  const model = buildSystemsModel(bim, input, upstream), ai = resolveAnalysisInput(model, input, upstream.environmental), run = runSystemsAnalysis(ai, adapter);
  const draft = { binding: model.binding, inputHash: systemsInputHash(model.binding, input), input, model, results: run.results };
  const check = (results: SystemsResults = run.results) => validateSystemsResults({ ...draft, results }, { binding: model.binding, environmental: upstream.environmental });
  return { model, ai, run, results: run.results, draft, check };
}
const net = (a: ReturnType<typeof analyse>, key: string) => a.results.networks.find(n => keyOf(a.model, n.networkId) === key)!;
const forge = (results: SystemsResults, mutate: (r: SystemsResults) => void) => { const copy = structuredClone(results); mutate(copy); return copy; };

/** Phase 24 frame (test values): one beam along the bathroom/corridor wall at the storey top and columns at both its ends. */
function structuralUpstream(bim: BimModel = WET_BIM): NonNullable<Upstream['structural']> {
  const input: StructuralInput = { version: 'structural-input-v1', materials: [structuredClone(TEST_CONCRETE)],
    sections: [{ key: 'col', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 300, unit: 'mm' } }, { key: 'beam', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 600, unit: 'mm' } }],
    members: [{ key: 'b1', rule: 'BEAM_ALONG_WALL', wallId: 'wall-level-0-3550-2450-9900-2450', material: 'test-concrete', section: 'beam' },
      { key: 'c1', rule: 'COLUMN_AT_WALL_END', wallId: 'wall-level-0-3550-2450-9900-2450', end: 'start', material: 'test-concrete', section: 'col' },
      { key: 'c2', rule: 'COLUMN_AT_WALL_END', wallId: 'wall-level-0-3550-2450-9900-2450', end: 'end', material: 'test-concrete', section: 'col' }],
    supports: [], autoSupports: { rule: 'BASE_OF_COLUMNS_AT_LOWEST_ELEVATION', type: 'FIXED' }, combinations: [], loadCases: [{ key: 'd', category: 'DEAD', selfWeight: true, loads: [] }] };
  const model = buildStructuralModel(bim, input), inputHash = structuralInputHash(model.binding, input);
  return { analysisId: '33333333-3333-4333-8333-333333333333', inputHash, snapshot: { binding: model.binding, inputHash, model } as unknown as StructuralSnapshot };
}
function environmentalUpstream(bim: BimModel = WET_BIM): NonNullable<Upstream['environmental']> {
  const input = EnvironmentalInputSchema.parse(environmentalInput()), model = buildEnvironmentalModel(bim, input), run = runEnvironmentalAnalysis(resolveEnvironmental(model, input));
  const inputHash = environmentalInputHash(model.binding, input);
  return { analysisId: '44444444-4444-4444-8444-444444444444', inputHash, snapshot: { binding: model.binding, inputHash, results: run.results } as unknown as EnvironmentalSnapshot };
}
const only = (input: SystemsInput, keep: (keyof SystemsInput)[]) => ({ ...input, ...Object.fromEntries((['plumbing', 'electrical', 'hvac', 'lifeSafety', 'verticalTransport'] as const)
  .filter(k => !keep.includes(k)).map(k => [k, null])) }) as SystemsInput;

describe('Phase 26 contracts, binding and the semantic model', () => {
  it('parses explicit input with versions, rejects unknown fields, and never fills engineering defaults', () => {
    const input = parse({ version: 'building-systems-input-v1' });
    expect(input).toMatchObject({ sources: { structuralAnalysisId: null, environmentalAnalysisId: null }, plumbing: null, electrical: null, hvac: null, lifeSafety: null, verticalTransport: null });
    expect(SystemsInputSchema.safeParse({ version: 'building-systems-input-v1', clearance: 25 }).success).toBe(false);
    expect(SystemsInputSchema.safeParse({ version: 'building-systems-input-v2' }).success).toBe(false);
    expect(parse(systemsInput()).plumbing!.minimumSlope).toEqual({ rise: 1, run: 40, provenance: 'USER_PROVIDED' });
    expect(SystemsInputSchema.safeParse({ ...systemsInput(), plumbing: { ...systemsInput().plumbing, minimumSlope: { rise: 2, run: 1, provenance: 'USER_PROVIDED' } } }).success).toBe(false);
  });

  it('binds to the exact revision, derives terminals and networks from explicit input only, and is deterministic', () => {
    const input = parse(systemsInput()), a = buildSystemsModel(WET_BIM, input), b = buildSystemsModel(WET_BIM, input);
    expect(digest(a)).toBe(digest(b));
    expect(a.binding).toMatchObject({ projectId, revisionId, modelHash: WET_BIM.binding.modelHash, bimVersion: 'bim-semantic-v1', systemsModelVersion: 'building-systems-model-v1', structural: null, environmental: null });
    expect(a.networks.map(n => `${n.key}:${n.status}`)).toEqual(['COLD_WATER:READY', 'ELECTRICAL_CIRCUIT:c1:READY', 'ELECTRICAL_CIRCUIT:c2:READY', 'ELECTRICAL_FEEDER:READY',
      'HOT_WATER:READY', 'HVAC_RETURN:ra:READY', 'HVAC_SUPPLY:sa:READY', 'SANITARY:READY']);
    expect(a.exits).toMatchObject({ status: 'DESIGNATED', mode: 'SITE_PRIMARY_ENTRY', openingIds: [WET.site!.primaryEntryOpeningId] });
    expect(a.terminals.find(t => t.key === 'u-wc.SANITARY')).toMatchObject({ levelId: 'level-1', point: { x: 10200, z: 7000 }, y: 3000, role: 'FIXTURE' });
    expect(a.claims).toEqual(CLAIMS);
    expect(validateSystemsModel(a, WET_BIM.geometry, input, a.binding, null).status).toBe('VALID');
  });

  it('reports a terminal without a location as INPUT_INCOMPLETE instead of fabricating coordinates', () => {
    const input = systemsInput(); input.plumbing!.fixtures[0]!.connections[0]!.point = null;
    const model = buildSystemsModel(WET_BIM, parse(input));
    expect(model.networks.find(n => n.key === 'SANITARY')).toMatchObject({ status: 'INPUT_INCOMPLETE', missing: ['location of g-wc.SANITARY'] });
    expect(model.terminals.find(t => t.key === 'g-wc.SANITARY')!.point).toBeNull();
    const missingElevation = systemsInput(); missingElevation.plumbing!.coldWater.elevations = [{ levelId: 'level-0', elevationMm: 2200 }];
    expect(buildSystemsModel(WET_BIM, parse(missingElevation)).networks.find(n => n.key === 'COLD_WATER')!.missing).toEqual(['routing elevation on level-1']);
  });

  it('rejects terminals outside their space, windows or interior doors as exits, and broken circuit topology', () => {
    const outside = systemsInput(); outside.plumbing!.fixtures[0]!.connections[0]!.point = { x: 100, z: 100 };
    expect(codeOf(() => buildSystemsModel(WET_BIM, parse(outside)))).toBe('BUILDING_SYSTEMS_MODEL_INVALID');
    const window = systemsInput(); window.lifeSafety = { exits: { mode: 'EXPLICIT', openingIds: ['window-wall-level-0-3550-18900-9900-18900-2575-1200'] }, obstructedOpeningIds: [] };
    expect(codeOf(() => buildSystemsModel(WET_BIM, parse(window)))).toBe('BUILDING_SYSTEMS_MODEL_INVALID');
    const interior = systemsInput(); interior.lifeSafety = { exits: { mode: 'EXPLICIT', openingIds: ['door-wall-level-0-3550-2450-9900-2450-2725-900'] }, obstructedOpeningIds: [] };
    expect(codeOf(() => buildSystemsModel(WET_BIM, parse(interior)))).toBe('BUILDING_SYSTEMS_MODEL_INVALID');
    const orphan = systemsInput(); orphan.electrical!.circuits[1]!.loads = ['light-living'];
    expect(codeOf(() => buildSystemsModel(WET_BIM, parse(orphan)))).toBe('BUILDING_SYSTEMS_MODEL_INVALID');
    const noExit = systemsInput(); noExit.lifeSafety = { exits: null, obstructedOpeningIds: [] };
    expect(buildSystemsModel(WET_BIM, parse(noExit)).exits).toMatchObject({ status: 'INPUT_INCOMPLETE', missing: ['exit designation'] });
  });

  it('rejects upstream analyses bound to a different architecture and validates the bound structural envelope inventory', () => {
    const structural = structuralUpstream(), other = bimOf(WET, '55555555-5555-4555-8555-555555555555');
    expect(codeOf(() => buildSystemsModel(other, parse(systemsInput()), { structural, environmental: null }))).toBe('BUILDING_SYSTEMS_MODEL_INVALID');
    const model = buildSystemsModel(WET_BIM, parse(systemsInput()), { structural, environmental: null });
    expect(model.binding.structural).toEqual({ analysisId: structural.analysisId, inputHash: structural.inputHash, modelVersion: 'structural-model-v1' });
    expect(model.structure.members.map(m => [m.kind, m.halfSizeMm])).toEqual(expect.arrayContaining([['BEAM', 300], ['COLUMN', 150]]));
    expect(validateSystemsModel(model, WET_BIM.geometry, parse(systemsInput()), model.binding, structural.snapshot).status).toBe('VALID');
    const tampered = structuredClone(model); tampered.structure.members = tampered.structure.members.slice(1);
    expect(validateSystemsModel(tampered, WET_BIM.geometry, parse(systemsInput()), model.binding, structural.snapshot).diagnostics.map(d => d.code)).toContain('STRUCTURE');
  });
});

describe('Phase 26 plumbing and drainage', () => {
  const a = analyse(parse(systemsInput()));
  it('connects every explicit fixture, stacks upper fixtures, drains downhill at the declared slope and is independently valid', () => {
    expect(a.results.plumbing).toMatchObject({ status: 'ANALYZED', fixtures: 6, fixturesConnected: 6, notEvaluated: [...NOT_EVALUATED.plumbing] });
    const drain = net(a, 'SANITARY');
    expect(drain.status).toBe('ROUTED');
    expect(drain.drainage!.stacks.length).toBeGreaterThanOrEqual(1);
    expect(drain.drainage!.stacks[0]!.levelIds).toEqual(['level-0', 'level-1']);
    for (const b of drain.branches) b.points.forEach((p, i) => { if (i) expect(p.y).toBeLessThanOrEqual(b.points[i - 1]!.y + 1e-9); });
    const upper = a.model.terminals.filter(t => t.levelId === 'level-1' && t.key.endsWith('.SANITARY')).map(t => t.id);
    // Every upper fixture branch drops through the level-1 floor into the band beneath it before joining the stack or the network.
    for (const b of drain.branches.filter(x => upper.includes(x.terminalId))) expect(b.points.some((p, i) => i > 0 && p.x === b.points[i - 1]!.x && p.z === b.points[i - 1]!.z && b.points[i - 1]!.y >= 3000 && p.y <= 2750)).toBe(true);
    expect(drain.drainage!.arrivalElevation.value).toBeGreaterThanOrEqual(-800);
    expect(a.results.coordination.clashes).toEqual([]);
    expect(a.check()).toMatchObject({ status: 'VALID', diagnostics: [] });
  });

  it('reruns byte-identically (no clocks, no randomness, canonical tie-breaking)', () => {
    const b = analyse(parse(systemsInput()));
    expect(digest(b.results)).toBe(digest(a.results));
    expect(b.run.analysisInputHash).toBe(a.run.analysisInputHash);
  });

  it('refuses an impossible gravity route with a typed failure: no uphill run, no pressurised drainage, no 500', () => {
    const r = analyse(parse(systemsInput({ outletElevationMm: -200 })));
    expect(net(r, 'SANITARY')).toMatchObject({ status: 'ROUTE_INVALID', branches: [], failure: { code: 'SYSTEM_ROUTE_INVALID' } });
    expect(r.results.plumbing.status).toBe('PARTIAL');
    expect(r.check().status).toBe('VALID');
  });

  it('known answer: a 10 m run at 2 % falls exactly 200 mm', () => {
    const bim = bimOf(generateBlueprintV2(solverInput()).model);
    const input = parse({ version: 'building-systems-input-v1', plumbing: { fixtures: [{ key: 'f', kind: 'FLOOR_DRAIN', spaceId: 'space-corridor-0',
      connections: [{ service: 'SANITARY', point: { x: 1000, z: 5350 }, elevationMm: -300 }], provenance: 'USER_PROVIDED' }],
      sanitaryOutlet: { key: 'out', spaceId: 'space-corridor-0', point: { x: 11000, z: 5350 }, elevationMm: -700, provenance: 'USER_PROVIDED' },
      minimumSlope: { rise: 1, run: 50, provenance: 'USER_PROVIDED' }, sanitary: { bands: [{ levelId: 'level-0', topMm: -300, bottomMm: -900 }], size: null } } });
    const r = analyse(input, bim), drain = net(r, 'SANITARY');
    expect(drain.horizontalLength.value).toBe(10000);
    expect(drain.drainage!.arrivalElevation).toEqual({ value: -500, exact: '-500', unit: 'mm' });
    expect(r.check().status).toBe('VALID');
  });

  it('known answer: 10 m + 4 m horizontal and a 3 m vertical run measure 17 m with two bends', () => {
    const m = { levels: [{ elevationMm: 0 }, { elevationMm: 3000 }] } as unknown as Parameters<typeof measure>[0];
    const r = measure(m, [{ terminalId: 'x', joins: 'ROOT', points: [{ x: 0, y: 0, z: 0 }, { x: 10000, y: 0, z: 0 }, { x: 10000, y: 0, z: 4000 }, { x: 10000, y: 3000, z: 4000 }] }]);
    expect(r).toEqual({ horizontal: 14000, vertical: 3000, length: 17000, bends: 2, levelTransitions: 1 });
  });
});

describe('Phase 26 electrical coordination', () => {
  it('sums explicit loads exactly (1000 + 500 + 250 = 1750 W), routes load → circuit → panel, and never sizes protection', () => {
    const a = analyse(parse(systemsInput()));
    expect(a.results.electrical.total!.connected).toEqual({ W: { value: 1750, exact: '1750', unit: 'W' }, VA: { value: 0, exact: '0', unit: 'VA' },
      combined: { value: 1750, exact: '1750', unit: 'W' }, combinedStatus: 'EVALUATED' });
    expect(a.results.electrical.total!.demand).toMatchObject({ status: 'NOT_EVALUATED', W: null });
    expect(a.results.electrical.circuits.map(c => [c.key, c.connected.W.exact])).toEqual([['c1', '1500'], ['c2', '250']]);
    for (const key of ['ELECTRICAL_CIRCUIT:c1', 'ELECTRICAL_CIRCUIT:c2', 'ELECTRICAL_FEEDER']) {
      const n = net(a, key), root = a.model.terminals.find(t => t.id === a.model.networks.find(x => x.key === key)!.rootId)!;
      expect(n.status).toBe('ROUTED');
      expect(n.branches[0]!.points.at(-1)).toEqual({ x: root.point!.x, y: root.y, z: root.point!.z });
      expect(n.length.value).toBeGreaterThan(0);
    }
    expect(a.results.electrical.notEvaluated).toEqual(expect.arrayContaining(['BREAKER_SIZE', 'CONDUCTOR_AMPACITY', 'FAULT_CURRENT', 'EARTHING']));
  });

  it('computes demand only from explicit factors (0.9·1000 + 0.5·500 + 1·250 = 1400 W) and keeps decimals exact', () => {
    const a = analyse(only(parse(systemsInput({ demandFactors: true, loadWatts: [1000, 500, 250] })), ['electrical']));
    expect(a.results.electrical.total!.demand).toEqual({ status: 'EVALUATED', reason: null, W: { value: 1400, exact: '1400', unit: 'W' }, VA: { value: 0, exact: '0', unit: 'VA' } });
    const b = analyse(only(parse(systemsInput({ loadWatts: [0.1, 0.2, 1e-7] })), ['electrical']));
    expect(b.results.electrical.total!.connected.W.exact).toBe('0.3000001');
    const mixed = systemsInput(); mixed.electrical!.loads[1]!.power = { value: 500, unit: 'VA' };
    expect(analyse(only(parse(mixed), ['electrical'])).results.electrical.total!.connected).toMatchObject({ combined: null, combinedStatus: 'NOT_EVALUATED_MIXED_W_AND_VA' });
  });

  it('reports INPUT_INCOMPLETE without supply voltage, phase and frequency and never assumes 230 V, 120 V or a phase system', () => {
    const a = analyse(only(parse(systemsInput({ supply: false })), ['electrical']));
    expect(a.results.electrical).toMatchObject({ status: 'INPUT_INCOMPLETE', supply: { status: 'INPUT_INCOMPLETE', missing: ['supply systemVoltage', 'supply phaseSystem', 'supply frequencyHz'] } });
    expect(net(a, 'ELECTRICAL_FEEDER').status).toBe('INPUT_INCOMPLETE');
    expect(JSON.stringify(a.results.electrical)).not.toMatch(/SINGLE_PHASE|THREE_PHASE|"V"/);
    expect(a.check().status).toBe('VALID');
  });
});

describe('Phase 26 HVAC coordination and the Phase 25 handoff', () => {
  it('routes supply and return ducts and computes v = Q/A exactly only from explicit airflow and section', () => {
    const a = analyse(parse(systemsInput())), supply = net(a, 'HVAC_SUPPLY:sa');
    expect(supply.status).toBe('ROUTED');
    expect(supply.airflow!.total).toEqual({ value: 0.25, exact: '0.25', unit: 'm3/s' });
    // 0.25 / 0.06 = 25/6 m/s on the shared trunk; 0.15 / 0.06 = 2.5 and 0.1 / 0.06 = 5/3 on the branches.
    expect([...new Set(supply.airflow!.segments.map(s => s.velocity!.exact))]).toEqual(expect.arrayContaining(['25/6', '2.5', '5/3']));
    expect(a.results.hvac.notEvaluated).toEqual(expect.arrayContaining(['DESIGN_COOLING_LOAD', 'DESIGN_HEATING_LOAD', 'FAN_SIZING', 'DUCT_PRESSURE_LOSS']));
    expect(a.results.hvac.referenceInputs.environmental).toBeNull();
  });

  it('known answer: 0.5 m³/s through a 0.25 m² section is exactly 2 m/s', () => {
    const input = systemsInput(), s = input.hvac!.systems[0]!;
    s.terminals = [{ key: 'only', spaceId: 'space-bedroom-1', point: { x: 6000, z: 12000 }, elevationMm: 2700, airflow: { value: 500, unit: 'L/s', provenance: 'USER_PROVIDED' } }];
    s.ductSection = { shape: 'RECTANGULAR', widthMm: 500, heightMm: 500 }; input.hvac!.systems = [s];
    const n = net(analyse(only(parse(input), ['hvac'])), 'HVAC_SUPPLY:sa');
    expect(new Set(n.airflow!.segments.map(x => x.velocity!.exact))).toEqual(new Set(['2']));
  });

  it('binds an exact Phase 25 analysis as an envelope-transmission reference component that never becomes a design load', () => {
    const environmental = environmentalUpstream(), input = parse(systemsInput({ environmentalAnalysisId: environmental.analysisId }));
    const a = analyse(input, WET_BIM, { structural: null, environmental });
    expect(a.model.binding.environmental).toEqual({ analysisId: environmental.analysisId, inputHash: environmental.inputHash, modelVersion: 'environmental-model-v1' });
    const ref = a.results.hvac.referenceInputs.environmental!;
    expect(ref).toMatchObject({ role: 'ENVELOPE_TRANSMISSION_COMPONENT', isDesignLoad: false, analysisId: environmental.analysisId });
    expect(ref.cases[0]!.envelopeTransmission).toEqual(environmental.snapshot.results.thermal.cases[0]!.total);
    expect(JSON.stringify(a.results.hvac)).not.toMatch(/"designCoolingLoad"|"designHeatingLoad"|"capacity"/);
    expect(a.check().status).toBe('VALID');
    expect(a.check(forge(a.results, r => { r.hvac.referenceInputs.environmental!.cases[0]!.envelopeTransmission.value *= 2; })).diagnostics.map(d => d.code)).toContain('HANDOFF');
    expect(SnapshotSchema.shape.results.safeParse(forge(a.results, r => { (r.hvac.referenceInputs.environmental as unknown as { isDesignLoad: boolean }).isDesignLoad = true; })).success).toBe(false);
  });
});

describe('Phase 26 life-safety geometry (independent egress graph)', () => {
  it('reaches the designated exit from every space of both levels through exact doors and the stair, with a dead-end metric and no compliance claim', () => {
    const a = analyse(parse(systemsInput())), ls = a.results.lifeSafety;
    expect(ls).toMatchObject({ status: 'ANALYZED', egressAvailable: true, unreachableSpaceIds: [], convention: 'egress-l1-geodesic-v1', notEvaluated: [...NOT_EVALUATED.lifeSafety] });
    const bedroom = ls.spaces.find(s => s.spaceId === 'space-bedroom-1')!;
    expect(bedroom.via.map(v => v.id)).toEqual(['door-wall-level-1-3550-2450-9400-2450-2475-900', 'door-wall-level-1-2250-2450-2250-16900-5600-900', 'stair-0',
      'door-wall-level-0-2250-2450-2250-18900-200-900', WET.site!.primaryEntryOpeningId]);
    expect(bedroom).toMatchObject({ levelTransitions: 1, disjointExitRoutes: 1, distinctExitsReachable: 1 });
    expect(ls.longest!.spaceId).toBe('space-bedroom-1');
    expect(ls.deadEnds).toEqual([expect.objectContaining({ spaceId: 'space-corridor-1', metric: 'GEOMETRIC_DEAD_END_LENGTH' })]);
    expect(JSON.stringify(ls)).not.toMatch(/COMPLIANT|"PASS"|VIOLATION/);
  });

  it('known answer: rectangular rooms measure the L1 distance from the farthest corner through the door centres', () => {
    const m = authored(), bim = bimOf(m);
    const a = analyse(parse({ version: 'building-systems-input-v1', lifeSafety: { exits: { mode: 'EXPLICIT', openingIds: ['entry-door'] }, obstructedOpeningIds: [] } }), bim);
    const centre = (id: string) => { const o = m.openings.find(x => x.id === id)!, w = m.walls.find(x => x.id === o.wallId)!, ux = Math.sign(w.path.end.x - w.path.start.x), uz = Math.sign(w.path.end.z - w.path.start.z);
      return { x: w.path.start.x + ux * (o.offsetMm + o.widthMm / 2), z: w.path.start.z + uz * (o.offsetMm + o.widthMm / 2) }; };
    const l1 = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.abs(p.x - q.x) + Math.abs(p.z - q.z);
    const corners = (id: string) => m.spaces.find(s => s.id === id)!.boundary;
    const entry = centre('entry-door'), door = centre('studio-door');
    expect(a.results.lifeSafety.spaces.find(s => s.spaceId === 'foyer')!.distance!.value).toBe(Math.max(...corners('foyer').map(c => l1(c, entry))));
    expect(a.results.lifeSafety.spaces.find(s => s.spaceId === 'studio')!.distance!.value).toBe(Math.max(...corners('studio').map(c => l1(c, door))) + l1(door, entry));
    expect(a.check().status).toBe('VALID');
  });

  it('reports a geometric egress failure when the only upper-floor connection is obstructed (QA circulation is not reused)', () => {
    const input = systemsInput(); input.lifeSafety = { exits: { mode: 'SITE_PRIMARY_ENTRY' }, obstructedOpeningIds: ['door-wall-level-1-2250-2450-2250-16900-5600-900'] };
    const a = analyse(only(parse(input), ['lifeSafety'])), ls = a.results.lifeSafety;
    expect(ls).toMatchObject({ status: 'ANALYZED', egressAvailable: false });
    expect(ls.unreachableSpaceIds).toEqual(['space-bathroom-2', 'space-bedroom-1', 'space-corridor-1']);
    expect(a.check().status).toBe('VALID');
  });

  it('counts node-disjoint routes honestly where two exits exist: a shared corridor is one independent route', () => {
    const m = generateBlueprintV2(solverInput()).model;
    const wall = m.walls.find(w => w.classification === 'exterior' && w.path.start.z === w.path.end.z && w.path.start.z > 15000)!;
    m.openings.push({ id: 'second-exit', kind: 'door', wallId: wall.id, levelId: wall.levelId, offsetMm: 500, widthMm: 900, heightMm: 2100, sillMm: 0, type: 'exit', operation: { kind: 'unspecified' } });
    const a = analyse(parse({ version: 'building-systems-input-v1', lifeSafety: { exits: { mode: 'EXPLICIT', openingIds: ['opening-5', 'second-exit'] }, obstructedOpeningIds: [] } }), bimOf(m));
    const space = (id: string) => a.results.lifeSafety.spaces.find(s => s.spaceId === id)!;
    expect(space('space-bedroom-2')).toMatchObject({ distinctExitsReachable: 2, disjointExitRoutes: 2 });
    expect(space('space-living-1')).toMatchObject({ distinctExitsReachable: 2, disjointExitRoutes: 1 });
    expect(a.check().status).toBe('VALID');
  });
});

describe('Phase 26 vertical transport proposals', () => {
  it('proposes an aligned shaft inside both levels, off the stair, with a door onto reachable circulation, and never mutates the architecture', () => {
    const before = digest(WET_BIM.geometry), a = analyse(parse(systemsInput())), lift = a.results.verticalTransport.elevators[0]!;
    expect(lift).toMatchObject({ status: 'PROPOSED', placement: 'PLANNER_SELECTED', servedLevelIds: ['level-0', 'level-1'], architectureMutation: 'NONE',
      verticalAccess: 'VERTICAL_ACCESS_PATH_AVAILABLE', blockingClashIds: [], structuralCheck: 'NOT_EVALUATED' });
    expect(lift.door.spaceIds.every(s => a.model.spaces.find(x => x.spaceId === s)!.circulation)).toBe(true);
    expect(lift.engineering).toEqual({ cabin: { status: 'NOT_SPECIFIED', value: null }, pitDepth: { status: 'NOT_SPECIFIED', value: null }, overhead: { status: 'NOT_SPECIFIED', value: null },
      ratedLoad: { status: 'NOT_SPECIFIED', value: null }, ratedSpeed: { status: 'NOT_SPECIFIED', value: null } });
    expect(a.results.verticalTransport.notEvaluated).toEqual(expect.arrayContaining(['MOTOR', 'TRAFFIC_ANALYSIS', 'CODE_COMPLIANCE']));
    expect(digest(WET_BIM.geometry)).toBe(before);
    expect(JSON.stringify(a.results.verticalTransport)).not.toMatch(/ACCESSIBLE|ADA|COMPLIANT/);
  });

  it('rejects a fixed shaft through the stair as BLOCKING and never relocates it', () => {
    const a = analyse(only(parse(systemsInput({ elevator: { x: 1200, z: 3700 } })), ['verticalTransport', 'lifeSafety'])), lift = a.results.verticalTransport.elevators[0]!;
    expect(lift).toMatchObject({ status: 'REJECTED', shaft: { minX: 1200, minZ: 3700, maxX: 2800, maxZ: 5300 } });
    expect(a.results.coordination.clashes.filter(c => lift.blockingClashIds.includes(c.id)).map(c => [c.type, c.entityB, c.severity])).toContainEqual(['VERTICAL_TRANSPORT_CLASH', 'stairs/stair-0', 'BLOCKING']);
    expect(a.check().status).toBe('VALID');
  });

  it('rejects a fixed shaft through a bound structural column and one that is not inside every served level', () => {
    const structural = structuralUpstream();
    const col = analyse(only(parse(systemsInput({ elevator: { x: 3000, z: 2000 }, structuralAnalysisId: structural.analysisId })), ['verticalTransport']), WET_BIM, { structural, environmental: null });
    expect(col.results.verticalTransport.elevators[0]).toMatchObject({ status: 'REJECTED', structuralCheck: 'EVALUATED' });
    expect(col.results.coordination.clashes.some(c => c.type === 'VERTICAL_TRANSPORT_CLASH' && c.disciplineB === 'STRUCTURE')).toBe(true);
    const outside = analyse(only(parse(systemsInput({ elevator: { x: 17200, z: 3000 } })), ['verticalTransport']));
    expect(outside.results.verticalTransport.elevators[0]).toMatchObject({ status: 'REJECTED', reason: 'The shaft is not inside every served level' });
    expect(col.check().status).toBe('VALID'); expect(outside.check().status).toBe('VALID');
  });

  it('clips overlapped space areas exactly', () => {
    const l = [{ x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 4000, z: 1000 }, { x: 1000, z: 1000 }, { x: 1000, z: 3000 }, { x: 0, z: 3000 }];
    expect(clippedArea(l, { minX: 500, minZ: 500, maxX: 2500, maxZ: 2500 })).toBe(2000 * 500 + 500 * 1500);
  });
});

describe('Phase 26 coordination clashes and structural absence', () => {
  const user = 'USER_PROVIDED' as const;
  /** A duct and a pipe deliberately crossing the bound beam and each other (FIXED, never rerouted), or the same terminals PLANNED. */
  function clashInput(mode: 'FIXED' | 'PLANNED', structuralAnalysisId: string | null): SystemsInput {
    return parse({ version: 'building-systems-input-v1', sources: { structuralAnalysisId, environmentalAnalysisId: null },
      hvac: { equipment: [{ key: 'fan', kind: 'FAN', spaceId: 'space-corridor-0', point: { x: 5000, z: 1800 }, elevationMm: 2400, footprint: null, provenance: user }],
        systems: [{ key: 'x', kind: 'SUPPLY', equipment: 'fan', connection: { point: { x: 5000, z: 1800 }, elevationMm: 2400 },
          terminals: [{ key: 'grille', spaceId: 'space-bathroom-1', point: { x: 5000, z: 4000 }, elevationMm: 2700, airflow: { value: 100, unit: 'L/s', provenance: user } }],
          ductSection: { shape: 'RECTANGULAR', widthMm: 300, heightMm: 200 }, elevations: [{ levelId: 'level-0', elevationMm: 2400 }],
          routing: mode === 'FIXED' ? { mode: 'FIXED', routes: [{ terminal: 'grille', points: [{ x: 5000, y: 2700, z: 4000 }, { x: 5000, y: 2900, z: 4000 }, { x: 5000, y: 2900, z: 1800 }, { x: 5000, y: 2400, z: 1800 }] }] } : { mode: 'PLANNED' } }],
        clearance: null },
      plumbing: { fixtures: [{ key: 'tap', kind: 'OTHER', spaceId: 'space-bathroom-1', connections: [{ service: 'COLD_WATER', point: { x: 4500, z: 3000 }, elevationMm: 2900 }], provenance: user }],
        coldWaterSource: { key: 'main', spaceId: 'space-bathroom-1', point: { x: 6000, z: 3000 }, elevationMm: 2900, provenance: user },
        coldWater: { elevations: [{ levelId: 'level-0', elevationMm: 2200 }], size: { shape: 'ROUND', diameterMm: 20 },
          routing: mode === 'FIXED' ? { mode: 'FIXED', routes: [{ terminal: 'tap.COLD_WATER', points: [{ x: 4500, y: 2900, z: 3000 }, { x: 6000, y: 2900, z: 3000 }] }] } : { mode: 'PLANNED' } } } });
  }
  it('reports MEP_STRUCTURE_CLASH and DUCT_PIPE_CLEARANCE with exact references and spatial evidence for crossing fixed routes', () => {
    const structural = structuralUpstream(), a = analyse(clashInput('FIXED', structural.analysisId), WET_BIM, { structural, environmental: null });
    const beam = structural.snapshot.model.members.find(m => m.kind === 'BEAM')!.id;
    const hit = a.results.coordination.clashes.find(c => c.type === 'MEP_STRUCTURE_CLASH' && c.entityB === `structure/${beam}`)!;
    expect(hit).toMatchObject({ severity: 'BLOCKING', basis: 'PHYSICAL_INTERSECTION', disciplineA: 'HVAC', disciplineB: 'STRUCTURE', resolution: 'UNRESOLVED' });
    expect(hit.entityA).toMatch(/^networks\/HVAC_SUPPLY:x\/branch-0\/segment-\d+$/);
    expect(hit.bounds).toEqual({ minX: 4850, maxX: 5150, minY: 2800, maxY: 3000, minZ: 2150, maxZ: 2750 });
    expect(a.results.coordination.clashes.find(c => c.type === 'DUCT_PIPE_CLEARANCE')).toMatchObject({ severity: 'BLOCKING', bounds: { minX: 4850, maxX: 5150, minZ: 2990, maxZ: 3010 } });
    expect(a.results.coordination.penetrations.some(p => p.host.id === 'wall-level-0-3550-2450-9900-2450' && p.review === 'REVIEW_REQUIRED')).toBe(true);
    expect(a.check().status).toBe('VALID');
    const planned = analyse(clashInput('PLANNED', structural.analysisId), WET_BIM, { structural, environmental: null });
    expect(planned.results.networks.every(n => n.status === 'ROUTED')).toBe(true);
    expect(planned.results.coordination.clashes.filter(c => c.severity === 'BLOCKING')).toEqual([]);
    expect(planned.check().status).toBe('VALID');
  });

  it('without a structural source evaluates architecture clashes only and reports structural clearance as NOT_EVALUATED', () => {
    const a = analyse(clashInput('FIXED', null));
    expect(a.results.coordination).toMatchObject({ structuralClearance: 'NOT_EVALUATED', unevaluatedMemberIds: [] });
    expect(a.results.coordination.clashes.some(c => c.type === 'MEP_STRUCTURE_CLASH')).toBe(false);
    expect(a.results.coordination.clashes.some(c => c.type === 'DUCT_PIPE_CLEARANCE')).toBe(true);
    expect(JSON.stringify(a.results)).not.toContain('STRUCTURAL_CLEARANCE_VERIFIED');
  });
});

describe('Phase 26 independent validators reject forged output', () => {
  const structural = structuralUpstream();
  const a = analyse(parse(systemsInput({ structuralAnalysisId: structural.analysisId })), WET_BIM, { structural, environmental: null });
  const codes = (results: SystemsResults) => a.check(results).diagnostics.map(d => d.code);
  const index = (key: string) => a.results.networks.findIndex(n => keyOf(a.model, n.networkId) === key);
  it('accepts the genuine output', () => expect(a.check()).toMatchObject({ status: 'VALID', diagnostics: [] }));
  it('rejects a wrong route length, an omitted terminal and a disconnected route', () => {
    expect(codes(forge(a.results, r => { r.networks[index('COLD_WATER')]!.length.value += 1000; }))).toContain('LENGTH');
    expect(codes(forge(a.results, r => { r.networks[index('COLD_WATER')]!.branches.pop(); }))).toContain('ROUTE');
    expect(codes(forge(a.results, r => { r.networks[index('COLD_WATER')]!.branches.at(-1)!.points.pop(); }))).toContain('ROUTE');
  });
  it('rejects an uphill drainage segment and a run flatter than the declared slope', () => {
    expect(codes(forge(a.results, r => { const b = r.networks[index('SANITARY')]!.branches[0]!; b.points[2]!.y += 400; }))).toContain('SLOPE');
    expect(codes(forge(a.results, r => { const b = r.networks[index('SANITARY')]!.branches[0]!, k = b.points.findIndex((p, i) => i > 0 && (p.x !== b.points[i - 1]!.x || p.z !== b.points[i - 1]!.z));
      const base = b.points[k - 1]!.y; b.points.slice(k).forEach(p => { p.y = base + (p.y - base) * 0.5; }); }))).toContain('SLOPE');
    // A vertical up-and-down detour: horizontal runs, slope and bands are untouched, so only the uphill check can reject it.
    expect(codes(forge(a.results, r => { const b = r.networks[index('SANITARY')]!.branches[0]!, p = b.points[1]!;
      b.points.splice(2, 0, { ...p, y: p.y + 100 }, { ...p }); }))).toContain('SLOPE');
  });
  it('rejects wrong load sums, ignored demand factors, and wrong airflow or velocity', () => {
    expect(codes(forge(a.results, r => { r.electrical.total!.connected.W = { value: 1700, exact: '1700', unit: 'W' }; }))).toContain('ELECTRICAL');
    expect(codes(forge(a.results, r => { r.electrical.circuits[0]!.demand = { status: 'EVALUATED', reason: null, W: { value: 1500, exact: '1500', unit: 'W' }, VA: { value: 0, exact: '0', unit: 'VA' } }; }))).toContain('ELECTRICAL');
    expect(codes(forge(a.results, r => { r.networks[index('HVAC_SUPPLY:sa')]!.airflow!.segments[0]!.velocity = { value: 2, exact: '2', unit: 'm/s' }; }))).toContain('AIRFLOW');
    expect(codes(forge(a.results, r => { r.networks[index('HVAC_SUPPLY:sa')]!.airflow!.total = { value: 0.3, exact: '0.3', unit: 'm3/s' }; }))).toContain('AIRFLOW');
  });
  it('rejects edited egress distances, broken egress chains, removed penetrations, a flipped elevator and an evaluated "not evaluated"', () => {
    expect(codes(forge(a.results, r => { r.lifeSafety.spaces[0]!.distance!.value -= 500; }))).toContain('EGRESS');
    expect(codes(forge(a.results, r => { r.lifeSafety.spaces.find(s => s.spaceId === 'space-bedroom-1')!.via.splice(2, 1); }))).toContain('EGRESS');
    expect(codes(forge(a.results, r => { r.coordination.penetrations.pop(); }))).toContain('PENETRATION');
    expect(codes(forge(a.results, r => { r.verticalTransport.elevators[0]!.status = 'REJECTED'; }))).toContain('VERTICAL');
    expect(codes(forge(a.results, r => { (r.plumbing.notEvaluated as string[]).splice(0, 1); }))).toContain('CLAIMS');
    expect(codes(forge(a.results, r => { r.quantities.networks[0]!.length.value += 1; }))).toContain('QUANTITY');
  });
  it('detects a self-consistent detour through a structural column by recomputing the clash set', () => {
    const forged = forge(a.results, r => {
      const b = r.networks[index('COLD_WATER')]!.branches[0]!, first = b.points[0]!, y = b.points[1]!.y;
      // Detour through column c1 at (3550, 2450) and back, at the network's routing elevation.
      b.points.splice(1, 0, { x: first.x, y, z: first.z }, { x: 3550, y, z: first.z }, { x: 3550, y, z: 2450 }, { x: 3600, y, z: 2450 }, { x: 3600, y, z: first.z }, { x: first.x, y, z: first.z });
    });
    expect(codes(forged)).toContain('CLASH');
  });
  it('rejects malformed, misidentified or foreign calculator output before validation', () => {
    const input = parse(systemsInput()), model = buildSystemsModel(WET_BIM, input), ai = resolveAnalysisInput(model, input);
    const adapter = (mutate: (raw: ReturnType<typeof calculate>) => unknown): SystemsCalculatorAdapter => ({ metadata: REFERENCE_CALCULATOR.metadata, analyze: (x, c) => mutate(calculate(x, c)) });
    expect(codeOf(() => runSystemsAnalysis(ai, adapter(raw => ({ ...raw, calculator: { name: 'other', version: '1' } }))))).toBe('SYSTEM_RESULT_INVALID');
    expect(codeOf(() => runSystemsAnalysis(ai, adapter(raw => ({ ...raw, analysisInputHash: '0'.repeat(64) }))))).toBe('SYSTEM_RESULT_INVALID');
    expect(codeOf(() => runSystemsAnalysis(ai, adapter(raw => ({ ...raw, results: { ...raw.results, networks: raw.results.networks.slice(1) } }))))).toBe('SYSTEM_RESULT_INVALID');
    expect(codeOf(() => runSystemsAnalysis(ai, adapter(raw => { raw.results.networks[0]!.length.value = Infinity; return raw; })))).toBe('SYSTEM_RESULT_INVALID');
    expect(codeOf(() => runSystemsAnalysis(ai, { metadata: REFERENCE_CALCULATOR.metadata, analyze: () => { throw new Error('boom'); } }))).toBe('SYSTEM_ANALYSIS_FAILED');
  });
});

describe('Phase 26 hashes, limits and determinism', () => {
  it('changes the input hash for changed loads, pipe routing or duct dimensions, and keeps it for identical input', () => {
    const binding = buildSystemsModel(WET_BIM, parse(systemsInput())).binding, base = systemsInputHash(binding, parse(systemsInput()));
    expect(systemsInputHash(binding, parse(systemsInput()))).toBe(base);
    expect(systemsInputHash(binding, parse(systemsInput({ loadWatts: [1100, 500, 250] })))).not.toBe(base);
    expect(systemsInputHash(binding, parse(systemsInput({ ductWidthMm: 400 })))).not.toBe(base);
    expect(systemsInputHash(binding, parse(systemsInput({ outletElevationMm: -850 })))).not.toBe(base);
  });

  it('refuses predicted resource overflow before any search with BUILDING_SYSTEMS_RESOURCE_LIMIT', () => {
    const input = systemsInput();
    input.electrical!.loads = Array.from({ length: SYSTEMS_LIMITS.terminals - 20 }, (_, i) => ({ key: `l${i}`, kind: 'SOCKET' as const, spaceId: 'space-bathroom-1',
      point: { x: 3700 + (i % 60) * 100, z: 2600 + Math.floor(i / 60) * 1000 + (i % 7) }, elevationMm: 300, power: { value: 10, unit: 'W' as const }, phase: null, demandFactor: null, provenance: 'USER_PROVIDED' as const }));
    input.electrical!.circuits = [{ key: 'all', panel: 'db-1', loads: input.electrical!.loads.map(l => l.key) }];
    const parsed = parse(only(input, ['electrical'])), model = buildSystemsModel(WET_BIM, parsed);
    expect(codeOf(() => resolveAnalysisInput(model, parsed))).toBe('BUILDING_SYSTEMS_RESOURCE_LIMIT');
    // More terminals across disciplines than the model admits (480 loads + plumbing + HVAC > 500) is refused while building the model.
    expect(codeOf(() => buildSystemsModel(WET_BIM, parse(only(input, ['electrical', 'plumbing', 'hvac']))))).toBe('BUILDING_SYSTEMS_RESOURCE_LIMIT');
  });

  it('builds a schema-valid snapshot carrying every claim as NOT_CLAIMED and MEP costing as NOT_EVALUATED', () => {
    const a = analyse(parse(systemsInput()));
    const snapshot = SnapshotSchema.parse({ version: 'building-systems-analysis-v1', binding: a.model.binding, inputHash: a.draft.inputHash, analysisInputHash: a.run.analysisInputHash,
      input: a.draft.input, model: a.model, calculator: a.run.calculator, results: a.results,
      validation: { model: validateSystemsModel(a.model, WET_BIM.geometry, a.draft.input, a.model.binding, null), results: a.check() },
      status: { analysis: 'ANALYZED', validation: 'VALIDATED' }, claims: CLAIMS, limitations: ['x'] });
    expect(Object.values(snapshot.claims).every(v => v === 'NOT_CLAIMED')).toBe(true);
    expect(snapshot.results.quantities.costing).toBe('NOT_EVALUATED');
    expect(systemsId(projectId, 'terminal', 'plumbing:g-wc.SANITARY')).toBe(a.model.terminals.find(t => t.key === 'g-wc.SANITARY')!.id);
  });
});
