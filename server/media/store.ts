//? Local media store — persists produced media BYTES (ElevenLabs voice/sfx return raw audio, not a
//? hosted URL; the ffmpeg render in M4 writes an mp4) to `data/media/` and returns a stable served
//? path (`/media/<file>`). The actual HTTP serving of `/media/*` is the download route (M4/U). Kept
//? tiny + pure-ish (one fs write) so the provider adapters stay decoupled from where bytes live.

import { randomUUID } from 'node:crypto';
import { mkdirSync, opendirSync, lstatSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { tryCatchSync } from '@luckystack/core';

export const MEDIA_DIR = path.join(process.cwd(), (process.env.WS_MEDIA_DIR ?? '').trim() || 'data/media');
export const MEDIA_QUARANTINE_DIR = path.join(MEDIA_DIR, '.quarantine');

function ensureMediaDirs(): void {
  mkdirSync(MEDIA_DIR, { recursive: true });
  mkdirSync(MEDIA_QUARANTINE_DIR, { recursive: true });
}

//? Uploaded bytes stay under a non-served, same-filesystem quarantine path until validation + scanning
//? accept them. `wx` at the writer remains the collision backstop; the UUID keeps names unguessable.
export function createMediaQuarantinePath(): string {
  ensureMediaDirs();
  return path.join(MEDIA_QUARANTINE_DIR, `${randomUUID()}.upload`);
}

function isQuarantinePath(filePath: string): boolean {
  return path.resolve(path.dirname(filePath)) === path.resolve(MEDIA_QUARANTINE_DIR);
}

export function discardQuarantinedMedia(quarantinePath: string): boolean {
  if (!isQuarantinePath(quarantinePath)) return false;
  const [error] = tryCatchSync(() => { rmSync(quarantinePath, { force: true }); });
  return error === null;
}

export interface QuarantineCleanupOptions {
  maxAgeMs?: number;
  maxEntries?: number;
  maxRemovals?: number;
  now?: number;
}

export interface QuarantineCleanupResult {
  scanned: number;
  removed: number;
}

const QUARANTINE_FILE_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.upload$/i;

//? Crash leftovers are pruned at upload-route registration. Both directory reads and removals are capped so
//? a hostile or damaged quarantine directory cannot turn server boot into an unbounded filesystem sweep.
export function cleanupStaleQuarantinedMedia(options: QuarantineCleanupOptions = {}): QuarantineCleanupResult {
  const maxAgeMs = Math.max(1, options.maxAgeMs ?? 60 * 60 * 1000);
  const maxEntries = Math.max(1, Math.min(options.maxEntries ?? 256, 1024));
  const maxRemovals = Math.max(1, Math.min(options.maxRemovals ?? 64, maxEntries));
  const now = options.now ?? Date.now();
  ensureMediaDirs();

  const [openError, directory] = tryCatchSync(() => opendirSync(MEDIA_QUARANTINE_DIR));
  if (openError || directory === null) return { scanned: 0, removed: 0 };

  let scanned = 0;
  let removed = 0;
  while (scanned < maxEntries && removed < maxRemovals) {
    const [readError, entry] = tryCatchSync(() => directory.readSync());
    if (readError || entry === null) break;
    scanned += 1;
    if (!entry.isFile() || !QUARANTINE_FILE_PATTERN.test(entry.name)) continue;

    const candidate = path.join(MEDIA_QUARANTINE_DIR, entry.name);
    const [statError, stat] = tryCatchSync(() => lstatSync(candidate));
    if (statError || stat === null || !stat.isFile() || now - stat.mtimeMs < maxAgeMs) continue;
    if (discardQuarantinedMedia(candidate)) removed += 1;
  }
  tryCatchSync(() => { directory.closeSync(); });
  return { scanned, removed };
}

//? Promotion is one atomic same-filesystem rename. The route only calls this after auth, type validation,
//? and every configured scanner accepted the quarantine file.
export function promoteQuarantinedMedia(quarantinePath: string, ext: string, id: string): { url: string; path: string } {
  if (!isQuarantinePath(quarantinePath)) throw new Error('invalid media quarantine path');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || !/^[a-zA-Z0-9]+$/.test(ext)) throw new Error('invalid media file name');
  mkdirSync(MEDIA_DIR, { recursive: true });
  const file = `${id}.${ext}`;
  const abs = path.join(MEDIA_DIR, file);
  renameSync(quarantinePath, abs);
  return { url: `/media/${file}`, path: abs };
}

//? Write bytes under `data/media/<id>.<ext>` and return the served URL path + the absolute disk path.
//? `id` must be unique per asset (the caller passes a uuid) so writes never collide.
export function persistMediaBytes(bytes: Buffer, ext: string, id: string): { url: string; path: string } {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const file = `${id}.${ext}`;
  const abs = path.join(MEDIA_DIR, file);
  writeFileSync(abs, bytes);
  return { url: `/media/${file}`, path: abs };
}
