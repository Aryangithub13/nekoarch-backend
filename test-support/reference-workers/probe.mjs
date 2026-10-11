/* global process */
// Test-only inspection worker: misbehaves on purpose so the pool's failure paths can be proven.
// `workerData.reply` carries a genuine {report, stored} computed in-process by the test for *different* bytes.
import { parentPort, workerData } from 'node:worker_threads';

parentPort.on('message', job => {
  const mode = workerData?.mode, reply = payload => parentPort.postMessage({ id: job.id, ...payload });
  if (mode === 'crash') process.exit(3);
  if (mode === 'hang') return;
  if (mode === 'garbage') return reply({ ok: true, report: { verdict: 'ACCEPTED' }, stored: new Uint8Array(4) });
  if (mode === 'tampered') { const stored = new Uint8Array(workerData.reply.stored); stored[stored.length - 1] ^= 1; return reply({ ok: true, report: workerData.reply.report, stored }); }
  if (mode === 'refuse') return reply({ ok: false, error: { code: 'ANYTHING', message: 'probe refusal', details: {} } });
  return reply({ ok: true, ...workerData.reply }); // 'liar': a valid report, but for other bytes
});
