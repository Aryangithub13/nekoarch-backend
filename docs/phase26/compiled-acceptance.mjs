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
import { validateSystemsModel, validateSystemsResults } from './apps/api/dist/systems/validate.js';

// Compiled production modules only: no test-support, network, database or AI. Every engineering value below is explicit acceptance input.
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
const systems = buildSystemsModel(bim, input);
assert.equal(validateSystemsModel(systems, bim.geometry, input, systems.binding, null).status, 'VALID');
const run = runSystemsAnalysis(resolveAnalysisInput(systems, input)), r = run.results;
const validation = validateSystemsResults({ binding: systems.binding, inputHash: systemsInputHash(systems.binding, input), input, model: systems, results: r }, { binding: systems.binding, environmental: null });
assert.equal(validation.status, 'VALID');
assert.ok(r.networks.every(n => n.status === 'ROUTED'));
// Known answers: 1000 + 500 + 250 = 1750 W connected; 0.9·1000 + 0.5·500 + 1·250 = 1400 W demand; 0.5 m³/s through 0.25 m² = 2 m/s.
assert.equal(r.electrical.total.connected.W.exact, '1750'); assert.equal(r.electrical.total.demand.W.exact, '1400');
const duct = r.networks.find(n => n.airflow); assert.deepEqual([...new Set(duct.airflow.segments.map(s => s.velocity.exact))], ['2']);
const drain = r.networks.find(n => n.drainage);
assert.ok(drain.drainage.arrivalElevation.value >= drain.drainage.outletElevation.value && drain.drainage.stacks.length >= 1);
assert.ok(drain.branches.every(b => b.points.every((p, i) => !i || p.y <= b.points[i - 1].y)));
assert.equal(r.lifeSafety.egressAvailable, true); assert.equal(r.verticalTransport.elevators[0].status, 'PROPOSED'); assert.equal(r.coordination.blocking, 0);
assert.ok(Object.values(systems.claims).every(v => v === 'NOT_CLAIMED'));
console.log(JSON.stringify({ compiledSystems: 'PASS', networks: r.networks.length, connectedW: r.electrical.total.connected.W.exact, demandW: r.electrical.total.demand.W.exact,
  ductVelocity: '2 m/s', drainArrivalMm: drain.drainage.arrivalElevation.exact, stacks: drain.drainage.stacks.length, longestEgressMm: r.lifeSafety.longest.distance.value,
  lift: r.verticalTransport.elevators[0].status, clashes: r.coordination.clashes.length, penetrations: r.coordination.penetrations.length, claims: systems.claims, runtime: process.version }));
