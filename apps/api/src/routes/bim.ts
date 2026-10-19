import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { ApiError, parseRequest } from '../lib/errors.js';
import { RevisionParamsSchema } from '../contracts/projects.js';
import { readBim } from '../services/bim-service.js';
import { BimKindSchema, BimError, RelationshipSchema } from '../bim/contracts.js';
import { diffBim } from '../bim/diff.js';
import { exportIfc } from '../bim/ifc.js';
const root = '/api/projects/:projectId/revisions/:revisionId/bim';
const page = z.object({ limit:z.coerce.number().int().min(1).max(100).default(50), after:z.string().regex(/^bim-[a-f0-9]{40}$/).optional(), kind:BimKindSchema.optional() }).strict();
const relationshipPage = page.extend({ kind:RelationshipSchema.shape.kind.optional() });
export const BimElementParamsSchema = RevisionParamsSchema.extend({ elementId:z.string().regex(/^bim-[a-f0-9]{40}$/) });
const elementParams = BimElementParamsSchema;
export function bimRoutes(app: FastifyInstance, backend: Backend) {
  for (const view of ['','/validation','/elements','/relationships','/export.json','/export.ifc'] as const) app.get(`${root}${view}`,async (request,reply) => {
    const { repository } = await requestContext(request,backend,true);
    const { projectId,revisionId } = parseRequest(RevisionParamsSchema,request.params);
    const query = parseRequest(view === '/elements' ? page : view === '/relationships' ? relationshipPage : z.object({}).strict(),request.query);
    const { model,validation } = await readBim(repository,projectId,revisionId);
    if (view === '/validation') return validation;
    if (view === '/elements' || view === '/relationships') {
      const p = (view === '/elements' ? page : relationshipPage).parse(query);
      const all = view === '/elements' ? model.elements.filter(e => !p.kind || e.kind === p.kind) : model.relationships.filter(r => !p.kind || r.kind === p.kind);
      if (p.after && !all.some(e => e.id === p.after)) throw new ApiError(400,'VALIDATION_ERROR','Pagination element is not in this revision/filter');
      const items = all.filter(e => !p.after || e.id > p.after).slice(0,p.limit);
      return { binding:model.binding,items,nextAfter:items.length === p.limit && all.some(e => e.id > items[items.length-1]!.id) ? items[items.length-1]!.id : null };
    }
    if (view === '/export.ifc') {
      try { return reply.type('application/x-step').header('Content-Disposition',`attachment; filename="bim-${revisionId}.ifc"`).send(exportIfc(model)); }
      catch (error) { if (error instanceof BimError) throw new ApiError(422,error.code,error.message); throw error; }
    }
    if (view === '/export.json') return reply.type('application/json').header('Content-Disposition',`attachment; filename="bim-${revisionId}.json"`).send(model);
    return { model,validation };
  });
  app.get(`${root}/elements/:elementId`,async request => {
    const { repository } = await requestContext(request,backend,true);
    const { projectId,revisionId,elementId } = parseRequest(elementParams,request.params);
    parseRequest(z.object({}).strict(),request.query);
    const { model } = await readBim(repository,projectId,revisionId), element = model.elements.find(e => e.id === elementId);
    if (!element) throw new ApiError(404,'BIM_ELEMENT_NOT_FOUND','Element not found');
    return { binding:model.binding,element,relationships:model.relationships.filter(r => r.from === elementId || r.to === elementId) };
  });
  app.get(`${root}/diff/:otherRevisionId`,async request => {
    const { repository } = await requestContext(request,backend,true);
    const { projectId,revisionId,otherRevisionId } = parseRequest(RevisionParamsSchema.extend({otherRevisionId:z.string().uuid()}),request.params);
    parseRequest(z.object({}).strict(),request.query);
    const before = await readBim(repository,projectId,revisionId), after = await readBim(repository,projectId,otherRevisionId);
    return diffBim(before.model,after.model);
  });
}
