import { performance } from 'node:perf_hooks';
import { compileScene } from './compile.js';
import { validateScene } from './validate.js';
import { SceneError, type SceneBinding, type SceneManifest, type SceneValidation } from './contracts.js';

export interface SceneSource { model: unknown; binding: SceneBinding }
export interface SceneJobResult { manifest: SceneManifest; glb: Uint8Array; validation: SceneValidation; timingsMs: Record<string, number> }

/** One worker job: compile, then the independent validator; an INVALID scene is a refusal, never a result. */
export function runSceneJob(source: SceneSource, input: unknown, compile: typeof compileScene = compileScene): SceneJobResult {
  const started = performance.now(), { manifest, glb, timingsMs: stages } = compile(source.model, source.binding, input), compiled = performance.now();
  const validation = validateScene(source.model, source.binding, manifest, glb);
  if (validation.status !== 'VALID') throw new SceneError('SCENE_VALIDATION_FAILED', 'Independent scene validation rejected the compiled scene', { failures: validation.failures.slice(0, 5).join(' | ').slice(0, 900) });
  return { manifest, glb: new Uint8Array(glb), validation, timingsMs: { ...stages, compile: compiled - started, validate: performance.now() - compiled } };
}
