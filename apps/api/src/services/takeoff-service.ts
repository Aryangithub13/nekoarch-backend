import { createHash } from 'node:crypto';
import { calculateQuantityTakeoff, TakeoffError, type TakeoffOptions } from '@designflow/quantity-takeoff';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { TakeoffRepository } from '../lib/takeoff-repository.js';
import type { Repository, IdempotencyContext } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { signProjectCommit } from './project-service.js';

export const TAKEOFF_OPERATION = '/api/projects/:projectId/revisions/:revisionId/takeoffs';
/** Matches PostgreSQL canonical_json for validated JSON: integer geometry, sorted ASCII keys. */
export function takeoffCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(takeoffCanonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${takeoffCanonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function takeoffFingerprint(input: unknown) { return createHash('sha256').update(takeoffCanonical(input)).digest('hex'); }
export async function createTakeoff(repository: Repository, userId: string, projectId: string, revisionId: string,
  options: TakeoffOptions, secret?: string, context?: IdempotencyContext) {
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  const acceptance = revision.qaRuns.find(run => run.id === revision.qa.id);
  if (!acceptance || !['PASS', 'PASS_WITH_WARNINGS'].includes(acceptance.status) || acceptance.report.inputStatus !== 'SCHEMA_VALID'
    || acceptance.report.summary.errors !== 0 || !['PASS', 'PASS_WITH_WARNINGS'].includes(acceptance.report.status)) {
    throw new ApiError(422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence');
  }
  if (!secret) throw new ApiError(503, 'TAKEOFF_UNAVAILABLE', 'Takeoff persistence is not configured');
  let report;
  try { report = calculateQuantityTakeoff(revision.model, options); }
  catch (error) {
    if (error instanceof TakeoffError) throw new ApiError(422,
      error.code === 'RESOURCE_LIMIT_EXCEEDED' ? 'TAKEOFF_RESOURCE_LIMIT' : error.code === 'INCOMPLETE_MODEL' ? 'TAKEOFF_UNSUPPORTED_MODEL' : 'TAKEOFF_FAILED', error.message);
    throw error;
  }
  const inputFingerprint = takeoffFingerprint({ projectRevisionId: revisionId, model: revision.model,
    engineVersion: report.engineVersion, measurementPolicyVersion: report.measurementPolicyVersion, options: report.options });
  const input = { projectId, projectRevisionId: revisionId, acceptanceQaId: acceptance.id, inputFingerprint, report };
  return new TakeoffRepository(repository).write(input, signProjectCommit(secret, userId, TAKEOFF_OPERATION, input, context), context);
}
