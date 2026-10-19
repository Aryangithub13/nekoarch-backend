import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Backend } from '../lib/repository.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../lib/auth.js';
import { parseRequest } from '../lib/errors.js';
import { durableCommand } from '../lib/idempotency.js';
import { COLLABORATION_ROUTES, CommentRequestSchema, MemberParamsSchema, MemberRequestSchema, ProjectParamsSchema, ReviewRequestSchema, RevisionParamsSchema }
  from '../collaboration/contracts.js';
import { addComment, addReview, readRevisionCollaboration, readWorkspace, removeMember, upsertMember } from '../services/collaboration-service.js';

/**
 * B44 S1: owner-managed members, element-anchored comments, reviews bound to the model hash, and the change audit. Reads are open to the owner and
 * active members; writes are signed and role-checked in SQL. A non-member gets 404, as for any project they cannot see.
 */
export function collaborationRoutes(app: FastifyInstance, backend: Backend, env: Env) {
  const empty = z.object({}).strict();
  app.get(COLLABORATION_ROUTES.workspace, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    parseRequest(empty, request.query);
    return readWorkspace(repository, projectId);
  });
  app.post(COLLABORATION_ROUTES.members, { bodyLimit: 1024 }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId } = parseRequest(ProjectParamsSchema, request.params);
    return reply.code(201).send(await upsertMember(repository, userId!, projectId, parseRequest(MemberRequestSchema, request.body ?? {}), env.PROJECT_COMMIT_SECRET));
  });
  // Member removal, comments and reviews honour Idempotency-Key (0033): a retry with the same key replays the stored response.
  app.delete(COLLABORATION_ROUTES.member, async request => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, userId: memberId } = parseRequest(MemberParamsSchema, request.params);
    return durableCommand(request, repository, { projectId, memberId }, context => removeMember(repository, userId!, projectId, memberId, env.PROJECT_COMMIT_SECRET, context));
  });
  app.get(COLLABORATION_ROUTES.revision, async request => {
    const { repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params);
    parseRequest(empty, request.query);
    return readRevisionCollaboration(repository, projectId, revisionId);
  });
  app.post(COLLABORATION_ROUTES.comments, { bodyLimit: 8192 }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params), body = parseRequest(CommentRequestSchema, request.body ?? {});
    return reply.code(201).send(await durableCommand(request, repository, { projectId, revisionId, body },
      context => addComment(repository, userId!, projectId, revisionId, body, env.PROJECT_COMMIT_SECRET, context)));
  });
  app.post(COLLABORATION_ROUTES.reviews, { bodyLimit: 4096 }, async (request, reply) => {
    const { userId, repository } = await requestContext(request, backend, true);
    const { projectId, revisionId } = parseRequest(RevisionParamsSchema, request.params), body = parseRequest(ReviewRequestSchema, request.body ?? {});
    return reply.code(201).send(await durableCommand(request, repository, { projectId, revisionId, body },
      context => addReview(repository, userId!, projectId, revisionId, body, env.PROJECT_COMMIT_SECRET, context)));
  });
}
