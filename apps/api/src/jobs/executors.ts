import type { ScenePool } from '../scene3d/pool.js';
import type { OptimizationPool } from '../optimization/pool.js';
import type { AppearancePool } from '../revision/pool.js';
import { createSceneArtifact } from '../services/scene-service.js';
import { createOptimizationStudy } from '../services/optimization-service.js';
import { executeOperation } from '../services/revision-service.js';
import type { JobKind } from './contracts.js';
import type { Executor } from './runner.js';

export interface JobPools { scene: () => ScenePool; optimization: () => OptimizationPool; appearance: () => AppearancePool }

/**
 * Each executor calls the unchanged Phase 28–30 service with the dispatching owner's repository, so every ownership, QA, signing and
 * SQL re-computation check applies exactly as on the synchronous route. Scene and optimization expose their compute → persist boundary
 * through `onRun`; revision execution does not, so it can only be cancelled before it starts.
 */
export function createExecutors(pools: JobPools, secret?: string): Record<JobKind, Executor> {
  return {
    SCENE_COMPILE: async ({ repository, userId, projectId, request, computed }) => {
      if (request.kind !== 'SCENE_COMPILE') throw new TypeError('kind');
      const detail = await createSceneArtifact(repository, pools.scene(), userId, projectId, request.revisionId, {}, secret, undefined, () => computed());
      return { resultKind: 'SCENE_ARTIFACT', resultId: detail.id, href: `/api/projects/${projectId}/revisions/${request.revisionId}/scene/artifacts/${detail.id}` };
    },
    OPTIMIZATION_STUDY: async ({ repository, userId, projectId, request, computed }) => {
      if (request.kind !== 'OPTIMIZATION_STUDY') throw new TypeError('kind');
      const detail = await createOptimizationStudy(repository, pools.optimization(), userId, projectId, request.revisionId, request.input, secret, undefined, () => computed());
      return { resultKind: 'OPTIMIZATION_STUDY', resultId: detail.id, href: `/api/projects/${projectId}/revisions/${request.revisionId}/optimization/studies/${detail.id}` };
    },
    REVISION_EXECUTE: async ({ repository, userId, projectId, request }) => {
      if (request.kind !== 'REVISION_EXECUTE') throw new TypeError('kind');
      const operation = await executeOperation(repository, pools.appearance, userId, projectId, request.operationId, { preflightHash: request.preflightHash }, secret);
      return { resultKind: 'REVISION_OPERATION', resultId: operation.id, href: `/api/projects/${projectId}/revision-operations/${operation.id}` };
    },
  };
}
