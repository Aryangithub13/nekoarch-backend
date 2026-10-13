import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Backend } from '../lib/repository.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { RevisionParamsSchema } from '../contracts/projects.js';
import { DocumentsQuerySchema, PlanSheetParamsSchema, ScheduleParamsSchema } from '../contracts/documents.js';
import { DOCUMENTS_ROOT, readDocumentsManifest, readPlanSheet, readScheduleCsv, readSchedules } from '../services/documents-service.js';

/** Downloads are attachments with server-built names (revision id, level index, schedule id), never user text; nosniff and no caching. */
const download = (reply: FastifyReply, mediaType: string, filename: string, body: string) => reply.type(mediaType)
  .header('Content-Disposition', `attachment; filename="${filename}"`).header('X-Content-Type-Options', 'nosniff')
  .header('Cache-Control', 'private, no-store').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").send(body);

/** Phase 38: construction documents derived on read from one stored revision; nothing is stored. */
export function documentsRoutes(app: FastifyInstance, backend: Backend) {
  app.get(DOCUMENTS_ROOT, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const query = parseRequest(DocumentsQuerySchema, request.query);
    return readDocumentsManifest(repository, projectId, revisionId, query.require === 'current');
  });
  app.get(`${DOCUMENTS_ROOT}/plan-sheets/:levelId`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, levelId } = parseRequest(PlanSheetParamsSchema, request.params);
    const query = parseRequest(DocumentsQuerySchema, request.query);
    const { sheet } = await readPlanSheet(repository, projectId, revisionId, levelId, query.require === 'current');
    return download(reply, 'image/svg+xml; charset=utf-8', `plan-${revisionId}-level-${sheet.levelIndex}.svg`, sheet.svg);
  });
  app.get(`${DOCUMENTS_ROOT}/schedules`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    const query = parseRequest(DocumentsQuerySchema, request.query);
    // Sent as the exact text the manifest hashed.
    return reply.type('application/json; charset=utf-8').send(JSON.stringify(await readSchedules(repository, projectId, revisionId, query.require === 'current')));
  });
  app.get(`${DOCUMENTS_ROOT}/schedules/:schedule/csv`, async (request, reply) => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId, schedule } = parseRequest(ScheduleParamsSchema, request.params);
    const query = parseRequest(DocumentsQuerySchema, request.query);
    const { csv } = await readScheduleCsv(repository, projectId, revisionId, schedule, query.require === 'current');
    return download(reply, 'text/csv; charset=utf-8', `${schedule}-schedule-${revisionId}.csv`, csv);
  });
}
