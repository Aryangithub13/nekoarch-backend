import type { FastifyBaseLogger } from 'fastify';
import { costHash, sampleRateBook } from '@designflow/boq-cost';
import { GenerateRevisionRequestSchema, ProjectDetailSchema, ProjectRevisionDetailSchema, RevisionCommitResponseSchema } from '../contracts/projects.js';
import { TakeoffDetailSchema } from '../contracts/takeoffs.js';
import { ConstructionDetailSchema } from '../contracts/construction.js';
import { CostDetailSchema } from '../contracts/costs.js';
import { BlueprintConfigSchema, BudgetConfigSchema, EXTERIOR_GEOMETRY_SCOPES, ExteriorConfigSchema, INTERIOR_PLANNING_SCOPES, InteriorConfigSchema, MaterialsConfigSchema, MAX_REQUESTED_ROOMS, MODULE_SCOPES,
  PRESERVATION_MAP, SPECIALIST_VERSION, SpecialistResultSchema, STATUS_PRECEDENCE, StructuralConfigSchema, SUPPORTED_MODULES, type ComponentScope,
  type SpecialistModule, type SpecialistRequest, type SpecialistResult, type SpecialistStatus, type SupportedModule } from '../contracts/specialists.js';
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
import { pooled } from '../lib/bounded-reads.js';
import { readReference } from './reference-service.js';
import { createPreflight, planPreflight, REVISION_OPS } from './revision-service.js';
import { CLAIMS as REVISION_CLAIMS, PreflightRequestSchema, type Preflight } from '../revision/contracts.js';
import { OperationDetailSchema } from '../lib/revision-repository.js';
import { createStructuralAnalysis, STRUCTURAL_ANALYSIS_OPERATION } from './structural-service.js';
import { StructuralDetailSchema, StructuralInputSchema } from '../structural/contracts.js';

const GENERATE_ROUTE = '/api/projects/:projectId/revisions/generate';
const SAMPLE_RATE_BOOKS = ['sample-inr-v1', 'sample-inr-v2'] as const;
const MAX_FLOORS = MODEL_LIMITS.find(l => l.limitId === 'GENERATION_MAX_FLOORS')!.value;
/** Engine refusals that mean "outside what the engine supports", as opposed to "this input does not fit". */
const ENGINE_UNSUPPORTED = ['UNSUPPORTED_SITE_GEOMETRY', 'UNSUPPORTED_PARAMETRIC_CAPABILITY', 'UNSUPPORTED_GEOMETRY', 'SITE_TOO_COMPLEX', 'STRUCTURAL_SOURCE_UNSUPPORTED'];
/** Manifest modules that are part of the revision itself (replaced by a new revision, never regenerated): not listed as impacted outputs. */
const REVISION_ITSELF: readonly string[] = ['BUILDING_MODEL', 'ACCEPTANCE_QA', 'APPEARANCE_VARIANT'];
/** Reference reads in flight at once (at most MAX_REFERENCES are read). */
const REFERENCE_READS = 4;
type Reason = SpecialistResult['reasons'][number];
type Deps = { secret?: string | undefined; log?: FastifyBaseLogger | undefined; idempotencyKey?: string | undefined };

/** Most restrictive status among those that apply (STATUS_PRECEDENCE); COMPLETED when none does. */
export function overallStatus(statuses: SpecialistStatus[]): SpecialistStatus {
  return STATUS_PRECEDENCE.find(s => statuses.includes(s)) ?? 'COMPLETED';
}

/**
 * B39 S1/S2: one specialist request through the shared envelope. Read-only checks and typed refusals come first and write nothing. A supported request
 * then runs the existing engine service (or the Phase 30 preflight) unchanged, under the existing route's durable receipt when the caller sent an
 * Idempotency-Key, so a retry replays rather than repeats. Freshness is read back from the B37 manifest, never computed here; the result itself is not
 * stored (owner decision D-8b).
 */
export async function runSpecialist(repository: Repository, userId: string, projectId: string, module: SpecialistModule, request: SpecialistRequest,
  deps: Deps): Promise<SpecialistResult> {
  const projects = new ProjectRepository(repository);
  // Ownership and identity first: another user's project or a foreign revision is a 404, exactly as on the engine routes.
  const base = ProjectRevisionDetailSchema.parse(await projects.read('revision', projectId, request.baseRevisionId));
  const current = ProjectDetailSchema.parse(await projects.read('get', projectId)).currentRevision?.id ?? null;
  // References (ROADMAP L288) must be active references of this project. They are validated and recorded as metadata; no S1/S2 engine reads their content.
  const read = await pooled(request.referenceIds.map(referenceId => () => readReference(repository, projectId, referenceId).catch((error: unknown) => {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  })), REFERENCE_READS);
  const invalid = request.referenceIds.filter((_, i) => read[i]?.status !== 'ACTIVE');
  if (invalid.length) throw new ApiError(422, 'SPECIALIST_REFERENCE_INVALID', 'A reference is not an active reference of this project', { referenceIds: invalid });
  const references = read.map(r => ({ referenceId: r!.id, purpose: r!.purpose, mediaType: r!.mediaType, storedSha256: r!.storedSha256, use: 'RECORDED_NOT_CONSUMED' as const }));
  // The execution-cost ceiling (§E budget_exceeded). Every S1/S2 module runs locally at zero external cost, so the quote is always within it.
  const budget = request.budget ? { ...request.budget, quotedExternalCost: '0' as const, withinCeiling: true as const } : null;
  const manifestHref = (revisionId: string) => `/api/projects/${projectId}/revisions/${revisionId}/manifest`;
  const shell = (status: SpecialistStatus, reasons: Reason[]): SpecialistResult => SpecialistResultSchema.parse({
    envelopeVersion: SPECIALIST_VERSION, module, operation: request.operation, projectId, baseRevisionId: base.id, resultRevisionId: null, status, reasons: reasons.slice(0, 16),
    targetScopes: request.targetScopes, preserveScopes: request.preserveScopes, written: false, replayed: false, operationId: null, jobIds: [], artifacts: [],
    locks: [], impacts: [], references, budget,
    details: { kind: 'NONE' }, changeImpact: null, quote: { execution: 'NONE', externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE' },
    provenance: { engine: null, engineVersion: null, providerId: null, inputHash: null }, manifestHref: manifestHref(base.id), claims: CLAIMS });
  const refuse = (status: SpecialistStatus, code: string, message: string) => shell(status, [{ code, message }]);

  /** The stored outputs of the base that a geometry change would supersede, from its B37 manifest (read only; nothing is planned or stored). */
  const refuseGeometry = async (scopes: string[]): Promise<SpecialistResult> => {
    const reasons: Reason[] = [{ code: 'ENVELOPE_GEOMETRY_REGENERATION', message: `Exterior geometry (${scopes.join(', ')}: massing, glazing area or openings) is not `
      + 'regenerated by any engine; only the exterior wall finish can change (Phase 30 appearance). Nothing was run' }];
    let impacts: SpecialistResult['impacts'] = [];
    try {
      const m = await projectManifest(repository, projectId, base.id);
      impacts = m.modules.filter(x => x.source === 'STORED_ARTIFACT' && !REVISION_ITSELF.includes(x.module) && x.artifacts?.length).slice(0, 24).map(x => ({ artifact: x.module, action: 'INVALIDATED' as const,
        baseArtifactIds: x.artifacts!.slice(0, 20).map(a => a.artifactId),
        reason: 'A geometry change would make a new model; this output would be superseded and would have to be regenerated and re-reviewed' }));
      if (impacts.length) reasons.push({ code: 'IMPACTED_OUTPUTS', message: `Impacted engineering and derived outputs: ${impacts.map(i => i.artifact).join(', ')}` });
    } catch (error) {
      deps.log?.warn({ projectId, revisionId: base.id, err: error }, 'specialist impact read failed');
      reasons.push({ code: 'IMPACTS_UNAVAILABLE', message: 'The project manifest could not be read, so the impacted outputs are not listed' });
    }
    return { ...shell('UNSUPPORTED', reasons), impacts };
  };

  // Typed refusals (scenario 46): a module or an action that is not implemented is a result, not an error.
  if (!(SUPPORTED_MODULES as readonly string[]).includes(module))
    return refuse('UNSUPPORTED', 'MODULE_NOT_AVAILABLE', `The ${module} specialist is not implemented; nothing was run`);
  // Massing or glazing geometry is not changed by any engine (ENVELOPE_GEOMETRY_REGENERATION, scope §4 row 4): refused with the outputs it would invalidate.
  const geometry = request.targetScopes.filter(s => (EXTERIOR_GEOMETRY_SCOPES as readonly string[]).includes(s));
  if (module === 'EXTERIOR' && geometry.length) return refuseGeometry(geometry);
  // Space planning is not a finish change (scenario 33): a typed request to expand the scope, with nothing run.
  const planning = request.targetScopes.filter(s => (INTERIOR_PLANNING_SCOPES as readonly string[]).includes(s));
  if (module === 'INTERIOR' && planning.length) return refuse('UNSUPPORTED', 'SCOPE_EXPANSION_REQUIRED', `Interior changes space finishes only; ${planning.join(', ')} `
    + 'is space planning. Expand the scope: regenerate the layout through the BLUEPRINT specialist, then apply finishes to the new revision. Nothing was run');
  const rules = MODULE_SCOPES[module as SupportedModule];
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
        return refuse(ENGINE_UNSUPPORTED.includes(error.code) ? 'UNSUPPORTED' : 'FAILED', error.code, error.message.slice(0, 500));
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
  /** A Phase 30 preflight that is not awaiting consent, as a typed result: its blockers and questions are the reasons, its locks and impacts are kept. */
  const planned = (plan: Preflight): SpecialistResult => {
    const reasons: Reason[] = [...plan.blockers.map(b => ({ code: b.code, message: b.message })),
      ...plan.questions.map(q => ({ code: 'CLARIFICATION_NEEDED', message: q }))];
    if (!reasons.length) reasons.push({ code: `PREFLIGHT_${plan.status}`, message: `The Phase 30 preflight is ${plan.status}` });
    return { ...shell(plan.status === 'AWAITING_CONSENT' ? 'FAILED' : plan.status, reasons), locks: plan.locks, impacts: plan.impacts };
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
    if (!verification) { statuses.push('REQUIRES_REVIEW'); reasons.push({ code: 'VERIFICATION_UNAVAILABLE', message: 'Independent verification could not be run on the stored revision' }); }
    else if (verification.status === 'PARTIAL') { statuses.push('PARTIAL'); reasons.push({ code: 'VERIFICATION_PARTIAL', message: 'Independent verification could not evaluate every check' }); }
    // Owner decision (2026-10-14): a failed independent verification is a failure, not a review note. The revision is already committed and current, so
    // the reason says so: the client must review it, or restore the base through a Phase 30 RESTORE.
    else if (verification.status === 'FAILED') { statuses.push('FAILED'); reasons.push({ code: 'VERIFICATION_FAILED',
      message: `Independent verification failed after the revision passed acceptance QA. Revision ${revision.revisionNumber} was committed and is now the project's `
        + 'current revision: review it, or restore the base revision through a RESTORE revision operation' }); }
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

  if (module === 'EXTERIOR') {
    // Scope §4 row 4 (scenario 34): a cladding/finish change through the existing Phase 30 lifecycle. The envelope only stores the preflight; the existing
    // execute, comparison and approve routes complete it, so nothing changes the model until the owner approves the candidate.
    const config = parseRequest(ExteriorConfigSchema, request.outputConfig);
    const locks = request.preserveScopes.flatMap(s => s in PRESERVATION_MAP ? [{ scope: PRESERVATION_MAP[s as keyof typeof PRESERVATION_MAP], levelId: null }] : []);
    let appearance = config.appearance, preserve: { scope: string; levelId: string | null }[] = locks;
    if (!appearance) {
      if (!request.instruction) throw new ApiError(400, 'VALIDATION_ERROR', 'An Exterior request needs outputConfig.appearance or an instruction', { outputConfig: ['appearance or instruction required'] });
      // Natural language goes through the Phase 30 planner first (read only), so glazing, geometry and interior wording get Phase 30's own typed refusals.
      const plan = await planPreflight(repository, projectId, base.id, { text: request.instruction });
      if (plan.kind === 'RESTORE') return refuse('UNSUPPORTED', 'OPERATION_NOT_SUPPORTED', 'The instruction asks for a restore; Exterior only modifies the exterior finish');
      if (plan.status !== 'AWAITING_CONSENT' || !plan.intent.appearance) return planned(plan);
      appearance = plan.intent.appearance;
      preserve = [...plan.intent.preservation.map(x => ({ scope: x.scope, levelId: x.levelId })), ...locks];
    }
    const unique = [...new Map(preserve.map(x => [`${x.scope}:${x.levelId ?? ''}`, x])).values()];
    const body = parseRequest(PreflightRequestSchema, { baseRevisionId: base.id, request: { operation: { kind: 'APPEARANCE_MODIFY', ...appearance, preserve: unique } } });
    // The structured operation is planned again, read only: a refusal or a clarification stores nothing.
    const plan = await planPreflight(repository, projectId, base.id, body.request);
    if (plan.status !== 'AWAITING_CONSENT') return planned(plan);
    const stored = await engine(() => step(REVISION_OPS.preflight, 'preflight', { projectId, ...body }, ctx => {
      requireCurrent();
      return createPreflight(repository, userId, projectId, body, deps.secret, ctx);
    }));
    if (isResult(stored)) return stored;
    const op = OperationDetailSchema.parse(stored.result), at = `/api/projects/${projectId}/revision-operations/${op.id}`;
    if (op.status !== 'AWAITING_CONSENT') return { ...planned(op.preflight), written: true, replayed: stored.replayed, operationId: op.id };
    return SpecialistResultSchema.parse({ ...shell('AWAITING_CONSENT', [
      { code: 'CONSENT_REQUIRED', message: 'Review the locks, impacts and quote, then execute with the preflight hash and consent, compare the candidate, and approve or '
        + 'reject it. Nothing changes the model until approval' },
      { code: 'DOWNSTREAM_REGENERATION', message: 'Once approved, the new revision supersedes the base. The model is unchanged, so its quantities, construction, cost '
        + 'and structural, environmental and systems analyses stay current (SOURCE_MODEL_EQUIVALENT); its scene, BIM and documents need regenerating (U2, whole model)' }]),
    written: true, replayed: stored.replayed, operationId: op.id, locks: op.preflight.locks, impacts: op.preflight.impacts,
    quote: { execution: op.preflight.quote.execution, externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE' },
    details: { kind: 'EXTERIOR', preflightStatus: op.preflight.status, operationKind: 'APPEARANCE_MODIFY', preflightHash: op.preflightHash, appearanceHash: op.preflight.appearanceHash,
      targetObjects: op.preflight.targets.length, excludedObjects: op.preflight.excluded.length,
      next: { operationHref: at, executeHref: `${at}/execute`, comparisonHref: `${at}/comparison`, approveHref: `${at}/approve`, rejectHref: `${at}/reject` }, claims: { ...REVISION_CLAIMS } },
    provenance: { engine: 'phase30-revision-planner', engineVersion: op.operationVersion, providerId: null, inputHash: op.preflightHash } });
  }

  if (module === 'INTERIOR') {
    // Scope §4 row 6 (scenario 33; owner decision D-12, migration 0029): finish data on named spaces through the Phase 30 INTERIOR_FINISH_MODIFY operation.
    // The envelope only stores the preflight; the existing execute, comparison and approve routes complete it, and SQL holds every other model field.
    const config = parseRequest(InteriorConfigSchema, request.outputConfig);
    if (config.furnishings) return refuse('UNSUPPORTED', 'FURNISHINGS_NOT_SUPPORTED', 'Furnishings are not supported: the model has no furnishing data or furniture '
      + 'layout; only space finishes (floor, walls, ceiling) change. Nothing was run');
    const preserve = request.preserveScopes.flatMap(s => s in PRESERVATION_MAP ? [{ scope: PRESERVATION_MAP[s as keyof typeof PRESERVATION_MAP], levelId: null }] : []);
    const body = parseRequest(PreflightRequestSchema, { baseRevisionId: base.id, request: { operation: { kind: 'INTERIOR_FINISH_MODIFY', assignments: config.finishes, preserve } } });
    const plan = await planPreflight(repository, projectId, base.id, body.request);
    if (plan.status !== 'AWAITING_CONSENT') return planned(plan);
    const stored = await engine(() => step(REVISION_OPS.preflight, 'preflight', { projectId, ...body }, ctx => {
      requireCurrent();
      return createPreflight(repository, userId, projectId, body, deps.secret, ctx);
    }));
    if (isResult(stored)) return stored;
    const op = OperationDetailSchema.parse(stored.result), at = `/api/projects/${projectId}/revision-operations/${op.id}`, plan2 = op.preflight.interior;
    if (op.status !== 'AWAITING_CONSENT' || !plan2) return { ...planned(op.preflight), written: true, replayed: stored.replayed, operationId: op.id };
    return SpecialistResultSchema.parse({ ...shell('AWAITING_CONSENT', [
      { code: 'CONSENT_REQUIRED', message: 'Review the locks, impacts and finishes, then execute with the preflight hash and consent, compare the candidate, and approve or '
        + 'reject it. Nothing changes the model until approval' },
      { code: 'DOWNSTREAM_REGENERATION', message: 'Once approved, the finish data changes the model (its geometry does not), so the base\'s model-bound outputs '
        + '(quantities, cost, analyses, scene) become stale and are recomputed on the new revision' }]),
    written: true, replayed: stored.replayed, operationId: op.id, locks: op.preflight.locks, impacts: op.preflight.impacts,
    quote: { execution: op.preflight.quote.execution, externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE' },
    details: { kind: 'INTERIOR', preflightStatus: op.preflight.status, operationKind: 'INTERIOR_FINISH_MODIFY', preflightHash: op.preflightHash,
      candidateModelHash: plan2.candidateModelHash, geometryModelHash: plan2.geometryModelHash, spaces: plan2.spaces,
      next: { operationHref: at, executeHref: `${at}/execute`, comparisonHref: `${at}/comparison`, approveHref: `${at}/approve`, rejectHref: `${at}/reject` },
      claims: { productSpecification: 'NOT_CLAIMED', fireRating: 'NOT_CLAIMED', acousticPerformance: 'NOT_CLAIMED', slipResistance: 'NOT_CLAIMED' } },
    provenance: { engine: 'phase30-revision-planner', engineVersion: op.operationVersion, providerId: null, inputHash: op.preflightHash } });
  }

  if (module === 'STRUCTURAL') {
    // Scope §4 row 5 (scenario 36): the B24 linear static frame analysis, unchanged. Always REQUIRES_REVIEW: design verification is never evaluated and
    // nothing is certified. Any other analysis needs a validated solver, which does not exist.
    const config = parseRequest(StructuralConfigSchema, request.outputConfig);
    if (config.analysisType !== 'LINEAR_STATIC') return refuse('UNSUPPORTED', 'NO_VALIDATED_SOLVER', `${config.analysisType} analysis needs a validated engineering solver, `
      + 'which does not exist (VALIDATED_ENGINEERING_SOLVERS); only a LINEAR_STATIC frame analysis runs');
    const input = parseRequest(StructuralInputSchema, config.input);
    const stored = await engine(() => step(STRUCTURAL_ANALYSIS_OPERATION, 'analysis', { projectId, revisionId: base.id, input }, ctx => {
      requireCurrent();
      return createStructuralAnalysis(repository, userId, projectId, base.id, input, deps.secret, ctx);
    }));
    if (isResult(stored)) return stored;
    const a = StructuralDetailSchema.parse(stored.result), manifest = await readBack(base.id);
    return done(['REQUIRES_REVIEW'], [{ code: 'PROFESSIONAL_REVIEW_REQUIRED', message: 'A linear static frame analysis on project-defined materials, sections, supports '
      + 'and loads. Design verification is not evaluated and nothing is certified; a qualified engineer must review it before any use' }], { replayed: stored.replayed,
      artifacts: [{ artifactId: a.id, logicalComponentId: 'STRUCTURAL_ANALYSIS', sourceRevisionId: base.id, contentHash: costHash(a.snapshot), inputHash: a.inputHash,
        producerVersion: a.analysisVersion, providerId: null, freshness: fresh(manifest, 'STRUCTURAL_ANALYSIS', a.id) }],
      details: { kind: 'STRUCTURAL', analysisType: 'LINEAR_STATIC', solver: { name: a.solver.name, version: a.solver.version }, analysisStatus: a.snapshot.status.analysis,
        validationStatus: a.snapshot.status.validation, counts: a.counts, assumptions: a.snapshot.model.assumptions, limitations: a.snapshot.limitations,
        engineClaims: { ...a.snapshot.claims } },
      provenance: { engine: a.solver.name, engineVersion: a.solver.version, providerId: null, inputHash: a.inputHash } }, manifest);
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

