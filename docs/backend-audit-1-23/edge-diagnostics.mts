import {writeFileSync} from 'node:fs';
import {authored} from '../../packages/blueprint-qa/tests/fixtures.ts';
import {SaveRevisionRequestSchema} from '../../apps/api/src/contracts/projects.ts';
import {buildApp} from '../../apps/api/src/app.ts';
import {parseEnv} from '../../apps/api/src/config/env.ts';
import {bimRepository} from '../../test-support/bim-repository.ts';
import {ApiError} from '../../apps/api/src/lib/errors.ts';
import {auditBlueprint} from '@designflow/blueprint-qa';
import {projectQaOptions} from '../../apps/api/src/services/project-service.ts';
import {sanitizeEvent} from '../../apps/api/src/lib/sentry.ts';
const results:Record<string,unknown>[]=[];const pid='11111111-1111-4111-8111-111111111111';
const app=buildApp({env:parseEnv({NODE_ENV:'test',SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'fixture',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false'}),backend:{authenticate:async()=>({id:pid}),repository:()=>bimRepository(async()=>{throw new ApiError(404,'PROJECT_NOT_FOUND','Project not found');})},captureError:()=>{}});
try{
 for(const field of ['opening.width','point.x','opening.negative','control']){const m=authored();if(field==='opening.width')m.openings[0]!.widthMm=900.5;if(field==='point.x')m.spaces[0]!.boundary[0]!.x=100.5;if(field==='opening.negative')m.openings[0]!.widthMm=-1;
  let parsed:boolean|string;try{parsed=SaveRevisionRequestSchema.safeParse({model:m}).success;}catch(e){parsed=(e as Error).name;}
  const res=await app.inject({method:'POST',url:`/api/projects/${pid}/revisions`,headers:{authorization:'Bearer owner'},payload:{model:m}});results.push({field,parse:parsed,status:res.statusCode,code:res.json().error?.code});}
 const corner=authored();corner.openings[0]!.offsetMm=0;const qa=auditBlueprint(corner,projectQaOptions(corner));results.push({name:'corner-door',qa:qa.status,findings:qa.findings});
 results.push({name:'sentry-new-route',result:sanitizeEvent({tags:{route:'/api/projects/:projectId/revisions',code:'INTERNAL_ERROR',method:'POST'}} as Parameters<typeof sanitizeEvent>[0]).tags});
}finally{await app.close();writeFileSync(new URL('./evidence/edge-diagnostics.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
