import type { FastifyRequest } from 'fastify';
import type { Backend, Repository } from './repository.js';
import { ApiError } from './errors.js';

export async function requestContext(request: FastifyRequest, backend: Backend, required: boolean): Promise<{ userId?: string; repository: Repository }> {
  const header = request.headers.authorization;
  if (!header) {
    if (required) throw new ApiError(401, 'UNAUTHORIZED', 'A valid Supabase session is required');
    return { repository: backend.repository() };
  }
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match?.[1]) throw new ApiError(401, 'UNAUTHORIZED', 'A valid Supabase session is required');
  const user = await backend.authenticate(match[1]);
  return { userId: user.id, repository: backend.repository(match[1]) };
}
