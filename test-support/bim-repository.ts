import type { Repository } from '../apps/api/src/lib/repository.js';

/** BIM reads may use only the owner-scoped project RPC. */
export function bimRepository(projectRpc: NonNullable<Repository['projectRpc']>): Repository {
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected non-project repository access'); };
  return { projectRpc, insertPlan: unexpected, getPlan: unexpected, patchPlan: unexpected,
    getRateVersions: unexpected, getRateEntries: unexpected, insertEstimate: unexpected };
}
