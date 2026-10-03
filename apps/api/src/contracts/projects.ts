import { z } from 'zod';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { SelectedBlueprintRequirementsSchema } from '@designflow/generator';
import { BlueprintQaReportSchema } from '@designflow/blueprint-qa';
import { GenerationIdentitySchema, CurrentArtifactsSchema } from './freshness.js';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const title = z.string().trim().min(1).max(200);
const status = z.enum(['ACTIVE', 'ARCHIVED']);
const visibility = z.enum(['PRIVATE', 'PUBLIC']);
const qaStatus = z.enum(['PASS', 'PASS_WITH_WARNINGS', 'FAIL']);
const counts = z.object({ errors: z.number().int().nonnegative(), warnings: z.number().int().nonnegative(), info: z.number().int().nonnegative(),
  rulePass: z.number().int().nonnegative(), ruleFail: z.number().int().nonnegative(), ruleNotApplicable: z.number().int().nonnegative(), ruleNotEvaluated: z.number().int().nonnegative() }).strict();
export const QaSummarySchema = z.object({ id, qaVersion: z.string().min(1), modelSchemaVersion: z.literal(2),
  rulePacks: z.array(z.object({ id: z.string(), version: z.string() }).strict()), status: qaStatus, summary: counts, createdAt: timestamp }).strict();
export const QaRunSchema = QaSummarySchema.extend({ report: BlueprintQaReportSchema });
export const ProjectSummarySchema = z.object({ id, title, status, visibility, currentRevisionId: id.nullable(),
  currentRevisionNumber: z.number().int().positive().nullable(), qaStatus: qaStatus.nullable(),
  createdAt: timestamp, updatedAt: timestamp, archivedAt: timestamp.nullable() }).strict();
export const ProjectRevisionSummarySchema = z.object({ id, projectId: id, revisionNumber: z.number().int().positive(),
  parentRevisionId: id.nullable(), schemaVersion: z.literal(2), completeness: z.literal('architectural'),
  sourceMode: z.enum(['generated', 'supplied']), generatorVersion: z.string().nullable(), createdAt: timestamp, qa: QaSummarySchema,
  identity: GenerationIdentitySchema.nullable().optional() }).strict();
export const ProjectRevisionDetailSchema = ProjectRevisionSummarySchema.extend({ model: ArchitecturalBuildingModelV2Schema, qaRuns: z.array(QaRunSchema).min(1),
  normalizedRequirements: SelectedBlueprintRequirementsSchema.nullable().optional() });
export const ProjectDetailSchema = ProjectSummarySchema.extend({ currentRevision: ProjectRevisionDetailSchema.nullable(), currentArtifacts: CurrentArtifactsSchema.optional() });
export const RevisionCommitResponseSchema = z.object({ project: ProjectSummarySchema, revision: ProjectRevisionDetailSchema }).strict();
export const PublicProjectSchema = z.object({ id, title, updatedAt: timestamp, currentRevision: z.object({ id,
  revisionNumber: z.number().int().positive(), createdAt: timestamp, model: ArchitecturalBuildingModelV2Schema, qa: QaSummarySchema }).strict().nullable() }).strict();
export const CreateProjectRequestSchema = z.object({ title }).strict();
export const UpdateProjectRequestSchema = z.object({ title: title.optional(), status: status.optional(), visibility: visibility.optional() }).strict()
  .refine(value => Object.keys(value).length > 0, 'Provide at least one metadata field');
export const SaveRevisionRequestSchema = z.object({ model: ArchitecturalBuildingModelV2Schema, baseRevisionId: id.nullable().default(null) }).strict();
export const GenerateRevisionRequestSchema = z.object({ requirements: SelectedBlueprintRequirementsSchema, baseRevisionId: id.nullable().default(null) }).strict();
export const ProjectParamsSchema = z.object({ projectId: id }).strict();
export const RevisionParamsSchema = z.object({ projectId: id, revisionId: id }).strict();
export const ProjectCursorSchema = z.object({ updatedAt: timestamp, id }).strict();
export const RevisionCursorSchema = z.object({ revisionNumber: z.number().int().positive() }).strict();
export const PageQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().min(1).max(512).optional() }).strict();
export const ProjectListSchema = z.object({ items: z.array(ProjectSummarySchema).max(100), nextCursor: z.string().nullable() }).strict();
export const RevisionListSchema = z.object({ items: z.array(ProjectRevisionSummarySchema).max(100), nextCursor: z.string().nullable() }).strict();
export type RevisionCommit = z.infer<typeof RevisionCommitResponseSchema>;
