import { FACADES, REVISION_INTENT_VERSION, RevisionIntentSchema, type ChangeClass, type Facade, type PresetId, type RevisionIntent } from './contracts.js';

/**
 * Deterministic, finite revision grammar (mirrors the Phase 18 approach): it only recognises vocabulary it can map to supported
 * scopes; anything else becomes an ambiguity or an unsupported item. It never invents rooms, levels or elements — ids are
 * resolved by the planner against the actual model.
 */
type Level = { id: string; index: number };
const PRESERVE = /\b(keep|keeping|preserve|preserving|retain|maintain|leave|unchanged|untouched|as it is|as they are|exact|same|do not|don't|dont|never|without)\b/;
const has = (s: string, r: RegExp) => r.test(s);
const APPEARANCE_WORDS = /\b(colou?r|finish|appearance|look|style|material|cladding|paint|painted|render|tint|aesthetic|scheme|palette|redesign|modern|contemporary|darker|lighter|warmer|cooler|stone|metallic|reflective)\b/;
const EXTERIOR_WORDS = /\b(exterior|facade|facades|outside|outer|cladding|elevation|elevations|envelope|outer walls|exterior walls)\b/;
const INTERIOR_WORDS = /\b(interior|inside|living room|bedroom|kitchen|bathroom|dining|study|room|rooms|hall|hallway)\b/;
const GEOMETRY_VERBS = /\b(bigger|larger|enlarge|widen|wider|expand|extend|taller|higher|move|moving|add|adding|remove|removing|more|fewer|resize|increase|reduce|shrink|demolish|relocate|split|merge)\b/;
const GLASS = /\b(glass|glazing|glazed|curtain ?wall|curtain-wall)\b/;
const GLASS_QUALIFIER = /\b(inspired|look|like|appearance|finish|style|effect|tint|tinted|colou?r|feel|aesthetic)\b|-inspired|-like/;

function preset(s: string): PresetId | null {
  if (/\b(glass|blue|grey|gray|reflective|metallic|steel)\b/.test(s)) return 'glass-inspired-blue-grey';
  if (/\b(dark|darker|charcoal|black)\b/.test(s)) return 'dark-contemporary';
  if (/\b(warm|warmer|terracotta|sand|beige|render)\b/.test(s)) return 'warm-render';
  if (/\b(stone|light|lighter|white|limestone)\b/.test(s)) return 'light-stone';
  return null;
}
function levelRef(s: string, levels: Level[]): { levelId: string | null; ambiguous: boolean } | null {
  const sorted = [...levels].sort((a, b) => a.index - b.index);
  if (/\bground (floor|level|storey)\b/.test(s)) return { levelId: sorted[0]?.id ?? null, ambiguous: false };
  if (/\b(upper|top) (floor|level|storey)\b/.test(s)) return { levelId: sorted.length > 1 ? sorted[sorted.length - 1]!.id : null, ambiguous: sorted.length < 2 };
  const n = /\b(?:level|storey) (\d{1,2})\b/.exec(s);
  if (n) { const l = sorted.find(x => x.index === Number(n[1])); return { levelId: l?.id ?? null, ambiguous: !l }; }
  if (/\b(first|second) floor\b/.test(s)) return { levelId: null, ambiguous: true }; // UK/US floor numbering differs: never guess.
  return null;
}

export function interpretRevision(raw: string, levels: Level[]): RevisionIntent {
  const text = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const clauses = text.replace(/\b(but|while|whereas|and keep|keep|keeping|preserve|preserving|retain|maintain|leave|do not|don't|without)\b/g, '|$1')
    // Commas do not split: a preservation list ("keep the plans, rooms, stairs and structure") stays one clause.
    .split(/[|.;!?\n]/).map(c => c.trim()).filter(Boolean);
  const intent: RevisionIntent = { intentVersion: REVISION_INTENT_VERSION, source: 'TEXT', text: raw, operation: null, appearance: null, restore: null,
    requestedChanges: [], preservation: [], ambiguities: [], unsupported: [] };
  const change = (changeClass: ChangeClass, phrase: string) => { if (intent.requestedChanges.length < 16 && !intent.requestedChanges.some(c => c.changeClass === changeClass)) intent.requestedChanges.push({ changeClass, phrase: phrase.slice(0, 200) }); };
  const keep = (scope: RevisionIntent['preservation'][number]['scope'], phrase: string, levelId: string | null = null) => {
    if (intent.preservation.length < 16 && !intent.preservation.some(p => p.scope === scope && p.levelId === levelId)) intent.preservation.push({ scope, levelId, phrase: phrase.slice(0, 200) });
  };
  const ask = (q: string) => { if (intent.ambiguities.length < 8 && !intent.ambiguities.includes(q)) intent.ambiguities.push(q); };

  if (/\b(restore|revert|roll ?back|go back to|undo)\b/.test(text)) {
    const n = /\brevision (\d{1,4})\b/.exec(text);
    const reference = n ? `number:${Number(n[1])}` : /\b(original|first)\b/.test(text) ? 'original' : /\b(previous|last|prior)\b/.test(text) ? 'previous' : null;
    change('RESTORE', text);
    if (reference) { intent.operation = 'RESTORE'; intent.restore = { sourceRevisionId: null, reference }; }
    else ask('Which accepted revision should be restored (for example "revision 1" or "the original design")?');
    return RevisionIntentSchema.parse(intent);
  }

  let finish: PresetId | null = null;
  const facades: Facade[] = [];
  for (const c of clauses) {
    if (PRESERVE.test(c)) {
      const lvl = levelRef(c, levels);
      if (lvl) { if (lvl.ambiguous || !lvl.levelId) ask(`Which storey is meant by "${c.slice(0, 80)}"? Floor numbering is ambiguous for this building.`); else keep('LEVEL', c, lvl.levelId); }
      if (has(c, /\b(floor ?plans?|blueprints?|layouts?|plans?)\b/)) keep('FLOOR_PLANS', c);
      if (has(c, /\b(rooms?|internal rooms?)\b/)) keep('ROOMS', c);
      if (has(c, /\b(stairs?|staircases?)\b/)) keep('STAIRS', c);
      if (has(c, /\b(structure|structural|columns?|beams?|slabs?|frame)\b/)) keep('STRUCTURE', c);
      if (has(c, /\b(windows?|doors?|openings?)\b/)) keep('OPENINGS', c);
      if (has(c, /\bwalls?\b/) && !has(c, APPEARANCE_WORDS)) keep('WALLS', c);
      if (has(c, /\b(interior|inside|internal)\b/)) keep('INTERIOR', c);
      if (has(c, /\b(dimensions?|size|footprint|massing|geometry|shape|height)\b/)) keep(has(c, /\b(geometry|shape)\b/) ? 'BUILDING_GEOMETRY' : 'BUILDING_DIMENSIONS', c);
      if (has(c, EXTERIOR_WORDS) && has(c, APPEARANCE_WORDS)) keep('EXTERIOR_APPEARANCE', c);
      continue;
    }
    const geometric = has(c, GEOMETRY_VERBS);
    if (geometric && has(c, /\b(windows?|doors?|openings?|glazing)\b/)) change('OPENING_GEOMETRY', c);
    else if (geometric && has(c, /\b(rooms?|living room|bedroom|kitchen|bathroom)\b/)) change('ROOM_GEOMETRY', c);
    else if (geometric && has(c, /\bwalls?\b/)) change('WALL_GEOMETRY', c);
    else if (geometric && has(c, /\b(floors?|storeys?|stories|tower|building|footprint|extension)\b/)) change('BUILDING_GEOMETRY', c);
    if (has(c, /\b(structure|structural|columns?|beams?)\b/) && /\b(change|modify|replace|redesign|move|remove|add)\b/.test(c)) change('STRUCTURE', c);
    if (has(c, GLASS) && !has(c, GLASS_QUALIFIER)) change('PHYSICAL_GLAZING', c);
    const appearanceWords = has(c, APPEARANCE_WORDS) || (has(c, GLASS) && has(c, GLASS_QUALIFIER));
    if (appearanceWords && has(c, INTERIOR_WORDS) && !has(c, EXTERIOR_WORDS)) change('INTERIOR_APPEARANCE', c);
    else if (appearanceWords && (has(c, EXTERIOR_WORDS) || (!has(c, INTERIOR_WORDS) && has(c, /\b(building|house|villa|walls)\b/)))) {
      change('EXTERIOR_APPEARANCE', c);
      finish ??= preset(c);
      for (const f of FACADES) if (new RegExp(`\\b${f.toLowerCase()}(ern)?\\b`).test(c) && !facades.includes(f)) facades.push(f);
    }
  }
  if (intent.requestedChanges.some(c => c.changeClass === 'EXTERIOR_APPEARANCE')) {
    if (!finish) ask('Which exterior finish should be applied? Available: glass-inspired blue-grey, dark contemporary, warm render, light stone.');
    else { intent.operation = 'APPEARANCE_MODIFY'; intent.appearance = { target: { kind: 'EXTERIOR_WALLS', facades: facades.length ? FACADES.filter(f => facades.includes(f)) : [...FACADES], levelIds: null }, finish: { presetId: finish } }; }
  }
  if (intent.requestedChanges.some(c => c.changeClass === 'PHYSICAL_GLAZING'))
    ask('Do you mean a glass-like visual appearance (geometry unchanged), or physically more/larger glazing (a geometry change that this operation does not perform)?');
  if (!intent.requestedChanges.length) ask('No supported modification was recognised. Describe the exterior finish to change, or the revision to restore.');
  return RevisionIntentSchema.parse(intent);
}
