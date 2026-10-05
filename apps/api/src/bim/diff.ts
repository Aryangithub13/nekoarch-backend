import { BimError, type BimModel } from './contracts.js';
import { digest } from './core.js';
export function diffBim(before: BimModel, after: BimModel) {
  if (before.binding.projectId !== after.binding.projectId) throw new BimError('BIM_SOURCE_MISMATCH','Cannot compare different projects');
  const old = new Map(before.elements.map(e => [e.id,e])), next = new Map(after.elements.map(e => [e.id,e]));
  const changes = [...new Set([...old.keys(),...next.keys()])].sort().map(id => {
    const a = old.get(id), b = next.get(id);
    if (!a || !b) {
      const current = (a ?? b)!;
      const counterpart = (a ? after : before).elements.find(e => e.source.collection === current.source.collection && e.source.id === current.source.id && e.kind !== current.kind && !['opening','door','window'].includes(e.kind) && !['opening','door','window'].includes(current.kind));
      return { id, changes:counterpart ? ['REPLACED'] : [a ? 'REMOVED' : 'ADDED'], ...(counterpart ? { counterpartId:counterpart.id } : {}) };
    }
    const changes: string[] = [];
    if (a.kind !== b.kind || digest(a.source) !== digest(b.source)) changes.push('REPLACED');
    if (a.geometryHash !== b.geometryHash || a.floorId !== b.floorId || a.parentId !== b.parentId) changes.push('MODIFIED_GEOMETRY');
    const props = (m: BimModel, e: typeof a) => ({ name:e.name,properties:e.properties,materials:m.materials.filter(mat => e.materialIds.includes(mat.id)),quantities:m.quantities.items.filter(q => e.quantityIds.includes(q.id)),relationships:m.relationships.filter(r => r.from === e.id || r.to === e.id) });
    if (digest(props(before,a)) !== digest(props(after,b))) changes.push('MODIFIED_PROPERTY');
    return { id,changes:changes.length ? changes : ['UNCHANGED'] };
  });
  return { version:'bim-diff-v1', projectId:before.binding.projectId, before:before.binding, after:after.binding, changes,
    identityPolicy:'Source role continuity only; changed interval IDs are added/removed. Names never establish replacement.' };
}
