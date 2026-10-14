import type { FastifyBaseLogger } from 'fastify';
import { costHash, sampleRateBook } from '@designflow/boq-cost';
import { GenerateRevisionRequestSchema, ProjectDetailSchema, ProjectRevisionDetailSchema, RevisionCommitResponseSchema } from '../contracts/projects.js';
import { TakeoffDetailSchema } from '../contracts/takeoffs.js';
import { ConstructionDetailSchema } from '../contracts/construction.js';
import { CostDetailSchema } from '../contracts/costs.js';
import { BlueprintConfigSchema, BudgetConfigSchema, MaterialsConfigSchema, MAX_REQUESTED_ROOMS, MODULE_SCOPES, S1_MODULES, SPECIALIST_VERSION, SpecialistResultSchema,
  STATUS_PRECEDENCE, type ComponentScope, type SpecialistModule, type SpecialistRequest, type SpecialistResult, type SpecialistStatus } from '../contracts/specialists.js';
import type { ManifestModule, ProjectManifest } from '../contracts/project-manifest.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { internalCommand } from '../lib/idempotency.js';
import type { IdempotencyContext, Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { TakeoffRepository } from '../lib/takeoff-repository.js';
import { ConstructionRepository } from '../lib/construction-repository.js';
import { modelHash } from '../lib/generation-identity.js';
import { saveProjectRevision } from './project-service.js';
import { createTakeoff, TAKEOFF_OPERATION } from './takeoff-service.js';
import { createConstruction, CONSTRUCTION_OPERATION } from './construction-service.js';
import { COST_OPERATION, createCost } from './cost-service.js';
import { verifyRevision } from './verification-service.js';
import { MODEL_LIMITS } from '../engineering/capability-limits.js';
import { projectManifest } from './project-manifest-service.js';

const GENERATE_ROUTE = '/api/projects/:projectId/revisions/generate';
const SAMPLE_RATE_BOOKS = ['sample-inr-v1', 'sample-inr-v2'] as const;
const MAX_FLOORS = MODEL_LIMITS.find(l => l.limitId === 'GENERATION_MAX_FLOORS')!.value;
/** Generator refusals that mean "outside what the engine supports", as opposed to "this program does not fit". */
const GENERATOR_UNSUPPORTED = ['UNSUPPORTED_SITE_GEOMETRY', 'UNSUPPORTED_PARAMETRIC_CAPABILITY', 'UNSUPPORTED_GEOMETRY', 'SITE_TOO_COMPLEX'];
type Reason = SpecialistResult['reasons'][number];
type Deps = { secret?: string | undefined; log?: FastifyBaseLogger | undefined; idempotencyKey?: string | undefined };

/** Most restrictive status among those that apply (STATUS_PRECEDENCE); COMPLETED when none does. */
export function overallStatus(statuses: SpecialistStatus[]): SpecialistStatus {
  return STATUS_PRECEDENCE.find(s => statuses.includes(s)) ?? 'COMPLETED';
}

/**
 * Status contribution of the independent B34 verification of a committed Blueprint revision (scope §4 row 1). The revision is already committed and
 * current when this runs, so a failure says so and names the restore that returns to the base (owner decision 2026-10-14: FAILED, not REQUIRES_REVIEW).
 */
export function verificationOutcome(status: 'VERIFIED' | 'VERIFIED_WITH_WARNINGS' | 'PARTIAL' | 'FAILED' | null, ids: { projectId: string; baseRevisionId: string;
  revisionId: string }): { status: SpecialistStatus; reason: Reason } | null {
  if (status === null) return { status: 'REQUIRES_REVIEW', reason: { code: 'VERIFICATION_UNAVAILABLE', message: 'Independent verification could not be run on the stored revision' } };
  if (status === 'PARTIAL') return { status: 'PARTIAL', reason: { code: 'VERIFICATION_PARTIAL', message: 'Independent verification could not evaluate every check' } };
  if (status === 'FAILED') return { status: 'FAILED', reason: { code: 'VERIFICATION_FAILED', message: `Independent verification failed on revision ${ids.revisionId}. `
    + `The revision passed acceptance QA and was committed as the project's current revision. To return to the base, restore revision ${ids.baseRevisionId} `
    + `with a RESTORE operation (POST /api/projects/${ids.projectId}/revision-operations)` } };
  return null;
}

/**
 * B39 S1: one specialist request through the shared envelope. Read-only checks and typed refusals come first and write nothing. A supported request
 * then runs the existing engine service unchanged, under the existing route's durable receipt when the caller sent an Idempotency-Key, so a retry
 * replays rather than repeats. Freshness is read back from the B37 manifest of the resulting revision, never computed here.
 */
export async function runSpecialist(repository: Repository, userId: string, projectId: string, module: SpecialistModule, request: SpecialistRequest,
  deps: Deps): Promise<SpecialistResult> {
  const projects = new ProjectRepository(repository);
  // Ownership and identity first: another user's project or a foreign revision is a 404, exactly as on the engine routes.
  const base = ProjectRevisionDetailSchema.parse(await projects.read('revision', projectId, request.baseRevisionId));
  const current = ProjectDetailSchema.parse(await projects.read('get', projectId)).currentRevision?.id ?? null;
  const manifestHref = (revisionId: string) => `/api/projects/${projectId}/revisions/${revisionId}/manifest`;
  const shell = (status: SpecialistStatus, reasons: Reason[]): SpecialistResult => SpecialistResultSchema.parse({
    envelopeVersion: SPECIALIST_VERSION, module, operation: request.operation, projectId, baseRevisionId: base.id, resultRevisionId: null, status, reasons,
    targetScopes: request.targetScopes, preserveScopes: request.preserveScopes, written: false, replayed: false, operationId: null, jobIds: [], artifacts: [],
    details: { kind: 'NONE' }, changeImpact: null, quote: { execution: 'NONE', externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE' },
    provenance: { engine: null, engineVersion: null, providerId: null, inputHash: null }, manifestHref: manifestHref(base.id), claims: CLAIMS });
  const refuse = (status: SpecialistStatus, code: string, message: string) => shell(status, [{ code, message }]);

  // Typed refusals (scenario 46): a module or an action this slice does not implement is a result, not an error.
  if (!(S1_MODULES as readonly string[]).includes(module))
    return refuse('UNSUPPORTED', 'MODULE_NOT_AVAILABLE', `The ${module} specialist is not implemented yet (B39 scope §4, slices S2 and S3); nothing was run`);
  const rules = MODULE_SCOPES[module as typeof S1_MODULES[number]];
  if (!(rules.operations as readonly string[]).includes(request.operation))
    return refuse('UNSUPPORTED', 'OPERATION_NOT_SUPPORTED', `${module} supports ${rules.operations.join(', ')}; '${request.operation}' is not available`);
  const outside = request.targetScopes.filter(s => !(rules.targets as readonly ComponentScope[]).includes(s));
  if (outside.length) return refuse('UNSUPPORTED', 'SCOPE_NOT_SUPPORTED', `${module} cannot target ${outside.join(', ')}`);
  // A preservation lock on anything this module rewrites cannot be honoured, so nothing runs (Phase 30 BLOCKED_BY_LOCK semantics).
  const locked = request.preserveScopes.filter(s => (rules.rewrites as readonly ComponentScope[]).includes(s) || request.targetScopes.includes(s));
  if (locked.length) return refuse('BLOCKED_BY_LOCK', 'PRESERVATION_CONFLICT', `${module} rewrites ${locked.join(', ')}, which the request asks to preserve`);
  // The engines run on the accepted current revision only (Phase 30 rule: a change starts from the current base). Checked inside the first stored step,
  // so that a retry of a request that already succeeded (and so moved or used the base) replays its stored result instead of being refused.
  const requireCurrent = () => {
    if (current !== base.id) throw new Refusal(refuse('STALE_DEPENDENCY', current === null ? 'NO_CURRENT_REVISION' : 'BASE_REVISION_SUPERSEDED',
      current === null ? 'The project has no current revision' : `Revision ${base.revisionNumber} is not the project's current revision; start from the current one`));
  };

  // A retried request replays each stored step instead of repeating it, keyed by the caller's Idempotency-Key, the module and the step. The receipt's
  // fingerprint covers the whole envelope as well as the step's own input, so reusing a key for a different request is a 409 IDEMPOTENCY_CONFLICT, as on
  // every durable route, never a silent replay of the earlier request.
  const step = async <T>(operation: string, name: string, input: unknown, run: (context?: IdempotencyContext) => Promise<T>) =>
    deps.idempotencyKey ? internalCommand(repository, operation, `specialist:${module}:${deps.idempotencyKey}:${name}`, { envelope: { module, request }, step: input }, run)
      : { result: await run(), replayed: false };
  // An engine's own refusal (422) is a typed result with nothing stored; ownership (404), concurrency (409) and outages (503) stay errors.
  const engine = async <T>(run: () => Promise<T>): Promise<T | SpecialistResult> => {
    try { return await run(); }
    catch (error) {
      if (error instanceof Refusal) return error.result;
      if (error instanceof ApiError && error.statusCode === 422)
        return refuse(GENERATOR_UNSUPPORTED.includes(error.code) ? 'UNSUPPORTED' : 'FAILED', error.code, error.message.slice(0, 500));
      throw error;
    }
  };
  const isResult = (v: unknown): v is SpecialistResult => !!v && typeof v === 'object' && 'envelopeVersion' in v;
  const freshness = (m: ProjectManifest, module: ManifestModule, artifactId: string) =>
    m.modules.find(x => x.module === module)?.artifacts?.find(a => a.artifactId === artifactId)?.freshness.state ?? null;
  // After a write, the B37 manifest is read back for freshness. If it cannot be read (for example a 409 while another revision commits), the stored
  // result is still returned, with freshness unverified, rather than an error that would invite an unkeyed retry to run the engine again.
  const readBack = async (revisionId: string): Promise<ProjectManifest | null> => {
    try { return await projectManifest(repository, projectId, revisionId); }
    catch (error) { deps.log?.warn({ projectId, revisionId, err: error }, 'specialist manifest read-back failed'); return null; }
  };
  // Output freshness comes from the manifest only. An output that is not current (a newer revision exists, or it is blocked) or whose freshness could not
  // be read is never reported as a plain success.
  const done = (statuses: SpecialistStatus[], reasons: Reason[], fields: Partial<SpecialistResult>, manifest: ProjectManifest | null): SpecialistResult => {
    const artifacts = fields.artifacts ?? [];
    if (!manifest) { statuses.push('REQUIRES_REVIEW'); reasons.push({ code: 'MANIFEST_UNAVAILABLE',
      message: 'The project manifest could not be read after the write; the outputs are stored but their freshness is unverified. Read the manifest again' }); }
    else if (artifacts.some(a => a.freshness === null)) { statuses.push('REQUIRES_REVIEW'); reasons.push({ code: 'FRESHNESS_UNVERIFIED',
      message: 'An output is not listed in the project manifest, so its freshness is unverified' }); }
    const behind = artifacts.filter(a => a.freshness !== null && a.freshness !== 'current');
    if (behind.length) { statuses.push('STALE_DEPENDENCY'); reasons.push({ code: 'OUTPUT_NOT_CURRENT',
      message: `${behind.map(a => `${a.logicalComponentId} ${a.artifactId} is ${a.freshness}`).join('; ')} in the project manifest` }); }
    return SpecialistResultSchema.parse({ ...shell(overallStatus(statuses), reasons), written: true,
      quote: { execution: 'LOCAL_DETERMINISTIC', externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE' }, ...fields });
  };
  const fresh = (m: ProjectManifest | null, module: ManifestModule, artifactId: string) => m ? freshness(m, module, artifactId) : null;

  if (module === 'BLUEPRINT') {
    // Floors beyond the generators' limit are unsupported, not invalid (scope §4): checked before the requirements schema refuses them. The limit is the
    // API's own mirror of BLUEPRINT_LIMITS.maxFloors, pinned to it by a test.
    const raw = request.outputConfig['requirements'] as { floors?: unknown; rooms?: unknown } | undefined;
    if (typeof raw?.floors === 'number' && raw.floors > MAX_FLOORS)
      return refuse('UNSUPPORTED', 'FLOOR_LIMIT_EXCEEDED', `Blueprint generation supports at most ${MAX_FLOORS} floors`);
    // Rooms are per-type counts in every requirements version; their total is limited like the floors (scope §4 row 1).
    const rooms = Array.isArray(raw?.rooms) ? raw.rooms.reduce((n: number, r: unknown) => n + (typeof (r as { count?: unknown })?.count === 'number' ? (r as { count: number }).count : 0), 0) : 0;
    if (rooms > MAX_REQUESTED_ROOMS)
      return refuse('UNSUPPORTED', 'ROOM_LIMIT_EXCEEDED', `Blueprint generation supports at most ${MAX_REQUESTED_ROOMS} requested rooms; ${rooms} were requested`);
    const config = parseRequest(BlueprintConfigSchema, request.outputConfig);
    const input = GenerateRevisionRequestSchema.parse({ requirements: config.requirements, baseRevisionId: base.id });
    const saved = await engine(() => step(GENERATE_ROUTE, 'revision', { projectId, ...input }, ctx => {
      requireCurrent();
      return saveProjectRevision(projects, userId, projectId, 'generated', input, deps.secret, ctx, deps.log);
    }));
    if (isResult(saved)) return saved;
    const revision = RevisionCommitResponseSchema.parse(saved.result).revision;
    // Independent checks on the stored revision: the B34 verifier and the B37 manifest (which also gives the change since the base). No render or scene job.
    const [verification, manifest] = await Promise.all([verifyRevision(repository, projectId, revision.id, null).catch(() => null), readBack(revision.id)]);
    const hash = modelHash(revision.model), statuses: SpecialistStatus[] = [], reasons: Reason[] = [];
    const outcome = verificationOutcome(verification?.status ?? null, { projectId, baseRevisionId: base.id, revisionId: revision.id });
    if (outcome) { statuses.push(outcome.status); reasons.push(outcome.reason); }
    return done(statuses, reasons, { resultRevisionId: revision.id, replayed: saved.replayed, manifestHref: manifestHref(revision.id), changeImpact: manifest?.changeImpact ?? null,
      artifacts: [{ artifactId: revision.id, logicalComponentId: 'BUILDING_MODEL', sourceRevisionId: revision.id, contentHash: hash,
        inputHash: revision.identity?.requirementsHash ?? hash, producerVersion: revision.generatorVersion ?? 'project-revision-v1', providerId: null,
        freshness: fresh(manifest, 'BUILDING_MODEL', revision.id) }],
      details: { kind: 'BLUEPRINT', generatorVersion: revision.generatorVersion, qaStatus: revision.qa.status, verificationStatus: verification?.status ?? null, renderJobs: 0 },
      provenance: { engine: 'blueprint-generator', engineVersion: revision.generatorVersion, providerId: null, inputHash: revision.identity?.requirementsHash ?? null } }, manifest);
  }

  if (module === 'MATERIALS') {
    const config = parseRequest(MaterialsConfigSchema, request.outputConfig);
    if (config.substitutions) return refuse('UNSUPPORTED', 'SUBSTITUTION_PROVENANCE_UNAVAILABLE',
      'Material substitutions are not supported: no substitution or supplier provenance exists to record them against');
    const takeoffInput = { projectId, revisionId: base.id, options: config.takeoffOptions };
    const takeoff = await engine(() => step(TAKEOFF_OPERATION, 'takeoff', takeoffInput, ctx => {
      requireCurrent();
      return createTakeoff(repository, userId, projectId, base.id, config.takeoffOptions, deps.secret, ctx);
    }));
    if (isResult(takeoff)) return takeoff;
    const t = TakeoffDetailSchema.parse(takeoff.result);
    const constructionInput = { projectId, revisionId: base.id, takeoffId: t.id, specification: config.specification, options: config.constructionOptions };
    const construction = await engine(() => step(CONSTRUCTION_OPERATION, 'construction', constructionInput, ctx =>
      createConstruction(repository, userId, projectId, base.id, t.id, config.specification, config.constructionOptions, deps.secret, ctx)));
    if (isResult(construction)) return { ...construction, written: true, reasons: [...construction.reasons,
      { code: 'TAKEOFF_STORED', message: `Takeoff ${t.id} was stored before the construction calculation was refused` }] };
    const k = ConstructionDetailSchema.parse(construction.result), manifest = await readBack(base.id);
    const statuses: SpecialistStatus[] = [], reasons: Reason[] = [];
    if (t.status === 'PARTIAL') { statuses.push('PARTIAL'); reasons.push({ code: 'TAKEOFF_PARTIAL', message: 'The takeoff could not evaluate every entity category' }); }
    if (k.status !== 'EVALUATED') { statuses.push('PARTIAL'); reasons.push({ code: 'CONSTRUCTION_PARTIAL', message: `The construction calculation is ${k.status}; see its coverage` }); }
    return done(statuses, reasons, { replayed: takeoff.replayed || construction.replayed,
      artifacts: [
        { artifactId: t.id, logicalComponentId: 'QUANTITY_TAKEOFF', sourceRevisionId: base.id, contentHash: costHash(t.report), inputHash: t.inputFingerprint,
          producerVersion: t.engineVersion, providerId: null, freshness: fresh(manifest, 'QUANTITY_TAKEOFF', t.id) },
        { artifactId: k.id, logicalComponentId: 'CONSTRUCTION_CALCULATION', sourceRevisionId: base.id, contentHash: costHash(k.report), inputHash: k.inputFingerprint,
          producerVersion: k.engineVersion, providerId: null, freshness: fresh(manifest, 'CONSTRUCTION_CALCULATION', k.id) }],
      details: { kind: 'MATERIALS', takeoffStatus: t.status, constructionStatus: k.status, recipePack: k.recipePack,
        materials: k.summary.totals.map(m => ({ materialCode: m.materialCode, unit: m.unit, final: m.final })) },
      provenance: { engine: 'quantity-takeoff+construction-calculations', engineVersion: k.engineVersion, providerId: null, inputHash: k.inputFingerprint } }, manifest);
  }

  // BUDGET
  const config = parseRequest(BudgetConfigSchema, request.outputConfig);
  if (!(SAMPLE_RATE_BOOKS as readonly string[]).includes(config.rateBookId)) return refuse('UNSUPPORTED', 'RATE_BOOK_UNAVAILABLE',
    `Rate book '${config.rateBookId}' does not exist; only the synthetic sample rate books (${SAMPLE_RATE_BOOKS.join(', ')}) are available`);
  const book = sampleRateBook(config.rateBookId === 'sample-inr-v1' ? '1' : '2');
  if (config.region && costHash(config.region) !== costHash(book.region)) return refuse('UNSUPPORTED', 'REGION_NOT_COVERED',
    `No rate book covers the requested region; '${config.rateBookId}' covers ${JSON.stringify(book.region)} only`);
  // Inputs must be current in the B37 manifest: a budget on a stale or unverifiable quantity is refused, not priced (scenario 39). Checked inside the
  // stored step, like the base revision, so a retry replays the stored estimate.
  const inputsCurrent = async () => {
    requireCurrent();
    const before = await projectManifest(repository, projectId, base.id);
    for (const [name, artifactId] of [['QUANTITY_TAKEOFF', config.takeoffId], ['CONSTRUCTION_CALCULATION', config.constructionCalculationId]] as const) {
      const state = freshness(before, name, artifactId);
      if (state === null) throw new ApiError(404, name === 'QUANTITY_TAKEOFF' ? 'TAKEOFF_NOT_FOUND' : 'CONSTRUCTION_NOT_FOUND', 'Input artifact not found for this revision');
      if (state !== 'current') throw new Refusal(refuse('STALE_DEPENDENCY', 'INPUT_NOT_CURRENT', `${name} ${artifactId} is ${state} in the project manifest; recompute it first`));
    }
  };
  const costInput = { projectId, revisionId: base.id, takeoffId: config.takeoffId, calculationId: config.constructionCalculationId, rateBookId: config.rateBookId,
    costingPolicy: config.costingPolicy, options: config.options };
  const cost = await engine(() => step(COST_OPERATION, 'cost', costInput, async ctx => {
    await inputsCurrent();
    return createCost(repository, userId, projectId, base.id, config.takeoffId, config.constructionCalculationId, config.rateBookId, config.costingPolicy,
      config.options, deps.secret, ctx);
  }));
  if (isResult(cost)) return cost;
  const c = CostDetailSchema.parse(cost.result);
  const [t, k, after] = await Promise.all([new TakeoffRepository(repository).read(projectId, base.id, config.takeoffId).then(r => TakeoffDetailSchema.parse(r)),
    new ConstructionRepository(repository).read(projectId, base.id, config.takeoffId, config.constructionCalculationId).then(r => ConstructionDetailSchema.parse(r)),
    readBack(base.id)]);
  const synthetic = c.report.rateBook.source.kind === 'SYNTHETIC', statuses: SpecialistStatus[] = [], reasons: Reason[] = [];
  if (synthetic) { statuses.push('REQUIRES_REVIEW'); reasons.push({ code: 'SYNTHETIC_RATE_BOOK', message: `${c.rateBookId} is synthetic sample data, not current market rates` }); }
  // Coverage is partial when a line has no rate or when the upstream quantities are themselves partial; either way no complete total is given.
  if (c.coverage !== 'FULLY_PRICED') statuses.push('PARTIAL');
  if (c.report.unpricedLineIds.length) reasons.push({ code: 'UNPRICED_LINES',
    message: `${c.report.unpricedLineIds.length} line(s) have no rate; they are listed, never counted as zero` });
  if (c.coverage !== 'FULLY_PRICED' && c.report.source.upstreamStatus !== 'EVALUATED') reasons.push({ code: 'UPSTREAM_PARTIAL',
    message: `The construction calculation is ${c.report.source.upstreamStatus}, so the estimate cannot be complete` });
  return done(statuses, reasons, { replayed: cost.replayed,
    artifacts: [
      { artifactId: t.id, logicalComponentId: 'QUANTITY_TAKEOFF', sourceRevisionId: base.id, contentHash: costHash(t.report), inputHash: t.inputFingerprint,
        producerVersion: t.engineVersion, providerId: null, freshness: fresh(after, 'QUANTITY_TAKEOFF', t.id) },
      { artifactId: k.id, logicalComponentId: 'CONSTRUCTION_CALCULATION', sourceRevisionId: base.id, contentHash: costHash(k.report), inputHash: k.inputFingerprint,
        producerVersion: k.engineVersion, providerId: null, freshness: fresh(after, 'CONSTRUCTION_CALCULATION', k.id) },
      { artifactId: c.id, logicalComponentId: 'BOQ_COST', sourceRevisionId: base.id, contentHash: c.reportHash, inputHash: c.inputFingerprint,
        producerVersion: c.engineVersion, providerId: null, freshness: fresh(after, 'BOQ_COST', c.id) }],
    details: { kind: 'BUDGET', rateBookId: c.rateBookId, rateBookVersion: c.rateBookVersion, rateBookSynthetic: synthetic, currency: c.currency, region: c.region,
      coverage: c.coverage, unpricedLineIds: c.report.unpricedLineIds, pricedTotal: c.finalTotals.pricedGrandTotal,
      completeTotal: c.finalTotals.completeTotalAvailable ? c.finalTotals.completeRepresentedScopeTotal : null },
    provenance: { engine: 'boq-cost', engineVersion: c.engineVersion, providerId: null, inputHash: c.inputFingerprint } }, after);
}

const CLAIMS = Object.freeze({ engineeringCorrectness: 'NOT_CLAIMED', solverValidation: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' } as const);
/** A typed refusal raised inside a stored step, so that it is decided only when the step actually runs (never on a replay). */
class Refusal extends Error { constructor(readonly result: SpecialistResult) { super(result.reasons[0]?.code ?? 'REFUSED'); } }

