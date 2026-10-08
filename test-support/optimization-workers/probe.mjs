// Test-only optimization worker probe: misbehaves on demand so pool failure handling can be proven.
/* global process, setTimeout */
import { parentPort, workerData } from 'node:worker_threads';
parentPort.on('message', job => {
  const mode = job.input?.probe ?? workerData?.mode; // workerData lets HTTP tests send fully valid input
  if (mode === 'crash') process.exit(3);
  if (mode === 'throw') throw new Error('probe failure');
  if (mode === 'hang') for (;;);
  if (mode === 'sleep') { setTimeout(() => parentPort.postMessage({ id: job.id, ok: false, error: { code: 'OPTIMIZATION_RESOURCE_LIMIT', message: 'slept', details: {} } }), job.input.ms); return; }
  if (mode === 'garbage') { parentPort.postMessage({ id: job.id, ok: true, study: { forged: true }, timingsMs: {} }); return; }
  parentPort.postMessage({ id: job.id, ok: false, error: { code: 'OPTIMIZATION_INPUT_INVALID', message: 'probe', details: { echo: String(mode) } } });
});
