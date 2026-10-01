import { type IntentCandidate, type UnsupportedFeatureSchema } from '../contracts/requirement-interpretation.js';
import type { z } from 'zod';
import type { ArchitecturalInterpreterProvider } from './interpreter-provider.js';

const words: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', ek: '1', do: '2', teen: '3', char: '4' };
const units: Record<string, 'ft' | 'm' | 'mm' | 'cm' | 'in'> = { ft: 'ft', feet: 'ft', foot: 'ft', m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', mm: 'mm', cm: 'cm', in: 'in', inch: 'in', inches: 'in' };
const unitPattern = '(ft|feet|foot|mm|cm|m|metres?|meters?|inches?|in)?';
const numberPattern = '([+-]?\\d+(?:\\.\\d+)?)';

/** Deliberately finite grammar. Unknown design vocabulary blocks READY instead of disappearing. */
export function parseFallback(text: string): IntentCandidate {
  let t = text;
  const c: IntentCandidate = { inferredFields: [], contradictions: [], unsupported: [] };
  const addUnsupported = (f: z.infer<typeof UnsupportedFeatureSchema>) => { if (!c.unsupported.includes(f)) c.unsupported.push(f); };
  const conflict = (f: IntentCandidate['contradictions'][number]) => { if (!c.contradictions.includes(f)) c.contradictions.push(f); };
  const consume = (pattern: RegExp, fn: (m: RegExpExecArray) => void) => {
    const matches = [...t.matchAll(pattern)]; for (const m of matches) fn(m);
    t = t.replace(pattern, ' ');
  };
  // Seeds are opaque, case-sensitive identifiers, not language to normalize.
  consume(/\bseed\s*[:=]?\s*([a-z0-9_-]{1,128})\b/gi, m => { if (c.seed) addUnsupported('unsupported_constraint'); c.seed = m[1]!; });
  t = t.toLowerCase().replace(/[–—]/g, '-').replace(/\b[a-z]+\b/g, s => words[s] ?? s);
  consume(new RegExp(`(?<![\\w.])${numberPattern}\\s*${unitPattern}\\s*(?:x|×|by)\\s*${numberPattern}\\s*${unitPattern}(?![a-z])`, 'g'), m => {
    const unit = units[m[2] ?? m[4] ?? ''], depthUnit = units[m[4] ?? m[2] ?? ''];
    const site = { width: m[1]!, depth: m[3]!, ...(unit ? { unit } : {}), ...(depthUnit && depthUnit !== unit ? { depthUnit } : {}) };
    if (c.site && JSON.stringify(c.site) !== JSON.stringify(site)) conflict('site');
    c.site = site;
  });
  const features: [RegExp, z.infer<typeof UnsupportedFeatureSchema>][] = [
    [/\bspiral\s+stair(?:case)?s?\b/g, 'spiral_staircase'], [/\bcurved(?:\s+parametric)?\s+roof\b/g, 'curved_roof'],
    [/\b(?:l-shaped|irregular|polygonal)\s+(?:plot|site)\b/g, 'irregular_site'],
    [/\b(?:natural\s+)?(?:light|daylight)\b/g, 'daylight'], [/\b(?:natural\s+)?ventilation\b/g, 'ventilation'],
    [/\b(?:north|south|east|west)(?:-facing|\s+facing)?\b/g, 'orientation'],
    [/\b(?:code\s+compliance|structural\s+safety|earthquake|load-bearing)\b/g, 'engineering_compliance'],
  ];
  for (const [pattern, feature] of features) consume(pattern, () => addUnsupported(feature));
  consume(/\bno\s+stair(?:case)?s?\b/g, () => { c.noStairs = true; });
  // Negated/ranged/conditional counts are outside the finite grammar.
  if (/\b(?:not|without|except|exclude|at least|at most|between|unless|or)\b|\d\s*(?:-|to)\s*\d/.test(t)) addUnsupported('unsupported_constraint');
  consume(/\b(?:no\s+parking|parking\s+for\s+(\d+)\s+cars?|(?:a|1)\s+car\s+parking|parking)\b/g, m => {
    const n = m[0].startsWith('no ') ? 0 : Number(m[1] ?? 1);
    if (c.parking !== undefined && c.parking !== n) conflict('parking'); c.parking = n;
  });
  if ((c.parking ?? 0) > 0) addUnsupported('parking');
  consume(/\b(?:single[ -]stor(?:e)?y|only\s+1\s+floor|(\d+)[ -]*(?:floors?|stor(?:e)?ys?))\b/g, m => {
    const n = Number(m[1] ?? 1); if (c.floors !== undefined && c.floors !== n) conflict('floors'); c.floors = n;
  });
  consume(/\b(\d+)\s*-?\s*bhk\b/g, m => { const n = Number(m[1]); if (c.bedrooms !== undefined && c.bedrooms !== n) conflict('bedrooms'); c.bedrooms = n; });
  const ground = '(?:on\\s+the\\s+ground\\s+floor|on\\s+ground\\s+floor|downstairs|ground\\s+floor|neeche)';
  const upper = '(?:on\\s+the\\s+(?:second|first)\\s+floor|upstairs|upar)';
  for (const [location, field] of [[ground, 'groundFloorBedrooms'], [upper, 'upperFloorBedrooms']] as const) {
    consume(new RegExp(`\\b(?:${location}\\s+(?:me\\s+)?(\\d+)\\s+bedrooms?|(\\d+)\\s+bedrooms?\\s+${location})\\b`, 'g'), m => {
      const n = Number(m[1] ?? m[2]); if (c[field] !== undefined && c[field] !== n) conflict(field); c[field] = n;
    });
  }
  const upstairs = c.upperFloorBedrooms !== undefined || /\b(?:upstairs|upar|second floor|first floor)\b/.test(t);
  if (upstairs) {
    if (c.floors === 1) conflict('floors');
    else if (c.floors === undefined) { c.floors = 2; c.inferredFields.push('floors'); }
  }
  consume(/\b(\d+)[ -]*bedrooms?\b/g, m => { const n = Number(m[1]); if (c.bedrooms !== undefined && c.bedrooms !== n) conflict('bedrooms'); c.bedrooms = n; });
  if (c.bedrooms === undefined && c.groundFloorBedrooms !== undefined && c.upperFloorBedrooms !== undefined) {
    c.bedrooms = c.groundFloorBedrooms + c.upperFloorBedrooms; c.inferredFields.push('bedrooms');
  }
  for (const [pattern, field] of [[/\b(\d+)\s+(?:bathrooms?|washrooms?)\b/g, 'bathrooms'], [/\b(\d+)\s+living(?:\s+rooms?)?\b/g, 'living'], [/\b(\d+)\s+dining(?:\s+rooms?)?\b/g, 'dining'], [/\b(\d+)\s+(?:studies|study)\b/g, 'study']] as const) {
    consume(pattern, m => { const n = Number(m[1]); if (c[field] !== undefined && c[field] !== n) conflict(field); c[field] = n; });
  }
  consume(/\b(?:open[ -](?:plan\s+)?kitchen|closed\s+kitchen|kitchen\s+(?:open|closed))\b/g, m => {
    const k = m[0].includes('open') ? 'open' : 'closed'; if (c.kitchen && c.kitchen !== k) conflict('kitchen'); c.kitchen = k;
    if (k === 'open' && /\b(?:prefer|preferably|would like)\b/.test(t)) c.relationshipStrength = 'soft';
  });
  consume(/\b(?:keep\s+(?:the\s+)?bedrooms\s+(?:the\s+)?same|preserve\s+(?:the\s+)?bedrooms|keep\s+everything\s+(?:the\s+)?same)\b/g, () => { c.preserveBedrooms = true; });
  consume(/\b(?:make\s+(?:the\s+)?kitchen\s+larger|larger\s+kitchen|increase\s+(?:the\s+)?kitchen\s+area)\b/g, () => { c.kitchenLarger = true; });
  if (/\b(?:near|adjacent|connected|next to)\b/.test(t)) {
    if (/\bkitchen\b/.test(text.toLowerCase()) && /\b(?:dining|living)\b/.test(t)) {
      if (/\bdining\b/.test(t) && /\bliving\b/.test(t)) addUnsupported('unsupported_constraint');
      c.kitchenConnection = /\bdining\b/.test(t) ? 'dining' : 'living';
      c.relationshipKind = /\bconnected\b/.test(t) ? 'connected' : 'adjacent';
      c.relationshipStrength = /\b(?:prefer|preferably|would like)\b/.test(t) ? 'soft' : 'hard';
    } else addUnsupported('unsupported_constraint');
  }
  if (/\bdining\b/.test(t)) c.dining ??= 1;
  if (/\bliving\b/.test(t)) c.living ??= 1;
  if (/\bstudy\b/.test(t)) c.study ??= 1;
  if (/\bkitchen\b/.test(t)) c.kitchen ??= 'unspecified';
  if (/\b(?:bedrooms?|bhk|bathrooms?|washrooms?)\b/.test(t)) addUnsupported('unsupported_constraint');
  // Filler is intentionally finite: new vocabulary requires clarification, never silent interpretation.
  const filler = new Set('i have a an the my me make want need would like prefer preferably please house home modern nice good natural maximize plot site on with and aur hai ka ki ke chahiye rakhna me floor ground downstairs upstairs upar neeche bedroom bedrooms kitchen dining living room rooms study connected connect to near adjacent next open plan but for keep same everything only'.split(' '));
  const residual = t.replace(/[.,!?;:]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (residual.some(s => !filler.has(s))) addUnsupported('unrecognized_language');
  return c;
}
export const fallbackProvider: ArchitecturalInterpreterProvider = {
  kind: 'fallback', model: 'bounded-parser-v1', path: 'fallback',
  capabilities: { structuredOutput: true, jsonSchema: false, multilingual: true, maxInputLength: 4000, timeoutMs: 1000, costClass: 'FREE', supportsToolMode: false },
  async interpret({ text }) { return parseFallback(text); },
};
