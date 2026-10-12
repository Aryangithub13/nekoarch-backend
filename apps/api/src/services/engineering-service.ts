import type { Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';
import { assessModel, type Evidence, type RelatedService } from '../engineering/assess.js';
import type { AssessmentRequest } from '../engineering/contracts.js';
import type { ZoneAssessmentRequest, ZonePreflightRequest } from '../engineering/zone-contracts.js';
import { REGENERATION_ROUTE, ZoneRequestError, assessZones, preflightZoneRegeneration, type ZoneContext } from '../engineering/zones.js';
import type { RegenerationRequest } from '../engineering/regeneration-contracts.js';
import { regenerate, verifyRegeneration, type QaRunner } from '../engineering/regeneration.js';
import type { PartitionRequest } from '../engineering/partition-contracts.js';
import { partitionZones } from '../engineering/partitions.js';
import { revisionQaReport } from './project-service.js';
import { VERIFICATION_ROOT, readRevisionModel } from './verification-service.js';
import { currentBrief, projectContext } from './account-service.js';
import { readReference } from './reference-service.js';
import { STRUCTURAL_ROOT, structuralStatus } from './structural-service.js';
import { SYSTEMS_ROOT, systemsStatus } from './systems-service.js';
import { KNOWLEDGE_ROOT, knowledgeStatus } from './knowledge-service.js';
import { TAKEOFF_OPERATION } from './takeoff-service.js';

export const ENGINEERING_ROOT = '/api/projects/:projectId/revisions/:revisionId/engineering-assessment';
export const ZONES_ROOT = `${ENGINEERING_ROOT}/zones`;
export const ZONE_PREFLIGHT_ROUTE = `${ZONES_ROOT}/regeneration-preflight`;
export const ZONE_REGENERATION_ROUTE = `${ZONES_ROOT}/regeneration`;
export const ZONE_REGENERATION_VERIFICATION_ROUTE = `${ZONE_REGENERATION_ROUTE}/verification`;
export const ZONE_PARTITIONS_ROUTE = `${ZONES_ROOT}/partitions`;
if (ZONE_REGENERATION_ROUTE !== REGENERATION_ROUTE) throw new Error('Zone regeneration route constants disagree');

/** A declared evidence reference must be a live reference of this project (RLS-scoped read); its contents are never read or interpreted. */
async function resolveEvidence(repository: Repository, projectId: string, request: AssessmentRequest): Promise<Evidence[]> {
  return Promise.all(request.evidence.map(async e => {
    if (!e.referenceId) return { kind: e.kind, referenceId: null, citation: e.citation ?? null, reference: null, verification: 'USER_DECLARED' as const, contentInterpreted: false as const };
    const reference = await readReference(repository, projectId, e.referenceId).catch((error: unknown) => {
      if (error instanceof ApiError && error.statusCode === 404) return null;
      throw error;
    });
    if (!reference || reference.status === 'DELETED') throw new ApiError(422, 'ASSESSMENT_EVIDENCE_NOT_FOUND', 'A declared evidence reference is not a live reference of this project');
    return { kind: e.kind, referenceId: e.referenceId, citation: e.citation ?? null, verification: 'USER_DECLARED' as const, contentInterpreted: false as const,
      reference: { purpose: reference.purpose, mediaType: reference.mediaType, storedSha256: reference.storedSha256, boundRevisionId: reference.boundRevisionId } };
  }));
}

/**
 * Phase 35: derived on read, like the Phase 34 verifier it builds on. The work is bounded by the Building Model V2 schema limits and the verifier's
 * operation budget, so it runs in the request; nothing is stored, and no durable job is needed. Ownership is established by the revision read (RLS).
 */
export async function assessRevision(repository: Repository, projectId: string, revisionId: string, request: AssessmentRequest, now = new Date()) {
  const { model, hash } = await readRevisionModel(repository, projectId, revisionId);
  const [brief, evidence, structural, systems, knowledge] = await Promise.all([currentBrief(repository, projectId), resolveEvidence(repository, projectId, request),
    structuralStatus(repository, projectId, revisionId), systemsStatus(repository, projectId, revisionId), knowledgeStatus(repository, projectId, revisionId)]);
  const href = (route: string) => route.replace(':projectId', projectId).replace(':revisionId', revisionId);
  const related: RelatedService[] = [
    { serviceId: 'STRUCTURAL_ANALYSIS', route: href(STRUCTURAL_ROOT), artifactsForRevision: structural.analyses.length,
      note: 'Linear-static frame analysis of user-provided members, materials and loads (Phase 24); design verification is not evaluated' },
    { serviceId: 'BUILDING_SYSTEMS_ANALYSIS', route: href(SYSTEMS_ROOT), artifactsForRevision: systems.analyses.length,
      note: 'Egress graph distances and elevator shaft proposals (Phase 26); code compliance is not claimed' },
    { serviceId: 'SPECIALIZED_KNOWLEDGE', route: href(KNOWLEDGE_ROOT), artifactsForRevision: knowledge.analyses.length,
      note: 'Advisory evaluation of explicit rule packs (Phase 27); never a compliance determination' },
    { serviceId: 'COMPLEX_VERIFICATION', route: href(VERIFICATION_ROOT), artifactsForRevision: null, note: 'Exact site and building verification, derived on read (Phase 34)' },
    { serviceId: 'QUANTITY_TAKEOFF', route: href(TAKEOFF_OPERATION), artifactsForRevision: null,
      note: 'Element quantities for modelled elements (Phase 13); a tall building\'s structural system is not modelled' },
  ];
  const current = brief.current;
  return assessModel({ ids: { projectId, revisionId, modelHash: hash }, model, request, evidence, related, generatedAt: now.toISOString(),
    brief: { version: current?.version ?? 0, briefHash: current?.briefHash ?? null, floors: current?.brief.program.floors ?? null } });
}

/**
 * Phase 35.1: zone assessment and regeneration preflight are derived on read from the stored revision (RLS-scoped, model-hash checked) and store
 * nothing. Freshness follows the scene convention: CURRENT only while the assessed revision is the project's current revision.
 */
async function zoneContext(repository: Repository, projectId: string, revisionId: string, now: Date): Promise<ZoneContext> {
  const { model, hash, revisionNumber, parentRevisionId } = await readRevisionModel(repository, projectId, revisionId);
  const projectCurrentRevisionId = (await projectContext(repository, projectId)).currentRevision?.id ?? null;
  return { ids: { projectId, revisionId, modelHash: hash }, model, generatedAt: now.toISOString(),
    sourceRevision: { revisionId, revisionNumber, parentRevisionId, modelHash: hash },
    currency: { status: projectCurrentRevisionId === revisionId ? 'CURRENT' : 'STALE', artifactRevisionId: revisionId, projectCurrentRevisionId } };
}

export async function assessRevisionZones(repository: Repository, projectId: string, revisionId: string, request: ZoneAssessmentRequest, now = new Date()) {
  return assessZones(await zoneContext(repository, projectId, revisionId, now), request);
}

export async function preflightRevisionZoneRegeneration(repository: Repository, projectId: string, revisionId: string, request: ZonePreflightRequest, now = new Date()) {
  const context = await zoneContext(repository, projectId, revisionId, now);
  try { return preflightZoneRegeneration(context, request); }
  catch (error) {
    if (error instanceof ZoneRequestError) throw new ApiError(422, error.code, error.message, { zones: error.issues });
    throw error;
  }
}

/** Supplied revisions are accepted with exactly this QA (saveProjectRevision with no requirements), so a candidate that passes it can be saved. */
const supplyQa: QaRunner = model => revisionQaReport(model, null, null);
const zoneRequest = <T>(run: () => T): T => {
  try { return run(); }
  catch (error) {
    if (error instanceof ZoneRequestError) throw new ApiError(422, error.code, error.message, { zones: error.issues });
    throw error;
  }
};

/** Phase 35 regeneration: a candidate derived on read from the stored revision; nothing is committed or stored by this call. */
export async function regenerateRevisionZone(repository: Repository, projectId: string, revisionId: string, request: RegenerationRequest, now = new Date()) {
  const context = await zoneContext(repository, projectId, revisionId, now);
  return zoneRequest(() => regenerate(context, request, { qa: supplyQa }));
}

/** Recomputes the stated regeneration from the revision's parent (owner-scoped reads of both) and compares it with the committed revision. */
export async function verifyRevisionRegeneration(repository: Repository, projectId: string, revisionId: string, request: RegenerationRequest, now = new Date()) {
  const committed = await readRevisionModel(repository, projectId, revisionId);
  const parent = committed.parentRevisionId ? await zoneContext(repository, projectId, committed.parentRevisionId, now) : null;
  return zoneRequest(() => verifyRegeneration({ ids: { projectId, revisionId, modelHash: committed.hash }, model: committed.model }, parent, request, { qa: supplyQa }, now.toISOString()));
}

/** Phase 35 partitioned processing, derived on read from the stored revision. */
export async function partitionRevisionZones(repository: Repository, projectId: string, revisionId: string, request: PartitionRequest, now = new Date()) {
  const context = await zoneContext(repository, projectId, revisionId, now);
  return zoneRequest(() => partitionZones(context, request));
}
