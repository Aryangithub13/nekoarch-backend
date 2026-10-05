import { wallSpaceIds } from '@designflow/shared';
import { createHash } from 'node:crypto';
import type { Point2Mm } from '@designflow/shared';
import { BIM_LIMITS, BimError, type BimModel } from './contracts.js';
import { semanticId } from './core.js';
import { validateBim } from './validate.js';
/** IFC compressed 128-bit identifier alphabet (not RFC4648 base64). */
export function ifcGuid(identity: string): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let n = BigInt(`0x${createHash('sha256').update(`nekoarch-ifc4-v1:${identity}`).digest('hex').slice(0,32)}`), out = '';
  for (let i=0;i<22;i++) { out = alphabet[Number(n & 63n)]! + out; n >>= 6n; } return out;
}
const real = (n: number) => { if (!Number.isFinite(n)) throw new BimError('BIM_UNSUPPORTED_EXPORT','Nonfinite IFC coordinate'); return Number.isInteger(n) ? `${n}.` : String(n); };
/** Encode arbitrary native labels as STEP UTF-16 escapes; no STEP text injection. */
const str = (s: string) => s.length === 0 ? "''" : `'\\X2\\${Array.from({length:s.length},(_,i) => s.charCodeAt(i).toString(16).padStart(4,'0')).join('').toUpperCase()}\\X0\\'`;
const list = (s: string[]) => `(${s.join(',')})`;
export function exportIfc(bim: BimModel): string {
  if (validateBim(bim,bim.geometry,bim.binding).status === 'INVALID') throw new BimError('BIM_INVALID_MODEL','IFC export requires a validated BIM projection');
  const m = bim.geometry, lines: string[] = [], roots = new Set<string>(); let bytes = 0;
  const entity = (type: string, ...args: string[]) => {
    const row = `#${lines.length+1}=${type.toUpperCase()}(${args.join(',')});`;
    bytes += Buffer.byteLength(row)+1;
    if (bytes > BIM_LIMITS.exportBytes-2048 || lines.length > 100000) throw new BimError('BIM_RESOURCE_LIMIT','IFC export budget exceeded');
    lines.push(row); return `#${lines.length}`;
  };
  const rootArgs = (key: string, name: string) => { const guid = ifcGuid(`${bim.binding.projectId}:${key}`); if (roots.has(guid)) throw new BimError('BIM_INVALID_MODEL','Duplicate IFC GlobalId'); roots.add(guid); return [str(guid),'$',str(name),'$']; };
  const point = (v: number[]) => entity('IfcCartesianPoint',list(v.map(real)));
  const axis = (x=0,y=0,z=0) => entity('IfcAxis2Placement3D',point([x,y,z]),'$','$');
  const place = (parent: string, elevation=0) => entity('IfcLocalPlacement',parent,axis(0,0,elevation));
  const origin = axis(), context = entity('IfcGeometricRepresentationContext','$',str('Model'),'3','0.00001',origin,'$');
  const lengthUnit = entity('IfcSIUnit','*','.LENGTHUNIT.','.MILLI.','.METRE.');
  const areaUnit = entity('IfcSIUnit','*','.AREAUNIT.','$','.SQUARE_METRE.');
  const volumeUnit = entity('IfcSIUnit','*','.VOLUMEUNIT.','$','.CUBIC_METRE.');
  const units = entity('IfcUnitAssignment',list([lengthUnit,areaUnit,volumeUnit]));
  const up = entity('IfcDirection','(0.,0.,1.)');
  const poly = (ring: Point2Mm[]) => {
    const pts = ring.map(p => point([p.x,-p.z])); return entity('IfcPolyline',list([...pts,pts[0]!]));
  };
  const shape = (items: string[], type: string) => entity('IfcProductDefinitionShape','$','$',list([entity('IfcShapeRepresentation',context,str('Body'),str(type),list(items))]));
  const solid = (ring: Point2Mm[], base: number, height: number) => {
    const profile = entity('IfcArbitraryClosedProfileDef','.AREA.','$',poly([...ring].reverse()));
    return shape([entity('IfcExtrudedAreaSolid',profile,axis(0,0,base),up,real(height))],'SweptSolid');
  };
  type P = [number,number,number];
  const surface = (faces: P[][]) => shape([entity('IfcFaceBasedSurfaceModel',list([entity('IfcConnectedFaceSet',list(faces.map(vertices => entity('IfcFace',list([entity('IfcFaceOuterBound',entity('IfcPolyLoop',list(vertices.map(point))),'.T.')])))))]))],'SurfaceModel');
  const ringFace = (ring: Point2Mm[], elevation: number): P[] => ring.map(p => [p.x,-p.z,elevation]);
  const sid = (role: string, source: string) => semanticId(bim.binding.projectId,role,source);
  const products = new Map<string,string>(), placements = new Map<string,string>();
  const save = (id: string, product: string, placement: string) => { products.set(id,product); placements.set(id,placement); return product; };
  const projectId = sid('project',bim.binding.projectId);
  const project = save(projectId,entity('IfcProject',...rootArgs(projectId,'NekoArch Project'),'$','$','$',list([context]),units),'$');
  const siteId = m.site ? sid('site',m.site.id) : null, sitePlacement = place('$');
  const site = siteId ? save(siteId,entity('IfcSite',...rootArgs(siteId,'Site'),'$',sitePlacement,'$','$','.ELEMENT.','$','$','$','$','$'),sitePlacement) : null;
  const buildingId = sid('building',m.id), buildingPlace = place(site ? sitePlacement : '$');
  const building = save(buildingId,entity('IfcBuilding',...rootArgs(buildingId,m.name),'$',buildingPlace,'$','$','.ELEMENT.','$','$','$'),buildingPlace);
  const aggregate = (key: string, parent: string, children: string[]) => { if (children.length) entity('IfcRelAggregates',...rootArgs(`aggregate:${key}`,'Decomposition'),parent,list(children)); };
  aggregate('project',project,[site ?? building]); if (site) aggregate('site',site,[building]);
  const storeys = new Map<string,string>(), floorPlaces = new Map<string,string>(), contained = new Map<string,string[]>();
  for (const level of m.levels) {
    const id = sid('level',level.id), p = place(buildingPlace,level.elevationMm);
    storeys.set(level.id,save(id,entity('IfcBuildingStorey',...rootArgs(id,level.name),'$',p,'$','$','.ELEMENT.',real(level.elevationMm)),p)); floorPlaces.set(level.id,p); contained.set(level.id,[]);
  }
  aggregate('building',building,[...storeys.values()]);
  const product = (type: string, role: string, source: string, name: string, level: string, representation: string, tail: string[], contain=true, customPlacement?: string) => {
    const id = sid(role,source), p = customPlacement ?? place(floorPlaces.get(level)!);
    const result = save(id,entity(type,...rootArgs(id,name),'$',p,representation,str(source),...tail),p);
    if (contain) contained.get(level)!.push(result); return result;
  };
  for (const s of m.spaces) {
    const id = sid('space',s.id), p = place(floorPlaces.get(s.levelId)!);
    save(id,entity('IfcSpace',...rootArgs(id,s.name),str(s.classification),p,surface([ringFace(s.boundary,0)]),'$','.ELEMENT.','.INTERNAL.','$'),p);
  }
  for (const l of m.levels) aggregate(`spaces:${l.id}`,storeys.get(l.id)!,m.spaces.filter(s => s.levelId === l.id).map(s => products.get(sid('space',s.id))!));
  const wallRing = (wall: typeof m.walls[number], offset=0, width?: number) => {
    const a = wall.path.start,b = wall.path.end,len = Math.hypot(b.x-a.x,b.z-a.z),ux=(b.x-a.x)/len,uz=(b.z-a.z)/len,t=wall.thicknessMm!/2;
    const start = {x:a.x+ux*offset,z:a.z+uz*offset},end = {x:start.x+ux*(width ?? len),z:start.z+uz*(width ?? len)};
    return [{x:start.x-uz*t,z:start.z+ux*t},{x:end.x-uz*t,z:end.z+ux*t},{x:end.x+uz*t,z:end.z-ux*t},{x:start.x+uz*t,z:start.z-ux*t}];
  };
  for (const w of m.walls) product('IfcWall','wall',w.id,w.classification,w.levelId,solid(wallRing(w),w.baseOffsetMm!,w.heightMm!),['.NOTDEFINED.']);
  for (const o of m.openings) {
    const wall = m.walls.find(w => w.id === o.wallId)!, base = wall.baseOffsetMm!+o.sillMm;
    const opening = product('IfcOpeningElement','opening',o.id,o.type,o.levelId,solid(wallRing(wall,o.offsetMm,o.widthMm),base,o.heightMm),['.OPENING.'],false);
    entity('IfcRelVoidsElement',...rootArgs(`void:${sid('opening',o.id)}`,'Hosted opening'),products.get(sid('wall',wall.id))!,opening);
    if (o.kind !== 'opening') {
      const a=wall.path.start,b=wall.path.end,len=Math.hypot(b.x-a.x,b.z-a.z),ux=(b.x-a.x)/len,uz=(b.z-a.z)/len;
      const start: P=[a.x+ux*o.offsetMm,-a.z-uz*o.offsetMm,base], end: P=[start[0]+ux*o.widthMm,start[1]-uz*o.widthMm,base];
      const representation=surface([[start,end,[end[0],end[1],base+o.heightMm],[start[0],start[1],base+o.heightMm]]]);
      const fill = product(o.kind === 'door' ? 'IfcDoor' : 'IfcWindow',o.kind,o.id,o.type,o.levelId,representation,[real(o.heightMm),real(o.widthMm),o.kind === 'door' ? '.DOOR.' : '.WINDOW.','.NOTDEFINED.','$']);
      entity('IfcRelFillsElement',...rootArgs(`fill:${sid(o.kind,o.id)}`,'Opening envelope fill'),opening,fill);
    }
  }
  for (const slab of m.slabs) {
    const roof = slab.kind === 'flat-roof', role = roof ? 'roof' : 'slab';
    const plate = product(roof ? 'IfcRoof' : 'IfcSlab',role,slab.id,slab.kind,slab.levelId,solid(slab.footprint.outer,slab.topOffsetMm-slab.thicknessMm,slab.thicknessMm),[roof ? '.FLAT_ROOF.' : slab.kind === 'floor' ? '.FLOOR.' : '.NOTDEFINED.']);
    slab.footprint.voids.forEach((v,i) => {
      const key = `${slab.id}:void:${i}`, opening = product('IfcOpeningElement','void',key,'Slab void',slab.levelId,solid(v,slab.topOffsetMm-slab.thicknessMm,slab.thicknessMm),['.OPENING.'],false);
      entity('IfcRelVoidsElement',...rootArgs(`void:${sid('void',key)}`,'Slab void'),plate,opening);
    });
  }
  for (const stair of m.stairs) {
    const assembly = product('IfcStair','stair',stair.id,'Straight stair',stair.fromLevelId,'$',['.STRAIGHT_RUN_STAIR.']);
    const xs=stair.footprint.map(p=>p.x),zs=stair.footprint.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    const p = (along:number,across:number,h:number): P => stair.direction === '+z' ? [minX+across,-minZ-along,h] : stair.direction === '-z' ? [minX+across,-maxZ+along,h] : stair.direction === '+x' ? [minX+along,-minZ-across,h] : [maxX-along,-minZ-across,h];
    const faces: P[][]=[]; let h=0;
    stair.riserHeightsMm.forEach((rise,i) => {
      const a=i*stair.treadDepthMm;
      faces.push([p(a,0,h),p(a,stair.widthMm,h),p(a,stair.widthMm,h+rise),p(a,0,h+rise)]); h+=rise;
      if (i<stair.riserHeightsMm.length-1) faces.push([p(a,0,h),p(a+stair.treadDepthMm,0,h),p(a+stair.treadDepthMm,stair.widthMm,h),p(a,stair.widthMm,h)]);
    });
    const flight = product('IfcStairFlight','flight',stair.id,'Flight',stair.fromLevelId,surface(faces),[String(stair.riserHeightsMm.length),String(stair.riserHeightsMm.length-1),'$',real(stair.treadDepthMm),'.STRAIGHT.'],false);
    const landings = stair.landings.map(l => product('IfcSlab','landing',l.id,'Landing surface',stair.fromLevelId,surface([ringFace(l.footprint,l.elevationOffsetMm)]),['.LANDING.'],false));
    aggregate(`stair:${stair.id}`,assembly,[flight,...landings]);
  }
  for (const [floor,items] of contained) if (items.length) entity('IfcRelContainedInSpatialStructure',...rootArgs(`contain:${sid('level',floor)}`,'Storey containment'),list(items),storeys.get(floor)!);
  for (const wall of m.walls) for (const space of wallSpaceIds(m,wall)) entity('IfcRelSpaceBoundary',...rootArgs(`boundary:${sid('wall',wall.id)}:${sid('space',space)}`,'Native boundary'),products.get(sid('space',space))!,products.get(sid('wall',wall.id))!,'$','.PHYSICAL.',wall.classification === 'exterior' ? '.EXTERNAL.' : '.INTERNAL.');
  for (const group of bim.elements.filter(e => e.kind === 'group')) {
    const object = save(group.id,entity('IfcGroup',...rootArgs(group.id,group.name),'$'),'$');
    const members = bim.relationships.filter(r => r.kind === 'group_member' && r.from === group.id).map(r => products.get(r.to)).filter((p):p is string => !!p);
    if (members.length) entity('IfcRelAssignsToGroup',...rootArgs(`group:${group.id}`,'Architectural collection'),list(members),'$',object);
  }
  for (const mat of bim.materials) if (mat.state === 'specified') {
    const members=bim.elements.filter(e=>e.materialIds.includes(mat.id)).map(e=>products.get(e.id)).filter((p):p is string=>!!p);
    if (members.length) entity('IfcRelAssociatesMaterial',...rootArgs(`material:${mat.id}`,'Specified native material'),list(members),entity('IfcMaterial',str(mat.name),'$','$'));
  }
  for (const e of bim.elements) {
    const object=products.get(e.id); if (!object) continue;
    const values = { NativeElementId:e.source.id,SemanticId:e.id,ProjectId:bim.binding.projectId,RevisionId:bim.binding.revisionId,ModelHash:bim.binding.modelHash,
      GeneratorVersion:bim.binding.generatorVersion ?? 'not available',GenerationId:bim.binding.generationId ?? 'not available',RequirementsHash:bim.binding.requirementsHash ?? 'not available',ParameterHash:bim.binding.parameterHash ?? 'not available',FloorId:e.floorId ?? 'not applicable',ConnectedLevels:bim.relationships.filter(r => r.kind === 'connects_level' && r.from === e.id).map(r => r.to).join(','),SourceParentId:e.source.parentId ?? 'not applicable',Engineering:'not evaluated',
      ...Object.fromEntries(e.properties.map(p => [p.key,`${p.state}:${p.value ?? 'unknown'}:${p.unit}`])) };
    const props=Object.entries(values).map(([k,v]) => entity('IfcPropertySingleValue',str(k),'$',`IFCTEXT(${str(v)})`,'$'));
    const pset=entity('IfcPropertySet',...rootArgs(`pset:${e.id}`,'NekoArch_Provenance_v1'),list(props));
    entity('IfcRelDefinesByProperties',...rootArgs(`pset-rel:${e.id}`,'Native provenance'),list([object]),pset);
    const quantities=bim.quantities.items.filter(q=>e.quantityIds.includes(q.id)).map(q => {
      const n=Number(q.quantity.value),unit=q.quantity.unit;
      return entity(unit==='mm'?'IfcQuantityLength':unit==='mm2'?'IfcQuantityArea':unit==='mm3'?'IfcQuantityVolume':'IfcQuantityCount',str(q.itemCode),str(q.assumptions.join(';')),'$',real(n/(unit==='mm2'?1e6:unit==='mm3'?1e9:1)),'$');
    });
    if (quantities.length) { const set=entity('IfcElementQuantity',...rootArgs(`qto:${e.id}`,'NekoArch_NativeQuantities_v1'),str(bim.quantities.measurementPolicyVersion),list(quantities)); entity('IfcRelDefinesByProperties',...rootArgs(`qto-rel:${e.id}`,'Native quantities'),list([object]),set); }
  }
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('NekoArch bounded architectural IFC4 profile v1'),'2;1');\nFILE_NAME('building.ifc','1970-01-01T00:00:00',('NekoArch'),('NekoArch'),'NekoArch Phase 23','NekoArch','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
