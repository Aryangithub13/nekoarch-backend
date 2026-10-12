import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { costHash } from '@designflow/boq-cost';
import type { FastifyBaseLogger } from 'fastify';
import type { Repository } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { internalCommand } from '../lib/idempotency.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ConversationRepository } from '../lib/conversation-repository.js';
import { OperationDetailSchema, RevisionRepository } from '../lib/revision-repository.js';
import { modelHash } from '../lib/generation-identity.js';
import { ProjectDetailSchema, RevisionCommitResponseSchema } from '../contracts/projects.js';
import { ConversationIntentSchema, ConversationSchema, type ConversationState } from '../contracts/conversations.js';
import type { Action } from '../contracts/conversation-memory.js';
import type { ActionDecision } from '../contracts/conversation-turns.js';
import { TurnOperationSchema } from '../contracts/conversation-turns.js';
import { REVISION_OPS, approveOperation, closeOperation, createPreflight, executeOperation } from '../services/revision-service.js';
import { regenerateRevisionZone, verifyRevisionRegeneration } from '../services/engineering-service.js';
import { saveProjectRevision } from '../services/project-service.js';
import type { AppearancePool } from '../revision/pool.js';
import { boundedState } from '../ai/conversation-planner.js';
import { Memory, findConflicts } from './memory.js';

export interface ActionDeps { repository: Repository; userId: string; projectId: string; conversationId: string; env: Env; pool: () => AppearancePool; log: FastifyBaseLogger }
type Project = ReturnType<typeof ProjectDetailSchema.parse>;
type Revision = NonNullable<Project['currentRevision']>;
type Result = NonNullable<Action['result']>;
const SAVE_ROUTE = '/api/projects/:projectId/revisions';
const Reserved = z.object({ replay: z.boolean(), conversation: ConversationSchema }).strict();
const final = (a: Action) => !['PENDING_CONFIRMATION', 'CANDIDATE_READY'].includes(a.status);

/** Phase 20 fields follow the new base revision; its stored requirements (if any) become the base for later requirement proposals. */
function moveBase(state: ConversationState, revision: Revision) {
  const r = revision.normalizedRequirements ?? null;
  state.baseRevisionId = revision.id; state.baseRequirements = r; state.requirements = r;
  if (r) state.solver = 'parametricArchitecture' in r ? 'PARAMETRIC' : 'layoutV2' in r ? 'V2' : 'V1';
  state.proposal = null; state.status = 'DRAFT'; state.questions = []; state.unsupported = []; state.pendingBedroomMove = false;
  state.pendingIntent = ConversationIntentSchema.parse({}); state.fieldSources = r ? { base: 'PERSISTED' } : {};
  state.explanations = [`Now based on revision ${revision.revisionNumber}. Constraints and accepted decisions carry over; pending proposals for the previous revision do not.`];
}

function settle(state: ConversationState, memory: Memory, action: Action, status: Action['status'], now: string, extra: Partial<Action> = {}) {
  Object.assign(action, { status, updatedAt: now, ...extra });
  if (final(action)) action.confirmation = null;
  if (status === 'COMMITTED') {
    memory.settleProposal(action, 'ACCEPTED');
    for (const id of action.supersedes) memory.set(id, { status: 'SUPERSEDED' });
  } else if (status !== 'CANDIDATE_READY' && status !== 'PENDING_CONFIRMATION') memory.settleProposal(action, status === 'CANCELLED' ? 'REJECTED' : 'SUPERSEDED');
  if ((status === 'CANCELLED' || status === 'FAILED') && action.kind === 'REQUIREMENTS_CHANGE' && state.proposal?.id === action.proposal?.proposalId) { state.proposal = null; state.status = 'DRAFT'; }
}

/** After a commit, every other action prepared against the old base is stale. */
function staleOthers(state: ConversationState, memory: Memory, keep: string, now: string) {
  for (const a of state.actions ?? []) if (a.id !== keep && !final(a)) settle(state, memory, a, 'STALE', now, { failure: { code: 'BASE_REVISION_CHANGED', message: 'A newer revision was committed before this action was confirmed' } });
}

const zoneResult = async (deps: ActionDeps, revision: Revision, request: z.infer<typeof TurnOperationSchema>['request'] | null): Promise<Result> => {
  if (!request) return { revisionId: revision.id, revisionNumber: revision.revisionNumber, verification: 'COMMITTED_BY_SERVICE',
    detail: 'The committed model hash equals the confirmed candidate; resend the structured request to the verification route for a full verification.' };
  const v = await verifyRevisionRegeneration(deps.repository, deps.projectId, revision.id, request, deps.env.BODY_LIMIT_BYTES);
  // NO_PARENT cannot occur for a revision committed on a base; it is reported as not reproducible rather than verified.
  const verification = v.status === 'NO_PARENT' ? 'NOT_REPRODUCIBLE' as const : v.status;
  return { revisionId: revision.id, revisionNumber: revision.revisionNumber, verification, detail: v.detail.slice(0, 300) };
};

/**
 * Confirm, approve or cancel a pending action. Ordering: binding checks (action hash, structured input, conflicts) before any write; the
 * conversation lease before the underlying write; the underlying write under a receipt keyed by the action and step, so a retry replays it; the
 * conversation update last, fenced by version and lease. A lost conversation update after a commit is reconciled from the project record.
 */
export async function decideAction(deps: ActionDeps, actionId: string, input: ActionDecision) {
  const { repository, userId, projectId, conversationId, env } = deps, params = { projectId, conversationId };
  const conversations = new ConversationRepository(repository, userId, env.PROJECT_COMMIT_SECRET);
  const current = ConversationSchema.parse(await conversations.read('get', params));
  const found = (current.state.actions ?? []).find(a => a.id === actionId);
  if (!found) throw new ApiError(404, 'ACTION_NOT_FOUND', 'Action not found in this conversation');
  if (found.actionHash !== input.actionHash) throw new ApiError(409, 'ACTION_CONFLICT', 'The confirmation does not match the prepared action');
  // Already done: a repeated decision returns the recorded outcome without another write.
  const done = { CONFIRM: found.kind === 'ZONE_REGENERATION' ? ['COMMITTED'] : ['CANDIDATE_READY', 'COMMITTED'], APPROVE_CANDIDATE: ['COMMITTED'], CANCEL: ['CANCELLED'] }[input.decision];
  if (done.includes(found.status)) return { conversation: current, action: found };
  if (final(found)) throw new ApiError(409, 'ACTION_NOT_PENDING', `The action is ${found.status}`);
  if (found.kind === 'REQUIREMENTS_CHANGE' && input.decision !== 'CANCEL') throw new ApiError(409, 'USE_PROPOSAL_APPROVAL', 'A requirement proposal is approved through its proposal approval route');
  if (input.decision === 'CONFIRM' && found.status !== 'PENDING_CONFIRMATION') throw new ApiError(409, 'ACTION_NOT_PENDING', `The action is ${found.status}`);
  if (input.decision === 'APPROVE_CANDIDATE' && (found.status !== 'CANDIDATE_READY' || !input.candidateHash || input.candidateHash !== found.revisionOperation?.candidateHash))
    throw new ApiError(409, 'ACTION_CONFLICT', 'Approve the exact candidate that was prepared');
  let request = null;
  if (found.kind === 'ZONE_REGENERATION' && input.decision === 'CONFIRM') {
    if (!input.operation) throw new ApiError(422, 'ACTION_OPERATION_REQUIRED', 'Resend the structured regeneration request with the confirmation');
    request = input.operation.request;
    if (costHash(request) !== found.regeneration!.requestHash) throw new ApiError(409, 'ACTION_CONFLICT', 'The structured request differs from the one that was prepared');
  }

  const project = ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get', projectId));
  if (project.currentRevisionId !== current.state.baseRevisionId) {
    const reconciled = await reconcileCommit(deps, current, found, project, request);
    if (reconciled) return reconciled;
    throw new ApiError(409, 'REVISION_CONFLICT', 'The project has a newer revision than this conversation; rebase the conversation before confirming');
  }

  const token = randomUUID(), fingerprint = createHash('sha256').update(JSON.stringify({ actionId, ...input })).digest('hex');
  const reserved = Reserved.parse(await conversations.write('reserve', { ...params, messageId: input.decisionId, expectedVersion: input.expectedVersion,
    baseRevisionId: current.state.baseRevisionId, fingerprint, token }));
  const locate = (c: z.infer<typeof ConversationSchema>) => ({ conversation: c, action: (c.state.actions ?? []).find(a => a.id === actionId)! });
  if (reserved.replay) return locate(reserved.conversation);

  const now = new Date().toISOString(), state = structuredClone(reserved.conversation.state);
  const memory = new Memory(state, input.decisionId, state.baseRevisionId, now), action = state.actions!.find(a => a.id === actionId)!;
  state.version++;
  const finish = async (advanceTo?: Revision) => {
    const next = boundedState(state);
    const written = advanceTo ? await conversations.write('advance', { ...params, token, expectedVersion: reserved.conversation.state.version, state: next })
      : await conversations.write('finish', { ...params, token, state: next });
    return locate(ConversationSchema.parse(written));
  };
  const fail = async (code: string, message: string) => { settle(state, memory, action, 'FAILED', now, { failure: { code: code.slice(0, 100), message: message.slice(0, 300) } }); return finish(); };

  try {
    if (input.decision === 'CANCEL') {
      const operationId = action.revisionOperation?.operationId;
      if (operationId) {
        const op = await new RevisionRepository(repository).get(projectId, operationId);
        if (['AWAITING_CONSENT', 'CANDIDATE_READY'].includes(op.status))
          await internalCommand(repository, REVISION_OPS.cancel, `${actionId}:cancel`, { projectId, operationId }, ctx => closeOperation(repository, userId, projectId, operationId, 'cancel', env.PROJECT_COMMIT_SECRET, ctx));
      }
      settle(state, memory, action, 'CANCELLED', now);
      return await finish();
    }
    // Constraints recorded after the action was prepared still bind it.
    const conflicts = findConflicts(memory.entries, action.affects, action.supersedes);
    if (conflicts.length) return await fail('PRESERVATION_CONFLICT', conflicts[0]!.detail);

    if (action.kind === 'ZONE_REGENERATION') {
      const report = await regenerateRevisionZone(repository, projectId, action.baseRevisionId!, request!, env.BODY_LIMIT_BYTES);
      if (report.status !== 'CANDIDATE_READY' || report.candidate?.modelHash !== action.regeneration!.expectedModelHash)
        return await fail('CANDIDATE_CHANGED', `The regeneration recomputed on confirmation is ${report.status} and does not reproduce the confirmed candidate; nothing was committed`);
      const save = { model: report.candidate.model, baseRevisionId: action.baseRevisionId };
      const { result } = await internalCommand(repository, SAVE_ROUTE, `${actionId}:commit`, { projectId, ...save }, ctx =>
        saveProjectRevision(new ProjectRepository(repository), userId, projectId, 'supplied', save, env.PROJECT_COMMIT_SECRET, ctx, deps.log));
      const commit = RevisionCommitResponseSchema.parse(result);
      const outcome = await zoneResult(deps, commit.revision, request);
      settle(state, memory, action, 'COMMITTED', now, { result: outcome, ...(outcome.verification === 'VERIFIED' ? {} : { failure: { code: 'VERIFICATION_NOT_PASSED', message: outcome.detail } }) });
      staleOthers(state, memory, actionId, now); moveBase(state, commit.revision);
      return await finish(commit.revision);
    }

    const ro = action.revisionOperation!;
    if (input.decision === 'CONFIRM') {
      const created = OperationDetailSchema.parse((await internalCommand(repository, REVISION_OPS.preflight, `${actionId}:preflight`, { projectId, baseRevisionId: action.baseRevisionId, request: ro.request },
        ctx => createPreflight(repository, userId, projectId, { baseRevisionId: action.baseRevisionId!, request: { operation: ro.request } }, env.PROJECT_COMMIT_SECRET, ctx))).result);
      ro.operationId = created.id;
      if (created.preflightHash !== ro.preflightHash || created.status !== 'AWAITING_CONSENT') {
        if (created.status === 'AWAITING_CONSENT') await closeOperation(repository, userId, projectId, created.id, 'cancel', env.PROJECT_COMMIT_SECRET).catch(() => undefined);
        return await fail('PREFLIGHT_CHANGED', 'The revision engine no longer produces the preflight that was shown; nothing was executed. Ask again to prepare a new one.');
      }
      try {
        const executed = OperationDetailSchema.parse((await internalCommand(repository, REVISION_OPS.execute, `${actionId}:execute`, { projectId, operationId: created.id, preflightHash: created.preflightHash },
          ctx => executeOperation(repository, deps.pool, userId, projectId, created.id, { preflightHash: created.preflightHash }, env.PROJECT_COMMIT_SECRET, ctx))).result);
        ro.candidateHash = executed.candidateHash;
        settle(state, memory, action, 'CANDIDATE_READY', now, { confirmation: { method: 'POST', route: `/api/projects/${projectId}/conversations/${conversationId}/actions/${actionId}/decisions`,
          body: { decision: 'APPROVE_CANDIDATE', actionHash: action.actionHash, candidateHash: executed.candidateHash }, requires: ['decisionId', 'expectedVersion'] } });
        return await finish();
      } catch (error) {
        if (error instanceof ApiError && error.statusCode < 500 && error.code !== 'REVISION_CONFLICT') return await fail(error.code, error.message);
        throw error;
      }
    }
    const { result } = await internalCommand(repository, REVISION_OPS.approve, `${actionId}:approve`, { projectId, operationId: ro.operationId, preflightHash: ro.preflightHash, candidateHash: ro.candidateHash },
      ctx => approveOperation(repository, userId, projectId, ro.operationId!, { preflightHash: ro.preflightHash, candidateHash: ro.candidateHash! }, env.PROJECT_COMMIT_SECRET, ctx));
    const commit = RevisionCommitResponseSchema.parse(z.object({ commit: z.unknown() }).passthrough().parse(result).commit);
    settle(state, memory, action, 'COMMITTED', now, { result: { revisionId: commit.revision.id, revisionNumber: commit.revision.revisionNumber, verification: 'COMMITTED_BY_SERVICE',
      detail: 'Committed by Phase 30 approval, which re-ran acceptance QA on the exact model and enforced its geometry lock.' } });
    staleOthers(state, memory, actionId, now); moveBase(state, commit.revision);
    return await finish(commit.revision);
  } catch (error) {
    // A deterministic refusal by the underlying service is recorded as the action's failure under the lease still held. Anything else (a
    // transient or server error, or the project moving concurrently) records nothing: the lease is released by its holder and the error returned,
    // so a retry can replay a committed step from its receipt or be reconciled from the project record.
    if (error instanceof ApiError && error.statusCode < 500 && !['REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'REVISION_BASE_STALE'].includes(error.code)) {
      try { return await fail(error.code, error.message); } catch { /* fall through: release the lease and report the original error */ }
    }
    try { await conversations.write('cancel-message', { ...params, token }); } catch { deps.log.warn('Conversation lease cleanup unavailable'); }
    throw error;
  }
}

/** The project moved past the conversation's base. If the move is this action's own commit (a lost conversation update), record it; else refuse. */
async function reconcileCommit(deps: ActionDeps, current: z.infer<typeof ConversationSchema>, action: Action, project: Project,
  request: z.infer<typeof TurnOperationSchema>['request'] | null) {
  const revision = project.currentRevision;
  if (!revision || revision.parentRevisionId !== current.state.baseRevisionId) return null;
  let result: Result | null = null;
  if (action.kind === 'ZONE_REGENERATION' && modelHash(revision.model) === action.regeneration?.expectedModelHash) result = await zoneResult(deps, revision, request);
  if (action.revisionOperation?.operationId) {
    const op = await new RevisionRepository(deps.repository).get(deps.projectId, action.revisionOperation.operationId);
    if (op.status === 'COMMITTED' && op.committedRevisionId === revision.id) result = { revisionId: revision.id, revisionNumber: revision.revisionNumber, verification: 'COMMITTED_BY_SERVICE',
      detail: 'Committed by Phase 30 approval (reconciled from the operation record).' };
  }
  if (!result) return null;
  const conversations = new ConversationRepository(deps.repository, deps.userId, deps.env.PROJECT_COMMIT_SECRET), now = new Date().toISOString();
  const state = structuredClone(current.state), memory = new Memory(state, randomUUID(), state.baseRevisionId, now), target = state.actions!.find(a => a.id === action.id)!;
  state.version++;
  settle(state, memory, target, 'COMMITTED', now, { result });
  staleOthers(state, memory, action.id, now); moveBase(state, revision);
  const written = ConversationSchema.parse(await conversations.write('advance', { projectId: deps.projectId, conversationId: deps.conversationId, expectedVersion: current.state.version, state: boundedState(state) }));
  deps.log.info({ conversationId: deps.conversationId, actionId: action.id, revisionId: revision.id }, 'conversation action reconciled from project record');
  return { conversation: written, action: written.state.actions!.find(a => a.id === action.id)! };
}

/**
 * Follow the project's current revision. Idempotent while the conversation is already current and open. Actions prepared against the old base
 * are reconciled from the project's own records: committed if the new revision is provably theirs, stale otherwise.
 */
export async function rebaseConversation(deps: Omit<ActionDeps, 'pool'>, expectedVersion: number) {
  const { repository, userId, projectId, conversationId, env } = deps, params = { projectId, conversationId };
  const conversations = new ConversationRepository(repository, userId, env.PROJECT_COMMIT_SECRET);
  const current = ConversationSchema.parse(await conversations.read('get', params));
  const project = ProjectDetailSchema.parse(await new ProjectRepository(repository).read('get', projectId));
  const from = current.state.baseRevisionId, revision = project.currentRevision;
  if (!revision || (revision.id === from && !['SUBMITTED', 'REJECTED'].includes(current.state.status))) return { conversation: current, rebased: false, fromRevisionId: from, toRevisionId: from, reconciled: [] };
  if (current.state.version !== expectedVersion) throw new ApiError(409, 'PROPOSAL_CONFLICT', 'Conversation or proposal changed; reload and review');
  const now = new Date().toISOString(), state = structuredClone(current.state), memory = new Memory(state, randomUUID(), from, now), reconciled: { actionId: string; status: string }[] = [];
  state.version++;
  const child = revision.parentRevisionId === from;
  for (const a of state.actions ?? []) {
    if (final(a)) continue;
    let result: Result | null = null;
    if (child && a.kind === 'REQUIREMENTS_CHANGE' && current.state.status === 'SUBMITTED' && revision.identity?.requirementsHash === a.proposal?.requirementsHash)
      result = { revisionId: revision.id, revisionNumber: revision.revisionNumber, verification: 'COMMITTED_BY_SERVICE', detail: 'Approved through the Phase 20 proposal route; the revision binds the approved requirements hash.' };
    else if (child && a.kind === 'ZONE_REGENERATION' && modelHash(revision.model) === a.regeneration?.expectedModelHash) result = await zoneResult({ ...deps, pool: () => { throw new Error('unused'); } }, revision, null);
    else if (child && a.revisionOperation?.operationId) {
      const op = await new RevisionRepository(repository).get(projectId, a.revisionOperation.operationId);
      if (op.status === 'COMMITTED' && op.committedRevisionId === revision.id) result = { revisionId: revision.id, revisionNumber: revision.revisionNumber, verification: 'COMMITTED_BY_SERVICE', detail: 'Committed by Phase 30 approval.' };
    }
    if (result) settle(state, memory, a, 'COMMITTED', now, { result });
    else settle(state, memory, a, 'STALE', now, { failure: { code: 'BASE_REVISION_CHANGED', message: `The conversation moved to revision ${revision.revisionNumber} before this action was committed` } });
    reconciled.push({ actionId: a.id, status: a.status });
  }
  moveBase(state, revision);
  const written = ConversationSchema.parse(await conversations.write('rebase', { ...params, expectedVersion, state: boundedState(state) }));
  return { conversation: written, rebased: true, fromRevisionId: from, toRevisionId: revision.id, reconciled };
}
