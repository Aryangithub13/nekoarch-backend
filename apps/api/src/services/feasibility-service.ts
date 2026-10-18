import type { Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { ProjectDetailSchema, ProjectRevisionSummarySchema } from '../contracts/projects.js';
import type { FeasibilityAssessment, FeasibilityRequest } from '../feasibility/contracts.js';
import { assessFeasibility } from '../feasibility/assess.js';

/**
 * B42 S1: a feasibility assessment of a declared ambition. Read only: ownership is established by the project read (RLS), and a named base revision
 * must belong to the project. Nothing is generated or stored; the alternatives are proposals that need the user's consent on their own routes.
 */
export async function assessProjectFeasibility(repository: Repository, projectId: string, request: FeasibilityRequest): Promise<FeasibilityAssessment> {
  const projects = new ProjectRepository(repository);
  ProjectDetailSchema.parse(await projects.read('get', projectId));
  if (request.baseRevisionId) ProjectRevisionSummarySchema.passthrough().parse(await projects.read('revision', projectId, request.baseRevisionId));
  return assessFeasibility(projectId, request);
}
