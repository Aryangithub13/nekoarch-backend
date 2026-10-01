import { randomUUID } from 'node:crypto';
import { normalizeBlueprintRequirements, type BlueprintRequirements, type NormalizedBlueprintRequirements } from '@designflow/generator';
import { toMillimetres } from '@designflow/shared';
import { IntentCandidateSchema, InterpretationResultSchema, INTERPRETER_VERSION, INTERPRETATION_LIMITS,
  type IntentCandidate, type InterpretationResult, type NaturalLanguageDesignRequest } from '../contracts/requirement-interpretation.js';
import { fallbackProvider } from './fallback-parser.js';
import { InterpreterProviderError, type ArchitecturalInterpreterProvider } from './interpreter-provider.js';

export interface InterpreterOptions { provider?: ArchitecturalInterpreterProvider; disabled?: boolean; timeoutMs?: number; maxOutputTokens?: number }
type Base = NormalizedBlueprintRequirements | null;
const messages = {
  AI_PROVIDER_TIMEOUT: 'The interpretation provider timed out.', AI_PROVIDER_UNAVAILABLE: 'The interpretation provider is unavailable.',
  AI_PROVIDER_RATE_LIMITED: 'The interpretation provider is rate limited.', AI_PROVIDER_AUTHENTICATION_FAILED: 'The interpretation provider could not authenticate.',
  AI_PROVIDER_INVALID_RESPONSE: 'The interpretation provider returned invalid data.', AI_PROVIDER_REFUSED: 'The interpretation provider declined this request.',
  AI_PROVIDER_NETWORK_ERROR: 'The interpretation provider could not be reached.', AI_CONFIGURATION_UNAVAILABLE: 'Requirement interpretation is disabled.',
};

export async function interpretRequirements(request: NaturalLanguageDesignRequest, base: Base = null, options: InterpreterOptions = {}): Promise<InterpretationResult> {
  const provider = options.provider ?? fallbackProvider;
  const result: InterpretationResult = {
    interpretationId: randomUUID(), interpreterVersion: INTERPRETER_VERSION, provider: provider.kind, providerModel: provider.model,
    inputLanguage: /\b(?:hai|chahiye|neeche|upar|rakhna)\b/i.test(request.text) ? 'hi-Latn' : /[a-z]/i.test(request.text) ? 'en' : 'und',
    status: 'FAILED', baseRevisionId: request.baseRevisionId, candidate: null, structuredRequirements: null,
    assumptions: [], unresolvedQuestions: [], warnings: [], unsupportedRequirements: [], error: null,
    provenance: { schemaVersion: INTERPRETER_VERSION, normalizationVersion: INTERPRETER_VERSION, createdAt: new Date().toISOString(), fields: [], previousInterpretationId: request.clarification?.previousInterpretationId ?? null, validation: 'FAILED', path: provider.path },
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (options.disabled) throw new InterpreterProviderError('AI_CONFIGURATION_UNAVAILABLE');
    if (request.text.length > provider.capabilities.maxInputLength) throw new InterpreterProviderError('AI_PROVIDER_UNAVAILABLE');
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 5000, provider.capabilities.timeoutMs, 30000));
    const raw = await Promise.race([
      Promise.resolve().then(() => provider.interpret({ text: request.text, ...(request.locale ? { locale: request.locale } : {}), schema: IntentCandidateSchema,
        signal: controller.signal, maxOutputTokens: Math.max(128, Math.min(options.maxOutputTokens ?? 2048, 4096)) })),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new InterpreterProviderError('AI_PROVIDER_TIMEOUT')); }, timeoutMs); }),
    ]);
    let parsed: unknown;
    try {
      const json = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (!json || Buffer.byteLength(json) > INTERPRETATION_LIMITS.responseBytes) throw new Error();
      parsed = JSON.parse(json);
    } catch { throw new InterpreterProviderError('AI_PROVIDER_INVALID_RESPONSE'); }
    const validation = IntentCandidateSchema.safeParse(parsed);
    if (!validation.success) throw new InterpreterProviderError('AI_PROVIDER_INVALID_RESPONSE');
    result.candidate = validation.data;
  } catch (error) {
    const code = error instanceof InterpreterProviderError ? error.code : 'AI_PROVIDER_NETWORK_ERROR';
    result.error = { code, message: messages[code] };
    return InterpretationResultSchema.parse(result);
  } finally { if (timer) clearTimeout(timer); }

  const c = result.candidate!;
  const question = (field: string, text: string, type: InterpretationResult['unresolvedQuestions'][number]['acceptedAnswerTypes'][number] = 'REVISED_BRIEF') => {
    if (!result.unresolvedQuestions.some(q => q.field === field)) result.unresolvedQuestions.push({ questionId: `resolve:${field}`, field, question: text, required: true, acceptedAnswerTypes: [type] });
  };
  const source = (field: keyof IntentCandidate) => c.inferredFields.includes(field as IntentCandidate['inferredFields'][number]) ? 'USER_INFERRED' as const : 'USER_EXPLICIT' as const;
  const provenance = (field: string, origin: InterpretationResult['provenance']['fields'][number]['source'], reason: string) => {
    const item = { field, source: origin, reason }; result.provenance.fields.push(item);
    if (origin === 'PRODUCT_DEFAULT' || origin === 'USER_INFERRED') result.assumptions.push(item);
  };
  // Explicit answers are untrusted request data validated by a closed union, never model memory.
  for (const a of request.clarification?.answers ?? []) {
    switch (a.field) {
      case 'site.dimensions': c.site = a.value; c.inferredFields = c.inferredFields.filter(v => v !== 'site'); c.contradictions = c.contradictions.filter(v => v !== 'site'); break;
      case 'site.unit': if (c.site) { c.site.unit = a.value; delete c.site.depthUnit; } break;
      case 'floors': c.floors = a.value; c.inferredFields = c.inferredFields.filter(v => v !== 'floors'); c.contradictions = c.contradictions.filter(v => v !== 'floors'); break;
      case 'bedrooms': c.bedrooms = a.value; c.inferredFields = c.inferredFields.filter(v => v !== 'bedrooms'); c.contradictions = c.contradictions.filter(v => v !== 'bedrooms'); break;
      case 'kitchen.minimumDimensions': c.kitchenMinWidthMm = a.value.widthMm; c.kitchenMinDepthMm = a.value.depthMm; c.inferredFields = c.inferredFields.filter(v => v !== 'kitchenMinWidthMm' && v !== 'kitchenMinDepthMm'); break;
    }
  }
  for (const f of c.contradictions) question(f, `The brief contains contradictory ${f} requirements. Which requirement should apply?`);
  const modification = Boolean(c.kitchenLarger || c.preserveBedrooms || request.baseRevisionId);
  if (modification && !request.baseRevisionId) question('baseRevisionId', 'Which existing revision should this modification use?', 'BASE_REVISION');
  if (modification && !base) question('baseRequirements', 'The base must have stored native structured requirements; supply a new complete brief or a generated base revision.');
  if (c.kitchenLarger && (!c.kitchenMinWidthMm || !c.kitchenMinDepthMm)) question('kitchen.minimumDimensions', 'What minimum kitchen width and depth in millimetres should the new design use?', 'DIMENSIONS');
  if ((c.kitchenMinWidthMm === undefined) !== (c.kitchenMinDepthMm === undefined)) question('kitchen.minimumDimensions', 'Supply both minimum kitchen width and depth in millimetres.', 'DIMENSIONS');
  if (!modification && (c.relationshipKind || c.relationshipStrength) && !c.kitchenConnection && c.kitchen !== 'open') question('kitchen.connection', 'Which room should connect or be adjacent to the kitchen?');
  if (modification && base && (c.site || c.bedrooms !== undefined || c.floors !== undefined || c.groundFloorBedrooms !== undefined || c.upperFloorBedrooms !== undefined || c.bathrooms !== undefined || c.living !== undefined || c.dining !== undefined || c.study !== undefined || c.kitchen || c.kitchenConnection || c.relationshipKind || c.relationshipStrength || c.seed)) {
    question('modification', 'This version supports preserving the base requirements and changing kitchen minimum dimensions. Submit a complete new brief for other changes.');
  }
  for (const [field, value] of Object.entries(c)) {
    if (['inferredFields', 'contradictions', 'unsupported'].includes(field)) continue;
    if (value !== undefined) provenance(`intent.${field}`, source(field as keyof IntentCandidate), 'Extracted from the brief or an explicit clarification answer.');
  }
  if (c.parking && !c.unsupported.includes('parking')) c.unsupported.push('parking');
  result.unsupportedRequirements = [...new Set(c.unsupported)].map(feature => {
    const soft = ['daylight', 'ventilation'].includes(feature);
    return { code: 'UNSUPPORTED_REQUIREMENT', feature, priority: soft ? 'SOFT_PREFERENCE' : 'HARD_CONSTRAINT',
      disposition: soft || feature === 'parking' ? 'DEFERRED' : 'BLOCKING', appliedToGeometry: false };
  });
  if (result.unsupportedRequirements.some(u => u.disposition === 'DEFERRED')) result.warnings.push('Deferred requests are metadata only and are not included in generated geometry. Review them before generating.');
  if (c.noStairs && (c.floors ?? base?.floors ?? 1) === 2) question('floors', 'Two floors require stairs in the current generator. Revise the floor or staircase requirement.');
  if (c.floors !== undefined && c.floors !== 1 && c.floors !== 2) question('floors', 'The current generator supports one or two floors.', 'INTEGER');
  if (c.upperFloorBedrooms !== undefined && (c.floors ?? 1) < 2 && !modification) question('floors', 'Upstairs bedrooms require two floors. Which floor count should apply?', 'INTEGER');
  if (!modification && c.bedrooms === undefined) question('bedrooms', 'How many bedrooms are required in total?', 'INTEGER');
  for (const f of ['bedrooms', 'bathrooms', 'living', 'dining', 'study', 'groundFloorBedrooms', 'upperFloorBedrooms'] as const) {
    if (c[f] !== undefined && (c[f]! < 1 || c[f]! > 24)) question(f, 'Supported room counts are positive integers up to 24.', f === 'bedrooms' ? 'INTEGER' : 'REVISED_BRIEF');
  }
  const allocated = (c.groundFloorBedrooms ?? 0) + (c.upperFloorBedrooms ?? 0);
  if (c.bedrooms !== undefined && (allocated > c.bedrooms || (c.groundFloorBedrooms !== undefined && c.upperFloorBedrooms !== undefined && allocated !== c.bedrooms))) question('bedrooms', 'Floor-specific bedroom counts contradict the total. Specify consistent counts.', 'INTEGER');

  let input: BlueprintRequirements | undefined;
  let siteDimensions: { width: number; depth: number } | undefined;
  if (modification && base) {
    input = structuredClone(base);
    provenance('baseRequirements', 'USER_INFERRED', 'Unchanged requirements inherited from the explicitly selected base revision; geometry is regenerated.');
    if (c.kitchenMinWidthMm && c.kitchenMinDepthMm) {
      const kitchens = input.rooms.filter(r => r.type === 'kitchen');
      if (kitchens.length !== 1 || kitchens[0]!.count !== 1) question('kitchen', 'The base must contain exactly one kitchen for this modification.');
      else {
        const kitchen = kitchens[0]!;
        if (c.kitchenLarger && (c.kitchenMinWidthMm < (kitchen.minWidthMm ?? 1800) || c.kitchenMinDepthMm < (kitchen.minDepthMm ?? 1800) || c.kitchenMinWidthMm * c.kitchenMinDepthMm <= (kitchen.minWidthMm ?? 1800) * (kitchen.minDepthMm ?? 1800))) question('kitchen.minimumDimensions', 'Larger means increasing the minimum dimensional envelope. Supply nondecreasing dimensions and a larger minimum area.', 'DIMENSIONS');
        kitchen.minWidthMm = c.kitchenMinWidthMm; kitchen.minDepthMm = c.kitchenMinDepthMm;
        result.warnings.push('This increases kitchen minimum dimensions; it does not guarantee a larger actual room than the previous generated geometry.');
      }
    }
  } else if (!modification) {
    if (!c.site) question('site.dimensions', 'What are the plot width and depth, including units?', 'DIMENSIONS');
    const unit = c.site?.unit ?? (request.unitsHint === 'AUTO' ? undefined : request.unitsHint);
    if (c.site && !unit) question('site.unit', 'What units are the plot dimensions in?', 'UNIT');
    let width = 0, depth = 0;
    if (c.site && unit) {
      try { width = toMillimetres(c.site.width, unit); depth = toMillimetres(c.site.depth, c.site.depthUnit ?? unit); }
      catch { question('site.dimensions', 'Provide positive plot dimensions within 60000 mm per side.', 'DIMENSIONS'); }
      if (width <= 0 || depth <= 0 || width > 60000 || depth > 60000) question('site.dimensions', 'Provide positive plot dimensions within 60000 mm per side.', 'DIMENSIONS');
      if (!c.site.unit) provenance('site.unit', 'USER_EXPLICIT', 'The request unitsHint supplies the missing unit; locale alone never supplies units.');
    }
    if (width > 0 && depth > 0 && c.bedrooms && !result.unresolvedQuestions.length) {
      siteDimensions = { width, depth };
      const floors = (c.floors ?? 1) as 1 | 2;
      const rooms: BlueprintRequirements['rooms'] = [];
      if (c.groundFloorBedrooms !== undefined) rooms.push({ type: 'bedroom', count: c.groundFloorBedrooms, level: 0 });
      if (c.upperFloorBedrooms !== undefined) rooms.push({ type: 'bedroom', count: c.upperFloorBedrooms, level: 1 });
      const remaining = c.bedrooms - allocated;
      if (remaining > 0) rooms.push({ type: 'bedroom', count: remaining, ...(floors === 2 && c.groundFloorBedrooms !== undefined ? { level: 1 as const } : floors === 2 && c.upperFloorBedrooms !== undefined ? { level: 0 as const } : {}) });
      if (!allocated && !remaining) rooms.push({ type: 'bedroom', count: c.bedrooms });
      rooms.push({ type: 'bathroom', count: c.bathrooms ?? 1 }, { type: 'living', count: c.living ?? 1 }, { type: 'kitchen', count: 1,
        ...(c.kitchenMinWidthMm !== undefined ? { minWidthMm: c.kitchenMinWidthMm, minDepthMm: c.kitchenMinDepthMm } : {}) });
      if (c.dining || c.kitchenConnection === 'dining') rooms.push({ type: 'dining', count: c.dining ?? 1 });
      if (c.study) rooms.push({ type: 'study', count: c.study });
      const target = c.kitchenConnection ?? (c.kitchen === 'open' ? 'living' : undefined);
      input = { site: { boundary: [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }], northMilliDegrees: null }, floors, rooms,
        relationships: target ? [{ from: { type: 'kitchen' }, to: { type: target }, strength: c.relationshipStrength ?? 'hard', kind: c.kitchen === 'open' ? 'connected' : c.relationshipKind ?? 'adjacent' }] : [], ...(c.seed ? { seed: c.seed } : {}) };
      if (c.kitchen === 'open') result.warnings.push('Open kitchen maps to a direct room connection; the current generator still creates separate rooms and walls.');
      if (c.kitchen === 'open' && !c.kitchenConnection) provenance('relationships.kitchenTarget', 'USER_INFERRED', 'An open kitchen without a named target maps to a connection to the living room.');
      if (!c.floors) provenance('floors', 'PRODUCT_DEFAULT', 'No floor count supplied; the native product default is one floor.');
      for (const f of ['bathrooms', 'living', 'kitchen'] as const) if (c[f] === undefined) provenance(`rooms.${f}`, 'PRODUCT_DEFAULT', 'Residential interpretation includes one bathroom, one living room and one kitchen unless explicitly specified.');
      if (remaining > 0 && allocated > 0) provenance('rooms.bedroom.level', 'USER_INFERRED', 'The remaining bedrooms are assigned to the other requested floor.');
      for (const f of ['site.setbacks', 'rooms.minimumDimensions', 'circulationWidthMm', 'floorToFloorHeightMm', 'exteriorWallThicknessMm', 'interiorWallThicknessMm', 'slabThicknessMm', 'door', 'windows', 'solver', ...(c.seed ? [] : ['seed']), ...(floors === 2 ? ['stair'] : [])]) provenance(f, 'PRODUCT_DEFAULT', 'Uses the unchanged native blueprint input default; not a user request or building-code claim.');
      provenance('site.northMilliDegrees', 'UNRESOLVED', 'Orientation is unknown and represented as null; no directional performance is claimed.');
    }
  }
  let normalized: NormalizedBlueprintRequirements | null = null;
  if (input && !result.unresolvedQuestions.length) {
    try { normalized = normalizeBlueprintRequirements(input); }
    catch { question('requirements', 'The extracted requirements exceed the native generator input limits. Revise counts, levels or dimensions.'); }
  }
  if (normalized && siteDimensions) {
    const { width, depth } = siteDimensions;
    const tooLarge = normalized.rooms.some(room =>
      (room.minWidthMm > width || room.minDepthMm > depth) && (room.minDepthMm > width || room.minWidthMm > depth));
    const minimumArea = normalized.rooms.reduce((sum, room) => sum + room.count * Math.max(room.minAreaMm2 ?? 0, room.minWidthMm * room.minDepthMm), 0);
    // Necessary bounds only; layout feasibility and actual geometry remain the solver's responsibility.
    if (tooLarge || minimumArea > width * depth * normalized.floors) question('requirements', 'The room minimum dimensions or total minimum area exceed the plot capacity. Revise the plot or room requirements.');
  }
  for (const q of result.unresolvedQuestions) provenance(q.field, 'UNRESOLVED', q.question);
  result.status = result.unresolvedQuestions.length ? 'NEEDS_CLARIFICATION' : result.unsupportedRequirements.some(u => u.disposition === 'BLOCKING') ? 'UNSUPPORTED' : normalized ? 'READY' : 'UNSUPPORTED';
  result.structuredRequirements = result.status === 'READY' ? normalized : null;
  result.provenance.validation = result.status === 'READY' ? 'PASSED' : result.status === 'NEEDS_CLARIFICATION' ? 'CLARIFICATION' : 'UNSUPPORTED';
  return InterpretationResultSchema.parse(result);
}
