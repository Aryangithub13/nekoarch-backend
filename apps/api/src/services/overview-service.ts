import type { Repository } from '../lib/repository.js';
import { ProjectRepository } from '../lib/project-repository.js';
import { TakeoffRepository } from '../lib/takeoff-repository.js';
import { ConstructionRepository } from '../lib/construction-repository.js';
import { CostRepository } from '../lib/cost-repository.js';
import { ProjectRevisionDetailSchema } from '../contracts/projects.js';
import { modelHash } from '../lib/generation-identity.js';
import { AI_CAPABILITIES } from '../ai/orchestration/registry.js';
import { CAPABILITIES } from '../workflows/registry.js';
import { BIM_VERSION } from '../bim/contracts.js';
import { TAKEOFF_ENGINE_VERSION } from '@designflow/quantity-takeoff';
import { CONSTRUCTION_ENGINE_VERSION } from '@designflow/construction-calculations';
import { COST_ENGINE_VERSION } from '@designflow/boq-cost';
import { STRUCTURAL_ANALYSIS_VERSION } from '../structural/contracts.js';
import { ENVIRONMENTAL_ANALYSIS_VERSION } from '../environmental/contracts.js';
import { SYSTEMS_ANALYSIS_VERSION } from '../systems/contracts.js';
import { KNOWLEDGE_ANALYSIS_VERSION } from '../knowledge/contracts.js';
import { OPTIMIZER_VERSION } from '../optimization/contracts.js';
import { SCENE_COMPILER_VERSION } from '../scene3d/contracts.js';
import { REVISION_OPERATION_VERSION } from '../revision/contracts.js';
import { RevisionRepository } from '../lib/revision-repository.js';
import { TAKEOFF_OPERATION } from './takeoff-service.js';
import { CONSTRUCTION_OPERATION } from './construction-service.js';
import { COST_COLLECTION } from './cost-service.js';
import { STRUCTURAL_ROOT, structuralStatus } from './structural-service.js';
import { ENVIRONMENTAL_ROOT, environmentalStatus } from './environmental-service.js';
import { SYSTEMS_ROOT, systemsStatus } from './systems-service.js';
import { KNOWLEDGE_ROOT, knowledgeStatus } from './knowledge-service.js';
import { OPTIMIZATION_ROOT, optimizationStatus } from './optimization-service.js';
import { SCENE_ROOT, sceneStatus } from './scene-service.js';
import { REFERENCE_ROOT } from './reference-service.js';
import { JOB_ROOT } from './job-service.js';
import { CONTEXT_ROUTE } from './account-service.js';
import { VERIFICATION_ROOT } from './verification-service.js';
import { VERIFIER_VERSION } from '../verification/contracts.js';
import { ENGINEERING_ROOT, ZONES_ROOT, ZONE_PARTITIONS_ROUTE, ZONE_REGENERATION_ROUTE } from './engineering-service.js';
import { ASSESSMENT_VERSION } from '../engineering/contracts.js';
import { ZONE_ASSESSMENT_VERSION } from '../engineering/zone-contracts.js';
import { REGENERATION_VERSION } from '../engineering/regeneration-contracts.js';
import { PARTITION_VERSION } from '../engineering/partition-contracts.js';
import { MODEL_LIMITS, UNSUPPORTED_OPERATIONS } from '../engineering/capability-limits.js';
import { CONTEXT_VERSION } from '../account/contracts.js';
import { JOB_VERSION } from '../jobs/contracts.js';
import { REFERENCE_INSPECTOR_VERSION } from '../references/contracts.js';
import { COMPUTE_ROOT, GATEWAY_VERSION, PROVIDERS } from '../compute/contracts.js';
import { DEPENDENCY_GRAPH_VERSION } from '../contracts/dependency-graph.js';
import { DEPENDENCY_GRAPH_ROUTE } from './dependency-graph-service.js';
import { DOCUMENTS_VERSION } from '../contracts/documents.js';
import { EVIDENCE_PACKAGE_VERSION } from '../contracts/evidence.js';
import { DOCUMENTS_ROOT } from './documents-service.js';
import { EVIDENCE_ROOT } from './evidence-service.js';
import { DESIGN_CONCEPT_VERSION } from '../contracts/design-concepts.js';
import { DESIGN_ROOT } from './design-concept-service.js';
import { PROJECT_MANIFEST_ROUTE, PROJECT_MANIFEST_VERSION } from '../contracts/project-manifest.js';
import { SPECIALIST_ROUTE, SPECIALIST_VERSION } from '../contracts/specialists.js';
import { INSTRUCTION_ROUTE, RESOLUTION_VERSION } from '../instructions/contracts.js';
import { FEASIBILITY_ROUTE, FEASIBILITY_VERSION } from '../feasibility/contracts.js';

export const DISCOVERY_VERSION = 'capability-discovery-v2';
export const OVERVIEW_VERSION = 'project-overview-v1';
const REVISION = '/api/projects/:projectId/revisions/:revisionId';

/** Revision-bound services that exist as standalone endpoints. `workflowCapability` names the Phase 16 workflow step, if any (scene and analyses are not workflow steps yet). */
export const SERVICES = Object.freeze([
  { serviceId: 'BUILDING_MODEL', version: 'project-revision-v1', persistence: 'IMMUTABLE_REVISION', route: REVISION, workflowCapability: 'REVISION_PERSISTENCE' },
  { serviceId: 'BIM', version: BIM_VERSION, persistence: 'DERIVED_ON_READ', route: `${REVISION}/bim`, workflowCapability: null },
  { serviceId: 'QUANTITY_TAKEOFF', version: TAKEOFF_ENGINE_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: TAKEOFF_OPERATION, workflowCapability: 'QUANTITY_TAKEOFF' },
  { serviceId: 'CONSTRUCTION_CALCULATION', version: CONSTRUCTION_ENGINE_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: CONSTRUCTION_OPERATION, workflowCapability: 'CONSTRUCTION_CALCULATION' },
  { serviceId: 'BOQ_COST', version: COST_ENGINE_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: COST_COLLECTION, workflowCapability: 'BOQ_COST' },
  { serviceId: 'STRUCTURAL_ANALYSIS', version: STRUCTURAL_ANALYSIS_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: STRUCTURAL_ROOT, workflowCapability: null },
  { serviceId: 'ENVIRONMENTAL_ANALYSIS', version: ENVIRONMENTAL_ANALYSIS_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: ENVIRONMENTAL_ROOT, workflowCapability: null },
  { serviceId: 'BUILDING_SYSTEMS_ANALYSIS', version: SYSTEMS_ANALYSIS_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: SYSTEMS_ROOT, workflowCapability: null },
  { serviceId: 'SPECIALIZED_KNOWLEDGE', version: KNOWLEDGE_ANALYSIS_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: KNOWLEDGE_ROOT, workflowCapability: null },
  { serviceId: 'DESIGN_OPTIMIZATION', version: OPTIMIZER_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: OPTIMIZATION_ROOT, workflowCapability: null },
  { serviceId: 'SCENE_3D', version: SCENE_COMPILER_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: SCENE_ROOT, workflowCapability: null },
  { serviceId: 'SELECTIVE_REVISION', version: REVISION_OPERATION_VERSION, persistence: 'CANDIDATE_THEN_IMMUTABLE_REVISION', route: '/api/projects/:projectId/revision-operations', workflowCapability: null },
  // Project-scoped user evidence (Phase 31): inspected, private and never an engine input.
  { serviceId: 'REFERENCE_LIBRARY', version: REFERENCE_INSPECTOR_VERSION, persistence: 'INSPECTED_PRIVATE_BLOB', route: REFERENCE_ROOT, workflowCapability: null },
  // Phase 32: asynchronous execution of SCENE_COMPILE, OPTIMIZATION_STUDY and REVISION_EXECUTE with durable state and recovery.
  { serviceId: 'DURABLE_JOBS', version: JOB_VERSION, persistence: 'DURABLE_JOB_STATE', route: JOB_ROOT, workflowCapability: null },
  // Phase 33: one consistent, hashed snapshot of a project's brief, references, revision and settings (user-stated, not verified).
  { serviceId: 'PROJECT_CONTEXT', version: CONTEXT_VERSION, persistence: 'DERIVED_ON_READ', route: CONTEXT_ROUTE, workflowCapability: null },
  // Phase 34: independent exact site/building verification and scoped revision diffs (statutory compliance not claimed).
  { serviceId: 'COMPLEX_VERIFICATION', version: VERIFIER_VERSION, persistence: 'DERIVED_ON_READ', route: VERIFICATION_ROOT, workflowCapability: null },
  // Phase 35: preliminary engineering assessment (height, areas, volume, base width, conceptual cost arithmetic) and a truthful map of what needs inputs,
  // verified sources, a validated solver or professional review. No structural, wind, seismic or foundation value is produced.
  { serviceId: 'ENGINEERING_ASSESSMENT', version: ASSESSMENT_VERSION, persistence: 'DERIVED_ON_READ', route: ENGINEERING_ROOT, workflowCapability: null },
  // Phase 35.1: geometric zone assessment of a stored revision (validated vertical zones, per-zone quantities, interface checks). Analysis only.
  { serviceId: 'ZONE_ASSESSMENT', version: ZONE_ASSESSMENT_VERSION, persistence: 'DERIVED_ON_READ', route: ZONES_ROOT, workflowCapability: null },
  // Phase 35: deterministic regeneration of a zone, section or exterior skin (TYPICAL_FLOOR, FENESTRATION) as a QA-accepted, preservation-checked candidate that is
  // committed through the supplied-revision route and verified afterwards; and partitioned processing of each zone as its own model. What they do not cover is
  // listed under unsupportedOperations.
  { serviceId: 'ZONE_REGENERATION', version: REGENERATION_VERSION, persistence: 'CANDIDATE_THEN_SUPPLIED_REVISION', route: ZONE_REGENERATION_ROUTE, workflowCapability: null },
  { serviceId: 'ZONE_PARTITIONS', version: PARTITION_VERSION, persistence: 'DERIVED_ON_READ', route: ZONE_PARTITIONS_ROUTE, workflowCapability: null },
  // Phase 36 (first slice): quote → explicit consent → durable job for SCENE_COMPILE and OPTIMIZATION_STUDY on the local pools only. Remote execution
  // is disabled; a successful job is a software-validated artifact, never an engineering validation.
  { serviceId: 'COMPUTE_GATEWAY', version: GATEWAY_VERSION, persistence: 'CONSENTED_DISPATCH_RECORD', route: COMPUTE_ROOT, workflowCapability: null },
  // Phase 37: read-only provenance graph of a revision's stored artifacts with fail-closed freshness (CURRENT, STALE_*, UNVERIFIED). Provenance, never correctness.
  { serviceId: 'DEPENDENCY_GRAPH', version: DEPENDENCY_GRAPH_VERSION, persistence: 'DERIVED_ON_READ', route: DEPENDENCY_GRAPH_ROUTE, workflowCapability: null },
  // Phase 38: revision-bound plan sheets (SVG) and schedules (JSON, CSV) derived from stored geometry only; PDF and DXF are unsupported.
  { serviceId: 'CONSTRUCTION_DOCUMENTS', version: DOCUMENTS_VERSION, persistence: 'DERIVED_ON_READ', route: DOCUMENTS_ROOT, workflowCapability: null },
  // Phase 38: immutable, signed evidence packages (graph, assessment with its flags verbatim, document manifest). Provenance, never a review or a certification.
  { serviceId: 'EVIDENCE_PACKAGES', version: EVIDENCE_PACKAGE_VERSION, persistence: 'IMMUTABLE_ARTIFACT', route: EVIDENCE_ROOT, workflowCapability: null },
  // Phase 39: advisory interior/exterior concepts (1-3 alternatives) from a configured provider or deterministic templates; never geometry, a render or an engineering result.
  { serviceId: 'DESIGN_CONCEPTS', version: DESIGN_CONCEPT_VERSION, persistence: 'ADVISORY_ARTIFACT', route: DESIGN_ROOT, workflowCapability: null },
  // B37 completion: Unified Project Manifest v2 (identity, canonical frame, modules, per-discipline freshness in the roadmap vocabulary). Provenance, never correctness.
  { serviceId: 'PROJECT_MANIFEST', version: PROJECT_MANIFEST_VERSION, persistence: 'DERIVED_ON_READ', route: PROJECT_MANIFEST_ROUTE, workflowCapability: null },
  // B39: the specialist request envelope. Blueprint, Materials, Budget and Structural run the existing engines and store through their own routes'
  // tables; Exterior and Interior store a Phase 30 preflight (APPEARANCE_MODIFY; INTERIOR_FINISH_MODIFY, owner decision D-12 and migration 0029),
  // completed through the existing revision-operation routes. Nothing is stored by the envelope itself (D-8b).
  { serviceId: 'SPECIALISTS', version: SPECIALIST_VERSION, persistence: 'EXISTING_ENGINE_ARTIFACTS', route: SPECIALIST_ROUTE, workflowCapability: null },
  // B41 S1: deterministic instruction resolution into typed intent, targets grounded in stable ids, locks and a B40 change-set draft. Never executes.
  { serviceId: 'INSTRUCTION_RESOLUTION', version: RESOLUTION_VERSION, persistence: 'DERIVED_ON_READ', route: INSTRUCTION_ROUTE, workflowCapability: null },
  // B42 S1: feasibility of a declared ambition against enforced engine limits; concept-only features kept apart; alternatives for consent. Never buildability.
  { serviceId: 'FEASIBILITY_ASSESSMENT', version: FEASIBILITY_VERSION, persistence: 'DERIVED_ON_READ', route: FEASIBILITY_ROUTE, workflowCapability: null },
].map(s => Object.freeze({ ...s, status: 'AVAILABLE' as const })));

/** Media types the frontend may ask for; a static render is never offered as an interactive model. */
export const MEDIA = Object.freeze([
  { media: 'INTERACTIVE_3D_MODEL', status: 'AVAILABLE', serviceId: 'SCENE_3D', mimeType: 'model/gltf-binary', provider: 'deterministic-scene-compiler', reason: null },
  { media: 'APPEARANCE_VARIANT_3D_MODEL', status: 'AVAILABLE', serviceId: 'SELECTIVE_REVISION', mimeType: 'model/gltf-binary', provider: 'deterministic-appearance-compiler',
    reason: 'Exterior wall finish presets over the unchanged scene geometry; visual appearance only' },
  { media: 'CAMERA_NAVIGATION_HINTS', status: 'PARTIAL', serviceId: 'SCENE_3D', mimeType: 'application/json', provider: 'deterministic-scene-compiler',
    reason: 'Camera presets, linear transitions and the QA circulation graph only; no authored camera path or collision-free route' },
  { media: 'EXTERIOR_RENDER', status: 'UNSUPPORTED', serviceId: null, mimeType: null, provider: null, reason: 'NO_RENDER_PROVIDER: EXTERIOR_VISUALIZATION is not implemented' },
  { media: 'INTERIOR_RENDER', status: 'UNSUPPORTED', serviceId: null, mimeType: null, provider: null, reason: 'NO_RENDER_PROVIDER: INTERIOR_VISUALIZATION is not implemented' },
  { media: 'PANORAMA_360', status: 'UNSUPPORTED', serviceId: null, mimeType: null, provider: null, reason: 'NO_RENDER_PROVIDER' },
  { media: 'RENDERED_WALKTHROUGH_VIDEO', status: 'UNSUPPORTED', serviceId: null, mimeType: null, provider: null, reason: 'NO_RENDER_PROVIDER' },
].map(m => Object.freeze(m)));

/** Phase 35.1 adds `modelLimits` (enforced execution limits and their typed refusals) and `unsupportedOperations`; Phase 36 adds `computeProviders`. All additive. */
export const discovery = () => ({ discoveryVersion: DISCOVERY_VERSION, services: SERVICES, media: MEDIA, aiCapabilities: AI_CAPABILITIES,
  modelLimits: MODEL_LIMITS, unsupportedOperations: UNSUPPORTED_OPERATIONS, computeProviders: PROVIDERS });

type Item = { id: string; createdAt: string };
const href = (route: string, projectId: string, revisionId: string) => route.replace(':projectId', projectId).replace(':revisionId', revisionId);
const entry = (serviceId: string, projectId: string, revisionId: string, items: Item[], others: number, truncated = false, route?: string) => {
  const s = SERVICES.find(s => s.serviceId === serviceId)!;
  return { output: serviceId, version: s.version, status: items.length ? 'AVAILABLE' as const : 'NOT_GENERATED' as const,
    artifacts: items.map(i => ({ id: i.id, createdAt: i.createdAt })), otherRevisionArtifacts: others, truncated, href: href(route ?? s.route, projectId, revisionId) };
};

/** Read-only first-version project manifest for one revision. Every reference is bound to this revision; nothing is computed, compiled or fabricated. */
export async function projectOverview(repository: Repository, projectId: string, revisionId: string) {
  // Ownership is established by this read (RLS) before any other lookup.
  const revision = ProjectRevisionDetailSchema.parse(await new ProjectRepository(repository).read('revision', projectId, revisionId));
  const [takeoffs, costs, structural, environmental, systems, knowledge, optimization, scene] = await Promise.all([
    new TakeoffRepository(repository).list(projectId, revisionId, { limit: 20 }), new CostRepository(repository).list(projectId, revisionId, { limit: 20 }),
    structuralStatus(repository, projectId, revisionId), environmentalStatus(repository, projectId, revisionId), systemsStatus(repository, projectId, revisionId),
    knowledgeStatus(repository, projectId, revisionId), optimizationStatus(repository, projectId, revisionId), sceneStatus(repository, projectId, revisionId)]);
  // ponytail: one list call per listed takeoff (≤ 20); a revision-wide construction listing would make this a single call.
  const construction = await Promise.all(takeoffs.items.map(t => new ConstructionRepository(repository).list(projectId, revisionId, t.id, { limit: 20 })));
  const revisions = repository.revisionRpc ? new RevisionRepository(repository) : null;
  const [appearance, lineage] = revisions ? await Promise.all([revisions.appearance(projectId, revisionId), revisions.lineage(projectId, revisionId)]) : [null, null];
  const current = scene.projectCurrentRevisionId, hash = modelHash(revision.model);
  return {
    overviewVersion: OVERVIEW_VERSION, projectId, revisionId, revisionNumber: revision.revisionNumber, parentRevisionId: revision.parentRevisionId,
    projectCurrentRevisionId: current, revisionCurrency: revisionId === current ? 'CURRENT' as const : 'HISTORICAL' as const,
    revision: { sourceMode: revision.sourceMode, generatorVersion: revision.generatorVersion, createdAt: revision.createdAt, modelHash: hash,
      identityConsistent: !revision.identity || revision.identity.modelHash === hash, identity: revision.identity ?? null,
      qa: { id: revision.qa.id, qaVersion: revision.qa.qaVersion, status: revision.qa.status, summary: revision.qa.summary },
      levels: revision.model.levels.length, spaces: revision.model.spaces.length, walls: revision.model.walls.length, openings: revision.model.openings.length },
    outputs: [
      entry('BUILDING_MODEL', projectId, revisionId, [{ id: revision.id, createdAt: revision.createdAt }], 0),
      { ...entry('BIM', projectId, revisionId, [], 0), status: 'DERIVED_ON_READ' as const },
      entry('QUANTITY_TAKEOFF', projectId, revisionId, takeoffs.items, 0, takeoffs.nextCursor !== null),
      entry('CONSTRUCTION_CALCULATION', projectId, revisionId, construction.flatMap(c => c.items), 0,
        takeoffs.nextCursor !== null || construction.some(c => c.nextCursor !== null), `${REVISION}/takeoffs`),
      entry('BOQ_COST', projectId, revisionId, costs.items, 0, costs.nextCursor !== null),
      entry('STRUCTURAL_ANALYSIS', projectId, revisionId, structural.analyses, structural.staleAnalyses.length),
      entry('ENVIRONMENTAL_ANALYSIS', projectId, revisionId, environmental.analyses, environmental.staleAnalyses.length),
      entry('BUILDING_SYSTEMS_ANALYSIS', projectId, revisionId, systems.analyses, systems.staleAnalyses.length),
      entry('SPECIALIZED_KNOWLEDGE', projectId, revisionId, knowledge.analyses, knowledge.staleAnalyses.length),
      entry('DESIGN_OPTIMIZATION', projectId, revisionId, optimization.studies, optimization.staleStudies.length),
      entry('SCENE_3D', projectId, revisionId, scene.artifacts, scene.staleArtifacts.length),
    ],
    appearance: { status: appearance?.appearance ? 'APPEARANCE_VARIANT' as const : 'DEFAULT_PLACEHOLDER' as const, appearanceHash: appearance?.appearanceHash ?? null,
      artifactId: appearance?.artifact?.id ?? null, href: href(`${REVISION}/appearance`, projectId, revisionId) },
    // An appearance-only or model-identical restore revision keeps its base geometry: base engineering results are source-equivalent (not recomputed).
    lineage: lineage?.operation ? { operationId: lineage.operation.id, kind: lineage.operation.kind, baseRevisionId: lineage.operation.baseRevisionId,
      modelEquivalentToBase: lineage.modelEquivalentToBase } : null,
    unsupported: [
      ...CAPABILITIES.filter(c => c.implementationStatus !== 'AVAILABLE' && ['PROFESSIONAL_2D', 'INTERIOR_DESIGN', 'EXTERIOR_DESIGN', 'HOLOGRAPHIC_MODEL'].includes(c.capabilityId))
        .map(c => ({ output: c.capabilityId, reason: 'CAPABILITY_NOT_IMPLEMENTED' })),
      ...MEDIA.filter(m => m.status === 'UNSUPPORTED').map(m => ({ output: m.media, reason: m.reason! })),
    ],
    claims: { engineeringReview: 'NOT_CLAIMED' as const, structural: structural.claims, environmental: environmental.claims, systems: systems.claims,
      knowledge: knowledge.claims, optimization: optimization.claims },
  };
}
