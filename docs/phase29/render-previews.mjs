/* global process, Buffer, console */
// Phase 29 visual acceptance: offline software rasterizer (no GPU, no network). It reads the GLB through the independent
// @gltf-transform/core parser and frames views from the manifest cameras. Supplementary evidence; it does not replace validation.
// Usage: node docs/phase29/render-previews.mjs <scene.glb> <manifest.json> <out-dir> <name>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';

const args = process.argv.slice(2);
if (args.length !== 4 || args.some(a => a.startsWith('-'))) { console.error('usage: render-previews.mjs <scene.glb> <manifest.json> <out-dir> <name>'); process.exit(2); }
const [glbPath, manifestPath, outDir, name] = args;
const W = 960, H = 640;
const doc = await new NodeIO().readBinary(new Uint8Array(readFileSync(glbPath)));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Flatten world-space triangles (metres) with node metadata.
const tris = [];
const visit = (node, offset) => {
  const t = node.getTranslation(), o = [offset[0] + t[0], offset[1] + t[1], offset[2] + t[2]];
  const mesh = node.getMesh(), extras = node.getExtras();
  if (mesh) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION').getArray(), nrm = prim.getAttribute('NORMAL').getArray(), idx = prim.getIndices().getArray();
    const mat = prim.getMaterial(), color = mat.getBaseColorFactor(), blend = mat.getAlphaMode() === 'BLEND';
    for (let i = 0; i < idx.length; i += 3) {
      const v = [0, 1, 2].map(k => [pos[idx[i + k] * 3] + o[0], pos[idx[i + k] * 3 + 1] + o[1], pos[idx[i + k] * 3 + 2] + o[2]]);
      tris.push({ v, n: [nrm[idx[i] * 3], nrm[idx[i] * 3 + 1], nrm[idx[i] * 3 + 2]], color, blend, layer: extras.layer, levelId: extras.levelId, quadSecond: (i / 3) % 2 === 1 });
    }
  }
  for (const child of node.listChildren()) visit(child, o);
};
for (const root of doc.getRoot().getDefaultScene().listChildren()) visit(root, [0, 0, 0]);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const m = p => [p.x / 1000, p.y / 1000, p.z / 1000];

function render(camera, filter, file) {
  const color = new Float32Array(W * H * 3).fill(0.94), depth = new Float32Array(W * H).fill(Infinity);
  const eye = m(camera.position), f = norm(sub(m(camera.target), eye)), r = norm(cross(f, m(camera.up))), u = cross(r, f);
  const fpx = (H / 2) / Math.tan((camera.verticalFovMilliDegrees / 1000) * Math.PI / 360), light = norm([0.45, 0.85, 0.3]);
  const project = p => { const d = sub(p, eye), z = dot(d, f); return [W / 2 + dot(d, r) / z * fpx, H / 2 - dot(d, u) / z * fpx, z]; };
  const shown = tris.filter(filter), passes = [shown.filter(t => !t.blend), shown.filter(t => t.blend)];
  for (const [pass, list] of passes.entries()) for (const t of list) {
    const s = t.v.map(project);
    if (s.some(p => p[2] < 0.05)) continue;
    const shade = 0.45 + 0.55 * Math.max(0, dot(t.n, light)), c = [t.color[0] * shade, t.color[1] * shade, t.color[2] * shade], a = pass ? t.color[3] : 1;
    const minX = Math.max(0, Math.floor(Math.min(...s.map(p => p[0])))), maxX = Math.min(W - 1, Math.ceil(Math.max(...s.map(p => p[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...s.map(p => p[1])))), maxY = Math.min(H - 1, Math.ceil(Math.max(...s.map(p => p[1]))));
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
      const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = 1 / (w0 / s[0][2] + w1 / s[1][2] + w2 / s[2][2]), k = y * W + x;
      if (z >= depth[k]) continue;
      if (!pass) depth[k] = z;
      for (let ch = 0; ch < 3; ch++) color[k * 3 + ch] = color[k * 3 + ch] * (1 - a) + c[ch] * a;
    }
    // Quad outline edges (skip the shared diagonal) for an architectural line drawing.
    if (pass) continue;
    const edges = t.quadSecond ? [[1, 2], [2, 0]] : [[0, 1], [1, 2]];
    for (const [i, j] of edges) {
      const steps = Math.ceil(Math.hypot(s[j][0] - s[i][0], s[j][1] - s[i][1])) + 1;
      for (let q = 0; q <= steps; q++) {
        const tt = q / steps, x = Math.round(s[i][0] + (s[j][0] - s[i][0]) * tt), y = Math.round(s[i][1] + (s[j][1] - s[i][1]) * tt);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const z = 1 / ((1 - tt) / s[i][2] + tt / s[j][2]), k = y * W + x;
        if (z <= depth[k] * 1.002) for (let ch = 0; ch < 3; ch++) color[k * 3 + ch] = 0.18;
      }
    }
  }
  writeFileSync(file, png(color));
}

function png(rgb) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++)
    raw[y * (W * 3 + 1) + 1 + x * 3 + c] = Math.max(0, Math.min(255, Math.round(rgb[(y * W + x) * 3 + c] * 255)));
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), sum = Buffer.alloc(4);
    len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(outDir, { recursive: true });
const cam = id => manifest.cameras.find(c => c.id === id);
const visible = (c, extraHidden = []) => t => !c.hiddenLayers.includes(t.layer) && !extraHidden.includes(t.layer) && c.visibleLevelIds.includes(t.levelId);
const out = [];
const shot = (label, c, filter) => { const file = `${outDir}/${name}-${label}.png`; render(c, filter, file); out.push(file); };
shot('exterior-three-quarter', cam('three-quarter'), visible(cam('three-quarter')));
shot('interior-roof-hidden', cam('interior-roof-hidden'), visible(cam('interior-roof-hidden')));
shot('top-down-roof-hidden', cam('top-down'), visible(cam('top-down'), ['ROOFS']));
const levels = manifest.levels;
if (levels.length > 1) {
  const upper = levels[levels.length - 1].levelId, c = cam(`floor:${upper}`);
  shot('upper-floor-isolated', c, t => t.levelId === upper && !c.hiddenLayers.includes(t.layer));
  const lower = levels[0].levelId, cl = cam(`floor:${lower}`);
  shot('lower-floor-with-stair', cl, t => t.levelId === lower && !cl.hiddenLayers.includes(t.layer));
}
const stair = manifest.objects.find(o => o.geometryRole === 'stair-flight');
if (stair) {
  const b = stair.bounds, target = { x: Math.floor((b.min.x + b.max.x) / 2), y: b.min.y, z: Math.floor((b.min.z + b.max.z) / 2) };
  const base = { ...cam('top-down'), target, hiddenLayers: ['ROOFS', 'ROOM_VOLUMES', 'SEMANTIC_HELPERS'] };
  shot('stair-and-slab-void-from-above', { ...base, position: { x: target.x + 1, y: target.y + 9000, z: target.z } }, t => !base.hiddenLayers.includes(t.layer));
  shot('stair-detail-lower-level', { ...base, up: { x: 0, y: 1, z: 0 }, position: { x: target.x - 4200, y: target.y + 6800, z: target.z + 2600 } },
    t => t.levelId === stair.levelId && !base.hiddenLayers.includes(t.layer));
}
console.log(JSON.stringify({ triangles: tris.length, images: out }));
