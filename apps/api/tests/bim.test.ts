import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { bimRepository } from '../../../test-support/bim-repository.js';
import { ApiError } from '../src/lib/errors.js';
import { describe,it,expect } from 'vitest';
import { generateBlueprint,generateBlueprintV2,generateParametricBlueprint,modifyParametricRequirements } from '@designflow/generator';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { solverInput } from '../../../test-support/solver-v2-fixtures.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { projectBim } from '../src/bim/project.js';
import { validateBim } from '../src/bim/validate.js';
import { exportIfc,ifcGuid } from '../src/bim/ifc.js';
import { digest,bounded,semanticId } from '../src/bim/core.js';
import { diffBim } from '../src/bim/diff.js';
import type { BimModel } from '../src/bim/contracts.js';
const projectId='11111111-1111-4111-8111-111111111111',revisionId='22222222-2222-4222-8222-222222222222';
const model=generateParametricBlueprint(parametricInput(true)).model;
const binding=(m:typeof model,r=revisionId)=>({projectId,revisionId:r,modelHash:modelHash(m),generatorVersion:m.provenance.generatorVersion??null,generationId:null,requirementsHash:null,parameterHash:m.parametricArchitecture?digest(m.parametricArchitecture):null});
const bim=projectBim(model,binding(model));
describe('Phase 23 semantic BIM',()=>{
  it('derives space boundaries and access from geometry when optional wall metadata is absent',()=>{
    const source=authored(),control=projectBim(source,binding(source));
    for(const wall of source.walls) delete wall.spaceIds;
    const original=JSON.stringify(source),projected=projectBim(source,binding(source));
    for(const kind of ['bounds','accesses']) {
      const expected=control.relationships.filter(r=>r.kind===kind);
      expect(expected.length).toBeGreaterThan(0);
      expect(projected.relationships.filter(r=>r.kind===kind)).toEqual(expected);
    }
    expect(JSON.stringify(source)).toBe(original);
    expect(validateBim(projected,source,binding(source)).status).toBe('VALID_WITH_INCOMPLETE_DATA');
    expect(exportIfc(projected).match(/IFCRELSPACEBOUNDARY\(/g)).toHaveLength(control.relationships.filter(r=>r.kind==='bounds').length);
    projected.relationships=projected.relationships.filter(r=>r.kind!=='bounds');
    expect(validateBim(projected,source,binding(source)).status).toBe('INVALID');
  });
  it.each(['service','other','passage'] as const)('only treats a floor-level passage as access: %s',purpose=>{
    const source=authored(),index=source.openings.findIndex(o=>o.kind==='window');
    source.openings[index]={...source.openings[index]!,kind:'opening',purpose,sillMm:0};
    const projected=projectBim(source,binding(source)),opening=projected.elements.find(e=>e.kind==='opening'&&e.source.id==='studio-window')!;
    expect(projected.relationships.filter(r=>r.kind==='accesses'&&r.from===opening.id)).toHaveLength(purpose==='passage'?1:0);
    expect(validateBim(projected,source,binding(source)).status).toBe('VALID_WITH_INCOMPLETE_DATA');
    if(purpose!=='passage') {
      const bad=structuredClone(projected),edge=structuredClone(bad.relationships.find(r=>r.kind==='accesses')!);
      edge.from=opening.id;edge.to=bad.elements.find(e=>e.kind==='space'&&e.source.id==='studio')!.id;
      edge.id=semanticId(projectId,'relationship',`${edge.kind}:${edge.from}:${edge.to}`);
      bad.relationships.push(edge);bad.relationships.sort((a,b)=>a.id.localeCompare(b.id));
      const validation=validateBim(bad,source,binding(source));
      expect(validation.status).toBe('INVALID');expect(validation.diagnostics.filter(d=>d.severity==='ERROR').map(d=>d.code)).toEqual(['SEMANTICS']);
    }
  });
  it('does not claim circulation access through a raised doorway',()=>{
    const source=authored();source.openings.find(o=>o.id==='studio-door')!.sillMm=100;
    const projected=projectBim(source,binding(source)),opening=projected.elements.find(e=>e.kind==='opening'&&e.source.id==='studio-door')!;
    expect(projected.relationships.some(r=>r.kind==='accesses'&&r.from===opening.id)).toBe(false);
    expect(validateBim(projected,source,binding(source)).status).toBe('VALID_WITH_INCOMPLETE_DATA');
  });
  it.each(['v1','v2','L','setback'])('projects %s without changing historical geometry or hash',kind=>{
    const {layoutV2:_v2,...v1}=solverInput();
    const m=kind==='v1'?generateBlueprint(v1).model:kind==='v2'?generateBlueprintV2(solverInput()).model:generateParametricBlueprint(parametricInput(kind==='setback')).model;
    const original=JSON.stringify(m),hash=modelHash(m),b=projectBim(m,binding(m));
    expect(validateBim(b,m,binding(m)).status).toBe('VALID_WITH_INCOMPLETE_DATA');expect(JSON.stringify(m)).toBe(original);expect(modelHash(m)).toBe(hash);
    expect(projectBim(m,binding(m))).toEqual(b);expect(b.quantities).toEqual(calculateQuantityTakeoff(m,{}));
    expect(exportIfc(b)).toBe(exportIfc(b));expect(exportIfc(b)).toContain("FILE_SCHEMA(('IFC4'))");
  });
  it('preserves concavity, actual floor footprints, voids and roof distinctions',()=>{
    expect(bim.geometry.levels.every(l=>l.boundary.length===6)).toBe(true);
    expect(bim.elements.filter(e=>e.kind==='roof').map(e=>e.properties.find(p=>p.key==='roofRole')!.value)).toContain('exposed-lower-roof');
    expect(bim.relationships.some(r=>r.kind==='serves_void')).toBe(true);
    expect(bim.relationships.filter(r=>r.kind==='connects_level')).toHaveLength(2);
    expect(bim.elements.filter(e=>e.kind==='landing')).toHaveLength(2);
  });
  it('distinguishes specified material labels from unknown engineering properties',()=>{
    const m=structuredClone(model);m.specifications=[{id:'spec-1',name:'Wall choice',material:'Masonry',reference:'accepted specification'}];m.walls[0]!.specificationId='spec-1';
    const b=projectBim(m,binding(m));expect(b.materials.find(m=>m.state==='specified')!.name).toBe('Masonry');
    expect(b.materials.some(m=>m.state==='unspecified')).toBe(true);expect(validateBim(b,m,binding(m)).status).toBe('VALID_WITH_INCOMPLETE_DATA');
  });
  const mutations: [string,(b:BimModel)=>void][]=[
    ['duplicate ID',b=>b.elements.push(structuredClone(b.elements[0]!))],
    ['wrong host',b=>{b.relationships.find(r=>r.kind==='hosts')!.from=b.elements.find(e=>e.kind==='space')!.id;}],
    ['missing fill',b=>{b.relationships=b.relationships.filter(r=>r.kind!=='fills');}],
    ['missing source opening',b=>{b.elements=b.elements.filter(e=>e.kind!=='opening');}],
    ['cycle',b=>{const e=b.elements.find(e=>e.kind==='wall')!;e.parentId=e.id;}],
    ['wrong floor',b=>{b.elements.find(e=>e.kind==='wall')!.floorId=b.elements.find(e=>e.kind==='building')!.id;}],
    ['negative dimension',b=>{b.elements.find(e=>e.kind==='wall')!.properties.find(p=>p.key==='height')!.value=-1;}],
    ['wrong units',b=>{b.elements.find(e=>e.kind==='wall')!.properties.find(p=>p.key==='height')!.unit='text';}],
    ['nonfinite',b=>{b.geometry.walls[0]!.heightMm=Infinity;}],
    ['invalid category',b=>{(b.elements[0] as unknown as {kind:string}).kind='beam';}],
    ['wrong storey elevation',b=>{b.geometry.levels[1]!.elevationMm+=1000;}],
    ['slab area mismatch',b=>{b.quantities.items.find(q=>q.itemCode==='FLOOR_PLATE_NET_AREA')!.quantity.value='1';}],
    ['stair level mismatch',b=>{b.geometry.stairs[0]!.toLevelId=b.geometry.stairs[0]!.fromLevelId;}],
    ['opening outside host',b=>{b.geometry.openings[0]!.offsetMm=999999;}],
    ['dangling target',b=>{b.relationships[0]!.to='not-an-element';}],
    ['corrupt room reference',b=>{b.geometry.walls.find(w=>w.spaceIds?.length)!.spaceIds=['nonexistent'];}],
    ['stale hash',b=>{b.binding.modelHash='0'.repeat(64);}],
    ['changed geometry',b=>{b.geometry.walls[0]!.heightMm!+=1;}],
    ['fabricated material',b=>{b.materials[0]!.name='Certified concrete';b.materials[0]!.state='specified';}],
    ['missing quantity link',b=>{b.elements.find(e=>e.kind==='wall')!.quantityIds=[];}],
    ['wrong source hash',b=>{b.elements.find(e=>e.kind==='wall')!.geometryHash='0'.repeat(64);}],
    ['noncanonical order',b=>b.elements.reverse()],
  ];
  it.each(mutations)('rejects %s',(_name,mutate)=>{const b=structuredClone(bim);mutate(b);expect(validateBim(b,model,binding(model)).status).toBe('INVALID');});
  it('fails safely on malformed, legacy, cycles and resource budgets',()=>{
    expect(()=>projectBim({},binding(model))).toThrow();const cycle:Record<string,unknown>={};cycle.self=cycle;expect(()=>bounded(cycle)).toThrow();
    expect(()=>bounded({a:'x'.repeat(3_000_000)})).toThrow();expect(()=>bounded({a:NaN})).toThrow();
    const b=structuredClone(bim);b.elements.push(...Array.from({length:1600},()=>structuredClone(b.elements[0]!)));expect(()=>exportIfc(b)).toThrow();
    expect(()=>projectBim({...model,completeness:'legacy-planar'},binding(model))).toThrow();
  });
  it('applies authenticated read rate limits before BIM work',async()=>{
    let calls=0;
    const app=buildApp({env:parseEnv({NODE_ENV:'test',SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'test',LOG_LEVEL:'silent',RATE_LIMIT_READ:'1'}),backend:{authenticate:async()=>({id:projectId}),repository:()=>bimRepository(async()=>{calls++;throw new ApiError(404,'PROJECT_NOT_FOUND','Project not found');})},captureError:()=>undefined});
    try { const request={url:`/api/projects/${projectId}/revisions/${revisionId}/bim/export.ifc`,headers:{authorization:'Bearer owner'}};
      expect((await app.inject(request)).statusCode).toBe(404);expect((await app.inject(request)).statusCode).toBe(429);expect(calls).toBe(1);
    } finally { await app.close(); }
  });
  it('uses schema-compatible deterministic 128-bit IFC GlobalIds',()=>{
    const ids=Array.from({length:1000},(_,i)=>ifcGuid(`element:${i}`));expect(new Set(ids).size).toBe(1000);expect(ids.every(i=>/^[0-3][0-9A-Za-z_$]{21}$/.test(i))).toBe(true);
  });
  it('compares parametric revisions without ghosts or mutating the old snapshot',()=>{
    const m=generateParametricBlueprint(modifyParametricRequirements(parametricInput(true),{level:0,parameter:'westWingWidthMm',valueMm:10000})).model;
    const old=JSON.stringify(bim),next=projectBim(m,binding(m,'33333333-3333-4333-8333-333333333333')),diff=diffBim(bim,next);
    expect(JSON.stringify(bim)).toBe(old);
    for(const status of ['ADDED','REMOVED','MODIFIED_GEOMETRY','MODIFIED_PROPERTY','UNCHANGED']) expect(diff.changes.some(c=>c.changes.includes(status))).toBe(true);
    expect(diff.changes.filter(c=>c.changes.includes('REMOVED')).every(c=>!next.elements.some(e=>e.id===c.id))).toBe(true);
    const other=structuredClone(next);other.binding.projectId='44444444-4444-4444-8444-444444444444';expect(()=>diffBim(bim,other)).toThrow();
  });
});
