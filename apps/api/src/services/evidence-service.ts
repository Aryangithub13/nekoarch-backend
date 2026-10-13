import { costHash } from '@designflow/boq-cost';
import { ARTIFACT_KINDS, EVIDENCE_CLAIMS, EVIDENCE_PACKAGE_VERSION, EvidencePackageSchema, type EvidencePackage } from '../contracts/evidence.js';
import type { AssessmentRequest } from '../engineering/contracts.js';
import { ApiError } from '../lib/errors.js';
import type { Repository } from '../lib/repository.js';
import { EvidenceRepository } from '../lib/evidence-repository.js';
import { dependencyGraph } from './dependency-graph-service.js';
import { assessRevision } from './engineering-service.js';
import { documentSource, documentsManifest } from './documents-service.js';
import { signProjectCommit } from './project-service.js';

export const EVIDENCE_ROOT = '/api/projects/:projectId/revisions/:revisionId/evidence-packages';
const NOT_RECORDED_NOTE = 'Software never records a professional review; a reviewer identity and a recorded review are outside this package.';

/**
 * Assemble the package from verified sources, then persist it through the signed SQL write, which recomputes every binding and hash and,
 * for CURRENT_REVISION, rechecks inside its transaction that the revision is still current. Nothing is regenerated or recomputed upstream:
 * an UNVERIFIED source refuses the package, and a stale one refuses a CURRENT_REVISION package.
 */
export async function buildEvidencePackage(repository: Repository, projectId: string, revisionId: string, mode: EvidencePackage['createdAs'],
  request: AssessmentRequest): Promise<EvidencePackage> {
  const graph = await dependencyGraph(repository, projectId, revisionId);
  const unverified = graph.nodes.filter(n => n.state === 'UNVERIFIED');
  if (unverified.length) throw new ApiError(422, 'EVIDENCE_SOURCE_UNVERIFIED', 'A source of this revision could not be verified; no package is created',
    { nodes: unverified.slice(0, 16).map(n => `${n.nodeId}: ${n.causes[0]?.code ?? 'UNVERIFIED'}`) });
  const current = graph.inputIdentity.projectCurrentRevisionId === revisionId;
  if (mode === 'CURRENT_REVISION' && (!current || graph.nodes.some(n => n.state !== 'CURRENT')))
    throw new ApiError(409, 'EVIDENCE_SOURCE_STALE', 'The revision is not the project\'s current revision; request a HISTORICAL_SNAPSHOT to record it as such',
      { nodes: graph.nodes.filter(n => n.state !== 'CURRENT').slice(0, 16).map(n => `${n.nodeId}: ${n.state}`) });
  if (mode === 'HISTORICAL_SNAPSHOT' && current)
    throw new ApiError(422, 'EVIDENCE_MODE_INVALID', 'The revision is the project\'s current revision; a historical snapshot needs a superseded revision');
  const [report, source] = await Promise.all([assessRevision(repository, projectId, revisionId, request), documentSource(repository, projectId, revisionId, false)]);
  const documents = documentsManifest(source);
  // Separate reads: the documents' current-revision read must agree with the graph's, or the package would mix two states.
  if (documents.freshness.projectCurrentRevisionId !== graph.inputIdentity.projectCurrentRevisionId)
    throw new ApiError(409, 'EVIDENCE_READ_INCONSISTENT', 'The project changed while the package was assembled; retry');
  const { generatedAt: _readTime, ...assessment } = report;
  void _readTime;
  // The assessment counts this revision's analyses through its own reads; they must agree with the graph's nodes.
  const counted = new Set(['STRUCTURAL_ANALYSIS', 'BUILDING_SYSTEMS_ANALYSIS', 'SPECIALIZED_KNOWLEDGE']);
  for (const s of assessment.domains.flatMap(d => d.relatedServices))
    if (counted.has(s.serviceId) && s.artifactsForRevision !== null && s.artifactsForRevision !== graph.nodes.filter(n => n.family === s.serviceId).length)
      throw new ApiError(409, 'EVIDENCE_READ_INCONSISTENT', 'An analysis was committed while the package was assembled; retry');
  if (assessment.modelHash !== graph.inputIdentity.modelHash || documents.binding.modelHash !== graph.inputIdentity.modelHash)
    throw new ApiError(422, 'EVIDENCE_SOURCE_UNVERIFIED', 'The sources disagree on the revision model hash; no package is created');
  const binding = { projectId, revisionId, revisionNumber: documents.binding.revisionNumber, modelHash: graph.inputIdentity.modelHash,
    acceptanceQaId: documents.binding.acceptanceQaId, qaStatus: documents.binding.qaStatus };
  const evidenceIndex = {
    sourceInputs: [
      { kind: 'REVISION_MODEL' as const, id: revisionId, hash: binding.modelHash, provenance: 'STORED_REVISION_RECOMPUTED' as const,
        detail: 'Model hash recomputed from the stored, immutable revision model' },
      { kind: 'ACCEPTANCE_QA' as const, id: binding.acceptanceQaId, hash: null, provenance: 'STORED_QA_RUN' as const, detail: `Acceptance QA status ${binding.qaStatus}` },
      { kind: 'ASSESSMENT_REQUEST' as const, id: null, hash: assessment.inputHash, provenance: 'USER_DECLARED_NOT_VERIFIED' as const,
        detail: `Assessment request and context as declared; ${assessment.evidence.length} declared evidence reference(s), contents not interpreted` },
    ],
    modelDerivedDocuments: documents.documents.map(d => ({ documentId: d.documentId, status: d.status, contentHash: d.contentHash })),
    computedArtifacts: graph.nodes.filter(n => n.family in ARTIFACT_KINDS)
      .map(n => ({ nodeId: n.nodeId, family: n.family, artifactId: n.artifactId, state: n.state, kind: ARTIFACT_KINDS[n.family as keyof typeof ARTIFACT_KINDS] })),
    // Copied from the assessment; nothing here upgrades a status, an assurance level or an evidence class.
    assessmentDomains: assessment.domains.map(d => ({ domain: d.domain, assuranceLevel: d.assuranceLevel, status: d.status, evidenceClass: d.evidenceClass,
      blockerKinds: d.blockers.map(b => b.kind) })),
  };
  const createdAs = mode, version = EVIDENCE_PACKAGE_VERSION;
  const inputHash = costHash({ version, createdAs, revisionId, modelHash: binding.modelHash, graphHash: graph.graphHash, assessmentInputHash: assessment.inputHash,
    assessmentResultHash: assessment.resultHash, manifestHash: documents.manifestHash });
  const body = { version, createdAs, binding, dependencyGraph: graph, assessment, documents, evidenceIndex,
    professionalReview: { status: 'NOT_RECORDED' as const, note: NOT_RECORDED_NOTE }, claims: { ...EVIDENCE_CLAIMS }, inputHash };
  return EvidencePackageSchema.parse({ ...body, contentHash: costHash(body) });
}

const currency = (revisionId: string, projectCurrentRevisionId: string | null) =>
  ({ status: revisionId === projectCurrentRevisionId ? 'CURRENT' as const : 'HISTORICAL' as const, packageRevisionId: revisionId, projectCurrentRevisionId });

export async function createEvidencePackage(repository: Repository, userId: string, projectId: string, revisionId: string, mode: EvidencePackage['createdAs'],
  request: AssessmentRequest, secret?: string) {
  if (!secret) throw new ApiError(503, 'EVIDENCE_UNAVAILABLE', 'Evidence persistence is not configured');
  const pkg = await buildEvidencePackage(repository, projectId, revisionId, mode, request);
  const input = { projectId, projectRevisionId: revisionId, package: pkg };
  const stored = await new EvidenceRepository(repository).write(input, signProjectCommit(secret, userId, EVIDENCE_ROOT, input));
  return { ...stored.summary, package: stored.package, currency: currency(revisionId, stored.projectCurrentRevisionId) };
}
export async function readEvidencePackage(repository: Repository, projectId: string, revisionId: string, packageId: string, requireCurrent: boolean) {
  const stored = await new EvidenceRepository(repository).read(projectId, revisionId, packageId);
  if (stored.summary.projectRevisionId !== revisionId) throw new ApiError(404, 'EVIDENCE_PACKAGE_NOT_FOUND', 'Evidence package not found');
  const c = currency(revisionId, stored.projectCurrentRevisionId);
  if (requireCurrent && c.status !== 'CURRENT') throw new ApiError(409, 'EVIDENCE_SOURCE_STALE', 'The evidence package belongs to a superseded revision');
  return { ...stored.summary, package: stored.package, currency: c };
}
export async function listEvidencePackages(repository: Repository, projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
  const { items, nextCursor, projectCurrentRevisionId } = await new EvidenceRepository(repository).list(projectId, revisionId, query);
  return { items: items.map(i => ({ ...i, currency: currency(i.projectRevisionId, projectCurrentRevisionId) })), nextCursor };
}
