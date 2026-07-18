//? Media upload route (FREEDOM_PROGRAM K1). Raw request bytes stream into a unique, non-served quarantine
//? file; only an authenticated, capability-gated upload whose declared MIME, extension, built-in signature
//? validation, and optional injected scanner all agree is atomically renamed into MEDIA_DIR. No request body
//? is accumulated in memory.

import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateRaw } from 'node:zlib';

import { checkRateLimit, getProjectConfig, readSession, getPrismaClient, tryCatch, tryCatchSync } from '@luckystack/core';
import { registerCustomRoute } from '@luckystack/server';

import { hasCapability, CAP } from '../control/rbac';
import {
  cleanupStaleQuarantinedMedia,
  createMediaQuarantinePath,
  discardQuarantinedMedia,
  promoteQuarantinedMedia,
} from './store';

const UPLOAD_PATH = '/media/upload';
const MAX_BYTES = 64 * 1024 * 1024;
const INSPECTION_HEAD_BYTES = 4096;
const INSPECTION_TAIL_BYTES = 128 * 1024;
const FILE_READ_CHUNK_BYTES = 64 * 1024;
const UPLOAD_RATE_LIMIT_FALLBACK = 60;
const UPLOAD_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_SCANNER_TIMEOUT_MS = 15 * 1000;
const ZIP_MAX_ENTRIES = 512;
const ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const ZIP_MAX_COMPRESSION_RATIO = 100;
const ZIP_RATIO_MIN_BYTES = 1024 * 1024;

export type UploadedMediaKind = 'image' | 'video' | 'audio' | 'file';

interface UploadTypeRule {
  kind: UploadedMediaKind;
  declaredMimes: readonly string[];
  maxBytes: number;
}

//? The existing 64 MB product cap remains unchanged. Keeping maxBytes on each rule makes a future lower
//? type-specific cap possible without weakening the stream limiter or introducing a second policy path.
const UPLOAD_TYPES: Record<string, UploadTypeRule> = {
  png: { kind: 'image', declaredMimes: ['image/png'], maxBytes: MAX_BYTES },
  jpg: { kind: 'image', declaredMimes: ['image/jpeg'], maxBytes: MAX_BYTES },
  jpeg: { kind: 'image', declaredMimes: ['image/jpeg'], maxBytes: MAX_BYTES },
  webp: { kind: 'image', declaredMimes: ['image/webp'], maxBytes: MAX_BYTES },
  gif: { kind: 'image', declaredMimes: ['image/gif'], maxBytes: MAX_BYTES },
  mp4: { kind: 'video', declaredMimes: ['video/mp4'], maxBytes: MAX_BYTES },
  //? Preserve the existing MediaRecorder path: .webm may be declared video/webm or audio/webm.
  webm: { kind: 'video', declaredMimes: ['video/webm', 'audio/webm'], maxBytes: MAX_BYTES },
  mov: { kind: 'video', declaredMimes: ['video/quicktime'], maxBytes: MAX_BYTES },
  mp3: { kind: 'audio', declaredMimes: ['audio/mpeg', 'audio/mp3'], maxBytes: MAX_BYTES },
  wav: { kind: 'audio', declaredMimes: ['audio/wav', 'audio/x-wav'], maxBytes: MAX_BYTES },
  ogg: { kind: 'audio', declaredMimes: ['audio/ogg'], maxBytes: MAX_BYTES },
  m4a: { kind: 'audio', declaredMimes: ['audio/mp4', 'audio/x-m4a'], maxBytes: MAX_BYTES },
  aac: { kind: 'audio', declaredMimes: ['audio/aac', 'audio/x-aac'], maxBytes: MAX_BYTES },
  pdf: { kind: 'file', declaredMimes: ['application/pdf'], maxBytes: MAX_BYTES },
  docx: { kind: 'file', declaredMimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], maxBytes: MAX_BYTES },
  txt: { kind: 'file', declaredMimes: ['text/plain'], maxBytes: MAX_BYTES },
  md: { kind: 'file', declaredMimes: ['text/markdown', 'text/plain'], maxBytes: MAX_BYTES },
};

export interface UploadDeclaration {
  ext: string;
  declaredMime: string;
  kind: UploadedMediaKind;
  maxBytes: number;
}

export function resolveUploadDeclaration(rawExt: string, rawMime: string | undefined): UploadDeclaration | null {
  const ext = rawExt.trim().toLowerCase();
  const declaredMime = (rawMime ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const rule = UPLOAD_TYPES[ext];
  if (rule === undefined || declaredMime.length === 0 || !rule.declaredMimes.includes(declaredMime)) return null;
  return { ext, declaredMime, kind: rule.kind, maxBytes: rule.maxBytes };
}

export type UploadContentLengthCheck =
  | { status: 'absent' }
  | { status: 'valid'; bytes: number }
  | { status: 'empty' | 'invalid' | 'oversize' };

export function checkUploadContentLength(value: string | string[] | undefined, maxBytes: number): UploadContentLengthCheck {
  if (value === undefined) return { status: 'absent' };
  if (Array.isArray(value)) return { status: 'invalid' };
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return { status: 'invalid' };
  const bytes = Number(normalized);
  if (!Number.isSafeInteger(bytes)) return { status: 'invalid' };
  if (bytes === 0) return { status: 'empty' };
  if (bytes > maxBytes) return { status: 'oversize' };
  return { status: 'valid', bytes };
}

class UploadTooLargeError extends Error {}

class UploadLimitTransform extends Transform {
  bytes = 0;

  constructor(private readonly maxBytes: number) { super(); }

  override _transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.bytes += bytes.length;
    if (this.bytes > this.maxBytes) {
      callback(new UploadTooLargeError('upload exceeds byte cap'));
      return;
    }
    callback(null, bytes);
  }
}

export type UploadStreamResult =
  | { status: 'stored'; bytes: number }
  | { status: 'empty' | 'too-large' | 'stream-error' };

//? `pipeline` propagates the limiter error by destroying the request + quarantine writer immediately; it
//? also supplies backpressure, so a slow disk cannot turn the request into an in-memory buffer.
export async function streamUploadToQuarantine(source: Readable, quarantinePath: string, maxBytes: number): Promise<UploadStreamResult> {
  const limiter = new UploadLimitTransform(maxBytes);
  const writer = createWriteStream(quarantinePath, { flags: 'wx', mode: 0o600 });
  const [error] = await tryCatch(() => pipeline(source, limiter, writer));
  if (error instanceof UploadTooLargeError) return { status: 'too-large' };
  if (error) return { status: 'stream-error' };
  if (limiter.bytes === 0) return { status: 'empty' };
  return { status: 'stored', bytes: limiter.bytes };
}

export interface UploadScanInput {
  path: string;
  ext: string;
  declaredMime: string;
  kind: UploadedMediaKind;
  sizeBytes: number;
}

export type UploadScanDecision =
  | { status: 'accepted' }
  | { status: 'rejected'; reason: string };

export interface UploadScanner {
  scan: (upload: UploadScanInput, signal: AbortSignal) => Promise<UploadScanDecision>;
}

interface UploadInspection {
  head: Buffer;
  tail: Buffer;
  textValidUtf8: boolean;
  textHasForbiddenControl: boolean;
}

function appendTail(current: Buffer, chunk: Buffer): Buffer {
  if (chunk.length >= INSPECTION_TAIL_BYTES) return Buffer.from(chunk.subarray(chunk.length - INSPECTION_TAIL_BYTES));
  const joined = Buffer.concat([current, chunk]);
  return joined.length <= INSPECTION_TAIL_BYTES
    ? joined
    : Buffer.from(joined.subarray(joined.length - INSPECTION_TAIL_BYTES));
}

async function inspectUploadFile(filePath: string, inspectText: boolean, signal: AbortSignal): Promise<UploadInspection | null> {
  const [error, inspection] = await tryCatch(async () => {
    let head = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let textValidUtf8 = true;
    let textHasForbiddenControl = false;
    const decoder = inspectText ? new TextDecoder('utf-8', { fatal: true }) : null;

    for await (const rawChunk of createReadStream(filePath, { signal })) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(String(rawChunk));
      if (head.length < INSPECTION_HEAD_BYTES) {
        const remaining = INSPECTION_HEAD_BYTES - head.length;
        head = Buffer.concat([head, chunk.subarray(0, remaining)]);
      }
      tail = appendTail(tail, chunk);

      if (inspectText) {
        for (const byte of chunk) {
          if (byte < 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0C && byte !== 0x0D) {
            textHasForbiddenControl = true;
          }
        }
        if (decoder !== null && textValidUtf8) {
          const [decodeError] = tryCatchSync(() => decoder.decode(chunk, { stream: true }));
          if (decodeError) textValidUtf8 = false;
        }
      }
    }

    if (decoder !== null && textValidUtf8) {
      const [decodeError] = tryCatchSync(() => decoder.decode());
      if (decodeError) textValidUtf8 = false;
    }
    return { head, tail, textValidUtf8, textHasForbiddenControl };
  });
  return error ? null : inspection;
}

type MagicKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'pdf' | 'zip' | 'webm' | 'iso-bmff' | 'mp3' | 'wav' | 'ogg' | 'aac' | 'unknown';

function startsWithBytes(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function detectMagic(head: Buffer): MagicKind {
  if (startsWithBytes(head, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'png';
  if (startsWithBytes(head, [0xFF, 0xD8, 0xFF])) return 'jpeg';
  if (head.subarray(0, 6).toString('ascii') === 'GIF87a' || head.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (head.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (startsWithBytes(head, [0x50, 0x4B, 0x03, 0x04])) return 'zip';
  if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav';
  if (head.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (startsWithBytes(head, [0x1A, 0x45, 0xDF, 0xA3])) return 'webm';
  if (head.subarray(4, 8).toString('ascii') === 'ftyp') return 'iso-bmff';
  if (head.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3';
  if (head.subarray(0, 4).toString('ascii') === 'ADIF') return 'aac';
  if (head.length >= 2 && head[0] === 0xFF && ((head[1] ?? 0) & 0xF6) === 0xF0) return 'aac';
  if (head.length >= 2 && head[0] === 0xFF && ((head[1] ?? 0) & 0xE0) === 0xE0 && ((head[1] ?? 0) & 0x06) !== 0) return 'mp3';
  return 'unknown';
}

function hasOnlyTrailingWhitespace(bytes: Buffer, from: number): boolean {
  for (let index = from; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte !== 0x09 && byte !== 0x0A && byte !== 0x0C && byte !== 0x0D && byte !== 0x20) return false;
  }
  return true;
}

function validPdfTail(tail: Buffer): boolean {
  const marker = Buffer.from('%%EOF');
  const index = tail.lastIndexOf(marker);
  return index !== -1 && hasOnlyTrailingWhitespace(tail, index + marker.length);
}

async function readFileRange(handle: FileHandle, position: number, length: number, signal: AbortSignal): Promise<Buffer | null> {
  if (position < 0 || length < 0 || signal.aborted) return null;
  const bytes = Buffer.alloc(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const [readError, result] = await tryCatch(() => handle.read(bytes, bytesRead, length - bytesRead, position + bytesRead));
    if (readError || result === null || result.bytesRead === 0) return null;
    bytesRead += result.bytesRead;
  }
  return bytes;
}

async function validateWithFileHandle(
  filePath: string,
  validate: (handle: FileHandle) => Promise<boolean>,
): Promise<boolean> {
  const [openError, handle] = await tryCatch(() => open(filePath, 'r'));
  if (openError || handle === null) throw new Error('upload file could not be opened');
  const [validationError, valid] = await tryCatch(() => validate(handle));
  const [closeError] = await tryCatch(() => handle.close());
  if (validationError || closeError || valid === null) throw new Error('upload file validation failed');
  return valid;
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xED_B8_83_20 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function updateCrc32(crc: number, bytes: Buffer): number {
  let next = crc >>> 0;
  for (const byte of bytes) next = (CRC32_TABLE[(next ^ byte) & 0xFF] ?? 0) ^ (next >>> 8);
  return next >>> 0;
}

function crc32(bytes: Buffer): number {
  return (updateCrc32(0xFF_FF_FF_FF, bytes) ^ 0xFF_FF_FF_FF) >>> 0;
}

async function validatePng(handle: FileHandle, sizeBytes: number, signal: AbortSignal): Promise<boolean> {
  if (sizeBytes < 57) return false;
  let offset = 8;
  let sawHeader = false;
  let sawImageDataChunk = false;
  let sawImageDataBytes = false;
  let imageDataEnded = false;

  while (offset < sizeBytes) {
    const chunkHeader = await readFileRange(handle, offset, 8, signal);
    if (chunkHeader === null) return false;
    const length = chunkHeader.readUInt32BE(0);
    const typeBytes = chunkHeader.subarray(4, 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type) || offset + 12 + length > sizeBytes) return false;
    const firstTypeByte = typeBytes[0] ?? 0;
    if (firstTypeByte >= 0x41 && firstTypeByte <= 0x5A && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) return false;

    const dataOffset = offset + 8;
    let crc = updateCrc32(0xFF_FF_FF_FF, typeBytes);
    let consumed = 0;
    while (consumed < length) {
      const partLength = Math.min(FILE_READ_CHUNK_BYTES, length - consumed);
      const part = await readFileRange(handle, dataOffset + consumed, partLength, signal);
      if (part === null) return false;
      crc = updateCrc32(crc, part);
      consumed += partLength;
    }
    const expectedCrc = await readFileRange(handle, dataOffset + length, 4, signal);
    if (expectedCrc?.readUInt32BE(0) !== ((crc ^ 0xFF_FF_FF_FF) >>> 0)) return false;

    switch (type) {
      case 'IHDR': {
        if (sawHeader || offset !== 8 || length !== 13) return false;
        const header = await readFileRange(handle, dataOffset, 13, signal);
        if (header?.length !== 13 || header.readUInt32BE(0) === 0 || header.readUInt32BE(4) === 0) return false;
        const bitDepth = header[8] ?? 0;
        const colorType = header[9] ?? -1;
        const validDepths: Record<number, readonly number[]> = {
          0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
        };
        if (validDepths[colorType]?.includes(bitDepth) !== true || header[10] !== 0 || header[11] !== 0 || (header[12] ?? 2) > 1) return false;
        sawHeader = true;
        break;
      }
      case 'PLTE': {
        if (!sawHeader || sawImageDataChunk || length === 0 || length % 3 !== 0 || length > 768) return false;
        break;
      }
      case 'IDAT': {
        if (!sawHeader || imageDataEnded) return false;
        sawImageDataChunk = true;
        sawImageDataBytes ||= length > 0;
        break;
      }
      case 'IEND': {
        return sawHeader && sawImageDataBytes && length === 0 && offset + 12 === sizeBytes;
      }
    }
    if (type !== 'IDAT' && sawImageDataChunk) imageDataEnded = true;
    offset += 12 + length;
  }
  return false;
}

class BufferedFileReader {
  position = 0;
  private cache = Buffer.alloc(0);
  private cacheStart = 0;

  constructor(
    private readonly handle: FileHandle,
    readonly sizeBytes: number,
    private readonly signal: AbortSignal,
  ) {}

  async readByte(): Promise<number | null> {
    if (this.position >= this.sizeBytes || this.signal.aborted) return null;
    if (this.position < this.cacheStart || this.position >= this.cacheStart + this.cache.length) {
      this.cacheStart = this.position;
      const length = Math.min(FILE_READ_CHUNK_BYTES, this.sizeBytes - this.position);
      const next = await readFileRange(this.handle, this.position, length, this.signal);
      if (next === null) return null;
      this.cache = next;
    }
    const byte = this.cache[this.position - this.cacheStart];
    this.position += 1;
    return byte ?? null;
  }

  async readBytes(length: number): Promise<Buffer | null> {
    if (length < 0 || this.position + length > this.sizeBytes) return null;
    const bytes = await readFileRange(this.handle, this.position, length, this.signal);
    if (bytes !== null) this.position += length;
    return bytes;
  }
}

const JPEG_SOF_MARKERS = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);

async function readJpegMarker(reader: BufferedFileReader): Promise<number | null> {
  if (await reader.readByte() !== 0xFF) return null;
  let marker = await reader.readByte();
  while (marker === 0xFF) marker = await reader.readByte();
  return marker === 0x00 ? null : marker;
}

async function validateJpeg(handle: FileHandle, sizeBytes: number, signal: AbortSignal): Promise<boolean> {
  const reader = new BufferedFileReader(handle, sizeBytes, signal);
  if (await reader.readByte() !== 0xFF || await reader.readByte() !== 0xD8) return false;
  let sawFrame = false;
  let sawScan = false;
  let pendingMarker: number | null = null;

  while (reader.position < sizeBytes) {
    const marker = pendingMarker ?? await readJpegMarker(reader);
    pendingMarker = null;
    if (marker === null || marker === 0xD8 || marker === 0x00 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) return false;
    if (marker === 0xD9) return sawFrame && sawScan && reader.position === sizeBytes;

    const lengthBytes = await reader.readBytes(2);
    if (lengthBytes === null) return false;
    const segmentLength = lengthBytes.readUInt16BE(0);
    if (segmentLength < 2) return false;
    const payload = await reader.readBytes(segmentLength - 2);
    if (payload === null) return false;

    if (JPEG_SOF_MARKERS.has(marker)) {
      const components = payload[5] ?? 0;
      if (payload.length !== 6 + 3 * components || ![8, 12, 16].includes(payload[0] ?? 0)
        || payload.readUInt16BE(1) === 0 || payload.readUInt16BE(3) === 0 || components === 0) return false;
      sawFrame = true;
    }
    if (marker !== 0xDA) continue;

    const components = payload[0] ?? 0;
    if (!sawFrame || components === 0 || payload.length !== 4 + 2 * components) return false;
    sawScan = true;
    let sawEntropy = false;
    while (reader.position < sizeBytes) {
      const byte = await reader.readByte();
      if (byte === null) return false;
      if (byte !== 0xFF) { sawEntropy = true; continue; }
      let next = await reader.readByte();
      while (next === 0xFF) next = await reader.readByte();
      if (next === null) return false;
      if (next === 0x00) { sawEntropy = true; continue; }
      if (next >= 0xD0 && next <= 0xD7) continue;
      if (!sawEntropy) return false;
      if (next === 0xD9) return reader.position === sizeBytes;
      pendingMarker = next;
      break;
    }
  }
  return false;
}

function isFourCc(bytes: Buffer): boolean {
  return bytes.length === 4 && [...bytes].every((byte) => byte >= 0x20 && byte <= 0x7E);
}

async function validateRiff(handle: FileHandle, sizeBytes: number, formType: 'WEBP' | 'WAVE', signal: AbortSignal): Promise<boolean> {
  const header = await readFileRange(handle, 0, 12, signal);
  if (header?.subarray(0, 4).toString('ascii') !== 'RIFF'
    || header.readUInt32LE(4) + 8 !== sizeBytes || header.subarray(8, 12).toString('ascii') !== formType) return false;

  let offset = 12;
  let sawImageData = false;
  let sawWaveFormat = false;
  let sawWaveData = false;
  while (offset < sizeBytes) {
    const chunkHeader = await readFileRange(handle, offset, 8, signal);
    if (chunkHeader === null || !isFourCc(chunkHeader.subarray(0, 4))) return false;
    const type = chunkHeader.subarray(0, 4).toString('ascii');
    const length = chunkHeader.readUInt32LE(4);
    const paddedLength = length + (length % 2);
    if (offset + 8 + paddedLength > sizeBytes) return false;

    switch (`${formType}:${type}`) {
      case 'WEBP:VP8 ': {
        const frame = await readFileRange(handle, offset + 8, Math.min(length, 10), signal);
        if (length < 10 || frame?.subarray(3, 6).equals(Buffer.from([0x9D, 0x01, 0x2A])) !== true) return false;
        sawImageData = true;
        break;
      }
      case 'WEBP:VP8L': {
        const frame = await readFileRange(handle, offset + 8, Math.min(length, 5), signal);
        const packed = frame?.readUInt32LE(1) ?? 0;
        if (length < 5 || frame?.[0] !== 0x2F || ((packed >>> 29) & 0x07) !== 0) return false;
        sawImageData = true;
        break;
      }
      case 'WEBP:VP8X': {
        if (length !== 10) return false;
        break;
      }
      case 'WAVE:fmt ': {
        const format = await readFileRange(handle, offset + 8, Math.min(length, 16), signal);
        if (sawWaveFormat || length < 16 || ![1, 3, 6, 7, 0xFF_FE].includes(format?.readUInt16LE(0) ?? 0)
          || format?.readUInt16LE(2) === 0 || format?.readUInt32LE(4) === 0 || format?.readUInt32LE(8) === 0
          || format?.readUInt16LE(12) === 0 || format?.readUInt16LE(14) === 0) return false;
        sawWaveFormat = true;
        break;
      }
      case 'WAVE:data': {
        sawWaveData ||= length > 0;
        break;
      }
    }
    offset += 8 + paddedLength;
  }
  return offset === sizeBytes && (formType === 'WEBP' ? sawImageData : sawWaveFormat && sawWaveData);
}

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'MSNV', '3gp4', '3gp5', '3gp6']);
const M4A_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);

async function validateIsoBmff(handle: FileHandle, sizeBytes: number, ext: 'mp4' | 'mov' | 'm4a', signal: AbortSignal): Promise<boolean> {
  let offset = 0;
  let brands: Set<string> | null = null;
  let sawMediaBox = false;
  while (offset < sizeBytes) {
    const baseHeader = await readFileRange(handle, offset, 8, signal);
    if (baseHeader === null || !isFourCc(baseHeader.subarray(4, 8))) return false;
    const type = baseHeader.subarray(4, 8).toString('ascii');
    const size32 = baseHeader.readUInt32BE(0);
    let headerSize = 8;
    let boxSize = size32;
    if (size32 === 1) {
      const extended = await readFileRange(handle, offset + 8, 8, signal);
      if (extended === null || extended.readBigUInt64BE(0) > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      boxSize = Number(extended.readBigUInt64BE(0));
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = sizeBytes - offset;
    }
    if (type === 'uuid') headerSize += 16;
    if (boxSize < headerSize || offset + boxSize > sizeBytes || (size32 === 0 && offset + boxSize !== sizeBytes)) return false;

    if (type === 'ftyp') {
      if (offset !== 0 || brands !== null || boxSize - headerSize < 8 || boxSize - headerSize > 1024 || (boxSize - headerSize - 8) % 4 !== 0) return false;
      const payload = await readFileRange(handle, offset + headerSize, boxSize - headerSize, signal);
      if (payload === null) return false;
      brands = new Set([payload.subarray(0, 4).toString('ascii')]);
      for (let brandOffset = 8; brandOffset < payload.length; brandOffset += 4) brands.add(payload.subarray(brandOffset, brandOffset + 4).toString('ascii'));
    }
    if (['moov', 'mdat', 'moof'].includes(type)) sawMediaBox = true;
    offset += boxSize;
  }
  if (offset !== sizeBytes || brands === null || !sawMediaBox) return false;
  if (ext === 'mov') return brands.has('qt  ');
  if (ext === 'm4a') return [...M4A_BRANDS].some((brand) => brands.has(brand));
  return [...MP4_BRANDS].some((brand) => brands.has(brand)) && !brands.has('qt  ') && ![...brands].some((brand) => brand.startsWith('M4'));
}

interface EbmlVint {
  length: number;
  unknown: boolean;
  value: bigint;
}

function parseEbmlVint(bytes: Buffer, offset: number, preserveMarker: boolean, maxLength: number): EbmlVint | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let marker = 0x80;
  let length = 1;
  while ((first & marker) === 0) { marker >>= 1; length += 1; }
  if (length > maxLength || offset + length > bytes.length) return null;
  let value = BigInt(preserveMarker ? first : first & (marker - 1));
  let unknown = !preserveMarker && (first & (marker - 1)) === marker - 1;
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) return null;
    value = (value << 8n) | BigInt(byte);
    unknown &&= byte === 0xFF;
  }
  return { length, unknown, value };
}

function readEbmlUnsigned(bytes: Buffer): number | null {
  if (bytes.length === 0 || bytes.length > 8) return null;
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

async function validateWebm(handle: FileHandle, sizeBytes: number, signal: AbortSignal): Promise<boolean> {
  const prefix = await readFileRange(handle, 0, Math.min(sizeBytes, 16), signal);
  if (prefix === null) return false;
  const headerId = parseEbmlVint(prefix, 0, true, 4);
  if (headerId?.value !== 0x1A_45_DF_A3n) return false;
  const headerSizeVint = parseEbmlVint(prefix, headerId.length, false, 8);
  if (headerSizeVint === null || headerSizeVint.unknown || headerSizeVint.value > 4096n) return false;
  const headerOffset = headerId.length + headerSizeVint.length;
  const headerSize = Number(headerSizeVint.value);
  if (headerOffset + headerSize >= sizeBytes) return false;
  const header = await readFileRange(handle, headerOffset, headerSize, signal);
  if (header === null) return false;

  let offset = 0;
  let docType: string | null = null;
  let ebmlVersion: number | null = null;
  let ebmlReadVersion: number | null = null;
  let maxIdLength: number | null = null;
  let maxSizeLength: number | null = null;
  let docTypeReadVersion: number | null = null;
  while (offset < header.length) {
    const id = parseEbmlVint(header, offset, true, 4);
    if (id === null) return false;
    const size = parseEbmlVint(header, offset + id.length, false, 8);
    if (size === null || size.unknown || size.value > BigInt(header.length)) return false;
    const dataOffset = offset + id.length + size.length;
    const dataLength = Number(size.value);
    if (dataOffset + dataLength > header.length) return false;
    const data = header.subarray(dataOffset, dataOffset + dataLength);
    const numeric = readEbmlUnsigned(data);
    switch (Number(id.value)) {
      case 0x42_86: { ebmlVersion = numeric; break; }
      case 0x42_F7: { ebmlReadVersion = numeric; break; }
      case 0x42_F2: { maxIdLength = numeric; break; }
      case 0x42_F3: { maxSizeLength = numeric; break; }
      case 0x42_82: { if (docType !== null) return false; docType = data.toString('ascii'); break; }
      case 0x42_85: { docTypeReadVersion = numeric; break; }
    }
    offset = dataOffset + dataLength;
  }
  if (offset !== header.length || docType !== 'webm' || ebmlVersion !== 1 || ebmlReadVersion !== 1
    || maxIdLength === null || maxIdLength > 4 || maxSizeLength === null || maxSizeLength > 8
    || docTypeReadVersion === null || docTypeReadVersion > 2) return false;

  const segmentOffset = headerOffset + headerSize;
  const segmentPrefix = await readFileRange(handle, segmentOffset, Math.min(16, sizeBytes - segmentOffset), signal);
  if (segmentPrefix === null) return false;
  const segmentId = parseEbmlVint(segmentPrefix, 0, true, 4);
  if (segmentId?.value !== 0x18_53_80_67n) return false;
  const segmentSize = parseEbmlVint(segmentPrefix, segmentId.length, false, 8);
  if (segmentSize === null) return false;
  const payloadOffset = segmentOffset + segmentId.length + segmentSize.length;
  if (payloadOffset > sizeBytes) return false;
  if (segmentSize.unknown) return true;
  return segmentSize.value <= BigInt(Number.MAX_SAFE_INTEGER) && payloadOffset + Number(segmentSize.value) === sizeBytes;
}

interface ZipEntry {
  name: string;
  nameBytes: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

interface ZipEocd {
  offset: number;
  entries: number;
  centralOffset: number;
  centralSize: number;
}

function findZipEocd(tail: Buffer, sizeBytes: number): ZipEocd | null {
  const signature = Buffer.from([0x50, 0x4B, 0x05, 0x06]);
  let index = tail.length - 22;
  while (index >= 0) {
    index = tail.lastIndexOf(signature, index);
    if (index === -1) return null;
    if (index + 22 <= tail.length && index + 22 + tail.readUInt16LE(index + 20) === tail.length) {
      const disk = tail.readUInt16LE(index + 4);
      const centralDisk = tail.readUInt16LE(index + 6);
      const diskEntries = tail.readUInt16LE(index + 8);
      const entries = tail.readUInt16LE(index + 10);
      const centralSize = tail.readUInt32LE(index + 12);
      const centralOffset = tail.readUInt32LE(index + 16);
      const offset = sizeBytes - tail.length + index;
      if (disk === 0 && centralDisk === 0 && diskEntries === entries && entries >= 3 && entries <= ZIP_MAX_ENTRIES
        && centralOffset + centralSize === offset) return { offset, entries, centralOffset, centralSize };
      return null;
    }
    index -= 1;
  }
  return null;
}

function decodeZipName(bytes: Buffer, utf8: boolean): string | null {
  if (bytes.length === 0 || bytes.length > 1024 || bytes.includes(0)) return null;
  if (!utf8 && [...bytes].some((byte) => byte > 0x7F)) return null;
  const decoder = new TextDecoder(utf8 ? 'utf8' : 'ascii', { fatal: true });
  const [decodeError, name] = tryCatchSync(() => decoder.decode(bytes));
  return decodeError || name === null ? null : name;
}

function isSafeDocxEntryName(name: string): boolean {
  const withoutDirectorySlash = name.endsWith('/') ? name.slice(0, -1) : name;
  if (withoutDirectorySlash.length === 0 || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) return false;
  const segments = withoutDirectorySlash.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isForbiddenDocxEntryName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.bin') || lower.startsWith('word/embeddings/') || lower.startsWith('word/activex/')
    || lower.startsWith('customui/') || lower.includes('vbaproject') || lower.includes('oleobject');
}

function decodeDocxXml(bytes: Buffer): string | null {
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return null;
  const encoding = bytes[0] === 0xFF && bytes[1] === 0xFE ? 'utf-16le' : 'utf8';
  const decoder = new TextDecoder(encoding, { fatal: true });
  const [decodeError, text] = tryCatchSync(() => decoder.decode(bytes));
  return decodeError || text === null ? null : text.toLowerCase();
}

const FORBIDDEN_DOCX_XML = [
  'vbaproject', 'macroenabled', 'oleobject', 'relationships/oleobject', 'relationships/package',
  '<w:object', 'activex', 'word/embeddings', 'attachedtemplate',
];

function inflateRawBounded(bytes: Buffer, maxOutputLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    inflateRaw(bytes, { maxOutputLength }, (error, result) => {
      if (error) { reject(error); return; }
      resolve(result);
    });
  });
}

async function readZipEntryData(handle: FileHandle, entry: ZipEntry, dataOffset: number, signal: AbortSignal): Promise<Buffer | null> {
  const compressed = await readFileRange(handle, dataOffset, entry.compressedSize, signal);
  if (compressed === null) return null;
  if (entry.method === 0) return entry.compressedSize === entry.uncompressedSize ? compressed : null;
  const maxOutputLength = Math.min(entry.uncompressedSize + 1, ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES + 1);
  const [inflateError, inflated] = await tryCatch(() => inflateRawBounded(compressed, maxOutputLength));
  return inflateError || inflated?.length !== entry.uncompressedSize ? null : inflated;
}

async function validateDocx(handle: FileHandle, sizeBytes: number, tail: Buffer, signal: AbortSignal): Promise<boolean> {
  const eocd = findZipEocd(tail, sizeBytes);
  if (!eocd?.centralOffset || eocd.centralSize < eocd.entries * 46) return false;
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let centralPosition = eocd.centralOffset;
  let declaredUncompressed = 0;
  let declaredCompressed = 0;

  for (let index = 0; index < eocd.entries; index += 1) {
    const fixed = await readFileRange(handle, centralPosition, 46, signal);
    if (fixed?.readUInt32LE(0) !== 0x02_01_4B_50) return false;
    const flags = fixed.readUInt16LE(8);
    const method = fixed.readUInt16LE(10);
    const compressedSize = fixed.readUInt32LE(20);
    const uncompressedSize = fixed.readUInt32LE(24);
    const nameLength = fixed.readUInt16LE(28);
    const extraLength = fixed.readUInt16LE(30);
    const commentLength = fixed.readUInt16LE(32);
    const localOffset = fixed.readUInt32LE(42);
    if ((flags & 0x20_41) !== 0 || ![0, 8].includes(method) || compressedSize === 0xFF_FF_FF_FF
      || uncompressedSize === 0xFF_FF_FF_FF || localOffset === 0xFF_FF_FF_FF || fixed.readUInt16LE(34) !== 0) return false;
    const nameBytes = await readFileRange(handle, centralPosition + 46, nameLength, signal);
    if (nameBytes === null) return false;
    const name = decodeZipName(nameBytes, (flags & 0x08_00) !== 0);
    const normalizedName = name?.toLowerCase() ?? '';
    if (name === null || !isSafeDocxEntryName(name) || names.has(normalizedName) || isForbiddenDocxEntryName(name)) return false;
    names.add(normalizedName);
    if (name.endsWith('/') && (compressedSize !== 0 || uncompressedSize !== 0)) return false;
    if (uncompressedSize > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) return false;
    declaredUncompressed += uncompressedSize;
    declaredCompressed += compressedSize;
    if (declaredUncompressed > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) return false;
    if (uncompressedSize >= ZIP_RATIO_MIN_BYTES && uncompressedSize / Math.max(1, compressedSize) > ZIP_MAX_COMPRESSION_RATIO) return false;
    entries.push({ name, nameBytes, flags, method, crc: fixed.readUInt32LE(16), compressedSize, uncompressedSize, localOffset });
    centralPosition += 46 + nameLength + extraLength + commentLength;
    if (centralPosition > eocd.offset) return false;
  }
  if (centralPosition !== eocd.offset || !names.has('[content_types].xml') || !names.has('_rels/.rels') || !names.has('word/document.xml')) return false;
  if (declaredUncompressed >= ZIP_RATIO_MIN_BYTES && declaredUncompressed / Math.max(1, declaredCompressed) > ZIP_MAX_COMPRESSION_RATIO) return false;

  const localEntries = entries.toSorted((left, right) => left.localOffset - right.localOffset);
  if (localEntries[0]?.localOffset !== 0) return false;
  let expectedOffset = 0;
  let actualUncompressed = 0;
  let contentTypesValid = false;
  let relationshipsValid = false;
  let documentValid = false;

  for (const entry of localEntries) {
    if (entry.localOffset !== expectedOffset) return false;
    const local = await readFileRange(handle, entry.localOffset, 30, signal);
    if (local?.readUInt32LE(0) !== 0x04_03_4B_50 || local.readUInt16LE(6) !== entry.flags
      || local.readUInt16LE(8) !== entry.method) return false;
    const usesDescriptor = (entry.flags & 0x00_08) !== 0;
    if (!usesDescriptor && (local.readUInt32LE(14) !== entry.crc || local.readUInt32LE(18) !== entry.compressedSize
      || local.readUInt32LE(22) !== entry.uncompressedSize)) return false;
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const localName = await readFileRange(handle, entry.localOffset + 30, nameLength, signal);
    if (localName?.equals(entry.nameBytes) !== true) return false;
    const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataEnd > eocd.centralOffset) return false;
    const data = await readZipEntryData(handle, entry, dataOffset, signal);
    if (data === null || crc32(data) !== entry.crc) return false;
    actualUncompressed += data.length;
    if (actualUncompressed > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) return false;

    const lowerName = entry.name.toLowerCase();
    if (lowerName.endsWith('.xml') || lowerName.endsWith('.rels')) {
      const xml = decodeDocxXml(data);
      if (xml === null || FORBIDDEN_DOCX_XML.some((token) => xml.includes(token))) return false;
      if (lowerName === '[content_types].xml') contentTypesValid = /<(?:[\w-]+:)?types\b/.test(xml);
      if (lowerName === '_rels/.rels') relationshipsValid = /<(?:[\w-]+:)?relationships\b/.test(xml);
      if (lowerName === 'word/document.xml') documentValid = /<(?:[\w-]+:)?document\b/.test(xml);
    }

    expectedOffset = dataEnd;
    if (usesDescriptor) {
      const descriptor = await readFileRange(handle, dataEnd, Math.min(16, eocd.centralOffset - dataEnd), signal);
      if (descriptor === null || descriptor.length < 12) return false;
      const hasSignature = descriptor.length >= 16 && descriptor.readUInt32LE(0) === 0x08_07_4B_50;
      const valueOffset = hasSignature ? 4 : 0;
      if (descriptor.readUInt32LE(valueOffset) !== entry.crc || descriptor.readUInt32LE(valueOffset + 4) !== entry.compressedSize
        || descriptor.readUInt32LE(valueOffset + 8) !== entry.uncompressedSize) return false;
      expectedOffset += hasSignature ? 16 : 12;
    }
  }
  return expectedOffset === eocd.centralOffset && contentTypesValid && relationshipsValid && documentValid;
}

async function validateBuiltInSignature(upload: UploadScanInput, inspection: UploadInspection, signal: AbortSignal): Promise<UploadScanDecision> {
  const { ext, sizeBytes } = upload;
  const { head, tail } = inspection;
  const magic = detectMagic(head);
  const rejected: UploadScanDecision = { status: 'rejected', reason: 'type-signature-mismatch' };
  let valid = false;

  switch (ext) {
    case 'png': {
      if (magic === 'png') valid = await validateWithFileHandle(upload.path, (handle) => validatePng(handle, sizeBytes, signal));
      break;
    }
    case 'jpg':
    case 'jpeg': {
      if (magic === 'jpeg') valid = await validateWithFileHandle(upload.path, (handle) => validateJpeg(handle, sizeBytes, signal));
      break;
    }
    case 'webp': {
      if (magic === 'webp') valid = await validateWithFileHandle(upload.path, (handle) => validateRiff(handle, sizeBytes, 'WEBP', signal));
      break;
    }
    case 'wav': {
      if (magic === 'wav') valid = await validateWithFileHandle(upload.path, (handle) => validateRiff(handle, sizeBytes, 'WAVE', signal));
      break;
    }
    case 'docx': {
      if (magic === 'zip') valid = await validateWithFileHandle(upload.path, (handle) => validateDocx(handle, sizeBytes, tail, signal));
      break;
    }
    case 'webm': {
      if (magic === 'webm') valid = await validateWithFileHandle(upload.path, (handle) => validateWebm(handle, sizeBytes, signal));
      break;
    }
    case 'mov':
    case 'm4a':
    case 'mp4': {
      if (magic === 'iso-bmff') valid = await validateWithFileHandle(upload.path, (handle) => validateIsoBmff(handle, sizeBytes, ext, signal));
      break;
    }
    case 'gif': { valid = magic === 'gif' && tail.at(-1) === 0x3B; break; }
    case 'pdf': { valid = magic === 'pdf' && validPdfTail(tail); break; }
    case 'mp3': { valid = magic === 'mp3'; break; }
    case 'ogg': { valid = magic === 'ogg'; break; }
    case 'aac': { valid = magic === 'aac'; break; }
    case 'txt':
    case 'md': {
      const saneText = magic === 'unknown' && inspection.textValidUtf8 && !inspection.textHasForbiddenControl;
      return saneText ? { status: 'accepted' } : { status: 'rejected', reason: 'unsafe-text' };
    }
  }
  return valid ? { status: 'accepted' } : rejected;
}

//? This default is exactly what its name says: built-in type/integrity validation. It makes no antivirus or
//? malware-clean claim. Deployments can inject an additional real scanner; scanner errors/timeouts fail closed.
export const builtInUploadScanner: UploadScanner = {
  scan: async (upload, signal) => {
    const inspection = await inspectUploadFile(upload.path, upload.ext === 'txt' || upload.ext === 'md', signal);
    if (inspection === null) throw new Error('built-in upload inspection failed');
    return validateBuiltInSignature(upload, inspection, signal);
  },
};

class UploadScannerTimeoutError extends Error {}

class UploadScannerTimeout {
  readonly promise: Promise<UploadScanDecision>;
  private rejectPromise: ((reason?: unknown) => void) | null = null;

  constructor() {
    this.promise = new Promise((_resolve, reject) => { this.rejectPromise = reject; });
  }

  reject(reason: unknown): void {
    this.rejectPromise?.(reason);
  }
}

async function runUploadScanner(
  scanner: UploadScanner,
  input: UploadScanInput,
  timeoutMs: number,
): Promise<[Error | null, UploadScanDecision | null]> {
  const controller = new AbortController();
  const timeout = new UploadScannerTimeout();
  const timer = setTimeout(() => {
    timeout.reject(new UploadScannerTimeoutError('upload scanner timed out'));
    controller.abort();
  }, timeoutMs);
  const result = await tryCatch(() => Promise.race([scanner.scan(input, controller.signal), timeout.promise]));
  clearTimeout(timer);
  if (result[0] !== null) controller.abort();
  return result;
}

export type UploadIngestResult =
  | { status: 'accepted'; url: string; path: string; kind: UploadedMediaKind; bytes: number }
  | { status: 'empty' | 'too-large' | 'length-mismatch' | 'rejected' | 'scanner-error' | 'storage-error' };

export interface UploadIngestOptions {
  source: Readable;
  declaration: UploadDeclaration;
  expectedBytes?: number;
  scanner?: UploadScanner;
  scannerTimeoutMs?: number;
}

export async function ingestMediaUpload(options: UploadIngestOptions): Promise<UploadIngestResult> {
  const [pathError, quarantinePath] = tryCatchSync(() => createMediaQuarantinePath());
  if (pathError || quarantinePath === null) return { status: 'storage-error' };

  const streamResult = await streamUploadToQuarantine(options.source, quarantinePath, options.declaration.maxBytes);
  if (streamResult.status !== 'stored') {
    discardQuarantinedMedia(quarantinePath);
    return { status: streamResult.status === 'stream-error' ? 'storage-error' : streamResult.status };
  }
  if (options.expectedBytes !== undefined && options.expectedBytes !== streamResult.bytes) {
    discardQuarantinedMedia(quarantinePath);
    return { status: 'length-mismatch' };
  }

  const scanInput: UploadScanInput = {
    path: quarantinePath,
    ext: options.declaration.ext,
    declaredMime: options.declaration.declaredMime,
    kind: options.declaration.kind,
    sizeBytes: streamResult.bytes,
  };
  const scanners = options.scanner === undefined ? [builtInUploadScanner] : [builtInUploadScanner, options.scanner];
  const scannerTimeoutMs = Math.max(1, options.scannerTimeoutMs ?? DEFAULT_SCANNER_TIMEOUT_MS);
  for (const scanner of scanners) {
    const [scanError, decision] = await runUploadScanner(scanner, scanInput, scannerTimeoutMs);
    if (scanError || decision === null) {
      discardQuarantinedMedia(quarantinePath);
      return { status: 'scanner-error' };
    }
    if (decision.status !== 'accepted') {
      discardQuarantinedMedia(quarantinePath);
      return { status: 'rejected' };
    }
  }

  const [promoteError, promoted] = tryCatchSync(() => promoteQuarantinedMedia(quarantinePath, options.declaration.ext, randomUUID()));
  if (promoteError || promoted === null) {
    discardQuarantinedMedia(quarantinePath);
    return { status: 'storage-error' };
  }
  return { status: 'accepted', ...promoted, kind: options.declaration.kind, bytes: streamResult.bytes };
}

export type MediaUploadRateDecision =
  | { status: 'allowed'; remaining: number; resetIn: number }
  | { status: 'limited'; resetIn: number }
  | { status: 'error' };

export async function checkMediaUploadRateLimit(workspaceId: string, userId: string): Promise<MediaUploadRateDecision> {
  const key = `media-upload:workspace:${encodeURIComponent(workspaceId)}:user:${encodeURIComponent(userId)}`;
  const configuredLimit = getProjectConfig().rateLimiting.defaultApiLimit;
  const limit = configuredLimit === false ? UPLOAD_RATE_LIMIT_FALLBACK : configuredLimit;
  const [error, result] = await tryCatch(() => checkRateLimit({ key, limit, windowMs: UPLOAD_RATE_WINDOW_MS }));
  if (error || result === null) return { status: 'error' };
  return result.allowed
    ? { status: 'allowed', remaining: result.remaining, resetIn: result.resetIn }
    : { status: 'limited', resetIn: result.resetIn };
}

export interface RegisterMediaUploadOptions {
  scanner?: UploadScanner;
  scannerTimeoutMs?: number;
}

const sendJson = (res: ServerResponse, code: number, body: Record<string, unknown>): void => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

function abortRequest(req: IncomingMessage): void {
  if (!req.destroyed) req.destroy();
}

export function registerMediaUpload(options: RegisterMediaUploadOptions = {}): void {
  cleanupStaleQuarantinedMedia();
  registerCustomRoute(async (req, res, ctx) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path !== UPLOAD_PATH) return false;
    if ((req.method ?? '').toUpperCase() !== 'POST') { sendJson(res, 405, { error: 'method' }); return true; }

    const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const declaration = resolveUploadDeclaration(query.get('ext') ?? '', req.headers['content-type']);
    if (declaration === null) {
      sendJson(res, 415, { error: 'unsupported or mismatched type' });
      abortRequest(req);
      return true;
    }

    const contentLength = checkUploadContentLength(req.headers['content-length'], declaration.maxBytes);
    if (contentLength.status === 'invalid') {
      sendJson(res, 400, { error: 'invalid content length' });
      abortRequest(req);
      return true;
    }
    if (contentLength.status === 'empty' || contentLength.status === 'oversize') {
      sendJson(res, 413, { error: 'empty or too large' });
      abortRequest(req);
      return true;
    }

    const session = await readSession(ctx.token);
    if (!session) { sendJson(res, 401, { error: 'unauthorized' }); abortRequest(req); return true; }
    const workspaceId = query.get('ws') ?? '';
    if (workspaceId.length === 0) { sendJson(res, 400, { error: 'missing workspace' }); abortRequest(req); return true; }
    const member = await hasCapability(getPrismaClient(), workspaceId, session.id, CAP.workTickets);
    if (!member) { sendJson(res, 403, { error: 'forbidden' }); abortRequest(req); return true; }

    //? This shared core limiter is keyed by BOTH authenticated user and workspace and runs before ingest
    //? creates a quarantine tempfile. Workspace storage quota deliberately waits on the separate asset policy.
    const rateDecision = await checkMediaUploadRateLimit(workspaceId, session.id);
    if (rateDecision.status === 'error') { sendJson(res, 503, { error: 'upload limiter unavailable' }); abortRequest(req); return true; }
    if (rateDecision.status === 'limited') {
      res.setHeader('Retry-After', String(Math.max(1, rateDecision.resetIn)));
      sendJson(res, 429, { error: 'upload rate exceeded' });
      abortRequest(req);
      return true;
    }

    const ingested = await ingestMediaUpload({
      source: req,
      declaration,
      ...(contentLength.status === 'valid' ? { expectedBytes: contentLength.bytes } : {}),
      ...(options.scanner === undefined ? {} : { scanner: options.scanner }),
      ...(options.scannerTimeoutMs === undefined ? {} : { scannerTimeoutMs: options.scannerTimeoutMs }),
    });
    switch (ingested.status) {
      case 'accepted': { sendJson(res, 200, { url: ingested.url, kind: ingested.kind }); break; }
      case 'empty':
      case 'too-large': { sendJson(res, 413, { error: 'empty or too large' }); break; }
      case 'length-mismatch': { sendJson(res, 400, { error: 'content length mismatch' }); break; }
      case 'rejected': { sendJson(res, 415, { error: 'file content rejected' }); break; }
      case 'scanner-error': { sendJson(res, 503, { error: 'file scanner unavailable' }); break; }
      case 'storage-error': { sendJson(res, 500, { error: 'upload failed' }); break; }
    }
    return true;
  }, { phase: 'pre-params' });
}
