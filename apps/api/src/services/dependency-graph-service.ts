import { costHash } from '@designflow/boq-cost';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import type { TakeoffDetailSchema } from '../contracts/takeoffs.js';
import type { ConstructionDetailSchema } from '../contracts/construction.js';
import type { CostDetailSchema } from '../contracts/costs.js';
import type { GraphCheck } from '../contracts/dependency-graph.js';
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
import { knowledgeInputHash } from './knowledge-service.js';
import { StructuralDetailSchema } from '../structural/contracts.js';
import { EnvironmentalDetailSchema } from '../environmental/contracts.js';
import { SystemsDetailSchema } from '../systems/contracts.js';
import { KnowledgeDetailSchema } from '../knowledge/contracts.js';
import { OptimizationDetailSchema } from '../optimization/contracts.js';
import { SceneDetailSchema } from '../lib/scene-repository.js';
import { structuralInputHash } from '../structural/analysis.js';
import { environmentalInputHash } from '../environmental/analysis.js';
import { systemsInputHash } from '../systems/analysis.js';
import { sceneInputHash } from '../scene3d/compile.js';

export const DEPENDENCY_GRAPH_ROUTE = '/api/projects/:projectId/revisions/:revisionId/dependency-graph';

type Revision = z.infer<typeof ProjectRevisionDetailSchema>;
type Takeoff = z.infer<typeof TakeoffDetailSchema>;
type Construction = z.infer<typeof ConstructionDetailSchema>;
type Cost = z.infer<typeof CostDetailSchema>;
type AnalysisDetails = {
  STRUCTURAL_ANALYSIS: z.infer<typeof StructuralDetailSchema>; ENVIRONMENTAL_ANALYSIS: z.infer<typeof EnvironmentalDetailSchema>;
  BUILDING_SYSTEMS_ANALYSIS: z.infer<typeof SystemsDetailSchema>; SPECIALIZED_KNOWLEDGE: z.infer<typeof KnowledgeDetailSchema>;
  DESIGN_OPTIMIZATION: z.infer<typeof OptimizationDetailSchema>; SCENE_3D: z.infer<typeof SceneDetailSchema>;
};
export type AnalysisFamily = keyof AnalysisDetails;
type Run = { name: string; version: string; adapterVersion: string; settings: Record<string, string | number> };
/** The adapter identity exactly as it entered the hash: the stored run's metadata, without its timing. */
const ran = ({ name, version, adapterVersion, settings }: Run) => ({ metadata: { name, version, adapterVersion, settings } }) as never;
/**
 * Each family's inputHash, recomputed with the same function its write path used, from the stored snapshot or manifest. The pair is
 * (the hash the snapshot carries, the recomputed hash); both must equal the row's inputHash. A changed canonicalization constant (for
 * example the systems ROUTING_WEIGHTS) makes older rows fail closed rather than verify against a rule they were not hashed with.
 */
const INPUT_HASH: { [F in AnalysisFamily]: (d: AnalysisDetails[F]) => readonly [string, string] } = {
  STRUCTURAL_ANALYSIS: d => [d.snapshot.inputHash, structuralInputHash(d.snapshot.binding, d.snapshot.input, ran(d.snapshot.solver))],
  ENVIRONMENTAL_ANALYSIS: d => [d.snapshot.inputHash, environmentalInputHash(d.snapshot.binding, d.snapshot.input, ran(d.snapshot.calculator))],
  BUILDING_SYSTEMS_ANALYSIS: d => [d.snapshot.inputHash, systemsInputHash(d.snapshot.binding, d.snapshot.input, ran(d.snapshot.calculator))],
  SPECIALIZED_KNOWLEDGE: d => [d.snapshot.inputHash, knowledgeInputHash(d.snapshot.binding, d.snapshot.input)],
  DESIGN_OPTIMIZATION: d => [d.snapshot.inputHash, costHash(d.snapshot.input)],
  SCENE_3D: d => [d.manifest.inputHash, sceneInputHash(d.manifest.source)],
};
export function inputHashVerified<F extends AnalysisFamily>(family: F, d: AnalysisDetails[F]) {
  try { return (INPUT_HASH[family] as (d: AnalysisDetails[F]) => readonly string[])(d).every(h => h === d.inputHash); }
  catch { return false; } // an unreadable stored input cannot be verified
}
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
/** Analyses: bindings, the stored model hash against the recomputed one, and the recomputed inputHash. Upstream analyses are DERIVED_FROM edges by stored id. */
export function analysisRecord<F extends AnalysisFamily>(c: Context, family: F, d: AnalysisDetails[F]): GraphRecord {
  const a = d as { structuralAnalysisId?: string | null; environmentalAnalysisId?: string | null; systemsAnalysisId?: string | null };
  const upstream = ([['STRUCTURAL_ANALYSIS', a.structuralAnalysisId], ['ENVIRONMENTAL_ANALYSIS', a.environmentalAnalysisId],
    ['BUILDING_SYSTEMS_ANALYSIS', a.systemsAnalysisId]] as const).flatMap(([f, id]) => id ? [{ family: f, id, kind: 'DERIVED_FROM' as const }] : []);
  return { family, id: d.id, revisionId: d.projectRevisionId, createdAt: d.createdAt, dependsOn: [...anchored(c), ...upstream],
    checks: [...bindings(c, d), check('MODEL_HASH', d.modelHash === c.hash), check('INPUT_HASH', inputHashVerified(family, d))] };
}

export type GraphOptions = { limits?: Partial<GraphLimits>; now?: () => number };
const inconsistent = (): never => { throw new ApiError(409, 'DEPENDENCY_GRAPH_READ_INCONSISTENT', 'The project changed while the graph was read; retry'); };

/** One round of the bounded listings: every family's ids, each takeoff's construction ids and the project's current revision. */
async function listAll(repository: Repository, projectId: string, revisionId: string, limits: GraphLimits, tick: () => void) {
  const page = { limit: limits.familyPage };
  const [takeoffs, costs, ...analyses] = await Promise.all([
    new TakeoffRepository(repository).list(projectId, revisionId, page), new CostRepository(repository).list(projectId, revisionId, page),
    new StructuralRepository(repository).list(projectId, revisionId, page), new EnvironmentalRepository(repository).list(projectId, revisionId, page),
    new SystemsRepository(repository).list(projectId, revisionId, page), new KnowledgeRepository(repository).list(projectId, revisionId, page),
    new OptimizationRepository(repository).list(projectId, revisionId, page), new SceneRepository(repository).list(projectId, revisionId, page)]);
  tick();
  const lists = [takeoffs!, costs!, ...analyses];
  if (lists.some(l => l.nextCursor !== null)) limitExceeded('FAMILY_PAGE');
  const currents = new Set(analyses.map(l => l.projectCurrentRevisionId));
  if (currents.size !== 1) inconsistent();
  const listed = () => 2 + lists.reduce((n, l) => n + l.items.length, 0);
  if (listed() > limits.maxNodes) limitExceeded('NODES');
  const constructions = await Promise.all(takeoffs!.items.map(t => new ConstructionRepository(repository).list(projectId, revisionId, t.id, page)));
  tick();
  if (constructions.some(l => l.nextCursor !== null)) limitExceeded('FAMILY_PAGE');
  if (listed() + constructions.reduce((n, l) => n + l.items.length, 0) > limits.maxNodes) limitExceeded('NODES');
  const ids = { current: [...currents][0] ?? null, families: lists.map(l => l.items.map(i => i.id)), constructions: constructions.map(l => l.items.map(i => i.id)) };
  return { takeoffs: takeoffs!.items, costs: costs!.items, analyses, constructions: constructions.flatMap(l => l.items), ids };
}

/**
 * Read-only and owner-only: every read is an owner-scoped RPC, and the revision read (404 for anyone else) runs first. Nothing is written.
 * The reads are separate statements, not one snapshot. Artifact rows are immutable and only appended (deleted only with their project), and
 * the current-revision pointer only moves forward, so listing everything again after the detail reads and finding the same ids and the same
 * current revision shows that no artifact or revision change landed while the graph was read; any difference is a retryable 409.
 */
export async function dependencyGraph(repository: Repository, projectId: string, revisionId: string, options: GraphOptions = {}) {
  const limits: GraphLimits = { ...GRAPH_LIMITS, ...options.limits }, now = options.now ?? Date.now, deadline = now() + limits.timeBudgetMs;
  const tick = () => { if (now() > deadline) limitExceeded('TIME'); };
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  tick();
  const before = await listAll(repository, projectId, revisionId, limits, tick);
  const [structural, environmental, systems, knowledge, optimization, scene] = before.analyses;
  const details = <T>(items: { id: string }[], read: (id: string) => Promise<{ detail: T }>) => Promise.all(items.map(i => read(i.id).then(r => r.detail)));
  const [takeoffDetails, constructionDetails, costDetails, analysisDetails] = await Promise.all([
    Promise.all(before.takeoffs.map(t => new TakeoffRepository(repository).read(projectId, revisionId, t.id))),
    Promise.all(before.constructions.map(k => new ConstructionRepository(repository).read(projectId, revisionId, k.takeoffId, k.id))),
    Promise.all(before.costs.map(e => new CostRepository(repository).read(projectId, revisionId, e.id))),
    Promise.all([
      details(structural!.items, id => new StructuralRepository(repository).read(projectId, revisionId, id)),
      details(environmental!.items, id => new EnvironmentalRepository(repository).read(projectId, revisionId, id)),
      details(systems!.items, id => new SystemsRepository(repository).read(projectId, revisionId, id)),
      details(knowledge!.items, id => new KnowledgeRepository(repository).read(projectId, revisionId, id)),
      details(optimization!.items, id => new OptimizationRepository(repository).read(projectId, revisionId, id)),
      details(scene!.items, id => new SceneRepository(repository).read(projectId, revisionId, id))])]);
  tick();
  const after = await listAll(repository, projectId, revisionId, limits, tick);
  if (JSON.stringify(after.ids) !== JSON.stringify(before.ids)) inconsistent();

  const c: Context = { revision, hash: modelHash(revision.model) };
  const takeoffById = new Map(takeoffDetails.map(t => [t.id, t])), constructionById = new Map(constructionDetails.map(k => [k.id, k]));
  const [sd, ed, yd, kd, od, cd] = analysisDetails;
  const records: GraphRecord[] = [...revisionRecords(c), ...takeoffDetails.map(t => takeoffRecord(c, t)),
    ...constructionDetails.map(k => constructionRecord(c, k, takeoffById)), ...costDetails.map(e => costRecord(c, e, constructionById)),
    ...sd.map(d => analysisRecord(c, 'STRUCTURAL_ANALYSIS', d)), ...ed.map(d => analysisRecord(c, 'ENVIRONMENTAL_ANALYSIS', d)),
    ...yd.map(d => analysisRecord(c, 'BUILDING_SYSTEMS_ANALYSIS', d)), ...kd.map(d => analysisRecord(c, 'SPECIALIZED_KNOWLEDGE', d)),
    ...od.map(d => analysisRecord(c, 'DESIGN_OPTIMIZATION', d)), ...cd.map(d => analysisRecord(c, 'SCENE_3D', d))];
  const graph = buildDependencyGraph({ projectId, revisionId, modelHash: c.hash, projectCurrentRevisionId: before.ids.current, records }, limits);
  tick();
  return graph;
}
