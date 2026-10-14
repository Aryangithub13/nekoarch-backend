import { costHash } from '@designflow/boq-cost';
import type { BuildingModelV2 } from '@designflow/shared';
import { DIFF_COLLECTIONS, DIFF_VERSION, DiffReportSchema, type DiffReport } from './contracts.js';

type Change = DiffReport['changes'][number];
type Entity = { id: string; levelId?: string; fromLevelId?: string; toLevelId?: string; spaceIds?: string[] };

/** A wall's spaceIds are a set (the model invariant compares them sorted), so their order is not a change; Phase 35 preservation uses the same rule. */
const canonical = (collection: (typeof DIFF_COLLECTIONS)[number], e: Entity) => collection === 'walls' && e.spaceIds ? { ...e, spaceIds: [...e.spaceIds].sort() } : e;
/** Document-level fields: everything but the compared collections, the site and provenance (outside model identity, as in Phase 35). */
const documentFields = (m: BuildingModelV2) => {
  const { site: _site, provenance: _provenance, levels: _l, spaces: _s, walls: _w, openings: _o, stairs: _st, slabs: _sl, columns: _c, dimensions: _d,
    specifications: _sp, ...rest } = m;
  return rest;
};

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
      const change = !a ? 'ADDED' : !b ? 'REMOVED' : costHash(canonical(collection, a)) !== costHash(canonical(collection, b)) ? 'CHANGED' : null;
      if (!change) continue;
      // An entity moved between levels is in scope only if both its old and new levels are.
      const levelIds = [...new Set([...(a ? levelsOf(collection, a) : []), ...(b ? levelsOf(collection, b) : [])])];
      const inScope = entities.has(id) || (levelIds.length > 0 && levelIds.every(l => levels.has(l)));
      changes.push({ collection, entityId: id, change, levelIds, inScope });
    }
  }
  const siteChanged = costHash(base.site ?? null) !== costHash(other.site ?? null);
  if (siteChanged) changes.push({ collection: 'site', entityId: (other.site ?? base.site)!.id, change: !base.site ? 'ADDED' : !other.site ? 'REMOVED' : 'CHANGED',
    levelIds: [], inScope: scope.allowSiteChange });
  // A document-level edit (name, completeness, parametric architecture…) is model-wide: it is always reported, and in scope only when the declared
  // levels cover every level of both models.
  if (costHash(documentFields(base)) !== costHash(documentFields(other))) {
    const modelLevels = [...new Set([...base.levels, ...other.levels].map(l => l.id))];
    changes.push({ collection: 'document', entityId: other.id, change: 'CHANGED', levelIds: [], inScope: modelLevels.every(l => levels.has(l)) });
  }
  const violations = changes.filter(c => !c.inScope);
  return DiffReportSchema.parse({ diffVersion: DIFF_VERSION, ...ids, scope,
    status: !changes.length ? 'IDENTICAL' : violations.length ? 'OUT_OF_SCOPE_CHANGES' : 'WITHIN_SCOPE', changes, violations,
    counts: { added: changes.filter(c => c.change === 'ADDED').length, removed: changes.filter(c => c.change === 'REMOVED').length,
      changed: changes.filter(c => c.change === 'CHANGED').length, outOfScope: violations.length } });
}
