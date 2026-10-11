import { parentPort } from 'node:worker_threads';
import type { WorkerJob, WorkerReply } from '../lib/worker-pool.js';
import { inspectReference } from './inspect.js';

/** Worker entry: untrusted bytes are parsed only here; one inspection per message, only serializable data crosses the boundary. */
parentPort?.on('message', (job: WorkerJob) => {
  let reply: WorkerReply;
  try {
    const { report, stored } = inspectReference(job.source as Uint8Array, (job.input as { declaredMediaType: string }).declaredMediaType);
    reply = { id: job.id, ok: true, report, stored };
  } catch {
    reply = { id: job.id, ok: false, error: { code: 'REFERENCE_WORKER_FAILED', message: 'The inspection worker failed', details: {} } };
  }
  parentPort!.postMessage(reply);
});
