// Regression fixture for source-mode workers (Node 22.22.0): it needs tsx inside the worker thread for two reasons that Node's
// built-in strip-only TypeScript loader cannot satisfy: a '.js' specifier that names a '.ts' file, and a TypeScript enum.
import { parentPort } from 'node:worker_threads';
import type { WorkerJob, WorkerReply } from '../../apps/api/src/lib/worker-pool.js';
import { Marker, describeMarker } from './resolution-dep.js';

parentPort?.on('message', (job: WorkerJob) => {
  const reply: WorkerReply = { id: job.id, ok: true, marker: describeMarker(Marker.Resolved), echo: job.input };
  parentPort!.postMessage(reply);
});
