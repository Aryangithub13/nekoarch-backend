import { costHash } from '@designflow/boq-cost';
import type { BuildingModelV2 } from '@designflow/shared';
import { DIFF_COLLECTIONS, DIFF_VERSION, DiffReportSchema, type DiffReport } from './contracts.js';

type Change = DiffReport['changes'][number];
type Entity = { id: string; levelId?: string; fromLevelId?: string; toLevelId?: string };

/** Levels an entity belongs to: a level is its own scope, a stair spans two, most entities carry `levelId`. */
function levelsOf(collection: (typeof DIFF_COLLECTIONS)[number], entity: Entity): string[] {
  if (collection === 'levels') return [entity.id];
  return [entity.levelId, entity.fromLevelId, entity.toLevelId].filter((v, i, a): v is string => typeof v === 'string' && a.indexOf(v) === i);
}

/**
 * Entity-level comparison of two revisions against a declared change scope. Each entity is compared by its canonical hash, so any
 * change to any field (geometry, specification, classification) counts. Independent of the BIM diff.
 */
export function scopedDiff(base: BuildingModelV2, other: BuildingModelV2, ids: { projectId: string; baseRevisionId: string; otherRevisionId: string;
  baseModelHash: string; otherModelHash: string }, scope: { levelIds: string[]; entityIds: string[]; allowSiteChange: boolean }): DiffReport {
  const levels = new Set(scope.levelIds), entities = new Set(scope.entityIds), changes: Change[] = [];
  for (const collection of DIFF_COLLECTIONS) {
    const before = new Map((base[collection] as Entity[]).map(e => [e.id, e])), after = new Map((other[collection] as Entity[]).map(e => [e.id, e]));
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const a = before.get(id), b = after.get(id);
      const change = !a ? 'ADDED' : !b ? 'REMOVED' : costHash(a) !== costHash(b) ? 'CHANGED' : null;
      if (!change) continue;
      // An entity moved between levels is in scope only if both its old and new levels are.
      const levelIds = [...new Set([...(a ? levelsOf(collection, a) : []), ...(b ? levelsOf(collection, b) : [])])];
      const inScope = entities.has(id) || (levelIds.length > 0 && levelIds.every(l => levels.has(l)));
      changes.push({ collection, entityId: id, change, levelIds: levelIds.slice(0, 2), inScope });
    }
  }
  const siteChanged = costHash(base.site ?? null) !== costHash(other.site ?? null);
  if (siteChanged) changes.push({ collection: 'site', entityId: (other.site ?? base.site)!.id, change: !base.site ? 'ADDED' : !other.site ? 'REMOVED' : 'CHANGED',
    levelIds: [], inScope: scope.allowSiteChange });
  const violations = changes.filter(c => !c.inScope);
  return DiffReportSchema.parse({ diffVersion: DIFF_VERSION, ...ids, scope,
    status: !changes.length ? 'IDENTICAL' : violations.length ? 'OUT_OF_SCOPE_CHANGES' : 'WITHIN_SCOPE', changes, violations,
    counts: { added: changes.filter(c => c.change === 'ADDED').length, removed: changes.filter(c => c.change === 'REMOVED').length,
      changed: changes.filter(c => c.change === 'CHANGED').length, outOfScope: violations.length } });
}
