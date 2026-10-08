import { parentPort } from 'node:worker_threads';
import type { WorkerJob, WorkerReply } from '../lib/worker-pool.js';
import { SceneError } from './contracts.js';
import { runSceneJob, type SceneSource } from './job.js';

/** Worker entry: one deterministic compile + independent validation per message; only serializable data crosses the boundary. */
parentPort?.on('message', (job: WorkerJob) => {
  let reply: WorkerReply;
  try {
    const result = runSceneJob(job.source as SceneSource, job.input);
    reply = { id: job.id, ok: true, manifest: result.manifest, glb: result.glb, validation: result.validation, timingsMs: result.timingsMs };
  } catch (error) {
    // Typed refusals pass through; anything else is reported without internals (no message or stack).
    reply = { id: job.id, ok: false, error: error instanceof SceneError ? { code: error.code, message: error.message, details: error.details }
      : { code: 'SCENE_WORKER_FAILED', message: 'The scene worker failed', details: {} } };
  }
  parentPort!.postMessage(reply);
});
