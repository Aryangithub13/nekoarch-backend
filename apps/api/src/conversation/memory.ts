import { randomUUID } from 'node:crypto';
import type { BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { ApiError } from '../lib/errors.js';
import { DIFF_COLLECTIONS } from '../verification/contracts.js';
import { PRESERVATION_SCOPES } from '../revision/contracts.js';
import { TURN_LIMITS, type Action, type Affect, type MemoryEntry, type Scope } from '../contracts/conversation-memory.js';
import type { ConversationState } from '../contracts/conversations.js';

type Model = BuildingModelV2;
type Entity = { id: string; levelId?: string; fromLevelId?: string; toLevelId?: string; kind?: string; wallId?: string; spaceIds?: string[]; classification?: string };
type Conflict = { memoryId: string; kind: 'PRESERVATION' | 'ACCEPTED_DECISION' | 'PENDING_ACTION'; scope: Scope | null; detail: string };

/** Every scope, building-wide: what an operation that regenerates the whole design (Phase 20 requirements) may change. */
export const WHOLE_BUILDING: Affect[] = PRESERVATION_SCOPES.map(scope => ({ scope, levelIds: null }));
const label = (scope: Scope) => scope.toLowerCase().replace(/_/g, ' ');

/**
 * Which preservation scopes differ between two models, and on which storeys: an entity-level comparison by canonical hash (the B34/B35 basis),
 * mapped onto the Phase 30 preservation vocabulary. Building-wide differences (site, document fields, levels) carry `levelIds: null`.
 */
export function changedScopes(base: Model, other: Model): Affect[] {
  const found = new Map<Scope, Set<string> | null>();
  const mark = (scope: Scope, levelIds: (string | undefined)[] | null) => {
    if (levelIds === null || found.get(scope) === null) { found.set(scope, null); return; }
    const set = found.get(scope) ?? new Set<string>();
    for (const l of levelIds) if (l) set.add(l);
    found.set(scope, set);
  };
  const exteriorWalls = new Set([...base.walls, ...other.walls].filter(w => w.classification === 'exterior').map(w => w.id));
  const canonical = (c: string, e: Entity) => c === 'walls' && e.spaceIds ? { ...e, spaceIds: [...e.spaceIds].sort() } : e;
  for (const collection of DIFF_COLLECTIONS) {
    const before = new Map((base[collection] as Entity[]).map(e => [e.id, e])), after = new Map((other[collection] as Entity[]).map(e => [e.id, e]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(id), b = after.get(id);
      if (a && b && costHash(canonical(collection, a)) === costHash(canonical(collection, b))) continue;
      const levels = [a, b].flatMap(e => e ? [e.levelId, e.fromLevelId, e.toLevelId] : []);
      mark('LEVEL', collection === 'levels' ? [id] : levels);
      if (collection === 'levels') { mark('BUILDING_GEOMETRY', null); mark('BUILDING_DIMENSIONS', null); }
      if (collection === 'spaces') { mark('ROOMS', levels); mark('FLOOR_PLANS', levels); mark('INTERIOR', levels); }
      if (collection === 'walls') {
        mark('WALLS', levels); mark('FLOOR_PLANS', levels);
        if (exteriorWalls.has(id)) mark('EXTERIOR_APPEARANCE', levels); else mark('INTERIOR', levels);
      }
      if (collection === 'openings') {
        mark('OPENINGS', levels);
        if ([a, b].some(e => e?.wallId && exteriorWalls.has(e.wallId))) mark('EXTERIOR_APPEARANCE', levels); else mark('INTERIOR', levels);
      }
      if (collection === 'slabs' || collection === 'columns') mark('STRUCTURE', levels);
      if (collection === 'stairs') mark('STAIRS', levels);
      if (collection === 'dimensions') mark('BUILDING_DIMENSIONS', levels);
      if (collection === 'specifications') mark('INTERIOR', null);
    }
  }
  const { site: _s1, provenance: _p1, ...restA } = base as Model & Record<string, unknown>, { site: _s2, provenance: _p2, ...restB } = other as Model & Record<string, unknown>;
  const doc = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([k]) => !(DIFF_COLLECTIONS as readonly string[]).includes(k)));
  if (costHash(base.site ?? null) !== costHash(other.site ?? null) || costHash(doc(restA)) !== costHash(doc(restB))) { mark('BUILDING_GEOMETRY', null); mark('BUILDING_DIMENSIONS', null); }
  return [...found].sort(([a], [b]) => a < b ? -1 : 1).map(([scope, levels]) => ({ scope, levelIds: levels === null ? null : [...levels].sort() }));
}

const overlaps = (levels: string[] | null, levelId: string | null) => levelId === null || levels === null || levels.includes(levelId);

/**
 * Conflicts of an operation with explicit preservation constraints and accepted decisions. Nothing is resolved here: a conflicting request is
 * reported, and only an explicit supersede (decisions) or release (constraints) by the user removes the conflict on a later turn.
 */
export function findConflicts(memory: readonly MemoryEntry[], affects: readonly Affect[], supersede: readonly string[] = []): Conflict[] {
  const out: Conflict[] = [];
  for (const m of memory) {
    if (m.kind === 'PRESERVATION' && m.status === 'ACTIVE' && m.preservation) {
      const p = m.preservation;
      const hit = p.scope === 'LEVEL' ? affects.some(a => overlaps(a.levelIds, p.levelId)) : affects.some(a => a.scope === p.scope && overlaps(a.levelIds, p.levelId));
      if (hit) out.push({ memoryId: m.id, kind: 'PRESERVATION', scope: p.scope,
        detail: `The request would change ${p.scope === 'LEVEL' ? 'a protected storey' : label(p.scope)}, which you asked to keep (constraint #${m.ordinal}). Release the constraint or change the request.`.slice(0, 300) });
    }
    if (m.kind === 'ACCEPTED_DECISION' && m.status === 'ACCEPTED' && m.change && !supersede.includes(m.id)) {
      const shared = m.change.affects.filter(d => affects.some(a => a.scope === d.scope && (a.levelIds === null || d.levelIds === null || a.levelIds.some(l => d.levelIds!.includes(l)))));
      if (shared.length) out.push({ memoryId: m.id, kind: 'ACCEPTED_DECISION', scope: shared[0]!.scope,
        detail: `The request would replace accepted decision #${m.ordinal} (${m.statement.slice(0, 120)}). Confirm by superseding it explicitly.`.slice(0, 300) });
    }
  }
  return out.slice(0, TURN_LIMITS.conflicts);
}

/** Memory mutations, bounded: closed entries are dropped oldest-first; active constraints and decisions are never dropped silently. */
export class Memory {
  readonly added: string[] = [];
  readonly updated: string[] = [];
  constructor(private readonly state: ConversationState, private readonly turnId: string, private readonly revisionId: string | null, private readonly now: string) {
    state.memory ??= [];
  }
  get entries(): MemoryEntry[] { return this.state.memory!; }
  add(entry: Pick<MemoryEntry, 'kind' | 'source' | 'statement'> & Partial<Pick<MemoryEntry, 'preservation' | 'option' | 'change' | 'status' | 'resultRevisionId'>>): MemoryEntry {
    const ordinal = Math.max(0, ...this.entries.map(e => e.ordinal)) + 1;
    const created: MemoryEntry = { id: randomUUID(), ordinal, kind: entry.kind, status: entry.status ?? 'ACTIVE', source: entry.source, statement: entry.statement.slice(0, TURN_LIMITS.statement),
      preservation: entry.preservation ?? null, option: entry.option ?? null, change: entry.change ?? null, turnId: this.turnId, revisionId: this.revisionId,
      resultRevisionId: entry.resultRevisionId ?? null, recordedAt: this.now, updatedAt: this.now };
    // Room is made before the entry is added, so a refusal leaves memory exactly as it was.
    const closed = (e: MemoryEntry) => !(e.status === 'ACTIVE' || e.status === 'ACCEPTED') || e.kind === 'SUGGESTION';
    while (this.entries.length >= TURN_LIMITS.memory) {
      const victim = this.entries.findIndex(closed);
      if (victim < 0) throw new ApiError(422, 'CONVERSATION_MEMORY_LIMIT', `At most ${TURN_LIMITS.memory} active constraints and decisions are kept; release some before adding more`);
      this.entries.splice(victim, 1);
    }
    this.entries.push(created); this.added.push(created.id);
    return created;
  }
  set(id: string, patch: Partial<Pick<MemoryEntry, 'status' | 'kind' | 'source' | 'resultRevisionId'>>) {
    const e = this.entries.find(x => x.id === id);
    if (!e) return;
    Object.assign(e, patch, { updatedAt: this.now });
    if (!this.updated.includes(id) && !this.added.includes(id)) this.updated.push(id);
  }
  /** Explicit, idempotent: the same constraint (scope and storey) is recorded once. */
  preserve(scope: Scope, levelId: string | null, phrase: string, levelName: string | null): MemoryEntry {
    const existing = this.entries.find(e => e.kind === 'PRESERVATION' && e.status === 'ACTIVE' && e.preservation?.scope === scope && e.preservation.levelId === levelId);
    if (existing) return existing;
    return this.add({ kind: 'PRESERVATION', source: 'USER_EXPLICIT', preservation: { scope, levelId },
      statement: `Keep ${scope === 'LEVEL' ? `storey ${levelName ?? levelId}` : label(scope)}${scope !== 'LEVEL' && levelId ? ` on storey ${levelName ?? levelId}` : ''} unchanged (stated: "${phrase.slice(0, 160)}")` });
  }
  /** A pending action's proposal entry follows the action: accepted with its revision when committed, superseded otherwise. */
  settleProposal(action: Action, outcome: 'ACCEPTED' | 'SUPERSEDED' | 'REJECTED', statement?: string) {
    const proposal = this.entries.find(e => e.kind === 'PROPOSAL' && e.change?.actionId === action.id && e.status === 'ACTIVE');
    if (proposal) this.set(proposal.id, { status: outcome });
    if (outcome === 'ACCEPTED' && action.result) {
      // The selected suggestion (same option group and index as the proposal) is now an accepted choice; the other options stay suggestions.
      for (const s of this.entries) if (s.kind === 'SUGGESTION' && s.status === 'ACTIVE' && proposal?.option && s.option?.group === proposal.option.group && s.option.index === proposal.option.index)
        this.set(s.id, { status: 'ACCEPTED' });
      this.add({ kind: 'ACCEPTED_DECISION', source: 'USER_CONFIRMED', status: 'ACCEPTED', resultRevisionId: action.result.revisionId,
        change: { operation: action.kind, affects: action.affects, actionId: action.id },
        statement: (statement ?? proposal?.statement ?? `${action.kind} confirmed`).replace(/^Proposed:/, 'Accepted:').slice(0, TURN_LIMITS.statement) });
    }
  }
}
