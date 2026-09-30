import { z } from 'zod';
import type { Repository,IdempotencyContext } from './repository.js';
import { ApiError,parseRequest } from './errors.js';
import { constructionDatabaseError } from './construction-repository.js';
import { CostDetailSchema,CostListSchema,CostSummarySchema } from '../contracts/costs.js';
import { TakeoffCursorSchema } from '../contracts/takeoffs.js';
export function costDatabaseError(error:{code?:string}):never{
  const errors:Record<string,[number,string,string]>={P1501:[404,'COST_ESTIMATE_NOT_FOUND','Cost estimate not found'],P1502:[422,'CONSTRUCTION_CALCULATION_NOT_ACCEPTED','Construction source is not accepted'],P1503:[500,'COST_CALCULATION_FAILED','Cost provenance validation failed']};
  const mapped=error.code?errors[error.code]:undefined;if(mapped)throw new ApiError(...mapped);constructionDatabaseError(error);
}
export class CostRepository{
  constructor(private readonly repository:Repository){}
  private rpc(name:'cost_read'|'cost_write',args:Record<string,unknown>){if(!this.repository.costRpc)throw new ApiError(503,'COST_UNAVAILABLE','Cost persistence is unavailable');return this.repository.costRpc(name,args);}
  async read(projectId:string,revisionId:string,costEstimateId:string){return CostDetailSchema.parse(await this.rpc('cost_read',{p_project_id:projectId,p_revision_id:revisionId,p_cost_id:costEstimateId}));}
  async list(projectId:string,revisionId:string,query:{limit:number;cursor?:string|undefined}){
    let cursor:unknown=null;if(query.cursor){try{cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));}catch{throw new ApiError(400,'VALIDATION_ERROR','Invalid pagination cursor');}cursor=parseRequest(TakeoffCursorSchema,cursor);}
    const raw=z.object({items:z.array(CostSummarySchema).max(100),nextCursor:TakeoffCursorSchema.nullable()}).strict().parse(await this.rpc('cost_read',{p_project_id:projectId,p_revision_id:revisionId,p_limit:query.limit,p_cursor:cursor}));
    return CostListSchema.parse({items:raw.items,nextCursor:raw.nextCursor?Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url'):null});
  }
  async write(input:unknown,attestation:{envelope:string;signature:string},context?:IdempotencyContext){return CostDetailSchema.parse(await this.rpc('cost_write',{p_input:input,p_context:context??null,p_envelope:attestation.envelope,p_signature:attestation.signature}));}
}
