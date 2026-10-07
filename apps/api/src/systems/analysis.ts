import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { digest } from '../bim/core.js';
import type { EnvironmentalSnapshot } from '../environmental/contracts.js';
import { NOT_EVALUATED, ResultsSchema, ROUTING_WEIGHTS, SUBMODELS, SYSTEMS_ADAPTER_VERSION, SYSTEMS_ANALYSIS_VERSION, SYSTEMS_LIMITS, SYSTEMS_MODEL_VERSION, SystemsError,
  type NetworkResult, type SystemsBinding, type SystemsInput, type SystemsModel, type SystemsResults } from './contracts.js';
import { egressAnalysis } from './egress.js';
import { planElevators } from './vertical.js';
import { architectureSolids, cubicMetresPerSecond, routeNetworks, sizeLabel } from './routing.js';
import { coordinate } from './clash.js';
import { add, exact, fromNumber, mul, ZERO, type Rational } from './units.js';

/** Solver-neutral analysis input: the validated model plus the discipline data the calculator needs, resolved once and hashed. */
export function resolveAnalysisInput(model: SystemsModel, input: SystemsInput, environmental: { analysisId: string; snapshot: EnvironmentalSnapshot } | null = null) {
  if (model.networks.length > SYSTEMS_LIMITS.networks + SYSTEMS_LIMITS.circuits) throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', 'Too many networks');
  // Search preflight on the static grid (architecture, stairs, structure, terminals); runtime guards cover growth from earlier networks.
  const coordinates = 2 * (model.walls.length + model.stairs.length + model.structure.members.length) + Math.max(...model.levels.map(l => l.boundary.length)) + 2;
  const predicted = model.networks.filter(n => n.status === 'READY' && n.mode === 'PLANNED')
    .reduce((s, n) => s + n.terminalIds.length * (coordinates + 2 * n.terminalIds.length) ** 2 * n.levels.length * 6, 0);
  if (predicted > SYSTEMS_LIMITS.searchStates * 4) throw new SystemsError('BUILDING_SYSTEMS_RESOURCE_LIMIT', 'Routing would exceed the search budget');
  const e = input.electrical, h = input.hvac;
  const airTerminal = (key: string) => model.terminals.find(x => x.role === 'AIR_TERMINAL' && x.key === key)!.id;
  return { version: SYSTEMS_ANALYSIS_VERSION, model,
    plumbing: input.plumbing ? { fixtures: input.plumbing.fixtures.map(f => ({ key: f.key, connections: f.connections.map(c => `${f.key}.${c.service}`) })) } : null,
    electrical: e ? { loads: e.loads.map(l => ({ key: l.key, power: l.power, demandFactor: l.demandFactor?.value ?? null })), circuits: e.circuits.map(c => ({ key: c.key, panel: c.panel, loads: c.loads })),
      panels: e.panels.map(p => p.key), supplyMissing: !e.supply ? ['electrical supply']
        : (['systemVoltage', 'phaseSystem', 'frequencyHz'] as const).filter(k => e.supply![k] === null).map(k => `supply ${k}`) } : null,
    hvac: h ? { terminals: h.systems.flatMap(s => s.terminals.map(t => ({ terminalId: airTerminal(t.key), airflow: t.airflow }))), equipment: h.equipment.length } : null,
    verticalTransport: input.verticalTransport,
    environmental: environmental ? { analysisId: environmental.analysisId, inputHash: environmental.snapshot.inputHash,
      cases: environmental.snapshot.results.thermal.cases.map(c => ({ key: c.key, envelopeTransmission: c.total, status: c.status })) } : null,
    settings: { router: SUBMODELS.router, weights: ROUTING_WEIGHTS.version, bend: ROUTING_WEIGHTS.bend, wallCrossing: ROUTING_WEIGHTS.wallCrossing,
      levelTransition: ROUTING_WEIGHTS.levelTransition, egress: SUBMODELS.egress, clashGeometry: SUBMODELS.clashGeometry } };
}
export type AnalysisInput = ReturnType<typeof resolveAnalysisInput>;

/** Solver-neutral boundary: public contracts never depend on a calculator's internals. */
export interface SystemsCalculatorAdapter {
  metadata: { name: string; version: string; adapterVersion: typeof SYSTEMS_ADAPTER_VERSION; settings: Record<string, string | number> };
  analyze(input: AnalysisInput, context: { deadline: number; stats?: { searchStates: number } }): unknown;
}

type LoadSum = { W: Rational; VA: Rational; countW: number; countVA: number };
const loadSum = (s: LoadSum) => ({ W: exact(s.W, 'W'), VA: exact(s.VA, 'VA'),
  combined: s.countVA === 0 ? exact(s.W, 'W') : s.countW === 0 ? exact(s.VA, 'VA') : null,
  combinedStatus: s.countW && s.countVA ? 'NOT_EVALUATED_MIXED_W_AND_VA' as const : 'EVALUATED' as const });
/** Connected load is the exact sum of explicit loads; demand only when every load in the group carries an explicit factor (no silent diversity). */
export function loads(group: { power: { value: number; unit: 'W' | 'VA' }; demandFactor: number | null }[]) {
  const connected: LoadSum = { W: ZERO, VA: ZERO, countW: 0, countVA: 0 }, demand = { W: ZERO, VA: ZERO };
  for (const l of group) {
    const p = fromNumber(l.power.value);
    if (l.power.unit === 'W') { connected.W = add(connected.W, p); connected.countW++; } else { connected.VA = add(connected.VA, p); connected.countVA++; }
    if (l.demandFactor !== null) { const d = mul(p, fromNumber(l.demandFactor)); if (l.power.unit === 'W') demand.W = add(demand.W, d); else demand.VA = add(demand.VA, d); }
  }
  const missing = group.filter(l => l.demandFactor === null).length;
  return { connected: loadSum(connected), demand: missing
    ? { status: 'NOT_EVALUATED' as const, reason: `${missing} load(s) have no explicit demand factor`, W: null, VA: null }
    : { status: 'EVALUATED' as const, reason: null, W: exact(demand.W, 'W'), VA: exact(demand.VA, 'VA') } };
}
function disciplineStatus(requested: boolean, networks: NetworkResult[], keys: Map<string, string>) {
  if (!requested) return { status: 'NOT_EVALUATED' as const, reason: 'Not requested' };
  if (!networks.length) return { status: 'INPUT_INCOMPLETE' as const, reason: 'No network can be formed from the input' };
  const failing = networks.filter(n => n.status !== 'ROUTED');
  if (!failing.length) return { status: 'ANALYZED' as const, reason: null };
  const reason = failing.map(n => `${keys.get(n.networkId)}: ${n.failure?.code ?? n.status}`).join('; ').slice(0, 300);
  return { status: failing.length === networks.length && failing.every(n => n.status === 'INPUT_INCOMPLETE') ? 'INPUT_INCOMPLETE' as const : 'PARTIAL' as const, reason };
}

export function calculate(ai: AnalysisInput, context: { deadline: number; stats?: { searchStates: number } }) {
  const m = ai.model, budget = { states: SYSTEMS_LIMITS.searchStates, deadline: context.deadline };
  const egress = egressAnalysis(m), solids = architectureSolids(m);
  const vertical = planElevators(m, ai.verticalTransport, egress.reachable, solids.filter(s => s.kind === 'STRUCTURE'));
  const airflow = new Map((ai.hvac?.terminals ?? []).map(t => [t.terminalId, t.airflow ? cubicMetresPerSecond(t.airflow.value, t.airflow.unit) : null]));
  const routed = routeNetworks(m, airflow, vertical.shafts, budget);
  if (context.stats) context.stats.searchStates = SYSTEMS_LIMITS.searchStates - budget.states;
  const coordination = coordinate(m, routed.results, [...solids, ...vertical.shafts], vertical.clashes, routed.penetrations);
  const network = new Map(m.networks.map(n => [n.id, n])), keys = new Map(m.networks.map(n => [n.id, n.key]));
  const of = (d: string) => routed.results.filter(r => network.get(r.networkId)!.discipline === d);
  const connected = new Set(of('PLUMBING').filter(r => r.status === 'ROUTED').flatMap(r => network.get(r.networkId)!.terminalIds));
  const fixtureIds = new Map(m.terminals.filter(t => t.role === 'FIXTURE').map(t => [t.key, t.id]));
  const e = ai.electrical, loadByKey = new Map((e?.loads ?? []).map(l => [l.key, l]));
  const circuits = (e?.circuits ?? []).map(c => ({ key: c.key, panel: c.panel, loads: c.loads.length, ...loads(c.loads.map(k => loadByKey.get(k)!)) })).sort((a, b) => a.key < b.key ? -1 : 1);
  const panels = (e?.panels ?? []).map(p => {
    const cs = (e?.circuits ?? []).filter(c => c.panel === p);
    return { key: p, circuits: cs.length, ...loads(cs.flatMap(c => c.loads.map(k => loadByKey.get(k)!))) };
  }).sort((a, b) => a.key < b.key ? -1 : 1);
  const supplyMissing = e?.supplyMissing ?? [];
  const results: SystemsResults = {
    networks: routed.results,
    plumbing: { ...disciplineStatus(m.requested.plumbing, of('PLUMBING'), keys), version: SUBMODELS.plumbing, fixtures: ai.plumbing?.fixtures.length ?? 0,
      fixturesConnected: (ai.plumbing?.fixtures ?? []).filter(f => f.connections.every(c => connected.has(fixtureIds.get(c)!))).length, notEvaluated: [...NOT_EVALUATED.plumbing] },
    electrical: { ...(e && supplyMissing.length ? { status: 'INPUT_INCOMPLETE' as const, reason: `Missing: ${supplyMissing.join(', ')}; voltage, phase and frequency are never assumed` }
      : disciplineStatus(m.requested.electrical, of('ELECTRICAL'), keys)),
      version: SUBMODELS.electrical, supply: { status: !e ? 'NOT_EVALUATED' : supplyMissing.length ? 'INPUT_INCOMPLETE' : 'SPECIFIED', missing: supplyMissing },
      circuits, panels, total: e ? loads(e.loads) : null, notEvaluated: [...NOT_EVALUATED.electrical] },
    hvac: { ...disciplineStatus(m.requested.hvac, of('HVAC'), keys), version: SUBMODELS.hvac,
      referenceInputs: { environmental: ai.environmental ? { analysisId: ai.environmental.analysisId, inputHash: ai.environmental.inputHash, role: 'ENVELOPE_TRANSMISSION_COMPONENT',
        isDesignLoad: false, cases: ai.environmental.cases } : null }, notEvaluated: [...NOT_EVALUATED.hvac] },
    lifeSafety: egress.result, verticalTransport: vertical.result, coordination,
    quantities: { networks: routed.results.filter(r => r.status === 'ROUTED').map(r => { const n = network.get(r.networkId)!;
      return { networkId: r.networkId, system: n.system, size: sizeLabel(n.size), length: r.length }; }),
      fixtures: ai.plumbing?.fixtures.length ?? 0, panels: e?.panels.length ?? 0, loads: e?.loads.length ?? 0, hvacTerminals: ai.hvac?.terminals.length ?? 0,
      hvacEquipment: ai.hvac?.equipment ?? 0, elevatorProposals: vertical.result.elevators.filter(x => x.status === 'PROPOSED').length, costing: 'NOT_EVALUATED' },
  };
  return { calculator: { name: REFERENCE_CALCULATOR.metadata.name, version: REFERENCE_CALCULATOR.metadata.version }, analysisInputHash: digest(ai), results };
}

export const REFERENCE_CALCULATOR: SystemsCalculatorAdapter = {
  metadata: { name: 'nekoarch-reference-systems', version: '1.0.0', adapterVersion: SYSTEMS_ADAPTER_VERSION,
    settings: { router: SUBMODELS.router, weights: ROUTING_WEIGHTS.version, egress: SUBMODELS.egress, clashGeometry: SUBMODELS.clashGeometry } },
  analyze: calculate,
};

const RawSchema = z.object({ calculator: z.object({ name: z.string().max(100), version: z.string().max(100) }).strict(), analysisInputHash: z.string().regex(/^[a-f0-9]{64}$/),
  results: ResultsSchema }).strict();
/** Calculator output is untrusted: schema (finiteness, units), identity, input hash and inventories, before the independent validator recomputes values. */
export function validateRawOutput(raw: unknown, ai: AnalysisInput, adapter: SystemsCalculatorAdapter) {
  const invalid = (message: string): never => { throw new SystemsError('SYSTEM_RESULT_INVALID', message); };
  const parsed = RawSchema.safeParse(raw);
  if (!parsed.success) return invalid('Calculator output is malformed, nonfinite or uses unexpected units');
  const out = parsed.data, r = out.results, m = ai.model, network = new Map(m.networks.map(n => [n.id, n]));
  if (out.calculator.name !== adapter.metadata.name || out.calculator.version !== adapter.metadata.version) invalid('Calculator identity mismatch');
  if (out.analysisInputHash !== digest(ai)) invalid('Calculator output belongs to a different analysis input');
  if (r.networks.map(n => n.networkId).join() !== m.networks.map(n => n.id).join()) invalid('Network inventory differs from the analysis input');
  if (r.lifeSafety.status === 'ANALYZED' && r.lifeSafety.spaces.map(s => s.spaceId).join() !== m.spaces.map(s => s.spaceId).join()) invalid('Egress space inventory differs from the analysis input');
  if (r.verticalTransport.elevators.map(e => e.key).join() !== (ai.verticalTransport?.elevators ?? []).map(e => e.key).sort().join()) invalid('Elevator inventory differs from the analysis input');
  if (r.electrical.circuits.map(c => c.key).join() !== (ai.electrical?.circuits ?? []).map(c => c.key).sort().join()) invalid('Circuit inventory differs from the analysis input');
  for (const n of r.networks) for (const b of n.branches) if (!network.get(n.networkId)!.terminalIds.includes(b.terminalId)) invalid('A route serves a terminal outside its network');
  return r;
}

export function systemsInputHash(binding: SystemsBinding, input: SystemsInput, adapter: SystemsCalculatorAdapter = REFERENCE_CALCULATOR) {
  return digest({ systemsModelVersion: SYSTEMS_MODEL_VERSION, analysisVersion: SYSTEMS_ANALYSIS_VERSION, binding, input, calculator: adapter.metadata, weights: ROUTING_WEIGHTS });
}

/** Analysis input → adapter → untrusted-output validation. */
export function runSystemsAnalysis(ai: AnalysisInput, adapter: SystemsCalculatorAdapter = REFERENCE_CALCULATOR, budgetMs: number = SYSTEMS_LIMITS.calculationMs, stats?: { searchStates: number }) {
  const started = performance.now();
  let raw: unknown;
  try { raw = adapter.analyze(ai, { deadline: started + budgetMs, ...(stats ? { stats } : {}) }); }
  catch (error) { if (error instanceof SystemsError) throw error; throw new SystemsError('SYSTEM_ANALYSIS_FAILED', 'The building-systems calculator failed'); }
  const executionMs = performance.now() - started, results = validateRawOutput(raw, ai, adapter);
  const { name, version, adapterVersion, settings } = adapter.metadata;
  return { analysisInputHash: digest(ai), results, calculator: { name, version, adapterVersion, settings, executionMs } };
}
