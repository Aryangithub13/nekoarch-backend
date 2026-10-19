import { z } from 'zod';
import { BuildingTypeSchema, TierSchema, TierEstimateSchema } from '@designflow/shared';

export const PlanRecordSchema = z.object({ id: z.string().uuid(), plan_data: z.unknown() });
export type PlanRecord = z.infer<typeof PlanRecordSchema>;
export const PlanInsertSchema = z.object({ user_id: z.string().uuid(), prompt: z.string(), seed: z.string(), variant: z.number(),
  plan_data: z.unknown(), qa_orthogonal: z.number(), bounds_width_m: z.number(), bounds_depth_m: z.number(), room_count: z.number(), share_token: z.string() });
export type PlanInsert = z.infer<typeof PlanInsertSchema>;
export const RateVersionSchema = z.object({ id: z.string().uuid(), version_label: z.string(), effective_date: z.string(), created_at: z.string() });
export type RateVersion = z.infer<typeof RateVersionSchema>;
export const RateEntrySchema = z.object({ id: z.string().uuid(), version_id: z.string().uuid(), region: z.string(), building_type: BuildingTypeSchema,
  tier: TierSchema, rate_per_sqft_min: z.union([z.number(), z.string()]), rate_per_sqft_max: z.union([z.number(), z.string()]),
  category_breakdown: z.record(z.number()), is_active: z.boolean() });
export type RateEntry = z.infer<typeof RateEntrySchema>;
export const EstimateInsertSchema = z.object({ plan_id: z.string().uuid().nullable(), user_id: z.string().uuid(), location: z.string(), building_type: BuildingTypeSchema,
  built_up_area_sqft: z.number(), floors: z.number(), budget_provided: z.number().nullable(), rate_table_version: z.string().uuid(),
  tier_basic: TierEstimateSchema, tier_standard: TierEstimateSchema, tier_premium: TierEstimateSchema, soil_note: z.string() });
export type EstimateInsert = z.infer<typeof EstimateInsertSchema>;

export interface IdempotencyContext { operation: string; keyHash: string; fingerprint: string }
export type DurableWrite = { kind: 'plan'; row: PlanInsert } | { kind: 'estimate'; row: EstimateInsert };
export interface IdempotencyRecord { fingerprint: string; response: unknown }

/** Each instance operates under one caller's database role/JWT. */
export interface Repository {
  conversationRpc?(name: 'conversation_read' | 'conversation_write', args: Record<string, unknown>): Promise<unknown>;
  workflowRpc?(name: 'workflow_read' | 'workflow_write', args: Record<string, unknown>): Promise<unknown>;
  costRpc?(name: 'cost_read' | 'cost_write', args: Record<string, unknown>): Promise<unknown>;
  constructionRpc?(name: 'construction_read' | 'construction_write', args: Record<string, unknown>): Promise<unknown>;
  takeoffRpc?(name: 'takeoff_read' | 'takeoff_write', args: Record<string, unknown>): Promise<unknown>;
  structuralRpc?(name: 'structural_read' | 'structural_write', args: Record<string, unknown>): Promise<unknown>;
  environmentalRpc?(name: 'environmental_read' | 'environmental_write', args: Record<string, unknown>): Promise<unknown>;
  systemsRpc?(name: 'systems_read' | 'systems_write', args: Record<string, unknown>): Promise<unknown>;
  knowledgeRpc?(name: 'knowledge_read' | 'knowledge_write', args: Record<string, unknown>): Promise<unknown>;
  optimizationRpc?(name: 'optimization_read' | 'optimization_write', args: Record<string, unknown>): Promise<unknown>;
  sceneRpc?(name: 'scene_read' | 'scene_write', args: Record<string, unknown>): Promise<unknown>;
  revisionRpc?(name: 'revision_operation_read' | 'revision_operation_write', args: Record<string, unknown>): Promise<unknown>;
  referenceRpc?(name: 'reference_read' | 'reference_write' | 'reference_download', args: Record<string, unknown>): Promise<unknown>;
  jobRpc?(name: 'job_read' | 'job_write', args: Record<string, unknown>): Promise<unknown>;
  computeRpc?(name: 'compute_read' | 'compute_write', args: Record<string, unknown>): Promise<unknown>;
  evidenceRpc?(name: 'evidence_read' | 'evidence_write', args: Record<string, unknown>): Promise<unknown>;
  designConceptRpc?(name: 'design_concept_read' | 'design_concept_write', args: Record<string, unknown>): Promise<unknown>;
  accountRpc?(name: 'account_read' | 'account_write' | 'library_search' | 'library_write' | 'brief_read' | 'brief_write' | 'context_read', args: Record<string, unknown>): Promise<unknown>;
  projectRpc?(name: 'project_read' | 'project_write', args: Record<string, unknown>): Promise<unknown>;
  collaborationRpc?(name: 'collaboration_read' | 'collaboration_write', args: Record<string, unknown>): Promise<unknown>;
  lookupIdempotency?(context: IdempotencyContext): Promise<IdempotencyRecord | null>;
  commitIdempotency?(context: IdempotencyContext, write: DurableWrite, response: unknown): Promise<unknown>;
  insertPlan(row: PlanInsert): Promise<PlanRecord>;
  getPlan(id: string): Promise<PlanRecord | null>;
  patchPlan(id: string, isPublic: boolean): Promise<PlanRecord | null>;
  getRateVersions(): Promise<RateVersion[]>;
  getRateEntries(versionId: string): Promise<RateEntry[]>;
  insertEstimate(row: EstimateInsert): Promise<void>;
}
export interface Backend {
  ready?(): Promise<void>;
  /** Deployment probes (0032): the database's `schema_version()` and whether a probe signature verifies under its commit key. */
  schemaVersion?(): Promise<number>;
  commitKeyMatches?(probe: string, signature: string): Promise<boolean>;
  close?(): Promise<void>;
  authenticate(token: string): Promise<{ id: string }>;
  repository(token?: string): Repository;
}
