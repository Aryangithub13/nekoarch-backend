import type { BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { verifyModel } from '../verification/verify.js';
import { VERIFIER_VERSION } from '../verification/contracts.js';
import { ASSESSMENT_VERSION, AssessmentReportSchema, DOMAIN_STATUSES, FORMULAS, NOT_CLAIMED_ENGINEERING, SOURCE_REGISTRY_VERSION, type AssessmentReport,
  type AssessmentRequest, type Blocker, type CostReport, type Domain, type DomainResult, type Finding } from './contracts.js';
import { SOURCES, candidates, type SourceKey } from './sources.js';
import { areaString, baseGeometry, doubled, grossVolume2, storeyHeights, toM2, toM3 } from './geometry.js';
import { conceptualCost } from './cost.js';
import { bimProfile } from './capability-limits.js';

export type Evidence = AssessmentReport['evidence'][number];
export type RelatedService = Omit<DomainResult['relatedServices'][number], 'modelSupport' | 'refusalCode'> & { serviceId: 'STRUCTURAL_ANALYSIS' | 'BUILDING_SYSTEMS_ANALYSIS' | 'SPECIALIZED_KNOWLEDGE' | 'COMPLEX_VERIFICATION' | 'QUANTITY_TAKEOFF' };
export type AssessmentInput = {
  ids: { projectId: string; revisionId: string; modelHash: string }; model: BuildingModelV2; request: AssessmentRequest;
  brief: { version: number; briefHash: string | null; floors: number | null }; evidence: Evidence[]; related: RelatedService[]; generatedAt: string;
};

export const LIMITATIONS = [
  'Preliminary assessment of a building concept. It establishes what can be calculated deterministically from the model and the declared inputs, and what cannot.',
  'No structural load, load combination, wind, seismic, soil, foundation, member, drift, stability, dynamic or collapse value is derived, assumed or approximated.',
  'Heights are measured from the lowest storey floor in the model; the model carries no ground or road level, so no statutory height is derived.',
  'Named standards are candidates for identification only: none has been retrieved or verified, so every determination that depends on one is blocked.',
  'Evidence documents are recorded as user-declared; their contents are not read or interpreted.',
  'Nothing here is a code-compliance determination, an engineering certification, a statutory approval or a statement that a building is safe to build.',
  'Generation is limited to two floors. A taller model can be supplied and assessed, but it cannot be generated, and no part of it can be regenerated.',
  'BIM-derived services (BIM, structural, environmental, building systems including egress and lifts, knowledge, scene and appearance revision) refuse models outside the bounded BIM profile of at most two storeys; relatedServices[].modelSupport states this for the assessed model.',
];
/** Related services that read the revision through the bounded BIM source profile (bim/core sourceModel). */
const BIM_GATED = new Set(['STRUCTURAL_ANALYSIS', 'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE']);

const missing = (inputPath: string, code: string, detail: string): Blocker => ({ kind: 'MISSING_INPUT', code, detail, inputPath, sourceIds: [] });
const solver = (code: string, detail: string): Blocker => ({ kind: 'NO_VALIDATED_SOLVER', code, detail, inputPath: null, sourceIds: [] });
const notImplemented = (code: string, detail: string): Blocker => ({ kind: 'NOT_IMPLEMENTED', code, detail, inputPath: null, sourceIds: [] });
const review = (detail: string, code = 'QUALIFIED_ENGINEER_REVIEW'): Blocker => ({ kind: 'PROFESSIONAL_REVIEW', code, detail, inputPath: null, sourceIds: [] });
const conflict = (inputPath: string, code: string, detail: string): Blocker => ({ kind: 'INPUT_CONFLICT', code, detail: detail.slice(0, 400), inputPath, sourceIds: [] });

/** Precedence (design §5): unsupported, then what the caller can supply, then sources, solvers and review. Computed domains are (partially) evaluated. */
export function domainStatus(computed: boolean, blockers: Blocker[]): DomainResult['status'] {
  if (computed) return blockers.length ? 'PARTIALLY_EVALUATED' : 'EVALUATED';
  const any = (...kinds: Blocker['kind'][]) => blockers.some(b => kinds.includes(b.kind));
  return any('NOT_IMPLEMENTED') ? 'UNSUPPORTED' : any('MISSING_INPUT', 'INPUT_CONFLICT') ? 'REQUIRES_INPUTS' : any('SOURCE_NOT_VERIFIED') ? 'REQUIRES_SOURCE_VERIFICATION'
    : any('NO_VALIDATED_SOLVER') ? 'REQUIRES_SOLVER' : any('PROFESSIONAL_REVIEW') ? 'REQUIRES_PROFESSIONAL_REVIEW' : 'EVALUATED';
}

function costBlockers(cost: CostReport | null, requested: boolean, jurisdiction: string | null): Blocker[] {
  if (!cost) return requested ? [] : [missing('cost', 'COST_INPUTS_REQUIRED', 'Rates with their sources for each elemental scope; no rate, index or tax factor is built in')];
  if (cost.status === 'BLOCKED') return cost.blockedReasons.map(r => conflict('cost', r, `The estimate is blocked: ${r}`));
  const out: Blocker[] = [];
  if (!jurisdiction) out.push(missing('jurisdiction.country', 'JURISDICTION_REQUIRED', 'Jurisdiction, needed to check that every rate applies to the site'));
  for (const s of cost.scopes) if (s.status === 'UNPRICED') out.push(missing(`cost.components[scope=${s.scope}]`, 'SCOPE_UNPRICED', `Price or explicitly exclude the ${s.scope} scope`));
  const rejected = new Map<string, string[]>();
  for (const l of cost.lines) if (l.reason) rejected.set(l.reason, [...(rejected.get(l.reason) ?? []), l.code]);
  for (const [reason, codes] of rejected) out.push(conflict('cost.components', reason, `Rejected components: ${codes.join(', ')}`));
  if (cost.taxBasis === 'MIXED_OR_UNKNOWN') out.push(conflict('cost.components[].includes.gst', 'GST_TREATMENT_MIXED_OR_UNKNOWN', 'State whether every rate includes GST, consistently'));
  if (cost.lines.some(l => l.status === 'PRICED' && l.includes.overheadAndProfit === 'UNKNOWN'))
    out.push(conflict('cost.components[].includes.overheadAndProfit', 'OVERHEAD_PROFIT_TREATMENT_UNKNOWN', 'State whether every rate includes overhead and profit'));
  const applied = [...cost.lines.filter(l => l.status === 'PRICED'), ...cost.adjustments];
  if (applied.some(x => x.source.jurisdiction === null))
    out.push(missing('cost.*.source.jurisdiction', 'RATE_JURISDICTION_REQUIRED', 'State the jurisdiction of every priced rate and adjustment; an unstated one cannot be checked against the site'));
  if (applied.some(x => x.source.effectiveDate === null && x.source.retrievedOn === null))
    out.push(missing('cost.*.source.effectiveDate', 'RATE_DATE_REQUIRED', 'State an effective or retrieval date for every priced rate and adjustment'));
  return out;
}

export function assessModel(input: AssessmentInput): AssessmentReport {
  const { ids, model, request, brief, evidence, related } = input;
  const verification = verifyModel(model, ids, null), bases = verification.bases;
  const height = storeyHeights(model, bases.levels), volume2 = grossVolume2(height), base = baseGeometry(model, height.heightMm);
  const gfa2 = doubled(bases.grossFloorAreaMm2), plot2 = bases.plotAreaMm2 === null ? null : doubled(bases.plotAreaMm2);
  const fallbackLevels = height.storeys.filter(s => s.plateMethod !== 'RECTILINEAR_SLAB_UNION').map(s => s.levelId);
  const inScope = (d: Domain) => !request.scope || request.scope.includes(d);
  const country = request.jurisdiction?.country ?? null, has = (kind: Evidence['kind']) => evidence.some(e => e.kind === kind);

  // ---- findings (exact; never a statutory determination) ----------------------------------------------------------
  const findings: Finding[] = [];
  const add = (findingId: Finding['findingId'], domain: Domain, status: Finding['status'], detail: string, measured: string | null = null, required: string | null = null, entityIds: string[] = []) =>
    findings.push({ findingId, domain, status, entityIds: entityIds.slice(0, 16), measured, required, detail });
  add('STOREY_COUNT', 'HEIGHT_AND_STOREYS', height.storeyCount ? 'INFO' : 'NOT_EVALUATED', 'Number of storey levels in the model', String(height.storeyCount));
  add('BUILDING_HEIGHT', 'HEIGHT_AND_STOREYS', height.heightMm === null ? 'NOT_EVALUATED' : 'INFO',
    'Top of the uppermost storey above the lowest storey floor; undetermined unless the uppermost storey has a floor-to-floor height or a roof level above it',
    height.heightMm === null ? null : `${height.heightMm} mm`);
  const undeclared = height.storeys.filter(s => s.storeyHeightBasis !== 'DECLARED_FLOOR_TO_FLOOR');
  add('STOREY_HEIGHT_DECLARED', 'HEIGHT_AND_STOREYS', !height.storeyCount ? 'NOT_EVALUATED' : undeclared.length ? 'WARNING' : 'PASS',
    undeclared.length ? 'Some storeys have no declared floor-to-floor height; their height comes from the next level or is undetermined' : 'Every storey declares its floor-to-floor height',
    `${height.storeyCount - undeclared.length}/${height.storeyCount} declared`, null, undeclared.map(s => s.levelId));
  const declared = request.declared;
  if (declared?.heightMm !== undefined) {
    const tolerance = declared.heightToleranceMm, required = `${declared.heightMm} ± ${tolerance} mm`;
    if (height.heightMm === null) add('DECLARED_HEIGHT', 'HEIGHT_AND_STOREYS', 'NOT_EVALUATED', 'The model height is undetermined', null, required);
    else add('DECLARED_HEIGHT', 'HEIGHT_AND_STOREYS', Math.abs(height.heightMm - declared.heightMm) <= tolerance ? 'PASS' : 'FAIL',
      'Model height against the caller-declared target height (exact integer comparison)', `${height.heightMm} mm`, required);
  }
  if (declared?.storeys !== undefined) add('DECLARED_STOREYS', 'HEIGHT_AND_STOREYS', height.storeyCount === declared.storeys ? 'PASS' : 'FAIL',
    'Model storey count against the caller-declared storey count', String(height.storeyCount), String(declared.storeys));
  if (brief.floors !== null) add('BRIEF_FLOORS', 'HEIGHT_AND_STOREYS', height.storeyCount === brief.floors ? 'PASS' : 'WARNING',
    'Model storey count against the floors stated in the current project brief (user-stated; basements may be counted differently)', String(height.storeyCount), String(brief.floors));
  const geometryStatus = ({ VERIFIED: 'PASS', VERIFIED_WITH_WARNINGS: 'WARNING', PARTIAL: 'NOT_EVALUATED', FAILED: 'FAIL' } as const)[verification.status];
  add('GEOMETRY_VERIFICATION', 'SITE_AND_GEOMETRY', geometryStatus, `Phase 34 independent verification: ${verification.status}`,
    `${verification.summary.fail} fail, ${verification.summary.warning} warning, ${verification.summary.notEvaluated} not evaluated`);
  add('AREA_BASIS', 'AREAS_AND_VOLUME', fallbackLevels.length ? 'WARNING' : 'PASS', fallbackLevels.length
    ? 'Some storey plates use the level envelope because floor slabs are absent or not rectilinear; areas and volumes for them are envelope-based'
    : 'Every storey plate is an exact union of its floor slabs', `${height.storeyCount - fallbackLevels.length}/${height.storeyCount} slab-based`, null, fallbackLevels);
  add('GROSS_VOLUME', 'AREAS_AND_VOLUME', volume2 === null ? 'NOT_EVALUATED' : 'INFO', 'Σ gross plate area × storey height over storeys',
    volume2 === null ? null : `${toM3(volume2).decimal(3)} m3`);
  add('BASE_MINIMUM_WIDTH', 'BASE_SLENDERNESS', base.minimumWidthMm === null ? 'NOT_EVALUATED' : 'INFO', 'Minimum caliper width of the lowest storey envelope',
    base.minimumWidthMm === null ? null : `${base.minimumWidthMm} mm`, null, base.levelId ? [base.levelId] : []);
  add('HEIGHT_TO_BASE_WIDTH', 'BASE_SLENDERNESS', base.heightToMinimumWidth ? 'INFO' : 'NOT_EVALUATED',
    'Model height divided by the minimum base width; a geometric indicator with no limit applied', base.heightToMinimumWidth?.decimal ?? null);

  // ---- cost (only arithmetic on caller-supplied, sourced rates) -----------------------------------------------------
  const cost = request.cost && inScope('PRELIMINARY_COST') ? conceptualCost(request.cost, { gfaM2: toM2(gfa2), volumeM3: volume2 === null ? null : toM3(volume2),
    plotM2: plot2 === null ? null : toM2(plot2), storeys: height.storeyCount, areaFallback: fallbackLevels.length > 0 }, country) : null;

  // ---- domains ------------------------------------------------------------------------------------------------------
  const J = country ? [] : [missing('jurisdiction.country', 'JURISDICTION_REQUIRED', 'Country (and state) of the site; governing sources depend on it')];
  const L = request.jurisdiction?.locality ? [] : [missing('jurisdiction.locality', 'LOCALITY_REQUIRED', 'Site locality, needed before any site-specific wind or seismic parameter can be established')];
  const O = request.occupancy ? [] : [missing('occupancy.primary', 'OCCUPANCY_REQUIRED', 'Primary occupancy of the building')];
  const S = request.structuralSystem ? [] : [missing('structuralSystem.primaryMaterial', 'STRUCTURAL_SYSTEM_REQUIRED', 'Primary structural material and system (not inferred from the architecture)')];
  const G = has('GEOTECHNICAL_INVESTIGATION') ? [] : [missing('evidence[GEOTECHNICAL_INVESTIGATION]', 'GEOTECHNICAL_INVESTIGATION_REQUIRED',
    'A site geotechnical investigation; no soil property or bearing capacity is ever assumed')];
  const H = height.heightMm === null ? [missing('model.levels', 'BUILDING_HEIGHT_UNDETERMINED', 'A floor-to-floor height for the uppermost storey, or a roof level above it')] : [];
  const src = (keys: SourceKey[], what: string): Blocker[] => {
    const found = candidates(country, keys);
    return [found.length ? { kind: 'SOURCE_NOT_VERIFIED', code: 'CANDIDATE_SOURCE_NOT_VERIFIED', detail: `${what}: candidate governing documents are named but not retrieved, read or verified`,
      inputPath: null, sourceIds: found.map(s => s.sourceId) }
      : { kind: 'SOURCE_NOT_VERIFIED', code: 'GOVERNING_SOURCE_NOT_IDENTIFIED', detail: country ? `${what}: no governing source is catalogued for jurisdiction ${country}`
        : `${what}: the governing source depends on the undeclared jurisdiction`, inputPath: null, sourceIds: [] }];
  };
  // The verifier runs inside this assessment, so it is SUPPORTED; BIM-gated services are asked through the real gate; anything else makes no claim.
  const profile = bimProfile(model);
  const support = (serviceId: RelatedService['serviceId']) => serviceId === 'COMPLEX_VERIFICATION' ? { modelSupport: 'SUPPORTED' as const, refusalCode: null }
    : !BIM_GATED.has(serviceId) ? { modelSupport: 'NOT_CHECKED' as const, refusalCode: null }
    : profile.supported ? { modelSupport: 'SUPPORTED' as const, refusalCode: null } : { modelSupport: 'REFUSED' as const, refusalCode: profile.refusalCode };
  const services = (...serviceIds: RelatedService['serviceId'][]) => related.filter(r => serviceIds.includes(r.serviceId)).map(({ serviceId, route, artifactsForRevision, note }) =>
    ({ serviceId, route, artifactsForRevision, note, ...support(serviceId) }));
  const definitions: [Domain, DomainResult['assuranceLevel'], boolean, Blocker[], DomainResult['relatedServices']][] = [
    ['HEIGHT_AND_STOREYS', 'GEOMETRIC_VERIFICATION', true, height.storeyCount ? H : [missing('model.levels', 'STOREYS_REQUIRED', 'At least one storey level')], []],
    ['AREAS_AND_VOLUME', 'GEOMETRIC_VERIFICATION', true, volume2 === null ? H : [], []],
    ['SITE_AND_GEOMETRY', 'GEOMETRIC_VERIFICATION', true, [...(model.site ? [] : [missing('model.site', 'SITE_REQUIRED', 'A site boundary in the model')]),
      ...(verification.status === 'PARTIAL' ? [notImplemented('VERIFIER_NOT_EVALUATED', 'Some checks cannot be evaluated exactly (for example non-rectilinear unions); see the verification report')] : [])],
    services('COMPLEX_VERIFICATION')],
    ['BASE_SLENDERNESS', 'GEOMETRIC_VERIFICATION', true, H, []],
    ['PRELIMINARY_COST', 'PRELIMINARY_COST_ESTIMATE', cost !== null && cost.status !== 'BLOCKED', costBlockers(cost, !!request.cost && !cost, country), services('QUANTITY_TAKEOFF')],
    ['GRAVITY_LOADS', 'CODE_APPLICABILITY', false, [...J, ...O, ...S, ...src(['IS875_1', 'IS875_2'], 'Dead and imposed loads'),
      review('Load derivation and load combinations must be established by a qualified structural engineer')], services('STRUCTURAL_ANALYSIS')],
    ['WIND_LOADS', 'CODE_APPLICABILITY', false, [...J, ...L, ...H, ...src(['IS875_3', 'IS16700'], 'Wind loads'),
      solver('NO_WIND_RESPONSE_METHOD', `No validated method for wind loads or tall-building wind response is implemented${has('WIND_TUNNEL_STUDY') ? '; the declared wind tunnel study is recorded, not interpreted' : ''}`),
      review('Wind design basis must be established by a qualified engineer')], []],
    ['SEISMIC_LOADS', 'CODE_APPLICABILITY', false, [...J, ...L, ...O, ...S, ...G, ...src(['IS1893_1', 'IS16700'], 'Seismic loads'),
      solver('NO_SEISMIC_ANALYSIS_METHOD', 'No validated response-spectrum, modal or time-history analysis is implemented'),
      review('Seismic design basis must be established by a qualified engineer')], services('STRUCTURAL_ANALYSIS')],
    ['GEOTECHNICAL_AND_FOUNDATIONS', 'VALIDATED_STRUCTURAL_ANALYSIS', false, [...G,
      solver('NO_FOUNDATION_DESIGN_METHOD', 'No foundation sizing, capacity or settlement method is implemented'), review('Foundation design requires a qualified geotechnical and structural engineer')], []],
    ['LATERAL_DRIFT_AND_STABILITY', 'VALIDATED_STRUCTURAL_ANALYSIS', false, [...S, ...src(['IS16700'], 'Drift and stability criteria'),
      solver('NO_LATERAL_STABILITY_SOLVER', 'The Phase 24 solver is linear-static with no rigid diaphragm, no wall or slab panels and no second-order (P-delta) effects; it cannot establish drift or stability'),
      review('Lateral system design requires a qualified structural engineer')], services('STRUCTURAL_ANALYSIS')],
    ['DYNAMIC_RESPONSE', 'VALIDATED_STRUCTURAL_ANALYSIS', false, [...S, solver('NO_MODAL_OR_DYNAMIC_SOLVER', 'No modal, dynamic or occupant-comfort acceleration analysis is implemented'),
      review('Dynamic behaviour requires specialist engineering review')], []],
    ['MEMBER_DESIGN', 'VALIDATED_STRUCTURAL_ANALYSIS', false, [notImplemented('NO_MEMBER_DESIGN', 'Member sizing, reinforcement and utilisation checks are not implemented, and none are estimated'),
      review('Member design requires a qualified structural engineer')], services('STRUCTURAL_ANALYSIS')],
    ['PROGRESSIVE_COLLAPSE', 'VALIDATED_STRUCTURAL_ANALYSIS', false, [notImplemented('NO_PROGRESSIVE_COLLAPSE_ANALYSIS', 'Progressive-collapse and robustness analysis is not implemented'),
      review('Robustness requires specialist engineering review')], []],
    ['FIRE_AND_LIFE_SAFETY', 'CODE_APPLICABILITY', false, [...J, ...O, ...src(['NBC'], 'Fire and life-safety provisions for tall buildings'),
      review('Fire and life-safety strategy requires the fire authority and a qualified fire engineer', 'FIRE_AUTHORITY_REVIEW')], services('BUILDING_SYSTEMS_ANALYSIS')],
    ['VERTICAL_TRANSPORT', 'PRELIMINARY_CALCULATION', false, [...O, notImplemented('NO_LIFT_TRAFFIC_ANALYSIS', 'Lift traffic, handling capacity and waiting-time analysis is not implemented')],
      services('BUILDING_SYSTEMS_ANALYSIS')],
    ['CODE_COMPLIANCE', 'CODE_APPLICABILITY', false, [...J, notImplemented('NO_COMPLIANCE_DETERMINATION', 'No building-code compliance determination is implemented; declared limits are compared by the verifier only'),
      review('Compliance is determined by the competent authority', 'STATUTORY_REVIEW')], services('SPECIALIZED_KNOWLEDGE', 'COMPLEX_VERIFICATION')],
    ['CERTIFICATION_AND_APPROVAL', 'PROFESSIONAL_DESIGN_AND_APPROVAL', false,
      [review('Engineering certification and statutory approval are given only by qualified professionals and the competent authority', 'CERTIFICATION_AND_STATUTORY_APPROVAL')], []],
  ];
  const domains: DomainResult[] = definitions.filter(([d]) => inScope(d)).map(([domain, assuranceLevel, computed, blockers, relatedServices]) =>
    ({ domain, assuranceLevel, status: domainStatus(computed, blockers), blockers: blockers.slice(0, 24), relatedServices }));

  const requirements = new Map<string, { inputPath: string; detail: string; neededFor: Domain[] }>();
  for (const d of domains) for (const b of d.blockers) if (b.inputPath && (b.kind === 'MISSING_INPUT' || b.kind === 'INPUT_CONFLICT')) {
    const r = requirements.get(b.inputPath) ?? { inputPath: b.inputPath, detail: b.detail, neededFor: [] };
    if (!r.neededFor.includes(d.domain)) r.neededFor.push(d.domain);
    requirements.set(b.inputPath, r);
  }
  const sourceIds = new Set(domains.flatMap(d => d.blockers.flatMap(b => b.sourceIds)));
  const summary = Object.fromEntries(DOMAIN_STATUSES.map(s => [s, domains.filter(d => d.status === s).length])) as AssessmentReport['summary'];
  const consistency = findings.some(f => f.status === 'FAIL') ? 'INCONSISTENT' as const : findings.some(f => f.status === 'NOT_EVALUATED') ? 'PARTIAL' as const : 'CONSISTENT' as const;

  const context = { briefVersion: brief.version, briefHash: brief.briefHash, briefFloors: brief.floors, jurisdiction: request.jurisdiction ?? null,
    occupancy: request.occupancy?.primary ?? null, structuralSystem: request.structuralSystem ? { primaryMaterial: request.structuralSystem.primaryMaterial,
      description: request.structuralSystem.description ?? null } : null, provenance: 'USER_DECLARED_NOT_VERIFIED' as const };
  const inputHash = costHash({ assessmentVersion: ASSESSMENT_VERSION, modelHash: ids.modelHash, verifierInputHash: verification.inputHash, context, request, evidence,
    related: related.map(r => [r.serviceId, r.artifactsForRevision]) });
  const body = {
    assessmentVersion: ASSESSMENT_VERSION, ...ids, inputHash,
    engine: { assessmentVersion: ASSESSMENT_VERSION, verifierVersion: VERIFIER_VERSION, sourceRegistryVersion: SOURCE_REGISTRY_VERSION, formulas: { ...FORMULAS } },
    context, consistency, height,
    areas: { grossFloorAreaMm2: bases.grossFloorAreaMm2, grossFloorAreaM2: toM2(gfa2).decimal(6), plotAreaMm2: bases.plotAreaMm2, netSpaceAreaMm2: bases.netSpaceAreaMm2,
      far: bases.far, coverageRatio: bases.coverageRatio, grossVolumeMm3: volume2 === null ? null : areaString(volume2), grossVolumeM3: volume2 === null ? null : toM3(volume2).decimal(6),
      formulas: { ...bases.formulas, grossVolume: 'Σ over storeys of gross plate area × storey height (mm³, exact); null when any storey height is undetermined',
        grossFloorAreaM2: 'grossFloorArea / 10⁶, rounded half-up to 6 decimals for display; the mm² value is exact' } },
    baseGeometry: base,
    verification: { verifierVersion: verification.verifierVersion, status: verification.status, inputHash: verification.inputHash, summary: verification.summary,
      route: `/api/projects/${ids.projectId}/revisions/${ids.revisionId}/verification` },
    findings, domains, summary, requirements: [...requirements.values()], sources: Object.values(SOURCES).filter(s => sourceIds.has(s.sourceId)),
    evidence, cost, limitations: LIMITATIONS, claims: { ...NOT_CLAIMED_ENGINEERING },
  };
  return AssessmentReportSchema.parse({ ...body, resultHash: costHash(body), generatedAt: input.generatedAt });
}
