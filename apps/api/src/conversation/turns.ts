import { randomUUID } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import type { Repository } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { RevisionRepository } from '../lib/revision-repository.js';
import { ProjectRevisionDetailSchema, RevisionListSchema } from '../contracts/projects.js';
import { ConversationIntentSchema, type ConversationState } from '../contracts/conversations.js';
import { CHANGE_INTENT_VERSION, TURN_LIMITS, TURN_VERSION, TurnSchema, type Action, type Affect, type ChangeIntent, type Fact, type MemoryEntry, type Turn }
  from '../contracts/conversation-memory.js';
import type { TurnRequest } from '../contracts/conversation-turns.js';
import { FACADES, PRESETS, StructuredOperationSchema, type PresetId, type RevisionIntent } from '../revision/contracts.js';
import { AssessmentRequestSchema } from '../engineering/contracts.js';
import { preservationCheck } from '../engineering/regeneration.js';
import { assertSafeConversationText, planConversation } from '../ai/conversation-planner.js';
import type { ConversationProvider } from '../ai/conversation-provider.js';
import { planPreflight } from '../services/revision-service.js';
import { assessRevision, regenerateRevisionZone } from '../services/engineering-service.js';
import { readRevisionModel } from '../services/verification-service.js';
import { classifyTurn, type Classified } from './interpret.js';
import { loadContext, type Loaded } from './context.js';
import { Memory, WHOLE_BUILDING, changedScopes, findConflicts } from './memory.js';

export interface TurnDeps { repository: Repository; projectId: string; conversationId: string; env: Env; provider?: ConversationProvider | undefined; signal?: AbortSignal }
export type TurnOutcome = { state: ConversationState; turn: Turn; action: Action | null; contextBytes: number; supersededOperations: string[] };
type Draft = Omit<Turn, 'turnVersion' | 'role' | 'inReplyTo' | 'createdAt' | 'baseRevisionId' | 'contextHash' | 'memory' | 'interpretation'>;

export const DISCLOSURES = Object.freeze({
  records: 'Composed from stored project records by deterministic rules; no language model wrote this reply.',
  confirm: 'Nothing has changed. The operation runs only after explicit confirmation, through the existing service with its own validation, QA, revision check and verification.',
  solver: 'No validated structural, wind, seismic, foundation or member-design solver exists in this backend; those domains are reported as blockers, not results.',
  sources: 'No standard edition, clause, load value, safety factor or rate is supplied; standards are named for identification only (NOT_VERIFIED).',
  research: 'The Phase 35 V2 engineering research reference set is not available to this backend; no research-specified value, threshold or method is used.',
  review: 'Nothing here is professionally reviewed, certified or construction-ready; software never assigns the professionally_reviewed evidence class.',
  value: 'The requested value is not given, because no verified source or validated calculation in this backend supports it.',
  suggestions: 'These are suggestions, not decisions. Nothing changes until you select one and confirm the resulting operation.',
});
const SUPPORTED_SUMMARY = 'Supported here: questions about this project, its decisions and constraints; exterior finish changes and their options; restoring an earlier revision; requirement changes (up to two floors); zone regeneration with a structured request; comparison of revisions; engineering status from the Phase 35 assessment.';
const label = (scope: string) => scope.toLowerCase().replace(/_/g, ' ');
const presetLabel = (id: PresetId) => PRESETS[id].label;
const decisionsRoute = (projectId: string, conversationId: string, actionId: string) => `/api/projects/${projectId}/conversations/${conversationId}/actions/${actionId}/decisions`;

/** Process one user message into one assistant turn. Read-only: every persistent change happens later, on explicit confirmation. */
export async function runTurn(deps: TurnDeps, previous: ConversationState, input: TurnRequest): Promise<TurnOutcome> {
  assertSafeConversationText(input.text);
  const now = new Date().toISOString(), { repository, projectId, conversationId } = deps;
  const loaded = await loadContext(repository, projectId, conversationId, previous);
  const base = loaded.base, levels = base ? base.model.levels.map(l => ({ id: l.id, index: l.index })) : [];
  const levelName = (id: string | null) => id ? base?.model.levels.find(l => l.id === id)?.name ?? null : null;
  const classified = classifyTurn(input.text, levels, !!input.operation);

  const state = structuredClone(previous);
  const memory = new Memory(state, input.turnId, state.baseRevisionId, now);
  const supersede = input.references?.supersede ?? [], superseded: string[] = [];
  const draft: Draft = { classification: classified.kind === 'UNSUPPORTED' ? 'CHANGE_REQUEST' : classified.kind, status: 'ANSWERED', summary: '', facts: [], questions: [],
    conflicts: [], intent: null, actionId: null, engineering: null, comparison: null, disclosures: [] };
  let interpretation: Turn['interpretation'] = { mode: 'DETERMINISTIC', provider: 'deterministic', model: TURN_VERSION, failure: null };
  let action: Action | null = null;

  // Explicit releases first: a constraint stops applying only when the user names it.
  for (const releaseId of input.references?.release ?? []) {
    const m = memory.entries.find(e => e.id === releaseId && e.kind === 'PRESERVATION' && e.status === 'ACTIVE');
    if (!m) throw new ApiError(422, 'MEMORY_REFERENCE_INVALID', 'Only an active preservation constraint of this conversation can be released');
    memory.set(m.id, { status: 'RELEASED' });
  }
  for (const decisionId of supersede) if (!memory.entries.some(e => e.id === decisionId && e.kind === 'ACCEPTED_DECISION' && e.status === 'ACCEPTED'))
    throw new ApiError(422, 'MEMORY_REFERENCE_INVALID', 'Only an accepted decision of this conversation can be superseded');

  // Explicit "keep …" clauses are recorded as constraints whatever else the turn asks for; an ambiguous storey reference is asked about instead.
  const revision = 'revision' in classified ? classified.revision : null;
  if (revision && ['CONSTRAINT', 'CHANGE_REQUEST', 'OPTION_SELECTION', 'UNSUPPORTED'].includes(classified.kind)) {
    for (const q of revision.ambiguities) if (/storey is meant/.test(q)) draft.questions.push(q);
    for (const p of revision.preservation) if (base || p.scope !== 'LEVEL') memory.preserve(p.scope, p.levelId, p.phrase, levelName(p.levelId));
  }

  const pending = () => (state.actions ?? []).filter(a => a.status === 'PENDING_CONFIRMATION' || a.status === 'CANDIDATE_READY');
  /** A new constraint withdraws any pending action it would be violated by; a withdrawn requirement proposal can no longer be approved. */
  const withdrawConflicting = () => {
    for (const a of pending()) {
      const hit = findConflicts(memory.entries.filter(m => m.kind === 'PRESERVATION'), a.affects);
      if (!hit.length) continue;
      a.status = 'SUPERSEDED'; a.updatedAt = now; a.confirmation = null; memory.settleProposal(a, 'SUPERSEDED');
      if (a.revisionOperation?.operationId) superseded.push(a.revisionOperation.operationId);
      if (a.kind === 'REQUIREMENTS_CHANGE') { state.proposal = null; state.status = 'DRAFT'; }
      draft.conflicts.push(...hit.map(h => ({ ...h, kind: 'PENDING_ACTION' as const, memoryId: h.memoryId, detail: `Pending ${a.kind.toLowerCase().replace(/_/g, ' ')} was withdrawn: ${h.detail}`.slice(0, 300) })));
    }
  };
  /** One pending action at a time: a new one supersedes the previous (its Phase 30 operation, if any, is cancelled after the turn commits). */
  const supersedePending = (keepRequirementProposal = false) => {
    for (const a of pending()) {
      a.status = 'SUPERSEDED'; a.updatedAt = now; a.confirmation = null; memory.settleProposal(a, 'SUPERSEDED');
      if (a.revisionOperation?.operationId) superseded.push(a.revisionOperation.operationId);
    }
    if (!keepRequirementProposal && state.proposal) { state.proposal = null; state.status = 'DRAFT'; }
  };
  const intentOf = (operation: ChangeIntent['operation'], capability: ChangeIntent['capability'], affects: Affect[], desiredChange: string, extra: Partial<ChangeIntent> = {}): ChangeIntent => ({
    intentVersion: CHANGE_INTENT_VERSION, projectId, baseRevisionId: state.baseRevisionId, operation, capability, affects, desiredChange: desiredChange.slice(0, 300),
    protected: memory.entries.filter(m => m.kind === 'PRESERVATION' && m.status === 'ACTIVE' && m.preservation).map(m => ({ memoryId: m.id, scope: m.preservation!.scope, levelId: m.preservation!.levelId })),
    requiredInputs: [], ambiguities: [], validation: [], confirmationRequired: true, expectedOutput: '', verification: [], ...extra });
  const conflictsOrNull = (affects: Affect[]) => { const c = findConflicts(memory.entries, affects, supersede); draft.conflicts.push(...c); return c.length ? c : null; };
  const createAction = (kind: Action['kind'], affects: Affect[], fields: Pick<Action, 'revisionOperation' | 'regeneration' | 'proposal'>, statement: string, option: MemoryEntry['option'] = null) => {
    const id = randomUUID();
    const actionHash = costHash({ kind, baseRevisionId: state.baseRevisionId, revisionOperation: fields.revisionOperation && { request: fields.revisionOperation.request, preflightHash: fields.revisionOperation.preflightHash },
      regeneration: fields.regeneration && { requestHash: fields.regeneration.requestHash, expectedModelHash: fields.regeneration.expectedModelHash }, proposal: fields.proposal, supersedes: supersede });
    const confirmation = kind === 'REQUIREMENTS_CHANGE'
      ? { method: 'POST' as const, route: `/api/projects/${projectId}/conversations/${conversationId}/proposals/approve`,
        body: { proposalId: fields.proposal!.proposalId, proposalVersion: fields.proposal!.proposalVersion, baseRevisionId: state.baseRevisionId, requirementsHash: fields.proposal!.requirementsHash, approve: true }, requires: [] }
      : { method: 'POST' as const, route: decisionsRoute(projectId, conversationId, id), body: { decision: 'CONFIRM', actionHash },
        requires: kind === 'ZONE_REGENERATION' ? ['decisionId' as const, 'expectedVersion' as const, 'operation' as const] : ['decisionId' as const, 'expectedVersion' as const] };
    action = { id, kind, status: 'PENDING_CONFIRMATION', turnId: input.turnId, baseRevisionId: state.baseRevisionId, actionHash, createdAt: now, updatedAt: now,
      protected: memory.entries.filter(m => m.kind === 'PRESERVATION' && m.status === 'ACTIVE').map(m => m.id), affects, supersedes: supersede,
      revisionOperation: fields.revisionOperation, regeneration: fields.regeneration, proposal: fields.proposal, result: null, failure: null, confirmation };
    state.actions = [...(state.actions ?? []), action];
    while (state.actions.length > TURN_LIMITS.actions) {
      const i = state.actions.findIndex(a => a.status !== 'PENDING_CONFIRMATION' && a.status !== 'CANDIDATE_READY');
      if (i < 0) break;
      state.actions.splice(i, 1);
    }
    memory.add({ kind: 'PROPOSAL', source: 'USER_EXPLICIT', statement: `Proposed: ${statement} (awaiting confirmation)`, option, change: { operation: kind, affects, actionId: id } });
    draft.actionId = id; draft.status = 'PENDING_CONFIRMATION'; draft.disclosures.push(DISCLOSURES.confirm);
  };
  const refuse = (status: 'UNSUPPORTED' | 'CLARIFICATION_REQUIRED' | 'CONFLICT', summary: string) => { draft.status = status; draft.summary = summary; };

  // A constraint stated in any turn immediately withdraws pending actions it would violate (confirmation re-checks as well).
  if (memory.added.some(id => memory.entries.find(e => e.id === id)?.kind === 'PRESERVATION')) withdrawConflicting();
  try {
    switch (classified.kind) {
      case 'OPTIONS': {
        const group = input.turnId;
        for (const s of memory.entries.filter(e => e.kind === 'SUGGESTION' && e.status === 'ACTIVE')) memory.set(s.id, { status: 'SUPERSEDED' });
        (Object.keys(PRESETS) as PresetId[]).forEach((presetId, i) => {
          const m = memory.add({ kind: 'SUGGESTION', source: 'SYSTEM_SUGGESTION', option: { group, index: i + 1, presetId }, statement: `Façade option ${i + 1}: ${presetLabel(presetId)}` });
          draft.facts.push({ key: `option.${i + 1}`, statement: `Option ${i + 1}: ${presetLabel(presetId)} (exterior wall finish, visual appearance only).`, basis: 'SUGGESTION', sourceRef: `memory:${m.id}` });
        });
        draft.summary = 'These are the supported exterior finish options. Select one by number to prepare a change; nothing is applied until you confirm.';
        draft.disclosures.push(DISCLOSURES.suggestions);
        break;
      }
      case 'DECISION_QUERY': {
        const live = memory.entries.filter(e => e.status === 'ACTIVE' || e.status === 'ACCEPTED');
        const kinds: [MemoryEntry['kind'], string][] = [['PRESERVATION', 'Constraint (user-stated, enforced)'], ['ACCEPTED_DECISION', 'Accepted decision (confirmed and persisted)'],
          ['REQUIREMENT', 'Requested requirement (applies once a proposal is approved)'], ['PROPOSAL', 'Pending proposal (not accepted)'], ['SUGGESTION', 'Suggestion (not accepted)']];
        for (const [kind, prefix] of kinds) for (const e of live.filter(x => x.kind === kind))
          draft.facts.push({ key: `memory.${e.ordinal}`, statement: `${prefix} #${e.ordinal}: ${e.statement}`.slice(0, TURN_LIMITS.statement), basis: kind === 'SUGGESTION' ? 'SUGGESTION' : 'MEMORY', sourceRef: `memory:${e.id}` });
        draft.facts = draft.facts.slice(0, TURN_LIMITS.facts);
        const accepted = live.filter(e => e.kind === 'ACCEPTED_DECISION').length;
        draft.summary = `${accepted} accepted decision(s) and ${live.filter(e => e.kind === 'PRESERVATION').length} active constraint(s). Suggestions and pending proposals are listed separately and are not decisions.`;
        break;
      }
      case 'ENGINEERING_QUESTION': {
        if (!base) { refuse('UNSUPPORTED', 'There is no accepted revision to assess.'); break; }
        const report = await assessRevision(repository, projectId, base.id, AssessmentRequestSchema.parse({ scope: classified.domains }));
        draft.engineering = { assessmentVersion: report.assessmentVersion, revisionId: report.revisionId, modelHash: report.modelHash, resultHash: report.resultHash,
          domains: report.domains.map(d => ({ domain: d.domain, assuranceLevel: d.assuranceLevel, status: d.status, evidenceClass: d.evidenceClass, blockers: d.blockers.map(b => b.code).slice(0, 8) })),
          claims: { ...report.claims }, limitations: report.limitations.slice(0, 6) };
        for (const d of report.domains) draft.facts.push({ key: `engineering.${d.domain}`, basis: 'DERIVED', sourceRef: `assessment:${report.resultHash}`,
          statement: `${label(d.domain)}: ${d.status.toLowerCase().replace(/_/g, ' ')}; evidence class ${d.evidenceClass ?? 'none (nothing computed)'}${d.blockers.length ? `; blocked by ${d.blockers.map(b => b.code).slice(0, 3).join(', ')}` : ''}.` });
        draft.summary = 'The Phase 35 assessment of this revision answers what can be determined; every domain it cannot evaluate is reported with its blocker.';
        draft.disclosures.push(DISCLOSURES.solver, DISCLOSURES.sources, DISCLOSURES.research, DISCLOSURES.review, ...(classified.asksForValue ? [DISCLOSURES.value] : []));
        break;
      }
      case 'COMPARISON': await compare(classified, deps, loaded, state, draft); break;
      case 'PROJECT_QUESTION': await answer(classified, deps, loaded, draft); break;
      case 'CONSTRAINT': {
        if (draft.questions.length) { refuse('CLARIFICATION_REQUIRED', 'A storey reference is ambiguous; no constraint was recorded for it.'); break; }
        draft.status = 'RECORDED';
        draft.summary = `Recorded ${memory.added.length} constraint(s); ${memory.entries.filter(e => e.kind === 'PRESERVATION' && e.status === 'ACTIVE').length} are now active and will be enforced on every later operation.`;
        for (const id of memory.added) { const e = memory.entries.find(x => x.id === id)!; draft.facts.push({ key: `memory.${e.ordinal}`, statement: e.statement, basis: 'MEMORY', sourceRef: `memory:${e.id}` }); }
        break;
      }
      case 'UNSUPPORTED': {
        draft.intent = intentOf('UNSUPPORTED', { capabilityId: classified.unsupported.code, status: 'UNSUPPORTED', service: null, route: null }, [], input.text,
          { expectedOutput: 'No operation; nothing is changed.' });
        refuse('UNSUPPORTED', classified.unsupported.message);
        if (classified.unsupported.alternative) draft.facts.push({ key: 'alternative', statement: classified.unsupported.alternative, basis: 'DERIVED', sourceRef: null });
        break;
      }
      case 'UNRECOGNIZED':
        refuse('CLARIFICATION_REQUIRED', 'The message could not be mapped to a supported question or operation, so nothing was assumed.');
        draft.questions.push(SUPPORTED_SUMMARY.slice(0, 300));
        break;
      case 'OPTION_SELECTION':
      case 'CHANGE_REQUEST': {
        if (draft.questions.length) { refuse('CLARIFICATION_REQUIRED', 'A storey reference is ambiguous; nothing was prepared.'); break; }
        const family = classified.kind === 'OPTION_SELECTION' ? 'EXTERIOR_APPEARANCE' : classified.family;
        if (family !== 'REQUIREMENTS' && !base) { refuse('UNSUPPORTED', 'There is no accepted revision to change yet; describe the building to prepare a first proposal.'); break; }
        if (family === 'EXTERIOR_APPEARANCE') await appearance(classified, revision!);
        else if (family === 'RESTORE') await restore(revision!);
        else if (family === 'ZONE_REGENERATION') await regeneration();
        else await requirements();
        break;
      }
    }
  } catch (error) {
    // A deterministic refusal by an underlying service becomes an honest turn; transient and server errors propagate and nothing is recorded.
    if (!(error instanceof ApiError) || error.statusCode >= 500 || ['UNSAFE_CONVERSATION_INPUT', 'MEMORY_REFERENCE_INVALID', 'CONVERSATION_MEMORY_LIMIT', 'REQUEST_CANCELLED'].includes(error.code)) throw error;
    draft.status = 'UNSUPPORTED'; draft.summary = `The underlying service refused the request (${error.code}): ${error.message}`.slice(0, 600);
  }

  async function appearance(c: Classified, intent: RevisionIntent) {
    let finish: { presetId: PresetId } | null = intent.appearance?.finish ? { presetId: intent.appearance.finish.presetId } : null, option: MemoryEntry['option'] = null;
    const target = intent.appearance?.target ?? { kind: 'EXTERIOR_WALLS' as const, facades: [...FACADES], levelIds: null };
    if (c.kind === 'OPTION_SELECTION') {
      const offered = memory.entries.filter(e => e.kind === 'SUGGESTION' && e.status === 'ACTIVE' && e.option);
      const group = offered.at(-1)?.option?.group, options = offered.filter(e => e.option!.group === group);
      if (!options.length) { refuse('CLARIFICATION_REQUIRED', 'No options are on record in this conversation, so there is nothing to select. Ask for the façade options first.'); return; }
      const chosen = c.index === null ? null : options.find(e => e.option!.index === c.index);
      if (!chosen) { refuse('CLARIFICATION_REQUIRED', `Which option? The options on record are numbered 1–${options.length}.`); draft.questions.push(`Select an option number between 1 and ${options.length}.`); return; }
      finish = { presetId: chosen.option!.presetId }; option = chosen.option;
    }
    const glazing = intent.requestedChanges.some(r => r.changeClass === 'PHYSICAL_GLAZING');
    if (!finish || glazing) {
      refuse('CLARIFICATION_REQUIRED', 'The exterior change is not specific enough to prepare.');
      draft.questions.push(...intent.ambiguities.filter(q => !/No supported modification/.test(q)).slice(0, TURN_LIMITS.questions));
      return;
    }
    const affects: Affect[] = [{ scope: 'EXTERIOR_APPEARANCE', levelIds: target.levelIds }];
    const desired = `exterior finish ${presetLabel(finish.presetId)} on ${target.facades.join(', ').toLowerCase()} façades${option ? ` (option ${option.index})` : ''}`;
    const capability = { capabilityId: 'EXTERIOR_APPEARANCE', status: 'AVAILABLE' as const, service: 'Phase 30 selective revision', route: `/api/projects/${projectId}/revision-operations` };
    draft.intent = intentOf('EXTERIOR_APPEARANCE', capability, affects, desired, { expectedOutput: 'A new revision with the same geometry and a new exterior appearance layer.',
      validation: ['Phase 30 preflight (locks, BIM profile)', 'Appearance compiler and validator', 'Acceptance QA on approval'], verification: ['Geometry lock: exact scene bytes identical to the base'] });
    if (conflictsOrNull(affects)) { refuse('CONFLICT', 'The change conflicts with a constraint or accepted decision; nothing was prepared.'); return; }
    await preflightAction('EXTERIOR_APPEARANCE', StructuredOperationSchema.parse({ kind: 'APPEARANCE_MODIFY', target, finish, preserve: preserveList() }), affects, desired, option);
  }

  async function restore(intent: RevisionIntent) {
    const reference = intent.restore?.reference ?? null;
    const history = RevisionListSchema.parse(await new ProjectRepository(repository).list('history', { limit: 100 }, projectId)).items;
    const number = reference?.startsWith('number:') ? Number(reference.slice(7)) : reference === 'original' ? 1 : null;
    const source = reference === 'previous' ? history.find(h => h.id === base!.parentRevisionId) : history.find(h => h.revisionNumber === number);
    if (!source) { refuse('CLARIFICATION_REQUIRED', 'The revision to restore could not be identified in this project\'s history.'); draft.questions.push('Which accepted revision should be restored (for example "revision 1" or "the original design")?'); return; }
    const detail = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, source.id));
    const affects = changedScopes(base!.model, detail.model);
    const sourceLayer = repository.revisionRpc ? await new RevisionRepository(repository).appearance(projectId, source.id) : null;
    if ((sourceLayer?.appearanceHash ?? null) !== (loaded.appearance?.appearanceHash ?? null) && !affects.some(a => a.scope === 'EXTERIOR_APPEARANCE' && a.levelIds === null))
      affects.push({ scope: 'EXTERIOR_APPEARANCE', levelIds: null });
    const desired = `restore revision ${source.revisionNumber} as a new revision`;
    draft.intent = intentOf('RESTORE', { capabilityId: 'RESTORE', status: 'AVAILABLE', service: 'Phase 30 selective revision', route: `/api/projects/${projectId}/revision-operations` }, affects, desired,
      { expectedOutput: `A new revision whose model equals revision ${source.revisionNumber}.`, validation: ['Phase 30 preflight', 'Acceptance QA on approval'], verification: ['Restored model hash equals the source revision'] });
    if (conflictsOrNull(affects)) { refuse('CONFLICT', 'Restoring that revision would change something you asked to keep; nothing was prepared.'); return; }
    await preflightAction('RESTORE', StructuredOperationSchema.parse({ kind: 'RESTORE', sourceRevisionId: source.id }), affects, desired, null);
  }

  async function preflightAction(kind: 'EXTERIOR_APPEARANCE' | 'RESTORE', request: ReturnType<typeof StructuredOperationSchema.parse>, affects: Affect[], desired: string, option: MemoryEntry['option']) {
    const preflight = await planPreflight(repository, projectId, base!.id, { operation: request });
    draft.facts.push({ key: 'preflight', statement: `Phase 30 preflight: ${preflight.status}; ${preflight.locks.length} lock(s), ${preflight.blockers.length} blocker(s), quote ${preflight.quote.execution}.`, basis: 'DERIVED', sourceRef: `preflight:${costHash(preflight)}` });
    for (const b of preflight.blockers.slice(0, 6)) draft.facts.push({ key: `blocker.${b.code}`.slice(0, 64), statement: b.message, basis: 'DERIVED', sourceRef: null });
    if (preflight.status === 'NEEDS_CLARIFICATION') { refuse('CLARIFICATION_REQUIRED', 'The revision engine needs clarification before it can prepare this.'); draft.questions.push(...preflight.questions.slice(0, TURN_LIMITS.questions)); return; }
    if (preflight.status === 'UNSUPPORTED') { refuse('UNSUPPORTED', 'The revision engine cannot perform this for the current revision.'); return; }
    if (preflight.status === 'BLOCKED_BY_LOCK') { refuse('CONFLICT', 'A preservation lock blocks this change; nothing was prepared.'); return; }
    supersedePending();
    createAction(kind, affects, { revisionOperation: { request, preflightHash: costHash(preflight), preflightStatus: preflight.status, locks: preflight.locks.length, operationId: null, candidateHash: null },
      regeneration: null, proposal: null }, desired, option);
    draft.summary = `Prepared: ${desired}. Confirm to create the candidate; it is committed only after you approve that candidate.`;
  }

  async function regeneration() {
    const route = `/api/projects/${projectId}/revisions/${base!.id}/engineering-assessment/zones/regeneration`;
    const capability = { capabilityId: 'ZONE_REGENERATION', status: input.operation ? 'AVAILABLE' as const : 'REQUIRES_STRUCTURED_INPUT' as const, service: 'Phase 35 zone regeneration', route };
    if (!input.operation) {
      draft.intent = intentOf('ZONE_REGENERATION', capability, [], input.text, { expectedOutput: 'A regeneration candidate once the structured request is supplied.',
        requiredInputs: ['operation.request.target: ZONE or SECTION (with zoneKey) for TYPICAL_FLOOR, EXTERIOR_SKIN for FENESTRATION',
          'operation.request.operation: TYPICAL_FLOOR with templateLevelId, or FENESTRATION with a window rule (widthMm, heightMm, sillMm, gapMm, edgeClearanceMm)',
          'operation.request.zones: optional zone declaration'] });
      refuse('CLARIFICATION_REQUIRED', 'Zone regeneration needs a structured request; templates, zones and window sizes are never inferred from wording.');
      draft.questions.push('Supply the structured regeneration request (see requiredInputs); the zone preflight route lists the zones and storeys of this revision.');
      return;
    }
    const request = input.operation.request, report = await regenerateRevisionZone(repository, projectId, base!.id, request, deps.env.BODY_LIMIT_BYTES);
    const desired = `${request.operation.kind.toLowerCase().replace('_', ' ')} regeneration of ${(report.changes?.regeneratedLevelIds ?? report.target.levelIds).length} storey(s)`;
    draft.facts.push({ key: 'regeneration', statement: `Phase 35 regeneration: ${report.status}${report.refusals.length ? ` (${report.refusals.map(r => r.code).slice(0, 4).join(', ')})` : ''}.`, basis: 'DERIVED', sourceRef: `regeneration:${report.resultHash}` });
    if (report.status === 'REFUSED') {
      draft.intent = intentOf('ZONE_REGENERATION', capability, [], desired, { expectedOutput: 'No candidate: the operation refused.' });
      for (const r of report.refusals.slice(0, 6)) draft.facts.push({ key: `refusal.${r.code}`.slice(0, 64), statement: r.detail.slice(0, 300), basis: 'DERIVED', sourceRef: null });
      refuse('UNSUPPORTED', 'The regeneration was refused by its own checks; nothing was prepared.'); return;
    }
    if (report.status === 'NO_CHANGE' || !report.candidate) { draft.summary = 'The regeneration would not change this revision; nothing was prepared.'; return; }
    const affects = changedScopes(base!.model, report.candidate.model);
    // A supplied revision carries no Phase 30 appearance layer, so committing the candidate drops the base's exterior appearance.
    if (loaded.appearance?.appearanceHash) affects.push({ scope: 'EXTERIOR_APPEARANCE', levelIds: null });
    draft.intent = intentOf('ZONE_REGENERATION', capability, affects, desired, { expectedOutput: `A supplied revision with model hash ${report.candidate.modelHash}.`,
      validation: ['Candidate recomputed on confirmation and must have the same model hash', 'Entity-level preservation check', 'Acceptance QA through the supplied-revision save'],
      verification: ['Post-commit regeneration verification must report VERIFIED'] });
    const check = report.preservation!.check;
    draft.comparison = { subject: 'PENDING_ACTION', baseRevisionId: base!.id, otherRevisionId: null, baseModelHash: loaded.baseModelHash, otherModelHash: report.candidate.modelHash,
      status: check.status, added: check.added, removed: check.removed, changed: check.changed, entities: [] };
    if (conflictsOrNull(affects)) { refuse('CONFLICT', 'The regeneration would change something you asked to keep, or an accepted decision; nothing was prepared.'); return; }
    supersedePending();
    createAction('ZONE_REGENERATION', affects, { revisionOperation: null, proposal: null, regeneration: { requestHash: costHash(request), inputHash: report.inputHash,
      expectedModelHash: report.candidate.modelHash, regeneratedLevelIds: report.changes?.regeneratedLevelIds ?? [], wallsRegenerated: report.changes?.wallsRegenerated ?? 0,
      preservation: check.status === 'IDENTICAL' ? 'IDENTICAL' : 'WITHIN_SCOPE', qaStatus: report.qa?.status ?? null, changes: { added: check.added, removed: check.removed, changed: check.changed } } }, desired);
    draft.summary = `Prepared: ${desired} (${check.added} added, ${check.removed} removed, ${check.changed} changed entities, all within the operation's scope). Confirm to commit and verify it.`;
  }

  async function requirements() {
    const capability = { capabilityId: 'REQUIREMENTS_CHANGE', status: 'AVAILABLE' as const, service: 'Phase 20 conversation planner', route: `/api/projects/${projectId}/conversations/${conversationId}/proposals/approve` };
    if (base && !previous.baseRequirements) {
      draft.intent = intentOf('REQUIREMENTS_CHANGE', { ...capability, status: 'UNSUPPORTED' }, WHOLE_BUILDING, input.text, { expectedOutput: 'No operation.' });
      refuse('UNSUPPORTED', 'This revision has no stored requirements (it was supplied or regenerated), so requirement-driven regeneration would replace the model entirely and is not offered.');
      return;
    }
    const affects = base ? WHOLE_BUILDING : [];
    draft.intent = intentOf('REQUIREMENTS_CHANGE', capability, affects, input.text, { expectedOutput: 'A requirement proposal; approval generates a new revision of the whole design.',
      validation: ['Phase 20 native requirement validation', 'Generator and independent acceptance QA on approval'], verification: ['Committed revision binds the approved requirements hash'] });
    if (base && conflictsOrNull(affects)) { refuse('CONFLICT', 'Requirement regeneration rebuilds the whole design and cannot guarantee what you asked to keep; nothing was prepared.'); return; }
    const before = structuredClone(state.intent);
    const planned = await planConversation(state, { messageId: input.turnId, expectedVersion: input.expectedVersion, baseRevisionId: input.baseRevisionId, text: input.text },
      { ...(deps.provider ? { provider: deps.provider } : {}), disabled: deps.env.AI_CONVERSATION_MODE === 'disabled', ...(deps.signal ? { signal: deps.signal } : {}) });
    // Adopt only what the Phase 20 planner owns; version, messages and the Phase 36 memory, actions and turns stay with this turn.
    const owned = (k: string) => !['version', 'messages', 'memory', 'turns', 'actions'].includes(k);
    for (const k of Object.keys(state).filter(owned)) if (!(k in planned)) delete (state as Record<string, unknown>)[k];
    for (const [k, v] of Object.entries(planned).filter(([k]) => owned(k))) (state as Record<string, unknown>)[k] = v;
    interpretation = { mode: 'PHASE20_PLANNER', provider: state.provider.kind, model: state.provider.model, failure: state.provider.failure };
    for (const key of Object.keys(ConversationIntentSchema.shape) as (keyof typeof state.intent)[]) {
      if (['unsupported', 'contradictions', 'inferredFields'].includes(key) || state.intent[key] === undefined || JSON.stringify(state.intent[key]) === JSON.stringify(before[key])) continue;
      for (const old of memory.entries.filter(e => e.kind === 'REQUIREMENT' && e.status === 'ACTIVE' && e.statement.startsWith(`Requested ${key}:`))) memory.set(old.id, { status: 'SUPERSEDED' });
      memory.add({ kind: 'REQUIREMENT', source: 'USER_EXPLICIT', statement: `Requested ${key}: ${JSON.stringify(state.intent[key])}`.slice(0, TURN_LIMITS.statement) });
    }
    draft.questions.push(...state.questions.slice(0, TURN_LIMITS.questions));
    if (state.status === 'FAILED') { draft.status = 'FAILED'; draft.summary = 'Language interpretation is unavailable; nothing was prepared.'; return; }
    if (state.status !== 'AWAITING_APPROVAL' || !state.proposal) {
      // The planner replaced any earlier proposal; a requirement action that pointed at it can no longer be approved.
      for (const a of pending().filter(x => x.kind === 'REQUIREMENTS_CHANGE')) { a.status = 'SUPERSEDED'; a.updatedAt = now; a.confirmation = null; memory.settleProposal(a, 'SUPERSEDED'); }
      refuse('CLARIFICATION_REQUIRED', state.unsupported.length ? `Unsupported in this request: ${state.unsupported.join(', ')}.` : 'More information is needed before a proposal can be prepared.'); return;
    }
    supersedePending(true);
    const p = state.proposal, desired = `requirement changes to ${p.changedFields.join(', ') || 'no fields'}`;
    createAction('REQUIREMENTS_CHANGE', affects, { revisionOperation: null, regeneration: null,
      proposal: { proposalId: p.id, proposalVersion: p.version, requirementsHash: p.requirementsHash, changedFields: p.changedFields } }, desired);
    draft.summary = `Prepared a requirement proposal (${desired}). Approving it regenerates the whole design as a new revision.`;
  }
  function preserveList() {
    return memory.entries.filter(m => m.kind === 'PRESERVATION' && m.status === 'ACTIVE' && m.preservation).slice(0, 16).map(m => ({ scope: m.preservation!.scope, levelId: m.preservation!.levelId }));
  }

  // ---------------------------------------------------------------- record the turn
  if (!draft.summary) draft.summary = 'Answered from the project records.';
  if (['ANSWERED', 'RECORDED'].includes(draft.status) && !draft.engineering) draft.disclosures.push(DISCLOSURES.records);
  state.version = previous.version + 1;
  state.messages = [...previous.messages, { id: input.turnId, text: input.text, createdAt: now }].slice(-20);
  const turn = TurnSchema.parse({ ...draft, turnVersion: TURN_VERSION, role: 'assistant', inReplyTo: input.turnId, createdAt: now, baseRevisionId: state.baseRevisionId,
    contextHash: loaded.document.contextHash, facts: draft.facts.slice(0, TURN_LIMITS.facts), questions: [...new Set(draft.questions)].slice(0, TURN_LIMITS.questions),
    conflicts: draft.conflicts.slice(0, TURN_LIMITS.conflicts), disclosures: [...new Set(draft.disclosures)].slice(0, TURN_LIMITS.disclosures),
    memory: { added: memory.added.slice(0, 16), updated: memory.updated.slice(0, TURN_LIMITS.memory) }, interpretation });
  state.turns = [...(state.turns ?? []), turn].slice(-TURN_LIMITS.turns);
  return { state, turn, action, contextBytes: loaded.document.bytes, supersededOperations: superseded };
}

async function compare(c: Extract<Classified, { kind: 'COMPARISON' }>, deps: TurnDeps, loaded: Loaded, state: ConversationState, draft: Draft) {
  const base = loaded.base;
  if (!base) { draft.status = 'UNSUPPORTED'; draft.summary = 'There is no accepted revision to compare.'; return; }
  if (c.subject === 'PENDING_ACTION') {
    const a = (state.actions ?? []).filter(x => x.status === 'PENDING_CONFIRMATION' || x.status === 'CANDIDATE_READY').at(-1);
    if (!a) {
      if (state.proposal) { draft.facts.push({ key: 'proposal', statement: `The pending requirement proposal changes: ${state.proposal.changedFields.join(', ') || 'nothing'}.`, basis: 'MEMORY', sourceRef: `proposal:${state.proposal.id}` }); draft.summary = 'Compared the pending proposal with the base revision\'s requirements.'; return; }
      draft.status = 'CLARIFICATION_REQUIRED'; draft.summary = 'There is no pending proposal to compare.'; draft.questions.push('Which revision should be compared (for example "the previous revision" or "revision 1")?'); return;
    }
    draft.facts.push({ key: 'affects', statement: `It would change: ${a.affects.map(x => `${label(x.scope)}${x.levelIds ? ` (${x.levelIds.length} storey(s))` : ''}`).join(', ') || 'nothing'}.`, basis: 'DERIVED', sourceRef: `action:${a.id}` });
    if (a.proposal) draft.facts.push({ key: 'fields', statement: `Requirement fields changed: ${a.proposal.changedFields.join(', ') || 'none'}.`, basis: 'MEMORY', sourceRef: `proposal:${a.proposal.proposalId}` });
    if (a.regeneration) draft.comparison = { subject: 'PENDING_ACTION', baseRevisionId: a.baseRevisionId, otherRevisionId: null, baseModelHash: loaded.baseModelHash, otherModelHash: a.regeneration.expectedModelHash,
      status: a.regeneration.preservation, ...a.regeneration.changes, entities: [] };
    if (a.revisionOperation) draft.facts.push({ key: 'geometry', statement: a.kind === 'EXTERIOR_APPEARANCE' ? 'Geometry is locked: only the exterior appearance layer changes.' : 'The restored model replaces the current one as a new revision.', basis: 'DERIVED', sourceRef: `action:${a.id}` });
    draft.summary = `Compared the pending ${a.kind.toLowerCase().replace(/_/g, ' ')} with base revision ${base.revisionNumber}.`;
    return;
  }
  const history = RevisionListSchema.parse(await new ProjectRepository(deps.repository).list('history', { limit: 100 }, deps.projectId)).items;
  const subject = c.subject, number = subject === 'ORIGINAL' ? 1 : typeof subject === 'object' ? subject.revisionNumber : null;
  const other = subject === 'PREVIOUS' ? history.find(h => h.id === base.parentRevisionId) : history.find(h => h.revisionNumber === number);
  if (!other || other.id === base.id) { draft.status = 'CLARIFICATION_REQUIRED'; draft.summary = 'No other revision matches that reference.'; draft.questions.push('Which revision number should be compared?'); return; }
  const [a, b] = await Promise.all([readRevisionModel(deps.repository, deps.projectId, other.id), readRevisionModel(deps.repository, deps.projectId, base.id)]);
  const check = preservationCheck(a.model, b.model, () => false), scopes = changedScopes(a.model, b.model);
  draft.comparison = { subject: 'REVISIONS', baseRevisionId: other.id, otherRevisionId: base.id, baseModelHash: a.hash, otherModelHash: b.hash, status: check.status === 'IDENTICAL' ? 'IDENTICAL' : 'DIFFERENT',
    added: check.added, removed: check.removed, changed: check.changed, entities: check.violations.slice(0, TURN_LIMITS.entities) };
  draft.facts.push({ key: 'comparison', basis: 'DERIVED', sourceRef: `models:${a.hash.slice(0, 12)}..${b.hash.slice(0, 12)}`,
    statement: check.status === 'IDENTICAL' ? `Revision ${other.revisionNumber} and revision ${base.revisionNumber} have identical models.`
      : `From revision ${other.revisionNumber} to ${base.revisionNumber}: ${check.added} added, ${check.removed} removed, ${check.changed} changed entities; scopes affected: ${scopes.map(s => label(s.scope)).join(', ')}.` });
  draft.summary = `Compared revision ${other.revisionNumber} with revision ${base.revisionNumber} entity by entity.`;
}

async function answer(c: Extract<Classified, { kind: 'PROJECT_QUESTION' }>, deps: TurnDeps, loaded: Loaded, draft: Draft) {
  const keys: Record<string, string[]> = { STOREYS: ['storeys', 'revision'], ROOMS: ['rooms', 'requirements'], SITE: ['site', 'north'], REVISION: ['revision', 'currency'], QA: ['revision'],
    OPENINGS: ['openings'], STAIRS: ['stairs'], APPEARANCE: ['appearance'], BRIEF: ['brief', 'brief.program', 'brief.budget'] };
  const wanted = new Set(c.topics.flatMap(t => keys[t] ?? []));
  const facts: Fact[] = loaded.document.facts.filter(f => !c.topics.length || wanted.has(f.key));
  if (c.topics.includes('REVISION')) for (const h of loaded.history) facts.push({ key: `history.${h.revisionNumber}`, statement: `Revision ${h.revisionNumber}: ${h.sourceMode}, QA ${h.qa.status}, ${h.createdAt}.`, basis: 'PROJECT_RECORD', sourceRef: `revision:${h.id}` });
  if (c.topics.includes('HEIGHT') && loaded.base) {
    const r = await assessRevision(deps.repository, deps.projectId, loaded.base.id, AssessmentRequestSchema.parse({ scope: ['HEIGHT_AND_STOREYS'] }));
    facts.push({ key: 'height', basis: 'DERIVED', sourceRef: `assessment:${r.resultHash}`, statement: r.height.heightMm === null ? 'The building height cannot be determined from the model (a storey height is not determined).'
      : `Height above the lowest storey floor: ${r.height.heightMm} mm over ${r.height.storeyCount} storey(s) (formula ${r.engine.formulas.height}; geometric, not a statutory height).` });
  }
  if (c.topics.includes('CAPABILITIES')) for (const cap of loaded.document.capabilities) facts.push({ key: `capability.${cap.capabilityId}`.slice(0, 64), statement: `${cap.capabilityId}: ${cap.status}. ${cap.detail}`.slice(0, 300), basis: 'DERIVED', sourceRef: null });
  draft.facts = facts.slice(0, TURN_LIMITS.facts);
  const missing = draft.facts.filter(f => f.basis === 'MISSING').length;
  draft.summary = `Answered from the project records${missing ? `; ${missing} item(s) are not recorded and are reported as missing rather than assumed` : ''}.`;
}
