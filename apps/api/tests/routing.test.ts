import { describe, expect, it } from 'vitest';
import { AiPolicySchema } from '../src/contracts/ai-orchestration.js';
import { CAPABILITY_IDS, RoutingRequestSchema } from '../src/routing/contracts.js';
import { capabilityRegistry, effectivePrivacy, routingDecision } from '../src/routing/registry.js';
import { SERVICES } from '../src/services/overview-service.js';
import { CONTRACTS } from '../../../test-support/openapi.js';

const P = '00000000-0000-4000-8000-0000000000dd';
const policy = (patch: Record<string, unknown> = {}) => AiPolicySchema.parse({ privacyClass: 'REMOTE_ALLOWED', allowedRemoteHosts: ['api.example.test'], providers: [
  { providerId: 'local-llm', type: 'LOCAL_OPENAI_COMPATIBLE', enabled: true, endpoint: 'http://127.0.0.1:8080/v1', capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION', 'INTERIOR_DESIGN_CONCEPT'],
    models: [{ modelId: 'local-model', capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION', 'INTERIOR_DESIGN_CONCEPT'] }] },
  { providerId: 'remote-llm', type: 'REMOTE_OPENAI_COMPATIBLE', enabled: true, endpoint: 'https://api.example.test/v1', apiKeyEnv: 'AI_PROVIDER_REMOTE_API_KEY',
    capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION'], models: [{ modelId: 'remote-model', capabilities: ['ARCHITECTURAL_INTENT_EXTRACTION'], privacyClass: 'REMOTE_ALLOWED',
      costClass: 'METERED', inputUsdPerMillion: 1, outputUsdPerMillion: 2 }] }], ...patch });
const decide = (body: unknown, p = policy()) => routingDecision(p, P, RoutingRequestSchema.parse(body));

describe('B43 capability registry', () => {
  it('lists every roadmap capability with its real implementation, and never exposes endpoints or credential names', () => {
    const r = capabilityRegistry(policy());
    expect(r.capabilities.map(c => c.capabilityId)).toEqual([...CAPABILITY_IDS]);
    expect(r.capabilities.find(c => c.capabilityId === 'image.exterior')).toMatchObject({ status: 'UNSUPPORTED', implementation: { kind: 'NONE' } });
    expect(r.capabilities.every(c => c.userSuppliedCredentials === 'UNSUPPORTED')).toBe(true);
    const text = JSON.stringify(r);
    for (const secret of ['127.0.0.1', 'api.example.test', 'AI_PROVIDER_REMOTE_API_KEY', 'endpoint', 'apiKeyEnv']) expect(text).not.toContain(secret);
    // Remote and metered: ineligible under the default policy (metering not allowed).
    expect(r.capabilities.find(c => c.capabilityId === 'llm.intent')!.providers).toEqual([
      { providerId: 'local-llm', placement: 'LOCAL', enabled: true, costClasses: ['FREE'], eligible: true, ineligibleReason: null },
      { providerId: 'remote-llm', placement: 'REMOTE', enabled: true, costClasses: ['METERED'], eligible: false, ineligibleReason: 'METERED_NOT_ALLOWED' }]);
  });
  it('names only discovery services and registered routes', () => {
    const services = new Set(SERVICES.map(s => s.serviceId)), routes = new Set(Object.keys(CONTRACTS).map(k => k.split(' ')[1]));
    for (const c of capabilityRegistry(policy()).capabilities) {
      if (c.implementation.serviceId) expect(services, c.capabilityId).toContain(c.implementation.serviceId);
      if (c.implementation.route) expect(routes, c.capabilityId).toContain(c.implementation.route);
    }
  });
});

describe('B43 routing decisions: bounded, inspectable, privacy-narrowing', () => {
  it('gate: a façade-only request invokes only the scene compiler; every image, solver and provider capability is NOT_TARGETED', () => {
    const d = decide({ targetScopes: ['FACADE_APPEARANCE'] });
    expect(d.invoke.map(i => [i.capabilityId, i.execution, i.providerIds])).toEqual([['geometry.3d', 'LOCAL_DETERMINISTIC', []]]);
    expect(d.notInvoked.map(n => n.reason)).toEqual(Array(CAPABILITY_IDS.length - 1).fill('NOT_TARGETED'));
    expect([d.quote.externalCostUsd, d.executed, d.refused]).toEqual([0, false, []]);
    expect(d.staleIfChanged).toEqual(['APPEARANCE_VARIANT', 'SCENE_3D']);
  });
  it('refuses an unsupported target instead of substituting another capability', () => {
    const d = decide({ targetScopes: ['FACADE_APPEARANCE', 'EXTERIOR_RENDER'] });
    expect(d.refused).toEqual([{ scope: 'EXTERIOR_RENDER', code: 'CAPABILITY_UNSUPPORTED', detail: expect.stringContaining('NO_RENDER_PROVIDER') }]);
    expect(d.invoke.map(i => i.capabilityId)).toEqual(['geometry.3d']);
  });
  it('only narrows the server policy: privacy and metering requests can lower, never raise, what is allowed', () => {
    expect([effectivePrivacy('LOCAL_ONLY', 'REMOTE_ALLOWED'), effectivePrivacy('REMOTE_ALLOWED', 'LOCAL_ONLY')]).toEqual(['LOCAL_ONLY', 'LOCAL_ONLY']);
    const local = decide({ targetScopes: ['INTENT_TEXT'], privacyClass: 'LOCAL_ONLY', allowMetered: true }, policy({ allowMetered: true }));
    expect(local.invoke[0]).toMatchObject({ capabilityId: 'llm.intent', providerIds: ['local-llm'], execution: 'PROVIDER_THEN_DETERMINISTIC_FALLBACK' });
    expect(local.quote.externalCostUsd).toBe(0);
    const remote = decide({ targetScopes: ['INTENT_TEXT'], privacyClass: 'REMOTE_ALLOWED', allowMetered: true }, policy({ allowMetered: true }));
    expect(remote.invoke[0]!.providerIds).toEqual(['local-llm', 'remote-llm']);
    expect(remote.quote).toMatchObject({ externalCostUsd: null, meteredProvidersEligible: 1 }); // never a guessed price
    const notAllowed = decide({ targetScopes: ['INTENT_TEXT'], privacyClass: 'REMOTE_ALLOWED', allowMetered: true }); // server policy forbids metering
    expect([notAllowed.effectiveAllowMetered, notAllowed.invoke[0]!.providerIds]).toEqual([false, ['local-llm']]);
  });
  it('falls back to the deterministic service when no provider is configured, and is deterministic', () => {
    const none = AiPolicySchema.parse({});
    const d = routingDecision(none, P, RoutingRequestSchema.parse({ targetScopes: ['INTENT_TEXT', 'QUANTITIES', 'COST'] }));
    expect(d.invoke.map(i => [i.capabilityId, i.execution])).toEqual([['llm.intent', 'LOCAL_DETERMINISTIC'], ['cost.rate_source', 'LOCAL_DETERMINISTIC'],
      ['quantity.takeoff', 'LOCAL_DETERMINISTIC']]);
    expect(routingDecision(none, P, RoutingRequestSchema.parse({ targetScopes: ['INTENT_TEXT', 'QUANTITIES', 'COST'] })).decisionHash).toBe(d.decisionHash);
  });
});
