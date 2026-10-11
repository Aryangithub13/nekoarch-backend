import { deflateSync } from 'node:zlib';
import { crc32 } from '../apps/api/src/references/inspect.js';

/** Phase 31 fixtures: small, structurally exact files built byte by byte, plus the hostile variants the inspector must refuse. */
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

export function pngChunk(type: string, data: Buffer = Buffer.alloc(0), crc?: number) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc ?? crc32(body))]);
}
export function png(options: { width?: number; height?: number; text?: boolean; badCrc?: boolean; chunks?: Buffer[]; ihdr?: { width: number; height: number } } = {}) {
  const width = options.width ?? 4, height = options.height ?? 3;
  const ihdr = Buffer.concat([u32(options.ihdr?.width ?? width), u32(options.ihdr?.height ?? height), Buffer.from([8, 2, 0, 0, 0])]);
  // One filter byte per row, then RGB pixels in a deterministic gradient.
  const rows = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.from([0, ...Array.from({ length: width * 3 }, (_, x) => (x * 7 + y * 13) & 0xff)])));
  const idat = pngChunk('IDAT', deflateSync(rows));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('sRGB', Buffer.from([0])),
    ...(options.text ? [pngChunk('tEXt', Buffer.from('GPS\x0028.6139 N, 77.2090 E', 'latin1')), pngChunk('eXIf', Buffer.from('MM\x00\x2a\x00\x00\x00\x08', 'latin1'))] : []),
    ...(options.chunks ?? []),
    options.badCrc ? Buffer.concat([idat.subarray(0, idat.length - 1), Buffer.from([idat[idat.length - 1]! ^ 1])]) : idat, pngChunk('IEND')]);
}
/** The IDAT chunk of a PNG (pixel data), to prove metadata removal never touches it. */
export const pngIdat = (bytes: Buffer) => { const i = bytes.indexOf('IDAT', 8, 'latin1') - 4; return bytes.subarray(i, i + 12 + bytes.readUInt32BE(i)); };

const seg = (marker: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(data.length + 2) >> 8, (data.length + 2) & 0xff]), data]);
export const JPEG_SCAN = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]); // stuffed 0xFF00 and a restart marker inside entropy data
export function jpeg(options: { width?: number; height?: number; exif?: boolean; comment?: boolean; icc?: boolean; mpf?: boolean; trailing?: Buffer } = {}) {
  const width = options.width ?? 640, height = options.height ?? 480;
  const sof = Buffer.from([8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]);
  const body = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\x00\x01\x02\x00\x00\x01\x00\x01\x00\x00', 'latin1')),
    ...(options.exif ? [seg(0xe1, Buffer.from('Exif\x00\x00MM\x00\x2a GPSLatitude 28.6139 GPSLongitude 77.2090', 'latin1'))] : []),
    ...(options.icc ? [seg(0xe2, Buffer.from('ICC_PROFILE\x00\x01\x01fake-profile', 'latin1'))] : []),
    ...(options.mpf ? [seg(0xe2, Buffer.from('MPF\x00MM\x00\x2a', 'latin1'))] : []),
    ...(options.comment ? [seg(0xfe, Buffer.from('Taken by A. Person at home', 'latin1'))] : []),
    seg(0xdb, Buffer.alloc(65, 1)), seg(0xc0, sof), seg(0xc4, Buffer.alloc(29, 0)), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), JPEG_SCAN, Buffer.from([0xff, 0xd9])]);
  return Buffer.concat([body, ...(options.mpf ? [Buffer.from([0xff, 0xd8, 0xff, 0xd9])] : []), options.trailing ?? Buffer.alloc(0)]);
}

const riffChunk = (type: string, data: Buffer) => Buffer.concat([Buffer.from(type, 'latin1'), le32(data.length), data, ...(data.length & 1 ? [Buffer.from([0])] : [])]);
const riff = (chunks: Buffer[]) => { const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]); return Buffer.concat([Buffer.from('RIFF', 'latin1'), le32(body.length), body]); };
const vp8l = (width: number, height: number) => riffChunk('VP8L', Buffer.concat([Buffer.from([0x2f]), le32((width - 1) | ((height - 1) << 14)), Buffer.from([0, 0, 0])]));
export function webp(options: { width?: number; height?: number; extended?: boolean; metadata?: boolean } = {}) {
  const width = options.width ?? 32, height = options.height ?? 16;
  if (!options.extended) return riff([vp8l(width, height)]);
  const flags = options.metadata ? 0x0c : 0, canvas = Buffer.alloc(10);
  canvas[0] = flags; canvas.writeUIntLE(width - 1, 4, 3); canvas.writeUIntLE(height - 1, 7, 3);
  return riff([riffChunk('VP8X', canvas), vp8l(width, height),
    ...(options.metadata ? [riffChunk('EXIF', Buffer.from('MM\x00\x2a GPS 28.6 77.2', 'latin1')), riffChunk('XMP ', Buffer.from('<x:xmpmeta/>', 'latin1'))] : [])]);
}

/** A minimal PDF. `objects` are appended verbatim after the page tree; `trailer` follows %%EOF. */
export function pdf(options: { catalog?: string; objects?: string[]; streams?: Buffer[]; pages?: number; trailer?: string; info?: boolean } = {}) {
  const pages = options.pages ?? 1, kids = Array.from({ length: pages }, (_, i) => `${10 + i} 0 R`).join(' ');
  const parts: Buffer[] = [Buffer.from(`%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${options.catalog ?? ''}>>\nendobj\n`, 'latin1'),
    Buffer.from(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n`, 'latin1'),
    ...Array.from({ length: pages }, (_, i) => Buffer.from(`${10 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n`, 'latin1')),
    ...(options.info ? [Buffer.from('3 0 obj\n<< /Author (A. Person) /Producer (fixture) >>\nendobj\n', 'latin1')] : []),
    ...(options.objects ?? []).map(o => Buffer.from(o, 'latin1')), ...(options.streams ?? [])];
  return Buffer.concat([...parts, Buffer.from(`trailer\n<< /Root 1 0 R ${options.info ? '/Info 3 0 R ' : ''}>>\n%%EOF\n`, 'latin1'), Buffer.from(options.trailer ?? '', 'latin1')]);
}
/** A stream object with exact framing; `type` adds a /Type (e.g. /ObjStm) and Flate compression when `compress`. */
export function pdfStream(id: number, data: Buffer, options: { type?: string; compress?: boolean } = {}) {
  const body = options.compress ? deflateSync(data) : data;
  return Buffer.concat([Buffer.from(`${id} 0 obj\n<< ${options.type ? `/Type ${options.type} /N 1 /First 0 ` : ''}/Length ${body.length}${options.compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'),
    body, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
}
/** Deterministic pseudo-random bytes that deliberately contain the short names /JS and /AA (as image data can by chance). */
export function binaryWithShortNames(length = 4096) {
  const out = Buffer.alloc(length);
  let state = 0x2545f491;
  for (let i = 0; i < length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; out[i] = state & 0xff; }
  Buffer.from('/JS ').copy(out, 100); Buffer.from('/AA ').copy(out, 900);
  return out;
}
