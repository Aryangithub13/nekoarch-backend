/* global process */
// Test-only appearance worker: misbehaves on purpose so the Phase 30 failure paths can be proven end to end.
import { parentPort, workerData } from 'node:worker_threads';

parentPort.on('message', job => {
  const reply = payload => parentPort.postMessage({ id: job.id, ...payload });
  const mode = workerData?.mode;
  if (mode === 'crash') process.exit(3);
  if (mode === 'hang') return;
  if (mode === 'garbage') return reply({ ok: true, manifest: { nonsense: true }, glb: new Uint8Array(4), validation: {}, timingsMs: {} });
  if (mode === 'invalid') return reply({ ok: false, error: { code: 'SCENE_VALIDATION_FAILED', message: 'probe: independent appearance validation rejected the candidate', details: {} } });
  return reply({ ok: false, error: { code: 'SCENE_UNSUPPORTED_MODEL', message: 'probe refusal', details: {} } });
});
