import { parentPort } from 'node:worker_threads';
import { OptimizationError, type OptimizationSource } from './contracts.js';
import { runOptimizationStudy } from './study.js';

/** Worker entry: runs one pure, deterministic study per message. Only serializable data crosses the boundary. */
export interface WorkerJob { id: number; source: OptimizationSource; input: unknown }
export type WorkerReply = { id: number; ok: true; study: unknown; timingsMs: Record<string, number> }
  | { id: number; ok: false; error: { code: string; message: string; details: Record<string, string> } };

parentPort?.on('message', (job: WorkerJob) => {
  let reply: WorkerReply;
  try {
    const { study, diagnostics } = runOptimizationStudy(job.source, job.input);
    reply = { id: job.id, ok: true, study, timingsMs: diagnostics.timingsMs };
  } catch (error) {
    // Typed refusals pass through; anything else is reported without internals (no message or stack).
    reply = { id: job.id, ok: false, error: error instanceof OptimizationError ? { code: error.code, message: error.message, details: error.details }
      : { code: 'OPTIMIZATION_WORKER_FAILED', message: 'The optimization worker failed', details: {} } };
  }
  parentPort!.postMessage(reply);
});
