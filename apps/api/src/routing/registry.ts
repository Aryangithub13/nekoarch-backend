import { costHash } from '@designflow/boq-cost';
import type { AiCapability, AiPolicy } from '../contracts/ai-orchestration.js';
import { CAPABILITY_IDS, CapabilityRegistrySchema, ROUTING_VERSION, RoutingDecisionSchema, type CapabilityEntry, type CapabilityId, type RoutingDecision, type RoutingRequest }
  from './contracts.js';

type Privacy = AiPolicy['privacyClass'];
type Static = Omit<CapabilityEntry, 'providers' | 'userSuppliedCredentials'>;
const R = '/api/projects/:projectId', V = `${R}/revisions/:revisionId`;

/**
 * Each roadmap capability and what implements it here. Status is the honest one: PARTIAL means a bounded engine exists with stated limits; ADVISORY
 * means output is never geometry or an engineering result; UNSUPPORTED means no implementation (a request for it is refused, never substituted).
 */
const STATIC: Readonly<Record<CapabilityId, Static>> = {
  'llm.intent': { capabilityId: 'llm.intent', status: 'AVAILABLE', title: 'Architectural intent extraction from text',
    implementation: { kind: 'LOCAL_WITH_OPTIONAL_PROVIDER', serviceId: null, route: `${R}/requirements/interpret`, aiCapability: 'ARCHITECTURAL_INTENT_EXTRACTION' },
    dataEgress: 'TASK_TEXT_TO_CONFIGURED_PROVIDER', region: 'PROVIDER_REGION_NOT_DECLARED', costBasis: 'METERED_PROVIDER_IF_ALLOWED',
    outputCheck: 'Strict schema plus the deterministic interpretation rules; unsupported or contradictory requests are surfaced, never resolved by the provider',
    fallback: 'Deterministic local parser (no provider)', limitations: 'Requirements up to two floors and 24 rooms' },
  'image.reference': { capabilityId: 'image.reference', status: 'PARTIAL', title: 'Reference image intake',
    implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'REFERENCE_LIBRARY', route: `${R}/references`, aiCapability: null },
    dataEgress: 'NONE', region: 'SERVER_LOCAL', costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'Structural inspection of PNG, JPEG, WebP and PDF; metadata stripped',
    fallback: null, limitations: 'Metadata only: no OCR, vision, scale detection or plan extraction' },
  'image.exterior': { capabilityId: 'image.exterior', status: 'UNSUPPORTED', title: 'Exterior image or render generation',
    implementation: { kind: 'NONE', serviceId: null, route: null, aiCapability: 'EXTERIOR_VISUALIZATION' }, dataEgress: 'NONE', region: 'SERVER_LOCAL', costBasis: 'NOT_AVAILABLE',
    outputCheck: 'Not applicable', fallback: null, limitations: 'NO_RENDER_PROVIDER: no render provider is implemented' },
  'interior.design': { capabilityId: 'interior.design', status: 'PARTIAL', title: 'Interior design: catalog finishes and advisory concepts',
    implementation: { kind: 'LOCAL_WITH_OPTIONAL_PROVIDER', serviceId: 'SPECIALISTS', route: `${R}/specialists/:module/requests`, aiCapability: 'INTERIOR_DESIGN_CONCEPT' },
    dataEgress: 'TASK_TEXT_TO_CONFIGURED_PROVIDER', region: 'PROVIDER_REGION_NOT_DECLARED', costBasis: 'METERED_PROVIDER_IF_ALLOWED',
    outputCheck: 'Finishes: catalog schema and the 0029 finish-only SQL lock. Concepts: output guard refusing dimensions, claims and unknown entities',
    fallback: 'Deterministic concept templates', limitations: 'No layout edits or furnishings; concepts are advisory text' },
  'geometry.3d': { capabilityId: 'geometry.3d', status: 'AVAILABLE', title: '3D scene (GLB) of a revision',
    implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'SCENE_3D', route: `${V}/scene/artifacts`, aiCapability: null }, dataEgress: 'NONE', region: 'SERVER_LOCAL',
    costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'glTF validation and scene-to-BIM binding checks on the main thread', fallback: null,
    limitations: 'Bounded BIM profile (two storeys); no generated 3D assets beyond the model' },
  'cad.ifc': { capabilityId: 'cad.ifc', status: 'AVAILABLE', title: 'IFC export', implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'BIM', route: `${V}/bim/export.ifc`, aiCapability: null },
    dataEgress: 'NONE', region: 'SERVER_LOCAL', costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'BIM validation before export', fallback: null, limitations: 'Bounded BIM profile' },
  'structural.solve': { capabilityId: 'structural.solve', status: 'PARTIAL', title: 'Structural analysis',
    implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'STRUCTURAL_ANALYSIS', route: `${V}/structural/analyses`, aiCapability: null }, dataEgress: 'NONE', region: 'SERVER_LOCAL',
    costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'Independent result validation of the linear-static solve', fallback: null,
    limitations: 'Linear static of a supplied frame only; always REQUIRES_REVIEW; no validated design, wind or seismic solver' },
  'environmental.simulate': { capabilityId: 'environmental.simulate', status: 'PARTIAL', title: 'Environmental analysis',
    implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'ENVIRONMENTAL_ANALYSIS', route: `${V}/environmental/analyses`, aiCapability: null }, dataEgress: 'NONE',
    region: 'SERVER_LOCAL', costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'Schema and range validation of every result', fallback: null,
    limitations: 'Screening-level geometric analyses; not a validated energy or daylight simulation' },
  'cost.rate_source': { capabilityId: 'cost.rate_source', status: 'PARTIAL', title: 'Cost rates', implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'BOQ_COST',
    route: `${V}/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates`, aiCapability: null }, dataEgress: 'NONE', region: 'SERVER_LOCAL',
  costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'Versioned rate books; unpriced items are never priced at zero', fallback: null,
  limitations: 'Synthetic sample rate books only; no sourced regional rates' },
  'report.compose': { capabilityId: 'report.compose', status: 'AVAILABLE', title: 'Evidence and documentation',
    implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'EVIDENCE_PACKAGES', route: `${V}/evidence-packages`, aiCapability: null }, dataEgress: 'NONE', region: 'SERVER_LOCAL',
    costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'Signed SQL write recomputes bindings and hashes', fallback: null, limitations: 'Provenance only; never a review or certification' },
  'quantity.takeoff': { capabilityId: 'quantity.takeoff', status: 'AVAILABLE', title: 'Quantity takeoff and construction quantities',
    implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'QUANTITY_TAKEOFF', route: `${V}/takeoffs`, aiCapability: null }, dataEgress: 'NONE', region: 'SERVER_LOCAL',
    costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'Deterministic decimal engine; input fingerprint bound to the revision', fallback: null, limitations: 'Bounded entity counts' },
  'geometry.verify': { capabilityId: 'geometry.verify', status: 'AVAILABLE', title: 'Independent geometry verification',
    implementation: { kind: 'LOCAL_DETERMINISTIC', serviceId: 'COMPLEX_VERIFICATION', route: `${V}/verification`, aiCapability: null }, dataEgress: 'NONE', region: 'SERVER_LOCAL',
    costBasis: 'LOCAL_NO_EXTERNAL_COST', outputCheck: 'Exact integer geometry, independent of the generator', fallback: null, limitations: 'Exact unions for rectilinear rings only' },
};

/** Narrowing only: a request may lower privacy and refuse metering; it can never widen the server policy. */
const ORDER: readonly Privacy[] = ['LOCAL_ONLY', 'PUBLIC_NON_SENSITIVE', 'REMOTE_ALLOWED'];
export const effectivePrivacy = (server: Privacy, requested: Privacy): Privacy => ORDER[Math.min(ORDER.indexOf(server), ORDER.indexOf(requested))]!;

/**
 * Policy eligibility of each configured provider for one capability: the same gates as the orchestrator (enabled, capability, privacy, metering),
 * without live circuit health or request size, which only a real request can decide. Endpoints and credential names are never exposed.
 */
export function providersFor(policy: AiPolicy, capability: AiCapability | null, privacy: Privacy, allowMetered: boolean) {
  if (!capability) return [];
  return policy.providers.filter(p => p.capabilities.includes(capability)).map(p => {
    const models = p.models.filter(m => m.enabled && m.capabilities.includes(capability));
    const remote = p.type === 'REMOTE_OPENAI_COMPATIBLE';
    const usable = models.filter(m => (!remote || (privacy !== 'LOCAL_ONLY' && m.privacyClass !== 'LOCAL_ONLY')) && (m.costClass !== 'METERED' || allowMetered));
    const reason = !p.enabled ? 'PROVIDER_DISABLED' : !models.length ? 'MODEL_UNAVAILABLE' : !usable.length ? (remote && privacy === 'LOCAL_ONLY' ? 'PRIVACY_LOCAL_ONLY' : 'METERED_NOT_ALLOWED') : null;
    return { providerId: p.providerId, placement: remote ? 'REMOTE' as const : 'LOCAL' as const, enabled: p.enabled, costClasses: [...new Set(models.map(m => m.costClass))],
      eligible: reason === null, ineligibleReason: reason, metered: usable.some(m => m.costClass === 'METERED') };
  }).sort((a, b) => a.providerId.localeCompare(b.providerId)).slice(0, 8);
}

export function capabilityRegistry(policy: AiPolicy) {
  return CapabilityRegistrySchema.parse({ routingVersion: ROUTING_VERSION, defaultPrivacyClass: policy.privacyClass, allowMetered: policy.allowMetered,
    capabilities: CAPABILITY_IDS.map(id => ({ ...STATIC[id], userSuppliedCredentials: 'UNSUPPORTED',
      providers: providersFor(policy, STATIC[id].implementation.aiCapability, policy.privacyClass, policy.allowMetered).map(({ metered: _metered, ...p }) => p) })),
    credentials: { userSupplied: 'UNSUPPORTED', reason: 'No encrypted per-user secret storage, rotation or billing separation is implemented; provider credentials are server '
      + 'environment variables referenced by name only and are never returned' } });
}

/** Target → the minimal capabilities it needs, and the outputs a change to it makes stale (B37 whole-model invalidation applies to model changes). */
const TARGETS: Record<RoutingRequest['targetScopes'][number], { needs: CapabilityId[]; stale: string[] }> = {
  FACADE_APPEARANCE: { needs: ['geometry.3d'], stale: ['APPEARANCE_VARIANT', 'SCENE_3D'] },
  INTERIOR_FINISHES: { needs: ['interior.design'], stale: ['QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'SCENE_3D', 'CONSTRUCTION_DOCUMENTS'] },
  FLOOR_PLAN: { needs: ['llm.intent', 'geometry.verify'], stale: ['every model-bound output (B37 whole-model invalidation)'] },
  STRUCTURE: { needs: ['structural.solve'], stale: ['STRUCTURAL_ANALYSIS', 'ENGINEERING_ASSESSMENT'] },
  QUANTITIES: { needs: ['quantity.takeoff'], stale: ['CONSTRUCTION_CALCULATION', 'BOQ_COST'] },
  COST: { needs: ['cost.rate_source'], stale: [] },
  ENVIRONMENT: { needs: ['environmental.simulate'], stale: [] },
  SCENE_3D: { needs: ['geometry.3d'], stale: [] },
  IFC_EXPORT: { needs: ['cad.ifc'], stale: [] },
  EVIDENCE_REPORT: { needs: ['report.compose'], stale: [] },
  INTENT_TEXT: { needs: ['llm.intent'], stale: [] },
  EXTERIOR_RENDER: { needs: ['image.exterior'], stale: [] },
  INTERIOR_RENDER: { needs: ['image.exterior'], stale: [] },
  REFERENCE_IMAGE: { needs: ['image.reference'], stale: [] },
};

/**
 * The routing dry run. Bounded by construction: only capabilities a named target needs are invoked; every other capability is listed as
 * NOT_TARGETED. An unsupported target is refused, never served by a different capability. Deterministic for (policy, request).
 */
export function routingDecision(policy: AiPolicy, projectId: string, request: RoutingRequest): RoutingDecision {
  const privacy = effectivePrivacy(policy.privacyClass, request.privacyClass), allowMetered = policy.allowMetered && request.allowMetered;
  const wanted = new Map<CapabilityId, RoutingRequest['targetScopes']>();
  for (const scope of request.targetScopes) for (const c of TARGETS[scope].needs) wanted.set(c, [...(wanted.get(c) ?? []), scope]);
  const invoke: RoutingDecision['invoke'] = [], notInvoked: RoutingDecision['notInvoked'] = [], refused: RoutingDecision['refused'] = [];
  let metered = 0;
  for (const id of CAPABILITY_IDS) {
    const entry = STATIC[id], scopes = wanted.get(id);
    if (!scopes) { notInvoked.push({ capabilityId: id, reason: 'NOT_TARGETED', detail: 'No requested target needs it' }); continue; }
    if (entry.status === 'UNSUPPORTED') {
      notInvoked.push({ capabilityId: id, reason: 'UNSUPPORTED', detail: entry.limitations });
      for (const s of scopes) refused.push({ scope: s, code: 'CAPABILITY_UNSUPPORTED', detail: `${id}: ${entry.limitations}` });
      continue;
    }
    const providers = providersFor(policy, entry.implementation.aiCapability, privacy, allowMetered).filter(p => p.eligible);
    metered += providers.filter(p => p.metered).length;
    const kind = entry.implementation.kind;
    if (kind === 'CONFIGURED_PROVIDER' && !providers.length) {
      notInvoked.push({ capabilityId: id, reason: 'NO_ELIGIBLE_PROVIDER', detail: 'No configured provider passes the privacy and metering policy' });
      for (const s of scopes) refused.push({ scope: s, code: 'NO_ELIGIBLE_PROVIDER', detail: id });
      continue;
    }
    invoke.push({ capabilityId: id, forScopes: scopes, providerIds: providers.map(p => p.providerId), route: entry.implementation.route,
      execution: kind === 'LOCAL_DETERMINISTIC' || !providers.length ? 'LOCAL_DETERMINISTIC' : kind === 'CONFIGURED_PROVIDER' ? 'PROVIDER_ONLY' : 'PROVIDER_THEN_DETERMINISTIC_FALLBACK',
      reason: providers.length && kind !== 'LOCAL_DETERMINISTIC' ? `Eligible providers in priority order, then ${entry.fallback ?? 'no fallback'}`
        : 'Deterministic local service: no data leaves the server' });
  }
  const staleIfChanged = [...new Set(request.targetScopes.flatMap(s => TARGETS[s].stale))].slice(0, 24);
  const body = { routingVersion: ROUTING_VERSION, projectId, targetScopes: request.targetScopes, effectivePrivacyClass: privacy, effectiveAllowMetered: allowMetered,
    invoke, notInvoked, refused, staleIfChanged,
    quote: { externalCostUsd: metered ? null : 0 as const, meteredProvidersEligible: metered, basis: metered
      ? 'A metered provider is eligible; its cost is unknown until token counts exist and is never estimated here' : 'Only local services or free providers are eligible' },
    executed: false as const };
  return RoutingDecisionSchema.parse({ ...body, decisionHash: costHash(body) });
}
