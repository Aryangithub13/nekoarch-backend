import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { NOT_CLAIMED, REFERENCE_INSPECTOR_VERSION, REFERENCE_LIMITS, REFERENCE_MEDIA_TYPES, type InspectionFinding, type InspectionReport,
  type ReferenceMediaType } from './contracts.js';

/** A structural defect: the file is refused with this code; nothing is stored. */
class Reject extends Error {
  constructor(readonly code: InspectionFinding['code'], readonly detail: string) { super(detail); }
}
type Removed = { segment: string; bytes: number };
type Parsed = { stored: Uint8Array; media: NonNullable<InspectionReport['media']>; removed: Removed[]; retained: string[]; checks: string[]; info: InspectionFinding[] };

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const le32 = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)) + b[i + 3]! * 0x1000000;
const ascii = (b: Uint8Array, start: number, end: number) => Buffer.from(b.subarray(start, end)).toString('latin1');
const need = (b: Uint8Array, end: number, what: string) => { if (end > b.length) throw new Reject('TRUNCATED', `${what} extends past the end of the file`); };

function checkDimensions(width: number, height: number) {
  const { maxDimension, maxPixels } = REFERENCE_LIMITS;
  if (width < 1 || height < 1) throw new Reject('MALFORMED_STRUCTURE', 'Image dimensions must be positive');
  if (width > maxDimension || height > maxDimension || width * height > maxPixels)
    throw new Reject('DIMENSIONS_EXCEEDED', `${width}x${height} exceeds ${maxDimension}px per side or ${maxPixels} pixels`);
}

export function sniff(bytes: Uint8Array): ReferenceMediaType | null {
  if (bytes.length >= 8 && be32(bytes, 0) === 0x89504e47 && be32(bytes, 4) === 0x0d0a1a0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

// ---- PNG -------------------------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const PNG_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
const PNG_METADATA = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
// Valid (colour type → bit depths) pairs from the PNG specification.
const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function parsePng(b: Uint8Array): Parsed {
  const kept: Uint8Array[] = [b.subarray(0, 8)], removed: Removed[] = [], retained = new Set<string>();
  let pos = 8, first = true, idat = 0, idatRunEnded = false, media: Parsed['media'] | null = null;
  for (;;) {
    need(b, pos + 12, 'PNG chunk header');
    const length = be32(b, pos), type = ascii(b, pos + 4, pos + 8);
    if (length > 0x7fffffff || !/^[A-Za-z]{4}$/.test(type)) throw new Reject('MALFORMED_STRUCTURE', 'Invalid PNG chunk header');
    need(b, pos + 12 + length, `PNG ${type} chunk`);
    if (crc32(b.subarray(pos + 4, pos + 8 + length)) !== be32(b, pos + 8 + length)) throw new Reject('PNG_CRC_MISMATCH', `CRC mismatch in ${type}`);
    const chunk = b.subarray(pos, pos + 12 + length), data = b.subarray(pos + 8, pos + 8 + length);
    if (first) {
      if (type !== 'IHDR' || length !== 13) throw new Reject('MALFORMED_STRUCTURE', 'IHDR must be the first chunk');
      const width = be32(data, 0), height = be32(data, 4), depth = data[8]!, colour = data[9]!;
      if (!PNG_DEPTHS[colour]?.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12]! > 1) throw new Reject('MALFORMED_STRUCTURE', 'Invalid IHDR fields');
      checkDimensions(width, height);
      media = { kind: 'IMAGE', width, height };
      first = false;
    } else if (type === 'IHDR') throw new Reject('MALFORMED_STRUCTURE', 'Duplicate IHDR');
    // Uppercase first letter = critical: a decoder must understand it, so an unknown one is refused rather than passed through.
    if (type[0]! < 'a' && !PNG_CRITICAL.has(type)) throw new Reject('PNG_UNKNOWN_CRITICAL_CHUNK', `Unknown critical chunk ${type}`);
    if (type === 'IDAT') {
      if (idatRunEnded) throw new Reject('MALFORMED_STRUCTURE', 'IDAT chunks must be consecutive');
      idat++;
    } else if (idat) idatRunEnded = true;
    if (PNG_METADATA.has(type)) removed.push({ segment: type, bytes: chunk.length });
    else { kept.push(chunk); if (!PNG_CRITICAL.has(type)) retained.add(type); }
    pos += 12 + length;
    if (type === 'IEND') {
      if (length !== 0) throw new Reject('MALFORMED_STRUCTURE', 'IEND must be empty');
      break;
    }
  }
  if (!idat) throw new Reject('MALFORMED_STRUCTURE', 'PNG has no image data');
  if (pos !== b.length) throw new Reject('TRAILING_DATA', `${b.length - pos} bytes follow IEND`);
  return { stored: Buffer.concat(kept), media: media!, removed, retained: [...retained].sort(), checks: ['PNG_SIGNATURE', 'PNG_CHUNK_CRC', 'PNG_CHUNK_ORDER', 'EXACT_FRAMING'], info: [] };
}

// ---- JPEG ------------------------------------------------------------------------------------------------------------
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const startsWith = (data: Uint8Array, text: string) => ascii(data, 0, Math.min(data.length, text.length)) === text;

function parseJpeg(b: Uint8Array): Parsed {
  const kept: Uint8Array[] = [b.subarray(0, 2)], removed: Removed[] = [], retained = new Set<string>(), info: InspectionFinding[] = [];
  let pos = 2, frames = 0, scans = 0, mpf = false, media: Parsed['media'] | null = null;
  for (;;) {
    need(b, pos + 2, 'JPEG marker');
    if (b[pos] !== 0xff) throw new Reject('MALFORMED_STRUCTURE', 'Expected a JPEG marker');
    let markerAt = pos;
    while (b[pos + 1] === 0xff) { pos++; need(b, pos + 2, 'JPEG marker'); } // fill bytes
    const marker = b[pos + 1]!;
    if (marker === 0xd9) {
      if (!scans) throw new Reject('MALFORMED_STRUCTURE', 'EOI before any scan');
      kept.push(b.subarray(pos, pos + 2));
      pos += 2;
      break;
    }
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) throw new Reject('MALFORMED_STRUCTURE', 'Unexpected JPEG marker');
    need(b, pos + 4, 'JPEG segment length');
    const length = be16(b, pos + 2);
    if (length < 2) throw new Reject('MALFORMED_STRUCTURE', 'Invalid JPEG segment length');
    need(b, pos + 2 + length, 'JPEG segment');
    const segment = b.subarray(markerAt, pos + 2 + length), data = b.subarray(pos + 4, pos + 2 + length);
    markerAt = pos + 2 + length;
    if (isSof(marker)) {
      if (length < 8) throw new Reject('MALFORMED_STRUCTURE', 'Short frame header');
      frames++;
      const height = be16(data, 1), width = be16(data, 3);
      checkDimensions(width, height);
      media = { kind: 'IMAGE', width, height };
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe2 && startsWith(data, 'MPF\0')) { mpf = true; removed.push({ segment: 'APP2 MPF', bytes: segment.length }); }
    else if ((isApp && ![0xe0, 0xe2, 0xee].includes(marker)) || marker === 0xfe || (marker === 0xe2 && !startsWith(data, 'ICC_PROFILE\0')))
      removed.push({ segment: marker === 0xfe ? 'COM' : `APP${marker - 0xe0}`, bytes: segment.length });
    else {
      kept.push(segment);
      if (isApp) retained.add(marker === 0xe0 ? 'APP0 JFIF' : marker === 0xe2 ? 'APP2 ICC' : 'APP14 Adobe');
    }
    pos = markerAt;
    if (marker === 0xda) {
      if (frames !== 1) throw new Reject('MALFORMED_STRUCTURE', 'A scan must follow exactly one frame header');
      scans++;
      // Entropy-coded data runs to the next marker that is neither a stuffed 0x00, a restart marker nor fill.
      let end = pos;
      for (;;) {
        need(b, end + 2, 'JPEG scan data');
        if (b[end] === 0xff) {
          const next = b[end + 1]!;
          if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break;
          end += next === 0xff ? 1 : 2;
        } else end++;
      }
      kept.push(b.subarray(pos, end));
      pos = end;
    }
  }
  if (frames !== 1) throw new Reject('MALFORMED_STRUCTURE', 'JPEG must contain exactly one frame');
  if (pos !== b.length) {
    if (!mpf) throw new Reject('TRAILING_DATA', `${b.length - pos} bytes follow EOI`);
    removed.push({ segment: 'MPF secondary', bytes: b.length - pos });
    info.push({ code: 'MPF_SECONDARY_IMAGES', severity: 'INFO', detail: `${b.length - pos} bytes of Multi-Picture Format secondary images removed` });
  }
  return { stored: Buffer.concat(kept), media: media!, removed, retained: [...retained].sort(), checks: ['JPEG_MARKERS', 'JPEG_SINGLE_FRAME', 'JPEG_SCAN_TO_EOI', 'EXACT_FRAMING'], info };
}

// ---- WebP ------------------------------------------------------------------------------------------------------------
const WEBP_KNOWN = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function webpDimensions(type: string, data: Uint8Array) {
  if (type === 'VP8 ') {
    if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) throw new Reject('MALFORMED_STRUCTURE', 'Invalid VP8 header');
    return { width: le16(data, 6) & 0x3fff, height: le16(data, 8) & 0x3fff };
  }
  if (type === 'VP8L') {
    if (data.length < 5 || data[0] !== 0x2f) throw new Reject('MALFORMED_STRUCTURE', 'Invalid VP8L header');
    const bits = le32(data, 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (data.length < 10) throw new Reject('MALFORMED_STRUCTURE', 'Invalid VP8X header');
  return { width: le24(data, 4) + 1, height: le24(data, 7) + 1 };
}

function parseWebp(b: Uint8Array): Parsed {
  if (le32(b, 4) + 8 !== b.length) throw new Reject(le32(b, 4) + 8 > b.length ? 'TRUNCATED' : 'TRAILING_DATA', 'RIFF size does not match the file length');
  const chunks: { type: string; data: Uint8Array; raw: Uint8Array }[] = [];
  let pos = 12;
  while (pos < b.length) {
    need(b, pos + 8, 'WebP chunk header');
    const type = ascii(b, pos, pos + 4), size = le32(b, pos + 4), padded = size + (size & 1);
    need(b, pos + 8 + padded, `WebP ${type} chunk`);
    chunks.push({ type, data: b.subarray(pos + 8, pos + 8 + size), raw: b.subarray(pos, pos + 8 + padded) });
    pos += 8 + padded;
  }
  const head = chunks[0];
  if (!head || !['VP8 ', 'VP8L', 'VP8X'].includes(head.type)) throw new Reject('MALFORMED_STRUCTURE', 'WebP must start with VP8, VP8L or VP8X');
  const { width, height } = webpDimensions(head.type, head.data);
  checkDimensions(width, height);
  const removed: Removed[] = [], retained = new Set<string>();
  if (head.type !== 'VP8X') {
    if (chunks.length !== 1) throw new Reject('MALFORMED_STRUCTURE', 'A simple WebP file has exactly one chunk');
    return { stored: b, media: { kind: 'IMAGE', width, height }, removed, retained: [], checks: ['RIFF_SIZE', 'WEBP_BITSTREAM_HEADER', 'EXACT_FRAMING'], info: [] };
  }
  if (!chunks.some(c => ['VP8 ', 'VP8L', 'ANMF'].includes(c.type))) throw new Reject('MALFORMED_STRUCTURE', 'Extended WebP has no image data');
  const kept: Uint8Array[] = [];
  for (const c of chunks) {
    if (c.type === 'EXIF' || c.type === 'XMP ' || !WEBP_KNOWN.has(c.type)) removed.push({ segment: /^[A-Za-z0-9]+ *$/.test(c.type) ? c.type.trim() : 'unknown', bytes: c.raw.length });
    else { kept.push(c.raw); if (c.type === 'ICCP') retained.add('ICCP'); }
  }
  const body = Buffer.concat(kept);
  // VP8X flags: bit 3 = EXIF, bit 2 = XMP. Both chunks are gone, so both flags are cleared.
  body[8] = body[8]! & ~0x0c;
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1'); header.writeUInt32LE(body.length + 4, 4); header.write('WEBP', 8, 'latin1');
  return { stored: Buffer.concat([header, body]), media: { kind: 'IMAGE', width, height }, removed, retained: [...retained].sort(),
    checks: ['RIFF_SIZE', 'WEBP_CHUNK_BOUNDS', 'WEBP_BITSTREAM_HEADER', 'EXACT_FRAMING'], info: [] };
}

// ---- PDF -------------------------------------------------------------------------------------------------------------
const PDF_ACTIVE = new Set(['/JavaScript', '/JS', '/OpenAction', '/AA', '/Launch', '/EmbeddedFile', '/EmbeddedFiles', '/RichMedia', '/XFA', '/SubmitForm',
  '/ImportData', '/GoToR', '/GoToE']);
const NAME = /\/[^\s/[\]<>(){}%]*/g;
/** PDF names may escape any byte as #xx; matching runs on the decoded name so `/J#61vaScript` cannot evade the scan. */
export const decodePdfName = (name: string) => name.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

// Every executable action is typed by one of these (`/S /JavaScript`, `/S /Launch`, …); at 4+ characters they do not occur in binary data by chance.
const PDF_ACTIVE_LONG = new Set([...PDF_ACTIVE].filter(n => n.length >= 5));

function scanPdfText(text: string, state: { pages: number; encrypted: boolean; info: boolean; xmp: boolean }, binary = false) {
  const names = (text.match(NAME) ?? []).map(decodePdfName);
  if (binary) {
    for (const name of names) if (PDF_ACTIVE_LONG.has(name)) throw new Reject('PDF_ACTIVE_CONTENT', `Active content ${name}`);
    return;
  }
  names.forEach((name, i) => {
    if (PDF_ACTIVE.has(name)) throw new Reject('PDF_ACTIVE_CONTENT', `Active content ${name}`);
    if (name === '/Encrypt') state.encrypted = true;
    if (name === '/Info') state.info = true;
    if (name === '/Metadata') state.xmp = true;
    if (name === '/Type' && names[i + 1] === '/Page') state.pages++;
  });
}

/**
 * Objects live in the file's text outside streams or inside object streams (/Type /ObjStm): both get the full name scan.
 * Every other stream region is scanned for the long action names only, so a fake `>> stream` cannot hide an action,
 * while short names like /JS are not matched against binary image or font data.
 */
function parsePdf(b: Uint8Array): Parsed {
  const text = Buffer.from(b).toString('latin1');
  if (!/^%PDF-(1\.[0-7]|2\.0)\s/.test(text.slice(0, 10))) throw new Reject('MALFORMED_STRUCTURE', 'Unsupported PDF header');
  const eof = text.lastIndexOf('%%EOF');
  if (eof < 0) throw new Reject('TRUNCATED', 'No %%EOF marker');
  if (b.length - eof > 1024 || !/^%%EOF[\s\0]*$/.test(text.slice(eof))) throw new Reject('TRAILING_DATA', 'Data follows the final %%EOF');
  const state = { pages: 0, encrypted: false, info: false, xmp: false };
  const outside: string[] = [], objectStreams: Uint8Array[] = [];
  const STREAM = />>\s*stream(\r\n|\n)/g;
  let cursor = 0;
  for (let m = STREAM.exec(text); m; m = STREAM.exec(text)) {
    const start = m.index + m[0].length, end = text.indexOf('endstream', start);
    if (end < 0) throw new Reject('TRUNCATED', 'Unterminated stream');
    const dictionary = text.slice(Math.max(cursor, m.index - 4096), m.index + 2), open = dictionary.lastIndexOf('obj');
    const names = (dictionary.slice(open < 0 ? 0 : open).match(NAME) ?? []).map(decodePdfName);
    outside.push(text.slice(cursor, start));
    cursor = end;
    STREAM.lastIndex = end + 9;
    if (!names.includes('/ObjStm')) { scanPdfText(text.slice(start, end), state, true); continue; }
    // An object stream must be readable to be inspected: Flate only, no other filter or predictor.
    if (names.filter(n => n.endsWith('Decode')).join() !== '/FlateDecode' || names.includes('/DecodeParms'))
      throw new Reject('MALFORMED_STRUCTURE', 'Object stream encoding cannot be inspected');
    objectStreams.push(b.subarray(start, end));
  }
  outside.push(text.slice(cursor));
  scanPdfText(outside.join('\n'), state);
  if (state.encrypted) throw new Reject('PDF_ENCRYPTED', 'Encrypted PDFs cannot be inspected');
  let budget = REFERENCE_LIMITS.pdfInflateTotalBytes;
  for (const stream of objectStreams) {
    let decoded: Buffer;
    try { decoded = inflateSync(stream, { maxOutputLength: Math.min(REFERENCE_LIMITS.pdfInflateStreamBytes, budget) }); }
    catch (error) {
      if (error instanceof RangeError || (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
        throw new Reject('PDF_INFLATE_LIMIT', 'Decompressed object streams exceed the inspection budget');
      throw new Reject('MALFORMED_STRUCTURE', 'An object stream does not decompress');
    }
    budget -= decoded.length;
    scanPdfText(decoded.toString('latin1'), state);
    if (state.encrypted) throw new Reject('PDF_ENCRYPTED', 'Encrypted PDFs cannot be inspected');
  }
  const streams = objectStreams.length;
  if (state.pages < 1) throw new Reject('MALFORMED_STRUCTURE', 'No page objects found');
  if (state.pages > REFERENCE_LIMITS.pdfMaxPages) throw new Reject('PDF_PAGE_LIMIT', `${state.pages} pages exceed ${REFERENCE_LIMITS.pdfMaxPages}`);
  const retained = [...(state.info ? ['PDF Info'] : []), ...(state.xmp ? ['PDF XMP'] : [])];
  return { stored: b, media: { kind: 'DOCUMENT', pageCount: state.pages }, removed: [], retained,
    checks: ['PDF_HEADER', 'PDF_EOF', 'PDF_ACTIVE_CONTENT_SCAN', ...(streams ? ['PDF_STREAMS_INFLATED'] : [])],
    info: retained.length ? [{ code: 'PDF_METADATA_RETAINED', severity: 'INFO', detail: 'PDF document metadata is reported, not removed' }] : [] };
}

const PARSERS: Record<ReferenceMediaType, (b: Uint8Array) => Parsed> = { 'image/png': parsePng, 'image/jpeg': parseJpeg, 'image/webp': parseWebp, 'application/pdf': parsePdf };

/**
 * Deterministic structural inspection of untrusted bytes. Accepted files are returned with image metadata removed; the
 * output is re-inspected, so stripping can never yield bytes that would fail inspection. Runs in the inspection worker.
 */
export function inspectReference(input: Uint8Array, declaredMediaType: string): { report: InspectionReport; stored: Uint8Array | null } {
  const bytes = input.subarray(0, Math.min(input.length, REFERENCE_LIMITS.maxBytes + 1));
  const base = { inspectorVersion: REFERENCE_INSPECTOR_VERSION, declaredMediaType: declaredMediaType.slice(0, 100), original: { sha256: sha(input), bytes: input.length },
    malwareScan: { status: 'NOT_PERFORMED', reason: 'NO_SCANNER_CONFIGURED' }, claims: { ...NOT_CLAIMED } } as const;
  const detected = sniff(bytes);
  const reject = (code: InspectionFinding['code'], detail: string, checks: string[] = []): { report: InspectionReport; stored: null } => ({ stored: null, report: {
    ...base, verdict: 'REJECTED', detectedMediaType: detected, stored: null, checks, findings: [{ code, severity: 'REJECT', detail: detail.slice(0, 200) }],
    media: null, metadata: { removed: [], retained: [] } } });
  if (!input.length) return reject('EMPTY_FILE', 'The file is empty');
  if (input.length > REFERENCE_LIMITS.maxBytes) return reject('MALFORMED_STRUCTURE', `The file exceeds ${REFERENCE_LIMITS.maxBytes} bytes`);
  if (!detected || detected !== declaredMediaType || !(REFERENCE_MEDIA_TYPES as readonly string[]).includes(declaredMediaType))
    return reject('TYPE_MISMATCH', `Declared ${declaredMediaType.slice(0, 60)}; content is ${detected ?? 'not a supported type'}`);
  let parsed: Parsed;
  try {
    parsed = PARSERS[detected](bytes);
    // The stored bytes must themselves pass the same parser and keep identical media facts.
    if (parsed.stored !== bytes) {
      const again = PARSERS[detected](parsed.stored);
      if (again.removed.length || JSON.stringify(again.media) !== JSON.stringify(parsed.media)) throw new Reject('MALFORMED_STRUCTURE', 'Metadata removal was not stable');
    }
  } catch (error) {
    if (error instanceof Reject) return reject(error.code, error.detail, ['MAGIC_BYTES']);
    throw error;
  }
  const removed = parsed.removed.slice(0, REFERENCE_LIMITS.removedSegments);
  const info: InspectionFinding[] = [...(removed.some(r => r.segment !== 'MPF secondary') ? [{ code: 'METADATA_REMOVED' as const, severity: 'INFO' as const,
    detail: `Removed ${[...new Set(removed.map(r => r.segment))].join(', ')}`.slice(0, 200) }] : []), ...parsed.info];
  return { stored: parsed.stored, report: { ...base, verdict: 'ACCEPTED', detectedMediaType: detected, stored: { sha256: sha(parsed.stored), bytes: parsed.stored.length },
    checks: ['MAGIC_BYTES', 'DECLARED_TYPE_MATCH', ...parsed.checks, 'DIMENSION_LIMITS'].filter((c, i, a) => a.indexOf(c) === i),
    findings: info, media: parsed.media, metadata: { removed, retained: parsed.retained } } };
}
