import type { BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { modelHash } from '../lib/generation-identity.js';
import { projectBim } from '../bim/project.js';
import { BimError } from '../bim/contracts.js';
import { SCENE_LIMITS } from '../scene3d/contracts.js';
import { selectWalls } from './appearance.js';
import { interpretRevision } from './interpret.js';
import { APPEARANCE_VERSION, CLAIMS, FACADES, PreflightSchema, REVISION_INTENT_VERSION, REVISION_LIMITS, REVISION_OPERATION_VERSION, finishFactors,
  type Appearance, type ChangeClass, type Preflight, type PreflightRequest, type RevisionIntent } from './contracts.js';

export interface PlanRevision { id: string; revisionNumber: number; parentRevisionId: string | null; model: BuildingModelV2; generatorVersion: string | null }
export interface PlanOutput { output: string; artifacts: { id: string }[] }
export interface PlanContext {
  projectId: string; base: PlanRevision; baseAppearance: Appearance | null; baseOutputs: PlanOutput[];
  source: (PlanRevision & { appearance: Appearance | null; outputs: PlanOutput[] }) | null;
}

/** Text or structured request → intent; restore references are resolved against the actual history, never guessed. */
export function buildIntent(request: PreflightRequest['request'], base: PlanRevision, history: { id: string; revisionNumber: number }[]): RevisionIntent {
  if ('operation' in request) {
    const op = request.operation;
    return op.kind === 'RESTORE'
      ? { intentVersion: REVISION_INTENT_VERSION, source: 'STRUCTURED', text: null, operation: 'RESTORE', appearance: null, restore: { sourceRevisionId: op.sourceRevisionId, reference: `id:${op.sourceRevisionId}` },
        requestedChanges: [{ changeClass: 'RESTORE', phrase: 'structured restore' }], preservation: [], ambiguities: [], unsupported: [] }
      : { intentVersion: REVISION_INTENT_VERSION, source: 'STRUCTURED', text: null, operation: 'APPEARANCE_MODIFY', appearance: { target: op.target, finish: op.finish }, restore: null,
        requestedChanges: [{ changeClass: 'EXTERIOR_APPEARANCE', phrase: 'structured appearance' }], preservation: op.preserve.map(p => ({ ...p, phrase: 'structured preserve' })), ambiguities: [], unsupported: [] };
  }
  const intent = interpretRevision(request.text, base.model.levels);
  if (intent.restore && !intent.restore.sourceRevisionId) {
    const ref = intent.restore.reference, n = ref.startsWith('number:') ? Number(ref.slice(7)) : ref === 'original' ? 1 : null;
    const found = ref === 'previous' ? history.find(r => r.id === base.parentRevisionId) : history.find(r => r.revisionNumber === n);
    if (found) intent.restore.sourceRevisionId = found.id;
    else { intent.operation = null; intent.ambiguities.push(`No accepted revision matches "${ref}" in this project's history.`); }
  }
  return intent;
}

const GEOMETRY: ChangeClass[] = ['OPENING_GEOMETRY', 'WALL_GEOMETRY', 'ROOM_GEOMETRY', 'STRUCTURE', 'BUILDING_GEOMETRY'];
const CONFLICTS: Record<string, string[]> = { OPENING_GEOMETRY: ['OPENINGS', 'WALLS', 'BUILDING_GEOMETRY', 'FLOOR_PLANS'], WALL_GEOMETRY: ['WALLS', 'FLOOR_PLANS', 'ROOMS', 'BUILDING_GEOMETRY'],
  ROOM_GEOMETRY: ['ROOMS', 'WALLS', 'FLOOR_PLANS', 'BUILDING_GEOMETRY'], STRUCTURE: ['STRUCTURE', 'BUILDING_GEOMETRY'], BUILDING_GEOMETRY: ['BUILDING_GEOMETRY', 'BUILDING_DIMENSIONS', 'FLOOR_PLANS'] };
const ENGINES = ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS', 'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE', 'DESIGN_OPTIMIZATION'];
const ids = (outputs: PlanOutput[], name: string) => (outputs.find(o => o.output === name)?.artifacts ?? []).map(a => a.id).slice(0, 20);

/** Deterministic preflight: decides what may change, what is locked, what is reused and what blocks — without compiling anything. */
export function planRevision(ctx: PlanContext, intent: RevisionIntent): Preflight {
  const { base } = ctx, model = base.model, baseHash = modelHash(model as never);
  const blockers: Preflight['blockers'] = [], questions = [...intent.ambiguities], excluded: Preflight['excluded'] = [];
  const preflight = (status: Preflight['status'], extra: Partial<Preflight> = {}): Preflight => PreflightSchema.parse({ operationVersion: REVISION_OPERATION_VERSION, status,
    kind: intent.operation, base: { projectId: ctx.projectId, revisionId: base.id, revisionNumber: base.revisionNumber, modelHash: baseHash, appearanceHash: ctx.baseAppearance ? costHash(ctx.baseAppearance) : null },
    intent, appearance: null, appearanceHash: null, restore: null, targets: [], excluded, locks: [], impacts: [], verifications: [], blockers, questions: questions.slice(0, 8),
    quote: { execution: 'NONE', externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE', workers: 0, deadlineMs: 0, maxArtifactBytes: 0, estimatedSceneObjects: 0 },
    approvalRequired: true, claims: { ...CLAIMS }, ...extra });
  const changes = intent.requestedChanges.map(c => c.changeClass), locked = new Set<string>(intent.preservation.map(p => p.scope));
  const geometric = changes.filter(c => GEOMETRY.includes(c));
  const dependents = (reason: string) => [{ artifact: 'BUILDING_MODEL', action: 'BLOCKED' as const, baseArtifactIds: [], reason },
    ...['BIM', 'SCENE_3D', ...ENGINES].map(artifact => ({ artifact, action: 'INVALIDATED' as const, baseArtifactIds: ids(ctx.baseOutputs, artifact), reason: 'Would depend on the changed geometry and require recomputation; not executed.' }))];

  // 1. Geometry requests: never silently reinterpreted.
  for (const c of geometric) for (const scope of CONFLICTS[c]!) if (locked.has(scope))
    blockers.push({ code: 'LOCK_CONFLICT', message: `${c} conflicts with the requested preservation of ${scope}.` });
  if (blockers.length) return preflight('BLOCKED_BY_LOCK', { impacts: dependents('Requested geometry change conflicts with a preservation lock.') });
  if (geometric.length) {
    blockers.push({ code: 'GEOMETRY_MODIFICATION_NOT_SUPPORTED', message: `Selective revision V1 does not modify ${geometric.join(', ')}; use requirements regeneration (a new full revision) instead.` });
    return preflight('UNSUPPORTED', { impacts: dependents('Geometry modification is not performed by selective revision V1.') });
  }
  if (changes.includes('EXTERIOR_APPEARANCE') && locked.has('EXTERIOR_APPEARANCE')) {
    blockers.push({ code: 'LOCK_CONFLICT', message: 'An exterior finish change conflicts with the requested preservation of the exterior appearance.' });
    return preflight('BLOCKED_BY_LOCK');
  }
  if (changes.includes('INTERIOR_APPEARANCE')) {
    blockers.push({ code: 'INTERIOR_FINISH_NOT_SUPPORTED', message: 'Interior finishes are not supported: interior wall solids are shared by two rooms and face-level materials are not modeled.' });
    if (changes.includes('EXTERIOR_APPEARANCE')) { questions.push('The interior finish part cannot be performed. Submit the exterior change on its own to proceed.'); return preflight('NEEDS_CLARIFICATION'); }
    return preflight('UNSUPPORTED');
  }
  if (questions.length || !intent.operation) return preflight('NEEDS_CLARIFICATION');

  if (intent.operation === 'RESTORE') {
    const s = ctx.source;
    if (!s) { blockers.push({ code: 'RESTORE_SOURCE_NOT_FOUND', message: 'The revision to restore does not belong to this project.' }); return preflight('NEEDS_CLARIFICATION'); }
    if (s.id === base.id) { questions.push('That revision is already the current design.'); return preflight('NEEDS_CLARIFICATION'); }
    const sourceHash = modelHash(s.model as never), equivalent = sourceHash === baseHash;
    return preflight('AWAITING_CONSENT', {
      restore: { sourceRevisionId: s.id, sourceRevisionNumber: s.revisionNumber, modelHash: sourceHash, modelEquivalent: equivalent, appearanceHash: s.appearance ? costHash(s.appearance) : null },
      locks: [{ scope: 'BASE_REVISION', granularity: 'SEMANTIC_MODEL', origin: 'SYSTEM', enforcement: 'Accepted revisions are immutable; the restore commits a new revision.' },
        { scope: 'RESTORED_MODEL', granularity: 'SEMANTIC_MODEL', origin: 'SYSTEM', enforcement: 'SQL refuses the commit unless its canonical model hash equals the source revision model hash.' }],
      impacts: [{ artifact: 'BUILDING_MODEL', action: equivalent ? 'NOT_AFFECTED' : 'REGENERATE', baseArtifactIds: [], reason: equivalent ? 'Source and current models are identical.' : 'The source model replaces the current model; QA is re-run at commit.' },
        { artifact: 'APPEARANCE', action: 'REGENERATE', baseArtifactIds: [], reason: s.appearance ? 'The source revision appearance is restored.' : 'The default placeholder appearance is restored.' },
        ...ENGINES.map(artifact => equivalent ? { artifact, action: 'REUSE_SOURCE_EQUIVALENT' as const, baseArtifactIds: ids(ctx.baseOutputs, artifact), reason: 'The model is unchanged; existing results remain source-equivalent (not recomputed).' }
          : { artifact, action: ids(s.outputs, artifact).length ? 'REUSE_SOURCE_EQUIVALENT' as const : 'INVALIDATED' as const, baseArtifactIds: ids(s.outputs, artifact),
            reason: ids(s.outputs, artifact).length ? 'Results of the restored source revision apply to the identical restored model (not recomputed).' : 'Current results do not apply to the restored model; none exist for it.' })],
      verifications: ['Committed model canonical hash equals the source revision model (SQL).', 'Base is still the current revision (SQL compare-and-swap).', 'Independent blueprint QA passes on the restored model.'],
      quote: { execution: 'NONE', externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE', workers: 0, deadlineMs: 0, maxArtifactBytes: 0, estimatedSceneObjects: 0 } });
  }

  // APPEARANCE_MODIFY
  const target = intent.appearance!.target, storeys = model.levels.filter(l => l.kind === 'storey').map(l => l.id).sort();
  const unknown = (target.levelIds ?? []).filter(l => !storeys.includes(l));
  if (unknown.length) { blockers.push({ code: 'UNKNOWN_LEVEL', message: `Levels not in the base revision: ${unknown.join(', ').slice(0, 200)}` }); return preflight('NEEDS_CLARIFICATION'); }
  const lockedLevels = intent.preservation.filter(p => p.scope === 'LEVEL' && p.levelId).map(p => p.levelId!);
  const levels = (target.levelIds ?? storeys).filter(l => !lockedLevels.includes(l));
  for (const l of lockedLevels) if ((target.levelIds ?? storeys).includes(l)) excluded.push({ elementId: l, reason: 'LEVEL_LOCKED_BY_USER' });
  if (!levels.length) { blockers.push({ code: 'LOCK_CONFLICT', message: 'Every selected storey is locked by a preservation request.' }); return preflight('BLOCKED_BY_LOCK'); }
  const north = model.site?.northMilliDegrees;
  if (target.facades.length < FACADES.length && (north === null || north === undefined || north % 90_000 !== 0)) {
    questions.push('The site orientation is unknown or not a multiple of 90°, so individual façades cannot be identified. Apply the finish to all façades instead?');
    return preflight('NEEDS_CLARIFICATION');
  }
  const effectiveTarget = { ...target, levelIds: levels.length === storeys.length ? null : levels };
  const assignment = { target: effectiveTarget, finish: intent.appearance!.finish };
  const assignments = [...(ctx.baseAppearance?.assignments ?? []), assignment];
  if (assignments.length > REVISION_LIMITS.assignments) { blockers.push({ code: 'APPEARANCE_ASSIGNMENT_LIMIT', message: `At most ${REVISION_LIMITS.assignments} cumulative finish assignments per revision.` }); return preflight('UNSUPPORTED'); }
  const appearance: Appearance = { version: APPEARANCE_VERSION, assignments };
  const binding = { projectId: ctx.projectId, revisionId: base.id, modelHash: baseHash, generatorVersion: base.generatorVersion,
    parameterHash: model.parametricArchitecture ? costHash(model.parametricArchitecture) : null, generationId: null, requirementsHash: null };
  let bimIds: Map<string, string>;
  try { bimIds = new Map(projectBim(model, binding).elements.map(e => [`${e.source.collection}:${e.source.id}`, e.id])); }
  catch (error) {
    if (!(error instanceof BimError)) throw error;
    blockers.push({ code: 'SCENE_UNSUPPORTED_MODEL', message: 'The base revision is outside the supported scene/BIM profile (≤ 2 storeys, orthogonal, one straight stair, no columns).' });
    return preflight('UNSUPPORTED');
  }
  const { selected, excluded: notInScene } = selectWalls(model, effectiveTarget);
  excluded.push(...notInScene);
  if (!selected.length) { questions.push('No exterior wall in the base revision matches the requested façades and storeys.'); return preflight('NEEDS_CLARIFICATION'); }
  // "Objectively different": at least one targeted wall must change its effective finish.
  const before = (wallId: string) => { let f: ReturnType<typeof finishFactors> | null = null;
    for (const a of ctx.baseAppearance?.assignments ?? []) if (selectWalls(model, a.target).selected.some(s => s.wall.id === wallId)) f = finishFactors(a.finish);
    return JSON.stringify(f); };
  if (selected.every(s => before(s.wall.id) === JSON.stringify(finishFactors(assignment.finish)))) { questions.push('The selected façades already have this finish; nothing would change.'); return preflight('NEEDS_CLARIFICATION'); }
  const k = assignments.length - 1, objects = model.walls.filter(w => w.thicknessMm !== null).length + model.openings.filter(o => o.kind !== 'opening').length + model.slabs.length
    + model.stairs.reduce((n, s) => n + 1 + s.landings.length, 0) + model.spaces.length;
  return preflight('AWAITING_CONSENT', { appearance, appearanceHash: costHash(appearance),
    targets: selected.map(({ wall, facade }) => ({ sceneObjectId: `wall:${wall.id}`, sourceEntityType: 'wall' as const, sourceEntityId: wall.id, bimElementId: bimIds.get(`walls:${wall.id}`) ?? null, levelId: wall.levelId, facade, assignment: k })),
    locks: [{ scope: 'BUILDING_MODEL', granularity: 'SEMANTIC_MODEL', origin: 'SYSTEM', enforcement: 'SQL refuses the commit unless the committed canonical model hash equals the base model hash.' },
      { scope: 'SCENE_GEOMETRY', granularity: 'EXACT_BYTES', origin: 'SYSTEM', enforcement: 'The candidate GLB BIN chunk must be byte-identical to the validated Phase 29 base scene.' },
      { scope: 'NON_TARGET_OBJECTS', granularity: 'GEOMETRY', origin: 'SYSTEM', enforcement: 'Every non-target object keeps its material, node, mesh and accessor data unchanged.' },
      { scope: 'ENGINEERING_ARTIFACTS', granularity: 'DERIVED_ARTIFACT', origin: 'SYSTEM', enforcement: 'Appearance is not an engine input; existing results stay bound to the identical model and are not recomputed.' },
      ...intent.preservation.map(p => ({ scope: p.levelId ? `LEVEL:${p.levelId}` : p.scope, granularity: 'GEOMETRY' as const, origin: 'USER' as const,
        enforcement: p.scope === 'LEVEL' ? 'Storey excluded from the finish targets; its geometry is covered by the system locks.' : 'Covered by the system model and exact-byte geometry locks.' }))],
    impacts: [{ artifact: 'APPEARANCE_SCENE', action: 'REGENERATE', baseArtifactIds: [], reason: 'A candidate GLB with the new exterior finish is produced from the validated base scene.' },
      { artifact: 'BUILDING_MODEL', action: 'NOT_AFFECTED', baseArtifactIds: [], reason: 'Locked: the committed model must be identical.' },
      { artifact: 'BLUEPRINT_QA', action: 'REUSE_SOURCE_EQUIVALENT', baseArtifactIds: [], reason: 'QA is re-run deterministically on the identical model at commit.' },
      { artifact: 'BIM', action: 'NOT_AFFECTED', baseArtifactIds: [], reason: 'Derived on read from the identical model; element ids are stable.' },
      { artifact: 'SCENE_3D', action: 'REUSE_SOURCE_EQUIVALENT', baseArtifactIds: ids(ctx.baseOutputs, 'SCENE_3D'), reason: 'The Phase 29 geometry scene is identical for the identical model (placeholder appearance).' },
      ...ENGINES.map(artifact => ({ artifact, action: ids(ctx.baseOutputs, artifact).length ? 'REUSE_SOURCE_EQUIVALENT' as const : 'NOT_AFFECTED' as const, baseArtifactIds: ids(ctx.baseOutputs, artifact),
        reason: 'Visual appearance is not an input of this engine and the model is unchanged; results are not recomputed or re-verified.' }))],
    verifications: ['Phase 29 independent validator on the base scene', 'Exact-byte GLB BIN chunk (geometry) identity', 'Identical nodes, meshes, accessors and buffer views',
      'Changed materials only on independently derived targets (walls and their corner fills)', 'Variant material factors equal the finish', 'Model canonical hash equality at commit (SQL)', 'Base still current at commit (SQL)'],
    quote: { execution: 'LOCAL_DETERMINISTIC', externalProviders: [], externalCostUsd: 0, dataTransfer: 'NONE', workers: 1, deadlineMs: SCENE_LIMITS.compileDeadlineMs,
      maxArtifactBytes: SCENE_LIMITS.glbBytes, estimatedSceneObjects: objects } });
}
