import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ErrorCatalog } from './error-catalog.js';
import { z, type ZodTypeAny } from 'zod';
import { ignoreOverride, zodToJsonSchema, type Options } from 'zod-to-json-schema';
import { ArchitecturalBuildingModelV2Schema, ApiErrorResponseSchema, CreatePlanRequestSchema, CreatePlanResponseSchema, EstimateInputsSchema, EstimateResponseSchema, GetPlanResponseSchema,
  PatchPlanRequestSchema, PatchPlanResponseSchema, RegionsResponseSchema } from '@designflow/shared';
import { SelectedBlueprintRequirementsSchema } from '@designflow/generator';
import { BlueprintQaReportSchema } from '@designflow/blueprint-qa';
import { GeneratePlanRequestSchema } from '../apps/api/src/contracts/generation.js';
import { CreateProjectRequestSchema, GenerateRevisionRequestSchema, PageQuerySchema, ProjectDetailSchema, ProjectListSchema, ProjectRevisionDetailSchema,
  PublicProjectSchema, RevisionCommitResponseSchema, RevisionListSchema, SaveRevisionRequestSchema, UpdateProjectRequestSchema } from '../apps/api/src/contracts/projects.js';
import { ProjectReadQuerySchema } from '../apps/api/src/contracts/freshness.js';
import { NaturalLanguageDesignRequestSchema, InterpretationResultSchema } from '../apps/api/src/contracts/requirement-interpretation.js';
import { ConversationListSchema, ConversationMessageSchema, ConversationPageSchema, ConversationSchema, ConversationToolResponseSchema, ConversationToolSchema,
  CreateConversationSchema, ProposalApprovalSchema } from '../apps/api/src/contracts/conversations.js';
import { ActionDecisionResponseSchema, ActionDecisionSchema, ConversationContextSchema, RebaseRequestSchema, RebaseResponseSchema, TurnRequestSchema,
  TurnResponseSchema } from '../apps/api/src/contracts/conversation-turns.js';
import { TakeoffDetailSchema, TakeoffListSchema, TakeoffRequestSchema } from '../apps/api/src/contracts/takeoffs.js';
import { ConstructionDetailSchema, ConstructionListSchema, ConstructionRequestSchema } from '../apps/api/src/contracts/construction.js';
import { CostDetailSchema, CostListSchema, CostRequestSchema } from '../apps/api/src/contracts/costs.js';
import { WorkflowPlanSchema, WorkflowRequestSchema, WorkflowRunSchema } from '../apps/api/src/contracts/workflows.js';
import { StructuralDetailSchema, StructuralInputSchema, StructuralReadQuerySchema } from '../apps/api/src/structural/contracts.js';
import { EnvironmentalDetailSchema, EnvironmentalInputSchema, EnvironmentalReadQuerySchema } from '../apps/api/src/environmental/contracts.js';
import { SystemsDetailSchema, SystemsInputSchema, SystemsReadQuerySchema } from '../apps/api/src/systems/contracts.js';
import { KnowledgeDetailSchema, KnowledgeInputSchema, KnowledgeReadQuerySchema } from '../apps/api/src/knowledge/contracts.js';
import { OptimizationDetailSchema, OptimizationInputSchema, OptimizationReadQuerySchema } from '../apps/api/src/optimization/contracts.js';
import { SceneInputSchema, SceneManifestSchema } from '../apps/api/src/scene3d/contracts.js';
import { SceneDetailSchema, SceneSummarySchema } from '../apps/api/src/lib/scene-repository.js';
import { BimKindSchema, RelationshipSchema } from '../apps/api/src/bim/contracts.js';
import { ApproveRequestSchema, EmptySchema, ExecuteRequestSchema, PreflightRequestSchema, RevisionComparisonSchema } from '../apps/api/src/revision/contracts.js';
import { AppearanceResponseSchema, CandidateManifestResponseSchema, OperationDetailSchema, OperationListSchema, ValidationEvidenceSchema } from '../apps/api/src/lib/revision-repository.js';
import { DownloadLinkRequestSchema, DownloadLinkSchema, DownloadTokenSchema, REFERENCE_MEDIA_TYPES, ReferenceDetailSchema, ReferenceListQuerySchema, ReferenceListSchema, ReferenceUpdateSchema,
  ReferenceUploadQuerySchema, ReferenceUsageSchema, ValidateResponseSchema } from '../apps/api/src/references/contracts.js';
import { DiffReportSchema, DiffRequestSchema, VerificationReportSchema, VerificationRequestSchema } from '../apps/api/src/verification/contracts.js';
import { AssessmentReportSchema, AssessmentRequestSchema } from '../apps/api/src/engineering/contracts.js';
import { ZoneAssessmentReportSchema, ZoneAssessmentRequestSchema, ZonePreflightReportSchema, ZonePreflightRequestSchema } from '../apps/api/src/engineering/zone-contracts.js';
import { RegenerationReportSchema, RegenerationRequestSchema, RegenerationVerificationReportSchema } from '../apps/api/src/engineering/regeneration-contracts.js';
import { PartitionReportSchema, PartitionRequestSchema } from '../apps/api/src/engineering/partition-contracts.js';
import { AccountUsageSchema, BriefCreateSchema, BriefCurrentSchema, BriefListSchema, BriefVersionParamsSchema, BriefVersionSchema, ContextBundleSchema, EmptyQuerySchema, LibraryEntrySchema,
  LibraryListSchema, LibraryPatchSchema, LibraryQuerySchema, SettingsDocumentSchema, SettingsPatchSchema } from '../apps/api/src/account/contracts.js';
import { ComputeJobSchema, ComputeQuoteSchema, QuoteRequestSchema, SubmitRequestSchema, SubmitResponseSchema } from '../apps/api/src/compute/contracts.js';
import { DependencyGraphSchema } from '../apps/api/src/contracts/dependency-graph.js';
import { ManifestQuerySchema, ProjectManifestSchema } from '../apps/api/src/contracts/project-manifest.js';
import { SpecialistParamsSchema, SpecialistRequestSchema, SpecialistResultSchema } from '../apps/api/src/contracts/specialists.js';
import { InstructionRequestSchema, InstructionResolutionSchema } from '../apps/api/src/instructions/contracts.js';
import { FeasibilityAssessmentSchema, FeasibilityRequestSchema } from '../apps/api/src/feasibility/contracts.js';
import { CapabilityRegistrySchema, RoutingDecisionSchema, RoutingRequestSchema } from '../apps/api/src/routing/contracts.js';
import { COMPATIBILITY_VERSION, CompatibilitySchema, DeliveryManifestSchema, DeliveryQuerySchema } from '../apps/api/src/delivery/contracts.js';
import { CommentRequestSchema, CommentSchema, MemberRequestSchema, MemberSchema, ReviewRequestSchema, ReviewSchema, RevisionCollaborationSchema, WorkspaceResponseSchema }
  from '../apps/api/src/collaboration/contracts.js';
import { ChangeSetSchema, ExecuteRequestSchema as IntegrationExecuteSchema, IntegrationExecutionSchema, IntegrationPlanSchema } from '../apps/api/src/contracts/integration.js';
import { DocumentsManifestSchema, DocumentsQuerySchema, PlanSheetParamsSchema, ScheduleParamsSchema, SchedulesResponseSchema } from '../apps/api/src/contracts/documents.js';
import { BimElementParamsSchema } from '../apps/api/src/routes/bim.js';
import { EvidenceCreateRequestSchema, EvidenceDetailSchema, EvidenceListSchema, EvidencePageQuerySchema, EvidenceReadQuerySchema } from '../apps/api/src/contracts/evidence.js';
import { DesignConceptDetailSchema, DesignConceptListSchema, DesignConceptPageQuerySchema, DesignConceptReadQuerySchema, DesignConceptRequestSchema } from '../apps/api/src/contracts/design-concepts.js';
import { EmptyBodySchema as JobEmpty, JobDetailSchema, JobEventListSchema, JobEventsQuerySchema, JobListQuerySchema, JobListSchema, JobRequestSchema } from '../apps/api/src/jobs/contracts.js';

/** Route → the Zod schemas its handler parses (request) or returns (response). `null` response = JSON whose schema is not exported yet.
 * `alternatives`: other success statuses the handler can return (INT-B-007), with the same response schema unless `body` is false. */
type Alternative = { status: number; description: string; body?: false };
/** `auth`: a session is required although the anonymous probe cannot see it (INT-B-006): these Phase 5 routes validate the body before they
 * authenticate (R06-F1, accepted), so an anonymous empty body gets 400. modernization.test.ts proves the 401 with a valid body. */
type Op = { body?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny | null; status?: number; media?: string; rawBody?: readonly string[]; alternatives?: readonly Alternative[];
  auth?: true };
/** The generated error-code catalog (INT-B-012); regenerated with docs/modernization/openapi.json. */
export const ERROR_CODES = new URL('../docs/modernization/error-codes.json', import.meta.url);
/** Path parameters that are not UUIDs, taken from the routes' own *ParamsSchema (INT-B-005); every other path parameter is a UUID. */
export const PATH_PARAMS: Record<string, ZodTypeAny> = { elementId: BimElementParamsSchema.shape.elementId, version: BriefVersionParamsSchema.shape.version,
  module: SpecialistParamsSchema.shape.module, levelId: PlanSheetParamsSchema.shape.levelId, schedule: ScheduleParamsSchema.shape.schedule };
const replay = (description: string): readonly Alternative[] => [{ status: 200, description }];
const P = '/api/projects/:projectId', R = `${P}/revisions/:revisionId`, T = `${R}/takeoffs`, C = `${T}/:takeoffId/construction-calculations`, V = `${P}/conversations/:conversationId`;
const empty = z.object({}).strict(), current = z.object({ require: z.literal('current').optional() }).strict();
const bimPage = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), after: z.string().regex(/^bim-[a-f0-9]{40}$/).optional(), kind: BimKindSchema.optional() }).strict();
const analyses = (root: string, input: ZodTypeAny, detail: ZodTypeAny, read: ZodTypeAny): Record<string, Op> => ({
  [`POST ${R}/${root}/validate`]: { body: input, response: null }, [`POST ${R}/${root}/analyses`]: { body: input, response: detail, status: 201 },
  [`GET ${R}/${root}/analyses`]: { query: PageQuerySchema, response: null }, [`GET ${R}/${root}/analyses/:analysisId`]: { query: read, response: detail },
  [`GET ${R}/${root}/status`]: { query: empty, response: null } });
export const CONTRACTS: Record<string, Op> = {
  'GET /health/live': { response: z.object({ status: z.literal('ok') }) }, 'GET /health/ready': { response: z.object({ status: z.enum(['ok', 'unavailable']) }) },
  // INT-B-028: HEAD health checks answer like GET without a body.
  'HEAD /health/live': {}, 'HEAD /health/ready': {},
  'GET /api/capabilities': { response: null }, 'GET /api/regions': { response: RegionsResponseSchema },
  'POST /api/estimates': { body: EstimateInputsSchema, response: EstimateResponseSchema, auth: true },
  'POST /api/plans': { body: CreatePlanRequestSchema, response: CreatePlanResponseSchema, status: 201, auth: true },
  'POST /api/plans/generate': { body: GeneratePlanRequestSchema, response: CreatePlanResponseSchema, status: 201, auth: true },
  'GET /api/plans/:id': { response: GetPlanResponseSchema }, 'PATCH /api/plans/:id': { body: PatchPlanRequestSchema, response: PatchPlanResponseSchema, auth: true },
  'POST /api/projects': { body: CreateProjectRequestSchema, response: ProjectDetailSchema, status: 201 }, 'GET /api/projects': { query: PageQuerySchema, response: ProjectListSchema },
  [`GET ${P}`]: { query: ProjectReadQuerySchema, response: ProjectDetailSchema }, [`PATCH ${P}`]: { body: UpdateProjectRequestSchema, response: ProjectDetailSchema },
  [`GET ${P}/public`]: { response: PublicProjectSchema },
  [`POST ${P}/requirements/interpret`]: { body: NaturalLanguageDesignRequestSchema, response: InterpretationResultSchema },
  [`GET ${P}/revisions`]: { query: PageQuerySchema, response: RevisionListSchema },
  [`POST ${P}/revisions`]: { body: SaveRevisionRequestSchema, response: RevisionCommitResponseSchema, status: 201 },
  [`POST ${P}/revisions/generate`]: { body: GenerateRevisionRequestSchema, response: RevisionCommitResponseSchema, status: 201 },
  [`GET ${R}`]: { response: ProjectRevisionDetailSchema }, [`GET ${R}/overview`]: { query: empty, response: null },
  [`GET ${R}/dependency-graph`]: { query: empty, response: DependencyGraphSchema },
  [`GET ${R}/manifest`]: { query: ManifestQuerySchema, response: ProjectManifestSchema },
  [`GET ${R}/documents`]: { query: DocumentsQuerySchema, response: DocumentsManifestSchema },
  [`GET ${R}/documents/plan-sheets/:levelId`]: { query: DocumentsQuerySchema, media: 'image/svg+xml' },
  [`GET ${R}/documents/schedules`]: { query: DocumentsQuerySchema, response: SchedulesResponseSchema },
  [`GET ${R}/documents/schedules/:schedule/csv`]: { query: DocumentsQuerySchema, media: 'text/csv' },
  [`POST ${R}/evidence-packages`]: { body: EvidenceCreateRequestSchema, response: EvidenceDetailSchema, status: 201 },
  [`GET ${R}/evidence-packages`]: { query: EvidencePageQuerySchema, response: EvidenceListSchema },
  [`GET ${R}/evidence-packages/:packageId`]: { query: EvidenceReadQuerySchema, response: EvidenceDetailSchema },
  // Phase 39: 201 for a new set; an identical request replays the stored set with 200 (`replayed: true`).
  [`POST ${R}/design-concepts`]: { body: DesignConceptRequestSchema, response: DesignConceptDetailSchema, status: 201, alternatives: replay('An identical request replays the stored set (`replayed: true`)') },
  [`GET ${R}/design-concepts`]: { query: DesignConceptPageQuerySchema, response: DesignConceptListSchema },
  [`GET ${R}/design-concepts/:conceptSetId`]: { query: DesignConceptReadQuerySchema, response: DesignConceptDetailSchema },
  [`POST ${P}/workflows/plan`]: { body: WorkflowRequestSchema, response: z.object({ projectId: z.string().uuid(), sourceRevisionId: z.string().uuid().nullable(), inputFingerprint: z.string(), plan: WorkflowPlanSchema }).strict() },
  [`POST ${P}/workflows`]: { body: WorkflowRequestSchema, response: WorkflowRunSchema, status: 201 }, [`GET ${P}/workflows`]: { query: PageQuerySchema, response: null },
  [`GET ${P}/workflows/:workflowRunId`]: { response: WorkflowRunSchema },
  [`POST ${P}/conversations`]: { body: CreateConversationSchema, response: ConversationSchema }, [`GET ${P}/conversations`]: { query: ConversationPageSchema, response: ConversationListSchema },
  [`GET ${V}`]: { response: ConversationSchema }, [`DELETE ${V}`]: { response: z.object({ deleted: z.literal(true) }).strict() },
  [`POST ${V}/messages`]: { body: ConversationMessageSchema, response: ConversationSchema }, [`POST ${V}/proposals/approve`]: { body: ProposalApprovalSchema, response: RevisionCommitResponseSchema },
  [`POST ${V}/tools`]: { body: ConversationToolSchema, response: ConversationToolResponseSchema },
  // Phase 36: conversational turns, coordinated action decisions, rebase and the bounded context document.
  [`POST ${V}/turns`]: { body: TurnRequestSchema, response: TurnResponseSchema }, [`POST ${V}/actions/:actionId/decisions`]: { body: ActionDecisionSchema, response: ActionDecisionResponseSchema },
  [`POST ${V}/rebase`]: { body: RebaseRequestSchema, response: RebaseResponseSchema }, [`GET ${V}/context`]: { query: empty, response: ConversationContextSchema },
  [`POST ${T}`]: { body: TakeoffRequestSchema, response: TakeoffDetailSchema, status: 201 }, [`GET ${T}`]: { query: PageQuerySchema, response: TakeoffListSchema },
  [`GET ${T}/:takeoffId`]: { response: TakeoffDetailSchema },
  [`POST ${C}`]: { body: ConstructionRequestSchema, response: ConstructionDetailSchema, status: 201 }, [`GET ${C}`]: { query: PageQuerySchema, response: ConstructionListSchema },
  [`GET ${C}/:calculationId`]: { response: ConstructionDetailSchema },
  [`POST ${C}/:calculationId/cost-estimates`]: { body: CostRequestSchema, response: CostDetailSchema, status: 201 },
  [`GET ${R}/cost-estimates`]: { query: PageQuerySchema, response: CostListSchema }, [`GET ${R}/cost-estimates/:costEstimateId`]: { response: CostDetailSchema },
  ...Object.fromEntries(['', '/validation', '/export.json'].map(v => [`GET ${R}/bim${v}`, { query: empty, response: null }])),
  [`GET ${R}/bim/export.ifc`]: { query: empty, media: 'application/x-step' },
  [`GET ${R}/bim/elements`]: { query: bimPage, response: null }, [`GET ${R}/bim/relationships`]: { query: bimPage.extend({ kind: RelationshipSchema.shape.kind.optional() }), response: null },
  [`GET ${R}/bim/elements/:elementId`]: { query: empty, response: null }, [`GET ${R}/bim/diff/:otherRevisionId`]: { query: empty, response: null },
  ...analyses('structural', StructuralInputSchema, StructuralDetailSchema, StructuralReadQuerySchema),
  ...analyses('environmental', EnvironmentalInputSchema, EnvironmentalDetailSchema, EnvironmentalReadQuerySchema),
  ...analyses('systems', SystemsInputSchema, SystemsDetailSchema, SystemsReadQuerySchema),
  ...analyses('knowledge', KnowledgeInputSchema, KnowledgeDetailSchema, KnowledgeReadQuerySchema), [`GET ${R}/knowledge/packs`]: { query: empty, response: null },
  [`POST ${R}/optimization/validate`]: { body: OptimizationInputSchema, response: null }, [`POST ${R}/optimization/studies`]: { body: OptimizationInputSchema, response: OptimizationDetailSchema, status: 201 },
  [`GET ${R}/optimization/studies`]: { query: PageQuerySchema, response: null }, [`GET ${R}/optimization/studies/:studyId`]: { query: OptimizationReadQuerySchema, response: OptimizationDetailSchema },
  [`GET ${R}/optimization/status`]: { query: empty, response: null },
  [`POST ${R}/scene/validate`]: { body: SceneInputSchema, response: null }, [`POST ${R}/scene/artifacts`]: { body: SceneInputSchema, response: SceneDetailSchema, status: 201 },
  [`GET ${R}/scene/artifacts`]: { query: PageQuerySchema, response: null }, [`GET ${R}/scene/artifacts/:artifactId`]: { query: current, response: SceneSummarySchema.extend({ currency: z.unknown() }) },
  [`GET ${R}/scene/artifacts/:artifactId/manifest`]: { query: current, response: z.object({ artifactId: z.string().uuid(), sceneHash: z.string(), currency: z.unknown(), manifest: SceneManifestSchema }).strict() },
  [`GET ${R}/scene/artifacts/:artifactId/glb`]: { query: current, media: 'model/gltf-binary' }, [`GET ${R}/scene/status`]: { query: empty, response: null },
  // Phase 30 selective revision.
  [`POST ${P}/revision-operations`]: { body: PreflightRequestSchema, response: OperationDetailSchema, status: 201 },
  [`GET ${P}/revision-operations`]: { query: PageQuerySchema, response: OperationListSchema },
  [`GET ${P}/revision-operations/:operationId`]: { query: EmptySchema, response: OperationDetailSchema },
  [`POST ${P}/revision-operations/:operationId/execute`]: { body: ExecuteRequestSchema, response: OperationDetailSchema },
  [`POST ${P}/revision-operations/:operationId/approve`]: { body: ApproveRequestSchema, response: z.object({ operation: OperationDetailSchema, commit: RevisionCommitResponseSchema }).strict(), status: 201 },
  [`POST ${P}/revision-operations/:operationId/reject`]: { body: EmptySchema, response: OperationDetailSchema },
  [`POST ${P}/revision-operations/:operationId/cancel`]: { body: EmptySchema, response: OperationDetailSchema },
  [`GET ${P}/revision-operations/:operationId/comparison`]: { query: EmptySchema, response: RevisionComparisonSchema },
  [`GET ${P}/revision-operations/:operationId/validation`]: { query: EmptySchema, response: ValidationEvidenceSchema },
  [`GET ${P}/revision-operations/:operationId/candidate/manifest`]: { query: EmptySchema, response: CandidateManifestResponseSchema },
  [`GET ${P}/revision-operations/:operationId/candidate/glb`]: { query: EmptySchema, media: 'model/gltf-binary' },
  [`GET ${R}/appearance`]: { query: EmptySchema, response: AppearanceResponseSchema },
  [`GET ${R}/appearance/glb`]: { query: EmptySchema, media: 'model/gltf-binary' },
  // B39 S1: 201 when the request stored a revision or artifact; a typed refusal or a replay is 200 with the same schema.
  [`POST ${P}/specialists/:module/requests`]: { body: SpecialistRequestSchema, response: SpecialistResultSchema, status: 201, alternatives: replay('A typed refusal (written: false; nothing stored), or a replay of an earlier request (replayed: true). 201 means this request stored something, even with status FAILED') },
  // B40 S1: a plan preview stores nothing (200); an execution that wrote anything is 201, a refusal 200 with the same schema.
  [`POST ${P}/integration/plans`]: { body: ChangeSetSchema, response: IntegrationPlanSchema, status: 200 },
  [`POST ${P}/integration/plans/execute`]: { body: IntegrationExecuteSchema, response: IntegrationExecutionSchema, status: 201, alternatives: replay('No task completed: nothing was written and the base revision is unchanged. A 201 can still have status FAILED; committedRevisionId says whether a revision was committed') },
  // B41 S1: deterministic instruction resolution (read only).
  [`POST ${R}/instructions/resolve`]: { body: InstructionRequestSchema, response: InstructionResolutionSchema },
  // B42 S1: feasibility assessment of a declared ambition (read only).
  [`POST ${P}/feasibility/assessments`]: { body: FeasibilityRequestSchema, response: FeasibilityAssessmentSchema },
  // B43 S1: capability registry and routing dry run (no provider call).
  ['GET /api/routing/capabilities']: { query: empty, response: CapabilityRegistrySchema },
  [`POST ${P}/routing/decisions`]: { body: RoutingRequestSchema, response: RoutingDecisionSchema },
  // B44 S1: collaboration (members, comments, reviews, audit).
  [`GET ${P}/collaboration`]: { query: empty, response: WorkspaceResponseSchema },
  [`POST ${P}/collaboration/members`]: { body: MemberRequestSchema, response: MemberSchema, status: 201 },
  [`DELETE ${P}/collaboration/members/:userId`]: { response: z.object({ userId: z.string().uuid(), removed: z.literal(true) }).strict() },
  [`GET ${P}/collaboration/revisions/:revisionId`]: { query: empty, response: RevisionCollaborationSchema },
  [`POST ${P}/collaboration/revisions/:revisionId/comments`]: { body: CommentRequestSchema, response: CommentSchema, status: 201 },
  [`POST ${P}/collaboration/revisions/:revisionId/reviews`]: { body: ReviewRequestSchema, response: ReviewSchema, status: 201 },
  // B45 S1: scene delivery manifest (ETag; 304 on If-None-Match) and the compatibility package.
  [`GET ${R}/scene/delivery`]: { query: DeliveryQuerySchema, response: DeliveryManifestSchema, alternatives: [{ status: 304, description: 'Not modified (If-None-Match)', body: false }] },
  ['GET /api/compatibility']: { query: empty, response: CompatibilitySchema },
  // Phase 31 reference ingestion: uploads are raw bodies of a supported media type; downloads are the stored bytes.
  [`POST ${P}/references/validate`]: { query: empty, rawBody: REFERENCE_MEDIA_TYPES, response: ValidateResponseSchema },
  [`POST ${P}/references`]: { query: ReferenceUploadQuerySchema, rawBody: REFERENCE_MEDIA_TYPES, response: ReferenceDetailSchema, status: 201,
    alternatives: replay('The same bytes are already stored for this project (`deduplicated: true`)') },
  [`GET ${P}/references`]: { query: ReferenceListQuerySchema, response: ReferenceListSchema }, [`GET ${P}/references/usage`]: { query: empty, response: ReferenceUsageSchema },
  [`GET ${P}/references/:referenceId`]: { query: empty, response: ReferenceDetailSchema }, [`PATCH ${P}/references/:referenceId`]: { body: ReferenceUpdateSchema, response: ReferenceDetailSchema },
  [`DELETE ${P}/references/:referenceId`]: { response: ReferenceDetailSchema }, [`GET ${P}/references/:referenceId/content`]: { query: empty, media: 'application/octet-stream' },
  [`POST ${P}/references/:referenceId/download-links`]: { body: DownloadLinkRequestSchema, response: DownloadLinkSchema, status: 201 },
  'GET /api/reference-downloads': { query: DownloadTokenSchema, media: 'application/octet-stream' },
  // Phase 32 durable jobs.
  // Phase 36: compute gateway (quote → consent → durable job; polling).
  [`POST ${P}/compute/quotes`]: { body: QuoteRequestSchema, response: ComputeQuoteSchema },
  [`POST ${P}/compute/jobs`]: { body: SubmitRequestSchema, response: SubmitResponseSchema, status: 202, alternatives: replay('A replay of an earlier submission (`replayed: true`)') },
  [`GET ${P}/compute/jobs/:jobId`]: { query: JobEmpty, response: ComputeJobSchema },
  [`POST ${P}/jobs`]: { body: JobRequestSchema, response: JobDetailSchema, status: 202, alternatives: replay('An identical active job already exists (`deduplicated: true`)') }, [`GET ${P}/jobs`]: { query: JobListQuerySchema, response: JobListSchema },
  [`GET ${P}/jobs/:jobId`]: { query: JobEmpty, response: JobDetailSchema }, [`GET ${P}/jobs/:jobId/events`]: { query: JobEventsQuerySchema, response: JobEventListSchema },
  [`POST ${P}/jobs/:jobId/cancel`]: { body: JobEmpty, response: JobDetailSchema }, [`POST ${P}/jobs/:jobId/retry`]: { body: JobEmpty, response: JobDetailSchema },
  // Phase 33 account, library, brief and context.
  'GET /api/me/settings': { query: EmptyQuerySchema, response: SettingsDocumentSchema }, 'PATCH /api/me/settings': { body: SettingsPatchSchema, response: SettingsDocumentSchema },
  'GET /api/me/usage': { query: EmptyQuerySchema, response: AccountUsageSchema }, 'GET /api/library/projects': { query: LibraryQuerySchema, response: LibraryListSchema },
  [`PATCH ${P}/library`]: { body: LibraryPatchSchema, response: LibraryEntrySchema }, [`GET ${P}/brief`]: { query: EmptyQuerySchema, response: BriefCurrentSchema },
  [`GET ${P}/brief/versions`]: { query: PageQuerySchema, response: BriefListSchema }, [`POST ${P}/brief/versions`]: { body: BriefCreateSchema, response: BriefVersionSchema, status: 201 },
  [`GET ${P}/brief/versions/:version`]: { query: EmptyQuerySchema, response: BriefVersionSchema }, [`GET ${P}/context`]: { query: EmptyQuerySchema, response: ContextBundleSchema },
  // Phase 34 verification (computed on read).
  [`GET ${R}/verification`]: { query: empty, response: VerificationReportSchema }, [`POST ${R}/verification`]: { body: VerificationRequestSchema, response: VerificationReportSchema },
  [`POST ${R}/verification/diff`]: { body: DiffRequestSchema, response: DiffReportSchema },
  // Phase 35 engineering assessment (computed on read).
  [`GET ${R}/engineering-assessment`]: { query: empty, response: AssessmentReportSchema }, [`POST ${R}/engineering-assessment`]: { body: AssessmentRequestSchema, response: AssessmentReportSchema },
  // Phase 35.1 zone assessment and regeneration preflight (computed on read; the preflight refuses generator-driven regeneration).
  [`GET ${R}/engineering-assessment/zones`]: { query: empty, response: ZoneAssessmentReportSchema },
  [`POST ${R}/engineering-assessment/zones`]: { body: ZoneAssessmentRequestSchema, response: ZoneAssessmentReportSchema },
  [`POST ${R}/engineering-assessment/zones/regeneration-preflight`]: { body: ZonePreflightRequestSchema, response: ZonePreflightReportSchema },
  // Phase 35 deterministic regeneration (candidate only), its verification on a committed revision, and partitioned processing (all computed on read).
  [`POST ${R}/engineering-assessment/zones/regeneration`]: { body: RegenerationRequestSchema, response: RegenerationReportSchema },
  [`POST ${R}/engineering-assessment/zones/regeneration/verification`]: { body: RegenerationRequestSchema, response: RegenerationVerificationReportSchema },
  [`POST ${R}/engineering-assessment/zones/partitions`]: { body: PartitionRequestSchema, response: PartitionReportSchema },
};

/** Draft-07 JSON Schema for one Zod contract (shared by the document and the conformance test). */
export const jsonSchema = (schema: ZodTypeAny, target: 'openApi3' | 'jsonSchema7' = 'openApi3') =>
  zodToJsonSchema(schema, { target, $refStrategy: 'none', effectStrategy: 'input', removeAdditionalStrategy: 'strict' }) as Record<string, unknown>;

/** Large contracts shared by many operations become named components (also the type names a frontend generator sees). */
const SHARED = { BuildingModelV2: ArchitecturalBuildingModelV2Schema, BlueprintRequirements: SelectedBlueprintRequirementsSchema, BlueprintQaReport: BlueprintQaReportSchema,
  ProjectRevisionDetail: ProjectRevisionDetailSchema, ProjectDetail: ProjectDetailSchema, RevisionCommitResponse: RevisionCommitResponseSchema, WorkflowRequest: WorkflowRequestSchema,
  WorkflowPlan: WorkflowPlanSchema, WorkflowRun: WorkflowRunSchema, Conversation: ConversationSchema, SceneManifest: SceneManifestSchema, ApiError: ApiErrorResponseSchema,
  TakeoffDetail: TakeoffDetailSchema, ConstructionDetail: ConstructionDetailSchema, CostDetail: CostDetailSchema, StructuralDetail: StructuralDetailSchema,
  EnvironmentalDetail: EnvironmentalDetailSchema, SystemsDetail: SystemsDetailSchema, KnowledgeDetail: KnowledgeDetailSchema, OptimizationDetail: OptimizationDetailSchema,
  StructuralInput: StructuralInputSchema, EnvironmentalInput: EnvironmentalInputSchema, SystemsInput: SystemsInputSchema, KnowledgeInput: KnowledgeInputSchema, OptimizationInput: OptimizationInputSchema,
  RevisionOperation: OperationDetailSchema, AppearanceManifest: CandidateManifestResponseSchema.shape.manifest };
/**
 * Only the SHARED components are referenced (`#/components/schemas/Name`); any other repeated sub-schema is inlined. The default `root` strategy
 * referenced a repeat by its path from the document root, which assumed the operation's schema sat at `#/components`: it is inlined under `paths`,
 * so 1,007 of 2,754 references on the base branch pointed nowhere (for example `#/components/properties/projectId`).
 */
const COMPONENT_REFS: Partial<Options<'openApi3'>> = { target: 'openApi3', definitions: SHARED, $refStrategy: 'none', basePath: ['#', 'components'], definitionPath: 'schemas',
  effectStrategy: 'input', removeAdditionalStrategy: 'strict',
  override: (_def, refs, seen, forceResolution) => {
    if (!seen || forceResolution) return ignoreOverride;
    if (seen.path[2] === 'schemas' && seen.path.length === 4) return { $ref: seen.path.join('/') };
    // A recursive type (the QA report's arbitrary JSON values) is any JSON value at the point it recurses.
    return seen.path.length < refs.currentPath.length && seen.path.every((part, i) => refs.currentPath[i] === part) ? {} : ignoreOverride;
  } };
const referenced = (schema: ZodTypeAny) => {
  const { schemas: _shared, ...root } = zodToJsonSchema(schema, COMPONENT_REFS) as Record<string, unknown>;
  return root;
};

/** OpenAPI 3.0 has no tuple schema (`items` must be one schema): a Zod tuple becomes `items: { anyOf }`, its length kept by minItems and maxItems. */
function openApi30<T>(node: T): T {
  if (Array.isArray(node)) return node.map(openApi30) as T;
  if (!node || typeof node !== 'object') return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, openApi30(v)])) as Record<string, unknown>;
  if (Array.isArray(out.items)) {
    const members = [...new Map((out.items as unknown[]).map(m => [JSON.stringify(m), m])).values()];
    out.items = members.length === 1 ? members[0] : { anyOf: members };
  }
  return out as T;
}

/** The route-catalog hash `GET /api/compatibility` serves (HEAD is implied by GET), so a client can match this document to a running API. */
export const routeCatalogHash = (routes: { method: string; url: string }[]) =>
  createHash('sha256').update([...new Set(routes.filter(r => r.method !== 'HEAD').map(r => `${r.method} ${r.url}`))].sort().join('\n')).digest('hex');

/** OpenAPI 3.0 document from the live route table plus CONTRACTS; nothing is hand-written per route beyond the schema mapping. */
export function openApiDocument(routes: { method: string; url: string; anonymous: number }[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const { schemas } = zodToJsonSchema(z.object({}), COMPONENT_REFS) as { schemas: Record<string, unknown> };
  for (const r of routes) {
    const op = CONTRACTS[`${r.method} ${r.url}`] ?? {}, path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...r.url.matchAll(/:([A-Za-z]+)/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: jsonSchema(PATH_PARAMS[name!] ?? z.string().uuid()) }));
    const query = op.query ? Object.entries((jsonSchema(op.query).properties ?? {}) as Record<string, unknown>).map(([name, schema]) =>
      ({ name, in: 'query', required: ((jsonSchema(op.query!).required ?? []) as string[]).includes(name), schema })) : []; // query params are small: inline
    const ok = r.method === 'HEAD' ? { description: 'The GET response headers, without a body' }
      : op.media ? { description: 'Binary', content: { [op.media]: { schema: { type: 'string', format: 'binary' } } } }
        : op.response ? { description: 'Success', content: { 'application/json': { schema: referenced(op.response) } } }
          : { description: 'JSON success response; schema not exported yet (see route source)' };
    const alternatives = Object.fromEntries((op.alternatives ?? []).map(a => [String(a.status), a.body === false ? { description: a.description } : { ...ok, description: a.description }]));
    (paths[path] ??= {})[r.method.toLowerCase()] = { operationId: `${r.method.toLowerCase()} ${r.url}`,
      ...(r.anonymous === 401 || op.auth ? { security: [{ bearer: [] }] } : {}), parameters: [...params, ...query],
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: referenced(op.body) } } } } : {}),
      ...(op.rawBody ? { requestBody: { required: true, content: Object.fromEntries(op.rawBody.map(m => [m, { schema: { type: 'string', format: 'binary' } }])) } } : {}),
      responses: { [String(op.status ?? 200)]: ok, ...alternatives, ...(op.media === 'model/gltf-binary' || op.media === 'application/octet-stream' ? { 304: { description: 'Not modified (If-None-Match)' } } : {}),
        default: { description: 'Typed error; error.code is one of components.x-error-codes', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } } } };
  }
  // INT-B-008: the version names the compatibility package and the exact route catalog, as GET /api/compatibility reports them.
  const catalog = routes.filter(r => r.method !== 'HEAD');
  return openApi30({ openapi: '3.0.3', info: { title: 'NekoArch designflow API', version: `${COMPATIBILITY_VERSION}+${catalog.length}.${routeCatalogHash(catalog).slice(0, 12)}` },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Supabase session access token' } }, schemas,
      // INT-B-012: every error code and the statuses it is sent with, from the generated catalog (test-support/error-catalog.ts).
      'x-error-codes': (JSON.parse(readFileSync(ERROR_CODES, 'utf8')) as ErrorCatalog).codes.map(({ code, statuses }) => ({ code, statuses })) }, paths });
}

type JsonSchemaNode = { $ref?: string; type?: string; enum?: unknown[]; items?: JsonSchemaNode; anyOf?: JsonSchemaNode[]; oneOf?: JsonSchemaNode[]; allOf?: JsonSchemaNode[];
  properties?: Record<string, JsonSchemaNode>; required?: string[]; nullable?: boolean; format?: string; description?: string; additionalProperties?: unknown };
/** A short type label for the reference: `Name` for a component, `string (uuid)`, `'A' | 'B'`, `T[]`, `object`. */
function typeLabel(s: JsonSchemaNode | undefined): string {
  if (!s) return 'any';
  const base = s.$ref ? s.$ref.split('/').pop()!
    : s.enum ? (s.enum.length > 6 ? `${s.enum.slice(0, 6).map(v => JSON.stringify(v)).join(' \\| ')} \\| …` : s.enum.map(v => JSON.stringify(v)).join(' \\| '))
      : s.anyOf ?? s.oneOf ? (s.anyOf ?? s.oneOf)!.map(typeLabel).join(' \\| ')
        : s.allOf ? typeLabel(s.allOf[s.allOf.length - 1]) // zod-to-json-schema's allOf is a refinement chain of one type
        : s.type === 'array' ? `${typeLabel(s.items)}[]`
          : s.type ? `${s.type}${s.format ? ` (${s.format})` : ''}` : 'any';
  return s.nullable ? `${base} \\| null` : base;
}
const fieldRows = (s: JsonSchemaNode | undefined) => Object.entries(s?.properties ?? {}).map(([name, p]) =>
  `| \`${name}\` | ${typeLabel(p)} | ${(s!.required ?? []).includes(name) ? 'yes' : ''} | ${(p.description ?? '').replace(/\|/g, '\\|')} |`);

/**
 * INT-B-027: the API reference (docs/modernization/api-reference.md), rendered from the same OpenAPI document, so every route has one,
 * including the phases that had no hand-written API document (B37, B38, B40–B46). Top-level fields only; the full schemas are in openapi.json.
 */
export function apiReference(doc: ReturnType<typeof openApiDocument>): string {
  const out = ['# API reference (generated)', '',
    `Generated from [openapi.json](openapi.json) (\`${doc.info.version}\`) by \`test-support/openapi.ts\`; regenerate with \`UPDATE_ROUTE_CATALOG=1 npx vitest run apps/api/tests/modernization.test.ts\`. Do not edit.`,
    'Every error is `ApiErrorResponse` (`{ error: { code, message, requestId, fieldErrors? } }`); the codes and their statuses are in [error-codes.json](error-codes.json).',
    'Nested schemas, limits and patterns are in openapi.json. Per-phase behaviour is in the `docs/phase*/…-api.md` documents where they exist.', ''];
  for (const [path, methods] of Object.entries(doc.paths as Record<string, Record<string, { security?: unknown; parameters: { name: string; in: string; required: boolean; schema: JsonSchemaNode }[];
    requestBody?: { content: Record<string, { schema: JsonSchemaNode }> }; responses: Record<string, { description: string; content?: Record<string, { schema: JsonSchemaNode }> }> }>>)) {
    for (const [method, op] of Object.entries(methods)) {
      out.push(`## ${method.toUpperCase()} \`${path}\``, '', `Auth: ${op.security ? 'bearer (Supabase session)' : 'none'}`, '');
      if (op.parameters.length) {
        out.push('| Parameter | In | Type | Required |', '|---|---|---|---|');
        for (const p of op.parameters) out.push(`| \`${p.name}\` | ${p.in} | ${typeLabel(p.schema)} | ${p.required ? 'yes' : ''} |`);
        out.push('');
      }
      for (const [media, { schema }] of Object.entries(op.requestBody?.content ?? {})) {
        const rows = media === 'application/json' ? fieldRows(schema) : [];
        out.push(`Request body (\`${media}\`)${rows.length ? ':' : `: ${typeLabel(schema)}`}`, '');
        if (rows.length) out.push('| Field | Type | Required | Description |', '|---|---|---|---|', ...rows, '');
      }
      for (const [status, response] of Object.entries(op.responses)) {
        if (status === 'default') continue;
        const [media, body] = Object.entries(response.content ?? {})[0] ?? [];
        const rows = media === 'application/json' ? fieldRows(body!.schema) : [];
        out.push(`**${status}**: ${response.description}${media ? ` (\`${media}\`${rows.length ? '' : `, ${typeLabel(body!.schema)}`})` : ''}`, '');
        if (rows.length) out.push('| Field | Type | Required | Description |', '|---|---|---|---|', ...rows, '');
      }
    }
  }
  return out.join('\n');
}
