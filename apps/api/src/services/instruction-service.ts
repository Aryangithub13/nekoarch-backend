import type { Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { RevisionListSchema } from '../contracts/projects.js';
import type { InstructionResolution } from '../instructions/contracts.js';
import { resolveInstruction } from '../instructions/resolve.js';
import { readRevisionModel } from './verification-service.js';

/** History read for revision references ("the previous one", "revision 3"); the newest 100 revisions, owner-scoped by RLS. */
const HISTORY_LIMIT = 100;

/**
 * B41 S1: resolve one instruction against one revision. Read only: the revision (ownership and model identity checked by the B34 reader) and the
 * project's revision history are read; nothing is stored, no provider is called and nothing is executed.
 */
export async function resolveRevisionInstruction(repository: Repository, projectId: string, revisionId: string, text: string): Promise<InstructionResolution> {
  const [revision, page] = await Promise.all([readRevisionModel(repository, projectId, revisionId),
    new ProjectRepository(repository).list('history', { limit: HISTORY_LIMIT }, projectId)]);
  const history = RevisionListSchema.parse(page).items.map(r => ({ id: r.id, revisionNumber: r.revisionNumber, parentRevisionId: r.parentRevisionId }));
  return resolveInstruction(text, revision.model, { projectId, revisionId, revisionNumber: revision.revisionNumber, parentRevisionId: revision.parentRevisionId,
    modelHash: revision.hash }, history);
}
