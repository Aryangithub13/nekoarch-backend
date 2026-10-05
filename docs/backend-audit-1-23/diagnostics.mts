import { writeFileSync } from 'node:fs';
import { authored, rect, generated } from '../../packages/blueprint-qa/tests/fixtures.ts';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { calculateConstruction } from '@designflow/construction-calculations';
import { specification } from '../../packages/construction-calculations/tests/fixtures.ts';
import { projectQaOptions } from '../../apps/api/src/services/project-service.ts';
import { projectBim } from '../../apps/api/src/bim/project.ts';
import { validateBim } from '../../apps/api/src/bim/validate.ts';
import { exportIfc } from '../../apps/api/src/bim/ifc.ts';
import { modelHash } from '../../apps/api/src/lib/generation-identity.ts';
const pid='11111111-1111-4111-8111-111111111111',rid='22222222-2222-4222-8222-222222222222';
const binding=(m:ReturnType<typeof authored>)=>({projectId:pid,revisionId:rid,modelHash:modelHash(m),generatorVersion:null,generationId:null,requirementsHash:null,parameterHash:null});
const results:Record<string,unknown>[]=[];
function inspect(name:string,m:ReturnType<typeof authored>){
 const valid=ArchitecturalBuildingModelV2Schema.safeParse(m),qa=auditBlueprint(m,projectQaOptions(m));
 const row:Record<string,unknown>={name,schema:valid.success,qa:qa.status,errors:qa.findings.filter(f=>f.severity==='ERROR').map(f=>f.code),warnings:qa.findings.filter(f=>f.severity==='WARNING').map(f=>f.code),gfa:qa.measurements.grossFloorAreaMm2};
 try{const b=projectBim(m,binding(m));row.bim=validateBim(b,m,binding(m)).status;row.bounds=b.relationships.filter(r=>r.kind==='bounds').length;row.accesses=b.relationships.filter(r=>r.kind==='accesses').length;const ifc=exportIfc(b);row.ifcBytes=ifc.length;row.spaceBoundaries=(ifc.match(/=IFCRELSPACEBOUNDARY\(/g)??[]).length;}catch(e){const error=e as {code?:string;message?:string};row.bimError=error.code??error.message;}
 results.push(row);return row;
}
inspect('control',authored());
const hole=authored();hole.slabs[0]!.footprint.voids=[rect(4500,500,2500,4500)];inspect('floor-void-under-occupied-studio',hole);
const absent=authored();for(const w of absent.walls)delete w.spaceIds;inspect('omitted-optional-spaceIds',absent);
const service=authored();const w=service.openings.find(o=>o.kind==='window')!;service.openings=service.openings.map((o):typeof o=>o===w?{...o,kind:'opening',purpose:'service'}:o);inspect('service-opening-access',service);
const raised=authored();raised.openings.find(o=>o.id==='studio-door')!.sillMm=100;inspect('raised-door-access',raised);
const slab=authored();slab.slabs[0]!.topOffsetMm=2500;inspect('floor-at-2500-mm',slab);
const roof=authored();roof.slabs.push({...structuredClone(roof.slabs[0]!),id:'roof-a',kind:'flat-roof',topOffsetMm:3000},{...structuredClone(roof.slabs[0]!),id:'roof-b',kind:'flat-roof',topOffsetMm:3050});inspect('overlapping-roof-solids',roof);
const column=authored();column.columns=[{id:'col1',levelId:'ground',baseOffsetMm:0,heightMm:2800,crossSection:{outer:rect(500,500,500,500),voids:[]}},{id:'col2',levelId:'ground',baseOffsetMm:0,heightMm:2800,crossSection:{outer:rect(500,500,500,500),voids:[]}}];inspect('coincident-columns',column);
const hash=generated(2),reverse=structuredClone(hash);reverse.stairs[0]!.landings.reverse();results.push({name:'landing-order-identity',schema:ArchitecturalBuildingModelV2Schema.safeParse(reverse).success,equal:modelHash(hash)===modelHash(reverse)});
const q=calculateQuantityTakeoff(authored());const c0=calculateConstruction(q,specification(),{quantityDecimalPlaces:6}),c9=calculateConstruction(q,specification(),{quantityDecimalPlaces:9});results.push({name:'construction-display-precision',zero:c0.summary.totals,nine:c9.summary.totals,exact:c0.materials.map(m=>({code:m.materialCode,exact:m.finalExact}))});
writeFileSync(new URL('./evidence/diagnostics.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
