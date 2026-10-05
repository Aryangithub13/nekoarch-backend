import { mkdir,writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { generateBlueprint,generateBlueprintV2,generateParametricBlueprint,modifyParametricRequirements } from '@designflow/generator';
import { parametricInput } from '../test-support/parametric-fixtures.js';
import { solverInput } from '../test-support/solver-v2-fixtures.js';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { digest } from '../apps/api/src/bim/core.js';
import { projectBim } from '../apps/api/src/bim/project.js';
import { validateBim } from '../apps/api/src/bim/validate.js';
import { exportIfc } from '../apps/api/src/bim/ifc.js';
import { diffBim } from '../apps/api/src/bim/diff.js';
const maximum=parametricInput();
maximum.site.boundary=[{x:0,z:0},{x:60000,z:0},{x:60000,z:60000},{x:0,z:60000}];
Object.assign(maximum.parametricArchitecture.floors[0]!,{widthMm:55000,depthMm:55000,westWingWidthMm:27000,southWingDepthMm:27000});maximum.rooms=[{type:'bedroom',count:24}];
const {layoutV2:_layout,...v1}=solverInput();
const cases=[['v1',()=>generateBlueprint(v1)],['v2',()=>generateBlueprintV2(solverInput())],['L',()=>generateParametricBlueprint(parametricInput())],['setback',()=>generateParametricBlueprint(parametricInput(true))],['maximum-24',()=>generateParametricBlueprint(maximum)],['modified',()=>generateParametricBlueprint(modifyParametricRequirements(parametricInput(true),{level:0,parameter:'westWingWidthMm',valueMm:10000}))],['specified-material',()=>{
  const result=generateBlueprint(v1);
  result.model.specifications=[{id:'accepted-wall-material',name:'Wall material',material:"Masonry — owner's choice",reference:'Explicit fixture specification; no performance claim'}];
  // Accepted source may omit optional adjacency labels; boundaries must survive export.
  for(const wall of result.model.walls) delete wall.spaceIds;
  result.model.walls[0]!.specificationId='accepted-wall-material';
  return result;
}]] as const;
await mkdir('docs/phase23-evidence/fixtures',{recursive:true});
const rows=[];
for (const [name,generate] of cases) {
  const {model}=generate(), binding={projectId:'11111111-1111-4111-8111-111111111111',revisionId:'22222222-2222-4222-8222-222222222222',modelHash:modelHash(model),generatorVersion:model.provenance.generatorVersion??null,generationId:null,requirementsHash:null,parameterHash:model.parametricArchitecture?digest(model.parametricArchitecture):null};
  const metrics={relationshipBuildMs:0};
  const start=performance.now(),bim=projectBim(model,binding,metrics), projected=performance.now(),validation=validateBim(bim,model,binding),validated=performance.now();
  if (validation.status==='INVALID') throw new Error(JSON.stringify(validation));
  const ifc=exportIfc(bim),exported=performance.now();diffBim(bim,bim);const compared=performance.now();
  rows.push({name,sample:1,temperature:name==='v1'?'first BIM projection in process':'subsequent projection; not independently warmed',nativeModelBytes:Buffer.byteLength(JSON.stringify(model)),bimModelBytes:Buffer.byteLength(JSON.stringify(bim)),projectionAndRelationshipsMs:projected-start,relationshipEdgeConstructionMs:metrics.relationshipBuildMs,validationMs:validated-projected,ifcSerializationAndValidationMs:exported-validated,diffMs:compared-exported,elements:bim.elements.length,relationships:bim.relationships.length,exportBytes:Buffer.byteLength(ifc),rssBytes:process.memoryUsage().rss,processPeakRssBytes:process.resourceUsage().maxRSS*1024});
  await writeFile(`docs/phase23-evidence/fixtures/${name}.ifc`,ifc);
  await writeFile(`docs/phase23-evidence/fixtures/${name}.json`,JSON.stringify({model,bim,validation}));
}
await writeFile('docs/phase23-evidence/benchmark.json',JSON.stringify({runtime:process.version,platform:process.platform,measurements:rows},null,2)+'\n');console.log(rows);
