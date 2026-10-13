import { AiPolicySchema, AiProviderError, type AiAttempt, type AiPolicy } from '../../contracts/ai-orchestration.js';
import { validateInferenceEndpoint } from '../conversation-provider.js';
import { InterpreterProviderError } from '../interpreter-provider.js';
import { AiOrchestrator } from './orchestrator.js';
import type { AiAdapter } from './registry.js';
import { localCompletion, parseCompletion, remoteCompletion, validateCredential, validateRemoteEndpoint } from './transport.js';

/**
 * Phase 39: OpenAI-compatible adapters for typed tasks. The system message is the task's server-owned instructions; the user message is
 * `{ text, data }` JSON, so caller and document text can only ever be data. Endpoints and credentials are validated before the first request
 * and stay in the transport; nothing provider-specific reaches a route or a service.
 */
export function taskAdapters(policy: AiPolicy, credentials: Readonly<Record<string, string>>): Map<string, AiAdapter> {
  const adapters = new Map<string, AiAdapter>();
  for (const p of policy.providers) {
    if (!p.enabled) continue;
    if (!p.endpoint) throw new AiProviderError('PROVIDER_POLICY_REJECTED');
    const key = p.apiKeyEnv ? credentials[p.apiKeyEnv] : undefined;
    if (p.apiKeyEnv && !key) throw new AiProviderError('PROVIDER_AUTH_FAILED');
    validateCredential(key);
    let local: string | null = null, remote: URL | null = null;
    if (p.type === 'LOCAL_OPENAI_COMPATIBLE') {
      try { local = validateInferenceEndpoint(p.endpoint); } catch (error) { if (error instanceof InterpreterProviderError) throw new AiProviderError('PROVIDER_POLICY_REJECTED'); throw error; }
    } else remote = validateRemoteEndpoint(p.endpoint, policy.allowedRemoteHosts);
    adapters.set(p.providerId, { async execute(r, m, signal) {
      if (!('instructions' in r)) throw new AiProviderError('CAPABILITY_UNSUPPORTED');
      const body = JSON.stringify({ model: m.modelId, stream: false, temperature: 0, max_tokens: Math.min(r.maxOutputTokens, m.maxOutputTokens), response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: r.instructions }, { role: 'user', content: JSON.stringify({ text: r.text, data: r.context }) }] });
      return parseCompletion(local ? await localCompletion(local, body, key, signal) : await remoteCompletion(remote!, body, key, signal));
    } });
  }
  return adapters;
}

/**
 * The orchestrator for typed tasks, from the same server-owned AI_ROUTING_CONFIG. `disabled` turns provider inference off for every AI module.
 * Its health, concurrency and request-rate state are process-local and belong to this instance (Phase 21 limits are per process).
 */
export function createTaskOrchestrator(input: { policy: AiPolicy; credentials: Readonly<Record<string, string>>; disabled: boolean; adapters?: ReadonlyMap<string, AiAdapter>;
  observe?: (event: AiAttempt & { requestId: string }) => void }) {
  const policy = AiPolicySchema.parse(input.policy);
  if (input.disabled) policy.providers = [];
  return new AiOrchestrator(policy, input.adapters ?? taskAdapters(policy, input.credentials), input.observe);
}
