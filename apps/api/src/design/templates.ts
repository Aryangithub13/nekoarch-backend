import { PRESETS, type Facade, type PresetId } from '../revision/contracts.js';
import type { BriefField, ExteriorOutput, InteriorOutput } from '../contracts/design-concepts.js';

/**
 * design-concept-templates-v1: a small, fixed catalogue of visual schemes. Selection is deterministic: schemes are ranked by how many of
 * the stated style words they share (catalogue order breaks ties), then rotated by `variation`. Nothing is generated, measured or priced;
 * the wording is fixed and passes the same guard as provider output. References are recorded as inputs but never interpreted here.
 */
type Palette = InteriorOutput['palette'];
const p = (role: Palette[number]['role'], hex: string, name: string) => ({ role, hex, name });

const INTERIOR = [
  { title: 'Warm minimal', match: ['minimal', 'minimalist', 'warm', 'calm', 'simple', 'clean', 'serene'], styleKeywords: ['minimal', 'warm', 'calm'],
    summary: 'Calm, uncluttered rooms in warm neutrals, with one earthy accent used sparingly.',
    palette: [p('BASE', '#f2ece4', 'Warm white'), p('SECONDARY', '#c8b6a6', 'Sand'), p('ACCENT', '#8a5a44', 'Terracotta'), p('NEUTRAL', '#4a4a48', 'Charcoal')],
    finishes: { floor: 'Light timber-look flooring with a matte finish', walls: 'Warm white matte paint', ceiling: 'Plain white ceiling' },
    lighting: 'Soft, warm ambient light, with focused task lights where activities happen.' },
  { title: 'Light natural', match: ['natural', 'light', 'airy', 'bright', 'scandinavian', 'green', 'organic', 'fresh'], styleKeywords: ['natural', 'light', 'airy'],
    summary: 'Bright, airy rooms with pale timber tones and soft green accents.',
    palette: [p('BASE', '#fafaf7', 'Off-white'), p('SECONDARY', '#d9e2d5', 'Sage mist'), p('ACCENT', '#7a9a7e', 'Sage'), p('NEUTRAL', '#b08d62', 'Oak')],
    finishes: { floor: 'Pale timber-look flooring', walls: 'Off-white matte paint with one sage feature wall', ceiling: 'Plain white ceiling' },
    lighting: 'Daylight-led rooms with diffuse ambient light and warm lamps for the evening.' },
  { title: 'Earthy traditional', match: ['traditional', 'earthy', 'indian', 'heritage', 'vernacular', 'rustic', 'classic', 'ethnic'], styleKeywords: ['traditional', 'earthy', 'textured'],
    summary: 'Rich, earthy rooms with ochre and brick tones and handcrafted textures.',
    palette: [p('BASE', '#efe3cf', 'Ivory'), p('SECONDARY', '#c98b4f', 'Ochre'), p('ACCENT', '#8c3b2e', 'Brick red'), p('NEUTRAL', '#3d3a33', 'Deep brown')],
    finishes: { floor: 'Terracotta-look or stone-look tiles', walls: 'Ivory lime-wash-look paint', ceiling: 'Ivory ceiling with timber-look accents' },
    lighting: 'Warm, low-glare light with decorative pendants and wall lights.' },
  { title: 'Contemporary contrast', match: ['modern', 'contemporary', 'bold', 'dark', 'luxury', 'elegant', 'industrial', 'sleek'], styleKeywords: ['contemporary', 'bold', 'elegant'],
    summary: 'Crisp contemporary rooms with cool greys, a deep slate tone and brass highlights.',
    palette: [p('BASE', '#f5f5f5', 'Soft white'), p('SECONDARY', '#9aa3ab', 'Cool grey'), p('ACCENT', '#c9a227', 'Brass'), p('NEUTRAL', '#2f3e46', 'Slate')],
    finishes: { floor: 'Large-format stone-look tiles in a soft grey', walls: 'Soft white paint with a slate feature wall', ceiling: 'Plain white ceiling' },
    lighting: 'Layered lighting: even ambient light, accent light on features, and warm task lights.' },
] as const;

const EXTERIOR: readonly { presetId: PresetId; title: string; match: readonly string[]; styleKeywords: string[]; summary: string; palette: Palette; rationale: string; landscape: string }[] = [
  { presetId: 'light-stone', title: 'Light stone', match: ['stone', 'light', 'classic', 'natural', 'traditional', 'heritage', 'timeless'], styleKeywords: ['classic', 'light', 'natural'],
    summary: 'A light, stone-inspired facade appearance that reads as calm and timeless.',
    palette: [p('BASE', '#e6e1d6', 'Light stone'), p('SECONDARY', '#bfb6a4', 'Warm grey'), p('ACCENT', '#6b5b4b', 'Umber')],
    rationale: 'A light stone appearance keeps the massing quiet and pairs with most landscape palettes.', landscape: 'Pair with soft planting and pale paving tones.' },
  { presetId: 'warm-render', title: 'Warm render', match: ['warm', 'earthy', 'render', 'rustic', 'mediterranean', 'traditional', 'vernacular'], styleKeywords: ['warm', 'earthy', 'welcoming'],
    summary: 'A warm, render-like facade appearance with an earthy, welcoming character.',
    palette: [p('BASE', '#e0c7a3', 'Warm sand'), p('SECONDARY', '#c39a6b', 'Clay'), p('ACCENT', '#7b4a2e', 'Burnt sienna')],
    rationale: 'A warm render appearance gives a welcoming, earthy character to every elevation.', landscape: 'Pair with terracotta pots and drought-tolerant planting.' },
  { presetId: 'dark-contemporary', title: 'Dark contemporary', match: ['modern', 'contemporary', 'dark', 'bold', 'minimal', 'industrial', 'sleek'], styleKeywords: ['contemporary', 'bold', 'graphic'],
    summary: 'A dark, contemporary facade appearance with a strong graphic presence.',
    palette: [p('BASE', '#2e2e30', 'Charcoal'), p('SECONDARY', '#5c5f63', 'Graphite'), p('ACCENT', '#c8a165', 'Bronze')],
    rationale: 'A dark contemporary appearance emphasises the building silhouette.', landscape: 'Pair with bright green planting and light gravel for contrast.' },
  { presetId: 'glass-inspired-blue-grey', title: 'Blue-grey glass-inspired', match: ['glass', 'sleek', 'blue', 'modern', 'commercial', 'contemporary', 'corporate'], styleKeywords: ['sleek', 'cool', 'contemporary'],
    summary: 'A cool blue-grey facade appearance inspired by glass; visual appearance only, never real glazing.',
    palette: [p('BASE', '#54697f', 'Blue-grey'), p('SECONDARY', '#8c9aa8', 'Mist grey'), p('ACCENT', '#d7dde3', 'Pale silver')],
    rationale: 'A blue-grey glass-inspired appearance reads as cool and contemporary; it changes no glazing.', landscape: 'Pair with clipped hedges and cool grey paving.' },
];

const words = (values: readonly string[]) => new Set(values.join(' ').toLowerCase().normalize('NFKC').split(/[^\p{L}]+/u).filter(Boolean));
function rank<T extends { match: readonly string[] }>(catalogue: readonly T[], style: Set<string>, variation: number): T[] {
  const scored = catalogue.map((t, i) => ({ t, i, score: t.match.filter(m => style.has(m)).length })).sort((a, b) => b.score - a.score || a.i - b.i).map(x => x.t);
  const k = variation % scored.length;
  return [...scored.slice(k), ...scored.slice(0, k)];
}
/** Style words from the caller's text and the brief's keywords; returns which brief field, if any, contributed. */
function styleWords(text: string | null, keywords: readonly string[]) {
  const fromBrief = words(keywords), all = words([text ?? '', ...keywords]);
  return { all, briefFields: (fromBrief.size ? ['style.keywords'] : []) as BriefField[] };
}

const SPACE_NOTES: readonly [RegExp, string][] = [
  [/bed|sleep|guest/i, 'Keep this room restful: base and secondary colours on the walls, the accent only in textiles.'],
  [/kitchen|pantry|cook/i, 'Prefer light, easy-to-clean finishes; keep the accent to a backsplash or cabinet fronts.'],
  [/bath|toilet|wash|wc|powder/i, 'Use the base colour on tiled surfaces and the accent in small details.'],
  [/living|lounge|family|drawing/i, 'Layer ambient and accent light; use the accent colour on one feature wall or in furnishings.'],
  [/dining/i, 'Centre the room on a decorative pendant; keep walls in the base colour.'],
  [/study|office|work/i, 'Keep the palette quiet and add a focused task light.'],
];
const spaceNote = (s: { name: string; classification: string }) => SPACE_NOTES.find(([re]) => re.test(`${s.classification} ${s.name}`))?.[1]
  ?? 'Follow the base palette and introduce the accent in movable items.';

export function interiorTemplates(input: { alternatives: number; variation: number; text: string | null; styleKeywords: readonly string[];
  spaces: readonly { spaceId: string; name: string; classification: string }[]; spaceNotes: number }): InteriorOutput[] {
  const style = styleWords(input.text, input.styleKeywords);
  return rank(INTERIOR, style.all, input.variation).slice(0, input.alternatives).map(t => ({
    title: t.title, summary: t.summary, styleKeywords: [...t.styleKeywords], palette: t.palette.map(x => ({ ...x })), finishes: { ...t.finishes }, lighting: t.lighting,
    spaces: input.spaces.slice(0, input.spaceNotes).map(s => ({ spaceId: s.spaceId, note: spaceNote(s) })),
    basis: { briefFields: style.briefFields, referenceIds: [] },
  }));
}
export function exteriorTemplates(input: { alternatives: number; variation: number; text: string | null; styleKeywords: readonly string[]; facades: readonly Facade[] }): ExteriorOutput[] {
  const style = styleWords(input.text, input.styleKeywords);
  return rank(EXTERIOR, style.all, input.variation).slice(0, input.alternatives).map(t => ({
    title: t.title, summary: t.summary, styleKeywords: [...t.styleKeywords], palette: t.palette.map(x => ({ ...x })), facadePresetId: t.presetId,
    facades: [...input.facades], facadeRationale: t.rationale, landscapeNote: t.landscape, basis: { briefFields: style.briefFields, referenceIds: [] },
  }));
}
export const presetLabel = (id: PresetId) => PRESETS[id].label;
