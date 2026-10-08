import type { BuildingModelV2 } from '@designflow/shared';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { projectBim } from '../apps/api/src/bim/project.js';
import { digest } from '../apps/api/src/bim/core.js';
import type { BimModel } from '../apps/api/src/bim/contracts.js';
import { buildStructuralModel } from '../apps/api/src/structural/model.js';
import { structuralInputHash } from '../apps/api/src/structural/analysis.js';
import { STRUCTURAL_ANALYSIS_VERSION, type StructuralSnapshot } from '../apps/api/src/structural/contracts.js';
import { ENVIRONMENTAL_ANALYSIS_VERSION, EnvironmentalInputSchema, type EnvironmentalSnapshot } from '../apps/api/src/environmental/contracts.js';
import { buildEnvironmentalModel } from '../apps/api/src/environmental/model.js';
import { environmentalInputHash, resolveAnalysisInput as resolveEnvironmental, runEnvironmentalAnalysis } from '../apps/api/src/environmental/analysis.js';
import { SYSTEMS_ANALYSIS_VERSION, SystemsInputSchema, type SystemsSnapshot } from '../apps/api/src/systems/contracts.js';
import { buildSystemsModel } from '../apps/api/src/systems/model.js';
import { resolveAnalysisInput, runSystemsAnalysis, systemsInputHash } from '../apps/api/src/systems/analysis.js';
import { DISCIPLINES, KnowledgeInputSchema, type Discipline, type KnowledgePack, type Source } from '../apps/api/src/knowledge/contracts.js';
import { COORDINATION_PACK, DIMENSIONAL_PACK, authoring, bundledPack } from '../apps/api/src/knowledge/packs.js';
import { extractFacts, knowledgeBinding, type Upstream } from '../apps/api/src/knowledge/facts.js';
import { environmentalInput } from './environmental-fixtures.js';
import { systemsInput, wetFrameInput, wetTwoStorey } from './systems-fixtures.js';

/** Golden fixture G1 (design §22), built in-process from the released Phase 23–26 engines. */
export const PROJECT_ID = '11111111-1111-4111-8111-111111111111', REVISION_ID = '22222222-2222-4222-8222-222222222222';
export const IDS = { structural: '33333333-3333-4333-8333-333333333333', environmental: '44444444-4444-4444-8444-444444444444', systems: '55555555-5555-4555-8555-555555555555' } as const;
export const BUNDLED = [DIMENSIONAL_PACK, COORDINATION_PACK].map(p => ({ packId: p.packId, version: p.version }));

export function wetBim(model: BuildingModelV2 = wetTwoStorey(), revisionId = REVISION_ID): BimModel {
  return projectBim(model, { projectId: PROJECT_ID, revisionId, modelHash: modelHash(model), generatorVersion: model.provenance.generatorVersion ?? null, generationId: null,
    requirementsHash: null, parameterHash: model.parametricArchitecture ? digest(model.parametricArchitecture) : null });
}
export function structuralUpstream(bim: BimModel): NonNullable<Upstream['structural']> {
  const input = wetFrameInput(), model = buildStructuralModel(bim, input), inputHash = structuralInputHash(model.binding, input);
  return { analysisId: IDS.structural, inputHash, snapshot: { version: STRUCTURAL_ANALYSIS_VERSION, binding: model.binding, inputHash, model } as unknown as StructuralSnapshot };
}
export function environmentalUpstream(bim: BimModel): NonNullable<Upstream['environmental']> {
  const input = EnvironmentalInputSchema.parse(environmentalInput()), model = buildEnvironmentalModel(bim, input), run = runEnvironmentalAnalysis(resolveEnvironmental(model, input));
  const inputHash = environmentalInputHash(model.binding, input);
  return { analysisId: IDS.environmental, inputHash,
    snapshot: { version: ENVIRONMENTAL_ANALYSIS_VERSION, binding: model.binding, inputHash, model, results: run.results } as unknown as EnvironmentalSnapshot };
}
export function systemsUpstream(bim: BimModel, nested: Parameters<typeof buildSystemsModel>[2] = { structural: null, environmental: null },
  options: Parameters<typeof systemsInput>[0] = {}): NonNullable<Upstream['systems']> {
  const input = SystemsInputSchema.parse(systemsInput({ ...options, structuralAnalysisId: nested.structural?.analysisId ?? null, environmentalAnalysisId: nested.environmental?.analysisId ?? null }));
  const model = buildSystemsModel(bim, input, nested), run = runSystemsAnalysis(resolveAnalysisInput(model, input, nested.environmental));
  const inputHash = systemsInputHash(model.binding, input);
  return { analysisId: IDS.systems, inputHash, snapshot: { version: SYSTEMS_ANALYSIS_VERSION, binding: model.binding, inputHash, input, model, results: run.results } as unknown as SystemsSnapshot };
}
export const boundSources = (up: Upstream) => new Set<Source>(['ARCHITECTURE', ...(up.structural ? ['STRUCTURAL' as const] : []),
  ...(up.environmental ? ['ENVIRONMENTAL' as const] : []), ...(up.systems ? ['SYSTEMS' as const] : [])]);

export type G1Options = { structural?: boolean; environmental?: boolean; systems?: boolean; disciplines?: readonly Discipline[] };
/** The complete G1 scenario: BIM, all three upstream analyses, both bundled packs, every discipline. */
export function g1(options: G1Options = {}, bim: BimModel = wetBim()) {
  const up: Upstream = { structural: options.structural === false ? null : structuralUpstream(bim), environmental: options.environmental === false ? null : environmentalUpstream(bim),
    systems: options.systems === false ? null : systemsUpstream(bim) };
  const input = KnowledgeInputSchema.parse({ version: 'specialized-knowledge-input-v1', packs: BUNDLED,
    sources: { structuralAnalysisId: up.structural?.analysisId ?? null, environmentalAnalysisId: up.environmental?.analysisId ?? null, systemsAnalysisId: up.systems?.analysisId ?? null },
    scope: { disciplines: options.disciplines ?? DISCIPLINES } });
  const packs = input.packs.map(p => bundledPack(p.packId, p.version)), binding = knowledgeBinding(bim.binding, up, packs, input.scope.disciplines);
  return { bim, up, input, packs, binding, facts: extractFacts(bim, up, binding), bound: boundSources(up) };
}

/** Amendment 3: the deliberate label near-match lives here, never in the bundled catalog. */
const { gte, fact, rule, meta } = authoring;
const t = rule('test-labels');
export const LABEL_TEST_PACK: KnowledgePack = { ...meta('test-label-matching', 'Test-only label matching pack (never bundled)', ['ARCHITECTURE'], 'test-labels',
  'Test-only selectors for exact, near-match and different labels'), version: '0.0.1', rules: [
  t({ ruleId: 't1-kitchen-exact', title: 'Exact canonical label', discipline: 'ARCHITECTURE', scope: { kind: 'SPACE', labels: ['kitchen'] },
    requirement: gte(fact('ARCH_SPACE_AREA'), '5', 'm2'), meets: 'Area at least 5 m2.', doesNotMeet: 'Area below 5 m2.', locator: 'TEST-1', interpretation: 'Test only.' }),
  t({ ruleId: 't2-kitchen-near', title: 'Case and whitespace near-match label', discipline: 'ARCHITECTURE', scope: { kind: 'SPACE', labels: [' Kitchen '] },
    requirement: gte(fact('ARCH_SPACE_AREA'), '5', 'm2'), meets: 'Area at least 5 m2.', doesNotMeet: 'Area below 5 m2.', locator: 'TEST-2', interpretation: 'Test only.' }),
  t({ ruleId: 't3-pantry-different', title: 'Genuinely different label', discipline: 'ARCHITECTURE', scope: { kind: 'SPACE', labels: ['pantry'] },
    requirement: gte(fact('ARCH_SPACE_AREA'), '5', 'm2'), meets: 'Area at least 5 m2.', doesNotMeet: 'Area below 5 m2.', locator: 'TEST-3', interpretation: 'Test only.' }),
] };
