import { z } from 'zod';
import { BLUEPRINT_VERSION } from '@designflow/generator';
import { QA_VERSION } from '@designflow/blueprint-qa';
import { TAKEOFF_ENGINE_VERSION } from '@designflow/quantity-takeoff';
import { CONSTRUCTION_ENGINE_VERSION } from '@designflow/construction-calculations';
import { COST_ENGINE_VERSION } from '@designflow/boq-cost';
import { ArtifactTypeSchema, CapabilityIdSchema, WorkflowModeSchema, type CapabilityId } from '../contracts/workflows.js';
export const CapabilitySchema = z.object({ capabilityId: CapabilityIdSchema, version: z.string().min(1).max(100),
  implementationStatus: z.enum(['AVAILABLE','PLANNED','DISABLED']),
  dependencies: z.array(z.object({ capabilityId: CapabilityIdSchema, version: z.string().min(1).max(100) }).strict()).max(13),
  acceptedInputs: z.array(z.enum(['STRUCTURED_REQUIREMENTS','BUILDING_MODEL_V2','QA_ACCEPTED_MODEL','ACCEPTED_REVISION','IMMUTABLE_TAKEOFF','IMMUTABLE_CONSTRUCTION','SCENE_3D'])).min(1).max(6),
  producedArtifactType: ArtifactTypeSchema }).strict();
export type Capability = z.infer<typeof CapabilitySchema>;
const versions: Record<CapabilityId,string> = { BLUEPRINT_GENERATION: BLUEPRINT_VERSION, BLUEPRINT_QA: QA_VERSION,
  REVISION_PERSISTENCE: 'project-revision-v1', QUANTITY_TAKEOFF: TAKEOFF_ENGINE_VERSION,
  CONSTRUCTION_CALCULATION: CONSTRUCTION_ENGINE_VERSION, BOQ_COST: COST_ENGINE_VERSION,
  PROFESSIONAL_2D: 'contract-v1', INTERIOR_DESIGN: 'contract-v1', EXTERIOR_DESIGN: 'contract-v1', SCENE_3D: 'contract-v1',
  WALKTHROUGH: 'contract-v1', ENGINEERING_ANALYSIS: 'contract-v1', HOLOGRAPHIC_MODEL: 'contract-v1' };
function entry(id: CapabilityId, artifact: Capability['producedArtifactType'], dependencies: CapabilityId[], input: Capability['acceptedInputs'][number], available = false): Capability {
  return { capabilityId: id, version: versions[id], producedArtifactType: artifact,
    implementationStatus: available ? 'AVAILABLE' : 'PLANNED', acceptedInputs: [input],
    dependencies: dependencies.map(capabilityId => ({ capabilityId, version: versions[capabilityId] })) };
}
export const CAPABILITIES: readonly Capability[] = [
  entry('BLUEPRINT_GENERATION','BUILDING_MODEL',[],'STRUCTURED_REQUIREMENTS',true),
  entry('BLUEPRINT_QA','BLUEPRINT_QA',['BLUEPRINT_GENERATION'],'BUILDING_MODEL_V2',true),
  entry('REVISION_PERSISTENCE','PROJECT_REVISION',['BLUEPRINT_QA'],'QA_ACCEPTED_MODEL',true),
  entry('QUANTITY_TAKEOFF','QUANTITY_TAKEOFF',['REVISION_PERSISTENCE'],'ACCEPTED_REVISION',true),
  entry('CONSTRUCTION_CALCULATION','CONSTRUCTION_CALCULATION',['QUANTITY_TAKEOFF'],'IMMUTABLE_TAKEOFF',true),
  entry('BOQ_COST','BOQ_COST',['CONSTRUCTION_CALCULATION'],'IMMUTABLE_CONSTRUCTION',true),
  entry('PROFESSIONAL_2D','DRAWING_2D',['REVISION_PERSISTENCE'],'ACCEPTED_REVISION'),
  entry('INTERIOR_DESIGN','INTERIOR_DESIGN',['REVISION_PERSISTENCE'],'ACCEPTED_REVISION'),
  entry('EXTERIOR_DESIGN','EXTERIOR_DESIGN',['REVISION_PERSISTENCE'],'ACCEPTED_REVISION'),
  entry('SCENE_3D','SCENE_3D',['REVISION_PERSISTENCE'],'ACCEPTED_REVISION'),
  entry('WALKTHROUGH','WALKTHROUGH',['SCENE_3D'],'SCENE_3D'),
  entry('ENGINEERING_ANALYSIS','ENGINEERING_ANALYSIS',['REVISION_PERSISTENCE'],'ACCEPTED_REVISION'),
  entry('HOLOGRAPHIC_MODEL','HOLOGRAPHIC_MODEL',['SCENE_3D'],'SCENE_3D'),
];
export const ModeDefinitionSchema = z.object({ mode: WorkflowModeSchema, required: z.array(CapabilityIdSchema).min(1).max(13), optional: z.array(CapabilityIdSchema).max(13), semantics: z.string() }).strict();
export const MODES: readonly z.infer<typeof ModeDefinitionSchema>[] = [
  { mode: 'COMPLETE_BUILDING', required: ['BOQ_COST'], optional: ['PROFESSIONAL_2D','INTERIOR_DESIGN','EXTERIOR_DESIGN','SCENE_3D','ENGINEERING_ANALYSIS'], semantics: 'Execute the supported building chain; future outputs are optional.' },
  { mode: 'BLUEPRINT_ONLY', required: ['REVISION_PERSISTENCE'], optional: [], semantics: 'Accepted geometry only, with explicit output extensions.' },
  { mode: 'INTERIOR_ONLY', required: ['INTERIOR_DESIGN'], optional: [], semantics: 'Design selected accepted-revision spaces; contract only.' },
  { mode: 'EXTERIOR_ONLY', required: ['EXTERIOR_DESIGN'], optional: [], semantics: 'Design an accepted-revision facade; contract only.' },
  { mode: 'THREE_D_ONLY', required: ['SCENE_3D'], optional: [], semantics: 'Compile accepted V2 geometry; contract only.' },
  { mode: 'ENGINEERING_ONLY', required: ['ENGINEERING_ANALYSIS'], optional: [], semantics: 'Analyze an architectural source; contract only, no engineering calculations.' },
];
export function validateRegistry(registry: readonly Capability[], modes = MODES) {
  if (registry.length > 32 || modes.length > 32) throw new Error('Registry resource limit');
  const byId = new Map<CapabilityId,Capability>();
  for (const c of registry) { CapabilitySchema.parse(c); if (byId.has(c.capabilityId)) throw new Error('Duplicate capability'); byId.set(c.capabilityId,c); }
  const seen = new Set<CapabilityId>(), active = new Set<CapabilityId>(); let work = 0;
  function visit(id: CapabilityId, depth: number) {
    if (++work > 1024 || depth > 16) throw new Error('Dependency resource limit');
    if (active.has(id)) throw new Error('Dependency cycle');
    if (seen.has(id)) return;
    const c = byId.get(id); if (!c) throw new Error('Missing dependency'); active.add(id);
    for (const d of c.dependencies) { if (byId.get(d.capabilityId)?.version !== d.version) throw new Error('Missing dependency version'); visit(d.capabilityId, depth + 1); }
    active.delete(id); seen.add(id);
  }
  for (const c of registry) visit(c.capabilityId,0);
  const modeIds = new Set<string>();
  for (const mode of modes) { ModeDefinitionSchema.parse(mode); if (modeIds.has(mode.mode)) throw new Error('Duplicate mode'); modeIds.add(mode.mode);
    for (const id of [...mode.required,...mode.optional]) if (!byId.has(id)) throw new Error('Missing mode capability'); }
}
validateRegistry(CAPABILITIES);
// Deep-freeze the source-controlled metadata; planners never edit it.
for (const c of CAPABILITIES) { c.dependencies.forEach(Object.freeze); Object.freeze(c.dependencies); Object.freeze(c.acceptedInputs); Object.freeze(c); }
Object.freeze(CAPABILITIES);
for (const m of MODES) { Object.freeze(m.required); Object.freeze(m.optional); Object.freeze(m); } Object.freeze(MODES);
