import { ringContains, ringsOverlap, type BuildingModelV2, type Point2Mm } from '@designflow/shared';
import type { ParsedOptions } from './options.js';
import type { BlueprintQaReport, Finding, JsonValue } from './report.js';
import { bounds, boxesOverlap } from './geometry.js';

export class QaResourceLimit extends Error {}
export class Context {
  work = 0;
  readonly levels;
  readonly walls;
  readonly spaces;
  readonly openings;
  readonly wallSpaces = new Map<string, string[]>();
  readonly openingSpaces = new Map<string, string[]>();
  readonly invalidOpenings = new Set<string>();
  readonly invalidStairs = new Set<string>();
  constructor(readonly model: BuildingModelV2, readonly options: ParsedOptions, readonly report: BlueprintQaReport) {
    this.levels = new Map(model.levels.map(l => [l.id, l]));
    this.walls = new Map(model.walls.map(w => [w.id, w]));
    this.spaces = new Map(model.spaces.map(s => [s.id, s]));
    this.openings = new Map(model.openings.map(o => [o.id, o]));
  }
  spend(n = 1): void { this.work += n; if (this.work > this.options.maxGeometryWork) throw new QaResourceLimit('Geometry work limit exceeded'); }
  contains(outer: readonly Point2Mm[], inner: readonly Point2Mm[]): boolean {
    this.spend(outer.length * inner.length * 4); return ringContains(outer, inner);
  }
  overlap(a: readonly Point2Mm[], b: readonly Point2Mm[]): boolean {
    this.spend();
    if (!boxesOverlap(bounds(a), bounds(b))) return false;
    this.spend(a.length * b.length * 8); return ringsOverlap(a, b);
  }
  add(code: string, category: Finding['category'], entityIds: string[], message: string, expected: JsonValue = null, actual: JsonValue = null, evidence: Record<string, JsonValue> = {}, severity: Finding['severity'] = 'ERROR', reference?: string): void {
    if (this.report.findings.length >= 10000) throw new QaResourceLimit('Finding output limit exceeded');
    this.report.findings.push({ code, category, entityIds: [...entityIds].sort(), message, expected, actual, evidence, severity, ...(reference === undefined ? {} : { reference }) });
  }
  partial(stage: BlueprintQaReport['coverage'][number]['stage'], detail: string): void {
    const entry = this.report.coverage.find(s => s.stage === stage)!;
    entry.outcome = 'PARTIAL'; entry.details += `; ${detail}`;
  }
}
