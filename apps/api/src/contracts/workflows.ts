import { z } from 'zod';
import { SelectedBlueprintRequirementsSchema } from '@designflow/generator';
import { TakeoffRequestSchema } from './takeoffs.js';
import { ConstructionRequestSchema } from './construction.js';
import { CostRequestSchema } from './costs.js';

export const WORKFLOW_VERSION = 'workflow-v1';
export const WorkflowModeSchema = z.enum(['COMPLETE_BUILDING', 'BLUEPRINT_ONLY', 'INTERIOR_ONLY', 'EXTERIOR_ONLY', 'THREE_D_ONLY', 'ENGINEERING_ONLY']);
export const CapabilityIdSchema = z.enum(['BLUEPRINT_GENERATION', 'BLUEPRINT_QA', 'REVISION_PERSISTENCE', 'QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'PROFESSIONAL_2D', 'INTERIOR_DESIGN', 'EXTERIOR_DESIGN', 'SCENE_3D', 'WALKTHROUGH', 'ENGINEERING_ANALYSIS', 'HOLOGRAPHIC_MODEL']);
export const ArtifactTypeSchema = z.enum(['BUILDING_MODEL', 'BLUEPRINT_QA', 'PROJECT_REVISION', 'QUANTITY_TAKEOFF', 'CONSTRUCTION_CALCULATION', 'BOQ_COST', 'DRAWING_2D', 'INTERIOR_DESIGN', 'EXTERIOR_DESIGN', 'SCENE_3D', 'WALKTHROUGH', 'ENGINEERING_ANALYSIS', 'HOLOGRAPHIC_MODEL']);
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type WorkflowMode = z.infer<typeof WorkflowModeSchema>;
const id = z.string().uuid();
const outputs = z.array(CapabilityIdSchema).max(13).default([]).transform(a => [...new Set(a)].sort());
const intent = { requiredOutputs: outputs, optionalOutputs: outputs };
const existing = z.object({ kind: z.literal('REVISION'), sourceRevisionId: id }).strict();
const source = z.discriminatedUnion('kind', [existing, z.object({ kind: z.literal('GENERATE'),
  baseRevisionId: id.nullable(), requirements: SelectedBlueprintRequirementsSchema }).strict()]);
const engines = { takeoff: TakeoffRequestSchema.default({}), construction: ConstructionRequestSchema.optional(), cost: CostRequestSchema.optional() };
const design = z.object({ brief: z.string().trim().min(1).max(2000), style: z.string().trim().min(1).max(100).optional(),
  materials: z.array(z.string().trim().min(1).max(100)).max(32).default([]) }).strict();
export const WorkflowRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('COMPLETE_BUILDING'), source, ...intent, ...engines,
    construction: ConstructionRequestSchema, cost: CostRequestSchema }).strict(),
  z.object({ mode: z.literal('BLUEPRINT_ONLY'), source, ...intent, ...engines }).strict(),
  z.object({ mode: z.literal('INTERIOR_ONLY'), source: existing, ...intent,
    targetSpaceIds: z.array(z.string().min(1).max(200)).min(1).max(100).transform(a => [...new Set(a)].sort()), design }).strict(),
  z.object({ mode: z.literal('EXTERIOR_ONLY'), source: existing, ...intent,
    facade: z.enum(['NORTH', 'SOUTH', 'EAST', 'WEST', 'ALL']), design }).strict(),
  z.object({ mode: z.literal('THREE_D_ONLY'), source: existing, ...intent,
    scene: z.object({ purpose: z.enum(['VISUALIZATION', 'WALKTHROUGH']).default('VISUALIZATION') }).strict().default({}) }).strict(),
  z.object({ mode: z.literal('ENGINEERING_ONLY'), source: existing, ...intent,
    analysis: z.object({ discipline: z.enum(['STRUCTURAL', 'BUILDING_ANALYSIS']),
      sourceModelType: z.literal('ARCHITECTURAL_V2'), brief: z.string().trim().min(1).max(2000) }).strict() }).strict(),
]).superRefine((r, ctx) => {
  if (r.requiredOutputs.some(c => r.optionalOutputs.includes(c))) ctx.addIssue({ code: 'custom', message: 'Required and optional outputs must be disjoint' });
  const selected = [...r.requiredOutputs, ...r.optionalOutputs];
  if (selected.some(c => ['CONSTRUCTION_CALCULATION', 'BOQ_COST'].includes(c)) && (!('construction' in r) || !r.construction))
    ctx.addIssue({ code: 'custom', message: 'Construction output requires an explicit specification' });
  if (selected.includes('BOQ_COST') && (!('cost' in r) || !r.cost)) ctx.addIssue({ code: 'custom', message: 'Cost output requires an explicit rate book and policy' });
  if (!['COMPLETE_BUILDING', 'BLUEPRINT_ONLY'].includes(r.mode) && selected.some(c => ['QUANTITY_TAKEOFF','CONSTRUCTION_CALCULATION','BOQ_COST'].includes(c)))
    ctx.addIssue({ code: 'custom', message: 'Calculation extensions use a building workflow' });
});
export type WorkflowRequest = z.infer<typeof WorkflowRequestSchema>;
export const WorkflowOutputSchema = z.object({ capability: CapabilityIdSchema, artifactType: ArtifactTypeSchema,
  artifactId: id, projectRevisionId: id, status: z.enum(['CREATED', 'REUSED']), version: z.string().min(1).max(100),
  coverage: z.string().max(100).nullable(), sourceArtifactIds: z.array(id).max(4) }).strict();
export type WorkflowOutput = z.infer<typeof WorkflowOutputSchema>;
export const WorkflowPlanSchema = z.object({ workflowVersion: z.literal(WORKFLOW_VERSION), mode: WorkflowModeSchema,
  status: z.enum(['PLANNED', 'BLOCKED']), requiredCapabilities: z.array(CapabilityIdSchema).max(13),
  optionalCapabilities: z.array(CapabilityIdSchema).max(13),
  steps: z.array(z.object({ capability: CapabilityIdSchema, version: z.string(), artifactType: ArtifactTypeSchema,
    dependencies: z.array(CapabilityIdSchema).max(13), action: z.enum(['EXECUTE', 'REUSE', 'UNAVAILABLE']), required: z.boolean() }).strict()).max(13),
  unavailableCapabilities: z.array(z.object({ capability: CapabilityIdSchema, implementationStatus: z.enum(['PLANNED','DISABLED','AVAILABLE']),
    reason: z.enum(['CAPABILITY_NOT_IMPLEMENTED','CAPABILITY_DISABLED','DEPENDENCY_UNAVAILABLE']), required: z.boolean() }).strict()).max(13),
  executableCapabilities: z.array(CapabilityIdSchema).max(13), expectedArtifacts: z.array(ArtifactTypeSchema).max(13),
  reusedOutputs: z.array(WorkflowOutputSchema).max(13),
}).strict();
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;
export const WorkflowRunSchema = z.object({ id, projectId: id, sourceRevisionId: id.nullable(), workflowVersion: z.literal(WORKFLOW_VERSION),
  mode: WorkflowModeSchema, status: z.enum(['RUNNING','COMPLETED','BLOCKED','PARTIALLY_COMPLETED','FAILED']),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/), request: WorkflowRequestSchema, plan: WorkflowPlanSchema,
  outputs: z.array(WorkflowOutputSchema).max(13), completedCapabilities: z.array(CapabilityIdSchema).max(13),
  errors: z.array(z.object({ capability: CapabilityIdSchema, code: z.string().max(100), message: z.string().max(240) }).strict()).max(20),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
