//? Upload hardening without a live server: declaration coherence, shared rate limiting, streaming caps,
//? structural file validation, scanner timeout/failure behavior, atomic promotion, and bounded quarantine cleanup.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { deflateRawSync, deflateSync } from 'node:zlib';

import {
  defaultRateLimitStrategy,
  registerRateLimitStrategy,
} from '@luckystack/core';
import type { RateLimitStrategy } from '@luckystack/core';
import sharp from 'sharp';

import type { UploadDeclaration, UploadScanner } from '../../server/media/uploadRoute.ts';
import { assert, eq, report } from '../_helpers.mts';

const testMediaDir = path.join('data', `test-media-upload-${randomUUID()}`);
process.env.WS_MEDIA_DIR = testMediaDir;

const {
  checkMediaUploadRateLimit,
  checkUploadContentLength,
  ingestMediaUpload,
  resolveUploadDeclaration,
} = await import('../../server/media/uploadRoute.ts');
const {
  cleanupStaleQuarantinedMedia,
  MEDIA_QUARANTINE_DIR,
} = await import('../../server/media/store.ts');

function declaration(ext: string, mime: string): UploadDeclaration {
  const value = resolveUploadDeclaration(ext, mime);
  if (value === null) throw new Error(`missing declaration fixture for ${ext}`);
  return value;
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xED_B8_83_20 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xFF_FF_FF_FF;
  for (const byte of bytes) crc = (CRC32_TABLE[(crc ^ byte) & 0xFF] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xFF_FF_FF_FF) >>> 0;
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function minimalPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    pngChunk('IEND'),
  ]);
}

function riff(formType: 'WAVE', chunks: { type: string; data: Buffer }[]): Buffer {
  const encodedChunks = chunks.map(({ type, data }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, ...(data.length % 2 === 0 ? [] : [Buffer.alloc(1)])]);
  });
  const bytes = Buffer.concat([Buffer.from('RIFF0000'), Buffer.from(formType), ...encodedChunks]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

function minimalWav(): Buffer {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8000, 4);
  format.writeUInt32LE(16_000, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  return riff('WAVE', [{ type: 'fmt ', data: format }, { type: 'data', data: Buffer.alloc(2) }]);
}

function isoBox(type: string, data = Buffer.alloc(0)): Buffer {
  const box = Buffer.alloc(8 + data.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, 'ascii');
  data.copy(box, 8);
  return box;
}

function minimalIso(brand: string): Buffer {
  const compatible = brand === 'isom' ? ['isom', 'iso2'] : [brand];
  const fileType = Buffer.alloc(8 + compatible.length * 4);
  fileType.write(brand, 0, 'ascii');
  fileType.writeUInt32BE(0, 4);
  compatible.forEach((value, index) => fileType.write(value, 8 + index * 4, 'ascii'));
  return Buffer.concat([isoBox('ftyp', fileType), isoBox('moov'), isoBox('mdat', Buffer.from([0]))]);
}

function ebmlElement(id: readonly number[], data: Buffer): Buffer {
  if (data.length >= 0x7F) throw new Error('fixture EBML element is too large');
  return Buffer.concat([Buffer.from(id), Buffer.from([0x80 | data.length]), data]);
}

function minimalWebm(docType = 'webm'): Buffer {
  const ebmlHeader = Buffer.concat([
    ebmlElement([0x42, 0x86], Buffer.from([1])),
    ebmlElement([0x42, 0xF7], Buffer.from([1])),
    ebmlElement([0x42, 0xF2], Buffer.from([4])),
    ebmlElement([0x42, 0xF3], Buffer.from([8])),
    ebmlElement([0x42, 0x82], Buffer.from(docType, 'ascii')),
    ebmlElement([0x42, 0x87], Buffer.from([4])),
    ebmlElement([0x42, 0x85], Buffer.from([2])),
  ]);
  return Buffer.concat([
    ebmlElement([0x1A, 0x45, 0xDF, 0xA3], ebmlHeader),
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0x80]),
  ]);
}

interface ZipFixtureEntry {
  name: string;
  data: Buffer;
  method?: 0 | 8;
}

function zip(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04_03_4B_50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x08_00, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02_01_4B_50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x08_00, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4B_50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, central, end]);
}

const contentTypesXml = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>',
);
const relationshipsXml = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>',
);
const documentXml = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>',
);

function minimalDocx(extra: ZipFixtureEntry[] = [], contentTypes = contentTypesXml): Buffer {
  return zip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: relationshipsXml },
    { name: 'word/document.xml', data: documentXml },
    ...extra,
  ]);
}

function minimalPdf(): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += object; }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.from(body);
}

function minimalMp3Frame(): Buffer {
  const frame = Buffer.alloc(417);
  Buffer.from([0xFF, 0xFB, 0x90, 0x64]).copy(frame);
  return frame;
}

function minimalOggPage(): Buffer {
  const page = Buffer.alloc(29);
  page.write('OggS', 0, 'ascii');
  page[4] = 0;
  page[5] = 2;
  page[26] = 1;
  page[27] = 1;
  page[28] = 0;
  return page;
}

const validPng = minimalPng();
const raster = { create: { width: 1, height: 1, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 1 } } };
const validJpeg = await sharp(raster).jpeg().toBuffer();
const validWebp = await sharp(raster).webp({ lossless: true }).toBuffer();
const validDocx = minimalDocx();
const fixtures: { ext: string; mime: string; bytes: Buffer }[] = [
  { ext: 'png', mime: 'image/png', bytes: validPng },
  { ext: 'jpg', mime: 'image/jpeg', bytes: validJpeg },
  { ext: 'jpeg', mime: 'image/jpeg', bytes: validJpeg },
  { ext: 'webp', mime: 'image/webp', bytes: validWebp },
  { ext: 'gif', mime: 'image/gif', bytes: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') },
  { ext: 'pdf', mime: 'application/pdf', bytes: minimalPdf() },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: validDocx },
  { ext: 'mp4', mime: 'video/mp4', bytes: minimalIso('isom') },
  { ext: 'webm', mime: 'video/webm', bytes: minimalWebm() },
  { ext: 'mov', mime: 'video/quicktime', bytes: minimalIso('qt  ') },
  { ext: 'mp3', mime: 'audio/mpeg', bytes: minimalMp3Frame() },
  { ext: 'wav', mime: 'audio/wav', bytes: minimalWav() },
  { ext: 'ogg', mime: 'audio/ogg', bytes: minimalOggPage() },
  { ext: 'm4a', mime: 'audio/mp4', bytes: minimalIso('M4A ') },
  { ext: 'aac', mime: 'audio/aac', bytes: Buffer.from([0xFF, 0xF1, 0x50, 0x80, 0x00, 0xFF, 0xFC]) },
  { ext: 'txt', mime: 'text/plain', bytes: Buffer.from('Sane UTF-8 text — hello.\n') },
  { ext: 'md', mime: 'text/markdown', bytes: Buffer.from('# Heading\n\nMarkdown body.\n') },
];

const promotedPaths: string[] = [];
for (const fixture of fixtures) {
  const result = await ingestMediaUpload({
    source: Readable.from([fixture.bytes]),
    declaration: declaration(fixture.ext, fixture.mime),
    expectedBytes: fixture.bytes.length,
  });
  assert(result.status === 'accepted', `${fixture.ext}: real minimal fixture is accepted`);
  if (result.status === 'accepted') {
    assert(existsSync(result.path), `${fixture.ext}: accepted bytes were atomically promoted into media`);
    promotedPaths.push(result.path);
  }
}

assert(resolveUploadDeclaration('png', 'image/jpeg') === null, 'declared MIME must match the extension');
assert(resolveUploadDeclaration('pdf', 'application/octet-stream') === null, 'generic binary MIME is not treated as a declaration');
assert(resolveUploadDeclaration('txt', undefined) === null, 'a missing declared MIME fails closed');
assert(resolveUploadDeclaration('PNG', 'image/png; charset=binary')?.ext === 'png', 'extension + MIME normalization is deterministic');
assert(resolveUploadDeclaration('webm', 'audio/webm') !== null, 'the existing audio MediaRecorder webm path remains coherent');

eq(checkUploadContentLength(undefined, 10).status, 'absent', 'chunked upload without Content-Length reaches the stream cap');
eq(checkUploadContentLength('10', 10).status, 'valid', 'Content-Length at the cap is valid');
eq(checkUploadContentLength('11', 10).status, 'oversize', 'oversize Content-Length is rejected before streaming');
eq(checkUploadContentLength('0', 10).status, 'empty', 'empty Content-Length is rejected');
eq(checkUploadContentLength('-1', 10).status, 'invalid', 'malformed Content-Length is rejected');

function quarantineSnapshot(): string[] {
  return existsSync(MEDIA_QUARANTINE_DIR) ? readdirSync(MEDIA_QUARANTINE_DIR).toSorted() : [];
}

async function expectRejected(ext: string, mime: string, bytes: Buffer, message: string): Promise<void> {
  const result = await ingestMediaUpload({ source: Readable.from([bytes]), declaration: declaration(ext, mime) });
  eq(result.status, 'rejected', message);
  if (result.status === 'accepted') rmSync(result.path, { force: true });
}

const beforeRejections = quarantineSnapshot();
await expectRejected('jpg', 'image/jpeg', validPng, 'magic signature mismatch is rejected');
await expectRejected('png', 'image/png', Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), pngChunk('IEND'),
]), 'PNG magic plus a valid IEND trailer without IHDR/IDAT is rejected');
const badPngCrc = Buffer.from(validPng);
badPngCrc[16] = (badPngCrc[16] ?? 0) ^ 1;
await expectRejected('png', 'image/png', badPngCrc, 'PNG chunk CRC corruption is rejected');
await expectRejected('png', 'image/png', Buffer.concat([
  validPng.subarray(0, 33), pngChunk('IDAT'), pngChunk('tEXt', Buffer.from('gap')), validPng.subarray(33),
]), 'PNG IDAT chunks interrupted by an ancillary chunk are rejected');
await expectRejected('png', 'image/png', Buffer.concat([validPng, Buffer.from('%PDF-1.7\n%%EOF')]), 'PNG with appended polyglot bytes is rejected');
await expectRejected('jpg', 'image/jpeg', Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]), 'JPEG SOI/EOI magic without framed image segments is rejected');
await expectRejected('jpg', 'image/jpeg', Buffer.concat([validJpeg, Buffer.from('PK\u0003\u0004')]), 'JPEG bytes after EOI are rejected as a polyglot');
await expectRejected('webp', 'image/webp', Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBP'), 'WEBP RIFF form without a framed VP8 payload is rejected');
await expectRejected('wav', 'audio/wav', Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVE'), 'WAV RIFF form without fmt/data chunks is rejected');
await expectRejected('mp4', 'video/mp4', isoBox('ftyp', Buffer.from('isom\u0000\u0000\u0000\u0000isom')), 'ISO-BMFF ftyp magic without a media box is rejected');
const truncatedIso = Buffer.from(minimalIso('isom'));
truncatedIso.writeUInt32BE(truncatedIso.length + 8, 0);
await expectRejected('mp4', 'video/mp4', truncatedIso, 'ISO-BMFF box framing past EOF is rejected');
await expectRejected('mp4', 'video/mp4', Buffer.concat([minimalIso('isom'), Buffer.from('polyglot')]), 'unframed bytes after ISO-BMFF boxes are rejected');
await expectRejected('webm', 'video/webm', Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3]), Buffer.from('webm')]), 'EBML magic plus a docType string without framed elements is rejected');
await expectRejected('webm', 'video/webm', minimalWebm('matroska'), 'EBML with a non-WebM docType is rejected');
await expectRejected('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.concat([
  Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('[Content_Types].xml\0_rels/.rels\0word/document.xml\0'), Buffer.alloc(22),
]), 'DOCX token strings without real ZIP local/central records are rejected');
await expectRejected('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.concat([validDocx, Buffer.from('%PDF-1.7\n%%EOF')]), 'DOCX with appended polyglot bytes is rejected');
await expectRejected('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', minimalDocx([
  { name: 'word/vbaProject.bin', data: Buffer.from('macro') },
]), 'DOCX macro binary entries are rejected');
await expectRejected('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', minimalDocx([
  { name: 'word/embeddings/oleObject1.dat', data: Buffer.from('embedded') },
]), 'DOCX embedded-object entry paths are rejected');
await expectRejected('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', minimalDocx([
  { name: '../outside.xml', data: Buffer.from('<outside/>') },
]), 'DOCX traversal entry names are rejected');
const macroContentTypes = Buffer.from(contentTypesXml.toString('utf8').replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', 'application/vnd.ms-word.document.macroEnabled.main+xml'));
await expectRejected('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', minimalDocx([], macroContentTypes), 'DOCX macro-enabled content types are rejected even without a conventional macro filename');
await expectRejected('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', minimalDocx([
  { name: 'word/styles.xml', data: Buffer.from(`<styles>${'A'.repeat(2 * 1024 * 1024)}</styles>`) },
]), 'DOCX compression-ratio bombs are rejected before extraction');
const excessiveEntries = Array.from({ length: 510 }, (_, index) => ({ name: `word/empty-${String(index)}.xml`, data: Buffer.from('<empty/>') }));
await expectRejected('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', minimalDocx(excessiveEntries), 'DOCX entry-count cap rejects oversized archives');

const unsafeText = await ingestMediaUpload({
  source: Readable.from([Buffer.from([0x68, 0x69, 0x00, 0x21])]),
  declaration: declaration('txt', 'text/plain'),
});
eq(unsafeText.status, 'rejected', 'NUL/control-bearing text is rejected as non-textual');

const scannerReject: UploadScanner = { scan: async () => ({ status: 'rejected', reason: 'fixture-policy' }) };
const rejectedByScanner = await ingestMediaUpload({
  source: Readable.from([validPng]),
  declaration: declaration('png', 'image/png'),
  scanner: scannerReject,
});
eq(rejectedByScanner.status, 'rejected', 'an injected scanner rejection fails closed');

const scannerError: UploadScanner = { scan: async () => { throw new Error('scanner unavailable'); } };
const erroredScanner = await ingestMediaUpload({
  source: Readable.from([validPng]),
  declaration: declaration('png', 'image/png'),
  scanner: scannerError,
});
eq(erroredScanner.status, 'scanner-error', 'an injected scanner error fails closed distinctly');

const scannerTimeout: UploadScanner = {
  scan: async (_upload, signal) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ status: 'accepted' }), { once: true });
  }),
};
const timedOutScanner = await ingestMediaUpload({
  source: Readable.from([validPng]),
  declaration: declaration('png', 'image/png'),
  scanner: scannerTimeout,
  scannerTimeoutMs: 5,
});
eq(timedOutScanner.status, 'scanner-error', 'an injected scanner timeout fails closed even if abort resolves the scanner');

const lengthMismatch = await ingestMediaUpload({
  source: Readable.from([validPng]),
  declaration: declaration('png', 'image/png'),
  expectedBytes: validPng.length + 1,
});
eq(lengthMismatch.status, 'length-mismatch', 'short body versus declared length is rejected');

const oversizedSource = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
const oversized = await ingestMediaUpload({
  source: oversizedSource,
  declaration: { ...declaration('png', 'image/png'), maxBytes: 10 },
});
eq(oversized.status, 'too-large', 'stream cap aborts as soon as cumulative bytes exceed the request cap');
assert(oversizedSource.destroyed, 'oversize pipeline destroys the source immediately');
eq(quarantineSnapshot().join('|'), beforeRejections.join('|'), 'all rejection/error/timeout/oversize paths clean quarantine tempfiles');

const observedRateKeys: string[] = [];
const observedRateLimits: number[] = [];
let rateAllowed = true;
const rateStrategy = {
  name: 'media-upload-test',
  check: async ({ key, limit }) => {
    observedRateKeys.push(key);
    observedRateLimits.push(limit);
    return { allowed: rateAllowed, remaining: rateAllowed ? limit - 1 : 0, resetIn: 37 };
  },
  getStatus: async (_key, limit) => ({ allowed: true, remaining: limit, resetIn: 0 }),
  clear: async () => undefined,
  clearAll: async () => undefined,
} satisfies RateLimitStrategy;
registerRateLimitStrategy(rateStrategy);
const beforeRateCheck = quarantineSnapshot();
const allowedRate = await checkMediaUploadRateLimit('workspace:one', 'user:one');
eq(allowedRate.status, 'allowed', 'shared core upload limiter allows an under-limit user/workspace bucket');
eq(observedRateLimits[0], 60, 'upload limiter reuses the configured default API request cap');
assert(observedRateKeys[0]?.includes('workspace:workspace%3Aone:user:user%3Aone') === true, 'upload limiter key combines encoded workspace and user identities');
eq(quarantineSnapshot().join('|'), beforeRateCheck.join('|'), 'rate limiting itself creates no quarantine tempfile');
rateAllowed = false;
const limitedRate = await checkMediaUploadRateLimit('workspace:one', 'user:one');
eq(limitedRate.status, 'limited', 'shared core upload limiter surfaces an exhausted user/workspace bucket');
registerRateLimitStrategy(defaultRateLimitStrategy);

mkdirSync(MEDIA_QUARANTINE_DIR, { recursive: true });
const stalePaths = Array.from({ length: 3 }, () => path.join(MEDIA_QUARANTINE_DIR, `${randomUUID()}.upload`));
const freshPath = path.join(MEDIA_QUARANTINE_DIR, `${randomUUID()}.upload`);
const cleanupNow = Date.now();
for (const stalePath of stalePaths) {
  writeFileSync(stalePath, 'stale');
  utimesSync(stalePath, (cleanupNow - 10_000) / 1000, (cleanupNow - 10_000) / 1000);
}
writeFileSync(freshPath, 'fresh');
const firstCleanup = cleanupStaleQuarantinedMedia({ now: cleanupNow, maxAgeMs: 1000, maxEntries: 100, maxRemovals: 1 });
eq(firstCleanup.removed, 1, 'stale quarantine cleanup obeys its removal bound');
eq(stalePaths.filter((filePath) => existsSync(filePath)).length, 2, 'bounded cleanup removes exactly one stale tempfile');
assert(existsSync(freshPath), 'bounded cleanup preserves fresh quarantine files');
const secondCleanup = cleanupStaleQuarantinedMedia({ now: cleanupNow, maxAgeMs: 1000, maxEntries: 100, maxRemovals: 10 });
eq(secondCleanup.removed, 2, 'a later bounded pass removes the remaining stale tempfiles');
rmSync(freshPath, { force: true });

for (const filePath of promotedPaths) rmSync(filePath, { force: true });
rmSync(testMediaDir, { recursive: true, force: true });
report('mediaUploadHardening');
