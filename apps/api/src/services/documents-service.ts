import { createHash } from 'node:crypto';
import type { BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { DOCUMENT_CLAIMS, DOCUMENTS_VERSION, DocumentsManifestSchema, FORMAT_SUPPORT, SchedulesResponseSchema,
  type DocumentsManifest } from '../contracts/documents.js';
import { ApiError } from '../lib/errors.js';
import { modelHash } from '../lib/generation-identity.js';
import type { Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { buildDependencyGraph, nodeKey } from '../graph/dependency-graph.js';
import { buildPlanSheet, DocumentError, PLAN_SHEET_VERSION } from '../documents/plan-sheet.js';
import { buildSchedules, scheduleCsv, SCHEDULES_VERSION, type ScheduleId } from '../documents/schedules.js';
import { revisionRecords } from './dependency-graph-service.js';
import { projectContext } from './account-service.js';

export const DOCUMENTS_ROOT = '/api/projects/:projectId/revisions/:revisionId/documents';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * One revision read is the only geometry source, so a document can never mix revisions. Freshness reuses Phase 37: the REVISION and
 * ACCEPTANCE_QA records are evaluated by the same builder, and UNVERIFIED (identity mismatch, QA not accepted, no current revision) fails closed.
 * Currency is as of the current-revision read that follows the revision read.
 */
export async function documentSource(repository: Repository, projectId: string, revisionId: string, requireCurrent: boolean) {
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  if (revision.projectId !== projectId || revision.id !== revisionId) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Revision not found');
  const projectCurrentRevisionId = (await projectContext(repository, projectId)).currentRevision?.id ?? null;
  const hash = modelHash(revision.model);
  const graph = buildDependencyGraph({ projectId, revisionId, modelHash: hash, projectCurrentRevisionId, records: revisionRecords({ revision, hash }) });
  const node = (key: string) => { const n = graph.nodes.find(x => x.nodeId === key)!; return { state: n.state, causes: n.causes }; };
  const rev = node(nodeKey('REVISION', revisionId)), qa = node(nodeKey('ACCEPTANCE_QA', revision.qa.id));
  if (rev.state === 'UNVERIFIED' || qa.state === 'UNVERIFIED' || projectCurrentRevisionId === null || !['PASS', 'PASS_WITH_WARNINGS'].includes(revision.qa.status)) {
    const causes = [...rev.causes, ...qa.causes].map(c => `${c.nodeId}: ${c.code}`);
    throw new ApiError(422, 'DOCUMENT_SOURCE_UNVERIFIED', 'The revision identity or its acceptance QA could not be verified; no document is produced',
      { causes: causes.length ? causes : ['NO_CURRENT_REVISION'] });
  }
  const documentStatus = rev.state === 'CURRENT' ? 'CURRENT_REVISION' as const : 'HISTORICAL_SNAPSHOT' as const;
  if (requireCurrent && documentStatus !== 'CURRENT_REVISION')
    throw new ApiError(409, 'DOCUMENT_SOURCE_STALE', 'The revision has been superseded; its documents are a historical snapshot');
  const binding = { projectId, revisionId, revisionNumber: revision.revisionNumber, modelHash: hash, acceptanceQaId: revision.qa.id,
    qaStatus: revision.qa.status as 'PASS' | 'PASS_WITH_WARNINGS' };
  return { model: revision.model as BuildingModelV2, binding, freshness: { documentStatus, projectCurrentRevisionId, revision: rev, acceptanceQa: qa } };
}
type Source = Awaited<ReturnType<typeof documentSource>>;

function sheet(source: Source, levelId: string) {
  try { return buildPlanSheet(source.model, levelId, source.binding); }
  catch (error) { if (error instanceof DocumentError) throw new ApiError(422, error.code, error.message); throw error; }
}
const storeys = (model: BuildingModelV2) => [...model.levels].filter(l => l.kind === 'storey').sort((a, b) => a.index - b.index || (a.id < b.id ? -1 : 1));
const href = (projectId: string, revisionId: string, rest: string) => `/api/projects/${projectId}/revisions/${revisionId}/documents${rest}`;

export function documentsManifest(source: Source): DocumentsManifest {
  const { projectId, revisionId } = source.binding;
  const sheets = storeys(source.model).map(level => {
    const base = { documentId: `plan-sheet:${level.id}`, kind: 'PLAN_SHEET' as const, title: `Plan: ${level.name}`, mediaType: 'image/svg+xml' as const,
      levelId: level.id, scheduleId: null, rowCount: null };
    try {
      const s = buildPlanSheet(source.model, level.id, source.binding);
      return { ...base, href: href(projectId, revisionId, `/plan-sheets/${encodeURIComponent(level.id)}`), status: s.status, unavailableReason: null,
        contentHash: sha256(s.svg), bytes: Buffer.byteLength(s.svg), incomplete: s.incomplete };
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      // A sheet that cannot be drawn faithfully is listed as unavailable with its reason, never approximated.
      return { ...base, href: null, status: 'UNAVAILABLE' as const, unavailableReason: error.code, contentHash: null, bytes: null, incomplete: [] };
    }
  });
  const schedules = buildSchedules(source.model), json = schedulesBody(source, schedules), jsonText = JSON.stringify(json);
  const content = {
    documentsVersion: DOCUMENTS_VERSION, binding: source.binding, freshness: source.freshness,
    documents: [...sheets,
      { documentId: 'schedules', kind: 'SCHEDULE_SET' as const, title: 'All schedules', mediaType: 'application/json' as const, href: href(projectId, revisionId, '/schedules'),
        status: 'COMPLETE' as const, unavailableReason: null, contentHash: sha256(jsonText), bytes: Buffer.byteLength(jsonText), incomplete: [], levelId: null, scheduleId: null,
        rowCount: schedules.reduce((n, s) => n + s.rowCount, 0) },
      ...schedules.map(s => { const csv = scheduleCsv(s); return { documentId: `schedule:${s.scheduleId}`, kind: 'SCHEDULE' as const, title: s.title, mediaType: 'text/csv' as const,
        href: href(projectId, revisionId, `/schedules/${s.scheduleId}/csv`), status: 'COMPLETE' as const, unavailableReason: null, contentHash: sha256(csv),
        bytes: Buffer.byteLength(csv), incomplete: [], levelId: null, scheduleId: s.scheduleId, rowCount: s.rowCount }; })],
    notDrawnLevels: source.model.levels.filter(l => l.kind !== 'storey').sort((a, b) => (a.id < b.id ? -1 : 1)).map(l => ({ levelId: l.id, kind: l.kind as 'roof' | 'datum' })),
    formats: FORMAT_SUPPORT.map(f => ({ ...f })),
    limitations: [
      `${PLAN_SHEET_VERSION}: plans of storey levels only; walls, openings, spaces and the level boundary. Stairs, slabs, columns and dimensions are counted, not drawn.`,
      'A wall without a stored thickness is drawn as a dashed centreline and its sheet is INCOMPLETE; no thickness is assumed.',
      'Room area is the exact area of the stored boundary and is reported only where the boundary basis is wall-centerline.',
      `${SCHEDULES_VERSION}: every value is a stored field or an exact derived value; missing values stay empty.`,
      'Documents are derived on read and not stored; a persisted, hashed record of them is part of an engineering evidence package.',
    ],
    claims: { ...DOCUMENT_CLAIMS },
  };
  return DocumentsManifestSchema.parse({ ...content, manifestHash: costHash(content) });
}

function schedulesBody(source: Source, schedules = buildSchedules(source.model)) {
  return SchedulesResponseSchema.parse({ schedulesVersion: SCHEDULES_VERSION, binding: source.binding, freshness: source.freshness, schedules, claims: { ...DOCUMENT_CLAIMS } });
}

export async function readDocumentsManifest(repository: Repository, projectId: string, revisionId: string, requireCurrent: boolean) {
  return documentsManifest(await documentSource(repository, projectId, revisionId, requireCurrent));
}
export async function readPlanSheet(repository: Repository, projectId: string, revisionId: string, levelId: string, requireCurrent: boolean) {
  const source = await documentSource(repository, projectId, revisionId, requireCurrent);
  const level = source.model.levels.find(l => l.id === levelId);
  if (!level) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'No level with this id in the revision');
  if (level.kind !== 'storey') throw new ApiError(422, 'DOCUMENT_NOT_SUPPORTED', 'Plan sheets are drawn for storey levels only');
  return { sheet: sheet(source, levelId), binding: source.binding };
}
export async function readSchedules(repository: Repository, projectId: string, revisionId: string, requireCurrent: boolean) {
  return schedulesBody(await documentSource(repository, projectId, revisionId, requireCurrent));
}
export async function readScheduleCsv(repository: Repository, projectId: string, revisionId: string, scheduleId: ScheduleId, requireCurrent: boolean) {
  const source = await documentSource(repository, projectId, revisionId, requireCurrent);
  return { csv: scheduleCsv(buildSchedules(source.model).find(s => s.scheduleId === scheduleId)!), binding: source.binding };
}
