import { describe,it,expect } from 'vitest';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { authored } from '../../blueprint-qa/tests/fixtures.js';
import { calculateConstruction, Rational, convertPhysical, ConstructionReportSchema, normalizeConstructionSpecification,
  type Assembly, type ConstructionSpecificationInput } from '../src/index.js';
import { basis,mix,specification } from './fixtures.js';
function single(assembly: Assembly, code: ConstructionSpecificationInput['assignments'][number]['basis']) {
  return {id:'s',version:'1',recipePack:{id:'construction-recipes',version:'1'},assemblies:[assembly],assignments:[{id:'a',basis:code,assemblyId:assembly.id,layerId:'layer',selector:{kind:'default' as const}}]};
}
describe('exact construction recipes',()=>{
  it('preserves rational purchase boundaries and half-up rounding',()=>{
    expect(Rational.from('1').div(Rational.from('3')).mul(Rational.from('3')).ceil()).toBe(1n);
    expect(Rational.from('1.000000000000000001').ceil()).toBe(2n);
    expect(Rational.from('0.0000005').decimal(6)).toBe('0.000001');
    expect(convertPhysical('1000000000','mm3','m3').decimal(9)).toBe('1');
    expect(()=>convertPhysical('1','kg','m3')).toThrow('Incompatible');
  });
  it('calculates 400 masonry units and 0.2 m3 mortar from 1 m3 modules',()=>{
    const s=single({id:'brick',kind:'masonry',materialCode:'FIRED_CLAY_BRICK',wastagePercent:'5',unitLengthMm:200,unitHeightMm:100,unitDepthMm:100,
      longitudinalJointMm:'0',bedJointMm:'25',unitForm:'SOLID_RECTANGULAR',mortar:mix},'WALL_SEGMENT_NET_VOLUME');
    const r=calculateConstruction(basis('WALL_SEGMENT_NET_VOLUME','1000000000',100),s);
    expect(r.materials.map(m=>[m.materialCode,m.theoretical,m.final,m.purchase?.quantity])).toEqual([
      ['FIRED_CLAY_BRICK','400','420','420'],['CEMENT','75','78.75','2'],['SAND','0.225','0.23625',undefined]]);
    expect(r.items[0]!.evidence.wetMortarM3).toEqual({numerator:'1',denominator:'5'});
    expect(r.items[0]!.status).toBe('PARTIAL');
    expect(()=>calculateConstruction(basis('WALL_SEGMENT_NET_VOLUME','1000000000',200),s)).toThrow('thickness');
  });
  it('exposes omitted mortar and never supplies a default mix',()=>{
    const r=calculateConstruction(basis('WALL_SEGMENT_NET_VOLUME','1000000000',100),single({id:'brick',kind:'masonry',materialCode:'AAC_BLOCK',wastagePercent:'0',
      unitLengthMm:200,unitHeightMm:100,unitDepthMm:100,longitudinalJointMm:'0',bedJointMm:'10',unitForm:'SOLID_RECTANGULAR'},'WALL_SEGMENT_NET_VOLUME'));
    expect(r.materials).toHaveLength(1);expect(r.warnings).toContainEqual({code:'MORTAR_NOT_EVALUATED',takeoffItemId:'basis-1'});
  });
  it('uses explicit plaster sides and thickness',()=>{
    const r=calculateConstruction(basis('WALL_SINGLE_FACE_NET_AREA','10000000'),single({id:'p',kind:'plaster',wastagePercent:'0',thicknessMm:10,sides:2,mix},'WALL_SINGLE_FACE_NET_AREA'));
    expect(r.materials.map(m=>m.theoretical)).toEqual(['75','0.225']);
  });
  it('separates ready mix from nominal concrete constituents',()=>{
    const t=basis('FLOOR_PLATE_VOLUME','1000000000');
    const r=calculateConstruction(t,single({id:'c',kind:'concrete',wastagePercent:'10',mode:{type:'READY_MIX_VOLUME_ONLY'}},'FLOOR_PLATE_VOLUME'));
    expect(r.materials[0]).toMatchObject({materialCode:'READY_MIX_CONCRETE',theoretical:'1',final:'1.1',purchase:null});
    const n=calculateConstruction(t,single({id:'c',kind:'concrete',wastagePercent:'0',mode:{type:'NOMINAL_VOLUMETRIC_RECIPE',mix:{...mix,sandParts:'2',coarseAggregateParts:'3'}}},'FLOOR_PLATE_VOLUME'));
    expect(n.materials.map(m=>m.theoretical)).toEqual(['250','0.5','0.75']);
  });
  it('calculates paint, primer and putty by explicit coverage and coats',()=>{
    const r=calculateConstruction(basis('WALL_SINGLE_FACE_NET_AREA','10000000'),single({id:'p',kind:'paint',wastagePercent:'10',sides:2,coatings:[
      {id:'a',materialCode:'PAINT',coats:2,coverageM2PerUnit:'4'},{id:'b',materialCode:'PRIMER',coats:1,coverageM2PerUnit:'5'},
      {id:'c',materialCode:'PUTTY',coats:1,coverageM2PerUnit:'2'}]},'WALL_SINGLE_FACE_NET_AREA'));
    expect(r.materials.map(m=>[m.materialCode,m.unit,m.theoretical,m.final])).toEqual([['PAINT','l','10','11'],['PRIMER','l','4','4.4'],['PUTTY','kg','10','11']]);
  });
  it('rounds tiles per source line instead of rounding pooled totals',()=>{
    const t=basis('FLOOR_FINISH_BASE_AREA','100000');t.items.push({...t.items[0]!,id:'basis-2',sourceEntityIds:['second']});
    const r=calculateConstruction(t,specification());
    expect(r.materials.map(m=>m.purchase?.quantity)).toEqual(['1','1']);
    expect(r.summary.totals[0]).toMatchObject({theoretical:'0.8',final:'0.88',purchases:[{unit:'piece',quantity:'2',bagMassKg:null}]});
  });
  it.each(['DOOR_COUNT','WINDOW_COUNT'] as const)('counts explicit %s components',code=>{
    const r=calculateConstruction(basis(code,'3'),single({id:'c',kind:'component',wastagePercent:'10',materialCode:code==='DOOR_COUNT'?'DOOR_UNIT':'WINDOW_UNIT'},code));
    expect(r.materials[0]).toMatchObject({theoretical:'3',final:'3.3',purchase:{quantity:'4',unit:'each'}});
  });
  it('reconciles emitted wastage and final values at rounding boundaries',()=>{
    const r=calculateConstruction(basis('FLOOR_FINISH_BASE_AREA','0.5'),specification(),{quantityDecimalPlaces:6});
    const m=r.materials[0]!;expect(Rational.from(m.theoretical).add(Rational.from(m.wastage)).decimal(6)).toBe(m.final);
    expect(m.purchase?.quantity).toBe('1');
  });
});
describe('mapping and provenance',()=>{
  it('applies entity precedence and does not match secondary host provenance',()=>{
    const s=specification();s.assemblies.push({id:'special',kind:'flooring',tileLengthMm:100,tileWidthMm:100,wastagePercent:'0'});
    s.assignments.push({id:'override',basis:'FLOOR_FINISH_BASE_AREA',assemblyId:'special',layerId:'finish',selector:{kind:'entity',value:'primary'}});
    expect(calculateConstruction(basis('FLOOR_FINISH_BASE_AREA','1000000'),s).materials[0]!.theoretical).toBe('100');
    s.assignments[s.assignments.length-1]!.selector={kind:'entity',value:'host'};
    expect(calculateConstruction(basis('FLOOR_FINISH_BASE_AREA','1000000'),s).materials[0]!.theoretical).toBe('4');
  });
  it('uses specification, classification and level precedence in that order',()=>{
    const s=specification();const t=basis('FLOOR_FINISH_BASE_AREA','1000000');
    for(const kind of ['level','classification','specification'] as const) s.assignments.push({id:kind,basis:'FLOOR_FINISH_BASE_AREA',assemblyId:'tile',layerId:'finish',selector:{kind,value:kind==='specification'?'spec':kind==='classification'?'internal':'level'}});
    expect(calculateConstruction(t,s).items[0]!.assignmentId).toBe('specification');s.assignments.pop();
    expect(calculateConstruction(t,s).items[0]!.assignmentId).toBe('classification');s.assignments.pop();
    expect(calculateConstruction(t,s).items[0]!.assignmentId).toBe('level');
  });
  it('rejects ambiguous mappings and unintended duplicate layers',()=>{
    const s=specification(),t=basis('FLOOR_FINISH_BASE_AREA','1000000');s.assignments.push({...s.assignments[1]!,id:'duplicate'});
    expect(()=>calculateConstruction(t,s)).toThrow('Ambiguous');s.assignments[s.assignments.length-1]!.layerId='second';
    expect(()=>calculateConstruction(t,s)).toThrow('Multiple physical');s.allowMultipleLayers=true;
    expect(calculateConstruction(t,s).materials).toHaveLength(2);
  });
  it('never uses SPACE_FLOOR_AREA or totals as another tile basis',()=>{
    const t=basis('FLOOR_FINISH_BASE_AREA','1000000');t.items.push({...t.items[0]!,id:'space',itemCode:'SPACE_FLOOR_AREA'});
    expect(calculateConstruction(t,specification()).materials).toHaveLength(1);
  });
  it('records upstream partial coverage and unassigned supported bases',()=>{
    const t=basis('FLOOR_FINISH_BASE_AREA','1000000');t.items[0]!.status='PARTIAL';
    const r=calculateConstruction(t,specification());expect(r.items[0]!.status).toBe('PARTIAL');expect(r.summary.status).toBe('PARTIAL');
    const s=specification();s.assignments=[];const empty=calculateConstruction(t,s);
    expect(empty.materials).toEqual([]);expect(empty.summary.status).toBe('NOT_EVALUATED');
    expect(empty.coverage.find(c=>c.category==='FLOOR_FINISH_BASE_AREA')?.status).toBe('NOT_EVALUATED');
  });
  it('is reproducible under input ordering, JSON roundtrips and frozen inputs',()=>{
    const t=calculateQuantityTakeoff(authored()),s=specification(),before=JSON.stringify({t,s});
    function freeze(value:unknown) {if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}}
    freeze(t);freeze(s);const r=calculateConstruction(t,s);
    expect(JSON.stringify({t,s})).toBe(before);expect(ConstructionReportSchema.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(calculateConstruction({...t,items:[...t.items].reverse()},{...s,assemblies:[...s.assemblies].reverse(),assignments:[...s.assignments].reverse()})).toEqual(r);
    expect(normalizeConstructionSpecification(r.specification)).toEqual(r.specification);
  });
  it('separates cement procurement groups with different bag masses',()=>{
    const s=single({id:'p',kind:'plaster',wastagePercent:'0',thicknessMm:10,sides:2,mix},'WALL_SINGLE_FACE_NET_AREA');
    s.assemblies.push({id:'other',kind:'plaster',wastagePercent:'0',thicknessMm:10,sides:2,mix:{...mix,bagMassKg:'25'}});
    s.assignments.push({...s.assignments[0]!,id:'other',assemblyId:'other',layerId:'second'});
    const r=calculateConstruction(basis('WALL_SINGLE_FACE_NET_AREA','10000000'),{...s,allowMultipleLayers:true});
    expect(r.summary.totals.find(m=>m.materialCode==='CEMENT')!.purchases).toEqual([{unit:'bag',bagMassKg:'25',quantity:'3'},{unit:'bag',bagMassKg:'50',quantity:'2'}]);
  });
});
describe('strict input and resource boundaries',()=>{
  it.each([null,{}, {engineVersion:'future'}])('rejects invalid takeoff %j',input=>expect(()=>calculateConstruction(input,specification())).toThrow());
  it('rejects unknown recipes, options, references, duplicate IDs and incompatible bases',()=>{
    const t=basis('FLOOR_FINISH_BASE_AREA','1000000');
    expect(()=>calculateConstruction(t,{...specification(),recipePack:{id:'future',version:'1'}})).toThrow('recipe pack');
    expect(()=>calculateConstruction(t,specification(),{quantityDecimalPlaces:13})).toThrow('options');
    const s=specification();s.assignments[0]!.assemblyId='missing';expect(()=>calculateConstruction(t,s)).toThrow('specification');
    const duplicate=specification();duplicate.assemblies.push(duplicate.assemblies[0]!);expect(()=>calculateConstruction(t,duplicate)).toThrow();
    const bad=specification();bad.assignments[0]!.basis='DOOR_COUNT';expect(()=>calculateConstruction(t,bad)).toThrow();
  });
  it('rejects duplicate quantity identities and duplicate source bases',()=>{
    const t=basis('FLOOR_FINISH_BASE_AREA','1000000');t.items.push({...t.items[0]!});expect(()=>calculateConstruction(t,specification())).toThrow('Duplicate takeoff item');
    t.items[1]!.id='different';expect(()=>calculateConstruction(t,specification())).toThrow('Duplicate takeoff source');
  });
  it('fails before processing cyclic and oversized specifications',()=>{
    const t=basis('FLOOR_FINISH_BASE_AREA','1000000'),c:Record<string,unknown>={};c.self=c;
    expect(()=>calculateConstruction(t,c)).toThrow('JSON-safe');
    expect(()=>calculateConstruction(t,{x:'x'.repeat(140000)})).toThrow('size');
  });
});

describe('work limits and large reports',()=>{
  it('bounds matching work before processing an excessive item/assignment cross product',()=>{
    const t=basis('FLOOR_FINISH_BASE_AREA','1000000'),s=specification();
    t.items=Array.from({length:2001},(_,i)=>({...t.items[0]!,id:`item-${i}`,sourceEntityIds:[`source-${i}`]}));
    s.assignments=Array.from({length:512},(_,i)=>({...s.assignments[1]!,id:`assignment-${i}`,selector:{kind:'entity' as const,value:`absent-${i}`}}));
    expect(()=>calculateConstruction(t,s)).toThrow('resource limit');
  });
  it('rejects invalid parameter boundaries without interpreting absent constants',()=>{
    const t=basis('FLOOR_FINISH_BASE_AREA','1000000');
    for(const wastagePercent of ['-1','101','NaN','1e3','0.0000001']){
      const s=specification();s.assemblies[1]!.wastagePercent=wastagePercent;expect(()=>calculateConstruction(t,s)).toThrow();
    }
    expect(()=>calculateConstruction(t,{...specification(),assemblies:[{id:'incomplete',kind:'plaster'}]})).toThrow();
  });
});
