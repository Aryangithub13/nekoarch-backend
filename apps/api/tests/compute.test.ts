import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/errors.js';
import { parseEnv } from '../src/config/env.js';
import { COMPUTE_CLAIMS, ComputePolicySchema, PROVIDERS, type ComputeQuote } from '../src/compute/contracts.js';
import { quoteSignature, verifyConsent } from '../src/compute/gateway.js';

const secret = randomBytes(32).toString('hex'), userId = randomUUID(), projectId = randomUUID(), revisionId = randomUUID();
function signed(overrides: Partial<ComputeQuote> = {}): ComputeQuote {
  const content: Omit<ComputeQuote, 'quoteHash'> = { quoteVersion: 'compute-quote-v1', gatewayVersion: 'compute-gateway-v1', projectId, kind: 'SCENE_COMPILE',
    request: { kind: 'SCENE_COMPILE', revisionId }, inputHash: 'a'.repeat(64), placement: 'LOCAL', provider: { providerId: 'local-pool', type: 'LOCAL_POOL' },
    source: { revisionId, modelHash: 'b'.repeat(64) }, algorithm: { engine: 'scene-compiler', version: 'scene-compiler-v1' },
    execution: { maxWallMs: 1000, poolSize: 1, queueLimit: 8, maxAttempts: 3, maxActivePerProject: 4, maxActivePerOwner: 2, maxConsentedPerOwnerPerDay: 50, requestBytes: 65_536 },
    cost: { costClass: 'FREE', ceilingMinor: 0, currency: 'INR', basis: 'LOCAL_POOL_NO_EXTERNAL_SPEND' }, dataTransfer: 'NONE', runtime: { node: 'v22', reproducibility: 'NOT_CLAIMED' },
    issuedAt: '2026-10-13T00:00:00.000Z', expiresAt: '2026-10-13T00:15:00.000Z', authorization: 'NOT_AUTHORIZED_UNTIL_CONSENT', claims: { ...COMPUTE_CLAIMS }, ...overrides };
  return { ...content, quoteHash: quoteSignature(secret, userId, content) };
}
const consent = (quote: ComputeQuote) => ({ quote, consent: { quoteHash: quote.quoteHash, acceptQuote: true as const, acceptLocalExecution: true as const } });
const code = (fn: () => void) => { try { fn(); return null; } catch (error) { return error instanceof ApiError ? error.code : 'UNTYPED'; } };
const during = new Date('2026-10-13T00:05:00.000Z');

describe('Phase 36 compute policy', () => {
  it('defaults to local execution only, conservative limits, and both inspected kinds', () => {
    expect(ComputePolicySchema.parse({})).toEqual({ policyVersion: 'compute-policy-v1', remoteExecution: 'DISABLED', kinds: ['SCENE_COMPILE', 'OPTIMIZATION_STUDY'],
      quoteTtlSeconds: 900, maxConsentedPerOwnerPerDay: 50, maxActivePerOwner: 2 });
  });
  it.each([[{ remoteExecution: 'ENABLED' }], [{ kinds: ['REVISION_EXECUTE'] }], [{ kinds: [] }], [{ maxActivePerOwner: 9 }], [{ quoteTtlSeconds: 5 }], [{ endpoint: 'https://x' }]])(
    'rejects %j (fail closed at startup)', policy => {
      expect(ComputePolicySchema.safeParse(policy).success).toBe(false);
      expect(() => parseEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'test', COMPUTE_POLICY: JSON.stringify(policy) })).toThrow(/Invalid compute policy/);
    });
  it('lists the remote provider as disabled, with no endpoint or credential', () => {
    expect(PROVIDERS.find(p => p.placement === 'REMOTE')).toMatchObject({ status: 'DISABLED' });
    expect(PROVIDERS.every(p => !('endpoint' in p) && !('apiKeyEnv' in p))).toBe(true);
  });
});

describe('Phase 36 quote signature and consent', () => {
  it('accepts exactly the issued quote for its user, project and consent', () => {
    expect(code(() => verifyConsent(secret, userId, projectId, consent(signed()), during))).toBeNull();
  });
  it.each<[string, (q: ComputeQuote) => ComputeQuote]>([
    ['request', q => ({ ...q, request: { kind: 'SCENE_COMPILE', revisionId: randomUUID() } })],
    ['cost ceiling', q => ({ ...q, execution: { ...q.execution, maxActivePerOwner: 8 } })],
    ['expiry', q => ({ ...q, expiresAt: '2099-01-01T00:00:00.000Z' })],
    ['model hash', q => ({ ...q, source: { ...q.source, modelHash: 'c'.repeat(64) } })],
  ])('detects a changed %s', (_name, change) => {
    const q = change(signed());
    expect(code(() => verifyConsent(secret, userId, projectId, consent(q), during))).toBe('COMPUTE_QUOTE_INVALID');
  });
  it('binds the quote to the user, the project and the server secret', () => {
    expect(code(() => verifyConsent(secret, randomUUID(), projectId, consent(signed()), during))).toBe('COMPUTE_QUOTE_INVALID');
    expect(code(() => verifyConsent(secret, userId, randomUUID(), consent(signed()), during))).toBe('COMPUTE_QUOTE_INVALID');
    expect(code(() => verifyConsent(randomBytes(32).toString('hex'), userId, projectId, consent(signed()), during))).toBe('COMPUTE_QUOTE_INVALID');
  });
  it('refuses an expired quote and a consent that names another quote', () => {
    expect(code(() => verifyConsent(secret, userId, projectId, consent(signed()), new Date('2026-10-13T00:15:00.000Z')))).toBe('COMPUTE_QUOTE_EXPIRED');
    const q = signed();
    expect(code(() => verifyConsent(secret, userId, projectId, { quote: q, consent: { ...consent(q).consent, quoteHash: 'd'.repeat(64) } }, during))).toBe('COMPUTE_CONSENT_MISMATCH');
  });
});
