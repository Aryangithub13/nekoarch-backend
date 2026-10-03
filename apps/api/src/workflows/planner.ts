import { blueprintVersionForRequirements } from '@designflow/generator';
import { WORKFLOW_VERSION, WorkflowPlanSchema, type WorkflowRequest, type WorkflowOutput, type CapabilityId, type WorkflowPlan } from '../contracts/workflows.js';
import { CAPABILITIES, MODES, validateRegistry, type Capability } from './registry.js';
/** Source evidence is server-resolved. This function performs no I/O or input mutation. */
export function planWorkflow(request: WorkflowRequest, available: readonly WorkflowOutput[] = [], registry: readonly Capability[] = CAPABILITIES): WorkflowPlan {
  if (request.source.kind === 'GENERATE' && registry === CAPABILITIES) {
    const version = blueprintVersionForRequirements(request.source.requirements);
    registry = registry.map(c => ({ ...c, version: c.capabilityId === 'BLUEPRINT_GENERATION' ? version : c.version,
      dependencies: c.dependencies.map(d => d.capabilityId === 'BLUEPRINT_GENERATION' ? { ...d, version } : d) }));
  }
  validateRegistry(registry);
  if (available.length > 13 || new Set(available.map(o => o.capability)).size !== available.length) throw new Error('Invalid source evidence');
  const mode = MODES.find(m => m.mode === request.mode)!;
  const byId = new Map(registry.map(c => [c.capabilityId,c]));
  const reusable = new Map(available.map(o => [o.capability,o]));
  const required = new Set<CapabilityId>(), selected = new Set<CapabilityId>(), order: CapabilityId[] = [];
  let operations = 0;
  function include(id: CapabilityId, isRequired: boolean) {
    if (++operations > 1024) throw new Error('Planning resource limit');
    const alreadyRequired = required.has(id);
    if (isRequired) required.add(id);
    const c = byId.get(id)!;
    // Dependencies remain represented even when the current step can be reused.
    if (selected.has(id) && (!isRequired || alreadyRequired)) return;
    for (const d of c.dependencies) include(d.capabilityId,isRequired);
    if (!selected.has(id)) { selected.add(id); order.push(id); }
  }
  for (const id of [...mode.required,...request.requiredOutputs]) include(id,true);
  for (const id of [...mode.optional,...request.optionalOutputs]) include(id,false);
  const unavailable = new Set<CapabilityId>();
  const unavailableCapabilities: WorkflowPlan['unavailableCapabilities'] = [];
  const steps = order.map(id => {
    const c = byId.get(id)!, evidence = reusable.get(id);
    const reuse = evidence && (evidence.version === c.version || ['BLUEPRINT_GENERATION','BLUEPRINT_QA','REVISION_PERSISTENCE'].includes(id));
    const missing = !reuse && (c.implementationStatus !== 'AVAILABLE' || c.dependencies.some(d => unavailable.has(d.capabilityId)));
    if (missing) { unavailable.add(id); unavailableCapabilities.push({ capability: id, implementationStatus: c.implementationStatus,
      reason: c.implementationStatus === 'PLANNED' ? 'CAPABILITY_NOT_IMPLEMENTED' : c.implementationStatus === 'DISABLED' ? 'CAPABILITY_DISABLED' : 'DEPENDENCY_UNAVAILABLE', required: required.has(id) }); }
    return { capability: id, version: reuse ? evidence.version : c.version, artifactType: c.producedArtifactType,
      dependencies: c.dependencies.map(d => d.capabilityId), required: required.has(id), action: reuse ? 'REUSE' as const : missing ? 'UNAVAILABLE' as const : 'EXECUTE' as const };
  });
  const blocked = unavailableCapabilities.some(c => c.required);
  return WorkflowPlanSchema.parse({ workflowVersion: WORKFLOW_VERSION, mode: request.mode, status: blocked ? 'BLOCKED' : 'PLANNED',
    requiredCapabilities: order.filter(id => required.has(id)), optionalCapabilities: order.filter(id => !required.has(id)), steps,
    unavailableCapabilities, executableCapabilities: blocked ? [] : steps.filter(s => s.action === 'EXECUTE').map(s => s.capability),
    expectedArtifacts: steps.map(s => s.artifactType), reusedOutputs: steps.filter(s => s.action === 'REUSE').map(s => ({ ...reusable.get(s.capability)!, status: 'REUSED' })) });
}
