//? Media download/stream endpoint (M4) — serves the produced media files under `data/media/` at
//? `GET /media/<file>` (the persisted voice/sfx from M2 + the rendered mp4 from the render pipeline).
//? SECURITY: the file name is an unguessable uuid (the capability, like the build-download token); the
//? only lookup is a filename UNDER `MEDIA_DIR` with a hard path-traversal guard (no `..`, no separators,
//? no absolute). Origin-exempt (a direct download/`<video src>` has no Origin) — exemption is not auth.
//? Streams the file (bounded by the OS), never buffers. Best-effort: any miss is a clean 404.

import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import { MEDIA_DIR } from './store';

const PREFIX = '/media/';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.glb': 'model/gltf-binary',
  //? Documents (DESIGN_DOCS_PROGRAM 1.1) — uploaded source files + exports served with correct types.
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

//? Resolve a `/media/<file>` request to an absolute path UNDER `MEDIA_DIR`, or null if the name is
//? unsafe (traversal / nested path / absolute). Pure + exported for tests.
export function safeMediaPath(urlPath: string): string | null {
  if (!urlPath.startsWith(PREFIX)) return null;
  const name = decodeURIComponent(urlPath.slice(PREFIX.length).replace(/\/+$/, ''));
  if (name.length === 0) return null;
  //? A single file name only — reject any separator, traversal token, or absolute/drive path.
  if (name.includes('/') || name.includes('\\') || name.includes('..') || path.isAbsolute(name)) return null;
  const abs = path.join(MEDIA_DIR, name);
  //? Defense-in-depth: the resolved path must still live inside MEDIA_DIR.
  const rel = path.relative(MEDIA_DIR, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

//? Register the media download route (call once at boot).
export function registerMediaDownload(): void {
  registerOriginExemptPath({ pathPrefix: PREFIX });
  registerCustomRoute((req, res) => {
    const rawUrl = (req.url ?? '').split('?')[0] ?? '';
    if (!rawUrl.startsWith(PREFIX)) return false;
    const fail = (code: number): true => { res.statusCode = code; res.end(); return true; };
    if ((req.method ?? '').toUpperCase() !== 'GET') return fail(405);

    const abs = safeMediaPath(rawUrl);
    if (abs === null || !existsSync(abs)) return fail(404);

    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
    const size = statSync(abs).size;
    if (size > 0) res.setHeader('Content-Length', String(size));
    createReadStream(abs).on('error', () => { res.destroy(); }).pipe(res);
    return true;
  }, { phase: 'pre-params' });
}
