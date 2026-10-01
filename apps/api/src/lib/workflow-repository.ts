import { z } from 'zod';
import type { Repository, IdempotencyContext } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { costDatabaseError } from './cost-repository.js';
import { WorkflowRunSchema, type WorkflowRun } from '../contracts/workflows.js';
import { TakeoffCursorSchema } from '../contracts/takeoffs.js';
import { signProjectCommit } from '../services/project-service.js';
export const WORKFLOW_OPERATION = '/api/projects/:projectId/workflows';
export function workflowDatabaseError(error: { code?: string }): never {
  const mapped: Record<string,[number,string,string]> = {
    P1601: [404,'WORKFLOW_NOT_FOUND','Workflow not found'],
    P1602: [409,'WORKFLOW_IN_PROGRESS','The workflow is executing; inspect it or resume after its execution lease expires'],
    P1603: [409,'WORKFLOW_FENCED','This workflow execution is no longer active'],
    P1604: [500,'WORKFLOW_PROVENANCE_FAILED','Workflow provenance validation failed'],
  };
  const e = error.code ? mapped[error.code] : undefined; if (e) throw new ApiError(...e); costDatabaseError(error);
}
export class WorkflowRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'workflow_read'|'workflow_write', args: Record<string,unknown>) {
    if (!this.repository.workflowRpc) throw new ApiError(503,'WORKFLOW_UNAVAILABLE','Workflow persistence is unavailable');
    return this.repository.workflowRpc(name,args);
  }
  read(projectId: string, runId: string): Promise<WorkflowRun> {
    return this.rpc('workflow_read',{p_action:'get',p_input:{projectId,runId}}).then(v => WorkflowRunSchema.parse(v));
  }
  async find(projectId: string, revisionId: string, kind: 'takeoff'|'construction'|'cost', fingerprint: string) {
    return z.string().uuid().nullable().parse(await this.rpc('workflow_read',{p_action:'find',p_input:{projectId,revisionId,kind,fingerprint}}));
  }
  async list(projectId: string, query: {limit:number;cursor?:string|undefined}) {
    let cursor: unknown = null;
    if (query.cursor) { try { cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')); } catch { throw new ApiError(400,'VALIDATION_ERROR','Invalid pagination cursor'); } cursor=parseRequest(TakeoffCursorSchema,cursor); }
    const raw = z.object({items:z.array(WorkflowRunSchema.omit({request:true,plan:true})).max(100),nextCursor:TakeoffCursorSchema.nullable()}).strict().parse(
      await this.rpc('workflow_read',{p_action:'list',p_input:{projectId,limit:query.limit,cursor}}));
    return {...raw,nextCursor:raw.nextCursor?Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url'):null};
  }
  write(action: 'begin'|'step'|'finish', input: Record<string,unknown>, userId: string, secret: string, context?: IdempotencyContext) {
    const payload = {action,...input};
    const signed = signProjectCommit(secret,userId,WORKFLOW_OPERATION,payload,context);
    return this.rpc('workflow_write',{p_input:payload,p_context:context??null,p_envelope:signed.envelope,p_signature:signed.signature});
  }
}
