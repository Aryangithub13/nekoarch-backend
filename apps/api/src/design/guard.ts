import { AiProviderError } from '../contracts/ai-orchestration.js';
import { CONVERSATION_LIMITS } from '../contracts/conversations.js';
import { ExteriorProviderOutputSchema, InteriorProviderOutputSchema, type BriefField, type DesignScope, type ExteriorOutput, type InteriorOutput } from '../contracts/design-concepts.js';
import type { AiTask } from '../ai/orchestration/registry.js';

/**
 * design-concept-guard-v1. A concept is advisory text, so any text that reads as an assurance, a measurement, a quantity or a price is refused
 * (PROVIDER_OUTPUT_UNSAFE), never edited. The screen is deliberately conservative: a refused output falls through to the next route or, when
 * the caller allows it, to the deterministic templates, whose text is tested against these same rules.
 */
export const UNSAFE_TEXT: readonly { rule: string; pattern: RegExp }[] = Object.freeze([
  { rule: 'COMPLIANCE_OR_APPROVAL', pattern: /\b(?:complian(?:t|ce)|complies|conform(?:s|ing|ance)?\s+(?:to|with)|certif(?:y|ied|ies|ication)|approved|approval|permit[- ]ready|building\s+permit|planning\s+permission|(?:meets?|satisf(?:y|ies)|follows?)\s+(?:the\s+|all\s+)?(?:[a-z]+\s+)?(?:code|codes|standards?|regulations?|bye-?laws?|norms)|building\s+codes?|bye-?laws?|as\s+per\s+(?:code|nbc|is\s*\d))/i },
  { rule: 'ENGINEERING_OR_SAFETY', pattern: /\b(?:structural(?:ly)?\s+(?:sound|safe|adequate|stable|capacity)|load[- ]bearing|load\s+capacity|seismic|earthquake[- ]?(?:proof|resistant)|wind[- ]?(?:load|resistant)|fire[- ]?(?:rated|rating|resistant|proof|safe)|fireproof|safe\s+for|guarantee[sd]?|u-value|r-value|shgc|thermal\s+transmittance|energy[- ]?(?:rating|efficient|efficiency|saving)|leed|griha|igbc)\b/i },
  { rule: 'READINESS', pattern: /\b(?:build(?:ing)?[- ]ready|construction[- ]ready|ready\s+(?:for|to)\s+(?:build|construct|construction)|buildable)\b/i },
  { rule: 'DIMENSION_OR_QUANTITY', pattern: /\d\s*(?:mm|cm|m|metres?|meters?|ft|feet|foot|inch(?:es)?|in|sq\.?|sqm|sqft|m2|m²|ft2|kn|mpa|psi|kg|tonnes?|lux|lumens?|lm|watts?|w|kw|kwh|%|percent|°|degrees?)\b/i },
  { rule: 'DIMENSION_OR_QUANTITY', pattern: /\d\s*[x×]\s*\d|\d\s*(?:%|°|m²|″|′|")/ },
  { rule: 'COST', pattern: /[₹$€£]|\b(?:rs\.?|inr|usd|eur|rupees?|dollars?|lakhs?|crores?)\b|\b(?:cost|price|budget)s?\s+(?:of|at|around|about|is|will)\b/i },
]);

export function unsafeTextRule(text: string): string | null {
  for (const r of UNSAFE_TEXT) if (r.pattern.test(text)) return r.rule;
  return null;
}
function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (value && typeof value === 'object') return Object.entries(value).filter(([k]) => !['spaceId', 'referenceIds', 'briefFields', 'hex', 'facades', 'facadePresetId', 'role'].includes(k)).flatMap(([, v]) => texts(v));
  return [];
}

export interface GuardScope { scope: DesignScope; alternatives: number; spaceIds: readonly string[]; referenceIds: readonly string[]; briefFields: readonly BriefField[] }
const subset = (values: readonly string[], allowed: readonly string[]) => values.every(v => allowed.includes(v)) && new Set(values).size === values.length;
/** Structural checks beyond Zod: the exact count, distinct alternatives, ids only from what was supplied, and the text screen. */
export function guardAlternatives<T extends InteriorOutput | ExteriorOutput>(alternatives: T[], g: GuardScope): T[] {
  if (alternatives.length !== g.alternatives) throw new AiProviderError('PROVIDER_SCHEMA_VIOLATION');
  if (new Set(alternatives.map(a => a.title.trim().toLowerCase())).size !== alternatives.length) throw new AiProviderError('PROVIDER_SCHEMA_VIOLATION');
  for (const a of alternatives) {
    if (!subset(a.basis.briefFields, g.briefFields) || !subset(a.basis.referenceIds, g.referenceIds)) throw new AiProviderError('PROVIDER_SCHEMA_VIOLATION');
    if ('spaces' in a && !subset(a.spaces.map(s => s.spaceId), g.spaceIds)) throw new AiProviderError('PROVIDER_SCHEMA_VIOLATION');
    if ('facades' in a && new Set(a.facades).size !== a.facades.length) throw new AiProviderError('PROVIDER_SCHEMA_VIOLATION');
    if (new Set(a.palette.map(p => p.role + p.hex)).size !== a.palette.length) throw new AiProviderError('PROVIDER_SCHEMA_VIOLATION');
    if (texts(a).some(t => unsafeTextRule(t) !== null)) throw new AiProviderError('PROVIDER_OUTPUT_UNSAFE');
  }
  return alternatives;
}

/** The routed task's validator: strict schema first (PROVIDER_SCHEMA_VIOLATION), then the guard. It never repairs an output. */
export function conceptTask(g: GuardScope): AiTask<InteriorOutput[] | ExteriorOutput[]> {
  return { outputBytes: CONVERSATION_LIMITS.outputBytes, parse(raw) {
    const parsed = g.scope === 'INTERIOR' ? InteriorProviderOutputSchema.safeParse(raw) : ExteriorProviderOutputSchema.safeParse(raw);
    if (!parsed.success) throw new AiProviderError('PROVIDER_SCHEMA_VIOLATION');
    return guardAlternatives(parsed.data.alternatives as (InteriorOutput | ExteriorOutput)[], g) as InteriorOutput[] | ExteriorOutput[];
  } };
}
