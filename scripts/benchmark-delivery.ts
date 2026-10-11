import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { bindingFor, sceneModels } from '../test-support/scene-fixtures.js';
import { compileScene } from '../apps/api/src/scene3d/compile.js';

// Modernization R07-B: bytes on the wire for scene assets, Phase 29 delivery (identity, no revalidation) vs modernized (gzip; 304 for unchanged GLB). Observations, not SLOs.
const round = (n: number) => Math.round(n * 100) / 100, median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const rows = Object.entries(sceneModels()).map(([name, model]) => {
  const { glb, manifest } = compileScene(model, bindingFor(model)), json = Buffer.from(JSON.stringify(manifest));
  const time = (body: Buffer) => median(Array.from({ length: 9 }, () => { const t = performance.now(); gzipSync(body); return performance.now() - t; }));
  const glbGzip = gzipSync(glb).length, manifestGzip = gzipSync(json).length;
  return { name, objects: manifest.statistics.objects,
    glb: { identityBytes: glb.length, gzipBytes: glbGzip, ratio: round(glb.length / glbGzip), gzipMedianMs: round(time(glb)), revalidatedBytes: 0 },
    manifest: { identityBytes: json.length, gzipBytes: manifestGzip, ratio: round(json.length / manifestGzip), gzipMedianMs: round(time(json)) },
    firstLoad: { phase29Bytes: glb.length + json.length, modernizedBytes: glbGzip + manifestGzip },
    reload: { phase29Bytes: glb.length + json.length, modernizedBytes: manifestGzip } };
});
const out = { benchmark: 'scene-asset-delivery-v1', node: process.version, generatedBy: 'scripts/benchmark-delivery.ts', rows };
await mkdir('docs/modernization/evidence', { recursive: true });
await writeFile('docs/modernization/evidence/delivery-benchmark.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(rows.map(r => ({ name: r.name, firstLoad: r.firstLoad, reload: r.reload })), null, 1));
