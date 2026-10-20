import { createHash } from 'node:crypto';
import { ArchitecturalBuildingModelV2Schema, type BuildingModelV2, type Point2Mm } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { canonicalBuilding, modelHash } from '../lib/generation-identity.js';
import { BIM_LIMITS, BimBindingSchema, BimError, type BimBinding, type SourceRef } from './contracts.js';
export const digest = costHash;
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const sorted = <T extends { id: string }>(items: T[]) => items.sort((a,b) => compare(a.id,b.id));
export function semanticId(projectId: string, role: string, sourceId: string) { return `bim-${createHash('sha256').update(JSON.stringify([projectId,role,sourceId])).digest('hex').slice(0,40)}`; }
/** Iterative JSON preflight bounds work before recursive schemas/hashers. */
export function bounded(value: unknown, bytes: number = BIM_LIMITS.inputBytes) {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }], seen = new Set<object>(); let nodes = 0, size = 0;
  while (stack.length) {
    const { value: v, depth, exit } = stack.pop()!;
    if (exit) { seen.delete(v as object); continue; }
    if (++nodes > BIM_LIMITS.nodes || depth > BIM_LIMITS.depth || size > bytes) throw new BimError('BIM_RESOURCE_LIMIT','BIM resource budget exceeded');
    if (v === null || typeof v === 'boolean') { size += 5; continue; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new BimError('BIM_INVALID_SOURCE','Nonfinite value'); size += 24; continue; }
    if (typeof v === 'string') { size += Buffer.byteLength(JSON.stringify(v)); continue; }
    if (typeof v !== 'object' || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) || seen.has(v)) throw new BimError('BIM_INVALID_SOURCE','Expected acyclic plain JSON');
    seen.add(v); stack.push({ value:v, depth, exit:true }); const entries = Object.entries(v); size += entries.length * 4 + 2;
    if (entries.length > 40000) throw new BimError('BIM_RESOURCE_LIMIT','Collection budget exceeded');
    for (const [key,item] of entries) { size += Buffer.byteLength(key); stack.push({ value: item, depth: depth+1 }); }
  }
  if (size > bytes) throw new BimError('BIM_RESOURCE_LIMIT','BIM size budget exceeded');
}
export function sourceModel(input: unknown): BuildingModelV2 {
  bounded(input);
  const parsed = ArchitecturalBuildingModelV2Schema.safeParse(input);
  if (!parsed.success) throw new BimError('BIM_INVALID_SOURCE','Invalid architectural model');
  const m = parsed.data;
  // Program-engine designs (up to ten storeys stacked around one stair core) extend the original two-storey profile.
  if (m.levels.length > 10 || m.spaces.length > 400 || m.spaces.filter(s => !['corridor','circulation','stairwell'].includes(s.classification)).length > 360 || m.walls.length > 2400 || m.openings.length > 2400 || m.slabs.length > 32 || m.stairs.length > 9 || m.columns.length || m.specifications.length > 255 || m.slabs.reduce((n,s) => n+s.footprint.voids.length,0) > 32 || m.stairs.some(s => s.riserHeightsMm.length > 64)) throw new BimError('BIM_UNSUPPORTED_MODEL','Model exceeds the bounded architectural profile');
  const orthogonal = (ring: Point2Mm[]) => ring.length <= 32 && ring.every((p,i) => p.x === ring[(i+1)%ring.length]!.x || p.z === ring[(i+1)%ring.length]!.z);
  if (m.levels.some(l => l.kind !== 'storey' || ![4,6].includes(l.boundary.length) || !orthogonal(l.boundary)) || m.spaces.some(s => !orthogonal(s.boundary)) || m.slabs.some(s => !orthogonal(s.footprint.outer) || s.footprint.voids.some(v => !orthogonal(v))) || m.walls.some(w => w.path.start.x !== w.path.end.x && w.path.start.z !== w.path.end.z)) throw new BimError('BIM_UNSUPPORTED_MODEL','Only bounded orthogonal architectural geometry is supported');
  const qa = auditBlueprint(m);
  if (qa.status === 'FAIL' || qa.summary.errors) throw new BimError('BIM_INVALID_SOURCE','Independent architectural QA rejected the source');
  return { ...canonicalBuilding(m), provenance: m.provenance };
}
export function bindingFor(model: BuildingModelV2, binding: BimBinding) {
  const b = BimBindingSchema.parse(binding);
  if (b.modelHash !== modelHash(model) || b.parameterHash !== (model.parametricArchitecture ? digest(model.parametricArchitecture) : null)) throw new BimError('BIM_SOURCE_MISMATCH','Source revision hash mismatch');
  return b;
}
export function sourceValue(m: BuildingModelV2, ref: SourceRef): unknown {
  if (ref.collection === 'site') return m.site;
  if (ref.collection === 'building') return { id: m.id };
  if (ref.collection === 'project' || ref.collection === 'groups') return null;
  if (ref.collection === 'landings') return m.stairs.find(s => s.id === ref.parentId)?.landings.find(l => l.id === ref.id) ?? null;
  if (ref.collection === 'voids') return m.slabs.find(s => s.id === ref.parentId)?.footprint.voids[ref.index ?? -1] ?? null;
  return m[ref.collection].find(e => e.id === ref.id) ?? null;
}
export function geometryValue(m: BuildingModelV2, ref: SourceRef): unknown {
  const raw = sourceValue(m,ref);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const { name: _name, classification: _classification, specificationId: _spec, type: _type, ...geometry } = raw as Record<string,unknown>;
  const levelId = ref.collection === 'landings' ? m.stairs.find(s => s.id === ref.parentId)?.fromLevelId : typeof geometry.levelId === 'string' ? geometry.levelId : typeof geometry.fromLevelId === 'string' ? geometry.fromLevelId : null;
  const elevationMm = m.levels.find(l => l.id === levelId)?.elevationMm ?? null;
  return { geometry, elevationMm };
}
