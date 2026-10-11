import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
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
import { AccountUsageSchema, BriefCreateSchema, BriefCurrentSchema, BriefListSchema, BriefVersionSchema, ContextBundleSchema, EmptyQuerySchema, LibraryEntrySchema,
  LibraryListSchema, LibraryPatchSchema, LibraryQuerySchema, SettingsDocumentSchema, SettingsPatchSchema } from '../apps/api/src/account/contracts.js';
import { EmptyBodySchema as JobEmpty, JobDetailSchema, JobEventListSchema, JobEventsQuerySchema, JobListQuerySchema, JobListSchema, JobRequestSchema } from '../apps/api/src/jobs/contracts.js';

/** Route → the Zod schemas its handler parses (request) or returns (response). `null` response = JSON whose schema is not exported yet. */
type Op = { body?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny | null; status?: number; media?: string; rawBody?: readonly string[] };
const P = '/api/projects/:projectId', R = `${P}/revisions/:revisionId`, T = `${R}/takeoffs`, C = `${T}/:takeoffId/construction-calculations`, V = `${P}/conversations/:conversationId`;
const empty = z.object({}).strict(), current = z.object({ require: z.literal('current').optional() }).strict();
const bimPage = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), after: z.string().regex(/^bim-[a-f0-9]{40}$/).optional(), kind: BimKindSchema.optional() }).strict();
const analyses = (root: string, input: ZodTypeAny, detail: ZodTypeAny, read: ZodTypeAny): Record<string, Op> => ({
  [`POST ${R}/${root}/validate`]: { body: input, response: null }, [`POST ${R}/${root}/analyses`]: { body: input, response: detail, status: 201 },
  [`GET ${R}/${root}/analyses`]: { query: PageQuerySchema, response: null }, [`GET ${R}/${root}/analyses/:analysisId`]: { query: read, response: detail },
  [`GET ${R}/${root}/status`]: { query: empty, response: null } });
export const CONTRACTS: Record<string, Op> = {
  'GET /health/live': { response: z.object({ status: z.literal('ok') }) }, 'GET /health/ready': { response: z.object({ status: z.enum(['ok', 'unavailable']) }) },
  'GET /api/capabilities': { response: null }, 'GET /api/regions': { response: RegionsResponseSchema },
  'POST /api/estimates': { body: EstimateInputsSchema, response: EstimateResponseSchema },
  'POST /api/plans': { body: CreatePlanRequestSchema, response: CreatePlanResponseSchema, status: 201 }, 'POST /api/plans/generate': { body: GeneratePlanRequestSchema, response: CreatePlanResponseSchema, status: 201 },
  'GET /api/plans/:id': { response: GetPlanResponseSchema }, 'PATCH /api/plans/:id': { body: PatchPlanRequestSchema, response: PatchPlanResponseSchema },
  'POST /api/projects': { body: CreateProjectRequestSchema, response: ProjectDetailSchema, status: 201 }, 'GET /api/projects': { query: PageQuerySchema, response: ProjectListSchema },
  [`GET ${P}`]: { query: ProjectReadQuerySchema, response: ProjectDetailSchema }, [`PATCH ${P}`]: { body: UpdateProjectRequestSchema, response: ProjectDetailSchema },
  [`GET ${P}/public`]: { response: PublicProjectSchema },
  [`POST ${P}/requirements/interpret`]: { body: NaturalLanguageDesignRequestSchema, response: InterpretationResultSchema },
  [`GET ${P}/revisions`]: { query: PageQuerySchema, response: RevisionListSchema },
  [`POST ${P}/revisions`]: { body: SaveRevisionRequestSchema, response: RevisionCommitResponseSchema, status: 201 },
  [`POST ${P}/revisions/generate`]: { body: GenerateRevisionRequestSchema, response: RevisionCommitResponseSchema, status: 201 },
  [`GET ${R}`]: { response: ProjectRevisionDetailSchema }, [`GET ${R}/overview`]: { query: empty, response: null },
  [`POST ${P}/workflows/plan`]: { body: WorkflowRequestSchema, response: z.object({ projectId: z.string().uuid(), sourceRevisionId: z.string().uuid().nullable(), inputFingerprint: z.string(), plan: WorkflowPlanSchema }).strict() },
  [`POST ${P}/workflows`]: { body: WorkflowRequestSchema, response: WorkflowRunSchema, status: 201 }, [`GET ${P}/workflows`]: { query: PageQuerySchema, response: null },
  [`GET ${P}/workflows/:workflowRunId`]: { response: WorkflowRunSchema },
  [`POST ${P}/conversations`]: { body: CreateConversationSchema, response: ConversationSchema }, [`GET ${P}/conversations`]: { query: ConversationPageSchema, response: ConversationListSchema },
  [`GET ${V}`]: { response: ConversationSchema }, [`DELETE ${V}`]: { response: z.object({ deleted: z.literal(true) }).strict() },
  [`POST ${V}/messages`]: { body: ConversationMessageSchema, response: ConversationSchema }, [`POST ${V}/proposals/approve`]: { body: ProposalApprovalSchema, response: RevisionCommitResponseSchema },
  [`POST ${V}/tools`]: { body: ConversationToolSchema, response: ConversationToolResponseSchema },
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
  // Phase 31 reference ingestion: uploads are raw bodies of a supported media type; downloads are the stored bytes.
  [`POST ${P}/references/validate`]: { query: empty, rawBody: REFERENCE_MEDIA_TYPES, response: ValidateResponseSchema },
  [`POST ${P}/references`]: { query: ReferenceUploadQuerySchema, rawBody: REFERENCE_MEDIA_TYPES, response: ReferenceDetailSchema, status: 201 },
  [`GET ${P}/references`]: { query: ReferenceListQuerySchema, response: ReferenceListSchema }, [`GET ${P}/references/usage`]: { query: empty, response: ReferenceUsageSchema },
  [`GET ${P}/references/:referenceId`]: { query: empty, response: ReferenceDetailSchema }, [`PATCH ${P}/references/:referenceId`]: { body: ReferenceUpdateSchema, response: ReferenceDetailSchema },
  [`DELETE ${P}/references/:referenceId`]: { response: ReferenceDetailSchema }, [`GET ${P}/references/:referenceId/content`]: { query: empty, media: 'application/octet-stream' },
  [`POST ${P}/references/:referenceId/download-links`]: { body: DownloadLinkRequestSchema, response: DownloadLinkSchema, status: 201 },
  'GET /api/reference-downloads': { query: DownloadTokenSchema, media: 'application/octet-stream' },
  // Phase 32 durable jobs.
  [`POST ${P}/jobs`]: { body: JobRequestSchema, response: JobDetailSchema, status: 202 }, [`GET ${P}/jobs`]: { query: JobListQuerySchema, response: JobListSchema },
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
const referenced = (schema: ZodTypeAny) => {
  const { schemas: _shared, ...root } = zodToJsonSchema(schema, { target: 'openApi3', definitions: SHARED, $refStrategy: 'root', basePath: ['#', 'components'],
    definitionPath: 'schemas', effectStrategy: 'input', removeAdditionalStrategy: 'strict' }) as Record<string, unknown>;
  return root;
};

/** OpenAPI 3.0 document from the live route table plus CONTRACTS; nothing is hand-written per route beyond the schema mapping. */
export function openApiDocument(routes: { method: string; url: string; anonymous: number }[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const { schemas } = zodToJsonSchema(z.object({}), { target: 'openApi3', definitions: SHARED, $refStrategy: 'root', basePath: ['#', 'components'], definitionPath: 'schemas',
    effectStrategy: 'input', removeAdditionalStrategy: 'strict' }) as { schemas: Record<string, unknown> };
  for (const r of routes) {
    const op = CONTRACTS[`${r.method} ${r.url}`] ?? {}, path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...r.url.matchAll(/:([A-Za-z]+)/g)].map(([, name]) => ({ name, in: 'path', required: true,
      schema: name === 'elementId' ? { type: 'string', pattern: '^bim-[a-f0-9]{40}$' } : name === 'version' ? { type: 'integer', minimum: 1 } : { type: 'string', format: 'uuid' } }));
    const query = op.query ? Object.entries((jsonSchema(op.query).properties ?? {}) as Record<string, unknown>).map(([name, schema]) =>
      ({ name, in: 'query', required: ((jsonSchema(op.query!).required ?? []) as string[]).includes(name), schema })) : []; // query params are small: inline
    const ok = op.media ? { description: 'Binary', content: { [op.media]: { schema: { type: 'string', format: 'binary' } } } }
      : op.response ? { description: 'Success', content: { 'application/json': { schema: referenced(op.response) } } }
        : { description: 'JSON success response; schema not exported yet (see route source)' };
    (paths[path] ??= {})[r.method.toLowerCase()] = { operationId: `${r.method.toLowerCase()} ${r.url}`,
      ...(r.anonymous === 401 ? { security: [{ bearer: [] }] } : {}), parameters: [...params, ...query],
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: referenced(op.body) } } } } : {}),
      ...(op.rawBody ? { requestBody: { required: true, content: Object.fromEntries(op.rawBody.map(m => [m, { schema: { type: 'string', format: 'binary' } }])) } } : {}),
      responses: { [String(op.status ?? 200)]: ok, ...(op.media === 'model/gltf-binary' || op.media === 'application/octet-stream' ? { 304: { description: 'Not modified (If-None-Match)' } } : {}),
        default: { description: 'Typed error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } } } };
  }
  return { openapi: '3.0.3', info: { title: 'NekoArch designflow API', version: 'modernization-phases-1-29' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Supabase session access token' } }, schemas }, paths };
}
