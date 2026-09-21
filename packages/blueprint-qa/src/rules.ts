import type { BuildingWall } from '@designflow/shared';
import { Context, QaResourceLimit } from './context.js';
import { area2, areaString, bounds, coversSegment, edgeList, isRectangle, wallSolid2 } from './geometry.js';
import type { ArchitecturalRule } from './options.js';
import type { BlueprintQaReport, JsonValue, RuleResult } from './report.js';

const requirement = (r: ArchitecturalRule): JsonValue => 'minimumMm' in r ? r.minimumMm : 'minimumMm2' in r ? r.minimumMm2 : 'maximumMm' in r ? r.maximumMm : true;
function exterior(c: Context, w: BuildingWall): boolean | null {
  const adjacent = c.wallSpaces.get(w.id) ?? [];
  if (adjacent.length === 2) return false;
  const level = c.levels.get(w.levelId);
  if (!level) return null;
  if (coversSegment(w.path.start, w.path.end, edgeList(level.boundary))) return true;
  const solid = wallSolid2(w);
  if (!solid || !isRectangle(level.boundary)) return null;
  const l = bounds(level.boundary), b = bounds(solid);
  if (b.minX === 2 * l.minX || b.maxX === 2 * l.maxX || b.minZ === 2 * l.minZ || b.maxZ === 2 * l.maxZ) return true;
  return null;
}
export function recordRule(report: BlueprintQaReport, result: RuleResult): void {
  report.ruleResults.push(result);
  if (result.outcome === 'FAIL' || result.outcome === 'NOT_EVALUATED') report.findings.push({
    code: result.outcome === 'FAIL' ? 'QA_RULE_FAILED' : 'QA_RULE_NOT_EVALUATED',
    severity: result.outcome === 'FAIL' ? result.severity : 'WARNING', category: 'policy',
    message: result.message, entityIds: result.entityIds, expected: result.required, actual: result.measured,
    evidence: { outcome: result.outcome, ruleVersion: result.version, rulePackVersion: result.rulePackVersion },
    ruleId: result.ruleId, rulePackId: result.rulePackId,
  });
}
export function rulesNotEvaluated(report: BlueprintQaReport, packs: import('./options.js').ArchitecturalRulePack[], reason: string): void {
  for (const p of packs) for (const r of p.rules) {
    if (report.ruleResults.some(result => result.ruleId === r.id && result.rulePackId === p.id)) continue;
    recordRule(report, { rulePackId: p.id, rulePackVersion: p.version, ruleId: r.id, version: r.version, outcome: 'NOT_EVALUATED', severity: r.severity, entityIds: [], measured: null, required: requirement(r), message: reason });
  }
}
export function rulesAudit(c: Context): void {
  // Snapshot core failures so policy outcomes never invalidate later independent policies.
  const broken = new Set(c.report.findings.filter(f => f.severity === 'ERROR').flatMap(f => f.entityIds));
  for (const pack of c.options.rulePacks) for (const rule of pack.rules) {
    let results = 0;
    const emit = (ids: string[], measured: JsonValue, passed: boolean | null, message: string) => {
      c.spend();
      if (c.report.ruleResults.length >= 10000 || c.report.findings.length >= 10000) throw new QaResourceLimit('Policy output limit exceeded');
      results++;
      const unavailable = passed === null || ids.some(id => broken.has(id));
      recordRule(c.report, { rulePackId: pack.id, rulePackVersion: pack.version, ruleId: rule.id, version: rule.version,
        severity: rule.severity, entityIds: ids, measured, required: requirement(rule),
        outcome: unavailable ? 'NOT_EVALUATED' : passed ? 'PASS' : 'FAIL',
        message: unavailable ? `${message} Required geometry or semantics are missing or inconsistent.` : message,
      });
    };
    const spaces = c.model.spaces.filter(s => !('classifications' in rule) || rule.classifications === undefined || rule.classifications.includes(s.classification));
    switch (rule.kind) {
      case 'minimum-space-area':
        for (const s of spaces) emit([s.id], areaString(area2(s.boundary)), area2(s.boundary) >= 2n * BigInt(rule.minimumMm2), 'Compare centerline polygon area with the caller-supplied minimum mm².');
        break;
      case 'minimum-space-span':
        for (const s of spaces) {
          const b = bounds(s.boundary), span = rule.axis === 'x' ? b.maxX - b.minX : b.maxZ - b.minZ;
          emit([s.id], span, isRectangle(s.boundary) ? span >= rule.minimumMm : null, `Compare rectangular centerline ${rule.axis} span with the caller-supplied minimum mm.`);
        }
        break;
      case 'minimum-door-width':
        for (const o of c.model.openings.filter(o => o.kind === 'door')) emit([o.id], o.widthMm, c.invalidOpenings.has(o.id) ? null : o.widthMm >= rule.minimumMm, 'Compare modeled door width with the caller-supplied minimum mm.');
        break;
      case 'maximum-riser-height':
        for (const s of c.model.stairs) emit([s.id], Math.max(...s.riserHeightsMm), Math.max(...s.riserHeightsMm) <= rule.maximumMm, 'Compare every riser against the caller-supplied maximum mm.');
        break;
      case 'minimum-tread-depth':
        for (const s of c.model.stairs) emit([s.id], s.treadDepthMm, s.treadDepthMm >= rule.minimumMm, 'Compare tread depth with the caller-supplied minimum mm.');
        break;
      case 'required-window':
        for (const s of spaces) {
          const supportedWalls = c.model.walls.filter(w => (c.wallSpaces.get(w.id) ?? []).includes(s.id));
          const windows = c.model.openings.filter(o => o.kind === 'window' && !c.invalidOpenings.has(o.id) && c.openingSpaces.get(o.id)?.includes(s.id));
          emit([s.id], windows.map(o => o.id), supportedWalls.length ? windows.length > 0 : null, 'Check for a valid geometrically adjoining window in each selected space.');
        }
        break;
      case 'exterior-windows':
        for (const o of c.model.openings.filter(o => o.kind === 'window')) {
          const w = c.walls.get(o.wallId), isExterior = w && !c.invalidOpenings.has(o.id) ? exterior(c, w) : null;
          emit([o.id], isExterior, isExterior, 'Check window host against modeled envelope boundary and space adjacency.');
        }
        break;
      case 'reachable-spaces':
        for (const s of spaces) {
          const reached = c.report.circulation.reachableSpaceIds.includes(s.id);
          emit([s.id], c.report.circulation.evaluated ? reached : null, c.report.circulation.evaluated ? reached : null, 'Check entrance-connected circulation for the selected space.');
        }
        break;
      case 'column-free-spaces':
        for (const s of spaces) {
          const columns = c.model.columns.filter(col => col.levelId === s.levelId && col.baseOffsetMm <= 0 && col.baseOffsetMm + col.heightMm > 0 && c.overlap(col.crossSection.outer, s.boundary) && !col.crossSection.voids.some(v => c.contains(v, s.boundary)));
          emit([s.id], columns.map(col => col.id), columns.length === 0, 'Check caller-designated column-free floor space against represented column solids.');
        }
        break;
    }
    if (!results) recordRule(c.report, { rulePackId: pack.id, rulePackVersion: pack.version, ruleId: rule.id, version: rule.version, outcome: 'NOT_APPLICABLE', severity: rule.severity, entityIds: [], measured: null, required: requirement(rule), message: 'No entities match this rule selector.' });
  }
}
