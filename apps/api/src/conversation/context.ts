import { costHash } from '@designflow/boq-cost';
import type { Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { RevisionRepository } from '../lib/revision-repository.js';
import { modelHash } from '../lib/generation-identity.js';
import { ProjectDetailSchema, ProjectRevisionDetailSchema, RevisionListSchema } from '../contracts/projects.js';
import { projectContext } from '../services/account-service.js';
import { AI_CAPABILITIES } from '../ai/orchestration/registry.js';
import { PRESETS } from '../revision/contracts.js';
import { TURN_LIMITS, type Fact } from '../contracts/conversation-memory.js';
import { CONTEXT_DOCUMENT_VERSION, ConversationContextSchema, type ConversationContext } from '../contracts/conversation-turns.js';
import type { ConversationState } from '../contracts/conversations.js';

type Revision = ReturnType<typeof ProjectRevisionDetailSchema.parse>;
export type Loaded = {
  project: ReturnType<typeof ProjectDetailSchema.parse>; base: Revision | null; baseModelHash: string | null; history: ReturnType<typeof RevisionListSchema.parse>['items'];
  appearance: { presetIds: string[]; appearanceHash: string | null } | null; bundle: Awaited<ReturnType<typeof projectContext>>; document: ConversationContext;
};

/**
 * Loads only what a turn needs, through the existing owner-scoped (RLS) services: the project and the conversation's base revision, the latest
 * revisions, the Phase 33 context bundle (brief, settings) and the Phase 30 appearance layer. Nothing is written.
 */
export async function loadContext(repository: Repository, projectId: string, conversationId: string, state: ConversationState): Promise<Loaded> {
  const projects = new ProjectRepository(repository);
  const [project, page, bundle] = await Promise.all([projects.read('get', projectId).then(p => ProjectDetailSchema.parse(p)),
    projects.list('history', { limit: TURN_LIMITS.history }, projectId), projectContext(repository, projectId)]);
  const baseId = state.baseRevisionId;
  const base = !baseId ? null : project.currentRevision?.id === baseId ? project.currentRevision : ProjectRevisionDetailSchema.parse(await projects.read('revision', projectId, baseId));
  const layer = base && repository.revisionRpc ? await new RevisionRepository(repository).appearance(projectId, base.id) : null;
  const appearance = layer?.appearance ? { presetIds: layer.appearance.assignments.map(a => a.finish.presetId), appearanceHash: layer.appearanceHash } : layer ? { presetIds: [], appearanceHash: null } : null;
  const loaded = { project, base, baseModelHash: base ? modelHash(base.model) : null, history: RevisionListSchema.parse(page).items, appearance, bundle };
  return { ...loaded, document: contextDocument(loaded, conversationId, state) };
}

const counts = (xs: readonly string[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {})).sort(([a], [b]) => a < b ? -1 : 1)
  .map(([k, n]) => `${n} ${k}`).join(', ');
const mm = (v: number) => `${v} mm (${(v / 1000).toFixed(3)} m)`;

/** Facts with their basis: PROJECT_RECORD (stored), DERIVED (computed here from stored records), USER_STATED (brief; unverified), MISSING. */
export function projectFacts(loaded: Omit<Loaded, 'document'>, state: ConversationState): Fact[] {
  const facts: Fact[] = [], fact = (key: string, statement: string, basis: Fact['basis'], sourceRef: string | null = null) => facts.push({ key, statement: statement.slice(0, TURN_LIMITS.statement), basis, sourceRef });
  const { project, base, bundle } = loaded;
  if (!base) fact('revision', 'The project has no accepted revision yet; there is no model to describe.', 'MISSING');
  else {
    const ref = `revision:${base.id}`;
    fact('revision', `This conversation is about revision ${base.revisionNumber} (${base.sourceMode}, created ${base.createdAt}); its acceptance QA status is ${base.qa.status}.`, 'PROJECT_RECORD', ref);
    if (project.currentRevisionId !== base.id) fact('currency', `The project has moved on to revision ${project.currentRevisionNumber}; this conversation's base is stale until it is rebased.`, 'PROJECT_RECORD', `project:${project.id}`);
    const m = base.model, storeys = m.levels.filter(l => l.kind === 'storey').sort((a, b) => a.elevationMm - b.elevationMm);
    fact('storeys', `${storeys.length} storey(s) in the model${storeys.length ? `: ${storeys.slice(0, 8).map(l => l.name).join(', ')}${storeys.length > 8 ? ', …' : ''}` : ''}.`, 'DERIVED', `model:${loaded.baseModelHash}`);
    fact('rooms', m.spaces.length ? `Spaces by classification: ${counts(m.spaces.map(s => s.classification))}.` : 'The model has no spaces.', 'DERIVED', `model:${loaded.baseModelHash}`);
    fact('openings', `${m.openings.filter(o => o.kind === 'window').length} window(s), ${m.openings.filter(o => o.kind === 'door').length} door(s), ${m.openings.filter(o => o.kind !== 'window' && o.kind !== 'door').length} other opening(s).`, 'DERIVED', `model:${loaded.baseModelHash}`);
    fact('stairs', `${m.stairs.length} stair flight(s).`, 'DERIVED', `model:${loaded.baseModelHash}`);
    const b = m.site?.boundary, xs = b?.map(p => p.x) ?? [], zs = b?.map(p => p.z) ?? [];
    const rectangle = b && b.length === 4 && b.every(p => (p.x === Math.min(...xs) || p.x === Math.max(...xs)) && (p.z === Math.min(...zs) || p.z === Math.max(...zs)));
    if (!m.site) fact('site', 'No site is recorded in the model.', 'MISSING');
    else fact('site', rectangle ? `Rectangular site ${mm(Math.max(...xs) - Math.min(...xs))} by ${mm(Math.max(...zs) - Math.min(...zs))}.` : `Site boundary with ${b!.length} vertices (not a rectangle).`, 'DERIVED', `model:${loaded.baseModelHash}`);
    if (m.site) fact('north', m.site.northMilliDegrees === null ? 'Site north is not recorded, so façade orientation cannot be resolved.' : `Site north is recorded at ${m.site.northMilliDegrees / 1000}°.`,
      m.site.northMilliDegrees === null ? 'MISSING' : 'PROJECT_RECORD', `model:${loaded.baseModelHash}`);
    fact('appearance', loaded.appearance?.presetIds.length ? `Exterior appearance layer: ${loaded.appearance.presetIds.map(p => PRESETS[p as keyof typeof PRESETS]?.label ?? p).join('; ')} (visual only).`
      : 'No exterior appearance layer; exterior walls use the default placeholder material.', loaded.appearance ? 'PROJECT_RECORD' : 'MISSING', `revision:${base.id}`);
    const r = base.normalizedRequirements;
    if (r && !('program' in r)) fact('requirements', `Stored requirements: ${r.floors} floor(s); rooms ${counts(r.rooms.flatMap(room => Array<string>(room.count).fill(room.type)))}.`, 'PROJECT_RECORD', `revision:${base.id}`);
    else fact('requirements', 'This revision has no stored native requirements (a supplied or regenerated model), so requirement-driven regeneration is unavailable for it.', 'MISSING', `revision:${base.id}`);
  }
  const brief = bundle.brief?.brief;
  if (!brief) fact('brief', 'No project brief has been recorded.', 'MISSING');
  else {
    fact('brief', `Brief v${bundle.brief!.version} (user-stated, not verified): ${brief.summary.slice(0, 200)}`, 'USER_STATED', `brief:${bundle.brief!.version}`);
    const program = [brief.program.floors !== undefined ? `${brief.program.floors} floor(s)` : null, brief.program.bedrooms !== undefined ? `${brief.program.bedrooms} bedroom(s)` : null].filter(Boolean);
    if (program.length) fact('brief.program', `Brief programme (user-stated): ${program.join(', ')}.`, 'USER_STATED', `brief:${bundle.brief!.version}`);
    if (brief.budget) fact('brief.budget', `Brief budget (user-stated, not verified): ${brief.budget.amount} ${brief.budget.currency}, ${brief.budget.flexibility.toLowerCase()} flexibility.`, 'USER_STATED', `brief:${bundle.brief!.version}`);
  }
  if (state.status === 'AWAITING_APPROVAL' && state.proposal) fact('proposal', `A requirement proposal (version ${state.proposal.version}) awaits explicit approval; it is not accepted.`, 'MEMORY', `proposal:${state.proposal.id}`);
  return facts.slice(0, TURN_LIMITS.facts);
}

export function capabilities(loaded: Omit<Loaded, 'document'>, state: ConversationState): ConversationContext['capabilities'] {
  const requirements = !loaded.base || !!state.baseRequirements;
  const planned = AI_CAPABILITIES.filter(c => c.status !== 'AVAILABLE' && ['EXPLANATION', 'LANGUAGE_INTERPRETATION', 'REQUIREMENT_COMPARISON', 'ENGINEERING_ASSISTANCE'].includes(c.capability));
  return [
    { capabilityId: 'REQUIREMENTS_CHANGE', status: requirements ? 'AVAILABLE' : 'UNSUPPORTED', detail: requirements ? 'Phase 20 requirement proposal (up to two floors); approval regenerates the whole design.'
      : 'The base revision has no stored requirements; regenerating from requirements would replace the model entirely.' },
    { capabilityId: 'EXTERIOR_APPEARANCE', status: loaded.base ? 'AVAILABLE' : 'UNSUPPORTED', detail: 'Phase 30 exterior wall finish (visual only), within the BIM profile; preflight, consent and approval.' },
    { capabilityId: 'RESTORE', status: loaded.history.length > 1 ? 'AVAILABLE' : 'UNSUPPORTED', detail: 'Phase 30 restore of an earlier accepted revision as a new revision.' },
    { capabilityId: 'ZONE_REGENERATION', status: loaded.base ? 'REQUIRES_STRUCTURED_INPUT' : 'UNSUPPORTED', detail: 'Phase 35 TYPICAL_FLOOR or FENESTRATION with a structured request; candidate, confirmed commit, post-commit verification.' },
    { capabilityId: 'ENGINEERING_EXPLANATION', status: loaded.base ? 'AVAILABLE' : 'UNSUPPORTED', detail: 'Phase 35 assessment domains and evidence classes; no validated solver, no professional review.' },
    { capabilityId: 'COMPARISON', status: loaded.base ? 'AVAILABLE' : 'UNSUPPORTED', detail: 'Entity-level comparison of stored revisions or of a pending candidate.' },
    ...planned.map(c => ({ capabilityId: `AI_${c.capability}`, status: 'PLANNED' as const, detail: 'Phase 21 capability not enabled: answers are composed from records, not generated by a model.' })),
    { capabilityId: 'STOREY_HEIGHT_CHANGE', status: 'UNSUPPORTED', detail: 'No operation changes storey heights.' },
    { capabilityId: 'STAIR_CHANGE', status: 'UNSUPPORTED', detail: 'No operation moves or resizes a stair.' },
    { capabilityId: 'STRUCTURAL_DESIGN', status: 'UNSUPPORTED', detail: 'No validated structural, wind, seismic or foundation solver.' },
    { capabilityId: 'MEDIA_GENERATION', status: 'UNSUPPORTED', detail: 'No renders, panoramas or video.' },
  ].slice(0, 16) as ConversationContext['capabilities'];
}

/** Assembles the bounded document; when it would exceed the byte limit, closed memory, then history, then trailing facts are dropped. */
export function contextDocument(loaded: Omit<Loaded, 'document'>, conversationId: string, state: ConversationState): ConversationContext {
  const live = (state.memory ?? []).filter(m => m.status === 'ACTIVE' || m.status === 'ACCEPTED');
  const doc = {
    contextVersion: CONTEXT_DOCUMENT_VERSION, projectId: loaded.project.id, conversationId, conversationVersion: state.version,
    baseRevisionId: state.baseRevisionId, currentRevisionId: loaded.project.currentRevisionId,
    currency: (!loaded.project.currentRevisionId ? 'NO_REVISION' : loaded.project.currentRevisionId === state.baseRevisionId ? 'CURRENT' : 'STALE') as ConversationContext['currency'],
    facts: projectFacts(loaded, state),
    history: loaded.history.map(h => ({ revisionId: h.id, revisionNumber: h.revisionNumber, parentRevisionId: h.parentRevisionId, sourceMode: h.sourceMode, qaStatus: h.qa.status, createdAt: h.createdAt })),
    memory: live.map(m => ({ id: m.id, ordinal: m.ordinal, kind: m.kind, status: m.status, statement: m.statement })),
    pendingActions: (state.actions ?? []).filter(a => a.status === 'PENDING_CONFIRMATION' || a.status === 'CANDIDATE_READY').map(a => ({ id: a.id, kind: a.kind, status: a.status })),
    capabilities: capabilities(loaded, state),
    sources: { projectContextVersion: loaded.bundle.contextVersion, projectContextHash: loaded.bundle.contextHash, briefVersion: loaded.bundle.brief?.version ?? 0 },
  };
  let truncated = false;
  const size = () => Buffer.byteLength(JSON.stringify({ ...doc, bytes: 99_999, truncated, contextHash: '0'.repeat(64), generatedAt: new Date(0).toISOString() }));
  while (size() > TURN_LIMITS.contextBytes) {
    truncated = true;
    const closed = doc.memory.findIndex(m => m.kind === 'SUGGESTION' || m.kind === 'PROPOSAL');
    if (closed >= 0) doc.memory.splice(closed, 1);
    else if (doc.history.length > 1) doc.history.pop();
    else if (doc.memory.length) doc.memory.shift();
    else if (doc.facts.length > 1) doc.facts.pop();
    else break;
  }
  const body = { ...doc, truncated };
  const bytes = size();
  return ConversationContextSchema.parse({ ...body, bytes, contextHash: costHash(body), generatedAt: new Date().toISOString() });
}
