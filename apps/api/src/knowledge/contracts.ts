import { z } from 'zod';
import { ITEM_UNITS } from '@designflow/quantity-takeoff';
import { BIM_VERSION, BimBindingSchema } from '../bim/contracts.js';
import { STRUCTURAL_MODEL_VERSION, type StructuralSnapshot } from '../structural/contracts.js';
import { ENVIRONMENTAL_MODEL_VERSION, type EnvironmentalSnapshot } from '../environmental/contracts.js';
import { SYSTEMS_MODEL_VERSION, type SystemsSnapshot } from '../systems/contracts.js';

// Normative specification: docs/phase27/phase27-design.md. Literals change only with semantics.
export const KNOWLEDGE_INPUT_VERSION = 'specialized-knowledge-input-v1';
export const KNOWLEDGE_MODEL_VERSION = 'specialized-knowledge-model-v1';
export const KNOWLEDGE_ANALYSIS_VERSION = 'specialized-knowledge-analysis-v1';
export const FACTS_VERSION = 'project-facts-v1';
export const PACK_FORMAT = 'knowledge-pack-v1';
export const RULE_FORMAT = 'knowledge-rule-v1';
export const RULE_EVALUATOR = 'knowledge-rule-evaluator-v1';
export const CONFLICT_DETECTOR = 'knowledge-conflict-detector-v1';
export const UNITS_VERSION = 'knowledge-units-v1';
export const FLOAT_POLICY = 'knowledge-float-boundary-v1';
export const MODEL_VALIDATOR = 'specialized-knowledge-validator-v1', RESULT_VALIDATOR = 'specialized-knowledge-result-validator-v1';
export const EVALUATOR = { name: 'nekoarch-knowledge-evaluator', version: '1.0.0' } as const;
export const ENGINE = { knowledgeEngine: KNOWLEDGE_ANALYSIS_VERSION, factExtractor: FACTS_VERSION, ruleEvaluator: RULE_EVALUATOR,
  conflictDetector: CONFLICT_DETECTOR, units: UNITS_VERSION, floatPolicy: FLOAT_POLICY } as const;
/** §10.1: number of binary64 spacings around an UPSTREAM_FLOAT value inside which a comparison is ambiguous. Version-locked by FLOAT_POLICY. */
export const FLOAT_BOUNDARY_ULPS = 16;
/** Frozen from benchmark evidence (docs/phase27/evidence/benchmark-pre-freeze.json, design §19): results cost ~1.35 KB each, so
 * subjectResults keeps the snapshot inside outputBytes before any evaluation work; rulesSelected keeps realistic packs within it. */
export const KNOWLEDGE_LIMITS = { inputBytes: 16_384, packsSelected: 8, rulesPerPack: 256, rulesSelected: 512, packBytes: 262_144, predicateDepth: 8, nodesPerRule: 64,
  childrenPerAllAny: 16, labelsPerSelector: 32, facts: 20_000, subjectResults: 6_000, conflictPairs: 100_000, conflicts: 1_000, evidencePerResult: 128, outputBytes: 8_388_608,
  calculationMs: 5_000 } as const;

export const DISCIPLINES = ['ARCHITECTURE', 'COST', 'ENVIRONMENTAL', 'LIFE_SAFETY', 'MEP', 'QUANTITY', 'STRUCTURAL', 'VERTICAL_TRANSPORT'] as const;
export type Discipline = typeof DISCIPLINES[number];
export const SUBJECT_KINDS = ['BUILDING', 'ELEVATOR', 'LEVEL', 'MEP_NETWORK', 'OPENING', 'SPACE', 'STAIR', 'STRUCTURAL_MEMBER', 'THERMAL_CASE'] as const;
export type SubjectKind = typeof SUBJECT_KINDS[number];
export const SOURCES = ['ARCHITECTURE', 'STRUCTURAL', 'ENVIRONMENTAL', 'SYSTEMS'] as const;
export type Source = typeof SOURCES[number];
/** Which source must be bound for subjects of a kind to exist. */
export const SUBJECT_SOURCE: Record<SubjectKind, Source> = { BUILDING: 'ARCHITECTURE', LEVEL: 'ARCHITECTURE', SPACE: 'ARCHITECTURE', OPENING: 'ARCHITECTURE', STAIR: 'ARCHITECTURE',
  STRUCTURAL_MEMBER: 'STRUCTURAL', MEP_NETWORK: 'SYSTEMS', ELEVATOR: 'SYSTEMS', THERMAL_CASE: 'ENVIRONMENTAL' };
export const PRECISIONS = ['UPSTREAM_FLOAT', 'EXACT_RATIONAL', 'EXACT_DECIMAL_STRING', 'EXACT_INTEGER', 'CATEGORICAL'] as const;
export type Precision = typeof PRECISIONS[number];
export const ARTIFACT_TYPES = ['ARCHITECTURE_REVISION', 'BIM_QUANTITY_TAKEOFF', 'STRUCTURAL_ANALYSIS', 'ENVIRONMENTAL_ANALYSIS', 'SYSTEMS_ANALYSIS'] as const;
export const DERIVATIONS = ['DIRECT', 'COUNT', 'MAX', 'SUM', 'DIFFERENCE', 'POLYGON_AREA', 'QUOTIENT', 'BOUNDS_EXTENT', 'EQUALITY'] as const;
export const STATUSES = ['CONFLICTING_RULES', 'DOES_NOT_MEET_RULE', 'INPUT_INCOMPLETE', 'MEETS_RULE', 'NOT_APPLICABLE', 'NOT_EVALUATED', 'REVIEW_REQUIRED', 'UNSUPPORTED'] as const;
export type Status = typeof STATUSES[number];
/** Predicate-level statuses (§8): T, F and the unknowns R < I < E. */
export const TRUTHS = ['T', 'F', 'R', 'I', 'E'] as const;
export type Truth = typeof TRUTHS[number];
export const REASONS = ['APPLICABILITY_FALSE', 'EMPTY_SCOPE', 'FLOAT_BOUNDARY_AMBIGUITY', 'LABEL_NEAR_MATCH', 'MANUAL_REVIEW', 'MISSING_FACT', 'RATIO_ZERO_DENOMINATOR',
  'SOURCE_NOT_BOUND', 'UNSUPPORTED_FACT'] as const;
export type Reason = typeof REASONS[number];

/** Unit → dimension (§11). Conversion factors are deliberately NOT here: evaluator and validator each own theirs. */
export const UNIT_DIMENSIONS = { mm: 'length', m: 'length', mm2: 'area', m2: 'area', mm3: 'volume', m3: 'volume', W: 'power', kW: 'power', VA: 'apparent-power', kVA: 'apparent-power',
  'L/s': 'flow', 'm3/s': 'flow', 'm/s': 'velocity', '1': 'ratio', '%': 'ratio', count: 'count', MONEY: 'money' } as const;
export type Unit = keyof typeof UNIT_DIMENSIONS;
export const UNITS = Object.keys(UNIT_DIMENSIONS) as [Unit, ...Unit[]];
/** Takeoff quantities are stored in mm, mm2, mm3 or each. */
export const itemUnit = (code: string): Unit | null => {
  if (!Object.prototype.hasOwnProperty.call(ITEM_UNITS, code)) return null;
  const u = (ITEM_UNITS as Record<string, string>)[code]!;
  return u === 'each' ? 'count' : u as Unit;
};

type Entry = { subject: SubjectKind; value: 'DECIMAL' | 'ENUM' | 'BOOLEAN' | 'LABEL'; unit: Unit | null; precision: Precision | null; source: Source; supported: boolean;
  /** LABEL facts carry subject-label provenance and may not appear in packs. */ referable: boolean; domain?: readonly string[]; parameter?: 'ITEM_CODE' };
const d = (subject: SubjectKind, unit: Unit, precision: Precision, source: Source): Entry => ({ subject, value: 'DECIMAL', unit, precision, source, supported: true, referable: true });
const cat = (subject: SubjectKind, value: 'ENUM' | 'BOOLEAN', source: Source, domain?: readonly string[]): Entry =>
  ({ subject, value, unit: null, precision: 'CATEGORICAL', source, supported: true, referable: true, ...(domain ? { domain } : {}) });
const label = (subject: SubjectKind, source: Source): Entry => ({ subject, value: 'LABEL', unit: null, precision: 'CATEGORICAL', source, supported: true, referable: false });
const unsupported = (subject: SubjectKind, value: 'DECIMAL' | 'ENUM', unit: Unit | null, source: Source): Entry => ({ subject, value, unit, precision: null, source, supported: false, referable: true });
/** The V1 fact catalog (§9). Precision is decided by the source schema, never by the value. */
export const FACT_CATALOG = {
  ARCH_STOREY_COUNT: d('BUILDING', 'count', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_BUILDING_HEIGHT: d('BUILDING', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_LEVEL_ELEVATION: d('LEVEL', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_FLOOR_TO_FLOOR_HEIGHT: d('LEVEL', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_SPACE_CLASSIFICATION: label('SPACE', 'ARCHITECTURE'),
  ARCH_SPACE_AREA: d('SPACE', 'mm2', 'EXACT_DECIMAL_STRING', 'ARCHITECTURE'),
  ARCH_SPACE_WINDOW_AREA: d('SPACE', 'mm2', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_SPACE_OCCUPANCY: d('SPACE', 'count', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_OPENING_KIND: label('OPENING', 'ARCHITECTURE'),
  ARCH_OPENING_WIDTH: d('OPENING', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_OPENING_HEIGHT: d('OPENING', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_OPENING_SILL: d('OPENING', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_OPENING_IS_SITE_ENTRY: cat('OPENING', 'BOOLEAN', 'ARCHITECTURE'),
  ARCH_STAIR_WIDTH: d('STAIR', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_STAIR_TREAD_DEPTH: d('STAIR', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_STAIR_MAX_RISER: d('STAIR', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_STAIR_RISER_COUNT: d('STAIR', 'count', 'EXACT_INTEGER', 'ARCHITECTURE'),
  ARCH_STAIR_HEADROOM: d('STAIR', 'mm', 'EXACT_INTEGER', 'ARCHITECTURE'),
  QUANTITY_TOTAL: { subject: 'BUILDING', value: 'DECIMAL', unit: null, precision: 'EXACT_DECIMAL_STRING', source: 'ARCHITECTURE', supported: true, referable: true, parameter: 'ITEM_CODE' },
  STRUCT_MEMBER_KIND: label('STRUCTURAL_MEMBER', 'STRUCTURAL'),
  STRUCT_SECTION_WIDTH: d('STRUCTURAL_MEMBER', 'mm', 'UPSTREAM_FLOAT', 'STRUCTURAL'),
  STRUCT_SECTION_DEPTH: d('STRUCTURAL_MEMBER', 'mm', 'UPSTREAM_FLOAT', 'STRUCTURAL'),
  STRUCT_MEMBER_LENGTH: d('STRUCTURAL_MEMBER', 'mm', 'UPSTREAM_FLOAT', 'STRUCTURAL'),
  ENV_ZONE_FLOOR_AREA: d('SPACE', 'm2', 'UPSTREAM_FLOAT', 'ENVIRONMENTAL'),
  ENV_WINDOW_TO_FLOOR_RATIO: d('SPACE', '1', 'UPSTREAM_FLOAT', 'ENVIRONMENTAL'),
  ENV_ENVELOPE_STATUS: cat('BUILDING', 'ENUM', 'ENVIRONMENTAL', ['CLOSED', 'INCOMPLETE']),
  ENV_TRANSMISSION_TOTAL: d('THERMAL_CASE', 'W', 'UPSTREAM_FLOAT', 'ENVIRONMENTAL'),
  SYS_EGRESS_DISTANCE: d('SPACE', 'mm', 'UPSTREAM_FLOAT', 'SYSTEMS'),
  SYS_EGRESS_REACHABLE: cat('SPACE', 'BOOLEAN', 'SYSTEMS'),
  SYS_DISTINCT_EXITS_REACHABLE: d('SPACE', 'count', 'EXACT_INTEGER', 'SYSTEMS'),
  SYS_DEAD_END_LENGTH: d('SPACE', 'mm', 'UPSTREAM_FLOAT', 'SYSTEMS'),
  SYS_EGRESS_AVAILABLE: cat('BUILDING', 'BOOLEAN', 'SYSTEMS'),
  SYS_PENETRATION_COUNT: d('BUILDING', 'count', 'EXACT_INTEGER', 'SYSTEMS'),
  SYS_BLOCKING_CLASH_COUNT: d('BUILDING', 'count', 'EXACT_INTEGER', 'SYSTEMS'),
  SYS_ELECTRICAL_CONNECTED_W: d('BUILDING', 'W', 'EXACT_RATIONAL', 'SYSTEMS'),
  SYS_ELECTRICAL_DEMAND_W: d('BUILDING', 'W', 'EXACT_RATIONAL', 'SYSTEMS'),
  SYS_NETWORK_SYSTEM: label('MEP_NETWORK', 'SYSTEMS'),
  SYS_NETWORK_STATUS: cat('MEP_NETWORK', 'ENUM', 'SYSTEMS', ['INPUT_INCOMPLETE', 'ROUTED', 'ROUTE_INVALID', 'ROUTE_NOT_FOUND', 'UNSUPPORTED']),
  SYS_NETWORK_LENGTH: d('MEP_NETWORK', 'mm', 'UPSTREAM_FLOAT', 'SYSTEMS'),
  SYS_DRAINAGE_SLOPE: d('MEP_NETWORK', '1', 'EXACT_RATIONAL', 'SYSTEMS'),
  SYS_DUCT_MAX_VELOCITY: d('MEP_NETWORK', 'm/s', 'EXACT_RATIONAL', 'SYSTEMS'),
  SYS_ELEVATOR_STATUS: cat('ELEVATOR', 'ENUM', 'SYSTEMS', ['PROPOSED', 'REJECTED']),
  SYS_ELEVATOR_VERTICAL_ACCESS: cat('ELEVATOR', 'ENUM', 'SYSTEMS', ['NOT_EVALUATED', 'VERTICAL_ACCESS_PATH_AVAILABLE', 'VERTICAL_ACCESS_PATH_NOT_AVAILABLE']),
  SYS_ELEVATOR_DOOR_WIDTH: d('ELEVATOR', 'mm', 'EXACT_INTEGER', 'SYSTEMS'),
  SYS_ELEVATOR_SHAFT_WIDTH: d('ELEVATOR', 'mm', 'EXACT_INTEGER', 'SYSTEMS'),
  SYS_ELEVATOR_SHAFT_DEPTH: d('ELEVATOR', 'mm', 'EXACT_INTEGER', 'SYSTEMS'),
  // Declared but not provided in V1: packs stay valid and report UNSUPPORTED instead of failing to parse.
  COST_TOTAL: unsupported('BUILDING', 'DECIMAL', 'MONEY', 'ARCHITECTURE'),
  STRUCT_UTILISATION: unsupported('STRUCTURAL_MEMBER', 'DECIMAL', '1', 'STRUCTURAL'),
  ARCH_DOOR_CLEAR_WIDTH: unsupported('OPENING', 'DECIMAL', 'mm', 'ARCHITECTURE'),
  ARCH_FIRE_RATING: unsupported('OPENING', 'ENUM', null, 'ARCHITECTURE'),
  SYS_OCCUPANT_LOAD: unsupported('SPACE', 'DECIMAL', 'count', 'SYSTEMS'),
} as const satisfies Record<string, Entry>;
export type FactType = keyof typeof FACT_CATALOG;
export const FACT_TYPES = Object.keys(FACT_CATALOG).sort() as [FactType, ...FactType[]];
export const catalog = (t: FactType): Entry => FACT_CATALOG[t];
/** Subject label fact per kind (null: the kind has no label). */
export const LABEL_FACT: Record<SubjectKind, FactType | null> = { SPACE: 'ARCH_SPACE_CLASSIFICATION', OPENING: 'ARCH_OPENING_KIND', STRUCTURAL_MEMBER: 'STRUCT_MEMBER_KIND',
  MEP_NETWORK: 'SYS_NETWORK_SYSTEM', BUILDING: null, LEVEL: null, STAIR: null, ELEVATOR: null, THERMAL_CASE: null };

export const CLAIMS = { architecturalCompliance: 'NOT_CLAIMED', structuralCompliance: 'NOT_CLAIMED', electricalCompliance: 'NOT_CLAIMED', plumbingCompliance: 'NOT_CLAIMED',
  hvacCompliance: 'NOT_CLAIMED', fireCodeCompliance: 'NOT_CLAIMED', lifeSafetyCertification: 'NOT_CLAIMED', accessibilityCompliance: 'NOT_CLAIMED', elevatorCertification: 'NOT_CLAIMED',
  energyCertification: 'NOT_CLAIMED', buildingCodeCompliance: 'NOT_CLAIMED', legalCompliance: 'NOT_CLAIMED', professionalCertification: 'NOT_CLAIMED' } as const;
export const LIMITATIONS = [
  'Advisory rule evaluation only: a result states how one explicit machine-readable rule evaluated over these exact facts, never compliance, certification or professional approval.',
  'Only the explicitly selected bundled demonstration packs are evaluated; no jurisdiction or building code is selected, inferred or implied.',
  'Facts come only from the accepted revision and explicitly bound same-revision analyses; occupancy, accessibility, fire ratings, structural capacity and cost are not evaluated.',
  'Upstream floating-point values keep their stored precision; comparisons within 16 binary64 spacings of a threshold are returned as REVIEW_REQUIRED.',
  'Conflict detection covers simple scalar constraints on the same fact, scope and applicability only; anything else is reported as NOT_EVALUATED.',
] as const;

export type KnowledgeErrorCode = 'KNOWLEDGE_PACK_UNKNOWN' | 'KNOWLEDGE_PACK_INVALID' | 'KNOWLEDGE_SOURCE_UNSUPPORTED' | 'TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT'
  | 'KNOWLEDGE_RESOURCE_LIMIT' | 'KNOWLEDGE_MODEL_INVALID' | 'KNOWLEDGE_RESULT_INVALID' | 'KNOWLEDGE_RESULT_STALE';
export class KnowledgeError extends Error {
  constructor(readonly code: KnowledgeErrorCode, message: string) { super(message); this.name = 'KnowledgeError'; }
}

// ---------------------------------------------------------------- primitives
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/);
const semver = z.string().regex(/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/);
const text = (max: number) => z.string().min(1).max(max);
/** Canonical decimal literal (§5): no exponent, sign only when negative, no leading or trailing zeros, never "-0". */
export const DecimalSchema = z.string().regex(/^-?(0|[1-9]\d{0,19})(\.\d{0,19}[1-9])?$/).refine(v => v !== '-0', 'Negative zero');
/** Canonical exact rational: a terminating decimal, otherwise reduced "n/d" with d > 1. */
const exact = z.string().max(400).regex(/^-?(0|[1-9]\d*)(\.\d*[1-9])?$|^-?[1-9]\d*\/[1-9]\d*$/);
/** ULP-band values can be long exact decimals: 2^-1074 alone has 1074 fractional digits (§10.1). Never truncated. */
const exactLong = z.string().max(1200).regex(/^-?(0|[1-9]\d*)(\.\d*[1-9])?$|^-?[1-9]\d*\/[1-9]\d*$/);
const pointer = z.string().max(300).regex(/^(\/[A-Za-z0-9_.:-]*)*$/);
const discipline = z.enum(DISCIPLINES), kind = z.enum(SUBJECT_KINDS), factType = z.enum(FACT_TYPES), unit = z.enum(UNITS);
const labels = z.array(text(200)).min(1).max(KNOWLEDGE_LIMITS.labelsPerSelector).refine(l => new Set(l).size === l.length, 'Labels must be unique').nullable();

// ---------------------------------------------------------------- rule AST (knowledge-rule-v1)
export const FactRefSchema = z.object({ factType, parameter: z.string().max(100).nullable() }).strict();
export type FactRef = z.infer<typeof FactRefSchema>;
export const OperandSchema = z.union([z.object({ fact: FactRefSchema }).strict(), z.object({ count: z.object({ kind, labels }).strict() }).strict(),
  z.object({ ratio: z.object({ numerator: FactRefSchema, denominator: FactRefSchema }).strict() }).strict()]);
export type Operand = z.infer<typeof OperandSchema>;
export const LiteralSchema = z.object({ decimal: DecimalSchema, unit }).strict();
export type Literal = z.infer<typeof LiteralSchema>;
export type Predicate =
  | { op: 'EXISTS'; fact: FactRef }
  | { op: 'EQUALS'; fact: FactRef; value: string | boolean }
  | { op: 'GTE' | 'LTE'; left: Operand; right: Literal }
  | { op: 'ALL' | 'ANY'; of: Predicate[] }
  | { op: 'NOT'; of: Predicate }
  | { op: 'MANUAL_REVIEW'; reason: string };
// z.lazy recursion is reached only after the iterative bounded() depth/node preflight (§5).
export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.object({ op: z.literal('EXISTS'), fact: FactRefSchema }).strict(),
  z.object({ op: z.literal('EQUALS'), fact: FactRefSchema, value: z.union([text(100), z.boolean()]) }).strict(),
  z.object({ op: z.enum(['GTE', 'LTE']), left: OperandSchema, right: LiteralSchema }).strict(),
  z.object({ op: z.enum(['ALL', 'ANY']), of: z.array(PredicateSchema).min(2).max(KNOWLEDGE_LIMITS.childrenPerAllAny) }).strict(),
  z.object({ op: z.literal('NOT'), of: PredicateSchema }).strict(),
  z.object({ op: z.literal('MANUAL_REVIEW'), reason: text(200) }).strict(),
]) as z.ZodType<Predicate>);
const severity = z.enum(['INFO', 'WARNING', 'ERROR']);
export const RuleSchema = z.object({ ruleId: slug, version: z.string().regex(/^[1-9]\d{0,3}$/), title: text(200), discipline, severity,
  advisory: z.literal(true), reviewDiscipline: discipline.nullable(), scope: z.object({ kind, labels }).strict(),
  applicability: PredicateSchema.nullable(), requirement: PredicateSchema, requiredFacts: z.array(FactRefSchema).max(KNOWLEDGE_LIMITS.nodesPerRule),
  semantics: z.object({ meets: text(200), doesNotMeet: text(200) }).strict(),
  sourceReference: z.object({ refId: slug, locator: text(80), interpretation: text(300) }).strict(),
  limitations: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).max(8) }).strict();
export type Rule = z.infer<typeof RuleSchema>;
export const PackSchema = z.object({ format: z.literal(PACK_FORMAT), packId: slug, version: semver, title: text(200), disciplines: z.array(discipline).min(1).max(8),
  publisher: z.object({ name: text(200), kind: z.enum(['PROJECT_AUTHORED', 'ORGANIZATION', 'STANDARDS_BODY', 'AUTHORITY', 'OTHER']) }).strict(),
  jurisdiction: z.object({ code: text(40), name: text(200) }).strict().nullable(), edition: text(80), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sourceType: z.enum(['SYNTHETIC_DEMONSTRATION', 'OPEN_LICENSED', 'ORGANIZATION_POLICY', 'LICENSED_REFERENCE']),
  license: z.object({ spdx: text(64), redistribution: z.enum(['PERMITTED', 'RESTRICTED', 'UNKNOWN']) }).strict(),
  sourceReferences: z.array(z.object({ refId: slug, title: text(200), uri: z.string().url().max(500).nullable(), note: text(300) }).strict()).min(1).max(32),
  provenance: z.object({ authoredBy: text(200), method: text(80) }).strict(),
  rules: z.array(RuleSchema).min(1).max(KNOWLEDGE_LIMITS.rulesPerPack) }).strict();
export type KnowledgePack = z.infer<typeof PackSchema>;
export const CatalogEntrySchema = z.object({ packId: slug, version: semver, title: text(200), disciplines: z.array(discipline), publisher: PackSchema.shape.publisher,
  jurisdiction: PackSchema.shape.jurisdiction, edition: text(80), effectiveDate: PackSchema.shape.effectiveDate, sourceType: PackSchema.shape.sourceType,
  license: PackSchema.shape.license, checksum: hash, ruleCount: z.number().int().positive() }).strict();
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

// ---------------------------------------------------------------- input (specialized-knowledge-input-v1)
const packRef = z.object({ packId: slug, version: semver }).strict();
const sources = z.object({ structuralAnalysisId: uuid.nullable(), environmentalAnalysisId: uuid.nullable(), systemsAnalysisId: uuid.nullable() }).strict();
export const KnowledgeInputSchema = z.object({ version: z.literal(KNOWLEDGE_INPUT_VERSION),
  packs: z.array(packRef).min(1).max(KNOWLEDGE_LIMITS.packsSelected).refine(p => new Set(p.map(x => x.packId)).size === p.length, 'One version per pack'),
  sources: z.object({ structuralAnalysisId: uuid.nullable().default(null), environmentalAnalysisId: uuid.nullable().default(null), systemsAnalysisId: uuid.nullable().default(null) })
    .strict().default({ structuralAnalysisId: null, environmentalAnalysisId: null, systemsAnalysisId: null }),
  scope: z.object({ disciplines: z.array(discipline).min(1).max(DISCIPLINES.length).refine(d => new Set(d).size === d.length, 'Disciplines must be unique') }).strict(),
}).strict().transform(i => ({ version: i.version, packs: [...i.packs].sort((a, b) => a.packId < b.packId ? -1 : 1), sources: i.sources,
  scope: { disciplines: [...i.scope.disciplines].sort() } }));
export type KnowledgeInput = z.output<typeof KnowledgeInputSchema>;
/** The persisted, already-canonical input (no defaults or transform, so stored JSON round-trips byte for byte). */
export const StoredInputSchema = z.object({ version: z.literal(KNOWLEDGE_INPUT_VERSION), packs: z.array(packRef).min(1).max(KNOWLEDGE_LIMITS.packsSelected), sources,
  scope: z.object({ disciplines: z.array(discipline).min(1).max(DISCIPLINES.length) }).strict() }).strict();

// ---------------------------------------------------------------- binding
const upstream = <V extends string>(version: V) => z.object({ analysisId: uuid, inputHash: hash, modelVersion: z.literal(version) }).strict().nullable();
export const KnowledgeBindingSchema = BimBindingSchema.extend({ bimVersion: z.literal(BIM_VERSION), knowledgeModelVersion: z.literal(KNOWLEDGE_MODEL_VERSION),
  structural: upstream(STRUCTURAL_MODEL_VERSION), environmental: upstream(ENVIRONMENTAL_MODEL_VERSION), systems: upstream(SYSTEMS_MODEL_VERSION),
  engine: z.object({ knowledgeEngine: z.literal(ENGINE.knowledgeEngine), factExtractor: z.literal(ENGINE.factExtractor), ruleEvaluator: z.literal(ENGINE.ruleEvaluator),
    conflictDetector: z.literal(ENGINE.conflictDetector), units: z.literal(ENGINE.units), floatPolicy: z.literal(ENGINE.floatPolicy) }).strict(),
  packs: z.array(z.object({ packId: slug, version: semver, checksum: hash }).strict()).min(1).max(KNOWLEDGE_LIMITS.packsSelected),
  disciplines: z.array(discipline).min(1).max(DISCIPLINES.length) }).strict();
export type KnowledgeBinding = z.infer<typeof KnowledgeBindingSchema>;

/** Explicitly bound, revision-scoped upstream analyses (design §14.1). */
export type Upstream = {
  structural: { analysisId: string; inputHash: string; snapshot: StructuralSnapshot } | null;
  environmental: { analysisId: string; inputHash: string; snapshot: EnvironmentalSnapshot } | null;
  systems: { analysisId: string; inputHash: string; snapshot: SystemsSnapshot } | null;
};

// ---------------------------------------------------------------- facts (project-facts-v1)
export const SubjectSchema = z.object({ kind, id: text(240), label: text(200).nullable() }).strict();
export type Subject = z.infer<typeof SubjectSchema>;
export const FactValueSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('DECIMAL'), exact, unit }).strict(),
  z.object({ kind: z.literal('ENUM'), value: text(100) }).strict(), z.object({ kind: z.literal('BOOLEAN'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('LABEL'), value: text(200) }).strict()]);
export type FactValue = z.infer<typeof FactValueSchema>;
export const FactSchema = z.object({ factId: z.string().regex(/^fact-[a-f0-9]{40}$/), factType, parameter: z.string().max(100).nullable(), subject: SubjectSchema,
  status: z.enum(['PRESENT', 'ABSENT']), value: FactValueSchema.nullable(), precision: z.enum(PRECISIONS),
  source: z.object({ artifactType: z.enum(ARTIFACT_TYPES), artifactId: uuid, revisionId: uuid, modelHash: hash, engineVersion: text(100), inputHash: hash.nullable(), pointer }).strict(),
  derivation: z.object({ method: z.enum(DERIVATIONS), inputs: z.array(pointer).max(256) }).strict() }).strict()
  .refine(f => (f.status === 'PRESENT') === (f.value !== null), 'ABSENT facts carry no value');
export type Fact = z.infer<typeof FactSchema>;
export const FactSetSchema = z.object({ version: z.literal(FACTS_VERSION), items: z.array(FactSchema).max(KNOWLEDGE_LIMITS.facts),
  summary: z.object({ present: z.number().int().nonnegative(), absent: z.number().int().nonnegative(),
    bySource: z.object({ ARCHITECTURE: z.number().int().nonnegative(), STRUCTURAL: z.number().int().nonnegative(), ENVIRONMENTAL: z.number().int().nonnegative(),
      SYSTEMS: z.number().int().nonnegative() }).strict() }).strict() }).strict();
export type FactSet = z.infer<typeof FactSetSchema>;

// ---------------------------------------------------------------- results
export type Trace = { op: Predicate['op']; status: Truth; reason: Reason | null;
  observed: { value: string | null; unit: Unit | null; factId: string | null; precision: Precision | null } | null;
  threshold: { literal: string; unit: Unit | null; normalized: string; canonicalUnit: Unit | null } | null;
  comparison: string | null; basis: { policy: typeof FLOAT_POLICY; ulps: string; ulp: string; band: string; diff: string } | null; children: Trace[] };
export const TraceSchema: z.ZodType<Trace> = z.lazy(() => z.object({ op: z.enum(['EXISTS', 'EQUALS', 'GTE', 'LTE', 'ALL', 'ANY', 'NOT', 'MANUAL_REVIEW']), status: z.enum(TRUTHS),
  reason: z.enum(REASONS).nullable(),
  observed: z.object({ value: z.string().max(400).nullable(), unit: unit.nullable(), factId: z.string().max(45).nullable(), precision: z.enum(PRECISIONS).nullable() }).strict().nullable(),
  threshold: z.object({ literal: z.string().max(100), unit: unit.nullable(), normalized: z.string().max(400), canonicalUnit: unit.nullable() }).strict().nullable(),
  comparison: z.string().max(900).nullable(),
  basis: z.object({ policy: z.literal(FLOAT_POLICY), ulps: z.string().max(10), ulp: exactLong, band: exactLong, diff: exactLong }).strict().nullable(),
  children: z.array(TraceSchema).max(KNOWLEDGE_LIMITS.childrenPerAllAny) }).strict()) as z.ZodType<Trace>;
const ruleRef = z.string().max(140);
const evidence = z.object({ factId: z.string(), pointer, artifactType: z.enum(ARTIFACT_TYPES), artifactId: uuid }).strict();
export const ResultSchema = z.object({ resultId: z.string().regex(/^kr-[a-f0-9]{40}$/), packId: slug, packVersion: semver, ruleId: slug, ruleVersion: z.string().max(4),
  discipline, severity, subject: SubjectSchema.nullable(),
  applicability: z.object({ status: z.enum(['APPLICABLE', 'NOT_APPLICABLE', 'UNDETERMINED', 'NOT_DECLARED', 'NOT_REACHED']), trace: TraceSchema.nullable() }).strict(),
  status: z.enum(STATUSES), isolatedStatus: z.enum(STATUSES), reason: z.enum(REASONS).nullable(), precision: z.enum(PRECISIONS).nullable(),
  observedFacts: z.array(z.string()).max(KNOWLEDGE_LIMITS.evidencePerResult), evidence: z.array(evidence).max(KNOWLEDGE_LIMITS.evidencePerResult),
  trace: TraceSchema.nullable(), explanation: z.object({ summary: z.string().max(1200), semantics: z.string().max(200).nullable() }).strict(),
  nearMatch: z.object({ observed: text(200), expected: z.array(text(200)), sourceEntity: z.object({ kind, id: text(240) }).strict(), reason: z.literal('LABEL_NEAR_MATCH'),
    evidence: z.array(z.string()) }).strict().nullable(),
  conflictIds: z.array(z.string()), conflictAnalysis: z.enum(['EVALUATED', 'CONFLICT', 'NOT_EVALUATED']),
  reviewRequired: z.boolean(), reviewDisciplines: z.array(discipline),
  sourceReference: z.object({ packId: slug, refId: slug, locator: text(80), interpretation: text(300) }).strict() }).strict();
export type KnowledgeResult = z.infer<typeof ResultSchema>;
const bound = z.object({ value: exact, closed: z.boolean() }).strict().nullable();
export const ConflictSchema = z.object({ conflictId: z.string().regex(/^cnf-[a-f0-9]{40}$/), rules: z.array(ruleRef).length(2), factType, parameter: z.string().max(100).nullable(),
  scope: z.object({ kind, labels: z.array(z.string()).nullable() }).strict(),
  constraints: z.array(z.object({ rule: ruleRef, lower: bound, upper: bound, allowed: z.array(z.string()).nullable(), excluded: z.array(z.string()) }).strict()).length(2),
  reason: z.literal('EMPTY_INTERSECTION') }).strict();
export type Conflict = z.infer<typeof ConflictSchema>;
const counts = z.object(Object.fromEntries(STATUSES.map(s => [s, z.number().int().nonnegative()])) as Record<Status, z.ZodNumber>).strict();
export const EvaluationSchema = z.object({ results: z.array(ResultSchema).max(KNOWLEDGE_LIMITS.subjectResults), conflicts: z.array(ConflictSchema).max(KNOWLEDGE_LIMITS.conflicts),
  missingInputs: z.array(z.object({ kind: z.enum(['SOURCE', 'FACT']), source: z.enum(SOURCES).nullable(), factType: factType.nullable(), parameter: z.string().max(100).nullable(),
    subject: SubjectSchema.nullable(), ruleIds: z.array(ruleRef) }).strict()),
  unsupported: z.array(z.object({ factType, ruleIds: z.array(ruleRef), reason: z.literal('NOT_PROVIDED_IN_V1') }).strict()),
  disciplineSummary: z.record(discipline, counts),
  summary: z.object({ rulesSelected: z.number().int().nonnegative(), results: z.number().int().nonnegative(), byStatus: counts, conflicts: z.number().int().nonnegative(),
    rulesConflictNotEvaluated: z.number().int().nonnegative() }).strict() }).strict();
export type Evaluation = z.infer<typeof EvaluationSchema>;

// ---------------------------------------------------------------- snapshot (specialized-knowledge-analysis-v1)
const claimsShape = Object.fromEntries(Object.keys(CLAIMS).map(k => [k, z.literal('NOT_CLAIMED')])) as Record<keyof typeof CLAIMS, z.ZodLiteral<'NOT_CLAIMED'>>;
export const ClaimsSchema = z.object(claimsShape).strict();
const diagnostics = z.array(z.object({ code: z.string().max(60), path: z.string().max(300), message: z.string().max(300) }).strict()).max(200);
export const ModelValidationSchema = z.object({ validator: z.literal(MODEL_VALIDATOR), status: z.enum(['VALID', 'INVALID']), diagnostics }).strict();
export type ModelValidation = z.infer<typeof ModelValidationSchema>;
export const ResultValidationSchema = z.object({ validator: z.literal(RESULT_VALIDATOR), status: z.enum(['VALID', 'INVALID']), diagnostics,
  recomputed: z.object({ facts: z.number().int().nonnegative(), results: z.number().int().nonnegative(), conflicts: z.number().int().nonnegative() }).strict() }).strict();
export type ResultValidation = z.infer<typeof ResultValidationSchema>;
export const SnapshotPackSchema = z.object({ packId: slug, version: semver, checksum: hash, pack: PackSchema, rulesTotal: z.number().int().positive(),
  rulesSelected: z.number().int().nonnegative() }).strict();
export const SnapshotSchema = z.object({ version: z.literal(KNOWLEDGE_ANALYSIS_VERSION), binding: KnowledgeBindingSchema, inputHash: hash, factsHash: hash, input: StoredInputSchema,
  packs: z.array(SnapshotPackSchema).min(1).max(KNOWLEDGE_LIMITS.packsSelected), facts: FactSetSchema,
  evaluator: z.object({ name: z.literal(EVALUATOR.name), version: z.literal(EVALUATOR.version) }).strict() }).merge(EvaluationSchema).extend({
  validation: z.object({ model: ModelValidationSchema, results: ResultValidationSchema }).strict(),
  status: z.object({ analysis: z.literal('EVALUATED'), validation: z.literal('VALIDATED') }).strict(), claims: ClaimsSchema,
  limitations: z.array(z.string().max(300)).max(16) }).strict();
export type KnowledgeSnapshot = z.infer<typeof SnapshotSchema>;

// ---------------------------------------------------------------- HTTP DTOs
export const KnowledgeSummarySchema = z.object({ id: uuid, projectRevisionId: uuid, acceptanceQaId: uuid, knowledgeModelVersion: z.literal(KNOWLEDGE_MODEL_VERSION),
  analysisVersion: z.literal(KNOWLEDGE_ANALYSIS_VERSION), modelHash: hash, inputHash: hash, factsHash: hash,
  packs: z.array(z.object({ packId: slug, version: semver, checksum: hash }).strict()), evaluator: z.object({ name: z.string().max(100), version: z.string().max(100) }).strict(),
  status: z.literal('VALIDATED'), structuralAnalysisId: uuid.nullable(), environmentalAnalysisId: uuid.nullable(), systemsAnalysisId: uuid.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  counts: z.object({ facts: z.number().int().nonnegative(), results: z.number().int().nonnegative(), conflicts: z.number().int().nonnegative(),
    meets: z.number().int().nonnegative(), doesNotMeet: z.number().int().nonnegative() }).strict() }).strict();
export const KnowledgeDetailSchema = KnowledgeSummarySchema.extend({ snapshot: SnapshotSchema });
export const KnowledgeCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: uuid }).strict();
export const KnowledgeReadQuerySchema = z.object({ require: z.literal('current').optional() }).strict();
