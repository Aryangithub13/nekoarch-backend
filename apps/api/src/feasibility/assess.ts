import { costHash } from '@designflow/boq-cost';
import { MODEL_LIMITS } from '../engineering/capability-limits.js';
import { MAX_REQUESTED_ROOMS } from '../contracts/specialists.js';
import type { Domain } from '../engineering/contracts.js';
import { normalize } from '../instructions/grammar.js';
import { CONCEPT_FEATURES, FEASIBILITY_VERSION, FeasibilityAssessmentSchema, LADDER_STAGES, type Constraint, type FeasibilityAssessment, type FeasibilityRequest }
  from './contracts.js';

type Feature = typeof CONCEPT_FEATURES[number];
const limit = (id: string) => MODEL_LIMITS.find(l => l.limitId === id)!.value;
const MAX_FLOORS = limit('GENERATION_MAX_FLOORS'), MAX_LEVELS = limit('BUILDING_MODEL_MAX_LEVELS'), BIM_STOREYS = limit('BIM_PROFILE_MAX_STOREYS');

/** Feature wording → typed concept feature. Each names what the model cannot represent, not whether the idea is buildable. */
const FEATURE_WORDS: [Feature, RegExp, string][] = [
  ['CURVED_OR_ORGANIC_FORM', /\b(?:curved|curving|organic|spherical|sphere|dome[ds]?|blob|fluid|wavy|undulating|round(?:ed)? building)\b/,
    'Building Model V2 rings have straight edges; curves are not represented'],
  ['TWISTING_OR_ROTATING_FORM', /\b(?:twist(?:ing|ed)?|rotating|spiral(?:ling)?|helical)\b/, 'Storeys are horizontal plates sharing one frame; per-storey rotation is not generated'],
  ['FLOATING_OR_LEVITATING_VOLUME', /\b(?:floating|levitat\w*|hovering|suspended in (?:the )?air|in the clouds|flying)\b/,
    'No support or structural system is generated for a volume without supports'],
  ['UNDERWATER_OR_SUBMERGED', /\b(?:underwater|submerged|under the sea|subsea)\b/, 'No hydrostatic, waterproofing or marine domain exists in this backend'],
  ['INVERTED_OR_GRAVITY_DEFYING', /\b(?:upside-?down|inverted|anti-?gravity|zero-?gravity|gravity-?defying)\b/, 'Gravity loads act downward in every engine; this is a visual concept only'],
  ['FULL_GLASS_ENVELOPE', /\b(?:all-?glass|full(?:y)? glazed|glass (?:box|tower|house|cube|facades?|envelope|walls?)|curtain wall|transparent (?:building|walls?))\b/,
    'The generator places discrete openings in walls; a curtain-wall envelope is not generated, and glazing changes are visual presets only'],
  ['TRANSPARENT_FLOORS', /\b(?:glass|transparent) floors?\b/, 'Slabs are modeled as opaque floor plates'],
  ['SCULPTURAL_FACADE', /\b(?:sculptural|parametric facade|parametric facades|faceted|origami|crystalline|crystal)\b/, 'Façade geometry is the wall layout; sculptural surfaces are not represented'],
];
/** Domains each quantity's feasibility rests on; none has a validated solver here (engineering assessment reports them as blocked). */
const DOMAINS_FOR: Record<'STOREYS' | 'HEIGHT' | 'SPAN' | 'CANTILEVER' | Feature, Domain[]> = {
  STOREYS: ['GRAVITY_LOADS', 'WIND_LOADS', 'SEISMIC_LOADS', 'LATERAL_DRIFT_AND_STABILITY', 'GEOTECHNICAL_AND_FOUNDATIONS', 'FIRE_AND_LIFE_SAFETY', 'VERTICAL_TRANSPORT'],
  HEIGHT: ['WIND_LOADS', 'LATERAL_DRIFT_AND_STABILITY', 'DYNAMIC_RESPONSE', 'FIRE_AND_LIFE_SAFETY', 'CODE_COMPLIANCE'],
  SPAN: ['GRAVITY_LOADS', 'MEMBER_DESIGN'], CANTILEVER: ['GRAVITY_LOADS', 'MEMBER_DESIGN', 'PROGRESSIVE_COLLAPSE', 'DYNAMIC_RESPONSE'],
  CURVED_OR_ORGANIC_FORM: ['MEMBER_DESIGN'], TWISTING_OR_ROTATING_FORM: ['WIND_LOADS', 'LATERAL_DRIFT_AND_STABILITY', 'MEMBER_DESIGN'],
  FLOATING_OR_LEVITATING_VOLUME: ['GRAVITY_LOADS', 'MEMBER_DESIGN', 'PROGRESSIVE_COLLAPSE'], UNDERWATER_OR_SUBMERGED: ['GEOTECHNICAL_AND_FOUNDATIONS', 'CODE_COMPLIANCE'],
  INVERTED_OR_GRAVITY_DEFYING: ['GRAVITY_LOADS', 'MEMBER_DESIGN'], FULL_GLASS_ENVELOPE: ['WIND_LOADS', 'FIRE_AND_LIFE_SAFETY', 'CODE_COMPLIANCE'],
  TRANSPARENT_FLOORS: ['GRAVITY_LOADS', 'MEMBER_DESIGN', 'FIRE_AND_LIFE_SAFETY'], SCULPTURAL_FACADE: ['WIND_LOADS'],
};
const MM_PER: Record<string, number> = { m: 1000, metre: 1000, metres: 1000, meter: 1000, meters: 1000, ft: 304.8, feet: 304.8, foot: 304.8 };
const mm = (value: string, unit: string) => Math.round(Number(value) * MM_PER[unit]!);
const UNIT = '(m|metres?|meters?|ft|feet|foot)';

type Read = { value: number; phrase: string };
/** Quantities stated in the text. Only explicit numbers with explicit units are read; nothing is inferred from adjectives ("tall", "huge"). */
export function readText(raw: string) {
  const t = normalize(raw), first = (r: RegExp, f: (m: RegExpExecArray) => number): Read | null => { const m = r.exec(t); return m ? { value: f(m), phrase: m[0] } : null; };
  return {
    storeys: first(/\b(\d{1,4})[ -]?(?:storeys?|story|stories|floors?|levels?)\b/, m => Number(m[1])),
    rooms: first(/\b(\d{1,4})[ -]?(?:rooms?|bed ?rooms?|bhk)\b/, m => Number(m[1])),
    heightMm: first(new RegExp(`\\b(\\d{1,5}(?:\\.\\d+)?)\\s?${UNIT}(?:[ -](?:tall|high))\\b|\\b(?:height of|tall at|high at)\\s(\\d{1,5}(?:\\.\\d+)?)\\s?${UNIT}\\b`),
      m => m[1] ? mm(m[1], m[2]!) : mm(m[3]!, m[4]!)),
    maxSpanMm: first(new RegExp(`\\b(\\d{1,4}(?:\\.\\d+)?)\\s?${UNIT}[ -](?:column-?free[ -])?spans?\\b|\\bspans? of (\\d{1,4}(?:\\.\\d+)?)\\s?${UNIT}\\b`),
      m => m[1] ? mm(m[1], m[2]!) : mm(m[3]!, m[4]!)),
    cantileverMm: first(new RegExp(`\\b(\\d{1,4}(?:\\.\\d+)?)\\s?${UNIT}[ -]cantilever\\w*\\b|\\bcantilever\\w* (?:of )?(\\d{1,4}(?:\\.\\d+)?)\\s?${UNIT}\\b`),
      m => m[1] ? mm(m[1], m[2]!) : mm(m[3]!, m[4]!)),
    features: FEATURE_WORDS.flatMap(([f, r]) => { const m = r.exec(t); return m ? [{ feature: f, phrase: m[0] }] : []; }),
  };
}

const project = (projectId: string) => `/api/projects/${projectId}`;

/** Pure and deterministic for (request, projectId). */
export function assessFeasibility(projectId: string, request: FeasibilityRequest): FeasibilityAssessment {
  const text = readText(request.text), d = request.declared, constraints: Constraint[] = [];
  const pick = (declared: number | undefined, read: Read | null) => declared !== undefined ? { value: declared, source: 'DECLARED' as const, phrase: null }
    : read ? { value: read.value, source: 'TEXT' as const, phrase: read.phrase.slice(0, 120) } : null;

  const storeys = pick(d.storeys, text.storeys);
  if (storeys) {
    const base = { constraintId: 'STOREYS' as const, source: storeys.source, phrase: storeys.phrase, value: storeys.value, unit: 'storeys' as const };
    if (storeys.value > MAX_LEVELS) constraints.push({ ...base, classification: 'EXCEEDS_ENGINE_LIMIT', limit: { limitId: 'BUILDING_MODEL_MAX_LEVELS', value: MAX_LEVELS, requested: storeys.value },
      unverifiedDomains: DOMAINS_FOR.STOREYS, reason: `The building model holds at most ${MAX_LEVELS} levels; it can be neither generated nor supplied` });
    else if (storeys.value > MAX_FLOORS) constraints.push({ ...base, classification: 'EXCEEDS_ENGINE_LIMIT', limit: { limitId: 'GENERATION_MAX_FLOORS', value: MAX_FLOORS, requested: storeys.value },
      unverifiedDomains: DOMAINS_FOR.STOREYS, reason: `Generation produces at most ${MAX_FLOORS} storeys. A supplied model of up to ${MAX_LEVELS} levels can be stored and assessed `
        + `(B35); BIM-derived services admit at most ${BIM_STOREYS} storeys` });
    else constraints.push({ ...base, classification: 'WITHIN_ENGINE_SCOPE', limit: null, unverifiedDomains: [], reason: `Within the generator's ${MAX_FLOORS}-storey scope` });
  }
  const rooms = pick(d.rooms, text.rooms);
  if (rooms) {
    const base = { constraintId: 'ROOMS' as const, source: rooms.source, phrase: rooms.phrase, value: rooms.value, unit: 'rooms' as const, unverifiedDomains: [] };
    constraints.push(rooms.value > MAX_REQUESTED_ROOMS
      ? { ...base, classification: 'EXCEEDS_ENGINE_LIMIT', limit: { limitId: 'MAX_REQUESTED_ROOMS', value: MAX_REQUESTED_ROOMS, requested: rooms.value },
        reason: `Requirements may request at most ${MAX_REQUESTED_ROOMS} rooms` }
      : { ...base, classification: 'WITHIN_ENGINE_SCOPE', limit: null, reason: `Within the ${MAX_REQUESTED_ROOMS}-room requirement limit` });
  }
  // Lengths: representable in integer millimetres, but no validated solver decides whether they work. No threshold is invented.
  for (const [constraintId, declared, read, what] of [['HEIGHT', d.heightMm, text.heightMm, 'building height'], ['SPAN', d.maxSpanMm, text.maxSpanMm, 'clear span'],
    ['CANTILEVER', d.cantileverMm, text.cantileverMm, 'cantilever']] as const) {
    const v = pick(declared, read);
    if (v) constraints.push({ constraintId, source: v.source, phrase: v.phrase, value: v.value, unit: 'mm', classification: 'REQUIRES_PROFESSIONAL_REVIEW', limit: null,
      unverifiedDomains: DOMAINS_FOR[constraintId], reason: `A ${what} of ${v.value} mm can be represented, but whether it works depends on ${DOMAINS_FOR[constraintId].join(', ')}, `
        + 'for which no validated solver exists here; no value is judged safe or unsafe' });
  }
  const features = new Map<Feature, string | null>([...text.features.map(f => [f.feature, f.phrase] as const), ...(d.features ?? []).map(f => [f, null] as const)]);
  for (const [feature, phrase] of features) constraints.push({ constraintId: feature, source: phrase === null ? 'DECLARED' : 'TEXT', phrase: phrase?.slice(0, 120) ?? null,
    value: null, unit: null, classification: 'CONCEPT_ONLY', limit: null, unverifiedDomains: DOMAINS_FOR[feature],
    reason: `${FEATURE_WORDS.find(([f]) => f === feature)![2]}. It can be explored as an advisory concept, never as verified geometry` });

  const exceeding = constraints.filter(c => c.classification === 'EXCEEDS_ENGINE_LIMIT'), concept = constraints.filter(c => c.classification === 'CONCEPT_ONLY');
  const review = constraints.filter(c => c.classification === 'REQUIRES_PROFESSIONAL_REVIEW');
  const label = (c: Constraint) => `${c.constraintId}${c.value === null ? '' : ` ${c.value}${c.unit === 'mm' ? ' mm' : c.unit ? ` ${c.unit}` : ''}`}`;
  // Any regeneration changes geometry; with a base revision, a geometry lock blocks it (conflict resolution never voids a lock, ROADMAP L352).
  const geometryLocks = request.baseRevisionId === null ? [] : request.preserve.filter(s => ['BUILDING_GEOMETRY', 'FLOOR_PLANS', 'ROOMS', 'WALLS', 'STRUCTURE', 'BUILDING_DIMENSIONS',
    'STAIRS', 'OPENINGS'].includes(s));
  const alt = (a: Omit<FeasibilityAssessment['alternatives'][number], 'status' | 'requiresConsent' | 'applied' | 'lockConflicts'>, conflicts: typeof geometryLocks) =>
    ({ ...a, status: conflicts.length ? 'BLOCKED_BY_LOCK' as const : 'PROPOSED_FOR_CONSENT' as const, lockConflicts: [...conflicts], requiresConsent: true as const, applied: false as const });
  const alternatives: FeasibilityAssessment['alternatives'] = [];
  const within = !exceeding.length && !concept.length;
  if (within) alternatives.push(alt({ alternativeId: 'AS_REQUESTED', title: 'Generate as requested', reachesStage: 'BOUNDED_GEOMETRY', keeps: constraints.map(label),
    givesUp: [], handoff: { method: 'POST', route: `${project(projectId)}/specialists/BLUEPRINT/requests`, purpose: 'Generate a revision from requirements within the engine scope' } },
  geometryLocks));
  else {
    const clamped = exceeding.filter(c => c.constraintId === 'STOREYS' || c.constraintId === 'ROOMS');
    alternatives.push(alt({ alternativeId: 'BOUNDED_GENERATION', title: 'Bounded generation within the engine limits', reachesStage: 'BOUNDED_GEOMETRY',
      keeps: [...constraints.filter(c => c.classification === 'WITHIN_ENGINE_SCOPE').map(label), ...review.map(c => `${label(c)} (as a stated intent; not engineered)`)].slice(0, 16),
      givesUp: [...clamped.map(c => `${c.constraintId} reduced from ${c.value} to ${c.limit!.value} (${c.limit!.limitId})`),
        ...concept.map(c => `${c.constraintId}: rectilinear, straight-edged geometry instead`)].slice(0, 16),
      handoff: { method: 'POST', route: `${project(projectId)}/specialists/BLUEPRINT/requests`, purpose: 'Generate a bounded revision; the dropped features stay concept-only' } },
    geometryLocks));
    const storeyLimit = exceeding.find(c => c.constraintId === 'STOREYS' && c.limit!.limitId === 'GENERATION_MAX_FLOORS');
    if (storeyLimit) alternatives.push(alt({ alternativeId: 'SUPPLIED_MODEL_ASSESSMENT', title: `Supply a ${storeyLimit.value}-storey model and assess it`, reachesStage: 'ENGINEERING_EVIDENCE',
      keeps: [label(storeyLimit)], givesUp: ['Generation: the model must be authored elsewhere and supplied', `BIM-derived services (more than ${BIM_STOREYS} storeys)`,
        ...concept.map(c => `${c.constraintId}: not represented in the supplied model either`)].slice(0, 16),
      handoff: { method: 'POST', route: `${project(projectId)}/revisions`, purpose: 'Store a supplied model, then run the B35 engineering assessment and zone services on it' } },
    geometryLocks));
  }
  if (concept.length || !within) alternatives.push(alt({ alternativeId: 'CONCEPT_ONLY', title: 'Keep the full ambition as an advisory concept', reachesStage: 'CONCEPT',
    keeps: constraints.map(label).slice(0, 16), givesUp: ['Verified geometry, quantities, cost and engineering: a concept changes no revision'],
    handoff: { method: 'POST', route: `${project(projectId)}/revisions/${request.baseRevisionId ?? ':revisionId'}/design-concepts`, purpose: 'Advisory exterior or interior concepts (needs a revision to anchor them)' } }, []));

  const allDomains = [...new Set(constraints.flatMap(c => c.unverifiedDomains))];
  const ladder: FeasibilityAssessment['ladder'] = [
    { stage: 'CONCEPT', status: 'AVAILABLE', artifacts: ['design-concept sets (advisory)'], gaps: [], acceptance: 'Labelled advisory; never presented as geometry or engineering' },
    { stage: 'BOUNDED_GEOMETRY', status: within ? 'AVAILABLE' : exceeding.some(c => c.limit?.limitId === 'BUILDING_MODEL_MAX_LEVELS') ? 'BLOCKED' : 'PARTIAL',
      artifacts: ['accepted revision (Building Model V2)', 'blueprint QA', 'B34 verification'],
      gaps: [...exceeding, ...concept].map(c => `${c.constraintId}: ${c.reason}`.slice(0, 300)).slice(0, 16),
      acceptance: 'QA passes on the accepted revision and the B34 verifier reports no FAIL' },
    { stage: 'ENGINEERING_EVIDENCE', status: exceeding.some(c => c.limit?.limitId === 'BUILDING_MODEL_MAX_LEVELS') ? 'BLOCKED' : 'PARTIAL',
      artifacts: ['B24 linear-static analysis (REQUIRES_REVIEW)', 'B35 engineering assessment', 'B38 evidence package'],
      gaps: [`No validated solver for: ${(allDomains.length ? allDomains : ['WIND_LOADS', 'SEISMIC_LOADS', 'MEMBER_DESIGN', 'GEOTECHNICAL_AND_FOUNDATIONS']).join(', ')}`],
      acceptance: 'Every domain is either evidenced by an independently validated method or listed as blocked' },
    { stage: 'PROFESSIONAL_REVIEW', status: 'NOT_PERFORMED', artifacts: [], gaps: ['Software never assigns the professionally reviewed evidence class'],
      acceptance: 'A qualified professional reviews and signs the evidence outside this system' },
  ];
  if (ladder.map(s => s.stage).join() !== LADDER_STAGES.join()) throw new Error('ladder order');
  return FeasibilityAssessmentSchema.parse({ assessmentVersion: FEASIBILITY_VERSION, projectId, baseRevisionId: request.baseRevisionId,
    inputHash: costHash({ text: normalize(request.text), declared: request.declared, baseRevisionId: request.baseRevisionId, preserve: [...request.preserve].sort() }),
    status: within ? 'WITHIN_ENGINE_SCOPE' : 'ALTERNATIVES_PROPOSED', constraints: constraints.slice(0, 16), alternatives, ladder,
    separation: { conceptOnly: concept.map(c => c.constraintId), feasibilityAssessed: constraints.filter(c => c.classification !== 'CONCEPT_ONLY').map(c => c.constraintId) },
    interpretation: { mode: 'DETERMINISTIC', languageModel: 'NONE' },
    claims: { buildability: 'NOT_CLAIMED', engineeringFeasibility: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', professionalReview: 'NOT_PERFORMED' } });
}
