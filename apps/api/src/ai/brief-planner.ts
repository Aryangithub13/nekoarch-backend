import { randomUUID } from 'node:crypto';
import { BlueprintError, generateProgramBlueprint, isResidential, normalizeBlueprintForVersion, SPACE_KINDS, TIER_AREA_FACTOR, type BuildingType, type SpaceKind } from '@designflow/generator';
import { requirementsHash } from '../lib/generation-identity.js';
import { ConversationStateSchema, type ConversationMessage, type ConversationState } from '../contracts/conversations.js';
import { estimateBuilding } from '../estimate/building-estimate.js';
import { assertSafeConversationText, boundedState, changedFields } from './conversation-planner.js';
import { parseBrief } from './brief-parser.js';
import type { BriefExtractor } from './brief-extractor.js';
import { BriefSchema, type Brief, type BriefPatch, type BriefSpace } from './brief.js';

type Requirements = NonNullable<ConversationState['requirements']>;
const ft = (n: number) => Math.round(n * 304.8);
const inr = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} crore` : `₹${(n / 1e5).toFixed(1)} lakh`;
/** Standard Indian plot sizes (width x depth, feet) tried in order when the client gives none. */
const STANDARD_PLOTS: [number, number][] = [[30, 40], [30, 50], [40, 60], [50, 80], [60, 90], [80, 100], [100, 150]];

/** Applies one message's patch to the brief: a full description replaces it, an edit changes only what it names. */
export function applyPatch(previous: Brief, patch: BriefPatch): Brief {
  const scalars = ['buildingType', 'floors', 'site', 'qualityTier', 'style', 'city', 'budgetInr', 'roofTerrace', 'balconies'] as const;
  let brief: Brief;
  if (patch.mode === 'replace') {
    brief = { spaces: patch.spaces.map(s => ({ ...s })), notes: [...new Set([...patch.notes])].slice(0, 12),
      // The plot, city and budget usually stay the same when the client redescribes the building.
      ...(previous.site ? { site: previous.site } : {}), ...(previous.city ? { city: previous.city } : {}), ...(previous.budgetInr ? { budgetInr: previous.budgetInr } : {}), ...(patch.text ? { text: patch.text } : {}) };
  } else {
    brief = structuredClone(previous);
    for (const s of patch.spaces) {
      const existing = brief.spaces.filter(x => x.kind === s.kind);
      if (patch.add.includes(s.kind)) {
        const target = existing[0];
        if (target) target.count = Math.min(40, target.count + s.count); else brief.spaces.push({ ...s });
        continue;
      }
      const ensuite = s.ensuite || (existing.length > 0 && existing.every(x => x.ensuite));
      brief.spaces = brief.spaces.filter(x => x.kind !== s.kind);
      brief.spaces.push({ ...s, ensuite, ...(s.areaM2 === undefined && existing[0]?.areaM2 ? { areaM2: existing[0].areaM2 } : {}) });
    }
    for (const kind of patch.add) if (!patch.spaces.some(s => s.kind === kind)) {
      const target = brief.spaces.find(x => x.kind === kind);
      if (target) target.count = Math.min(40, target.count + 1); else brief.spaces.push({ kind, count: 1, ensuite: false });
    }
    brief.spaces = brief.spaces.filter(x => !patch.remove.includes(x.kind));
    for (const r of patch.resize) for (const s of brief.spaces.filter(x => x.kind === r.kind)) s.areaM2 = Math.round((s.areaM2 ?? SPACE_KINDS[r.kind].areaM2) * r.factor * 10) / 10;
    brief.notes = [...new Set([...brief.notes, ...patch.notes])].slice(0, 12);
  }
  for (const k of scalars) if (patch[k] !== undefined) (brief as Record<string, unknown>)[k] = patch[k];
  return BriefSchema.parse(brief);
}

/** Merges the model's reading with the offline parser: numbers the parser read exactly (plot, floors, budget) win. */
export function mergePatches(parsed: BriefPatch, model: BriefPatch | null, hasBrief: boolean): BriefPatch {
  if (!model || (model.empty && !parsed.empty)) return parsed;
  const merged: BriefPatch = { ...model };
  for (const k of ['site', 'floors', 'budgetInr', 'city'] as const) if (parsed[k] !== undefined) (merged as Record<string, unknown>)[k] = parsed[k];
  if (!merged.spaces.length && parsed.spaces.length && !merged.add.length && !merged.remove.length) merged.spaces = parsed.spaces;
  if (!hasBrief) merged.mode = 'replace';
  merged.notes = [...new Set([...model.notes, ...parsed.notes])].slice(0, 12);
  if (parsed.text && merged.mode === 'replace') merged.text = parsed.text;
  merged.empty = model.empty && parsed.empty;
  return merged;
}

const COMMERCIAL_DEFAULTS: Partial<Record<BuildingType, [SpaceKind, number][]>> = {
  cafe: [['seating', 1], ['commercialKitchen', 1], ['counter', 1], ['restroomMen', 1], ['restroomWomen', 1], ['store', 1]],
  restaurant: [['seating', 1], ['commercialKitchen', 1], ['counter', 1], ['restroomMen', 1], ['restroomWomen', 1], ['store', 1]],
  office: [['reception', 1], ['workspace', 1], ['cabin', 1], ['conference', 1], ['pantry', 1], ['restroomMen', 1], ['restroomWomen', 1]],
  clinic: [['reception', 1], ['consultation', 2], ['treatment', 1], ['restroomMen', 1], ['restroomWomen', 1], ['store', 1]],
  retail: [['retail', 1], ['store', 1], ['toilet', 1]],
  school: [['reception', 1], ['classroom', 4], ['staffRoom', 1], ['restroomMen', 1], ['restroomWomen', 1]],
  community: [['hall', 1], ['kitchen', 1], ['store', 1], ['restroomMen', 1], ['restroomWomen', 1]],
  studio: [['studio', 1], ['store', 1], ['toilet', 1]],
  'mixed-use': [['retail', 1], ['store', 1], ['toilet', 1], ['bedroom', 2], ['living', 1], ['kitchen', 1], ['bathroom', 1]],
};

/** Completes a brief into a buildable room program, recording every addition as an assumption. */
export function completeProgram(brief: Brief): { type: BuildingType; spaces: BriefSpace[]; assumptions: string[] } {
  const assumptions: string[] = [];
  const spaces = brief.spaces.map(s => ({ ...s }));
  const has = (k: SpaceKind) => spaces.some(s => s.kind === k);
  const count = (pred: (k: SpaceKind) => boolean) => spaces.filter(s => pred(s.kind)).reduce((n, s) => n + s.count, 0);
  const add = (kind: SpaceKind, n: number, why: string, extra: Partial<BriefSpace> = {}) => { spaces.push({ kind, count: n, ensuite: false, ...extra }); assumptions.push(why); };
  const privateRooms = (k: SpaceKind) => ['master', 'bedroom', 'kids', 'guest'].includes(k);
  let type: BuildingType = brief.buildingType ?? (spaces.some(s => privateRooms(s.kind)) || !spaces.length ? 'house' : spaces.some(s => ['seating', 'commercialKitchen', 'counter'].includes(s.kind)) ? 'cafe' : spaces.some(s => ['workspace', 'cabin', 'conference', 'reception'].includes(s.kind)) ? 'office' : spaces.some(s => ['consultation', 'treatment'].includes(s.kind)) ? 'clinic' : spaces.some(s => s.kind === 'classroom') ? 'school' : spaces.some(s => s.kind === 'retail') ? 'retail' : 'house');
  // A house brief that names bedrooms is residential even if it also says "office" or "studio".
  if (!isResidential(type) && type !== 'mixed-use' && spaces.some(s => privateRooms(s.kind)) && !COMMERCIAL_DEFAULTS[type]?.some(([k]) => has(k))) type = 'house';
  if (isResidential(type)) {
    if (!count(privateRooms)) add('bedroom', 2, 'Two bedrooms assumed; tell me how many you need.');
    const beds = count(privateRooms);
    if (!has('living') && !has('family')) add('living', 1, 'Living room added.');
    if (!has('kitchen')) add('kitchen', 1, 'Kitchen added.');
    if (!has('dining') && beds >= 2) add('dining', 1, 'Dining area added next to the kitchen.');
    const ensuites = spaces.filter(s => s.ensuite).reduce((n, s) => n + s.count, 0);
    const baths = count(k => k === 'bathroom' || k === 'toilet');
    if (!baths && !ensuites) {
      if (beds >= 3 && !has('master')) {
        const group = spaces.find(s => s.kind === 'bedroom')!;
        group.count -= 1; if (!group.count) spaces.splice(spaces.indexOf(group), 1);
        spaces.push({ kind: 'master', count: 1, ensuite: true });
        assumptions.push('One bedroom planned as the master suite with an attached bathroom.');
        add('bathroom', Math.max(1, beds - 2), `${Math.max(1, beds - 2)} common bathroom${beds - 2 > 1 ? 's' : ''} added.`);
      } else if (beds >= 3) { const m = spaces.find(s => s.kind === 'master')!; m.ensuite = true; add('bathroom', Math.max(1, beds - 2), 'Common bathrooms added; the master has an attached bathroom.'); }
      else add('bathroom', 1, 'One common bathroom added.');
    } else if (ensuites >= beds && !baths) add('toilet', 1, 'Powder room added for guests (bedrooms have attached bathrooms).');
  } else {
    // Commercial: unisex toilets become a pair of restrooms; missing core rooms of the use are added.
    for (const s of spaces.filter(s => s.kind === 'bathroom' || s.kind === 'toilet')) {
      if (type === 'retail' || type === 'studio') continue;
      spaces.splice(spaces.indexOf(s), 1);
      const men = Math.ceil(s.count / 2), women = Math.max(1, s.count - men);
      spaces.push({ kind: 'restroomMen', count: men, ensuite: false }, { kind: 'restroomWomen', count: women, ensuite: false });
    }
    for (const [kind, n] of COMMERCIAL_DEFAULTS[type] ?? []) if (!has(kind)) add(kind, n, `${SPACE_KINDS[kind].label} added (typical for a ${type}).`);
  }
  return { type, spaces, assumptions };
}

const areaOf = (spaces: BriefSpace[], tier: Brief['qualityTier']) => spaces.reduce((n, s) => n + s.count * ((s.areaM2 ?? SPACE_KINDS[s.kind].areaM2 * TIER_AREA_FACTOR[tier ?? 'standard']) + (s.ensuite ? 4.2 : 0)), 0);

/** Default setbacks for a rectangular plot (front, right side, rear, left side), typical of Indian municipal bye-laws for small plots. */
export function defaultSetbacks(widthMm: number, depthMm: number, residential: boolean) {
  const front = depthMm >= 24000 ? 4500 : depthMm >= 15000 ? 3000 : depthMm >= 10500 ? 2000 : 1500;
  const rear = depthMm >= 15000 ? 1500 : depthMm >= 10500 ? 1000 : 0;
  const side = widthMm >= 15000 ? 1500 : widthMm >= 12000 ? 1000 : 0;
  const right = side || (residential && widthMm >= 9000 ? 900 : 0);
  return [{ boundaryEdgeStart: 0, minimumMm: front }, { boundaryEdgeStart: 1, minimumMm: right }, { boundaryEdgeStart: 2, minimumMm: rear }, { boundaryEdgeStart: 3, minimumMm: side }].filter(s => s.minimumMm > 0);
}

export interface BriefPlanOptions { extractor?: BriefExtractor | null; signal?: AbortSignal; disabled?: boolean }
export async function planBriefConversation(previous: ConversationState, message: ConversationMessage, options: BriefPlanOptions = {}): Promise<ConversationState> {
  assertSafeConversationText(message.text);
  const state = structuredClone(previous);
  state.version++; state.proposal = null; state.questions = []; state.explanations = []; state.status = 'NEEDS_CLARIFICATION'; state.unsupported = [];
  state.messages = [...state.messages, { id: message.messageId, text: message.text, createdAt: new Date().toISOString() }].slice(-20);
  state.provider = { kind: 'nekoarch', model: 'brief-parser-v1', failure: null };
  delete state.orchestration;
  const current = BriefSchema.parse(previous.brief ?? {});
  const parsed = parseBrief(message.text);
  let model: Awaited<ReturnType<BriefExtractor['extract']>> = null;
  if (options.extractor && !options.disabled) {
    try { model = await options.extractor.extract(message.text, current, options.signal); } catch { model = null; }
    if (!model) state.provider.failure = 'AI_PROVIDER_UNAVAILABLE';
  }
  if (model) state.provider = { kind: model.provider, model: model.model, failure: null };
  const patch = mergePatches(parsed, model?.patch ?? null, current.spaces.length > 0 || !!current.buildingType);
  // A question or greeting changes nothing: the current proposal (if any) stays exactly as it was.
  if (patch.empty) {
    if (previous.proposal && previous.status === 'AWAITING_APPROVAL') {
      return boundedState({ ...state, status: 'AWAITING_APPROVAL', proposal: previous.proposal, requirements: previous.requirements, explanations: previous.explanations, ...(previous.design ? { design: previous.design } : {}) });
    }
    if (!current.spaces.length && !current.buildingType) {
      state.questions.push('What would you like to build? Describe the building, the rooms you need and your plot size, for example "a 3BHK duplex on a 30x50 ft plot in Pune with a puja room and car parking".');
      return boundedState(state);
    }
  }
  const brief = applyPatch(current, patch);
  // Nothing in the brief changed (a restated wish, an advice question): keep the current proposal as it is.
  if (previous.proposal && previous.status === 'AWAITING_APPROVAL' && JSON.stringify({ ...brief, notes: [], text: undefined }) === JSON.stringify({ ...current, notes: [], text: undefined })) {
    return boundedState({ ...state, brief, status: 'AWAITING_APPROVAL', proposal: previous.proposal, requirements: previous.requirements, explanations: previous.explanations, ...(previous.design ? { design: previous.design } : {}) });
  }
  state.brief = brief;
  const { type, spaces, assumptions } = completeProgram(brief);
  const residential = isResidential(type);
  const tier = brief.qualityTier ?? 'standard';
  const need = areaOf(spaces, tier) * 1.35;
  // Plot: the client's, or the smallest standard plot that holds the program on at most two floors (houses) or the requested floors.
  let site = brief.site;
  const assumedPlot = !site;
  if (!site) {
    const floorsWanted = brief.floors ?? (residential ? 2 : 1);
    for (const [w, d] of STANDARD_PLOTS) {
      const sb = defaultSetbacks(ft(w), ft(d), residential), get = (e: number) => sb.find(s => s.boundaryEdgeStart === e)?.minimumMm ?? 0;
      const buildable = (ft(w) - get(1) - get(3)) * (ft(d) - get(0) - get(2)) / 1e6;
      if (buildable * floorsWanted * 0.85 >= need || (w === 100)) { site = { widthMm: ft(w), depthMm: ft(d) }; break; }
    }
    assumptions.unshift(`Plot assumed ${Math.round(site!.widthMm / 304.8)} x ${Math.round(site!.depthMm / 304.8)} ft (the smallest standard plot that fits the rooms); tell me your plot size for an exact fit.`);
  }
  const plot = site!;
  let setbacks = defaultSetbacks(plot.widthMm, plot.depthMm, residential);
  assumptions.push(`Setbacks assumed: front ${(setbacks.find(s => s.boundaryEdgeStart === 0)?.minimumMm ?? 0) / 1000} m, rear ${(setbacks.find(s => s.boundaryEdgeStart === 2)?.minimumMm ?? 0) / 1000} m, sides ${(setbacks.find(s => s.boundaryEdgeStart === 1)?.minimumMm ?? 0) / 1000} / ${(setbacks.find(s => s.boundaryEdgeStart === 3)?.minimumMm ?? 0) / 1000} m (confirm with your local bye-laws).`);
  const buildable = (plot.widthMm - (setbacks.find(s => s.boundaryEdgeStart === 1)?.minimumMm ?? 0) - (setbacks.find(s => s.boundaryEdgeStart === 3)?.minimumMm ?? 0)) * (plot.depthMm - (setbacks.find(s => s.boundaryEdgeStart === 0)?.minimumMm ?? 0) - (setbacks.find(s => s.boundaryEdgeStart === 2)?.minimumMm ?? 0)) / 1e6;
  const explicitFloors = brief.floors;
  let floors = explicitFloors ?? Math.max(1, Math.min(10, Math.ceil(need / Math.max(1, buildable * 0.85))));
  if (!explicitFloors && residential && spaces.some(s => s.level !== undefined && s.level > 0)) floors = Math.max(floors, 2);
  const build = (n: number): Requirements => normalizeBlueprintForVersion({
    program: { buildingType: type, qualityTier: tier, style: brief.style ?? 'modern', ...(brief.city ? { city: brief.city } : {}), ...(brief.budgetInr ? { budgetInr: brief.budgetInr } : {}),
      spaces: spaces.map(s => ({ kind: s.kind, count: s.count, ensuite: s.ensuite, ...(s.areaM2 ? { areaM2: s.areaM2 } : {}), ...(s.level !== undefined ? { level: s.level < 0 ? n - 1 : Math.min(s.level, n - 1) } : {}) })),
      roofTerrace: brief.roofTerrace ?? false, balconies: brief.balconies ?? false, ...(brief.text ? { brief: brief.text } : {}) },
    site: { boundary: [{ x: 0, z: 0 }, { x: plot.widthMm, z: 0 }, { x: plot.widthMm, z: plot.depthMm }, { x: 0, z: plot.depthMm }], setbacks, northMilliDegrees: null },
    floors: n, seed: `brief-${state.version}`,
  }, 'program-architecture-v1') as Requirements;
  // Assigned inside attempt(); the casts keep TypeScript from narrowing them to null.
  let requirements = null as Requirements | null, result = null as ReturnType<typeof generateProgramBlueprint> | null, failure = null as BlueprintError | null;
  const attempt = () => {
    for (let n = floors; n <= (explicitFloors ?? 10); n++) {
      try { const r = build(n); result = generateProgramBlueprint(r, { timeoutMs: 6000 }); requirements = r; floors = n; failure = null; return true; }
      catch (error) {
        if (!(error instanceof BlueprintError)) throw error;
        failure = error;
        if (explicitFloors || error.code !== 'PROGRAM_DOES_NOT_FIT') return false;
      }
    }
    return false;
  };
  // When the client fixed the floors, relax only what the engine assumed: first the rooms it added, then the assumed setbacks.
  if (!attempt()) {
    const optional = new Set<SpaceKind>(['dining', 'toilet', 'store']);
    const added = spaces.filter(s => optional.has(s.kind) && !brief.spaces.some(b => b.kind === s.kind));
    if (added.length) { for (const s of added) spaces.splice(spaces.indexOf(s), 1); assumptions.push(`Left out ${added.map(s => SPACE_KINDS[s.kind].label.toLowerCase()).join(', ')} to fit the plot (living and dining combined).`); }
    if ((!added.length || !attempt()) && !attempt()) {
      setbacks = setbacks.map(s => ({ ...s, minimumMm: s.boundaryEdgeStart === 0 ? Math.min(s.minimumMm, 1500) : 0 })).filter(s => s.minimumMm > 0);
      if (attempt()) assumptions.push('Setbacks reduced to a 1.5 m front margin to fit the plot; check what your local authority permits.');
    }
  }
  if (!requirements || !result) {
    state.questions.push(failure?.code === 'PROGRAM_DOES_NOT_FIT'
      ? `These rooms do not fit ${explicitFloors ?? floors} floor${(explicitFloors ?? floors) > 1 ? 's' : ''} on a ${Math.round(plot.widthMm / 304.8)} x ${Math.round(plot.depthMm / 304.8)} ft plot. Shall I add a floor, use a larger plot, or drop some rooms?`
      : 'I could not arrange those rooms on this plot. Could you adjust the plot size or the number of floors?');
    state.explanations.push(...assumptions.slice(0, 8));
    return boundedState(state);
  }
  if (!explicitFloors && floors > 1) assumptions.push(`${floors} floors chosen so the rooms fit the plot comfortably.`);
  const estimate = estimateBuilding(result.model, { tier, city: brief.city, buildingType: type, budgetInr: brief.budgetInr });
  state.design = {
    buildingType: type, floors, footprintM: result.program.footprintM, builtUpM2: result.program.builtUpAreaM2, carpetM2: result.program.carpetAreaM2, plotM: { width: plot.widthMm / 1000, depth: plot.depthMm / 1000 }, plotAssumed: assumedPlot,
    rooms: result.program.rooms.filter(r => !r.spaceId.includes('corridor') && !r.spaceId.includes('stairwell')).slice(0, 60).map(r => ({ name: r.name.slice(0, 80), level: r.level, areaM2: r.areaM2, widthM: r.widthM, depthM: r.depthM })),
    estimate: { totalInr: estimate.summary.totalInr, rangeInr: estimate.summary.rangeInr, perSqftInr: estimate.summary.perSqftInr, months: estimate.timeline.months, concreteM3: estimate.quantities.concreteM3, steelTonnes: estimate.quantities.steelTonnes, bricks: estimate.quantities.bricks, cementBags: estimate.quantities.cementBags, budgetStatus: estimate.budget?.status ?? null },
    assumptions: [...assumptions, ...result.program.assumptions.slice(0, 3), ...brief.notes].map(a => a.slice(0, 300)).slice(0, 20),
  };
  state.fieldSources = { brief: 'USER_EXPLICIT', ...(assumedPlot ? { site: 'PRODUCT_DEFAULT' } : { site: 'USER_EXPLICIT' }), ...(explicitFloors ? { floors: 'USER_EXPLICIT' } : { floors: 'PRODUCT_DEFAULT' }) };
  const levelName = (l: number) => l === 0 ? 'ground floor' : `floor ${l}`;
  const byLevel = Array.from({ length: floors }, (_, l) => `${levelName(l)}: ${state.design!.rooms.filter(r => r.level === l).map(r => r.name).join(', ')}`);
  state.explanations = [
    `${type === 'villa' ? 'Villa' : type.charAt(0).toUpperCase() + type.slice(1)} on a ${(plot.widthMm / 1000).toFixed(1)} x ${(plot.depthMm / 1000).toFixed(1)} m plot, ${floors} floor${floors > 1 ? 's' : ''}, built-up ${result.program.builtUpAreaM2} m² (${Math.round(result.program.builtUpAreaM2 * 10.7639)} sq ft).`,
    ...byLevel.map(s => s.slice(0, 400)),
    `Estimated construction cost ${inr(estimate.summary.rangeInr[0])} to ${inr(estimate.summary.rangeInr[1])} (about ₹${estimate.summary.perSqftInr}/sq ft, ${tier} finish), about ${estimate.timeline.months} months to build.`,
    ...(estimate.budget ? [`Budget ${inr(estimate.budget.budgetInr)}: ${estimate.budget.status === 'WITHIN' ? 'the estimate fits within it' : estimate.budget.status === 'TIGHT' ? 'the estimate is close to it' : `the estimate exceeds it by about ${inr(-estimate.budget.differenceInr)}`}.`] : []),
    ...state.design.assumptions.slice(0, 8),
  ].map(s => s.slice(0, 400)).slice(0, 40);
  const diff = changedFields(state.baseRequirements, requirements);
  state.requirements = requirements; state.status = 'AWAITING_APPROVAL';
  state.proposal = { id: randomUUID(), version: state.version, baseRevisionId: state.baseRevisionId, requirements, requirementsHash: requirementsHash(requirements), expiresAt: new Date(Date.now() + 86400000).toISOString(), changedFields: diff.slice(0, 32) };
  return boundedState(ConversationStateSchema.parse(state));
}

/** Rebuilds a brief from stored program requirements so a new conversation can edit an existing design. */
export function briefFromRequirements(r: unknown): Brief | undefined {
  if (!r || typeof r !== 'object' || !('program' in r)) return undefined;
  const p = r as { program: { buildingType: BuildingType; qualityTier: Brief['qualityTier']; style: Brief['style']; city?: string; budgetInr?: number; spaces: BriefSpace[]; roofTerrace: boolean; balconies: boolean; brief?: string }; floors: number; site: { boundary: { x: number; z: number }[] } };
  const xs = p.site.boundary.map(q => q.x), zs = p.site.boundary.map(q => q.z);
  return BriefSchema.parse({ buildingType: p.program.buildingType, floors: p.floors, site: { widthMm: Math.max(...xs) - Math.min(...xs), depthMm: Math.max(...zs) - Math.min(...zs) },
    spaces: p.program.spaces.map(s => ({ kind: s.kind, count: s.count, ensuite: s.ensuite, ...(s.areaM2 ? { areaM2: s.areaM2 } : {}), ...(s.level !== undefined ? { level: s.level } : {}) })),
    qualityTier: p.program.qualityTier, style: p.program.style, ...(p.program.city ? { city: p.program.city } : {}), ...(p.program.budgetInr ? { budgetInr: p.program.budgetInr } : {}),
    roofTerrace: p.program.roofTerrace, balconies: p.program.balconies, ...(p.program.brief ? { text: p.program.brief } : {}) });
}
