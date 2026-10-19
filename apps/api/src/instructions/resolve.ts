import { createHash } from 'node:crypto';
import type { BuildingModelV2 } from '@designflow/shared';
import { CHANGE_SET_VERSION, ChangeSetSchema, INTEGRATION_LIMITS } from '../contracts/integration.js';
import { INSTRUCTION_LIMITS, InstructionResolutionSchema, RESOLUTION_VERSION, type InstructionResolution, type ResolutionReason, type ResolvedTarget }
  from './contracts.js';
import { EXTERIOR_WORDS, GEOMETRY_WORDS, LEVEL_PHRASE, ONLY, ONLY_FINISH_LOCKS, PARTIAL_RESTORE, classifyIntent, normalize, parseFinishes, parseKeep,
  parseRevisionRefs, splitClauses, splitExcept } from './grammar.js';
import { groundLevels, groundSpaces } from './ground.js';

export type RevisionFacts = { projectId: string; revisionId: string; revisionNumber: number; parentRevisionId: string | null; modelHash: string };
export type HistoryEntry = { id: string; revisionNumber: number; parentRevisionId: string | null };
type Draft = Omit<InstructionResolution, 'resolutionVersion' | 'projectId' | 'revisionId' | 'revisionNumber' | 'modelHash' | 'textHash' | 'executed' | 'interpretation' | 'claims'>;

const SUPPORTED = 'Supported: interior finish edits of named rooms (floor, walls, ceiling, from the finish catalog), restoring or comparing revisions, recomputing '
  + 'quantities, costs, structure or verification, a 3D scene of a revision, advisory alternatives, and starting a separate project.';
const project = (f: RevisionFacts) => `/api/projects/${f.projectId}`;

/**
 * Resolves one instruction against one revision. Pure and deterministic: the same (text, model, history) gives the same resolution. It never
 * executes, never stores, and never upgrades an ambiguity into a choice; a lock the user stated is reported as a conflict, never overridden.
 */
export function resolveInstruction(raw: string, model: BuildingModelV2, facts: RevisionFacts, history: readonly HistoryEntry[]): InstructionResolution {
  const t = normalize(raw), intent = classifyIntent(t);
  const d: Draft = { intent, status: 'RESOLVED', module: 'NONE', targets: [], exclusions: [], finishes: [], locks: [], conflicts: [], revisionRefs: [], clarifications: [],
    unsupported: [], changeSetDraft: null, handoff: null };
  const unsupported = (code: string, message: string) => d.unsupported.push({ code, message: message.slice(0, 500) });
  const ask = (q: string) => { if (d.clarifications.length < INSTRUCTION_LIMITS.clarifications) d.clarifications.push(q.slice(0, 300)); };

  // Revision references are grounded for every intent (an edit may also say "like revision 2"); only restore and compare act on them.
  const byNumber = new Map(history.map(h => [h.revisionNumber, h]));
  d.revisionRefs = parseRevisionRefs(t).map(r => {
    const h = r.kind === 'THIS' ? byNumber.get(facts.revisionNumber) ?? { id: facts.revisionId, revisionNumber: facts.revisionNumber }
      : r.kind === 'ORIGINAL' ? byNumber.get(1) : r.kind === 'NUMBER' ? byNumber.get(r.revisionNumber!)
        : history.find(x => x.id === facts.parentRevisionId);
    if (!h) ask(`No revision matches '${r.phrase}' in this project's history`);
    return { phrase: r.phrase.slice(0, 80), kind: r.kind, revisionNumber: h?.revisionNumber ?? r.revisionNumber, revisionId: h?.id ?? null };
  });

  switch (intent) {
    case 'EDIT_EXISTING': editExisting(t, model, facts, d, ask, unsupported); break;
    case 'RESTORE_PRIOR': {
      d.module = 'NONE';
      const target = d.revisionRefs.find(r => r.kind !== 'THIS');
      if (PARTIAL_RESTORE.test(t)) unsupported('PARTIAL_RESTORE_NOT_SUPPORTED', 'Reusing one aspect (a floor plan, façade or finish set) of an earlier revision is '
        + 'not supported: only a whole earlier revision can be restored, as a new descendant revision');
      else if (!target?.revisionId) ask('Which revision should be restored? Name it by number, or say "the previous revision"');
      else if (target.revisionId === facts.revisionId) ask('That is this revision; name an earlier one');
      else d.handoff = { method: 'POST', route: `${project(facts)}/revision-operations`, purpose: `Preflight a RESTORE of revision ${target.revisionNumber} as a new `
        + 'descendant revision (history is never rewritten); approval is a separate step', body: { baseRevisionId: facts.revisionId,
          request: { operation: { kind: 'RESTORE', sourceRevisionId: target.revisionId } } } };
      break;
    }
    case 'COMPARE_REVISIONS': {
      const refs = d.revisionRefs.filter(r => r.revisionId);
      const [a, b] = refs.length >= 2 ? [refs[0]!.revisionId!, refs[1]!.revisionId!] : [facts.revisionId, refs[0]?.revisionId ?? facts.parentRevisionId];
      if (!b) ask('Which revision should this one be compared with? It has no parent revision');
      else if (a === b) ask('Both references name the same revision; name two different revisions');
      else d.handoff = { method: 'POST', route: `${project(facts)}/revisions/${a}/verification/diff`, purpose: 'Element-level comparison of the two revisions (B34 scoped diff)',
        body: { otherRevisionId: b, scope: { levelIds: [], entityIds: [], allowSiteChange: false } } };
      break;
    }
    case 'RECOMPUTE_ENGINEERING': {
      const modules = ([['MATERIALS', /\b(?:quantit\w*|takeoff|materials?)\b/], ['BUDGET', /\b(?:cost\w*|budget|boq|estimate\w*)\b/], ['STRUCTURAL', /\bstructur\w*\b/],
        ['BLUEPRINT', /\b(?:verification|verify)\b/]] as const).filter(([, r]) => r.test(t)).map(([m]) => m);
      if (!modules.length) { ask('Which output should be recomputed: quantities, cost, structure or verification?'); break; }
      d.module = modules[0]!;
      d.handoff = modules[0] === 'BLUEPRINT'
        ? { method: 'GET', route: `${project(facts)}/revisions/${facts.revisionId}/verification`, purpose: 'B34 verification, derived on read for this revision', body: null }
        : { method: 'POST', route: `${project(facts)}/specialists/${modules[0]}/requests`, purpose: `Recompute ${modules.join(', ').toLowerCase()} on this revision through the B39 `
          + 'specialist envelope (its output configuration is required there)', body: null };
      if (modules.length > 1) ask(`Several outputs were named (${modules.join(', ')}); each is a separate specialist request`);
      break;
    }
    case 'REGENERATE_VISUAL_DERIVATIVE':
      if (/\b(?:3d (?:model|scene|view)|glb|scene)\b/.test(t)) {
        d.module = 'SCENE';
        d.handoff = { method: 'POST', route: `${project(facts)}/revisions/${facts.revisionId}/scene/artifacts`, purpose: 'Compile the 3D scene (GLB) of this revision', body: null };
      } else unsupported('NO_RENDER_PROVIDER', 'No rendering, panorama, image or video provider is configured; only the compiled 3D scene (GLB) is available');
      break;
    case 'DERIVE_ALTERNATIVE': {
      const scope = EXTERIOR_WORDS.test(t) ? 'EXTERIOR' : 'INTERIOR';
      d.module = scope;
      d.handoff = { method: 'POST', route: `${project(facts)}/revisions/${facts.revisionId}/design-concepts`, purpose: `Advisory ${scope.toLowerCase()} alternatives; `
        + 'a concept never changes a revision, and applying one is a separate, approved operation', body: { scope, alternatives: 2 } };
      break;
    }
    case 'NEW_PROJECT':
      d.handoff = { method: 'POST', route: '/api/projects', purpose: 'Create a separate project; this project and its revisions are not changed', body: null };
      break;
    case 'UNRECOGNIZED':
      ask(`The instruction did not match a supported action. ${SUPPORTED}`);
  }
  d.status = d.unsupported.length && !d.clarifications.length ? 'UNSUPPORTED' : d.clarifications.length || d.conflicts.length ? 'NEEDS_CLARIFICATION' : d.unsupported.length ? 'UNSUPPORTED' : 'RESOLVED';
  if (d.status !== 'RESOLVED') { d.changeSetDraft = null; if (intent === 'EDIT_EXISTING') d.handoff = d.status === 'UNSUPPORTED' ? d.handoff : null; }
  return InstructionResolutionSchema.parse({ resolutionVersion: RESOLUTION_VERSION, projectId: facts.projectId, revisionId: facts.revisionId,
    revisionNumber: facts.revisionNumber, modelHash: facts.modelHash, textHash: createHash('sha256').update(t).digest('hex'), ...d, executed: false,
    interpretation: { mode: 'DETERMINISTIC', grammar: RESOLUTION_VERSION, languageModel: 'NONE' }, claims: { engineeringCorrectness: 'NOT_CLAIMED', professionalReview: 'NOT_CLAIMED' } });
}

function editExisting(t: string, model: BuildingModelV2, facts: RevisionFacts, d: Draft, ask: (q: string) => void, unsupported: (code: string, message: string) => void) {
  const { head, excluded } = splitExcept(t);
  // Locks first: what the user asked to keep is decided before what they asked to change.
  const keep = parseKeep(t), only = ONLY.test(head) || keep.everythingElse;
  const lock = (scope: InstructionResolution['locks'][number]['scope'], levelId: string | null, source: 'ONLY' | 'KEEP' | 'LEVEL', phrase: string) => {
    if (!d.locks.some(l => l.scope === scope && l.levelId === levelId)) d.locks.push({ scope, levelId, source, phrase: phrase.slice(0, 80) });
  };
  for (const s of keep.scopes) lock(s.scope, null, 'KEEP', s.phrase);
  for (const phrase of keep.levelPhrases) for (const l of groundLevels(phrase, model)) {
    if (l.resolution === 'EXACT') lock('LEVEL', l.elementIds[0]!, 'LEVEL', phrase);
    else ask(`Which storey should be kept unchanged by '${phrase}'? ${l.candidates.map(c => c.name).join(' or ') || 'No such storey exists'}`);
  }
  // The requesting part, without the keep clauses, decides the module and the targets.
  const requesting = splitClauses(head).request.join('. ');
  const levels = groundLevels(requesting, model);
  for (const l of levels) if (l.resolution !== 'EXACT') {
    d.targets.push(l);
    ask(l.resolution === 'AMBIGUOUS' ? `Which storey is '${l.phrase}': ${l.candidates.map(c => c.name).join(' or ')}?` : `No storey matches '${l.phrase}' in this revision`);
  }
  const levelIds = levels.some(l => l.resolution === 'EXACT') ? levels.filter(l => l.resolution === 'EXACT').flatMap(l => l.elementIds) : null;
  const spaces = groundSpaces(requesting, model, levelIds);
  d.targets.push(...spaces.targets);
  spaces.questions.forEach(ask);
  if (excluded) {
    const ex = groundSpaces(excluded, model, levelIds);
    d.exclusions = ex.targets.map(x => ({ ...x, basis: [...x.basis, 'excluded'].slice(0, 8) }));
    ex.questions.forEach(ask);
    for (const x of d.exclusions) if (x.resolution !== 'EXACT') ask(`Which space is excluded by '${x.phrase}'?`);
  }
  const removed = new Set(d.exclusions.flatMap(x => x.elementIds));
  const targetIds = [...new Set(d.targets.filter(x => x.elementType === 'space' && x.resolution === 'EXACT').flatMap(x => x.elementIds))].filter(id => !removed.has(id));

  if (EXTERIOR_WORDS.test(requesting) && !/\b(?:floors?|ceilings?|flooring)\b/.test(requesting.replace(LEVEL_PHRASE, ' '))) {
    d.module = 'EXTERIOR';
    unsupported('EXTERIOR_EDIT_NOT_RESOLVED_HERE', 'Exterior appearance changes are resolved by the Exterior specialist and the Phase 30 grammar (four façade presets), not by this resolver');
    d.handoff = { method: 'POST', route: `${project(facts)}/specialists/EXTERIOR/requests`, purpose: 'Exterior appearance change through the B39 Exterior specialist', body: null };
    return;
  }
  const finishes = parseFinishes(requesting);
  if (GEOMETRY_WORDS.test(requesting) && !finishes.finishes.length) {
    d.module = 'BLUEPRINT';
    unsupported('ELEMENT_GEOMETRY_NOT_SUPPORTED', 'No engine changes a room, wall or opening selectively; regenerate the requirements through the Blueprint specialist (a new full revision)');
    d.handoff = { method: 'POST', route: `${project(facts)}/specialists/BLUEPRINT/requests`, purpose: 'Regenerate the requirements as a new full revision', body: null };
    return;
  }
  d.module = 'INTERIOR';
  d.finishes = finishes.finishes;
  finishes.questions.forEach(ask);
  for (const u of finishes.unsupported) unsupported(u.code, u.message);
  if (!d.finishes.length && !finishes.questions.length && !finishes.unsupported.length) ask('Which finish should change? Name the surface (floor, walls or ceiling) and a catalog finish');
  if (!d.targets.some(x => x.elementType === 'space')) ask('Which room should change? Name it (for example "the kitchen" or "bedroom 2")');
  else if (!targetIds.length && d.targets.every(x => x.resolution !== 'AMBIGUOUS')) ask('No room is left to change after the exclusions');
  for (const x of d.targets) if (x.elementType === 'space' && x.resolution === 'AMBIGUOUS')
    ask(`Which space is '${x.phrase}': ${x.candidates.map(c => `${c.name} (${c.elementId})`).join(', ')}?`);
  for (const x of d.targets) if (x.resolution === 'NOT_FOUND' && x.elementType === 'space') ask(`No space matches '${x.phrase}' in this revision`);

  // "Only" protects everything a finish edit must not touch. A lock the user stated that forbids the edit is a conflict, never overridden.
  if (only) for (const scope of ONLY_FINISH_LOCKS) lock(scope, null, 'ONLY', 'only');
  if (d.locks.some(l => l.scope === 'INTERIOR')) d.conflicts.push({ code: 'LOCK_CONFLICT', message: 'Interior finishes were asked to be kept, and also to change; say which applies' });
  for (const l of d.locks.filter(x => x.scope === 'LEVEL'))
    if (targetIds.some(id => model.spaces.find(s => s.id === id)?.levelId === l.levelId)) d.conflicts.push({ code: 'LOCK_CONFLICT',
      message: `A room to change is on ${model.levels.find(x => x.id === l.levelId)?.name ?? l.levelId}, which was asked to stay unchanged` });
  if (targetIds.length > INTEGRATION_LIMITS.changes) ask(`${targetIds.length} rooms were matched; a plan changes at most ${INTEGRATION_LIMITS.changes}. Narrow the request`);

  if (d.finishes.length && targetIds.length && !d.clarifications.length && !d.conflicts.length && !d.unsupported.length && targetIds.length <= INTEGRATION_LIMITS.changes) {
    const finishesObj = Object.fromEntries(d.finishes.map(f => [f.surface, f.finish]));
    d.changeSetDraft = ChangeSetSchema.parse({ changeSetVersion: CHANGE_SET_VERSION, baseRevisionId: facts.revisionId,
      changes: targetIds.map(elementId => ({ operation: 'modify', elementType: 'space', elementId, properties: { finishes: finishesObj } })),
      preserve: d.locks.map(l => ({ scope: l.scope, levelId: l.levelId })).slice(0, INTEGRATION_LIMITS.preserve) });
    d.handoff = { method: 'POST', route: `${project(facts)}/integration/plans`, purpose: 'Preview the B40 plan for this change set (read only); execution needs the exact '
      + 'plan hash and explicit consent', body: d.changeSetDraft as unknown as Record<string, unknown> };
  }
}
export type { ResolutionReason, ResolvedTarget };
