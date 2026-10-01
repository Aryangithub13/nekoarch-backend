import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
/** Acceptance-only observation. Never retries, changes JWTs, or logs credentials/request bodies. */
export function watchSupabaseFailures() {
  const original=globalThis.fetch, failures: Record<string,unknown>[]=[],apiErrors:Record<string,unknown>[]=[];
  const startedAt=new Date().toISOString(); let observedRequests=0;
  const clean=(text:string)=>text.replace(/eyJ[A-Za-z0-9._-]+/g,'[REDACTED_JWT]')
    .replace(/[a-f0-9]{64}/g,'[REDACTED_DIGEST]');
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:input.toString()),headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
    let claims:Record<string,unknown>={};
    try {const token=headers.get('authorization')?.replace(/^Bearer /i,'');const payload=JSON.parse(Buffer.from(token?.split('.')[1]??'','base64url').toString());claims={iat:payload.iat,nbf:payload.nbf,exp:payload.exp};}catch{ /* No token contents retained. */ }
    const at=new Date().toISOString();observedRequests++;
    try {
      const response=await original(input,init);
      // Include JWT validation failures even when the upstream uses a 4xx status.
      if(response.status>=500 || (url.pathname.startsWith('/rest/') && response.status===401)) {
        failures.push({at,endpoint:url.origin+url.pathname,method:init?.method??'GET',status:response.status,
          statusText:response.statusText,responseBody:clean(await response.clone().text()),jwtTimingClaims:claims,
          responseHeaders:Object.fromEntries([...response.headers].filter(([name])=>!['set-cookie','authorization','apikey'].includes(name)))});
      }
      return response;
    }catch(error){failures.push({at,endpoint:url.origin+url.pathname,method:init?.method??'GET',jwtTimingClaims:claims,transportError:clean(String(error))});throw error;}
  };
  return {apiError(requestId:string,code:string,metadata:unknown){apiErrors.push({at:new Date().toISOString(),requestId,code,metadata});},
    async close(){globalThis.fetch=original;let postgrestLogs:string|null=null;
      if(failures.length||apiErrors.length){const logs=spawnSync('docker',['logs','--since',startedAt,'supabase_rest_designflow'],{encoding:'utf8',maxBuffer:8_000_000});postgrestLogs=clean(logs.stdout+logs.stderr);}
      await mkdir('docs/phase16-evidence',{recursive:true});
      await writeFile(`docs/phase16-evidence/supabase-${startedAt.replaceAll(':','-')}.json`,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),observedRequests,failures,apiErrors,postgrestLogs},null,2)+'\n');
    }};
}
