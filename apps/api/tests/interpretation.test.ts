import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { interpretationCorpus } from '../../../test-support/interpretation-corpus.js';
import { interpretRequirements } from '../src/ai/architectural-interpreter.js';
import { fallbackProvider, parseFallback } from '../src/ai/fallback-parser.js';
import { InterpreterProviderError, type ArchitecturalInterpreterProvider } from '../src/ai/interpreter-provider.js';
import { NaturalLanguageDesignRequestSchema, IntentCandidateSchema, InterpretationResultSchema, ProviderFailureCodeSchema } from '../src/contracts/requirement-interpretation.js';
import { requirementsHash } from '../src/lib/generation-identity.js';
import { GenerateRevisionRequestSchema } from '../src/contracts/projects.js';
import { normalizeBlueprintRequirements } from '@designflow/generator';

const interpret = (text: string, extras = {}) => interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text, ...extras }));
const valid = { site: { width: '30', depth: '50', unit: 'ft' }, bedrooms: 3, floors: 2 };
const mockProvider = (raw: unknown): ArchitecturalInterpreterProvider => ({ ...fallbackProvider, kind: 'fake', model: 'fixture-v1', path: 'provider', interpret: vi.fn(async () => raw) });

describe('free bounded interpretation corpus', () => {
  it.each(interpretationCorpus)('%s', async (_name, text, status) => {
    const r = await interpret(text); expect(r.status, JSON.stringify(r)).toBe(status);
    if (r.status === 'READY') expect(GenerateRevisionRequestSchema.safeParse({ requirements: r.structuredRequirements }).success).toBe(true);
    else expect(r.structuredRequirements).toBeNull();
    expect(InterpretationResultSchema.safeParse(r).success).toBe(true);
  });
  it.each([
    ['30x50 ft 3BHK', 9144, 15240], ['30 feet by 50 feet 3BHK', 9144, 15240],
    ['9m × 15m 3BHK', 9000, 15000], ['9000 mm x 15000 mm 3BHK', 9000, 15000],
    ['30ft x 15m 3BHK', 9144, 15000], ['9.0005m x 15.0005m 1BHK', 9001, 15001],
  ])('uses exact shared conversion for %s', async (text, w, d) => {
    const r = await interpret(String(text)); expect(r.structuredRequirements?.site.boundary[2]).toEqual({ x: w, z: d });
  });
  it('uses NFKC Unicode normalization and never uses locale to silently assume units', async () => {
    expect((await interpret(' ３０×５０ ft ３BHK ')).status).toBe('READY');
    expect((await interpret('30x50 3BHK', { locale: 'en-IN' })).unresolvedQuestions.map(q => q.field)).toContain('site.unit');
  });
  it('normalizes equivalent English and Hinglish with explicit unitsHint', async () => {
    const english = await interpret('30x50 ft plot, one bedroom downstairs and two bedrooms upstairs, parking and open kitchen');
    const hinglish = await interpret('30x50 ka plot hai, neeche ek bedroom aur parking chahiye, upar 2 bedroom aur open kitchen chahiye.', { unitsHint: 'ft', locale: 'hi-Latn' });
    expect(english.status).toBe('READY'); expect(hinglish.status).toBe('READY');
    expect(hinglish.structuredRequirements).toEqual(english.structuredRequirements);
    expect(hinglish.assumptions.some(a => a.field === 'intent.floors' && a.source === 'USER_INFERRED')).toBe(true);
  });
  it('gives identical Phase 17 requirements hashes to synonymous briefs', async () => {
    const a = await interpret('30x50 ft plot, 3 bedrooms, 2 floors');
    const b = await interpret('two-storey 3-bedroom home on a thirty by fifty foot site');
    expect(a.status).toBe('READY'); expect(b.status).toBe('READY');
    expect(requirementsHash(a.structuredRequirements!)).toBe(requirementsHash(b.structuredRequirements!));
  });
  it('resubmits bounded explicit answers without trusting previous model output', async () => {
    const first = await interpret('Make me a modern 4 bedroom house.');
    const second = await interpret('Make me a modern 4 bedroom house.', { clarification: { previousInterpretationId: first.interpretationId, answers: [{ field: 'site.dimensions', value: { width: '30', depth: '50', unit: 'ft' } }] } });
    expect(second.status).toBe('READY'); expect(second.interpretationId).not.toBe(first.interpretationId);
    expect(second.provenance.previousInterpretationId).toBe(first.interpretationId);
    expect(first.status).toBe('NEEDS_CLARIFICATION');
  });
  it('does not resolve a semantic contradiction using an unrelated clarification answer', async () => {
    const r = await interpret('30x50 ft 3BHK no staircase two floors', { clarification: { previousInterpretationId: randomUUID(), answers: [{ field: 'floors', value: 2 }] } });
    expect(r.status).toBe('NEEDS_CLARIFICATION');
  });
  it('does not erase conflicting floor allocations when only the total bedroom count is clarified', async () => {
    const r = await interpret('30x50 ft 3BHK two floors, one bedroom downstairs and two bedrooms downstairs', {
      clarification: { previousInterpretationId: randomUUID(), answers: [{ field: 'bedrooms', value: 3 }] },
    });
    expect(r.status).toBe('NEEDS_CLARIFICATION');
    expect(r.unresolvedQuestions.map(q => q.field)).toContain('groundFloorBedrooms');
    expect(r.structuredRequirements).toBeNull();
  });
  it('preserves opaque seed spelling and does not translate number words inside the seed', async () => {
    const r = await interpret('30x50 ft 3BHK seed My-ONE-Seed');
    expect(r.status).toBe('READY'); expect(r.structuredRequirements?.seed).toBe('My-ONE-Seed');
    const lower = await interpret('30x50 ft 3BHK seed my-one-seed');
    expect(lower.structuredRequirements?.seed).toBe('my-one-seed');
    // Phase 17 intentionally keeps the execution seed outside requirementsHash.
    expect(requirementsHash(r.structuredRequirements!)).toBe(requirementsHash(lower.structuredRequirements!));
  });
  it('keeps an open-kitchen preference soft and discloses the inferred living-room target', async () => {
    const r = await interpret('30x50 ft 3BHK, I prefer open kitchen');
    expect(r.status).toBe('READY');
    expect(r.structuredRequirements?.relationships?.[0]).toMatchObject({ strength: 'soft', kind: 'connected' });
    expect(r.assumptions).toContainEqual(expect.objectContaining({ field: 'relationships.kitchenTarget', source: 'USER_INFERRED' }));
  });
  it('does not choose one of two relationship targets silently', async () => {
    const r = await interpret('30x50 ft 3BHK kitchen near dining and living');
    expect(r.status).toBe('UNSUPPORTED'); expect(r.structuredRequirements).toBeNull();
    expect(r.unsupportedRequirements).toContainEqual(expect.objectContaining({ feature: 'unsupported_constraint', disposition: 'BLOCKING' }));
  });
  it.each(['0.0015m x 0.0025m 1BHK', '3m x 3m 3BHK'])('clarifies obviously impossible literal room capacity for %s', async text => {
    const r = await interpret(text);
    expect(r.status).toBe('NEEDS_CLARIFICATION'); expect(r.structuredRequirements).toBeNull();
    expect(r.unresolvedQuestions.map(q => q.field)).toContain('requirements');
  });
  it('distinguishes user intent, defaults, unresolved north and deferred preferences', async () => {
    const r = await interpret('30x50 ft 3BHK, good natural ventilation and parking');
    expect(r.provenance.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'intent.site', source: 'USER_EXPLICIT' }),
      expect.objectContaining({ field: 'exteriorWallThicknessMm', source: 'PRODUCT_DEFAULT' }),
      expect.objectContaining({ field: 'site.northMilliDegrees', source: 'UNRESOLVED' }),
    ]));
    expect(r.unsupportedRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ feature: 'parking', appliedToGeometry: false }), expect.objectContaining({ feature: 'ventilation', priority: 'SOFT_PREFERENCE' })]));
  });
  it('maps soft adjacency and hard connection without promoting preferences', async () => {
    const soft = await interpret('30x50 ft 3BHK, I prefer kitchen near dining');
    const hard = await interpret('30x50 ft 3BHK, kitchen connected to dining');
    expect(soft.structuredRequirements?.relationships?.[0]).toMatchObject({ strength: 'soft', kind: 'adjacent' });
    expect(hard.structuredRequirements?.relationships?.[0]).toMatchObject({ strength: 'hard', kind: 'connected' });
  });
});

describe('untrusted providers and budgets', () => {
  it.each(['', '{', 'null', '[]', '{"floors":2,"walls":[]}', { ...valid, qaStatus: 'PASS' }, { ...valid, ownerId: randomUUID() }, { ...valid, site: { ...valid.site, boundary: [] } }, { ...valid, kitchen: 'magic' }, { ...valid, rooms: [{ type: 'bedroom', polygon: [] }] }, 'x'.repeat(17000)])('rejects malformed or privileged output %j', async raw => {
    const r = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: '30x50 ft 3BHK' }), null, { provider: mockProvider(raw) });
    expect(r.status).toBe('FAILED'); expect(r.error?.code).toBe('AI_PROVIDER_INVALID_RESPONSE'); expect(r.structuredRequirements).toBeNull();
  });
  it('normalizes differently formatted outputs from two providers identically', async () => {
    const request = NaturalLanguageDesignRequestSchema.parse({ text: '30x50 ft 3BHK two floors' });
    const first = mockProvider(valid), second = { ...mockProvider(JSON.stringify({ bedrooms: 3, floors: 2, site: { unit: 'm', depth: '15.24', width: '9.144' } }, null, 2)), kind: 'second-fake' };
    const [a, b] = await Promise.all([interpretRequirements(request, null, { provider: first }), interpretRequirements(request, null, { provider: second })]);
    expect(a.status).toBe('READY'); expect(b.status).toBe('READY'); expect(a.structuredRequirements).toEqual(b.structuredRequirements);
    expect(first.interpret).toHaveBeenCalledTimes(1); expect(second.interpret).toHaveBeenCalledTimes(1);
  });
  it.each(ProviderFailureCodeSchema.options)('returns typed %s without retry or leaking error text', async code => {
    const provider = { ...mockProvider(null), interpret: vi.fn(async () => { throw new InterpreterProviderError(code); }) };
    const r = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: '30x50 ft 3BHK' }), null, { provider });
    expect(r.status).toBe('FAILED'); expect(r.error?.code).toBe(code); expect(provider.interpret).toHaveBeenCalledTimes(1);
  });
  it('enforces timeout and abort even when an adapter never resolves', async () => {
    let signal: AbortSignal | undefined;
    const provider = { ...mockProvider(null), interpret: vi.fn((request: Parameters<ArchitecturalInterpreterProvider['interpret']>[0]) => { signal = request.signal; return new Promise(() => {}); }) };
    const r = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: '30x50 ft 3BHK' }), null, { provider, timeoutMs: 5 });
    expect(r.error?.code).toBe('AI_PROVIDER_TIMEOUT'); expect(signal?.aborted).toBe(true); expect(provider.interpret).toHaveBeenCalledTimes(1);
  });
  it('sends only text, locale, schema and budgets to adapters', async () => {
    const provider = mockProvider(valid);
    await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: '30x50 ft 3BHK', locale: 'en-IN', baseRevisionId: randomUUID() }), null, { provider });
    expect(Object.keys(vi.mocked(provider.interpret).mock.calls[0]![0]).sort()).toEqual(['locale', 'maxOutputTokens', 'schema', 'signal', 'text']);
  });
  it('uses explicit kitchen dimensions in new requirements instead of silently dropping provider intent', async () => {
    const r = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: 'brief' }), null,
      { provider: mockProvider({ ...valid, kitchenMinWidthMm: 2600, kitchenMinDepthMm: 3000 }) });
    expect(r.status).toBe('READY');
    expect(r.structuredRequirements?.rooms.find(room => room.type === 'kitchen')).toMatchObject({ minWidthMm: 2600, minDepthMm: 3000 });
  });
  it.each([{ kitchenMinWidthMm: 2600 }, { kitchenMinDepthMm: 2600 }, { relationshipKind: 'connected' }, { relationshipStrength: 'soft' }])('clarifies incomplete provider constraints %j', async extra => {
    const r = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: 'brief' }), null, { provider: mockProvider({ ...valid, ...extra }) });
    expect(r.status).toBe('NEEDS_CLARIFICATION'); expect(r.structuredRequirements).toBeNull();
  });
  it('marks explicit clarification dimensions as explicit even when the provider inferred the original site', async () => {
    const r = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: 'brief', clarification: {
      previousInterpretationId: randomUUID(), answers: [{ field: 'site.dimensions', value: { width: '9', depth: '15', unit: 'm' } }],
    } }), null, { provider: mockProvider({ ...valid, inferredFields: ['site'] }) });
    expect(r.status).toBe('READY');
    expect(r.provenance.fields).toContainEqual(expect.objectContaining({ field: 'intent.site', source: 'USER_EXPLICIT' }));
  });
  it('rejects unapplied relationship changes against a base revision', async () => {
    const original = await interpret('30x50 ft 3BHK');
    const r = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: 'brief', baseRevisionId: randomUUID() }), original.structuredRequirements!,
      { provider: mockProvider({ preserveBedrooms: true, relationshipKind: 'connected', relationshipStrength: 'hard' }) });
    expect(r.status).toBe('NEEDS_CLARIFICATION'); expect(r.structuredRequirements).toBeNull();
  });
  it('caps completion budgets and rejects inputs beyond provider capability before making a call', async () => {
    const provider = mockProvider(valid), request = NaturalLanguageDesignRequestSchema.parse({ text: '30x50 ft 3BHK' });
    await interpretRequirements(request, null, { provider, maxOutputTokens: 999999 });
    expect(vi.mocked(provider.interpret).mock.calls[0]![0].maxOutputTokens).toBe(4096);
    vi.mocked(provider.interpret).mockClear();
    const small = { ...provider, capabilities: { ...provider.capabilities, maxInputLength: 5 } };
    expect((await interpretRequirements(request, null, { provider: small })).error?.code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(provider.interpret).not.toHaveBeenCalled();
  });
  it('sanitizes unexpected adapter errors and disables calls when configuration is disabled', async () => {
    const provider = { ...mockProvider(null), interpret: vi.fn(async () => { throw new Error('provider-secret-credential'); }) };
    const request = NaturalLanguageDesignRequestSchema.parse({ text: '30x50 ft 3BHK' });
    const failed = await interpretRequirements(request, null, { provider });
    expect(failed.error?.code).toBe('AI_PROVIDER_NETWORK_ERROR'); expect(JSON.stringify(failed)).not.toContain('provider-secret-credential');
    vi.mocked(provider.interpret).mockClear();
    expect((await interpretRequirements(request, null, { provider, disabled: true })).error?.code).toBe('AI_CONFIGURATION_UNAVAILABLE');
    expect(provider.interpret).not.toHaveBeenCalled();
  });
  it('applies semantic and native validation after a syntactically valid provider response', async () => {
    for (const extra of [{ bedrooms: 24 }, { floors: 3 }, { floors: 1, upperFloorBedrooms: 2 }, { bedrooms: 3, groundFloorBedrooms: 4 }, { site: { width: '-1', depth: '50', unit: 'ft' } }]) {
      const r = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: 'test' }), null, { provider: mockProvider({ ...valid, ...extra }) });
      expect(r.status).toBe('NEEDS_CLARIFICATION'); expect(r.structuredRequirements).toBeNull();
    }
  });
  it('keeps generation inputs available without any provider configured', async () => {
    const r = await interpret('30x50 ft 3BHK'); expect(r.provider).toBe('fallback');
    expect(normalizeBlueprintRequirements(r.structuredRequirements)).toEqual(r.structuredRequirements);
    const disabled = await interpretRequirements(NaturalLanguageDesignRequestSchema.parse({ text: '30x50 ft 3BHK' }), null, { disabled: true });
    expect(disabled.error?.code).toBe('AI_CONFIGURATION_UNAVAILABLE');
  });
});

it.each(['', '   ', 'x'.repeat(4001), '\u0000'])('rejects malformed or oversized request text', text => {
  expect(NaturalLanguageDesignRequestSchema.safeParse({ text }).success).toBe(false);
});
it.each(['apiKey', 'provider', 'systemPrompt', 'schema', 'projectId', 'ownerId', 'model', 'projectContext'])('rejects client control over %s', field => {
  expect(NaturalLanguageDesignRequestSchema.safeParse({ text: '30x50 ft 3BHK', [field]: 'untrusted' }).success).toBe(false);
});
it('rejects hidden geometry and duplicate clarification answers', () => {
  expect(IntentCandidateSchema.safeParse({ ...parseFallback('30x50 ft 3BHK'), walls: [{ x: 0 }] }).success).toBe(false);
  expect(NaturalLanguageDesignRequestSchema.safeParse({ text: 'brief', clarification: { previousInterpretationId: randomUUID(), answers: [{ field: 'floors', value: 1 }, { field: 'floors', value: 2 }] } }).success).toBe(false);
});

it('enforces a closed import boundary for all AI modules and their contract', () => {
  const dir = fileURLToPath(new URL('../src/ai/', import.meta.url));
  const files = [...readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.ts')).map(f => dir + f), fileURLToPath(new URL('../src/contracts/requirement-interpretation.ts', import.meta.url))];
  const allowed = new Set(['../contracts/conversations.js', '../lib/generation-identity.js', '../lib/errors.js', './conversation-provider.js', './architectural-interpreter.js', 'node:crypto', 'zod', '@designflow/generator', '@designflow/shared', '../contracts/requirement-interpretation.js', './fallback-parser.js', './interpreter-provider.js', '../contracts/ai-orchestration.js', '../../contracts/ai-orchestration.js', '../../contracts/conversations.js', './orchestration/transport.js', './transport.js', './registry.js', './orchestrator.js', '../conversation-provider.js', '../interpreter-provider.js', 'node:https', 'node:dns/promises', 'node:net']);
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const name = node.moduleSpecifier.text;
          // Normalise separators: readdirSync reports `orchestration\transport.ts` on Windows. The rule is unchanged.
          if(['node:https','node:dns/promises','node:net'].includes(name))expect(file.replaceAll('\\', '/').endsWith('/orchestration/transport.ts'), `${file}: ${name}`).toBe(true);
          expect(allowed.has(name), `${file}: ${name}`).toBe(true);
          if (ts.isImportDeclaration(node) && ['@designflow/generator', '@designflow/shared'].includes(name)) {
            const binding = node.importClause?.namedBindings; expect(binding && ts.isNamedImports(binding)).toBe(true);
            if (binding && ts.isNamedImports(binding)) for (const e of binding.elements) expect(['modifyParametricRequirements', 'ParametricEditSchema', 'normalizeBlueprintForVersion', 'blueprintVersionForRequirements', 'NormalizedBlueprintV2Requirements', 'normalizeBlueprintRequirements', 'BlueprintRequirements', 'NormalizedBlueprintRequirements', 'BlueprintRequirementsSchema', 'toMillimetres']).toContain(e.propertyName?.text ?? e.name.text);
          }
        }
      }
      if (ts.isCallExpression(node)) expect(node.expression.getText(source)).not.toMatch(/^(?:import|require|eval|Function)$/);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});
