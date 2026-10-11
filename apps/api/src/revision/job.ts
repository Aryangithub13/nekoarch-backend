import { performance } from 'node:perf_hooks';
import type { BuildingModelV2 } from '@designflow/shared';
import { runSceneJob, type SceneSource } from '../scene3d/job.js';
import { SceneError, type SceneManifest } from '../scene3d/contracts.js';
import { applyAppearance } from './appearance.js';
import { verifyAppearance } from './verify.js';
import type { AppearanceManifest, RevisionValidation } from './contracts.js';

export interface AppearanceJobResult { manifest: AppearanceManifest; glb: Uint8Array; validation: RevisionValidation; baseScene: SceneManifest; timingsMs: Record<string, number> }

/** One worker job: the unchanged Phase 29 compile + validator on the base, the material-only pass, then the independent appearance validator.
 * An INVALID candidate is a refusal, never a result. */
export function runAppearanceJob(source: SceneSource, appearance: unknown, apply: typeof applyAppearance = applyAppearance): AppearanceJobResult {
  const started = performance.now(), base = runSceneJob(source, {}), compiled = performance.now();
  const baseGlb = Buffer.from(base.glb), candidate = apply(source.model as BuildingModelV2, base.manifest, baseGlb, appearance as never), applied = performance.now();
  const validation = verifyAppearance(source.model as BuildingModelV2, { manifest: base.manifest, glb: baseGlb, validation: base.validation }, candidate, appearance);
  if (validation.status !== 'VALID') throw new SceneError('SCENE_VALIDATION_FAILED', 'Independent appearance validation rejected the candidate', { failures: validation.failures.slice(0, 5).join(' | ').slice(0, 900) });
  return { manifest: candidate.manifest, glb: new Uint8Array(candidate.glb), validation, baseScene: base.manifest,
    timingsMs: { baseCompileAndValidate: compiled - started, appearance: applied - compiled, validate: performance.now() - applied } };
}
