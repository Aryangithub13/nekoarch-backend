import { randomUUID } from 'node:crypto';
import { costHash } from '@designflow/boq-cost';
import { AiProviderError, type AiAttempt, type AiFailureCode, type AiPolicy, type AiUsage } from '../contracts/ai-orchestration.js';
import { BRIEF_WITHHELD, DESIGN_CLAIMS, DESIGN_CONCEPT_VERSION, DESIGN_GUARD_VERSION, DESIGN_LIMITS, DESIGN_TEMPLATE_VERSION, DesignConceptSetSchema,
  type DesignConceptRequest, type DesignConceptSet, type ExteriorOutput, type InteriorOutput, type NormalizedRequest } from '../contracts/design-concepts.js';
import { FACADES, PreflightRequestSchema, type Facade, type PresetId } from '../revision/contracts.js';
import type { AiOrchestrator } from '../ai/orchestration/orchestrator.js';
import type { AiTaskResult } from '../ai/orchestration/registry.js';
import { conceptTask, guardAlternatives, type GuardScope } from '../design/guard.js';
import { briefExcerpt, conceptPayload, INSTRUCTIONS } from '../design/prompt.js';
import { exteriorTemplates, interiorTemplates, presetLabel } from '../design/templates.js';
import { ApiError } from '../lib/errors.js';
import type { Repository } from '../lib/repository.js';
import { DesignConceptRepository } from '../lib/design-concept-repository.js';
import { projectContext } from './account-service.js';
import { documentSource } from './documents-service.js';
import { signProjectCommit } from './project-service.js';

export const DESIGN_ROOT = '/api/projects/:projectId/revisions/:revisionId/design-concepts';
const REVISION_OPERATIONS = '/api/projects/:projectId/revision-operations' as const;
// An appearance-only proposal keeps everything but the exterior finish; Phase 30 enforces these locks if the client submits it.
const PRESERVE = ['BUILDING_GEOMETRY', 'BUILDING_DIMENSIONS', 'FLOOR_PLANS', 'STRUCTURE', 'STAIRS', 'OPENINGS', 'WALLS', 'ROOMS', 'INTERIOR'] as const;
const ASSURANCE_NOTE = 'Advisory content with no engineering, regulatory or professional standing. It changes no revision and does not affect any engineering status, assurance level or blocker.';
const LIMITATIONS = Object.freeze({
  common: [
    'Advisory concept only: not a design, a specification or a drawing, and it changes no revision.',
    'No dimension, quantity, cost, structural, fire, thermal, energy or code statement is made; provider text that makes one is refused, never edited.',
    'Reference files are cited by metadata only; their contents were not read or analysed.',
    'Brief content is user-stated and unverified.',
  ],
  provider: 'Provider text may be inaccurate or unsuitable; review it before use.',
  template: 'Deterministic template: a fixed catalogue of visual schemes ranked by stated style words; it does not interpret the brief beyond its style keywords.',
  exterior: 'The proposed appearance operation is not executed; submitting it runs Phase 30 preflight, QA and approval with their own scope limits.',
});

type Outputs = InteriorOutput[] | ExteriorOutput[];
interface Generated { outputs: Outputs; source: DesignConceptSet['source']; provenance: DesignConceptSet['provenance'] }
const micro = (u: AiUsage) => ({ inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens,
  estimatedCostMicroUsd: u.estimatedCostUsd === null ? null : Math.round(u.estimatedCostUsd * 1_000_000) });
const attemptRecord = (a: AiAttempt) => ({ providerId: a.providerId, modelId: a.modelId, attempt: a.attempt, routingReason: a.routingReason === 'SECONDARY' ? 'SECONDARY' as const : 'PREFERRED' as const,
  fallbackPosition: a.fallbackPosition, latencyMs: Math.round(a.latencyMs), status: a.status, failure: a.failure, usage: a.usage ? micro(a.usage) : null });
const failures = (attempts: readonly AiAttempt[]) => [...new Set(attempts.map(a => a.failure).filter((f): f is AiFailureCode => f !== null))].slice(0, 16);

export function proposedOperation(revisionId: string, presetId: PresetId, facades: readonly Facade[]) {
  const request = PreflightRequestSchema.parse({ baseRevisionId: revisionId, request: { operation: { kind: 'APPEARANCE_MODIFY',
    target: { kind: 'EXTERIOR_WALLS', facades: [...facades], levelIds: null }, finish: { presetId }, preserve: PRESERVE.map(scope => ({ scope, levelId: null })) } } });
  return { status: 'NOT_EXECUTED' as const, submitTo: REVISION_OPERATIONS, request,
    note: 'Not executed. Submitting it runs Phase 30 preflight, QA and approval; it changes the visual exterior finish only.' };
}

/**
 * Phase 39 design concepts. The service owns the read, consumption, charge protection and assembly; the router owns provider selection;
 * the guard owns acceptance. Provider-specific detail never reaches the route.
 */
export class DesignConceptService {
  private readonly inflight = new Map<string, Promise<Awaited<ReturnType<DesignConceptRepository['write']>>>>();
  constructor(private readonly orchestrator: AiOrchestrator, private readonly policy: Pick<AiPolicy, 'privacyClass' | 'deterministicFallback' | 'timeoutMs'>,
    private readonly secret?: string) {}

  async create(repository: Repository, userId: string, projectId: string, revisionId: string, body: DesignConceptRequest) {
    if (!this.secret) throw new ApiError(503, 'DESIGN_CONCEPTS_UNAVAILABLE', 'Design concept persistence is not configured');
    let source: Awaited<ReturnType<typeof documentSource>>;
    try { source = await documentSource(repository, projectId, revisionId, false); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'DOCUMENT_SOURCE_UNVERIFIED')
        throw new ApiError(422, 'DESIGN_CONCEPT_SOURCE_UNVERIFIED', 'The revision identity or its acceptance QA could not be verified; no concept is produced', error.fieldErrors);
      throw error;
    }
    const context = await projectContext(repository, projectId);
    // Separate reads: the context's current revision must agree with the revision read, or the set would mix two project states.
    if ((context.currentRevision?.id ?? null) !== source.freshness.projectCurrentRevisionId)
      throw new ApiError(409, 'DESIGN_CONCEPT_READ_INCONSISTENT', 'The project changed while the concept inputs were read; retry');
    const request: NormalizedRequest = { scope: body.scope, text: body.text ?? null, alternatives: body.alternatives, spaceIds: body.spaceIds ?? null,
      useBrief: body.useBrief, referenceIds: body.referenceIds, generator: body.generator, variation: body.variation };

    const levels = [...source.model.levels].filter(l => l.kind === 'storey').sort((a, b) => a.index - b.index || (a.id < b.id ? -1 : 1));
    const order = new Map(levels.map((l, i) => [l.id, i]));
    let spaces: DesignConceptSet['inputs']['spaces'] = [];
    if (request.scope === 'INTERIOR') {
      const all = [...source.model.spaces].sort((a, b) => (order.get(a.levelId) ?? 1e6) - (order.get(b.levelId) ?? 1e6) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const byId = new Map(all.map(s => [s.id, s]));
      const unknown = (request.spaceIds ?? []).filter(id => !byId.has(id));
      if (unknown.length) throw new ApiError(422, 'DESIGN_CONCEPT_SPACE_INVALID', 'A requested space is not in this revision', { spaceIds: unknown.slice(0, 12) });
      const chosen = request.spaceIds ? all.filter(s => request.spaceIds!.includes(s.id)) : all.slice(0, DESIGN_LIMITS.spaces);
      if (!chosen.length) throw new ApiError(422, 'DESIGN_CONCEPT_NO_SPACES', 'The revision has no spaces to design');
      spaces = chosen.map(s => ({ spaceId: s.id, name: [...s.name].slice(0, 80).join(''), classification: [...s.classification].slice(0, 80).join(''), levelId: s.levelId }));
    } else if (!source.model.walls.some(w => w.classification === 'exterior'))
      throw new ApiError(422, 'DESIGN_CONCEPT_NO_EXTERIOR_WALLS', 'The revision has no walls classified as exterior');

    const active = new Map(context.references.map(r => [r.id, r]));
    const invalid = request.referenceIds.filter(id => !active.has(id));
    if (invalid.length) throw new ApiError(422, 'DESIGN_CONCEPT_REFERENCE_INVALID', 'A reference is not an active reference of this project', { referenceIds: invalid });
    const references = request.referenceIds.map(id => { const r = active.get(id)!;
      return { referenceId: r.id, purpose: r.purpose, displayName: r.displayName === null ? null : [...r.displayName].slice(0, 120).join(''), mediaType: r.mediaType,
        storedSha256: r.storedSha256, contentUsed: 'METADATA_ONLY' as const }; });
    const brief = request.useBrief && context.brief ? { stored: context.brief, ...briefExcerpt(context.brief.brief) } : null;

    const identity = { version: DESIGN_CONCEPT_VERSION, revisionId, modelHash: source.binding.modelHash, request, briefHash: brief?.stored.briefHash ?? null,
      references: references.map(r => ({ referenceId: r.referenceId, storedSha256: r.storedSha256 })) } as const;
    const inputHash = costHash(identity);
    const store = new DesignConceptRepository(repository);
    // Single flight: concurrent identical requests in this process share one lookup and one generation (one provider charge). The entry is
    // registered before the first await, so a peer either joins it or, once it has finished, finds its stored set.
    const key = `${userId}:${revisionId}:${inputHash}`;
    const pending = this.inflight.get(key);
    if (pending) return { ...(await pending), replayed: true };
    const work = (async () => {
      const prior = await store.lookup(projectId, revisionId, inputHash);
      if (prior.match) return prior.match;
      const generated = await this.generate({ request, revisionId, spaces, references, brief, levels: levels.map(l => ({ levelId: l.id, name: l.name })),
        providerSetsLast24h: prior.providerSetsLast24h });
      const set = assemble({ request, source, context, brief, references, spaces, identity, inputHash, generated });
      const input = { projectId, projectRevisionId: revisionId, conceptSet: set };
      return store.write(input, signProjectCommit(this.secret!, userId, DESIGN_ROOT, input));
    })();
    this.inflight.set(key, work);
    try { return await work; } finally { this.inflight.delete(key); }
  }

  private async generate(input: { request: NormalizedRequest; revisionId: string; spaces: DesignConceptSet['inputs']['spaces']; references: DesignConceptSet['inputs']['references'];
    brief: (ReturnType<typeof briefExcerpt> & { stored: unknown }) | null; levels: { levelId: string; name: string }[]; providerSetsLast24h: number }): Promise<Generated> {
    const { request } = input, capability = request.scope === 'INTERIOR' ? 'INTERIOR_DESIGN_CONCEPT' as const : 'EXTERIOR_DESIGN_CONCEPT' as const;
    const guard: GuardScope = { scope: request.scope, alternatives: request.alternatives, spaceIds: input.spaces.map(s => s.spaceId), referenceIds: request.referenceIds,
      briefFields: input.brief?.used ?? [] };
    const template = (status: 'TEMPLATE' | 'FALLBACK', extra: Partial<DesignConceptSet['provenance']> = {}): Generated => {
      const keywords = input.brief?.excerpt.styleKeywords ?? [];
      const outputs = request.scope === 'INTERIOR'
        ? interiorTemplates({ alternatives: request.alternatives, variation: request.variation, text: request.text, styleKeywords: keywords, spaces: input.spaces, spaceNotes: DESIGN_LIMITS.spaceNotes })
        : exteriorTemplates({ alternatives: request.alternatives, variation: request.variation, text: request.text, styleKeywords: keywords, facades: FACADES });
      return { outputs: guardAlternatives(outputs as (InteriorOutput | ExteriorOutput)[], guard) as Outputs, source: 'DETERMINISTIC_TEMPLATE',
        provenance: { generator: request.generator, status, capability, requestId: null, providerId: null, modelId: null, routingReason: null, fallbackPosition: null,
          fallbackReason: null, failures: [], requests: 0, attempts: [], usage: null, templateVersion: DESIGN_TEMPLATE_VERSION, guardVersion: DESIGN_GUARD_VERSION, ...extra } };
    };
    if (request.generator === 'TEMPLATE') return template('TEMPLATE');
    const fallback = (reason: NonNullable<DesignConceptSet['provenance']['fallbackReason']>, codes: AiFailureCode[], run?: AiTaskResult<Outputs>, requestId?: string) => {
      if (request.generator === 'PROVIDER' || !this.policy.deterministicFallback)
        throw new ApiError(503, 'DESIGN_CONCEPT_PROVIDER_UNAVAILABLE', 'No configured provider produced an acceptable concept; nothing was stored', { failures: codes.length ? codes : [reason] });
      return template('FALLBACK', { fallbackReason: reason, failures: codes, requestId: requestId ?? null, requests: run?.requests ?? 0, attempts: (run?.attempts ?? []).map(attemptRecord) });
    };
    if (input.providerSetsLast24h >= DESIGN_LIMITS.providerSetsPerOwnerPerDay) {
      if (request.generator === 'PROVIDER' || !this.policy.deterministicFallback) throw new ApiError(429, 'DESIGN_CONCEPT_QUOTA_EXCEEDED', 'The daily quota of provider-generated design concepts is exhausted; template concepts remain available');
      return template('FALLBACK', { fallbackReason: 'PROVIDER_QUOTA_EXHAUSTED' });
    }
    const requestId = randomUUID();
    const payload = conceptPayload({ scope: request.scope, alternatives: request.alternatives, brief: input.brief, references: input.references, spaces: input.spaces, levels: input.levels });
    let run: AiTaskResult<Outputs>;
    try {
      run = await this.orchestrator.run({ requestId, capability, text: request.text ?? '', context: payload, instructions: INSTRUCTIONS[request.scope],
        privacyClass: this.policy.privacyClass, maxOutputTokens: DESIGN_LIMITS.maxOutputTokens, timeoutMs: Math.min(this.policy.timeoutMs, DESIGN_LIMITS.timeoutMs),
        structuredOutput: true }, conceptTask(guard));
    } catch (error) {
      if (!(error instanceof AiProviderError)) throw error;
      if (error.code === 'PROVIDER_POLICY_REJECTED' && request.generator === 'PROVIDER')
        throw new ApiError(422, 'DESIGN_CONCEPT_INPUT_TOO_LARGE', 'The concept inputs exceed the provider context budget; select fewer spaces or shorten the text');
      return fallback('NO_ELIGIBLE_PROVIDER', [error.code], undefined, requestId);
    }
    if (!run.ok) return fallback(run.requests ? 'ALL_PROVIDERS_FAILED' : 'NO_ELIGIBLE_PROVIDER', failures(run.attempts), run, requestId);
    return { outputs: run.output, source: 'PROVIDER', provenance: { generator: request.generator, status: 'SUCCESS', capability, requestId, providerId: run.providerId,
      modelId: run.modelId, routingReason: run.position ? 'SECONDARY' : 'PREFERRED', fallbackPosition: run.position, fallbackReason: null, failures: failures(run.attempts),
      requests: run.requests, attempts: run.attempts.map(attemptRecord), usage: micro(run.usage), templateVersion: null, guardVersion: DESIGN_GUARD_VERSION } };
  }
}

function assemble(input: { request: NormalizedRequest; source: Awaited<ReturnType<typeof documentSource>>; context: Awaited<ReturnType<typeof projectContext>>;
  brief: ({ stored: NonNullable<Awaited<ReturnType<typeof projectContext>>['brief']> } & ReturnType<typeof briefExcerpt>) | null;
  references: DesignConceptSet['inputs']['references']; spaces: DesignConceptSet['inputs']['spaces']; identity: DesignConceptSet['inputs']['identity'];
  inputHash: string; generated: Generated }): DesignConceptSet {
  const { request, source, generated } = input, spaces = new Map(input.spaces.map(s => [s.spaceId, s]));
  const alternatives = (generated.outputs as (InteriorOutput | ExteriorOutput)[]).map((o, i) => {
    const alternativeId = `alt-${i + 1}` as 'alt-1' | 'alt-2' | 'alt-3';
    if ('finishes' in o) return { alternativeId, scope: 'INTERIOR' as const, title: o.title, summary: o.summary, styleKeywords: o.styleKeywords, palette: o.palette,
      finishes: o.finishes, lighting: o.lighting, basis: o.basis,
      spaces: o.spaces.map(s => ({ spaceId: s.spaceId, spaceName: spaces.get(s.spaceId)!.name, levelId: spaces.get(s.spaceId)!.levelId, note: s.note })) };
    return { alternativeId, scope: 'EXTERIOR' as const, title: o.title, summary: o.summary, styleKeywords: o.styleKeywords, palette: o.palette, landscapeNote: o.landscapeNote,
      basis: o.basis, facadeFinish: { presetId: o.facadePresetId, presetLabel: presetLabel(o.facadePresetId), facades: FACADES.filter(f => o.facades.includes(f)), rationale: o.facadeRationale, appearanceOnly: true as const },
      proposedOperation: proposedOperation(source.binding.revisionId, o.facadePresetId, o.facades) };
  });
  const limitations = [...LIMITATIONS.common, generated.source === 'PROVIDER' ? LIMITATIONS.provider : LIMITATIONS.template, ...(request.scope === 'EXTERIOR' ? [LIMITATIONS.exterior] : [])];
  const body = {
    conceptSetVersion: DESIGN_CONCEPT_VERSION, scope: request.scope, binding: source.binding, request,
    inputs: { context: { contextVersion: input.context.contextVersion, contextHash: input.context.contextHash },
      brief: input.brief ? { version: input.brief.stored.version, briefHash: input.brief.stored.briefHash, provenance: 'USER_STATED_NOT_VERIFIED' as const,
        fieldsUsed: input.brief.used, fieldsWithheld: BRIEF_WITHHELD.map(w => ({ ...w })) } : null,
      references: input.references, spaces: input.spaces, identity: input.identity },
    source: generated.source, alternatives, provenance: generated.provenance,
    assurance: { status: 'ADVISORY_UNVERIFIED' as const, note: ASSURANCE_NOTE }, claims: { ...DESIGN_CLAIMS }, limitations, inputHash: input.inputHash,
  };
  const parsed = DesignConceptSetSchema.omit({ contentHash: true }).parse(body);
  return DesignConceptSetSchema.parse({ ...parsed, contentHash: costHash(parsed) });
}

const currency = (revisionId: string, projectCurrentRevisionId: string | null) =>
  ({ status: revisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'HISTORICAL' as const, conceptRevisionId: revisionId, projectCurrentRevisionId });
export function conceptDetail(stored: Awaited<ReturnType<DesignConceptRepository['read']>>) {
  return { ...stored.summary, conceptSet: stored.conceptSet, currency: currency(stored.summary.projectRevisionId, stored.projectCurrentRevisionId), replayed: stored.replayed };
}
export async function readDesignConcept(repository: Repository, projectId: string, revisionId: string, conceptSetId: string, requireCurrent: boolean) {
  const stored = await new DesignConceptRepository(repository).read(projectId, revisionId, conceptSetId);
  if (stored.summary.projectRevisionId !== revisionId) throw new ApiError(404, 'DESIGN_CONCEPT_NOT_FOUND', 'Design concept set not found');
  const detail = conceptDetail(stored);
  if (requireCurrent && detail.currency.status !== 'CURRENT') throw new ApiError(409, 'DESIGN_CONCEPT_SOURCE_STALE', 'The design concept set belongs to a superseded revision');
  return detail;
}
export async function listDesignConcepts(repository: Repository, projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new DesignConceptRepository(repository).list(projectId, revisionId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.projectRevisionId, projectCurrentRevisionId) })), nextCursor };
}
