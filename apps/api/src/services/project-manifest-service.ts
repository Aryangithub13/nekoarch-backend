import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { ApiError } from '../lib/errors.js';
import type { Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { JobRepository } from '../lib/job-repository.js';
import { DesignConceptRepository } from '../lib/design-concept-repository.js';
import { buildProjectManifest, JOB_MODULES, type ActiveJob } from '../graph/project-manifest.js';
import { dependencyGraph, type GraphOptions } from './dependency-graph-service.js';

/** Bounded side reads. At most JOB_LIMITS.activePerProject (4) jobs are queued or running per project, so one page per status always holds them all. */
export const MANIFEST_READS = Object.freeze({ conceptPage: 20, jobPage: 8, detailsInFlight: 4 });
const limitExceeded = (): never => {
  throw new ApiError(422, 'PROJECT_MANIFEST_LIMIT_EXCEEDED', 'The manifest exceeds a bounded read; no partial manifest is returned', { limit: ['JOB_PAGE'] });
};

/** Queued or running SCENE_COMPILE / OPTIMIZATION_STUDY jobs bound to this revision; null when this backend has no job persistence. */
async function activeJobs(repository: Repository, projectId: string, revisionId: string): Promise<ActiveJob[] | null> {
  if (!repository.jobRpc) return null;
  const jobs = new JobRepository(repository);
  const pages = await Promise.all((['QUEUED', 'RUNNING'] as const).map(status => jobs.list(projectId, { limit: MANIFEST_READS.jobPage, status })));
  if (pages.some(p => p.nextCursor !== null)) limitExceeded();
  const candidates = pages.flatMap(p => p.items).filter(j => j.kind in JOB_MODULES);
  const found: ActiveJob[] = [];
  for (let i = 0; i < candidates.length; i += MANIFEST_READS.detailsInFlight) {
    const details = await Promise.all(candidates.slice(i, i + MANIFEST_READS.detailsInFlight).map(j => jobs.get(projectId, j.id)));
    for (const d of details) {
      const request = d.request;
      if ((request.kind === 'SCENE_COMPILE' || request.kind === 'OPTIMIZATION_STUDY') && request.revisionId === revisionId)
        found.push({ jobId: d.id, module: JOB_MODULES[request.kind] });
    }
  }
  return found;
}

/**
 * B37 completion slice: Unified Project Manifest v2 for one revision. Read-only and owner-only: the revision read (404 for anyone else) runs first and every
 * later read is an owner-scoped RPC. Nothing is written, generated or recomputed beyond the Phase 37 provenance checks.
 *
 * Coherence (roadmap L258, scenario 17): the graph lists everything twice and refuses on any difference; the design-concept listing runs after it and
 * reports the project's current revision. The current-revision pointer only moves forward, so the same pointer before the graph and after the listing
 * shows that no revision was committed while the manifest was read. A difference is a retryable 409, never a mixed manifest.
 */
export async function projectManifest(repository: Repository, projectId: string, revisionId: string, options: GraphOptions & { clock?: () => Date } = {}) {
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  const graph = await dependencyGraph(repository, projectId, revisionId, options);
  const [concepts, jobs] = await Promise.all([
    repository.designConceptRpc ? new DesignConceptRepository(repository).list(projectId, revisionId, { limit: MANIFEST_READS.conceptPage }) : null,
    activeJobs(repository, projectId, revisionId)]);
  if (concepts && concepts.projectCurrentRevisionId !== graph.inputIdentity.projectCurrentRevisionId)
    throw new ApiError(409, 'PROJECT_MANIFEST_READ_INCONSISTENT', 'The project changed while the manifest was read; retry');
  return buildProjectManifest({ projectId, revision, graph, activeJobs: jobs,
    designConcepts: concepts ? { items: concepts.items, truncated: concepts.nextCursor !== null } : null,
    integrityCheckedAt: (options.clock ?? (() => new Date()))().toISOString() });
}
