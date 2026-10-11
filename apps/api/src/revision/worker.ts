import { parentPort } from 'node:worker_threads';
import type { WorkerJob, WorkerReply } from '../lib/worker-pool.js';
import { SceneError } from '../scene3d/contracts.js';
import type { SceneSource } from '../scene3d/job.js';
import { RevisionError } from './contracts.js';
import { runAppearanceJob } from './job.js';

/** Worker entry: one appearance candidate per message; only serializable data crosses the boundary. */
parentPort?.on('message', (job: WorkerJob) => {
  let reply: WorkerReply;
  try {
    const result = runAppearanceJob(job.source as SceneSource, job.input);
    reply = { id: job.id, ok: true, manifest: result.manifest, glb: result.glb, validation: result.validation, timingsMs: result.timingsMs };
  } catch (error) {
    // Typed refusals pass through; anything else is reported without internals.
    reply = { id: job.id, ok: false, error: error instanceof SceneError ? { code: error.code, message: error.message, details: error.details }
      : error instanceof RevisionError ? { code: error.code, message: error.message, details: {} }
        : { code: 'SCENE_WORKER_FAILED', message: 'The appearance worker failed', details: {} } };
  }
  parentPort!.postMessage(reply);
});
