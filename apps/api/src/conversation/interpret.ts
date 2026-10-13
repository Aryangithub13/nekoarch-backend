import { interpretRevision } from '../revision/interpret.js';
import type { RevisionIntent } from '../revision/contracts.js';
import type { Domain } from '../engineering/contracts.js';

/**
 * Phase 36 turn interpretation: a finite, deterministic grammar (the Phase 18/30 approach). It decides what kind of turn a message is and
 * extracts only what it can map onto a supported question or operation; everything else becomes a clarification or an honest refusal. It never
 * invents values, rooms, levels or options. Requirement wording is delegated to the Phase 20 planner, appearance and preservation wording to the
 * Phase 30 revision grammar, so there is one vocabulary per concern.
 */
export type Topic = 'STOREYS' | 'ROOMS' | 'HEIGHT' | 'SITE' | 'REVISION' | 'QA' | 'OPENINGS' | 'STAIRS' | 'APPEARANCE' | 'CAPABILITIES' | 'BRIEF';
export type Unsupported = { code: string; message: string; alternative: string | null };
export type Classified =
  | { kind: 'OPTION_SELECTION'; index: number | null; revision: RevisionIntent }
  | { kind: 'OPTIONS' }
  | { kind: 'DECISION_QUERY' }
  | { kind: 'ENGINEERING_QUESTION'; domains: Domain[]; asksForValue: boolean }
  | { kind: 'COMPARISON'; subject: 'PENDING_ACTION' | 'PREVIOUS' | 'ORIGINAL' | { revisionNumber: number } }
  | { kind: 'PROJECT_QUESTION'; topics: Topic[] }
  | { kind: 'CONSTRAINT'; revision: RevisionIntent }
  | { kind: 'CHANGE_REQUEST'; family: 'EXTERIOR_APPEARANCE' | 'RESTORE' | 'REQUIREMENTS' | 'ZONE_REGENERATION'; revision: RevisionIntent }
  | { kind: 'UNSUPPORTED'; revision: RevisionIntent; unsupported: Unsupported }
  | { kind: 'UNRECOGNIZED'; revision: RevisionIntent };

const ORDINALS: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5 };
const QUESTION = /\?\s*$|^(?:is|are|can|could|will|would|what|which|how|does|do|did|has|have|tell me|show me|list|explain|check|assess|evaluate|calculate|estimate)\b/;
const CHANGE = /\b(?:change|make|set|use|apply|switch|add|remove|move|increase|reduce|enlarge|widen|replace|redesign|regenerate|restore|revert|go back|undo|paint|clad|turn)\b/;
const ENGINEERING: [RegExp, Domain[]][] = [
  [/\bwind\b/, ['WIND_LOADS', 'LATERAL_DRIFT_AND_STABILITY']],
  [/\b(?:seismic|earthquakes?)\b/, ['SEISMIC_LOADS', 'DYNAMIC_RESPONSE']],
  [/\b(?:foundations?|soil|geotechnical|piles?|footings?)\b/, ['GEOTECHNICAL_AND_FOUNDATIONS']],
  [/\b(?:drift|stability|sway)\b/, ['LATERAL_DRIFT_AND_STABILITY']],
  [/\b(?:structur\w*|beams?|columns?|members?|loads?|safety factors?|load-bearing|reinforcement|safe)\b/, ['GRAVITY_LOADS', 'MEMBER_DESIGN']],
  [/\b(?:fire|egress|evacuat\w*|escape)\b/, ['FIRE_AND_LIFE_SAFETY']],
  [/\b(?:lifts?|elevators?)\b/, ['VERTICAL_TRANSPORT']],
  [/\b(?:codes?|compliance|compliant|by-?laws?|regulations?|permitted)\b/, ['CODE_COMPLIANCE']],
  [/\b(?:certif\w*|approv\w* by|sign-?off|stamp)\b/, ['CERTIFICATION_AND_APPROVAL']],
  [/\b(?:cost|budget|price|afford\w*)\b/, ['PRELIMINARY_COST']],
  [/\b(?:collapse|robustness)\b/, ['PROGRESSIVE_COLLAPSE']],
];
const REQUIREMENT_WORDS = /\b(?:\d+\s*bhk|bedrooms?|bathrooms?|kitchen|dining|study|living room|living|floors?|storeys?|stories|plot|site|parking|bigger|larger|smaller)\b/;
// "render" alone is also a finish (Phase 30 warm render), so only unambiguous media wording or "render a/an/me …" counts as a media request.
const MEDIA = /\b(?:renderings?|photo-?realistic|panoramas?|videos?|walkthroughs?|images?|visuali[sz]ations?|pictures?|photos?)\b|\brender (?:a|an|me|some)\b/;

const PRESERVE_CLAUSE = /\b(?:keep|keeping|preserve|preserving|retain|maintain|leave|unchanged|untouched|as it is|as they are|do not|don't|dont|never|without)\b/;
/** The clauses that request something, with preservation clauses removed (split as the Phase 30 grammar splits them). */
const requesting = (t: string) => t.replace(/\b(but|while|whereas|and keep|keep|keeping|preserve|preserving|retain|maintain|leave|do not|don't|without)\b/g, '|$1')
  .split(/[|.;!?\n]/).map(c => c.trim()).filter(c => c && !PRESERVE_CLAUSE.test(c)).join('. ');
const normalize = (raw: string) => raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function selectedIndex(t: string): number | null | undefined {
  const option = /\b(?:option|alternative|choice|number|no\.?)\s*#?\s*([1-8])\b/.exec(t);
  if (option) return Number(option[1]);
  const ordinal = /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\b(?:\s+\w+){0,3}?\s+(?:option|one|alternative|choice|finish|scheme|proposal)\b/.exec(t);
  if (ordinal) return ORDINALS[ordinal[1]!]!;
  if (/\b(?:that|this|the) (?:option|alternative|one)\b/.test(t)) return null;
  return undefined;
}

export function classifyTurn(raw: string, levels: { id: string; index: number }[], hasStructuredOperation: boolean): Classified {
  const t = normalize(raw), revision = interpretRevision(raw, levels), changes = revision.requestedChanges.map(c => c.changeClass);
  // The Phase 30 grammar stops at restore wording, so "keep …" clauses beside a restore are read separately; an explicit constraint is never dropped.
  if (changes.includes('RESTORE')) {
    const kept = interpretRevision(raw.replace(/\b(?:restore|revert|roll ?back|go back to|undo)\b/gi, 'consider'), levels);
    revision.preservation = kept.preservation;
    revision.ambiguities.push(...kept.ambiguities.filter(q => /storey is meant/.test(q)));
  }
  const active = requesting(t), question = QUESTION.test(t), changing = CHANGE.test(active);

  // 0. A structured operation is the user's explicit, validated input: it decides the turn, whatever the wording.
  if (hasStructuredOperation) return { kind: 'CHANGE_REQUEST', family: 'ZONE_REGENERATION', revision };
  // 1. Selecting an option that was listed earlier ("use the second façade option we discussed").
  if (/\b(?:use|choose|pick|go with|select|apply|take|prefer|like)\b/.test(t)) {
    const index = selectedIndex(t);
    if (index !== undefined) return { kind: 'OPTION_SELECTION', index, revision };
  }
  // 2. Asking for options. Only exterior finishes have a bounded, supported option set (the Phase 30 presets).
  if (/\b(?:options?|alternatives?|choices?|suggest\w*|ideas?|presets?)\b/.test(t) && /\b(?:facades?|exterior|finish(?:es)?|cladding|appearance|colou?rs?|elevations?)\b/.test(t)
    && (question || /\b(?:suggest|show|list|give|offer)\b/.test(t))) return { kind: 'OPTIONS' };
  // 3. Memory: what has been decided or must be kept.
  if (/\b(?:decided|decisions?|agreed|constraints?|protected|preserv\w*|remember|requirements so far|what have we|what did we)\b/.test(t) && (question || /\b(?:list|show|remind|summari[sz]e)\b/.test(t)))
    return { kind: 'DECISION_QUERY' };
  // 4. Comparison of revisions or of the pending proposal.
  if (/\b(?:compare|comparison|difference|differences|diff|versus|vs\.?|what changed|changed since)\b/.test(t)) {
    const n = /\brevision\s*(?:#|number|no\.?)?\s*(\d{1,4})\b/.exec(t);
    const subject = /\b(?:this|the|pending|current) (?:proposal|candidate|change|option)\b|\bproposal\b/.test(t) ? 'PENDING_ACTION' as const
      : n ? { revisionNumber: Number(n[1]) } : /\b(?:original|first) (?:revision|version|design)\b/.test(t) ? 'ORIGINAL' as const : 'PREVIOUS' as const;
    return { kind: 'COMPARISON', subject };
  }
  // 5. Engineering questions are answered only from the Phase 35 assessment and its evidence classes.
  if (question && !changes.includes('EXTERIOR_APPEARANCE')) {
    const domains = [...new Set(ENGINEERING.filter(([r]) => r.test(t)).flatMap(([, d]) => d))];
    if (domains.length) return { kind: 'ENGINEERING_QUESTION', domains,
      asksForValue: /\b(?:what|which|how much|how many)\b[^?]*\b(?:value|factor|load|clause|edition|size|rate|kn|mpa|depth|thickness|cost|budget|price)\b/.test(t) };
  }
  // 6. Project questions answered from records.
  if (question && !changing) {
    const topics: Topic[] = [];
    if (/\b(?:floors?|storeys?|stories|levels?)\b/.test(t)) topics.push('STOREYS');
    if (/\b(?:rooms?|bedrooms?|bathrooms?|spaces?|kitchen|offices?)\b/.test(t)) topics.push('ROOMS');
    if (/\b(?:height|tall|high)\b/.test(t)) topics.push('HEIGHT');
    if (/\b(?:site|plot|land|north|orientation)\b/.test(t)) topics.push('SITE');
    if (/\b(?:revisions?|versions?|history)\b/.test(t)) topics.push('REVISION');
    if (/\b(?:qa|quality|check(?:ed)?|valid)\b/.test(t)) topics.push('QA');
    if (/\b(?:windows?|doors?|openings?)\b/.test(t)) topics.push('OPENINGS');
    if (/\b(?:stairs?|staircases?)\b/.test(t)) topics.push('STAIRS');
    if (/\b(?:facades?|exterior|finish|appearance|colou?r)\b/.test(t)) topics.push('APPEARANCE');
    if (/\b(?:brief|budget|program(?:me)?)\b/.test(t)) topics.push('BRIEF');
    if (/\b(?:can you|supported|capabilit\w*|able to|what can)\b/.test(t)) topics.push('CAPABILITIES');
    return { kind: 'PROJECT_QUESTION', topics };
  }
  // 7. Change requests and constraints.
  if (MEDIA.test(active))
    return { kind: 'UNSUPPORTED', revision, unsupported: { code: 'MEDIA_GENERATION_UNSUPPORTED', message: 'Renders, images, panoramas and video are not produced by this backend.',
      alternative: 'The Phase 29 GLB scene of a revision (up to two storeys) can be viewed instead.' } };
  if (/\b(?:floor|storey|ceiling)[- ]to[- ](?:floor|ceiling)\b|\b(?:floor|storey|ceiling) heights?\b/.test(active) && changing)
    return { kind: 'UNSUPPORTED', revision, unsupported: { code: 'STOREY_HEIGHT_CHANGE_UNSUPPORTED', message: 'No supported operation changes storey or ceiling heights.',
      alternative: 'Supply a revised model through the supplied-revision route; TYPICAL_FLOOR regeneration requires storeys of equal height and does not change them.' } };
  if (/\b(?:stairs?|staircases?|stairways?)\b/.test(active) && /\b(?:move|relocate|widen|rotate|resize|add|remove|change|replace)\b/.test(active))
    return { kind: 'UNSUPPORTED', revision, unsupported: { code: 'STAIR_CHANGE_UNSUPPORTED', message: 'No supported operation moves, resizes or replaces a stair.',
      alternative: 'Requirement regeneration (up to two storeys) places the generator\'s straight stair; it regenerates the whole design.' } };
  if (changes.includes('RESTORE')) return { kind: 'CHANGE_REQUEST', family: 'RESTORE', revision };
  if (changes.includes('EXTERIOR_APPEARANCE')) return { kind: 'CHANGE_REQUEST', family: 'EXTERIOR_APPEARANCE', revision };
  if (hasStructuredOperation || /\b(?:typical floors?|fenestration)\b|\bregenerat\w*\b(?:\s+[\w-]+){0,4}?\s+(?:windows?|zones?|storeys?|floors?|layouts?|sections?|skin)\b/.test(active))
    return { kind: 'CHANGE_REQUEST', family: 'ZONE_REGENERATION', revision };
  if (changes.includes('STRUCTURE')) return { kind: 'UNSUPPORTED', revision, unsupported: { code: 'STRUCTURAL_CHANGE_UNSUPPORTED',
    message: 'No supported operation designs or changes the structural system; Building Model V2 has no load-path elements.', alternative: null } };
  if (changes.includes('INTERIOR_APPEARANCE')) return { kind: 'UNSUPPORTED', revision, unsupported: { code: 'INTERIOR_APPEARANCE_UNSUPPORTED',
    message: 'Interior finishes are not modelled, so they cannot be changed or preserved.', alternative: 'Exterior wall finishes can be changed (Phase 30).' } };
  if (changes.includes('OPENING_GEOMETRY') && !REQUIREMENT_WORDS.test(active)) return { kind: 'CHANGE_REQUEST', family: 'ZONE_REGENERATION', revision };
  if (changing && REQUIREMENT_WORDS.test(active)) return { kind: 'CHANGE_REQUEST', family: 'REQUIREMENTS', revision };
  if (revision.preservation.length && !changes.length) return { kind: 'CONSTRAINT', revision };
  if (changes.includes('PHYSICAL_GLAZING')) return { kind: 'CHANGE_REQUEST', family: 'EXTERIOR_APPEARANCE', revision };
  if (changes.length) return { kind: 'UNSUPPORTED', revision, unsupported: { code: 'GEOMETRY_CHANGE_UNSUPPORTED',
    message: `No supported operation performs this change (${changes.join(', ').toLowerCase()}).`,
    alternative: 'Room programme changes are supported through requirement regeneration (up to two storeys); windows through FENESTRATION regeneration.' } };
  if (REQUIREMENT_WORDS.test(active) && /\d/.test(active)) return { kind: 'CHANGE_REQUEST', family: 'REQUIREMENTS', revision };
  return { kind: 'UNRECOGNIZED', revision };
}
