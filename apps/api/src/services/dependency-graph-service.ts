import { costHash } from '@designflow/boq-cost';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import type { TakeoffDetailSchema } from '../contracts/takeoffs.js';
import type { ConstructionDetailSchema } from '../contracts/construction.js';
import type { CostDetailSchema } from '../contracts/costs.js';
import type { GraphCheck, GraphFamily } from '../contracts/dependency-graph.js';
import type { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { modelHash } from '../lib/generation-identity.js';
import type { Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { TakeoffRepository } from '../lib/takeoff-repository.js';
import { ConstructionRepository } from '../lib/construction-repository.js';
import { CostRepository } from '../lib/cost-repository.js';
import { StructuralRepository } from '../lib/structural-repository.js';
import { EnvironmentalRepository } from '../lib/environmental-repository.js';
import { SystemsRepository } from '../lib/systems-repository.js';
import { KnowledgeRepository } from '../lib/knowledge-repository.js';
import { OptimizationRepository } from '../lib/optimization-repository.js';
import { SceneRepository } from '../lib/scene-repository.js';
import { buildDependencyGraph, GRAPH_LIMITS, limitExceeded, type GraphLimits, type GraphRecord } from '../graph/dependency-graph.js';
import { takeoffFingerprint } from './takeoff-service.js';
import { constructionFingerprint } from './construction-service.js';
import { costInputFingerprint } from './cost-service.js';

export const DEPENDENCY_GRAPH_ROUTE = '/api/projects/:projectId/revisions/:revisionId/dependency-graph';

type Revision = z.infer<typeof ProjectRevisionDetailSchema>;
type Takeoff = z.infer<typeof TakeoffDetailSchema>;
type Construction = z.infer<typeof ConstructionDetailSchema>;
type Cost = z.infer<typeof CostDetailSchema>;
type Analysis = { id: string; projectRevisionId: string; acceptanceQaId: string; modelHash: string; createdAt: string;
  structuralAnalysisId?: string | null; environmentalAnalysisId?: string | null; systemsAnalysisId?: string | null };
type Context = { revision: Revision; hash: string };
type Check = GraphRecord['checks'][number];

const check = (name: GraphCheck, ok: boolean): Check => ({ check: name, result: ok ? 'VERIFIED' : 'FAILED' });
const ACCEPTED = ['PASS', 'PASS_WITH_WARNINGS'];
/** Revision and acceptance-QA records. The model hash is recomputed from the immutable stored model; a stored identity must agree with it. */
export function revisionRecords({ revision, hash }: Context): GraphRecord[] {
  const qa = revision.qaRuns.find(run => run.id === revision.qa.id);
  const accepted = !!qa && ACCEPTED.includes(qa.status) && qa.report.inputStatus === 'SCHEMA_VALID' && qa.report.summary.errors === 0 && ACCEPTED.includes(qa.report.status);
  return [
    { family: 'REVISION', id: revision.id, revisionId: revision.id, createdAt: revision.createdAt, dependsOn: [],
      checks: [check('REVISION_IDENTITY', !revision.identity || revision.identity.modelHash === hash)] },
    { family: 'ACCEPTANCE_QA', id: revision.qa.id, revisionId: revision.id, createdAt: revision.qa.createdAt,
      dependsOn: [{ family: 'REVISION', id: revision.id, kind: 'QA_OF' }], checks: [check('QA_ACCEPTANCE', accepted)] },
  ];
}
const bindings = ({ revision }: Context, a: { projectRevisionId: string; acceptanceQaId: string }) =>
  [check('REVISION_BINDING', a.projectRevisionId === revision.id), check('QA_BINDING', a.acceptanceQaId === revision.qa.id)];
const anchored = ({ revision }: Context) => [{ family: 'REVISION' as const, id: revision.id, kind: 'BOUND_TO_REVISION' as const },
  { family: 'ACCEPTANCE_QA' as const, id: revision.qa.id, kind: 'ACCEPTED_BY' as const }];

export function takeoffRecord(c: Context, t: Takeoff): GraphRecord {
  const fingerprint = takeoffFingerprint({ projectRevisionId: c.revision.id, model: c.revision.model, engineVersion: t.engineVersion,
    measurementPolicyVersion: t.measurementPolicyVersion, options: t.options });
  return { family: 'QUANTITY_TAKEOFF', id: t.id, revisionId: t.projectRevisionId, createdAt: t.createdAt, dependsOn: anchored(c),
    checks: [...bindings(c, t), check('INPUT_FINGERPRINT', fingerprint === t.inputFingerprint)] };
}
export function constructionRecord(c: Context, k: Construction, takeoffs: ReadonlyMap<string, Takeoff>): GraphRecord {
  const takeoff = takeoffs.get(k.takeoffId), checks = bindings(c, k);
  if (takeoff) checks.push(check('INPUT_FINGERPRINT', constructionFingerprint(c.revision.id, takeoff, k.report) === k.inputFingerprint));
  return { family: 'CONSTRUCTION_CALCULATION', id: k.id, revisionId: k.projectRevisionId, createdAt: k.createdAt, checks,
    dependsOn: [...anchored(c), { family: 'QUANTITY_TAKEOFF', id: k.takeoffId, kind: 'DERIVED_FROM' }] };
}
export function costRecord(c: Context, e: Cost, constructions: ReadonlyMap<string, Construction>): GraphRecord {
  const source = constructions.get(e.constructionCalculationId), checks = bindings(c, e);
  if (source) {
    checks.push(check('LINK_CONSISTENCY', source.takeoffId === e.takeoffId),
      check('INPUT_FINGERPRINT', costInputFingerprint(c.revision.id, source, e.report) === e.inputFingerprint),
      check('REPORT_HASH', costHash(source.report) === e.constructionReportHash && costHash(e.report) === e.reportHash));
  }
  return { family: 'BOQ_COST', id: e.id, revisionId: e.projectRevisionId, createdAt: e.createdAt, checks,
    dependsOn: [...anchored(c), { family: 'CONSTRUCTION_CALCULATION', id: e.constructionCalculationId, kind: 'DERIVED_FROM' },
      { family: 'QUANTITY_TAKEOFF', id: e.takeoffId, kind: 'DERIVED_FROM' }] };
}
/** Analyses: bindings plus the stored model hash against the recomputed one. Upstream analyses are DERIVED_FROM edges by stored id. */
export function analysisRecord(c: Context, family: GraphFamily, a: Analysis): GraphRecord {
  const upstream = ([['STRUCTURAL_ANALYSIS', a.structuralAnalysisId], ['ENVIRONMENTAL_ANALYSIS', a.environmentalAnalysisId],
    ['BUILDING_SYSTEMS_ANALYSIS', a.systemsAnalysisId]] as const).flatMap(([f, id]) => id ? [{ family: f, id, kind: 'DERIVED_FROM' as const }] : []);
  return { family, id: a.id, revisionId: a.projectRevisionId, createdAt: a.createdAt, dependsOn: [...anchored(c), ...upstream],
    checks: [...bindings(c, a), check('MODEL_HASH', a.modelHash === c.hash)] };
}

/** In-flight per-artifact reads per request: bounds the database load of one graph read (up to ~150 reads) to a small, fixed fan-out. */
export const READ_CONCURRENCY = 8;
/** Runs the reads in order with at most `width` in flight, checking the time budget before each one starts. Results keep input order. */
async function pooled<T>(reads: (() => Promise<T>)[], width: number, tick: () => void): Promise<T[]> {
  const results: T[] = new Array(reads.length);
  let next = 0;
  const lane = async () => { while (next < reads.length) { const i = next++; tick(); results[i] = await reads[i]!(); } };
  await Promise.all(Array.from({ length: Math.min(width, reads.length) }, lane));
  return results;
}

export type GraphOptions = { limits?: Partial<GraphLimits>; now?: () => number; readConcurrency?: number };
/** Read-only and owner-only: every read is an owner-scoped RPC, and the revision read (404 for anyone else) runs first. Nothing is written. */
export async function dependencyGraph(repository: Repository, projectId: string, revisionId: string, options: GraphOptions = {}) {
  const limits: GraphLimits = { ...GRAPH_LIMITS, ...options.limits }, now = options.now ?? Date.now, deadline = now() + limits.timeBudgetMs;
  const tick = () => { if (now() > deadline) limitExceeded('TIME'); };
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  tick();
  const page = { limit: limits.familyPage };
  const lists = await Promise.all([
    new TakeoffRepository(repository).list(projectId, revisionId, page), new CostRepository(repository).list(projectId, revisionId, page),
    new StructuralRepository(repository).list(projectId, revisionId, page), new EnvironmentalRepository(repository).list(projectId, revisionId, page),
    new SystemsRepository(repository).list(projectId, revisionId, page), new KnowledgeRepository(repository).list(projectId, revisionId, page),
    new OptimizationRepository(repository).list(projectId, revisionId, page), new SceneRepository(repository).list(projectId, revisionId, page)]);
  tick();
  if (lists.some(l => l.nextCursor !== null)) limitExceeded('FAMILY_PAGE');
  const [takeoffs, costs, ...analyses] = lists, [structural, environmental, systems, knowledge, optimization, scene] = analyses;
  // The reads are separate statements: a current-revision change between them would mix two states.
  const currents = new Set(analyses.map(l => l.projectCurrentRevisionId));
  if (currents.size !== 1) throw new ApiError(409, 'DEPENDENCY_GRAPH_READ_INCONSISTENT', 'The project changed while the graph was read; retry');
  const counted = () => 2 + lists.reduce((n, l) => n + l.items.length, 0);
  if (counted() > limits.maxNodes) limitExceeded('NODES');
  const width = options.readConcurrency ?? READ_CONCURRENCY;
  const constructionLists = await pooled(takeoffs!.items.map(t => () => new ConstructionRepository(repository).list(projectId, revisionId, t.id, page)), width, tick);
  tick();
  if (constructionLists.some(l => l.nextCursor !== null)) limitExceeded('FAMILY_PAGE');
  if (counted() + constructionLists.reduce((n, l) => n + l.items.length, 0) > limits.maxNodes) limitExceeded('NODES');
  const takeoffDetails = await pooled(takeoffs!.items.map(t => () => new TakeoffRepository(repository).read(projectId, revisionId, t.id)), width, tick);
  const constructionDetails = await pooled(constructionLists.flatMap(l => l.items)
    .map(k => () => new ConstructionRepository(repository).read(projectId, revisionId, k.takeoffId, k.id)), width, tick);
  const costDetails = await pooled(costs!.items.map(e => () => new CostRepository(repository).read(projectId, revisionId, e.id)), width, tick);
  tick();

  const c: Context = { revision, hash: modelHash(revision.model) };
  const takeoffById = new Map(takeoffDetails.map(t => [t.id, t])), constructionById = new Map(constructionDetails.map(k => [k.id, k]));
  const records: GraphRecord[] = [...revisionRecords(c), ...takeoffDetails.map(t => takeoffRecord(c, t)),
    ...constructionDetails.map(k => constructionRecord(c, k, takeoffById)), ...costDetails.map(e => costRecord(c, e, constructionById)),
    ...([['STRUCTURAL_ANALYSIS', structural], ['ENVIRONMENTAL_ANALYSIS', environmental], ['BUILDING_SYSTEMS_ANALYSIS', systems],
      ['SPECIALIZED_KNOWLEDGE', knowledge], ['DESIGN_OPTIMIZATION', optimization], ['SCENE_3D', scene]] as const)
      .flatMap(([family, list]) => (list!.items as Analysis[]).map(a => analysisRecord(c, family, a)))];
  const graph = buildDependencyGraph({ projectId, revisionId, modelHash: c.hash, projectCurrentRevisionId: [...currents][0] ?? null, records }, limits);
  tick();
  return graph;
}
