//? Local media store — persists produced media BYTES (ElevenLabs voice/sfx return raw audio, not a
//? hosted URL; the ffmpeg render in M4 writes an mp4) to `data/media/` and returns a stable served
//? path (`/media/<file>`). The actual HTTP serving of `/media/*` is the download route (M4/U). Kept
//? tiny + pure-ish (one fs write) so the provider adapters stay decoupled from where bytes live.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MEDIA_DIR = path.join(process.cwd(), (process.env.WS_MEDIA_DIR ?? '').trim() || 'data/media');

//? Write bytes under `data/media/<id>.<ext>` and return the served URL path + the absolute disk path.
//? `id` must be unique per asset (the caller passes a uuid) so writes never collide.
export function persistMediaBytes(bytes: Buffer, ext: string, id: string): { url: string; path: string } {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const file = `${id}.${ext}`;
  const abs = path.join(MEDIA_DIR, file);
  writeFileSync(abs, bytes);
  return { url: `/media/${file}`, path: abs };
}
