import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { generateParametricBlueprint } from '@designflow/generator';
import { modelHash } from './apps/api/dist/lib/generation-identity.js';
import { digest } from './apps/api/dist/bim/core.js';
import { projectBim } from './apps/api/dist/bim/project.js';
import { SystemsInputSchema } from './apps/api/dist/systems/contracts.js';
import { buildSystemsModel } from './apps/api/dist/systems/model.js';
import { resolveAnalysisInput, runSystemsAnalysis, systemsInputHash } from './apps/api/dist/systems/analysis.js';
import { validateSystemsModel } from './apps/api/dist/systems/validate.js';

// Phase 27 compiled acceptance (container, --network none). Building and systems input are the Phase 26 compiled acceptance verbatim;
// compiled production modules only: no test-support, network, database or AI. Every expected value below is hand-known (design §22).
const requirements = { site: { boundary: [{ x: 0, z: 0 }, { x: 22000, z: 0 }, { x: 22000, z: 22000 }, { x: 0, z: 22000 }], northMilliDegrees: 0 }, floors: 2,
  rooms: [{ type: 'bedroom', count: 1, level: 1 }, { type: 'bathroom', count: 1, level: 1 }, { type: 'living', count: 1, level: 0 }, { type: 'kitchen', count: 1, level: 0 }, { type: 'bathroom', count: 1, level: 0 }],
  seed: 'phase22', parametricArchitecture: { version: 1, shape: 'L', origin: { x: 1000, z: 1000 }, floors: [{ level: 0, widthMm: 18000, depthMm: 18000, westWingWidthMm: 9000, southWingDepthMm: 8000 },
    { level: 1, widthMm: 16000, depthMm: 16000, westWingWidthMm: 8500, southWingDepthMm: 7000 }] } };
const { model } = generateParametricBlueprint(requirements);
const binding = { projectId: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', modelHash: modelHash(model),
  parameterHash: digest(model.parametricArchitecture), generatorVersion: model.provenance.generatorVersion, generationId: null, requirementsHash: null };
const bim = projectBim(model, binding), user = 'USER_PROVIDED';
const at = (spaceId, x, z, elevationMm) => ({ spaceId, point: { x, z }, elevationMm });
const conn = (service, x, z, elevationMm) => ({ service, point: { x, z }, elevationMm });
const input = SystemsInputSchema.parse({ version: 'building-systems-input-v1',
  plumbing: { fixtures: [{ key: 'g-wc', kind: 'WC', spaceId: 'space-bathroom-1', connections: [conn('SANITARY', 4200, 4000, 0), conn('COLD_WATER', 4500, 4000, 200)], provenance: user },
    { key: 'u-wc', kind: 'WC', spaceId: 'space-bathroom-2', connections: [conn('SANITARY', 10200, 7000, 0), conn('COLD_WATER', 10500, 7000, 200)], provenance: user },
    { key: 'k-sink', kind: 'SINK', spaceId: 'space-kitchen-1', connections: [conn('SANITARY', 16000, 8200, 600), conn('COLD_WATER', 16200, 8200, 900)], provenance: user }],
    coldWaterSource: { key: 'main', ...at('space-corridor-0', 5000, 1800, 300), provenance: user }, sanitaryOutlet: { key: 'sewer', ...at('space-corridor-0', 9000, 1500, -800), provenance: user },
    minimumSlope: { rise: 1, run: 40, provenance: user }, coldWater: { elevations: [{ levelId: 'level-0', elevationMm: 2200 }, { levelId: 'level-1', elevationMm: -700 }], size: { shape: 'ROUND', diameterMm: 20 } },
    sanitary: { bands: [{ levelId: 'level-0', topMm: -300, bottomMm: -900 }, { levelId: 'level-1', topMm: -250, bottomMm: -500 }], size: { shape: 'ROUND', diameterMm: 100 } },
    clearance: { value: 25, unit: 'mm', provenance: user } },
  electrical: { supply: { key: 'mains', systemVoltage: { value: 230, unit: 'V' }, phaseSystem: 'SINGLE_PHASE', frequencyHz: { value: 50, unit: 'Hz' }, ...at('space-corridor-0', 2000, 1500, 1500), provenance: user },
    panels: [{ key: 'db', ...at('space-corridor-0', 3000, 1700, 1500), provenance: user }], circuits: [{ key: 'c1', panel: 'db', loads: ['a', 'b', 'c'] }],
    loads: [{ key: 'a', kind: 'LIGHTING', ...at('space-living-1', 12000, 5000, 2700), power: { value: 1000, unit: 'W' }, demandFactor: { value: 0.9, provenance: user }, provenance: user },
      { key: 'b', kind: 'SOCKET', ...at('space-kitchen-1', 16000, 4000, 300), power: { value: 500, unit: 'W' }, demandFactor: { value: 0.5, provenance: user }, provenance: user },
      { key: 'c', kind: 'SOCKET', ...at('space-bathroom-1', 6000, 9000, 300), power: { value: 250, unit: 'W' }, demandFactor: { value: 1, provenance: user }, provenance: user }],
    feeder: { elevations: [{ levelId: 'level-0', elevationMm: 2500 }] }, circuitRouting: { elevations: [{ levelId: 'level-0', elevationMm: 2500 }], size: { shape: 'ROUND', diameterMm: 25 } },
    clearance: { value: 25, unit: 'mm', provenance: user } },
  hvac: { equipment: [{ key: 'ahu', kind: 'AIR_HANDLING_UNIT', ...at('space-corridor-1', 5200, 1750, 2300), provenance: user }],
    systems: [{ key: 'sa', kind: 'SUPPLY', equipment: 'ahu', connection: { point: { x: 5000, z: 1750 }, elevationMm: 2300 },
      terminals: [{ key: 'bed', ...at('space-bedroom-1', 6000, 12000, 2700), airflow: { value: 500, unit: 'L/s', provenance: user } }],
      ductSection: { shape: 'RECTANGULAR', widthMm: 500, heightMm: 500 }, elevations: [{ levelId: 'level-1', elevationMm: 2400 }] }], clearance: { value: 50, unit: 'mm', provenance: user } },
  lifeSafety: { exits: { mode: 'SITE_PRIMARY_ENTRY' } },
  verticalTransport: { elevators: [{ key: 'lift', servedLevelIds: ['level-0', 'level-1'], shaft: { widthMm: 1600, depthMm: 1600 }, door: { side: '+z', widthMm: 900 },
    placement: { mode: 'PLANNER_SELECTED' }, provenance: user }] } });
import { buildStructuralModel } from './apps/api/dist/structural/model.js';
import { structuralInputHash } from './apps/api/dist/structural/analysis.js';
import { CLAIMS, DISCIPLINES, KnowledgeInputSchema } from './apps/api/dist/knowledge/contracts.js';
import { bundledPack, catalogEntries } from './apps/api/dist/knowledge/packs.js';
import { checkUpstreamConsistency, extractFacts, knowledgeBinding } from './apps/api/dist/knowledge/facts.js';
import { evaluate } from './apps/api/dist/knowledge/evaluate.js';
import { validateKnowledgeModel, validateKnowledgeResults } from './apps/api/dist/knowledge/validate.js';

const systems = buildSystemsModel(bim, input);
assert.equal(validateSystemsModel(systems, bim.geometry, input, systems.binding, null).status, 'VALID');
const run = runSystemsAnalysis(resolveAnalysisInput(systems, input)), yHash = systemsInputHash(systems.binding, input);
const concrete = { key: 'test-concrete', category: 'CONCRETE', name: 'Fixture concrete (test values only)', elasticModulus: { value: 30000, unit: 'MPa' }, poissonRatio: { value: 0.2, unit: '1' },
  density: { value: 2400, unit: 'kg/m3' }, architecturalSpecificationId: null };
const wall = 'wall-level-0-3550-2450-9900-2450';
const frame = { version: 'structural-input-v1', materials: [concrete], sections: [{ key: 'col', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 300, unit: 'mm' } },
  { key: 'beam', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 600, unit: 'mm' } }],
  members: [{ key: 'b1', rule: 'BEAM_ALONG_WALL', wallId: wall, material: 'test-concrete', section: 'beam' }, { key: 'c1', rule: 'COLUMN_AT_WALL_END', wallId: wall, end: 'start', material: 'test-concrete', section: 'col' },
    { key: 'c2', rule: 'COLUMN_AT_WALL_END', wallId: wall, end: 'end', material: 'test-concrete', section: 'col' }],
  supports: [], autoSupports: { rule: 'BASE_OF_COLUMNS_AT_LOWEST_ELEVATION', type: 'FIXED' }, combinations: [], loadCases: [{ key: 'd', category: 'DEAD', selfWeight: true, loads: [] }] };
const structural = buildStructuralModel(bim, frame), sHash = structuralInputHash(structural.binding, frame);
const S = '33333333-3333-4333-8333-333333333333', Y = '55555555-5555-4555-8555-555555555555';
const up = { structural: { analysisId: S, inputHash: sHash, snapshot: { version: 'structural-analysis-v1', binding: structural.binding, inputHash: sHash, model: structural } },
  environmental: null, systems: { analysisId: Y, inputHash: yHash, snapshot: { version: 'building-systems-analysis-v1', binding: systems.binding, inputHash: yHash, model: systems, results: run.results } } };
const k = KnowledgeInputSchema.parse({ version: 'specialized-knowledge-input-v1', packs: [{ packId: 'nekoarch-demo-dimensional', version: '1.0.0' }, { packId: 'nekoarch-demo-coordination', version: '1.0.0' }],
  sources: { structuralAnalysisId: S, environmentalAnalysisId: null, systemsAnalysisId: Y }, scope: { disciplines: DISCIPLINES } });
const catalog = catalogEntries();
assert.deepEqual(catalog.map(c => [c.packId, c.ruleCount, c.license.spdx, c.jurisdiction]), [['nekoarch-demo-coordination', 15, 'CC0-1.0', null], ['nekoarch-demo-dimensional', 15, 'CC0-1.0', null]]);
const packs = k.packs.map(p => bundledPack(p.packId, p.version));
for (const p of packs) assert.equal(digest(p.pack), p.checksum);
const kb = knowledgeBinding(bim.binding, up, packs, k.scope.disciplines);
checkUpstreamConsistency(kb, up);
const facts = extractFacts(bim, up, kb);
assert.equal(validateKnowledgeModel(facts, bim, up, kb, { packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version, checksum: p.checksum })), disciplines: [...k.scope.disciplines] }).status, 'VALID');
const e = evaluate(packs, facts, k, new Set(['ARCHITECTURE', 'STRUCTURAL', 'SYSTEMS']));
const stored = { version: k.version, packs: k.packs, sources: k.sources, scope: k.scope };
const draft = { binding: kb, inputHash: digest({ version: 'specialized-knowledge-analysis-v1', binding: kb, input: stored }), factsHash: digest(facts), input: stored, facts, claims: CLAIMS,
  packs: packs.map(p => ({ packId: p.pack.packId, version: p.pack.version, checksum: p.checksum, pack: p.pack, rulesTotal: p.pack.rules.length, rulesSelected: p.pack.rules.length })), ...e };
const v = validateKnowledgeResults(draft, { binding: kb, checksums: Object.fromEntries(packs.map(p => [`${p.pack.packId}@${p.pack.version}`, p.checksum])) });
assert.equal(v.status, 'VALID', JSON.stringify(v.diagnostics.slice(0, 3)));
const st = id => e.results.filter(x => x.ruleId === id).map(x => x.status), one = id => e.results.find(x => x.ruleId === id);
// Known answers: doors 900 = 900; stair width 1000 < 1001; max riser 188 > 187; tread 280 >= 0.279 m; no headroom modelled; no garage;
// sill 900 vs >= 900 and <= 850 contradict; 1440000/29025000 = 32/645 >= 0.0496; 1750 W connected; 0.9·1000+0.5·500+1·250 = 1400 W demand;
// 0.5 m3/s through 0.25 m2 = 2 m/s; beam depth 600 >= 550; GFA 418.3 m2; 2 bathrooms; cost and utilisation unsupported; environmental unbound.
assert.deepEqual(st('a01-door-width-min'), Array(8).fill('MEETS_RULE'));
assert.deepEqual([st('a02-stair-width-min'), st('a03-riser-max'), st('a04-tread-min'), st('a05-headroom-min'), st('a07-garage-area-min')],
  [['DOES_NOT_MEET_RULE'], ['DOES_NOT_MEET_RULE'], ['MEETS_RULE'], ['INPUT_INCOMPLETE'], ['NOT_APPLICABLE']]);
assert.deepEqual(st('a08-window-sill-min'), Array(5).fill('CONFLICTING_RULES')); assert.equal(e.conflicts.length, 1);
assert.equal(one('b03-wfr-exact-min').trace.comparison, '32/645 >= 0.0496');
assert.equal(one('b07-connected-max').trace.comparison, '1750 <= 1750'); assert.equal(one('b07-connected-max').status, 'MEETS_RULE');
assert.equal(one('b06-demand-max').trace.comparison, '1400 <= 5000'); assert.equal(one('b06-demand-max').status, 'MEETS_RULE');
assert.deepEqual(st('b05-duct-velocity-max'), ['MEETS_RULE']); assert.equal(one('b05-duct-velocity-max').trace.comparison, '2 <= 4.1666');
assert.equal(one('b10-beam-depth-min').status, 'MEETS_RULE'); assert.equal(one('b14-gfa-max').trace.comparison, '418300000 <= 418300000');
assert.deepEqual([st('b15-bathroom-count-min'), st('a12-lift-door-min'), st('b09-cost-cap'), st('b11-utilisation-max')], [['MEETS_RULE'], ['MEETS_RULE'], ['UNSUPPORTED'], ['UNSUPPORTED']]);
for (const id of ['b02-wfr-indicator-min', 'b04-transmission-max', 'b13-envelope-closed']) assert.deepEqual(st(id), ['NOT_EVALUATED']);
assert.equal(e.results.find(x => x.ruleId === 'a09-egress-distance-max' && x.subject.id === 'space-bedroom-1').trace.comparison, '43900 <= 40000');
assert.ok(Object.values(CLAIMS).every(c => c === 'NOT_CLAIMED') && Object.keys(CLAIMS).length === 13);
console.log(JSON.stringify({ compiledKnowledge: 'PASS', facts: facts.items.length, rules: e.summary.rulesSelected, results: e.summary.results, byStatus: e.summary.byStatus,
  conflicts: e.conflicts.length, validation: v.status, claims: 'all 13 NOT_CLAIMED', runtime: process.version }));
