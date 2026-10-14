import { costHash } from '@designflow/boq-cost';
import { ApiError } from '../lib/errors.js';
import { CHECK_FAILURES, CHECKS, DEPENDENCY_GRAPH_VERSION, DependencyGraphSchema, GRAPH_FAMILIES, NODE_STATES, SOURCE_EQUIVALENT_FAMILIES,
  type DependencyGraph, type GraphCause, type GraphCheck, type GraphFamily, type NodeState } from '../contracts/dependency-graph.js';

export type GraphLimits = { maxNodes: number; maxDepth: number; familyPage: number; timeBudgetMs: number };
export const GRAPH_LIMITS: Readonly<GraphLimits> = Object.freeze({ maxNodes: 128, maxDepth: 8, familyPage: 20, timeBudgetMs: 5000 });
export type GraphEdgeKind = 'QA_OF' | 'BOUND_TO_REVISION' | 'ACCEPTED_BY' | 'DERIVED_FROM';
/** One stored record with its own verified checks and the dependencies its stored columns name. */
export type GraphRecord = { family: GraphFamily; id: string; revisionId: string; createdAt: string;
  checks: { check: GraphCheck; result: 'VERIFIED' | 'FAILED' }[]; dependsOn: { family: GraphFamily; id: string; kind: GraphEdgeKind }[] };
/** `currentRevisionModelHash` is the current revision's canonical model hash when the caller read it (U2); omitted or null keeps every superseded node stale. */
export type GraphInput = { projectId: string; revisionId: string; modelHash: string; projectCurrentRevisionId: string | null; currentRevisionModelHash?: string | null;
  records: GraphRecord[] };

export const NOT_REPRESENTED = Object.freeze([
  ...['BIM', 'ENGINEERING_ASSESSMENT', 'ZONE_ASSESSMENT', 'ZONE_PARTITIONS', 'PROJECT_CONTEXT'].map(item => ({ item, reason: 'DERIVED_ON_READ' as const })),
  ...['APPEARANCE_VARIANT', 'REFERENCE_LIBRARY', 'DURABLE_JOBS', 'WORKFLOW_RUNS', 'COMPUTE_DISPATCHES', 'CONVERSATIONS'].map(item => ({ item, reason: 'NOT_A_MODEL_DERIVED_ARTIFACT' as const })),
]);
const CLAIMS = { engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' } as const;

export const nodeKey = (family: GraphFamily, id: string) => `${family}:${id}`;
export function limitExceeded(limit: 'NODES' | 'FAMILY_PAGE' | 'DEPTH' | 'TIME'): never {
  throw new ApiError(422, 'DEPENDENCY_GRAPH_LIMIT_EXCEEDED', 'The dependency graph exceeds a bounded limit; no partial graph is returned', { limit: [limit] });
}
const rank = (state: NodeState) => NODE_STATES.indexOf(state); // CURRENT < STALE_SOURCE_CHANGED < STALE_UPSTREAM_STALE < UNVERIFIED

/**
 * Pure and deterministic: the same records in any order give the same graph and hash. Refusals are checked in a fixed order
 * (nodes, cycle, depth); a refused graph is never returned in part.
 */
export function buildDependencyGraph(input: GraphInput, limits: GraphLimits = GRAPH_LIMITS): DependencyGraph {
  const order = (r: GraphRecord) => [GRAPH_FAMILIES.indexOf(r.family), Date.parse(r.createdAt), r.id] as const;
  const records = [...input.records].sort((a, b) => {
    const x = order(a), y = order(b);
    return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
  });
  if (records.length > limits.maxNodes) limitExceeded('NODES');
  const byKey = new Map<string, GraphRecord>(), position = new Map<string, number>();
  for (const r of records) {
    const key = nodeKey(r.family, r.id);
    if (byKey.has(key)) throw new ApiError(409, 'DEPENDENCY_GRAPH_READ_INCONSISTENT', 'The stored records changed while the graph was read; retry');
    byKey.set(key, r); position.set(key, byKey.size - 1);
  }

  // Edges only from stored links; a named dependency without a node is a failed UPSTREAM_PRESENT check, not an edge.
  const edges: DependencyGraph['edges'] = [], deps = new Map<string, { key: string; kind: GraphEdgeKind }[]>(), missing = new Map<string, string[]>();
  for (const [key, r] of byKey) {
    const resolved: { key: string; kind: GraphEdgeKind }[] = [], absent: string[] = [];
    for (const d of r.dependsOn) {
      const target = nodeKey(d.family, d.id);
      if (byKey.has(target)) resolved.push({ key: target, kind: d.kind }); else absent.push(target);
    }
    resolved.sort((a, b) => position.get(a.key)! - position.get(b.key)! || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    deps.set(key, resolved); missing.set(key, [...new Set(absent)].sort());
    for (const d of resolved) edges.push({ from: key, to: d.key, kind: d.kind });
  }

  // A record that names DERIVED_FROM inputs, or any dependency without a node, carries an UPSTREAM_PRESENT check; the first failed check in CHECKS order is the cause.
  const checks = new Map([...byKey].map(([key, r]) => [key, r.dependsOn.some(d => d.kind === 'DERIVED_FROM') || missing.get(key)!.length
    ? [...r.checks.filter(c => c.check !== 'UPSTREAM_PRESENT'), { check: 'UPSTREAM_PRESENT' as const, result: missing.get(key)!.length ? 'FAILED' as const : 'VERIFIED' as const }]
    : r.checks]));

  // Cycle detection and longest dependency chain, iteratively (no recursion on stored data).
  const color = new Map<string, 1 | 2>(), depth = new Map<string, number>(), topo: string[] = [];
  for (const start of byKey.keys()) {
    if (color.has(start)) continue;
    const stack: { key: string; next: number }[] = [{ key: start, next: 0 }];
    color.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!, list = deps.get(top.key)!;
      if (top.next < list.length) {
        const child = list[top.next++]!.key, c = color.get(child);
        if (c === 1) throw new ApiError(422, 'DEPENDENCY_GRAPH_CYCLE', 'The stored links form a cycle; no graph is returned');
        if (c === undefined) { color.set(child, 1); stack.push({ key: child, next: 0 }); }
      } else {
        stack.pop(); color.set(top.key, 2); topo.push(top.key);
        depth.set(top.key, list.reduce((m, d) => Math.max(m, depth.get(d.key)! + 1), 0));
      }
    }
  }
  if (Math.max(0, ...depth.values()) > limits.maxDepth) limitExceeded('DEPTH');

  // States in dependency order: own checks, then unverified dependencies, then stale DERIVED_FROM inputs, then revision currency.
  const revisionKey = nodeKey('REVISION', input.revisionId), state = new Map<string, { state: NodeState; causes: GraphCause[] }>();
  const currentModelHash = input.currentRevisionModelHash ?? null, sourceEquivalent = currentModelHash !== null && currentModelHash === input.modelHash;
  for (const key of topo) {
    const list = deps.get(key)!, failed = CHECKS.map(check => checks.get(key)!.find(c => c.check === check)).find(c => c?.result === 'FAILED');
    let result: { state: NodeState; causes: GraphCause[] };
    const upstream = (code: GraphCause['code'], dep: string) => ({ code, nodeId: dep });
    if (failed) result = { state: 'UNVERIFIED', causes: [{ code: CHECK_FAILURES[failed.check], nodeId: failed.check === 'UPSTREAM_PRESENT' ? missing.get(key)![0]! : key }] };
    else {
      const unverified = list.find(d => state.get(d.key)!.state === 'UNVERIFIED');
      const stale = list.find(d => d.kind === 'DERIVED_FROM' && state.get(d.key)!.state.startsWith('STALE_'));
      if (unverified) result = { state: 'UNVERIFIED', causes: [upstream('UPSTREAM_UNVERIFIED', unverified.key), ...state.get(unverified.key)!.causes] };
      else if (stale) result = { state: 'STALE_UPSTREAM_STALE', causes: [upstream('UPSTREAM_STALE', stale.key), ...state.get(stale.key)!.causes] };
      else if (input.projectCurrentRevisionId === null) result = { state: 'UNVERIFIED', causes: [{ code: 'NO_CURRENT_REVISION', nodeId: revisionKey }] };
      else if (byKey.get(key)!.revisionId !== input.projectCurrentRevisionId)
        // U2 (whole model): a superseding revision with the identical canonical model leaves model-only outputs current, and says why.
        result = sourceEquivalent && (SOURCE_EQUIVALENT_FAMILIES as readonly GraphFamily[]).includes(byKey.get(key)!.family)
          ? { state: 'CURRENT', causes: [{ code: 'SOURCE_MODEL_EQUIVALENT', nodeId: revisionKey }] }
          : { state: 'STALE_SOURCE_CHANGED', causes: [{ code: 'SOURCE_REVISION_SUPERSEDED', nodeId: revisionKey }] };
      else result = { state: 'CURRENT', causes: [] };
    }
    state.set(key, result);
  }

  const nodes = [...byKey].map(([key, r]) => ({ nodeId: key, family: r.family, artifactId: r.id, revisionId: r.revisionId, createdAt: r.createdAt,
    state: state.get(key)!.state, checks: CHECKS.flatMap(check => checks.get(key)!.filter(c => c.check === check).slice(0, 1).map(c => ({ check, result: c.result }))),
    causes: state.get(key)!.causes }));
  const families = GRAPH_FAMILIES.map(family => {
    const members = nodes.filter(n => n.family === family);
    return { family, nodeIds: members.map(n => n.nodeId),
      state: members.length ? members.reduce<NodeState>((worst, n) => rank(n.state) > rank(worst) ? n.state : worst, 'CURRENT') : 'NOT_GENERATED' as const };
  });
  const body = { graphVersion: DEPENDENCY_GRAPH_VERSION, complete: true as const,
    inputIdentity: { projectId: input.projectId, revisionId: input.revisionId, modelHash: input.modelHash, projectCurrentRevisionId: input.projectCurrentRevisionId,
      currentRevisionModelHash: currentModelHash },
    families, nodes, edges, limits: { ...limits }, notRepresented: NOT_REPRESENTED.map(n => ({ ...n })), claims: { ...CLAIMS } };
  return DependencyGraphSchema.parse({ ...body, graphHash: costHash(body) });
}
