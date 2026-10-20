/**
 * Space catalog for the program engine: every room kind a brief may name, with planning data.
 * Areas are planning targets in m² for the 'standard' quality tier (typical Indian residential and small commercial
 * practice, cf. NBC 2016 Part 3 minimum habitable sizes); clear minimums are in mm and are product defaults, not code
 * compliance. Zones drive placement: 'front' faces the street/entrance, 'rear' is private/service, 'middle' is the spine.
 */
export type Zone = 'front' | 'middle' | 'rear';
export type Category = 'public' | 'private' | 'service' | 'wet' | 'work' | 'vehicle' | 'circulation';
export interface SpaceKindInfo {
  label: string; category: Category; zone: Zone; areaM2: number; minWidthMm: number; minDepthMm: number;
  /** Rooms that need daylight and a window on an exterior wall. */
  habitable: boolean;
  /** Preferred storey: 'ground' rooms stay on level 0 where possible, 'upper' rooms prefer upper levels. */
  storey: 'ground' | 'upper' | 'any';
  /** May host the main entrance (front room touched by the entrance door). */
  entry?: boolean;
  /** May be reached only through a neighbouring room (no own corridor door needed). */
  annex?: boolean;
  doorWidthMm: number; windowWidthMm: number; windowHeightMm: number; windowSillMm: number;
  synonyms: string[];
}
const room = (label: string, category: Category, zone: Zone, areaM2: number, minWidthMm: number, minDepthMm: number, storey: SpaceKindInfo['storey'], synonyms: string[], extra: Partial<SpaceKindInfo> = {}): SpaceKindInfo => ({
  label, category, zone, areaM2, minWidthMm, minDepthMm, storey, synonyms,
  habitable: category === 'public' || category === 'private' || category === 'work',
  doorWidthMm: category === 'wet' ? 800 : 900, windowWidthMm: category === 'wet' ? 600 : category === 'public' ? 1800 : 1500,
  windowHeightMm: category === 'wet' ? 600 : 1350, windowSillMm: category === 'wet' ? 1500 : 750, ...extra,
});
export const SPACE_KINDS = {
  // Residential
  living: room('Living room', 'public', 'front', 18, 3000, 3300, 'ground', ['living room', 'living', 'drawing room', 'drawing', 'hall', 'baithak', 'lounge'], { entry: true }),
  family: room('Family lounge', 'public', 'middle', 14, 3000, 3300, 'upper', ['family room', 'family lounge', 'family area', 'tv room', 'tv lounge', 'upper lounge', 'sitting room']),
  foyer: room('Foyer', 'circulation', 'front', 6, 1800, 2100, 'ground', ['foyer', 'entrance lobby', 'entry lobby', 'vestibule', 'entrance hall'], { entry: true, habitable: false }),
  dining: room('Dining', 'public', 'rear', 11, 2400, 2700, 'ground', ['dining room', 'dining area', 'dining'], { annex: true }),
  kitchen: room('Kitchen', 'service', 'rear', 10, 2100, 2700, 'ground', ['kitchen', 'rasoi', 'modular kitchen'], { habitable: true, annex: true, windowWidthMm: 1200 }),
  pantry: room('Pantry', 'service', 'rear', 4, 1500, 1800, 'ground', ['pantry'], { annex: true }),
  utility: room('Utility / wash', 'service', 'rear', 4.5, 1500, 1800, 'ground', ['utility', 'wash area', 'washing area', 'laundry', 'utility room'], { annex: true, windowWidthMm: 900 }),
  store: room('Store', 'service', 'middle', 3.5, 1200, 1500, 'any', ['store room', 'storeroom', 'store', 'storage'], { annex: true, windowWidthMm: 600, windowHeightMm: 600, windowSillMm: 1500 }),
  master: room('Master bedroom', 'private', 'rear', 16, 3000, 3600, 'upper', ['master bedroom', 'master suite', 'main bedroom', 'master bed room', 'owner bedroom', 'master']),
  bedroom: room('Bedroom', 'private', 'middle', 12.5, 2700, 3000, 'upper', ['bedroom', 'bed room', 'room for sleeping', 'kamra']),
  kids: room('Kids bedroom', 'private', 'middle', 11, 2700, 2700, 'upper', ['kids room', 'kids bedroom', 'children room', 'childrens room', 'child bedroom', 'nursery']),
  guest: room('Guest bedroom', 'private', 'middle', 12, 2700, 3000, 'ground', ['guest room', 'guest bedroom', 'parents room', 'parents bedroom', 'elderly room']),
  bathroom: room('Bathroom', 'wet', 'middle', 4.5, 1500, 2100, 'any', ['bathroom', 'washroom', 'bath', 'restroom', 'common bathroom', 'common toilet'], { doorWidthMm: 800 }),
  toilet: room('Powder room', 'wet', 'middle', 2.5, 1200, 1500, 'ground', ['powder room', 'powder toilet', 'wc', 'water closet', 'half bath', 'guest toilet', 'toilet'], { doorWidthMm: 800 }),
  dressing: room('Dressing', 'private', 'middle', 4, 1500, 1800, 'upper', ['dressing room', 'dressing', 'walk in wardrobe', 'walk-in closet', 'walk in closet', 'wardrobe room'], { annex: true, habitable: false, windowWidthMm: 900 }),
  study: room('Study', 'work', 'middle', 9, 2400, 2700, 'any', ['study room', 'study', 'reading room']),
  office: room('Home office', 'work', 'front', 10, 2700, 3000, 'any', ['home office', 'office room', 'work from home', 'office', 'workroom']),
  library: room('Library', 'work', 'middle', 12, 3000, 3300, 'any', ['library']),
  puja: room('Puja room', 'service', 'middle', 3, 1200, 1500, 'ground', ['puja room', 'pooja room', 'puja', 'pooja', 'prayer room', 'mandir', 'temple room', 'meditation room'], { habitable: false, annex: true, windowWidthMm: 600, windowHeightMm: 600, windowSillMm: 1500 }),
  gym: room('Home gym', 'work', 'middle', 14, 3000, 3600, 'any', ['gym', 'home gym', 'fitness room', 'exercise room', 'yoga room']),
  theatre: room('Home theatre', 'work', 'middle', 20, 3600, 4500, 'any', ['home theatre', 'home theater', 'media room', 'cinema room', 'theatre', 'theater']),
  servant: room("Staff room", 'private', 'rear', 8, 2400, 3000, 'ground', ['servant room', 'servant quarter', 'maid room', 'helper room', 'driver room', 'staff quarter']),
  garage: room('Garage', 'vehicle', 'front', 18, 3000, 5400, 'ground', ['garage', 'car garage', 'car porch', 'parking', 'car parking', 'covered parking'], { habitable: false, annex: true, doorWidthMm: 900, windowWidthMm: 900 }),
  // Commercial / institutional
  reception: room('Reception', 'public', 'front', 20, 3300, 3600, 'ground', ['reception', 'reception area', 'front desk', 'lobby', 'waiting area', 'waiting room', 'waiting lounge'], { entry: true }),
  workspace: room('Open workspace', 'work', 'middle', 40, 4500, 4500, 'any', ['open office', 'open workspace', 'workstations', 'work area', 'office floor', 'coworking', 'co-working', 'open plan office']),
  cabin: room('Cabin', 'work', 'middle', 10, 2700, 3000, 'any', ['cabin', 'manager cabin', 'director cabin', 'md cabin', 'private office', 'ceo office', 'manager room']),
  conference: room('Conference room', 'work', 'middle', 20, 3600, 4500, 'any', ['conference room', 'meeting room', 'boardroom', 'board room', 'conference', 'meeting']),
  serverRoom: room('Server room', 'service', 'middle', 6, 2100, 2400, 'any', ['server room', 'it room', 'electrical room', 'ups room', 'data room'], { habitable: false, annex: true }),
  seating: room('Seating area', 'public', 'front', 45, 4500, 5000, 'ground', ['seating area', 'dining hall', 'cafe seating', 'customer area', 'seating', 'restaurant hall', 'eating area'], { entry: true }),
  counter: room('Service counter', 'service', 'middle', 10, 2400, 3000, 'ground', ['counter', 'service counter', 'billing counter', 'cash counter', 'bar counter', 'order counter'], { annex: true }),
  commercialKitchen: room('Commercial kitchen', 'service', 'rear', 25, 3600, 4500, 'ground', ['commercial kitchen', 'restaurant kitchen', 'cafe kitchen', 'hot kitchen', 'bakery kitchen'], { habitable: true }),
  retail: room('Retail floor', 'public', 'front', 45, 4500, 6000, 'ground', ['shop', 'retail', 'showroom', 'store front', 'retail floor', 'sales floor', 'boutique'], { entry: true }),
  classroom: room('Classroom', 'work', 'middle', 50, 6000, 7500, 'any', ['classroom', 'class room', 'lecture room', 'tuition room']),
  staffRoom: room('Staff room', 'work', 'middle', 16, 3300, 4200, 'any', ['staff room', 'teachers room', 'faculty room']),
  consultation: room('Consultation room', 'work', 'middle', 12, 3000, 3600, 'any', ['consultation room', 'consulting room', 'doctor room', 'doctor cabin', 'opd', 'examination room', 'clinic room']),
  treatment: room('Treatment room', 'work', 'middle', 14, 3300, 3600, 'any', ['treatment room', 'procedure room', 'dressing room clinic', 'minor ot', 'therapy room', 'physiotherapy']),
  pharmacy: room('Pharmacy', 'public', 'front', 15, 3000, 4000, 'ground', ['pharmacy', 'chemist', 'medical store', 'dispensary'], { entry: true }),
  restroomMen: room('Restroom (men)', 'wet', 'middle', 7, 2100, 2700, 'any', ['mens toilet', "men's toilet", 'gents toilet', 'male toilet', 'mens restroom', 'gents washroom']),
  restroomWomen: room('Restroom (women)', 'wet', 'middle', 7, 2100, 2700, 'any', ['ladies toilet', 'womens toilet', "women's toilet", 'female toilet', 'womens restroom', 'ladies washroom']),
  hall: room('Multipurpose hall', 'public', 'middle', 60, 6000, 7500, 'any', ['multipurpose hall', 'banquet hall', 'party hall', 'community hall', 'event hall', 'auditorium', 'assembly hall']),
  studio: room('Studio', 'work', 'middle', 20, 3600, 4500, 'any', ['studio', 'workshop', 'design studio', 'art studio', 'music room', 'dance studio']),
} as const;
export type SpaceKind = keyof typeof SPACE_KINDS;
export const SPACE_KIND_NAMES = Object.keys(SPACE_KINDS) as [SpaceKind, ...SpaceKind[]];
export const BUILDING_TYPES = ['house', 'villa', 'apartment', 'office', 'cafe', 'restaurant', 'retail', 'clinic', 'school', 'mixed-use', 'community', 'studio'] as const;
export type BuildingType = typeof BUILDING_TYPES[number];
export const QUALITY_TIERS = ['economy', 'standard', 'premium', 'luxury'] as const;
export type QualityTier = typeof QUALITY_TIERS[number];
export const TIER_AREA_FACTOR: Record<QualityTier, number> = { economy: 0.85, standard: 1, premium: 1.2, luxury: 1.45 };
export const isResidential = (t: BuildingType) => t === 'house' || t === 'villa' || t === 'apartment';
/** Kinds that need a corridor-reachable door of their own when they are not annexed to a hub room. */
export const info = (kind: SpaceKind): SpaceKindInfo => SPACE_KINDS[kind];

/** Longest-synonym-first lookup used by the brief parser; returns [kind, matched phrase] pairs in text order. */
export function synonymIndex(): { phrase: string; kind: SpaceKind }[] {
  const list: { phrase: string; kind: SpaceKind }[] = [];
  for (const kind of SPACE_KIND_NAMES) for (const phrase of SPACE_KINDS[kind].synonyms) list.push({ phrase, kind });
  return list.sort((a, b) => b.phrase.length - a.phrase.length || (a.phrase < b.phrase ? -1 : 1));
}
