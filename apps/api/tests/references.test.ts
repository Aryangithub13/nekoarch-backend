import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { inspectReference, sniff, decodePdfName } from '../src/references/inspect.js';
import { InspectionReportSchema, REFERENCE_LIMITS } from '../src/references/contracts.js';
import { InspectionPool, InspectionPoolError } from '../src/references/pool.js';
import { binaryWithShortNames, JPEG_SCAN, jpeg, pdf, pdfStream, png, pngChunk, pngIdat, webp } from '../../../test-support/reference-fixtures.js';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const inspect = (bytes: Buffer, type: string) => {
  const result = inspectReference(bytes, type);
  InspectionReportSchema.parse(result.report); // every report, accepted or not, satisfies the published contract
  return result;
};
const rejected = (bytes: Buffer, type: string) => {
  const { report, stored } = inspect(bytes, type);
  expect(stored).toBeNull();
  expect(report.verdict).toBe('REJECTED');
  return report.findings.filter(f => f.severity === 'REJECT').map(f => f.code);
};

describe('Phase 31 reference inspector: accepted files', () => {
  it.each([
    ['image/png', png(), { kind: 'IMAGE', width: 4, height: 3 }],
    ['image/jpeg', jpeg({ icc: true }), { kind: 'IMAGE', width: 640, height: 480 }],
    ['image/webp', webp(), { kind: 'IMAGE', width: 32, height: 16 }],
    ['image/webp', webp({ extended: true }), { kind: 'IMAGE', width: 32, height: 16 }],
    ['application/pdf', pdf({ pages: 3 }), { kind: 'DOCUMENT', pageCount: 3 }],
  ] as const)('%s is accepted with exact media facts and honest non-claims', (type, bytes, media) => {
    const { report, stored } = inspect(bytes, type);
    expect(report).toMatchObject({ verdict: 'ACCEPTED', detectedMediaType: type, declaredMediaType: type, media,
      malwareScan: { status: 'NOT_PERFORMED', reason: 'NO_SCANNER_CONFIGURED' }, original: { sha256: sha(bytes), bytes: bytes.length } });
    expect(Object.values(report.claims).every(c => c === 'NOT_CLAIMED')).toBe(true);
    expect(report.stored).toEqual({ sha256: sha(stored!), bytes: stored!.length });
  });
  it('is deterministic: identical bytes give an identical report', () => {
    const bytes = jpeg({ exif: true, comment: true, icc: true });
    expect(JSON.stringify(inspect(bytes, 'image/jpeg').report)).toBe(JSON.stringify(inspect(Buffer.from(bytes), 'image/jpeg').report));
  });
  it('detects types from magic bytes, never from the declared type', () => {
    expect([sniff(png()), sniff(jpeg()), sniff(webp()), sniff(pdf()), sniff(Buffer.from('PK\x03\x04', 'latin1')), sniff(Buffer.from('<svg'))])
      .toEqual(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', null, null]);
  });
});

describe('Phase 31 reference inspector: lossless metadata removal', () => {
  it('PNG: text and EXIF chunks are removed, pixel data is byte-identical, and the output re-inspects clean', () => {
    const bytes = png({ text: true }), { report, stored } = inspect(bytes, 'image/png');
    expect(report.metadata.removed.map(r => r.segment)).toEqual(['tEXt', 'eXIf']);
    expect(report.metadata.retained).toEqual(['sRGB']);
    expect(Buffer.from(stored!).includes('28.6139')).toBe(false);
    expect(pngIdat(Buffer.from(stored!))).toEqual(pngIdat(bytes));
    const again = inspect(Buffer.from(stored!), 'image/png');
    expect([again.report.metadata.removed, again.report.stored?.sha256]).toEqual([[], report.stored?.sha256]);
    expect(report.findings).toEqual([{ code: 'METADATA_REMOVED', severity: 'INFO', detail: 'Removed tEXt, eXIf' }]);
  });
  it('JPEG: EXIF/GPS and comments are removed; JFIF and ICC are kept; entropy data is untouched', () => {
    const { report, stored } = inspect(jpeg({ exif: true, comment: true, icc: true }), 'image/jpeg'), out = Buffer.from(stored!);
    expect(report.metadata.removed.map(r => r.segment)).toEqual(['APP1', 'COM']);
    expect(report.metadata.retained).toEqual(['APP0 JFIF', 'APP2 ICC']);
    expect([out.includes('GPSLatitude'), out.includes('A. Person'), out.includes('ICC_PROFILE'), out.includes(JPEG_SCAN)]).toEqual([false, false, true, true]);
    expect(inspect(out, 'image/jpeg').report.metadata.removed).toEqual([]);
  });
  it('JPEG: Multi-Picture Format secondary images are removed with their MPF segment; the file ends at the primary EOI', () => {
    const bytes = jpeg({ mpf: true }), { report, stored } = inspect(bytes, 'image/jpeg');
    expect(report.verdict).toBe('ACCEPTED');
    expect(report.findings.map(f => f.code)).toEqual(['METADATA_REMOVED', 'MPF_SECONDARY_IMAGES']);
    expect(Buffer.from(stored!).subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    // The 4-byte secondary image and the 12-byte APP2 MPF segment, and nothing else.
    expect(report.metadata.removed).toEqual([{ segment: 'APP2 MPF', bytes: 12 }, { segment: 'MPF secondary', bytes: 4 }]);
    expect(stored!.length).toBe(bytes.length - 16);
  });
  it('WebP: EXIF and XMP chunks are removed, VP8X flags cleared and the RIFF size rewritten', () => {
    const { report, stored } = inspect(webp({ extended: true, metadata: true }), 'image/webp'), out = Buffer.from(stored!);
    expect(report.metadata.removed.map(r => r.segment)).toEqual(['EXIF', 'XMP']);
    expect([out.readUInt32LE(4) + 8, out[20]! & 0x0c, out.includes('GPS')]).toEqual([out.length, 0, false]);
    expect(inspect(out, 'image/webp').report.metadata.removed).toEqual([]);
  });
  it('PDF: document metadata is reported as retained, never silently claimed removed', () => {
    const { report, stored } = inspect(pdf({ info: true }), 'application/pdf');
    expect([report.metadata.retained, report.findings.map(f => f.code), stored!.length]).toEqual([['PDF Info'], ['PDF_METADATA_RETAINED'], pdf({ info: true }).length]);
  });
});

describe('Phase 31 reference inspector: refusals', () => {
  it('refuses empty, mislabelled and unsupported content', () => {
    expect(rejected(Buffer.alloc(0), 'image/png')).toEqual(['EMPTY_FILE']);
    expect(rejected(png(), 'image/jpeg')).toEqual(['TYPE_MISMATCH']);
    expect(rejected(Buffer.from('PK\x03\x04 zip pretending', 'latin1'), 'image/png')).toEqual(['TYPE_MISMATCH']);
    expect(rejected(Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml')).toEqual(['TYPE_MISMATCH']);
  });
  it('refuses polyglots: bytes after the container end are never accepted', () => {
    const zip = Buffer.from('PK\x03\x04payload', 'latin1');
    expect(rejected(Buffer.concat([png(), zip]), 'image/png')).toEqual(['TRAILING_DATA']);
    expect(rejected(jpeg({ trailing: zip }), 'image/jpeg')).toEqual(['TRAILING_DATA']);
    expect(rejected(pdf({ trailer: 'PK\x03\x04hidden archive' }), 'application/pdf')).toEqual(['TRAILING_DATA']);
    const w = webp(); w.writeUInt32LE(w.readUInt32LE(4) - 2, 4);
    expect(rejected(w, 'image/webp')).toEqual(['TRAILING_DATA']);
  });
  it('refuses corrupt and truncated structure', () => {
    expect(rejected(png({ badCrc: true }), 'image/png')).toEqual(['PNG_CRC_MISMATCH']);
    expect(rejected(png({ chunks: [pngChunk('ABCD', Buffer.from('x'))] }), 'image/png')).toEqual(['PNG_UNKNOWN_CRITICAL_CHUNK']);
    expect(rejected(png().subarray(0, 40), 'image/png')).toEqual(['TRUNCATED']);
    expect(rejected(jpeg().subarray(0, jpeg().length - 2), 'image/jpeg')).toEqual(['TRUNCATED']);
    expect(rejected(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xd9])]), 'image/jpeg')).toEqual(['MALFORMED_STRUCTURE']);
    expect(rejected(pdf().subarray(0, 60), 'application/pdf')).toEqual(['TRUNCATED']);
  });
  it('refuses decompression-bomb canvases from tiny files', () => {
    expect(rejected(png({ ihdr: { width: 20_000, height: 20_000 } }), 'image/png')).toEqual(['DIMENSIONS_EXCEEDED']);
    expect(rejected(png({ ihdr: { width: 10_000, height: 10_000 } }), 'image/png')).toEqual(['DIMENSIONS_EXCEEDED']); // 100 MP > 50 MP
    expect(rejected(jpeg({ width: 65_000, height: 2 }), 'image/jpeg')).toEqual(['DIMENSIONS_EXCEEDED']);
    expect(rejected(webp({ width: 16_000, height: 10 }), 'image/webp')).toEqual(['DIMENSIONS_EXCEEDED']);
  });
  it('refuses active PDF content in plain objects, escaped names and compressed object streams', () => {
    expect(rejected(pdf({ catalog: '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>' }), 'application/pdf')).toEqual(['PDF_ACTIVE_CONTENT']);
    expect(decodePdfName('/J#61vaScript')).toBe('/JavaScript');
    expect(rejected(pdf({ objects: ['5 0 obj\n<< /S /J#61vaScript /J#53 (x) >>\nendobj\n'] }), 'application/pdf')).toEqual(['PDF_ACTIVE_CONTENT']);
    expect(rejected(pdf({ catalog: '/AA << /O 7 0 R >>' }), 'application/pdf')).toEqual(['PDF_ACTIVE_CONTENT']);
    expect(rejected(pdf({ objects: ['6 0 obj\n<< /Type /Filespec /EF << /F 7 0 R >> /Type /EmbeddedFile >>\nendobj\n'] }), 'application/pdf')).toEqual(['PDF_ACTIVE_CONTENT']);
    const hidden = pdfStream(20, Buffer.from('30 0 << /S /Launch /F (cmd.exe) >>', 'latin1'), { type: '/ObjStm', compress: true });
    expect(rejected(pdf({ streams: [hidden] }), 'application/pdf')).toEqual(['PDF_ACTIVE_CONTENT']);
    // A fake `>> stream` region cannot hide an action typed by a long name.
    expect(rejected(pdf({ objects: ['21 0 obj\n<< /Length 9 >>\nstream\n<< /S /JavaScript >> 22 0 obj\nendstream\nendobj\n'] }), 'application/pdf')).toEqual(['PDF_ACTIVE_CONTENT']);
  });
  it('refuses PDFs that cannot be inspected: encrypted, undecodable or over-budget object streams, too many pages', () => {
    expect(rejected(pdf({ objects: ['8 0 obj\n<< /Filter /Standard /V 2 >>\nendobj\n'], catalog: '/Encrypt 8 0 R' }), 'application/pdf')).toEqual(['PDF_ENCRYPTED']);
    const lzw = Buffer.concat([Buffer.from('23 0 obj\n<< /Type /ObjStm /N 1 /First 0 /Length 4 /Filter /LZWDecode >>\nstream\n', 'latin1'), Buffer.from('abcd'),
      Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    expect(rejected(pdf({ streams: [lzw] }), 'application/pdf')).toEqual(['MALFORMED_STRUCTURE']);
    const bomb = pdfStream(24, Buffer.alloc(REFERENCE_LIMITS.pdfInflateStreamBytes + 1), { type: '/ObjStm', compress: true });
    expect(bomb.length).toBeLessThan(20_000);
    expect(rejected(pdf({ streams: [bomb] }), 'application/pdf')).toEqual(['PDF_INFLATE_LIMIT']);
    expect(rejected(pdf({ pages: REFERENCE_LIMITS.pdfMaxPages + 1 }), 'application/pdf')).toEqual(['PDF_PAGE_LIMIT']);
  });
  it('does not reject a valid PDF whose binary streams contain short names by chance', () => {
    const image = pdfStream(30, binaryWithShortNames()), content = pdfStream(31, deflateSync(binaryWithShortNames(2048)));
    expect(inspect(pdf({ streams: [image, content] }), 'application/pdf').report.verdict).toBe('ACCEPTED');
  });
});

describe('Phase 31 inspection pool', () => {
  const pools: InspectionPool[] = [];
  const probe = (mode: string, reply?: unknown, timeoutMs = 2_000) => {
    const pool = new InspectionPool({ timeoutMs, worker: { url: new URL('../../../test-support/reference-workers/probe.mjs', import.meta.url), execArgv: [], workerData: { mode, reply } } });
    pools.push(pool);
    return pool;
  };
  afterAll(async () => { await Promise.all(pools.map(p => p.close())); });

  it('inspects in an isolated worker and returns re-verified bytes', async () => {
    const pool = new InspectionPool(); pools.push(pool);
    const result = await pool.inspect(png({ text: true }), 'image/png');
    expect(result.report.verdict).toBe('ACCEPTED');
    expect(sha(result.stored!)).toBe(result.report.stored!.sha256);
  });
  it.each([['crash'], ['hang'], ['garbage'], ['refuse']])('a %s worker yields a typed failure and no result', async mode => {
    await expect(probe(mode, undefined, 300).inspect(png(), 'image/png')).rejects.toBeInstanceOf(InspectionPoolError);
  });
  it('rejects a worker that describes different bytes, or returns bytes that do not match its report', async () => {
    const other = inspectReference(png({ width: 9 }), 'image/png');
    await expect(probe('liar', other).inspect(png(), 'image/png')).rejects.toMatchObject({ code: 'REFERENCE_WORKER_FAILED' });
    await expect(probe('tampered', other).inspect(png({ width: 9 }), 'image/png')).rejects.toMatchObject({ code: 'REFERENCE_WORKER_FAILED' });
  });
});
