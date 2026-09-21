import { BuildingModelShapeSchema } from '@designflow/shared';
import { Context, QaResourceLimit } from './context.js';
import { documentAudit, levelsSiteAudit, slabsColumnsAudit, spacesAudit, wallsAudit } from './core.js';
import { dimensionsAudit } from './dimensions.js';
import { openingsAudit } from './openings.js';
import { stairsAudit } from './stairs.js';
import { circulationAudit } from './circulation.js';
import { BlueprintQaOptionsSchema } from './options.js';
import { emptyReport, finish, type BlueprintQaReport, type Finding } from './report.js';
import { rulesAudit, rulesNotEvaluated } from './rules.js';

/** Bounded plain JSON preflight prevents accessors, cycles and oversized rings reaching Zod refinements. */
function preflight(value: unknown): void {
  let nodes = 0, polygonWork = 0;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): void {
    if (++nodes > 2_000_000 || depth > 24) throw new QaResourceLimit('JSON size/depth limit exceeded');
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return;
    if (typeof v === 'string') { if (v.length > 10000) throw new QaResourceLimit('JSON string limit exceeded'); return; }
    if (typeof v !== 'object') throw new TypeError('Input must be plain JSON data');
    if (ancestors.has(v)) throw new TypeError('Cyclic input is not a JSON document');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new TypeError('Input must contain plain JSON objects');
    ancestors.add(v);
    if (Array.isArray(v) && v.length > 8192) throw new QaResourceLimit('Array exceeds V2 entity limits');
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if ('get' in descriptor || 'set' in descriptor) throw new TypeError('Input must not contain accessors');
      if (key !== 'length') visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(v) && v.length >= 3 && v[0] && typeof v[0] === 'object' && 'x' in v[0] && 'z' in v[0]) {
      if (v.length > 256) throw new QaResourceLimit('Polygon vertex limit exceeded');
      polygonWork += v.length * v.length;
      if (polygonWork > 20_000_000) throw new QaResourceLimit('Schema polygon work limit exceeded');
    }
    // Footprint refinement compares voids pairwise as well as against the outer ring.
    const outer = descriptors['outer']?.value as unknown, voids = descriptors['voids']?.value as unknown;
    if (Array.isArray(outer) && Array.isArray(voids)) {
      const vertices = outer.length + voids.reduce((sum: number, ring: unknown) => sum + (Array.isArray(ring) ? ring.length : 0), 0);
      polygonWork += vertices * vertices;
      if (polygonWork > 20_000_000) throw new QaResourceLimit('Schema footprint work limit exceeded');
    }
    ancestors.delete(v);
  }
  visit(value, 0);
}
function initialFinding(report: BlueprintQaReport, code: string, message: string, reference?: string): void {
  const finding: Finding = { code, severity: 'ERROR', category: 'schema', entityIds: [], message, expected: 'supported plain V2 architectural JSON and QA options', actual: null, evidence: {}, ...(reference === undefined ? {} : { reference }) };
  report.findings.push(finding);
}

/** No mutation, timestamps, random state, generator diagnostics or external calls. */
export function auditBlueprint(input: unknown, options: unknown = {}): BlueprintQaReport {
  const report = emptyReport();
  try { preflight(options); } catch (error) {
    initialFinding(report, 'QA_OPTIONS_INVALID', error instanceof Error ? error.message : 'Invalid options'); return finish(report);
  }
  const parsedOptions = BlueprintQaOptionsSchema.safeParse(options);
  if (!parsedOptions.success) {
    for (const issue of parsedOptions.error.issues) initialFinding(report, 'QA_OPTIONS_INVALID', issue.message, `options.${issue.path.join('.')}`);
    return finish(report);
  }
  const config = parsedOptions.data;
  report.rulePacks = config.rulePacks.map(p => ({ id: p.id, version: p.version }));
  try { preflight(input); } catch (error) {
    initialFinding(report, error instanceof QaResourceLimit ? 'QA_RESOURCE_LIMIT' : 'QA_SCHEMA_INVALID', error instanceof Error ? error.message : 'Invalid input');
    report.inputStatus = error instanceof QaResourceLimit ? 'NOT_EVALUATED' : 'SCHEMA_INVALID';
    rulesNotEvaluated(report, config.rulePacks, 'Input did not pass the bounded JSON boundary.');
    return finish(report);
  }
  const parsed = BuildingModelShapeSchema.safeParse(input);
  report.coverage[0] = { stage: 'schema', outcome: 'EVALUATED', details: 'V2 shape, integer units, bounded entities, simple polygons, contained disjoint voids, positive lengths and operation enums' };
  if (!parsed.success) {
    report.inputStatus = 'SCHEMA_INVALID';
    for (const issue of parsed.error.issues.slice(0, 10000)) initialFinding(report, 'QA_SCHEMA_INVALID', issue.message, issue.path.join('.'));
    if (parsed.error.issues.length > 10000) initialFinding(report, 'QA_RESOURCE_LIMIT', `Schema produced ${parsed.error.issues.length} issues; only the first 10000 are included. Semantic checks did not run.`);
    rulesNotEvaluated(report, config.rulePacks, 'Document shape is invalid; semantic policy cannot be evaluated.');
    return finish(report);
  }
  report.inputStatus = 'SCHEMA_VALID'; report.modelSchemaVersion = 2;
  const c = new Context(parsed.data, config, report);
  const stages: [BlueprintQaReport['coverage'][number]['stage'], (c: Context) => void, string][] = [
    ['document', documentAudit, 'Independent identity, cross-reference and completeness checks'],
    ['levels-site', levelsSiteAudit, 'Level order/heights, declared permitted polygons, rectangular site setbacks'],
    ['spaces', spacesAudit, 'Centerline area/spans, same-level interior overlap and level containment'],
    ['walls', wallsAudit, 'Wall extents, vertical geometry, interval duplication, geometric adjacency, represented-edge gaps and fragments; not watertight solids'],
    ['openings', openingsAudit, 'Exact hosted bounds, vertical extents, rectangle overlaps and orthogonal interval topology'],
    ['dimensions', dimensionsAudit, 'Independent anchors, axis measurements, strict ordering and exact controlling reconciliation'],
    ['slabs-columns', slabsColumnsAudit, 'Plate areas, levels, extents, same-kind overlap, column bounds and vertical geometry'],
    ['stairs', stairsAudit, 'Straight-flight arithmetic, footprint, endpoint landings, access, full-flight void correspondence and conservative solid interference'],
    ['circulation', circulationAudit, 'Rebuilt valid door/passage/stair graph; reachability only from explicit caller/pack entries'],
    ['rules', rulesAudit, 'Opt-in versioned declarative policies, independent of core geometry validity'],
  ];
  for (const [stage, execute, details] of stages) {
    const coverage = report.coverage.find(s => s.stage === stage)!;
    coverage.outcome = 'EVALUATED'; coverage.details = details;
    try { execute(c); } catch (error) {
      if (!(error instanceof QaResourceLimit)) throw error; // Programming failures are not disguised as invalid user documents.
      coverage.outcome = 'PARTIAL'; coverage.details += '; operation budget exhausted';
      report.findings.push({ code: 'QA_RESOURCE_LIMIT', severity: 'ERROR', category: 'coverage', entityIds: [], message: `Audit stopped: ${error.message}. Remaining checks are not evaluated.`, expected: { maxGeometryWork: config.maxGeometryWork, maxFindings: 10000, maxRuleResults: 10000 }, actual: { geometryWork: c.work, findings: report.findings.length, ruleResults: report.ruleResults.length }, evidence: {} });
      rulesNotEvaluated(report, config.rulePacks, 'Audit resource limit prevented complete policy evaluation.');
      return finish(report);
    }
    if (stage === 'document' && (parsed.data.completeness !== 'architectural' || report.findings.some(f => f.code === 'QA_DUPLICATE_ID'))) {
      rulesNotEvaluated(report, config.rulePacks, 'Incomplete document or ambiguous duplicate IDs prevent semantic evaluation.');
      return finish(report);
    }
  }
  return finish(report);
}
