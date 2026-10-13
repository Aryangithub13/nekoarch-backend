import { z } from 'zod';
import { RevisionParamsSchema } from './projects.js';
import { DependencyGraphSchema } from './dependency-graph.js';
import { DocumentsManifestSchema } from './documents.js';
import { AssessmentReportSchema, AssessmentRequestSchema } from '../engineering/contracts.js';

/**
 * Phase 38: an immutable record of one revision's verified provenance (Phase 37 graph), its engineering assessment (Phase 35, flags verbatim)
 * and its construction-document manifest. Provenance only: software never records a professional review, and nothing is claimed.
 */
export const EVIDENCE_PACKAGE_VERSION = 'engineering-evidence-package-v1';
export const EVIDENCE_MODES = ['CURRENT_REVISION', 'HISTORICAL_SNAPSHOT'] as const;
const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);

export const EvidenceCreateRequestSchema = z.object({
  mode: z.enum(EVIDENCE_MODES).default('CURRENT_REVISION'),
  assessment: AssessmentRequestSchema.default({}),
}).strict();
export const EvidenceParamsSchema = RevisionParamsSchema.extend({ packageId: id }).strict();
export const EvidenceReadQuerySchema = z.object({ require: z.literal('current').optional() }).strict();
export const EvidencePageQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().max(500).optional() }).strict();

export const ARTIFACT_KINDS = { QUANTITY_TAKEOFF: 'DETERMINISTIC_ENGINE', CONSTRUCTION_CALCULATION: 'DETERMINISTIC_ENGINE', BOQ_COST: 'DETERMINISTIC_ENGINE',
  SCENE_3D: 'DETERMINISTIC_ENGINE', DESIGN_OPTIMIZATION: 'DETERMINISTIC_ENGINE', STRUCTURAL_ANALYSIS: 'SOLVER_OR_CALCULATOR', ENVIRONMENTAL_ANALYSIS: 'SOLVER_OR_CALCULATOR',
  BUILDING_SYSTEMS_ANALYSIS: 'SOLVER_OR_CALCULATOR', SPECIALIZED_KNOWLEDGE: 'RULE_EVALUATION' } as const;
export const EVIDENCE_CLAIMS = Object.freeze({ engineeringCorrectness: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', structuralAdequacy: 'NOT_CLAIMED',
  permitReadiness: 'NOT_CLAIMED', constructionReadiness: 'NOT_CLAIMED', professionalCertification: 'NOT_CLAIMED' } as const);

const notClaimed = z.literal('NOT_CLAIMED');
export const EvidencePackageSchema = z.object({
  version: z.literal(EVIDENCE_PACKAGE_VERSION), createdAs: z.enum(EVIDENCE_MODES),
  binding: z.object({ projectId: id, revisionId: id, revisionNumber: z.number().int().positive(), modelHash: hash, acceptanceQaId: id,
    qaStatus: z.enum(['PASS', 'PASS_WITH_WARNINGS']) }).strict(),
  dependencyGraph: DependencyGraphSchema,
  assessment: AssessmentReportSchema.omit({ generatedAt: true }),
  documents: DocumentsManifestSchema,
  evidenceIndex: z.object({
    sourceInputs: z.array(z.object({ kind: z.enum(['REVISION_MODEL', 'ACCEPTANCE_QA', 'ASSESSMENT_REQUEST']), id: z.string().nullable(), hash: hash.nullable(),
      provenance: z.enum(['STORED_REVISION_RECOMPUTED', 'STORED_QA_RUN', 'USER_DECLARED_NOT_VERIFIED']), detail: z.string().max(300) }).strict()),
    modelDerivedDocuments: z.array(z.object({ documentId: z.string(), status: z.enum(['COMPLETE', 'INCOMPLETE', 'UNAVAILABLE']), contentHash: hash.nullable() }).strict()),
    computedArtifacts: z.array(z.object({ nodeId: z.string(), family: z.string(), artifactId: id, state: z.string(),
      kind: z.enum(['DETERMINISTIC_ENGINE', 'SOLVER_OR_CALCULATOR', 'RULE_EVALUATION']) }).strict()),
    assessmentDomains: z.array(z.object({ domain: z.string(), assuranceLevel: z.string(), status: z.string(), evidenceClass: z.string().nullable(),
      blockerKinds: z.array(z.string()) }).strict()),
  }).strict(),
  professionalReview: z.object({ status: z.literal('NOT_RECORDED'), note: z.string().max(300) }).strict(),
  claims: z.object({ engineeringCorrectness: notClaimed, codeCompliance: notClaimed, structuralAdequacy: notClaimed, permitReadiness: notClaimed,
    constructionReadiness: notClaimed, professionalCertification: notClaimed }).strict(),
  inputHash: hash, contentHash: hash,
}).strict();
export const EvidenceSummarySchema = z.object({ id, projectRevisionId: id, acceptanceQaId: id, packageVersion: z.literal(EVIDENCE_PACKAGE_VERSION),
  createdAs: z.enum(EVIDENCE_MODES), modelHash: hash, inputHash: hash, contentHash: hash, graphHash: hash, assessmentResultHash: hash, manifestHash: hash,
  nodeCount: z.number().int().min(2).max(128), createdAt: z.string() }).strict();
export const EvidenceCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id }).strict();
export const CurrencySchema = z.object({ status: z.enum(['CURRENT', 'HISTORICAL']), packageRevisionId: id, projectCurrentRevisionId: id.nullable() }).strict();
export const EvidenceDetailSchema = EvidenceSummarySchema.extend({ package: EvidencePackageSchema, currency: CurrencySchema }).strict();
export const EvidenceListSchema = z.object({ items: z.array(EvidenceSummarySchema.extend({ currency: CurrencySchema }).strict()).max(100), nextCursor: z.string().nullable() }).strict();
export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;
