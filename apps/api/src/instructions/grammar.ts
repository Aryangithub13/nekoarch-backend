import { INTERIOR_FINISHES, INTERIOR_SURFACES } from '@designflow/shared';
import type { PRESERVATION_SCOPES } from '../revision/contracts.js';
import type { InstructionIntent } from './contracts.js';

/**
 * B41 S1 grammar: finite and deterministic (the Phase 18/30/36 approach). Every rule below either maps words onto a closed vocabulary (intents,
 * catalog finishes, preservation scopes) or leaves them unresolved; nothing is guessed. Ordering of the intent rules is significant and tested.
 */
type Scope = typeof PRESERVATION_SCOPES[number];
export type Surface = typeof INTERIOR_SURFACES[number];

export const normalize = (raw: string) => raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\p{Cc}/gu, ' ').replace(/[“”"]/g, '').replace(/[’']/g, '\'').replace(/\s+/g, ' ').trim();

/** Level phrases are cut out before surface detection, so "second floor" is a storey and never the floor surface. */
export const LEVEL_PHRASE = /\b(?:(ground|first|second|third|fourth|1st|2nd|3rd|4th|upper|top|lower|bottom)\s+(?:floor|storey|story|level)s?|(?:floor|level|storey|story)\s+(\d{1,2})|(upstairs|downstairs))\b/g;
const EXCEPT = /\b(?:except(?: for)?|apart from|other than|but not|excluding)\b/;
const KEEP = /\b(?:keep|keeping|preserve|preserving|retain|retaining|maintain|leave|don't (?:change|touch|alter|modify)|do not (?:change|touch|alter|modify)|without (?:changing|touching|altering))\b/;

/** Intent rules, first match wins. Visual-derivative wording is matched before "render" can be read as a finish word. */
const INTENT_RULES: [InstructionIntent, RegExp][] = [
  ['NEW_PROJECT', /\b(?:new project|start (?:a )?(?:new|fresh)|start over|from scratch|another project)\b/],
  ['COMPARE_REVISIONS', /\b(?:compare|comparison|difference|differences|diff|what changed|what's changed|what has changed)\b/],
  ['RESTORE_PRIOR', /\b(?:undo|revert|restore|roll ?back|go back to|reuse|re-use|bring back)\b/],
  ['REGENERATE_VISUAL_DERIVATIVE', /\b(?:renderings?|re-?render|render (?:a|an|me|it|the|again)|photo-?realistic|panoramas?|360|videos?|walkthroughs?|images?|pictures?|visuali[sz]\w*|3d (?:model|scene|view)|glb|scene)\b/],
  ['DERIVE_ALTERNATIVE', /\b(?:try (?:another|a different|something else)|another (?:option|exterior|interior|design|facade|layout|look|scheme)|alternatives?|variants?|different (?:exterior|facade|design|look|scheme)|other options?|more options)\b/],
  ['RECOMPUTE_ENGINEERING', /\b(?:recompute|recalculate|re-?calculate|re-?run|rerun|refresh|update|redo)\b.*\b(?:quantit\w*|takeoff|cost\w*|budget|estimate\w*|boq|structur\w*|analys\w*|verification|engineering|materials?)\b|\b(?:quantit\w*|cost\w*|budget|estimate|structur\w*)\b.*\b(?:again|recomputed|recalculated|updated)\b/],
  ['EDIT_EXISTING', /\b(?:change|redesign|make|set|use|apply|switch|replace|paint|tile|carpet|give|put|finish|redo|update|convert|turn|clad|enlarge|widen|move|remove|add|extend|shrink|resize|increase|reduce|delete)\b/],
];
export function classifyIntent(t: string): InstructionIntent {
  for (const [intent, rule] of INTENT_RULES) if (rule.test(t)) return intent;
  return 'UNRECOGNIZED';
}

/** Words that change geometry or topology: no engine edits these selectively (B40 S1 refusal codes). */
export const GEOMETRY_WORDS = /\b(?:enlarge|widen|move|remove|add|extend|shrink|resize|increase|reduce|delete|bigger|larger|smaller|wider|narrower|merge|split|relocate)\b/;
export const EXTERIOR_WORDS = /\b(?:facades?|exterior|elevations?|cladding|clad|outside walls?|external walls?|roof|glazing|curtain wall)\b/;

/** Catalog finishes and the exact words that name them. Only listed synonyms are accepted; "marble" or "oak" are not catalog finishes. */
const FINISH_WORDS: Record<Surface, [string, RegExp][]> = {
  floor: [['polished-concrete', /\bpolished concrete\b|\bconcrete\b/], ['stone-tile', /\bstone(?: tiles?)?\b/], ['ceramic-tile', /\bceramic(?: tiles?)?\b|\btiles?\b|\btiled\b/],
    ['engineered-timber', /\b(?:engineered )?(?:timber|wood|wooden)\b/], ['vinyl', /\bvinyl\b/], ['carpet', /\bcarpet(?:ed|ing)?\b/]],
  walls: [['paint-white', /\bwhite(?: paint)?\b|\bpaint(?:ed)? white\b/], ['paint-warm-neutral', /\bwarm neutral\b/], ['paint-cool-grey', /\bcool gr[ae]y\b|\bgr[ae]y\b/],
    ['ceramic-tile', /\bceramic(?: tiles?)?\b|\btiles?\b|\btiled\b/], ['timber-panel', /\b(?:timber|wood|wooden) panel\w*\b|\bpanell?ing\b/], ['exposed-plaster', /\b(?:exposed )?plaster\b/]],
  ceiling: [['paint-white', /\bwhite(?: paint)?\b|\bpaint(?:ed)? white\b/], ['acoustic-tile', /\bacoustic(?: tiles?)?\b/], ['exposed-concrete', /\b(?:exposed )?concrete\b/],
    ['timber-slat', /\b(?:timber|wood|wooden) slats?\b|\bslats?\b/]],
};
const SURFACE_WORDS: [Surface, RegExp][] = [['floor', /\b(?:floor|floors|flooring)\b/], ['walls', /\b(?:walls?|wall finish)\b/], ['ceiling', /\bceilings?\b/]];
const NON_CATALOG = /\b(?:marble|granite|oak|walnut|teak|bamboo|terrazzo|cork|laminate|wallpaper|brick|parquet|limestone|slate)\b/;

export type FinishRequest = { surface: Surface; finish: string; phrase: string };
export type FinishParse = { finishes: FinishRequest[]; questions: string[]; unsupported: { code: string; message: string }[] };

/**
 * Pairs each named surface with a catalog finish, clause by clause ("the floor to stone tile and the walls to white"). A finish without a surface
 * is assigned only when exactly one surface admits it; two different finishes for one surface, or a non-catalog material, are reported, never chosen.
 */
export function parseFinishes(text: string): FinishParse {
  const out: FinishParse = { finishes: [], questions: [], unsupported: [] };
  const material = NON_CATALOG.exec(text);
  if (material) out.unsupported.push({ code: 'FINISH_NOT_IN_CATALOG', message: `'${material[0]}' is not a catalog finish. Floor: ${INTERIOR_FINISHES.floor.join(', ')}; `
    + `walls: ${INTERIOR_FINISHES.walls.join(', ')}; ceiling: ${INTERIOR_FINISHES.ceiling.join(', ')}` });
  const clauses = text.replace(LEVEL_PHRASE, ' ').split(/\s*(?:,|;|\band\b|\bwith\b|\bplus\b)\s*/).filter(Boolean);
  const assign = (surface: Surface, finish: string, phrase: string) => {
    const existing = out.finishes.find(f => f.surface === surface);
    if (!existing) out.finishes.push({ surface, finish, phrase: phrase.slice(0, 80) });
    else if (existing.finish !== finish) out.questions.push(`Two finishes were named for the ${surface} (${existing.finish} and ${finish}); which one is meant?`);
  };
  // A clause such as "the walls and ceiling white" names its surfaces before the finish; unfinished surfaces carry into the next clause.
  let pending: Surface[] = [];
  for (const clause of clauses) {
    const named = SURFACE_WORDS.filter(([, r]) => r.test(clause)).map(([sf]) => sf), surfaces = [...new Set([...pending, ...named])];
    if (surfaces.length) {
      const hits = surfaces.map(sf => [sf, FINISH_WORDS[sf].find(([, r]) => r.test(clause))?.[0]] as const);
      if (hits.every(([, h]) => h === undefined)) { pending = surfaces; continue; }
      for (const [sf, h] of hits) if (h) assign(sf, h, clause);
      pending = [];
      continue;
    }
    // No surface named: a finish word is assigned only when exactly one surface admits it ("carpet the bedroom" → floor).
    const admitting = INTERIOR_SURFACES.map(sf => [sf, FINISH_WORDS[sf].find(([, r]) => r.test(clause))?.[0]] as const).filter(([, h]) => h !== undefined);
    if (admitting.length === 1) assign(admitting[0]![0], admitting[0]![1]!, clause);
    else if (admitting.length > 1) out.questions.push(`Which surface is meant by '${clause.slice(0, 60)}': ${admitting.map(([sf]) => sf).join(' or ')}?`);
  }
  if (pending.length) out.questions.push(`No catalog finish was named for the ${pending.join(' and ')}; which finish is meant?`);
  return out;
}

/** Preservation words → the Phase 30 scope vocabulary. */
const SCOPE_WORDS: [Scope, RegExp][] = [
  ['STRUCTURE', /\b(?:structure|structural|frame|columns?|slabs?|beams?)\b/], ['FLOOR_PLANS', /\b(?:floor ?plans?|plans?|layouts?)\b/],
  ['ROOMS', /\b(?:rooms?|spaces?)\b/], ['WALLS', /\bwalls?\b/], ['STAIRS', /\b(?:stairs?|staircases?|stairwells?)\b/],
  ['OPENINGS', /\b(?:windows?|doors?|openings?)\b/], ['EXTERIOR_APPEARANCE', /\b(?:facades?|exterior|elevations?|cladding|outside)\b/],
  ['BUILDING_DIMENSIONS', /\b(?:dimensions?|size|footprint)\b/], ['BUILDING_GEOMETRY', /\b(?:geometry|massing|shape|form)\b/],
  ['INTERIOR', /\b(?:interiors?|finishes)\b/],
];
/** What "only" protects for an interior finish edit: everything except the interior finish layer (B40 FINISH changes are locked only by INTERIOR). */
export const ONLY_FINISH_LOCKS: readonly Scope[] = ['BUILDING_GEOMETRY', 'FLOOR_PLANS', 'STRUCTURE', 'STAIRS', 'OPENINGS', 'WALLS', 'ROOMS', 'BUILDING_DIMENSIONS', 'EXTERIOR_APPEARANCE'];

export type KeepClause = { scopes: { scope: Scope; phrase: string }[]; everythingElse: boolean; levelPhrases: string[] };
/** The clauses after a keep/preserve verb, up to the next requesting clause. "Keep the structure and floor plans" → STRUCTURE, FLOOR_PLANS. */
/** A requesting verb that ends a keep clause: "keep the interiors as they are and change the kitchen floor" keeps up to "and change". */
const REQUEST_VERB = /\b(?:and |then |, )?(?:change|redesign|make|set|use|apply|switch|replace|paint|tile|carpet|give|put|finish|convert|turn|clad|enlarge|widen|move|remove|add|extend)\b/;
/** Splits instruction clauses into what is kept and what is requested. */
export function splitClauses(text: string): { keep: string[]; request: string[] } {
  const out = { keep: [] as string[], request: [] as string[] };
  for (const clause of text.split(/[.;!?]|\bbut\b|\bwhile\b|\bthen\b/)) {
    const k = KEEP.exec(clause);
    if (!k) { if (clause.trim()) out.request.push(clause.trim()); continue; }
    const before = clause.slice(0, k.index).replace(/[\s,]+$/, ''), tail = clause.slice(k.index + k[0].length), v = REQUEST_VERB.exec(tail);
    if (before.trim()) out.request.push(before.trim());
    out.keep.push((v ? tail.slice(0, v.index) : tail).trim());
    if (v) out.request.push(tail.slice(v.index).replace(/^(?:and |then |, )/, '').trim());
  }
  return out;
}
export function parseKeep(text: string): KeepClause {
  const out: KeepClause = { scopes: [], everythingElse: false, levelPhrases: [] };
  for (const tail of splitClauses(text).keep) {
    if (/\b(?:everything else|all else|the rest|everything)\b/.test(tail)) out.everythingElse = true;
    for (const level of tail.matchAll(LEVEL_PHRASE)) out.levelPhrases.push(level[0]);
    const scoped = tail.replace(LEVEL_PHRASE, ' ');
    for (const [scope, r] of SCOPE_WORDS) { const s = r.exec(scoped); if (s) out.scopes.push({ scope, phrase: s[0] }); }
  }
  return out;
}

/** Words that can belong to a room reference after "except": the excluded phrase ends at the first word that cannot ("vinyl", "paint", "to"). */
const REFERENCE_WORD = /^(?:the|a|an|and|or|#|no\.?|number|\d{1,2}|first|second|third|fourth|1st|2nd|3rd|4th|master|main|north|south|east|west|northern|southern|eastern|western|northmost|southmost|ground|upper|top|lower|upstairs|downstairs|level|storey|story|bed|beds|bedrooms?|bath|bathrooms?|toilets?|washrooms?|wcs?|en-?suites?|kitchens?|living|dining|rooms?|areas?|lounges?|family|sitting|study|studies|offices?|foyers?|entry|entries|entrances?|lobby|lobbies|corridors?|hallways?|halls?|passages?|landings?|studios?|spaces?|[a-z]+-\d{1,2})$/;
/** Splits "all bedrooms except bedroom 2 vinyl floors" into the requesting part and the excluded room reference ("bedroom 2"). */
export function splitExcept(text: string): { head: string; excluded: string | null } {
  const m = EXCEPT.exec(text);
  if (!m) return { head: text, excluded: null };
  const rest = text.slice(m.index + m[0].length).trim().split(' ');
  let n = 0;
  while (n < rest.length && REFERENCE_WORD.test(rest[n]!.replace(/[,.;!?]+$/, ''))) { n++; if (/[,.;!?]$/.test(rest[n - 1]!)) break; }
  while (n > 0 && /^(?:and|or|the|a|an)$/.test(rest[n - 1]!)) n--;
  const excluded = rest.slice(0, n).join(' ').replace(/[,.;!?]+$/, '').trim();
  return { head: `${text.slice(0, m.index)} ${rest.slice(n).join(' ')}`.trim(), excluded: excluded || null };
}

export type RevisionWords = { phrase: string; kind: 'PREVIOUS' | 'ORIGINAL' | 'NUMBER' | 'THIS'; revisionNumber: number | null };
/** Revision references: "the previous revision", "the original", "revision 3", "this version". */
export function parseRevisionRefs(text: string): RevisionWords[] {
  const refs: RevisionWords[] = [];
  for (const m of text.matchAll(/\b(?:revision|version|rev\.?|v)\s*#?\s*(\d{1,6})\b|\b(previous|last|prior|earlier|original|first|initial|this|current)\s+(?:revision|version|design|one|plan|floor ?plan)\b/g)) {
    if (m[1]) refs.push({ phrase: m[0], kind: 'NUMBER', revisionNumber: Number(m[1]) });
    else refs.push({ phrase: m[0], kind: /original|first|initial/.test(m[2]!) ? 'ORIGINAL' : /this|current/.test(m[2]!) ? 'THIS' : 'PREVIOUS', revisionNumber: null });
  }
  if (!refs.length && /\b(?:undo|go back|revert|roll ?back)\b/.test(text)) refs.push({ phrase: 'undo', kind: 'PREVIOUS', revisionNumber: null });
  return refs.slice(0, 2);
}
/** "Reuse the previous floor plan": a partial restore of one aspect of an earlier revision. */
export const PARTIAL_RESTORE = /\b(?:reuse|re-use|bring back|take)\b.*\b(?:floor ?plans?|layouts?|plans?|facades?|exterior|interiors?|finishes|rooms?|kitchen|structure)\b/;
export const ONLY = /\b(?:only|just|solely|nothing else)\b/;
