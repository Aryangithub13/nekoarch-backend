/* global process, setTimeout */
// Test-only scene worker: misbehaves on purpose so the pool's failure paths can be proven.
// `job.source.precomputed` carries a genuine compiled {manifest, glb, validation} produced in-process by the test.
import { parentPort, workerData } from 'node:worker_threads';

parentPort.on('message', job => {
  const mode = job.input?.probe ?? workerData?.mode, ok = job.source?.precomputed;
  const reply = payload => parentPort.postMessage({ id: job.id, ...payload });
  if (mode === 'crash') process.exit(3);
  if (mode === 'throw') throw new Error('probe failure');
  if (mode === 'hang') return;
  if (mode === 'sleep') { setTimeout(() => reply({ ok: true, ...ok, timingsMs: {} }), 300); return; }
  if (mode === 'garbage') return reply({ ok: true, manifest: { nonsense: true }, glb: new Uint8Array(4), validation: {}, timingsMs: {} });
  if (mode === 'unvalidated') return reply({ ok: true, ...ok, validation: { ...ok.validation, status: 'INVALID', failures: ['planted'] }, timingsMs: {} });
  if (mode === 'tampered') { const glb = new Uint8Array(ok.glb); glb[glb.length - 40] ^= 1; return reply({ ok: true, ...ok, glb, timingsMs: {} }); }
  if (mode === 'refuse') return reply({ ok: false, error: { code: 'SCENE_RESOURCE_LIMIT', message: 'probe refusal', details: {} } });
  return reply({ ok: true, ...ok, timingsMs: {} });
});
