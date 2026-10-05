import { wallSpaceIds } from '@designflow/shared';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { BIM_VERSION, BimModelSchema, type BimBinding, type BimElement, type BimModel, type BimRelationship, type SourceRef } from './contracts.js';
import { bindingFor, bounded, digest, geometryValue, semanticId, sorted, sourceModel } from './core.js';
import { propertiesFor } from './properties.js';
export function projectBim(input: unknown, binding: BimBinding, metrics?: { relationshipBuildMs: number }): BimModel {
  if (metrics) metrics.relationshipBuildMs = 0;
  const geometry = sourceModel(input), b = bindingFor(geometry,binding), elements: BimElement[] = [], relationships: BimRelationship[] = [];
  const id = (role: string, source: string) => semanticId(b.projectId,role,source);
  const quantities = calculateQuantityTakeoff(geometry,{});
  const materials: BimModel['materials'] = [{ id:id('material','unspecified'), name:'Unspecified', state:'unspecified', sourceSpecificationId:null, reference:null }, ...geometry.specifications.filter(s => s.material).map(s => ({ id:id('material',s.id), name:s.material!, state:'specified' as const, sourceSpecificationId:s.id, reference:s.reference ?? null }))];
  const edge = (kind: BimRelationship['kind'], from: string, to: string) => { const start = metrics ? performance.now() : 0; const key = `${kind}:${from}:${to}`; relationships.push({ id:id('relationship',key), kind, from, to }); if (metrics) metrics.relationshipBuildMs += performance.now()-start; };
  const add = (kind: BimElement['kind'], ref: SourceRef, name: string, floorId: string | null, parentId: string | null, spec?: string) => {
    const key = id(kind,ref.id), physical = ['wall','door','window','slab','roof','stair','landing'].includes(kind);
    const materialIds = physical ? [materials.find(m => m.sourceSpecificationId === spec)?.id ?? id('material','unspecified')] : [];
    const value = geometryValue(geometry,ref);
    elements.push({ id:key, kind, name, source:ref, floorId, parentId, geometryHash:value === null ? null : digest(value), properties:propertiesFor(geometry,ref), materialIds,
      quantityIds: ['door','window','void','group','project','building'].includes(kind) ? [] : quantities.items.filter(q => q.sourceEntityIds[0] === ref.id).map(q => q.id).sort() });
    if (parentId) edge('contains',parentId,key);
    materialIds.forEach(material => edge('uses_material',key,material));
    return key;
  };
  const ref = (collection: SourceRef['collection'], source: string, parentId: string | null = null, index: number | null = null): SourceRef => ({ collection,id:source,parentId,index });
  const project = add('project',ref('project',b.projectId),'Project',null,null);
  const site = geometry.site ? add('site',ref('site',geometry.site.id),'Site',null,project) : null;
  const building = add('building',ref('building',geometry.id),geometry.name,null,site ?? project);
  for (const level of geometry.levels) {
    const floor = add('level',ref('levels',level.id),level.name,null,building);
    for (const group of ['envelope','partitions','plates']) add('group',ref('groups',`${level.id}:${group}`),group,floor,floor);
  }
  for (const space of geometry.spaces) { const floor = id('level',space.levelId); add('space',ref('spaces',space.id),space.name,floor,floor); }
  for (const wall of geometry.walls) {
    const floor = id('level',wall.levelId), wallId = add('wall',ref('walls',wall.id),wall.classification,floor,floor,wall.specificationId);
    for (const space of wallSpaceIds(geometry,wall)) edge('bounds',wallId,id('space',space));
    edge('group_member',id('group',`${wall.levelId}:${wall.classification === 'exterior' ? 'envelope' : 'partitions'}`),wallId);
  }
  for (const opening of geometry.openings) {
    const floor = id('level',opening.levelId), host = id('wall',opening.wallId);
    const voidId = add('opening',ref('openings',opening.id),opening.type,floor,host);
    edge('hosts',host,voidId);
    if (opening.kind !== 'opening') { const fill = add(opening.kind,ref('openings',opening.id),opening.type,floor,floor,opening.specificationId); edge('fills',fill,voidId); }
    const hostWall = geometry.walls.find(w => w.id === opening.wallId)!;
    if ((opening.kind === 'door' || (opening.kind === 'opening' && opening.purpose === 'passage')) && opening.sillMm === 0 && hostWall.baseOffsetMm === 0)
      for (const space of wallSpaceIds(geometry,hostWall)) edge('accesses',voidId,id('space',space));
  }
  for (const slab of geometry.slabs) {
    const floor = id('level',slab.levelId), kind = slab.kind === 'flat-roof' ? 'roof' : 'slab';
    const plate = add(kind,ref('slabs',slab.id),slab.kind,floor,floor,slab.specificationId);
    edge('group_member',id('group',`${slab.levelId}:plates`),plate);
    slab.footprint.voids.forEach((_,i) => { const v = add('void',ref('voids',`${slab.id}:void:${i}`,slab.id,i),'Slab void',floor,plate); edge('voids',v,plate); });
  }
  for (const stair of geometry.stairs) {
    const floor = id('level',stair.fromLevelId), stairId = add('stair',ref('stairs',stair.id),'Straight stair',floor,floor,stair.specificationId);
    edge('connects_level',stairId,floor); edge('connects_level',stairId,id('level',stair.toLevelId));
    for (const landing of stair.landings) add('landing',ref('landings',landing.id,stair.id),'Landing',id('level',landing.elevationOffsetMm === 0 ? stair.fromLevelId : stair.toLevelId),stairId,stair.specificationId);
    for (const slab of geometry.slabs.filter(s => s.levelId === stair.toLevelId && s.kind === 'floor')) slab.footprint.voids.forEach((v,i) => {
      // Exact vertex set equality, never a bounding-box contact guess.
      if (digest([...v].sort((a,b) => a.x-b.x || a.z-b.z)) === digest([...stair.footprint].sort((a,b) => a.x-b.x || a.z-b.z))) edge('serves_void',stairId,id('void',`${slab.id}:void:${i}`));
    });
  }
  const model = { version:BIM_VERSION, propertyVersion:1 as const, units:'mm' as const, coordinateSystem:'x-right-y-up-z-depth' as const, binding:b, geometry,
    elements:sorted(elements), relationships:sorted(relationships), materials:sorted(materials), quantities, completeness:'architectural_incomplete_engineering' as const };
  // Parsed clone removes internal shared references and enforces the external contract.
  const result = BimModelSchema.parse(model); bounded(result,8_388_608); return result;
}
