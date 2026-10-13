// Source-mode worker entry (tests and `tsx` runs only; compiled workers start from dist/*.js and never load this file).
// It registers tsx inside the worker thread, then imports the TypeScript worker named in workerData.entry.
// Why: on some Node 22 releases (observed on 22.22.0, not on 22.23.2) a worker started with execArgv ['--import', 'tsx']
// runs without the tsx hooks. Node's built-in strip-only TypeScript loader then loads the entry, but it does not map
// '.js' specifiers to '.ts' files, so the worker's first relative import fails with ERR_MODULE_NOT_FOUND.
import { workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
await import(workerData.entry);
