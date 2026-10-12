// Test-only worker entry: registers tsx inside the worker, then loads the TypeScript worker named in workerData.entry.
// On some Node 22 releases `execArgv: ['--import', 'tsx']` does not apply tsx's .js → .ts resolution inside worker_threads.
import { workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
await import(workerData.entry);
