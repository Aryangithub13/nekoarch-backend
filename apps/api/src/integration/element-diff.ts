import type { BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { ApiError } from '../lib/errors.js';
import { modelHash } from '../lib/generation-identity.js';
import { DIFF_COLLECTIONS, ELEMENT_DIFF_VERSION, ElementDiffSchema, INTEGRATION_LIMITS, type ElementDiff } from '../contracts/integration.js';

type Entity = { id: string } & Record<string, unknown>;
const DOCUMENT_FIELDS = ['schemaVersion', 'id', 'name', 'completeness', 'units', 'coordinateSystem', 'site', 'provenance', 'parametricArchitecture'] as const;
const same = (a: unknown, b: unknown) => costHash(a ?? null) === costHash(b ?? null);

function index(collection: string, list: readonly Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const e of list) {
    if (map.has(e.id)) throw new ApiError(422, 'INTEGRATION_ELEMENT_IDENTITY_INVALID', `Duplicate ${collection} id ${e.id.slice(0, 80)}: element identity is not stable`);
    map.set(e.id, e);
  }
  return map;
}

/**
 * B40: deterministic element-level comparison of two Building Model V2 documents by stable id, with the top-level properties that changed on each
 * element. Pure. A duplicate id is refused (identity would be ambiguous). Kept separate from the Phase 34 scoped diff, which is under repair (PR #27)
 * and reports entity-level changes only; this one names the changed fields, which the change set is checked against.
 */
export function diffElements(base: BuildingModelV2, candidate: BuildingModelV2): ElementDiff {
  const changes: ElementDiff['changes'] = [], collections: ElementDiff['collections'] = [];
  for (const collection of DIFF_COLLECTIONS) {
    const a = base[collection] as unknown as Entity[], b = candidate[collection] as unknown as Entity[];
    const before = index(collection, a), after = index(collection, b);
    let added = 0, removed = 0, modified = 0, preserved = 0;
    for (const [id, e] of before) {
      const other = after.get(id);
      if (!other) { removed++; changes.push({ collection, elementId: id, change: 'REMOVED', fields: [] }); continue; }
      const fields = [...new Set([...Object.keys(e), ...Object.keys(other)])].filter(k => !same(e[k], other[k])).sort();
      if (fields.length) { modified++; changes.push({ collection, elementId: id, change: 'MODIFIED', fields: fields.slice(0, 32) }); } else preserved++;
    }
    for (const id of after.keys()) if (!before.has(id)) { added++; changes.push({ collection, elementId: id, change: 'ADDED', fields: [] }); }
    const common = a.map(e => e.id).filter(id => after.has(id)), order = b.map(e => e.id).filter(id => before.has(id));
    collections.push({ collection, base: a.length, candidate: b.length, added, removed, modified, preserved, reordered: common.join('\u0000') !== order.join('\u0000') });
  }
  const documentFields = DOCUMENT_FIELDS.filter(f => !same(base[f as keyof BuildingModelV2], candidate[f as keyof BuildingModelV2]));
  const baseModelHash = modelHash(base), candidateModelHash = modelHash(candidate);
  return ElementDiffSchema.parse({ diffVersion: ELEMENT_DIFF_VERSION, baseModelHash, candidateModelHash, modelIdentical: baseModelHash === candidateModelHash,
    elementsIdentical: changes.length === 0, documentFields, collections, changes: changes.slice(0, INTEGRATION_LIMITS.diffChanges),
    changesTruncated: changes.length > INTEGRATION_LIMITS.diffChanges });
}
