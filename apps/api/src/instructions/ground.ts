import type { BuildingModelV2 } from '@designflow/shared';
import { compass } from '../environmental/solar.js';
import { NORTH_CONVENTION } from '../environmental/contracts.js';
import { INSTRUCTION_LIMITS, type ResolvedTarget } from './contracts.js';
import { LEVEL_PHRASE } from './grammar.js';

/**
 * B41 S1 grounding: natural-language references → stable element ids of one model, or an explicit ambiguity listing the candidates. A reference
 * that matches nothing is NOT_FOUND; one that matches several where one was meant is AMBIGUOUS. Nothing is chosen on the user's behalf.
 */
type Level = BuildingModelV2['levels'][number];
type Space = BuildingModelV2['spaces'][number];
const ORDINAL: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 };
const target = (phrase: string, elementType: 'space' | 'level', resolution: ResolvedTarget['resolution'], elementIds: string[], basis: string[],
  candidates: { elementId: string; name: string }[] = []): ResolvedTarget =>
  ({ phrase: phrase.slice(0, 200), elementType, resolution, elementIds: elementIds.slice(0, 64), candidates: candidates.slice(0, INSTRUCTION_LIMITS.candidates), basis: basis.slice(0, 8) });
const storeys = (m: BuildingModelV2) => m.levels.filter(l => l.kind === 'storey').sort((a, b) => a.index - b.index);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Level references. "First floor" names the ground storey in some conventions and the storey above it in others: both are offered when both exist. */
export function groundLevels(text: string, model: BuildingModelV2): ResolvedTarget[] {
  const out: ResolvedTarget[] = [], s = storeys(model), seen = new Set<string>();
  const one = (phrase: string, level: Level | undefined, basis: string) =>
    out.push(level ? target(phrase, 'level', 'EXACT', [level.id], [basis]) : target(phrase, 'level', 'NOT_FOUND', [], [`${basis}: no such storey in this revision`]));
  for (const m of text.matchAll(LEVEL_PHRASE)) {
    const phrase = m[0], word = m[1] ?? m[3], number = m[2];
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    const named = model.levels.find(l => words(l.name).join(' ') === words(phrase).join(' '));
    if (named) { one(phrase, named, `level name '${named.name}'`); continue; }
    if (word && /^(?:ground|lower|bottom|downstairs)$/.test(word)) { one(phrase, s[0], 'lowest storey'); continue; }
    if (word && /^(?:upper|top|upstairs)$/.test(word)) { one(phrase, s.length > 1 ? s[s.length - 1] : undefined, 'highest storey above the ground storey'); continue; }
    const k = number ? Number(number) : ORDINAL[word ?? ''];
    if (!k) continue;
    const counted = s[k - 1], above = s[k], options = [...new Set([counted, above].filter((l): l is Level => !!l))];
    if (options.length === 2) out.push(target(phrase, 'level', 'AMBIGUOUS', [], [`'${phrase}' counts the ground storey as 1 in some conventions and as 0 in others`],
      options.map(l => ({ elementId: l.id, name: l.name }))));
    else if (options.length === 1) one(phrase, options[0], counted ? 'storey counted from the ground storey as 1 (the only existing reading)' : 'storey counted above the ground storey (the only existing reading)');
    else one(phrase, undefined, `storey ${k}`);
  }
  // A level named outright ("Floor 1", "Ground") that the phrase grammar did not already cover.
  for (const l of model.levels) {
    const name = words(l.name).join(' ');
    if (name.length >= 3 && !seen.has(name) && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text) && !out.some(t => t.elementIds.includes(l.id))
      && !/^(?:floor|level|storey)$/.test(name)) { seen.add(name); one(name, l, `level name '${l.name}'`); }
  }
  return out;
}

/** Room nouns → space classifications (and the name stems the generators use). */
const ROOM_NOUNS: [string, RegExp][] = [
  ['bedroom', /\b(?:master |main )?bed ?rooms?\b/], ['bathroom', /\b(?:bath ?rooms?|toilets?|washrooms?|wcs?|restrooms?|en-?suites?)\b/],
  ['kitchen', /\bkitchens?\b/], ['living', /\b(?:living(?: rooms?| areas?)?|lounges?|family rooms?|sitting rooms?)\b/], ['dining', /\bdining(?: rooms?| areas?)?\b/],
  ['study', /\b(?:study|studies|offices?)\b/], ['entry', /\b(?:foyers?|entr(?:y|ies)|entrances?|lobb(?:y|ies))\b/],
  ['circulation', /\b(?:corridors?|hallways?|halls?|passages?|landings?)\b/], ['studio', /\bstudios?\b/],
];
const GENERIC = /\b(?:all|every|each|whole)\s+(?:the\s+)?(?:rooms?|spaces?|house|home|building|floor|storey|level)\b|\beverywhere\b|\b(?:rooms|spaces)\b/;
const isType = (s: Space, type: string) => s.classification.toLowerCase() === type || words(s.name).includes(type) || (type === 'entry' && words(s.name).includes('foyer'));
const numberOf = (s: Space) => { const n = words(s.name).find(w => /^\d+$/.test(w)); return n === undefined ? null : Number(n); };

/** Area centroid of a space boundary (shoelace), in mm. */
function centroid(ring: readonly { x: number; z: number }[]) {
  let a = 0, cx = 0, cz = 0;
  ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]!, c = p.x * q.z - q.x * p.z; a += c; cx += (p.x + q.x) * c; cz += (p.z + q.z) * c; });
  return a === 0 ? { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, z: ring.reduce((s, p) => s + p.z, 0) / ring.length } : { x: cx / (3 * a), z: cz / (3 * a) };
}
const DIRECTIONS = /\b(north|south|east|west)(?:ern)?(?:-?(east|west)(?:ern)?)?(?:most)?\b/;
/** Two candidates closer than this along the requested direction are not distinguishable by "the south room": ask instead of choosing. */
export const ORIENTATION_TOLERANCE_MM = 500;

/**
 * Picks the candidate furthest along a compass direction (site north, NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X, as the environmental service uses it).
 * Relative position only: it says nothing about daylight, exposure or façade performance.
 */
function byDirection(model: BuildingModelV2, candidates: Space[], dir: RegExpExecArray): { pick: Space[]; basis: string; question: string | null } {
  const north = model.site?.northMilliDegrees ?? null;
  if (north === null) return { pick: candidates, basis: 'orientation requested', question: `Site north is not recorded in this revision, so '${dir[0]}' cannot be resolved; name the room instead` };
  const frame = compass(north), axis = (d: string) => d === 'north' ? frame.north : d === 'south' ? frame.north.map(v => -v) : d === 'east' ? frame.east : frame.east.map(v => -v);
  const v = [dir[1]!, ...(dir[2] ? [dir[2]] : [])].map(axis).reduce((s, a) => [s[0]! + a[0]!, 0, s[2]! + a[2]!], [0, 0, 0]);
  const scored = candidates.map(s => { const c = centroid(s.boundary); return { s, p: c.x * v[0]! + c.z * v[2]! }; }).sort((a, b) => b.p - a.p || a.s.id.localeCompare(b.s.id));
  const basis = `furthest ${dir[0]} by space centroid (site north ${north / 1000}°, ${NORTH_CONVENTION})`;
  if (scored.length > 1 && scored[0]!.p - scored[1]!.p < ORIENTATION_TOLERANCE_MM * Math.hypot(v[0]!, v[2]!))
    return { pick: scored.filter(x => scored[0]!.p - x.p < ORIENTATION_TOLERANCE_MM * Math.hypot(v[0]!, v[2]!)).map(x => x.s), basis, question: null };
  return { pick: scored.slice(0, 1).map(x => x.s), basis, question: null };
}

export type SpaceGround = { targets: ResolvedTarget[]; questions: string[] };
/**
 * Space references in one phrase: a room noun (or an exact space name), an optional number or ordinal, quantifier, storey and compass direction.
 * Plural or quantified nouns select every match; a singular noun must match exactly one space.
 */
export function groundSpaces(text: string, model: BuildingModelV2, levelIds: string[] | null): SpaceGround {
  const out: SpaceGround = { targets: [], questions: [] };
  const onLevels = (s: Space) => levelIds === null || levelIds.includes(s.levelId);
  const levelBasis = levelIds === null ? [] : [`on ${levelIds.map(id => model.levels.find(l => l.id === id)?.name ?? id).join(', ')}`];
  const cleaned = text.replace(LEVEL_PHRASE, ' ');
  // Exact names first ("bedroom-2", "bedroom 2", "foyer"): the model's own labels.
  const byName = model.spaces.filter(s => onLevels(s) && new RegExp(`\\b${words(s.name).join('[ _-]?')}\\b`).test(cleaned) && words(s.name).length > 0);
  const namedIds = new Set(byName.map(s => s.id));
  for (const s of byName) out.targets.push(target(s.name, 'space', 'EXACT', [s.id], [`space name '${s.name}'`, ...levelBasis]));
  for (const [type, noun] of ROOM_NOUNS) {
    const m = noun.exec(cleaned);
    if (!m) continue;
    const after = cleaned.slice(m.index + m[0].length), before = cleaned.slice(Math.max(0, m.index - 40), m.index);
    const explicit = /^\s*(?:#|no\.?|number)?\s*(\d{1,2})\b/.exec(after), ordinal = /\b(first|1st|second|2nd|third|3rd|fourth|4th)\s+$/.exec(before);
    let pool = model.spaces.filter(s => isType(s, type) && onLevels(s));
    if (explicit && pool.some(s => namedIds.has(s.id) && numberOf(s) === Number(explicit[1]))) continue; // already grounded by its exact name
    const plural = /s\b/.test(m[0]) && !/(?:ss|us)\b/.test(m[0]) || /\b(?:all|every|each|both)\s+(?:the\s+|of the\s+)?$/.test(before);
    const basis = [`room type '${type}'`, ...levelBasis];
    const phrase = `${ordinal?.[0] ?? ''}${m[0]}${explicit ? ` ${explicit[1]}` : ''}`.trim();
    const n = explicit ? Number(explicit[1]) : ordinal ? ORDINAL[ordinal[1]!]! : null;
    if (n !== null) {
      const numbered = pool.filter(s => numberOf(s) === n);
      if (numbered.length) { pool = numbered; basis.push(`number ${n} in the space name`); }
      else if (pool.length && pool.every(s => numberOf(s) === null)) out.questions.push(`The ${type} spaces carry no numbers; which one is '${phrase}'?`);
      else pool = [];
    }
    // A noun that only repeats a space already grounded by its exact name ("the studio", "foyer") adds nothing.
    if (!plural && pool.length > 0 && pool.every(s => namedIds.has(s.id))) continue;
    const dir = DIRECTIONS.exec(cleaned);
    if (dir && pool.length > 1) {
      const d = byDirection(model, pool, dir);
      basis.push(d.basis);
      if (d.question) { out.questions.push(d.question); out.targets.push(target(phrase, 'space', 'AMBIGUOUS', [], basis, pool.map(s => ({ elementId: s.id, name: s.name })))); continue; }
      pool = d.pick;
      if (!plural && pool.length > 1) basis.push(`candidates within ${ORIENTATION_TOLERANCE_MM} mm of each other along that direction`);
    }
    if (!pool.length) out.targets.push(target(phrase, 'space', 'NOT_FOUND', [], [...basis, 'no matching space in this revision']));
    else if (pool.length === 1 || plural) out.targets.push(target(phrase, 'space', 'EXACT', pool.map(s => s.id), plural ? [...basis, 'every match (plural or quantified)'] : basis));
    else out.targets.push(target(phrase, 'space', 'AMBIGUOUS', [], [...basis, `${pool.length} spaces match a singular reference`], pool.map(s => ({ elementId: s.id, name: s.name }))));
  }
  if (!out.targets.length && GENERIC.test(cleaned)) {
    const pool = model.spaces.filter(onLevels);
    out.targets.push(target(GENERIC.exec(cleaned)![0], 'space', pool.length ? 'EXACT' : 'NOT_FOUND', pool.map(s => s.id), ['every space', ...levelBasis]));
  }
  return out;
}
