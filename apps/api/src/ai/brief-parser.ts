import { synonymIndex, SPACE_KINDS, type SpaceKind, type BuildingType } from '@designflow/generator';
import { BriefPatchSchema, type BriefPatch, type BriefSpace } from './brief.js';

/**
 * Offline brief reader: understands everyday English/Hinglish descriptions of a building without a language model.
 * It reads what it can and never refuses: unknown words are simply ignored, and a model (when configured) fills gaps.
 */
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, single: 1, two: 2, double: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7 };
const num = (s: string | undefined): number | undefined => s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s.toLowerCase()];
const COUNT = '(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ek|do|teen|char|chaar|paanch|panch)';
const ORDINAL: Record<string, number> = { ground: 0, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, top: -1, upper: 1, terrace: -1 };
export const CITIES = ['mumbai', 'delhi', 'new delhi', 'bengaluru', 'bangalore', 'hyderabad', 'chennai', 'kolkata', 'pune', 'ahmedabad', 'jaipur', 'lucknow', 'kanpur', 'nagpur', 'indore', 'bhopal', 'patna', 'vadodara', 'surat', 'ludhiana', 'agra', 'nashik', 'rajkot', 'varanasi', 'srinagar', 'amritsar', 'chandigarh', 'mohali', 'gurgaon', 'gurugram', 'noida', 'ghaziabad', 'faridabad', 'dehradun', 'coimbatore', 'kochi', 'cochin', 'trivandrum', 'thiruvananthapuram', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'visakhapatnam', 'vizag', 'vijayawada', 'guwahati', 'bhubaneswar', 'raipur', 'ranchi', 'jodhpur', 'udaipur', 'goa', 'panaji', 'madurai', 'aurangabad', 'jabalpur', 'gwalior', 'meerut', 'prayagraj', 'allahabad', 'thane', 'navi mumbai', 'jammu', 'shimla', 'siliguri'];
const BUILDING_WORDS: [RegExp, BuildingType, number?][] = [
  [/\btriplex\b/, 'house', 3], [/\bduplex\b/, 'house', 2], [/\bvilla\b/, 'villa'], [/\bbungalow|kothi\b/, 'villa'], [/\bfarm ?house\b/, 'villa'],
  [/\b(?:apartment|flats?|residential) (?:building|block|complex|tower)\b|\bapartments\b/, 'apartment'],
  [/\b(?:office|corporate|it company|startup|co-?working|workspace)\b(?! room)/, 'office'], [/\b(?:cafe|café|coffee shop|bakery|tea house)\b/, 'cafe'],
  [/\b(?:restaurant|dhaba|eatery|food court|bistro)\b/, 'restaurant'], [/\b(?:shop|showroom|boutique|retail|store front|supermarket|mart)\b(?! room)/, 'retail'],
  [/\b(?:clinic|hospital|dental|diagnostic|nursing home|polyclinic)\b/, 'clinic'], [/\b(?:school|coaching|tuition centre|tuition center|academy|college|institute|classroom)\b/, 'school'],
  [/\b(?:community hall|banquet|marriage hall|event venue|club ?house)\b/, 'community'], [/\b(?:studio|workshop|atelier)\b(?= building| space)?/, 'studio'],
  [/\b(?:house|home|ghar|makan|residence|dwelling|cottage)\b/, 'house'], [/\bmixed[- ]use\b/, 'mixed-use'],
];

interface Hit { kind: SpaceKind; count: number; explicitCount: boolean; start: number; end: number; ensuite: boolean; level?: number; areaM2?: number }

function toMm(value: number, unit: string): number {
  const u = unit.toLowerCase();
  return Math.round(value * (u.startsWith('m') && !u.startsWith('mm') ? 1000 : u === 'mm' ? 1 : u === 'cm' ? 10 : u.startsWith('y') || u === 'gaj' ? 914.4 : 304.8));
}

export function parseBrief(input: string): BriefPatch {
  const original = input.normalize('NFKC');
  let t = ' ' + original.toLowerCase().replace(/[–—]/g, '-').replace(/[’']/g, "'").replace(/\s+/g, ' ') + ' ';
  const blank = (start: number, end: number) => { t = t.slice(0, start) + ' '.repeat(end - start) + t.slice(end); };
  const patch: Partial<BriefPatch> & { spaces: BriefSpace[]; remove: SpaceKind[]; add: SpaceKind[]; resize: { kind: SpaceKind; factor: number }[]; notes: string[] } = { spaces: [], remove: [], add: [], resize: [], notes: [] };

  // Budget before plot sizes so "50 lakh" never reads as a dimension.
  t = t.replace(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lakh|l|k|thousand)\b/g, (m, n: string, u: string) => {
    const f = /^cr/.test(u) ? 1e7 : /^l/.test(u) ? 1e5 : 1e3;
    const v = Math.round(Number(n) * f);
    if (v >= 100_000) patch.budgetInr = v;
    return ' '.repeat(m.length);
  });
  t = t.replace(/(?:₹|rs\.?|inr)\s*([\d,]{6,})/g, (m, n: string) => { patch.budgetInr = Number(n.replace(/,/g, '')); return ' '.repeat(m.length); });

  // Room sizes: "bedroom 12x14 ft" / "12 x 14 bedroom" become target areas for that room kind.
  const roomSizes: { at: number; areaM2: number }[] = [];
  const dim = '(\\d+(?:\\.\\d+)?)\\s*(?:\'|ft|feet|foot|m|mtr|meters?|metres?)?\\s*(?:x|×|\\*|by)\\s*(\\d+(?:\\.\\d+)?)\\s*(\'|ft|feet|foot|m|mtr|meters?|metres?|yards?|yd|gaj)?';
  // Plot: dimensions next to plot/site/land words win; otherwise the largest pair that is not attached to a room.
  const pairs: { start: number; end: number; w: number; d: number; unit?: string; plotWord: boolean }[] = [];
  for (const m of t.matchAll(new RegExp(dim, 'g'))) {
    const before = t.slice(Math.max(0, m.index - 24), m.index), after = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
    pairs.push({ start: m.index, end: m.index + m[0].length, w: Number(m[1]), d: Number(m[2]), ...(m[3] ? { unit: m[3] } : {}), plotWord: /\b(?:plot|site|land|plot size|area of|on a|on an)\b/.test(before) || /^\s*(?:ft|feet|m)?\s*(?:plot|site|land)/.test(after) });
  }
  const unitOf = (p: { w: number; d: number; unit?: string }) => p.unit ? p.unit : Math.max(p.w, p.d) <= 25 ? 'm' : 'ft';
  const plot = pairs.find(p => p.plotWord) ?? [...pairs].sort((a, b) => toMm(b.w, unitOf(b)) * toMm(b.d, unitOf(b)) - toMm(a.w, unitOf(a)) * toMm(a.d, unitOf(a)))[0];
  for (const p of pairs) {
    const w = toMm(p.w, unitOf(p)), d = toMm(p.d, unitOf(p));
    if (p === plot && (pairs.length === 1 || p.plotWord || w * d >= 50e6)) {
      if (w >= 3000 && d >= 3000 && w <= 120000 && d <= 120000) patch.site = { widthMm: Math.min(w, d), depthMm: Math.max(w, d) };
    } else if (w * d < 80e6) roomSizes.push({ at: p.start, areaM2: Math.round(w * d / 1e5) / 10 });
    blank(p.start, p.end);
  }
  // Plot by area: "1200 sq ft", "200 gaj", "300 sq m", "5 marla"; assumes a 2:3 plot when only the area is known.
  if (!patch.site) t = t.replace(/(\d+(?:\.\d+)?)\s*(sq\.?\s*ft|sqft|square feet|sq\.?\s*feet|sft|sq\.?\s*yards?|square yards?|gaj|sq\.?\s*m|sqm|square met(?:er|re)s?|marla|kanal)\b/g, (m, n: string, u: string) => {
    const a = Number(n), m2 = /ft|feet|sft/.test(u) ? a * 0.092903 : /yard|gaj/.test(u) ? a * 0.836127 : /marla/.test(u) ? a * 25.29 : /kanal/.test(u) ? a * 505.857 : a;
    if (m2 >= 20 && m2 <= 14400) { const w = Math.round(Math.sqrt(m2 * 2 / 3) * 10) * 100; patch.site = { widthMm: w, depthMm: Math.round(m2 * 1e6 / w / 100) * 100 }; }
    return ' '.repeat(m.length);
  });

  // Storeys.
  const floorRules: [RegExp, (m: RegExpExecArray) => number][] = [
    [/\bg\s*\+\s*(\d)\b/, m => Number(m[1]) + 1], [/\bground\s*(?:\+|plus)\s*(\d|one|two|three|four)\b/, m => (num(m[1]) ?? 0) + 1],
    [new RegExp(`\\b${COUNT}[ -]*(?:floors?|stor(?:e)?ys?|levels?|manzil(?:a)?)\\b`), m => num(m[1]) ?? 1], [/\b(?:single|one)[ -](?:stor(?:e)?y|floor|level)\b/, () => 1],
    [/\b(?:double|two)[ -](?:stor(?:e)?y|floor|level)\b/, () => 2], [/\btriplex\b/, () => 3], [/\bduplex\b/, () => 2],
  ];
  for (const [re, f] of floorRules) { const m = re.exec(t); if (m) { const n = f(m); if (n >= 1 && n <= 10) patch.floors = n; blank(m.index, m.index + m[0].length); break; } }

  // Building type.
  for (const [re, type, floors] of BUILDING_WORDS) if (re.test(t)) { patch.buildingType = type; if (floors && patch.floors === undefined) patch.floors = floors; break; }

  // BHK: N bedrooms plus hall (living) and kitchen.
  const bhk = /\b(\d+)\s*-?\s*(?:bhk|bedroom hall kitchen)\b/.exec(t);
  const hits: Hit[] = [];
  if (bhk) {
    const n = Number(bhk[1]);
    hits.push({ kind: 'bedroom', count: n, explicitCount: true, start: bhk.index, end: bhk.index + bhk[0].length, ensuite: false }, { kind: 'living', count: 1, explicitCount: false, start: bhk.index, end: bhk.index, ensuite: false }, { kind: 'kitchen', count: 1, explicitCount: false, start: bhk.index, end: bhk.index, ensuite: false });
    blank(bhk.index, bhk.index + bhk[0].length);
    patch.buildingType ??= 'house';
  }
  // En-suite phrases are consumed first so "attached bathroom" never counts as a separate common bathroom.
  const ensuiteRe = /\b(?:with\s+)?(?:an?\s+|their\s+own\s+|own\s+)?(?:attached|en-?suite|ensuite|attach)\s+(?:bath(?:room)?s?|toilets?|washrooms?|wc)\b|\b(?:bath(?:room)?s?|toilets?)\s+attached\b|\ben-?suites?\b/g;
  const ensuiteAt: number[] = [];
  for (const m of t.matchAll(ensuiteRe)) { ensuiteAt.push(m.index); blank(m.index, m.index + m[0].length); }

  // Rooms: every catalog synonym, longest first; a count may precede it with up to two adjectives in between.
  const adjectives = '(?:(?:big|large|huge|small|compact|spacious|separate|dedicated|modern|open|cozy|cosy|nice|luxurious|extra|additional|more|private|common|beautiful|proper|good|well[- ]lit|bright|airy|covered|closed|open[- ]plan)\\s+){0,2}';
  for (const { phrase, kind } of synonymIndex()) {
    const p = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ -]?');
    const re = new RegExp(`(?:\\b${COUNT}\\s+)?${adjectives}\\b${p}(?:s|es)?\\b`, 'g');
    for (const m of t.matchAll(re)) {
      const count = num(m[1]);
      hits.push({ kind, count: count ?? 1, explicitCount: count !== undefined && m[1] !== 'a' && m[1] !== 'an', start: m.index, end: m.index + m[0].length, ensuite: false });
      blank(m.index, m.index + m[0].length);
    }
  }
  hits.sort((a, b) => a.start - b.start);
  // Each en-suite phrase attaches to the nearest preceding private room group; "each"/"all" or a plural group means all of them.
  for (const at of ensuiteAt) {
    const owner = [...hits].reverse().find(h => h.start < at && SPACE_KINDS[h.kind].category === 'private');
    const segment = original.toLowerCase().slice(Math.max(0, at - 60), at + 40);
    if (owner) {
      if (/\b(?:each|all|every|har)\b/.test(segment) || owner.count > 1) for (const h of hits.filter(h => SPACE_KINDS[h.kind].category === 'private' && h.kind !== 'servant' && h.kind !== 'dressing')) h.ensuite = true;
      else owner.ensuite = true;
    } else for (const h of hits.filter(h => SPACE_KINDS[h.kind].category === 'private' && h.kind !== 'dressing')) h.ensuite = true;
  }
  if (/\b(?:all|every|each)\s+(?:bed)?rooms?\s+(?:with|have|having)\s+(?:attached|en-?suite)/.test(original.toLowerCase())) for (const h of hits.filter(h => SPACE_KINDS[h.kind].category === 'private')) h.ensuite = true;
  // Placement: "on the first floor", "upstairs", "downstairs" right after a room.
  for (const h of hits) {
    const after = t.slice(h.end, h.end + 40), before = original.toLowerCase().slice(Math.max(0, h.start - 2), h.start);
    void before;
    const lv = /^\s*(?:,\s*)?(?:on|at|in)\s+(?:the\s+)?(ground|first|second|third|fourth|fifth|1st|2nd|3rd|4th|top|upper|terrace)\s+(?:floor|level|storey)/.exec(after) ?? /^\s*(upstairs|downstairs)/.exec(after);
    const level = lv ? (lv[1] === 'upstairs' ? 1 : lv[1] === 'downstairs' ? 0 : ORDINAL[lv[1]!]) : undefined;
    if (level !== undefined) h.level = level;
  }
  // Sizes stated next to a room.
  for (const s of roomSizes) { const near = hits.find(h => Math.abs(h.start - s.at) < 30 || Math.abs(h.end - s.at) < 12); if (near) near.areaM2 = s.areaM2; }
  // Capacities: seating for N people, garage for N cars, office for N staff, classroom for N students.
  const lower = original.toLowerCase();
  const people = /\b(?:seating|seats?|capacity|covers?)\s*(?:for|of)?\s*(\d+)\s*(?:people|persons|guests|pax|seats|customers)?\b|\b(\d+)[ -]?seater\b/.exec(lower);
  if (people) { const n = Number(people[1] ?? people[2]); const seat = hits.find(h => h.kind === 'seating') ?? hits.find(h => h.kind === 'hall'); if (seat) seat.areaM2 = Math.max(20, Math.round(n * 1.4)); else hits.push({ kind: 'seating', count: 1, explicitCount: false, start: 1e9, end: 1e9, ensuite: false, areaM2: Math.max(20, Math.round(n * 1.4)) }); }
  const cars = /\b(?:garage|parking|porch)\b[^.]{0,20}?\b(\d|two|three|four)\s*cars?\b|\b(\d|two|three|four)[ -]?car\s+(?:garage|parking|porch)\b/.exec(lower);
  if (cars) { const n = num(cars[1] ?? cars[2]) ?? 1; const g = hits.find(h => h.kind === 'garage'); if (g) g.areaM2 = Math.max(18, 15 * n); }
  const staff = /\b(?:for|of)\s+(\d+)\s+(?:employees|staff|people|persons|workstations|desks|seats)\b/.exec(lower);
  if (staff && (patch.buildingType === 'office' || hits.some(h => h.kind === 'workspace'))) { const n = Number(staff[1]); const w = hits.find(h => h.kind === 'workspace'); if (w) w.areaM2 = Math.max(20, n * 6); else hits.push({ kind: 'workspace', count: 1, explicitCount: false, start: 1e9, end: 1e9, ensuite: false, areaM2: Math.max(20, n * 6) }); }
  const students = /\b(\d+)\s+students\b/.exec(lower);
  if (students) { const c = hits.find(h => h.kind === 'classroom'); if (c) c.areaM2 = Math.max(30, Number(students[1]) * 1.3); }

  // Edits: "remove/no/without the study", "add a gym", "one more bedroom", "bigger kitchen".
  const removeRe = /\b(?:remove|delete|drop|no|without|skip|hata(?:o|do)?|nahi chahiye)\b/;
  const addRe = /\b(?:add|also|another|one more|extra|additional|plus|include|aur)\b/;
  for (const h of hits) {
    const before = original.toLowerCase().slice(Math.max(0, h.start - 18), h.start + 1);
    const ctx = t.slice(Math.max(0, h.start - 22), h.start);
    if (removeRe.test(before) || removeRe.test(ctx)) { patch.remove.push(h.kind); h.count = 0; continue; }
    if (addRe.test(before) || addRe.test(ctx)) patch.add.push(h.kind);
    const grow = /\b(?:bigger|larger|more spacious|increase|expand|wider)\b/.exec(original.toLowerCase().slice(Math.max(0, h.start - 25), h.end + 25));
    const shrink = /\b(?:smaller|reduce|compact|decrease|narrower)\b/.exec(original.toLowerCase().slice(Math.max(0, h.start - 25), h.end + 25));
    if (grow) patch.resize.push({ kind: h.kind, factor: 1.3 }); else if (shrink) patch.resize.push({ kind: h.kind, factor: 0.8 });
  }
  // Merge hits by kind/level/ensuite.
  const groups = new Map<string, BriefSpace>();
  for (const h of hits.filter(h => h.count > 0)) {
    const key = `${h.kind}|${h.level ?? ''}|${h.ensuite}`;
    const g = groups.get(key);
    if (g) { g.count = Math.min(40, h.explicitCount ? Math.max(g.count, h.count) : g.count); if (h.areaM2) g.areaM2 = h.areaM2; }
    else groups.set(key, { kind: h.kind, count: Math.min(40, h.count), ensuite: h.ensuite, ...(h.level !== undefined ? { level: h.level } : {}), ...(h.areaM2 ? { areaM2: h.areaM2 } : {}) });
  }
  patch.spaces = [...groups.values()];

  // Quality, style, city, terrace, balconies.
  if (/\b(?:luxury|luxurious|high[- ]end|lavish|ultra|premium luxury)\b/.test(lower)) patch.qualityTier = 'luxury';
  else if (/\b(?:premium|upscale|elegant|classy)\b/.test(lower)) patch.qualityTier = 'premium';
  else if (/\b(?:budget|affordable|low[- ]cost|economical|cheap|basic|sasta|kam kharch)\b/.test(lower)) patch.qualityTier = 'economy';
  for (const style of ['contemporary', 'minimal', 'traditional', 'colonial', 'industrial', 'tropical', 'mediterranean', 'modern'] as const) if (new RegExp(`\\b${style}(?:ist|istic)?\\b`).test(lower)) { patch.style = style; break; }
  if (/\b(?:kerala|chettinad|rajasthani|haveli|vastu)\b/.test(lower)) patch.style ??= 'traditional';
  if (/\bvastu\b/.test(lower)) patch.notes.push('Vastu preferences noted; orientation follows the street side of the plot.');
  for (const city of CITIES) if (new RegExp(`\\b${city}\\b`).test(lower)) { patch.city = city.replace(/\b\w/g, c => c.toUpperCase()); break; }
  if (/\b(?:terrace|roof ?top|roof garden|terrace garden|chhat|chat)\b/.test(lower)) patch.roofTerrace = !removeRe.test(lower.slice(Math.max(0, lower.search(/terrace|roof/) - 12), lower.search(/terrace|roof/)));
  if (/\bbalcon(?:y|ies)\b/.test(lower)) patch.balconies = true;
  for (const [re, note] of [[/\b(?:swimming )?pool\b/, 'Swimming pool noted for the site plan; it is not part of the building layout.'], [/\blift|elevator\b/, 'Lift noted; the stair core leaves room for a future lift shaft study.'],
    [/\bsolar\b/, 'Solar panels noted for the roof.'], [/\b(?:garden|lawn|landscap)/, 'Garden/lawn noted for the open part of the plot.'], [/\bbasement\b/, 'Basement noted; this concept starts at ground level.'],
    [/\b(?:rain ?water|harvesting)\b/, 'Rainwater harvesting noted for services design.'], [/\b(?:north|south|east|west)[- ]facing\b/, 'Plot facing noted; the street side is drawn at the front.']] as const) if (re.test(lower)) patch.notes.push(note);

  // A full brief (building type with rooms, a BHK, or a plot with rooms) replaces; otherwise the message edits the current brief.
  const full = !!bhk || (patch.buildingType !== undefined && patch.spaces.length >= 2) || (patch.site !== undefined && patch.spaces.length >= 2) || patch.spaces.length >= 4;
  patch.mode = full && !patch.add.length && !patch.remove.length ? 'replace' : 'modify';
  patch.empty = !patch.spaces.length && !patch.remove.length && patch.floors === undefined && !patch.site && !patch.buildingType && patch.budgetInr === undefined && !patch.qualityTier && !patch.style && !patch.city && patch.roofTerrace === undefined && !patch.resize.length;
  // A question about rooms ("which flooring suits a kitchen?") asks for advice; it is not a design change.
  const question = /\?\s*$/.test(original.trim()) || /^\s*(?:what|which|how|why|should|can|could|is|are|does|do i|tell me|explain|kya|kaise|kaun)\b/i.test(original);
  if (question && patch.mode === 'modify' && !patch.add.length && !patch.remove.length && !patch.resize.length && patch.site === undefined && patch.floors === undefined && patch.budgetInr === undefined && !hits.some(h => h.explicitCount)) {
    patch.spaces = []; patch.empty = !patch.buildingType && !patch.qualityTier && !patch.style && !patch.city;
  }
  if (patch.mode === 'replace') patch.text = original.slice(0, 600);
  return BriefPatchSchema.parse(patch);
}
