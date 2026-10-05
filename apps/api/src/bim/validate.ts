import { wallSpaceIds } from '@designflow/shared';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { BimModelSchema, ValidationSchema, type BimBinding, type BimElement, type BimValidation, type BimRelationship } from './contracts.js';
import { bindingFor, bounded, digest, geometryValue, semanticId, sourceModel, sourceValue } from './core.js';
import { propertiesFor } from './properties.js';
/** Independent source/graph verifier: never invokes or imports the projection builder. */
export function validateBim(input: unknown, authoritative: unknown, binding: BimBinding): BimValidation {
  const diagnostics: BimValidation['diagnostics'] = [];
  const fail = (code: BimValidation['diagnostics'][number]['code'], message: string, elementId: string | null = null) => { if (diagnostics.length < 199) diagnostics.push({ code,message,elementId,severity:'ERROR' }); };
  const output = (): BimValidation => ValidationSchema.parse({ version:'bim-validator-v1', status:diagnostics.some(d => d.severity === 'ERROR') ? 'INVALID' : 'VALID_WITH_INCOMPLETE_DATA', diagnostics,
    export:{ profile:'nekoarch-ifc4-architectural-v1', status:diagnostics.some(d => d.severity === 'ERROR') ? 'UNSUPPORTED' : 'SUPPORTED', limitations:[
      'Architectural subset only; no structural, MEP or certification data.', 'Wall quantities use segment prisms; junctions are not boolean-unioned.',
      'Doors/windows are opening envelopes; no leaf, frame or glazing assembly is specified.', 'Stair and landing surfaces have no specified underside thickness.',
      'Space boundaries use the native basis; no certified clear height or usable-area claim.', 'Site survey/georeferencing and construction recipes are not exported.',
    ] } });
  let m, b, parsed;
  try { bounded(input,8_388_608); m = sourceModel(authoritative); b = bindingFor(m,binding); parsed = BimModelSchema.safeParse(input); }
  catch { fail('SOURCE','Invalid, unsupported or over-budget authoritative source/BIM'); return output(); }
  if (!parsed.success) { fail('SCHEMA','BIM schema invalid'); return output(); }
  const bim = parsed.data;
  if (digest(bim.binding) !== digest(b) || digest(bim.geometry) !== digest(m)) fail('SOURCE','Revision binding or embedded source differs from authoritative geometry');
  const id = (role: string, source: string) => semanticId(b.projectId,role,source);
  const inventory = new Set<string>([id('project',b.projectId),id('building',m.id)]);
  if (m.site) inventory.add(id('site',m.site.id));
  for (const l of m.levels) { inventory.add(id('level',l.id)); for (const g of ['envelope','partitions','plates']) inventory.add(id('group',`${l.id}:${g}`)); }
  for (const s of m.spaces) inventory.add(id('space',s.id));
  for (const w of m.walls) inventory.add(id('wall',w.id));
  for (const o of m.openings) { inventory.add(id('opening',o.id)); if (o.kind !== 'opening') inventory.add(id(o.kind,o.id)); }
  for (const s of m.slabs) { inventory.add(id(s.kind === 'flat-roof' ? 'roof' : 'slab',s.id)); s.footprint.voids.forEach((_,i) => inventory.add(id('void',`${s.id}:void:${i}`))); }
  for (const s of m.stairs) { inventory.add(id('stair',s.id)); s.landings.forEach(l => inventory.add(id('landing',l.id))); }
  const byId = new Map(bim.elements.map(e => [e.id,e]));
  if (byId.size !== bim.elements.length || byId.size !== inventory.size || [...inventory].some(i => !byId.has(i))) fail('IDENTITY','Duplicate, missing or unexpected semantic element');
  for (const items of [bim.elements,bim.relationships,bim.materials]) if (items.some((e,i) => i > 0 && e.id <= items[i-1]!.id)) fail('ORDER','Collections must have unique canonical ID order');
  const expectedEdges = new Set<string>();
  const edge = (kind: BimRelationship['kind'], from: string, to: string) => expectedEdges.add(`${kind}:${from}:${to}`);
  const physical = new Set(['wall','door','window','slab','roof','stair','landing']);
  for (const e of bim.elements) {
    if (e.id !== id(e.kind,e.source.id)) fail('IDENTITY','Deterministic element ID mismatch',e.id);
    const source = sourceValue(m,e.source) as Record<string,unknown> | null;
    const expectedCollection: Record<BimElement['kind'],string> = { project:'project',site:'site',building:'building',level:'levels',space:'spaces',wall:'walls',opening:'openings',door:'openings',window:'openings',slab:'slabs',roof:'slabs',stair:'stairs',landing:'landings',void:'voids',group:'groups' };
    if (expectedCollection[e.kind] !== e.source.collection || (!source && !['project','group'].includes(e.kind))) { fail('REFERENCE','Invalid source reference',e.id); continue; }
    if (!['landing','void'].includes(e.kind) && (e.source.parentId !== null || e.source.index !== null)) fail('REFERENCE','Unexpected nested source reference',e.id);
    if (e.kind === 'landing' && e.source.index !== null) fail('REFERENCE','Landing has invalid source index',e.id);
    let floor: string | null = source && typeof source.levelId === 'string' ? id('level',source.levelId) : null;
    let parent: string | null = floor;
    if (e.kind === 'project') { if (e.source.id !== b.projectId) fail('REFERENCE','Wrong project'); parent = null; }
    else if (e.kind === 'site') parent = id('project',b.projectId);
    else if (e.kind === 'building') parent = m.site ? id('site',m.site.id) : id('project',b.projectId);
    else if (e.kind === 'level') parent = id('building',m.id);
    else if (e.kind === 'group') { const level = m.levels.find(l => ['envelope','partitions','plates'].some(g => e.source.id === `${l.id}:${g}`)); floor = parent = level ? id('level',level.id) : null; }
    else if (e.kind === 'opening') parent = id('wall',String(source!.wallId));
    else if (e.kind === 'stair') parent = floor = id('level',String(source!.fromLevelId));
    else if (e.kind === 'landing') { const stair = m.stairs.find(s => s.id === e.source.parentId); floor = stair ? id('level',source!.elevationOffsetMm === 0 ? stair.fromLevelId : stair.toLevelId) : null; parent = stair ? id('stair',stair.id) : null; }
    else if (e.kind === 'void') { const slab = m.slabs.find(s => s.id === e.source.parentId); parent = slab ? id(slab.kind === 'flat-roof' ? 'roof' : 'slab',slab.id) : null; floor = slab ? id('level',slab.levelId) : null;
      if (e.source.id !== `${slab?.id}:void:${e.source.index}`) fail('REFERENCE','Invalid void identity',e.id); }
    if (e.floorId !== floor || e.parentId !== parent) fail('HIERARCHY','Floor or parent differs from authoritative spatial structure',e.id);
    if (parent) edge('contains',parent,e.id);
    const gv = geometryValue(m,e.source);
    if (e.geometryHash !== (gv === null ? null : digest(gv))) fail('GEOMETRY','Geometry reference hash mismatch',e.id);
    if (digest(e.properties) !== digest(propertiesFor(m,e.source))) fail('PROPERTY','Property value, state, unit or provenance differs from source',e.id);
    const expectedName = e.kind === 'project' ? 'Project' : e.kind === 'site' ? 'Site' : e.kind === 'building' ? m.name : e.kind === 'group' ? e.source.id.slice(e.source.id.lastIndexOf(':')+1) : e.kind === 'wall' ? String(source!.classification) : ['opening','door','window'].includes(e.kind) ? String(source!.type) : ['slab','roof'].includes(e.kind) ? String(source!.kind) : e.kind === 'stair' ? 'Straight stair' : e.kind === 'landing' ? 'Landing' : e.kind === 'void' ? 'Slab void' : String(source!.name);
    if (e.name !== expectedName) fail('PROPERTY','Label differs from authoritative source',e.id);
    const spec = e.kind === 'landing' ? m.stairs.find(s => s.id === e.source.parentId)?.specificationId : source?.specificationId;
    const materialSpec = m.specifications.find(s => s.id === spec && s.material);
    const expectedMaterials = physical.has(e.kind) ? [id('material',materialSpec?.id ?? 'unspecified')] : [];
    if (digest(e.materialIds) !== digest(expectedMaterials)) fail('MATERIAL','Unsupported material assignment',e.id);
    expectedMaterials.forEach(mat => edge('uses_material',e.id,mat));
    if (e.kind === 'wall') {
      const w = m.walls.find(w => w.id === e.source.id)!;
      for (const space of wallSpaceIds(m,w)) edge('bounds',e.id,id('space',space));
      edge('group_member',id('group',`${w.levelId}:${w.classification === 'exterior' ? 'envelope' : 'partitions'}`),e.id);
    }
    if (e.kind === 'opening') {
      edge('hosts',id('wall',String(source!.wallId)),e.id);
      const opening = m.openings.find(o => o.id === e.source.id)!, hostWall = m.walls.find(w => w.id === opening.wallId)!;
      if ((opening.kind === 'door' || (opening.kind === 'opening' && opening.purpose === 'passage')) && opening.sillMm === 0 && hostWall.baseOffsetMm === 0)
        for (const space of wallSpaceIds(m,hostWall)) edge('accesses',e.id,id('space',space));
    }
    if (e.kind === 'door' || e.kind === 'window') { if (source!.kind !== e.kind) fail('SEMANTICS','Fill category mismatch',e.id); edge('fills',e.id,id('opening',e.source.id)); }
    if (e.kind === 'slab' || e.kind === 'roof') { if ((source!.kind === 'flat-roof') !== (e.kind === 'roof')) fail('SEMANTICS','Roof/plate category mismatch',e.id); edge('group_member',id('group',`${String(source!.levelId)}:plates`),e.id); }
    if (e.kind === 'void' && parent) edge('voids',e.id,parent);
    if (e.kind === 'stair') {
      const stair = m.stairs.find(s => s.id === e.source.id)!;
      edge('connects_level',e.id,id('level',stair.fromLevelId)); edge('connects_level',e.id,id('level',stair.toLevelId));
      for (const slab of m.slabs.filter(s => s.levelId === stair.toLevelId && s.kind === 'floor')) slab.footprint.voids.forEach((v,i) => {
        if (v.length === stair.footprint.length && v.every(p => stair.footprint.some(q => p.x === q.x && p.z === q.z))) edge('serves_void',e.id,id('void',`${slab.id}:void:${i}`));
      });
    }
  }
  const actualEdges = new Set<string>();
  const matIds = new Set(bim.materials.map(m => m.id));
  for (const r of bim.relationships) {
    const key = `${r.kind}:${r.from}:${r.to}`; actualEdges.add(key);
    if (r.id !== id('relationship',key) || !byId.has(r.from) || !(r.kind === 'uses_material' ? matIds.has(r.to) : byId.has(r.to))) fail('REFERENCE','Relationship ID or target is invalid',r.from);
  }
  if (actualEdges.size !== bim.relationships.length || actualEdges.size !== expectedEdges.size || [...expectedEdges].some(e => !actualEdges.has(e))) fail('SEMANTICS','Relationship graph has missing, duplicate or incorrect edges');
  for (const e of bim.elements) { const visited = new Set<string>(); let p: BimElement | undefined = e;
    while (p) { if (visited.has(p.id)) { fail('HIERARCHY','Containment cycle',e.id); break; } visited.add(p.id); p = p.parentId ? byId.get(p.parentId) : undefined; }
  }
  const expectedMats = [{ id:id('material','unspecified'),name:'Unspecified',state:'unspecified',sourceSpecificationId:null,reference:null },...m.specifications.filter(s => s.material).map(s => ({ id:id('material',s.id),name:s.material!,state:'specified',sourceSpecificationId:s.id,reference:s.reference ?? null }))].sort((a,b) => a.id < b.id ? -1 : 1);
  if (digest(expectedMats) !== digest(bim.materials)) fail('MATERIAL','Material definitions differ from authoritative specifications');
  const q = calculateQuantityTakeoff(m,{});
  if (digest(q) !== digest(bim.quantities)) fail('QUANTITY','Quantity report differs from native takeoff');
  for (const e of bim.elements) {
    const expected = ['door','window','void','group','project','building'].includes(e.kind) ? [] : q.items.filter(q => q.sourceEntityIds[0] === e.source.id).map(q => q.id).sort();
    if (digest(expected) !== digest(e.quantityIds)) fail('QUANTITY','Quantity source association differs',e.id);
  }
  diagnostics.push({ code:'INCOMPLETE',elementId:null,message:'Engineering properties and unspecified materials are not evaluated.',severity:'INFO' });
  return output();
}
