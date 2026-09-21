import { z } from 'zod';

export const QA_VERSION = 'blueprint-qa-v1' as const;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const json: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json),
]));
export const SeveritySchema = z.enum(['INFO', 'WARNING', 'ERROR']);
export const FindingSchema = z.object({
  code: z.string().regex(/^QA_[A-Z0-9_]+$/), severity: SeveritySchema,
  category: z.enum(['schema', 'document', 'dimensions', 'spaces', 'walls', 'openings', 'circulation', 'stairs', 'slabs', 'levels', 'collisions', 'site', 'policy', 'coverage']),
  message: z.string(), entityIds: z.array(z.string()), reference: z.string().optional(),
  expected: json, actual: json, evidence: z.record(json),
  ruleId: z.string().optional(), rulePackId: z.string().optional(),
}).strict();
export type Finding = z.infer<typeof FindingSchema>;
export const RuleResultSchema = z.object({
  rulePackId: z.string(), rulePackVersion: z.string(), ruleId: z.string(), version: z.string(),
  outcome: z.enum(['PASS', 'FAIL', 'NOT_APPLICABLE', 'NOT_EVALUATED']), severity: SeveritySchema,
  entityIds: z.array(z.string()), measured: json, required: json, message: z.string(),
}).strict();
export type RuleResult = z.infer<typeof RuleResultSchema>;
const area = z.string().regex(/^\d+(?:\.5)?$/);
const count = z.number().int().nonnegative();
const mm = z.number().int();
export const MeasurementsSchema = z.object({
  siteAreaMm2: area.nullable(), buildableAreaMm2: area.nullable(), grossFloorAreaMm2: area.nullable(),
  levels: z.array(z.object({ entityId: z.string(), elevationMm: mm, envelopeAreaMm2: area })),
  spaces: z.array(z.object({ entityId: z.string(), areaMm2: area, xSpanMm: mm, zSpanMm: mm })),
  walls: z.array(z.object({ entityId: z.string(), lengthMm: mm, lengthBasis: z.enum(['exact', 'rounded-nearest-mm']), grossFaceAreaMm2: area.nullable(), baseMm: mm.nullable(), topMm: mm.nullable() })),
  openings: z.array(z.object({ entityId: z.string(), areaMm2: area, baseMm: mm.nullable(), topMm: mm.nullable() })),
  slabs: z.array(z.object({ entityId: z.string(), netAreaMm2: area, topMm: mm, bottomMm: mm })),
  stairs: z.array(z.object({ entityId: z.string(), levelRiseMm: mm.nullable(), riserSumMm: mm, treadCount: count, calculatedRunMm: mm, footprintRunMm: mm, footprintWidthMm: mm })),
  dimensions: z.array(z.object({ entityId: z.string(), overallMm: mm, segmentsMm: z.array(mm), deltaMm: mm.nullable() })),
}).strict();
export const CirculationSchema = z.object({
  evaluated: z.boolean(), entrySpaceIds: z.array(z.string()),
  nodes: z.array(z.string()), edges: z.array(z.object({ from: z.string(), to: z.string(), via: z.string(), kind: z.enum(['door', 'passage', 'stair']) })),
  reachableSpaceIds: z.array(z.string()), unreachableSpaceIds: z.array(z.string()),
}).strict();
export const STAGES = ['schema', 'document', 'levels-site', 'spaces', 'walls', 'openings', 'dimensions', 'slabs-columns', 'stairs', 'circulation', 'rules'] as const;
export const BlueprintQaReportSchema = z.object({
  qaVersion: z.literal(QA_VERSION), modelSchemaVersion: z.literal(2).nullable(),
  inputStatus: z.enum(['SCHEMA_INVALID', 'SCHEMA_VALID', 'NOT_EVALUATED']),
  status: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'FAIL']),
  summary: z.object({ errors: count, warnings: count, info: count, rulePass: count, ruleFail: count, ruleNotApplicable: count, ruleNotEvaluated: count }).strict(),
  findings: z.array(FindingSchema), measurements: MeasurementsSchema, circulation: CirculationSchema,
  rulePacks: z.array(z.object({ id: z.string(), version: z.string() }).strict()), ruleResults: z.array(RuleResultSchema),
  assumptions: z.array(z.string()),
  coverage: z.array(z.object({ stage: z.enum(STAGES), outcome: z.enum(['EVALUATED', 'PARTIAL', 'NOT_EVALUATED']), details: z.string() }).strict()),
}).strict().superRefine((r, ctx) => {
  const errors = r.findings.filter(f => f.severity === 'ERROR').length;
  const warnings = r.findings.filter(f => f.severity === 'WARNING').length;
  const info = r.findings.filter(f => f.severity === 'INFO').length;
  if (r.summary.errors !== errors || r.summary.warnings !== warnings || r.summary.info !== info
    || r.status !== (errors ? 'FAIL' : warnings ? 'PASS_WITH_WARNINGS' : 'PASS')) ctx.addIssue({ code: 'custom', message: 'Status and summary must agree with findings' });
  for (const [outcome, key] of [['PASS', 'rulePass'], ['FAIL', 'ruleFail'], ['NOT_APPLICABLE', 'ruleNotApplicable'], ['NOT_EVALUATED', 'ruleNotEvaluated']] as const) {
    if (r.summary[key] !== r.ruleResults.filter(x => x.outcome === outcome).length) ctx.addIssue({ code: 'custom', message: 'Rule summary must agree with rule results' });
  }
});
export type BlueprintQaReport = z.infer<typeof BlueprintQaReportSchema>;

export function emptyReport(): BlueprintQaReport {
  return {
    qaVersion: QA_VERSION, modelSchemaVersion: null, inputStatus: 'NOT_EVALUATED', status: 'PASS',
    summary: { errors: 0, warnings: 0, info: 0, rulePass: 0, ruleFail: 0, ruleNotApplicable: 0, ruleNotEvaluated: 0 }, findings: [],
    measurements: { siteAreaMm2: null, buildableAreaMm2: null, grossFloorAreaMm2: null, levels: [], spaces: [], walls: [], openings: [], slabs: [], stairs: [], dimensions: [] },
    circulation: { evaluated: false, entrySpaceIds: [], nodes: [], edges: [], reachableSpaceIds: [], unreachableSpaceIds: [] },
    rulePacks: [], ruleResults: [], assumptions: [
      'Computational QA only; no structural, regulatory, fire, accessibility or professional certification.',
      'Space areas and spans use declared centerline boundaries, not finished clear room dimensions.',
      'Gross floor area is the sum of floor plate areas minus voids; it is not a legal GFA definition.',
      'Orthogonal walls use butt-ended prisms; junction overlap is allowed. No complete 3D solid boolean audit.',
      'Explicit point dimension anchors measure those points; V2 does not bind them to an envelope or stair.',
    ],
    coverage: STAGES.map(stage => ({ stage, outcome: 'NOT_EVALUATED', details: 'Not reached' })),
  };
}
export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function finish(report: BlueprintQaReport): BlueprintQaReport {
  const rank = { ERROR: 0, WARNING: 1, INFO: 2 };
  report.findings = [...new Map(report.findings.map(f => [JSON.stringify(f), f])).values()].sort((a, b) => rank[a.severity] - rank[b.severity] || compareText(a.code, b.code) || compareText(a.entityIds.join('|'), b.entityIds.join('|')) || compareText(JSON.stringify(a), JSON.stringify(b)));
  report.rulePacks.sort((a, b) => compareText(a.id, b.id));
  report.ruleResults.sort((a, b) => compareText(`${a.rulePackId}/${a.ruleId}/${a.entityIds.join('|')}`, `${b.rulePackId}/${b.ruleId}/${b.entityIds.join('|')}`));
  for (const value of Object.values(report.measurements)) if (Array.isArray(value)) value.sort((a, b) => compareText(a.entityId, b.entityId));
  report.assumptions = [...new Set(report.assumptions)].sort(compareText);
  const n = (severity: Finding['severity']) => report.findings.filter(f => f.severity === severity).length;
  const r = (outcome: RuleResult['outcome']) => report.ruleResults.filter(f => f.outcome === outcome).length;
  report.summary = { errors: n('ERROR'), warnings: n('WARNING'), info: n('INFO'), rulePass: r('PASS'), ruleFail: r('FAIL'), ruleNotApplicable: r('NOT_APPLICABLE'), ruleNotEvaluated: r('NOT_EVALUATED') };
  report.status = n('ERROR') ? 'FAIL' : n('WARNING') ? 'PASS_WITH_WARNINGS' : 'PASS';
  return BlueprintQaReportSchema.parse(report);
}
