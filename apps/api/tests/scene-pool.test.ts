import { afterEach, describe, expect, it } from 'vitest';
import { bindingFor, sceneModels } from '../../../test-support/scene-fixtures.js';
import { runSceneJob } from '../src/scene3d/job.js';
import { SCENE_POOL_DEFAULTS, ScenePool } from '../src/scene3d/pool.js';
import { SCENE_LIMITS } from '../src/scene3d/contracts.js';

const pools: ScenePool[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
const pool = (options: ConstructorParameters<typeof ScenePool>[0] = {}) => { const p = new ScenePool(options); pools.push(p); return p; };
const probe = (mode: string) => ({ url: new URL('../../../test-support/scene-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode } });
async function rejection(promise: Promise<unknown>) { try { await promise; } catch (error) { return error as Error & { code?: string }; } throw new Error('expected rejection'); }
const { setback } = sceneModels(), source = { model: setback, binding: bindingFor(setback) };
const genuine = runSceneJob(source, {}), precomputed = { manifest: genuine.manifest, glb: genuine.glb, validation: genuine.validation };

describe('Phase 29 scene worker pool', () => {
  it('uses bounded defaults and rejects invalid bounds', () => {
    expect(SCENE_POOL_DEFAULTS.size).toBeGreaterThanOrEqual(1);
    expect(SCENE_POOL_DEFAULTS.size).toBeLessThanOrEqual(2);
    expect(SCENE_POOL_DEFAULTS.queueLimit).toBe(8);
    expect(SCENE_POOL_DEFAULTS.timeoutMs).toBe(SCENE_LIMITS.compileDeadlineMs);
    expect(() => new ScenePool({ size: 0 })).toThrow(RangeError);
  });

  it('compiles in a real worker byte-identically to the in-process compiler, off the request thread', async () => {
    const p = pool({ size: 1 }), run = await p.run(source, {});
    expect(Buffer.compare(run.glb, Buffer.from(genuine.glb))).toBe(0);
    expect(run.manifest).toEqual(genuine.manifest);
    expect(run.validation.status).toBe('VALID');
    expect(run.workerMs).toBeGreaterThan(0);
  });

  it('passes typed refusals through and reports crashes, garbage, unvalidated and tampered output as worker failures', async () => {
    expect((await rejection(pool({ worker: probe('refuse') }).run({ ...source, precomputed }, {}))).code).toBe('SCENE_RESOURCE_LIMIT');
    for (const mode of ['crash', 'throw', 'garbage', 'unvalidated', 'tampered']) {
      const p = pool({ size: 1, worker: probe(mode) });
      expect((await rejection(p.run({ ...source, precomputed }, {}))).code, mode).toBe('SCENE_WORKER_FAILED');
    }
    const ok = await pool({ worker: probe('echo') }).run({ ...source, precomputed }, {});
    expect(ok.manifest.binary.sha256).toBe(genuine.manifest.binary.sha256);
  });

  it('terminates a timed-out worker and refuses queue overflow immediately', async () => {
    const hang = pool({ size: 1, queueLimit: 1, timeoutMs: 200, worker: probe('hang') });
    const running = hang.run({ ...source, precomputed }, {}), queued = hang.run({ ...source, precomputed }, {});
    expect((await rejection(hang.run({ ...source, precomputed }, {}))).code).toBe('SCENE_QUEUE_FULL');
    expect((await rejection(running)).code).toBe('SCENE_WORKER_TIMEOUT');
    expect((await rejection(queued)).code).toBe('SCENE_WORKER_TIMEOUT');
    expect(hang.stats()).toMatchObject({ busy: 0, queued: 0 });
  });

  it('drains on close: queued jobs are refused, running jobs finish, later jobs are unavailable', async () => {
    const p = new ScenePool({ size: 1, queueLimit: 2, worker: probe('sleep') });
    const running = p.run({ ...source, precomputed }, {}), queued = p.run({ ...source, precomputed }, {});
    await new Promise(resolve => setTimeout(resolve, 50));
    const closing = p.close();
    expect((await running).manifest.binary.sha256).toBe(genuine.manifest.binary.sha256);
    expect((await rejection(queued)).code).toBe('SCENE_UNAVAILABLE');
    await closing;
    expect((await rejection(p.run({ ...source, precomputed }, {}))).code).toBe('SCENE_UNAVAILABLE');
  });
});
