//? Media download/stream endpoint (M4) — serves the produced media files under `data/media/` at
//? `GET /media/<file>` (the persisted voice/sfx from M2 + the rendered mp4 from the render pipeline).
//? SECURITY (F05): the uuid is NO LONGER the capability. A request must either
//?   (a) carry a session whose user is a member of a workspace, or
//?   (b) carry a valid, unexpired HMAC signature minted by the publish path (F42: TikTok/YouTube fetch
//?       our asset with no cookie, and a published page is opened by strangers).
//? Path-traversal is still hard-guarded (no `..`, no separators, no absolute). Origin-exempt (a direct
//? download / `<video src>` / platform pull has no Origin) — exemption is not auth, which is the point.
//? Streams the file (bounded by the OS), never buffers. Best-effort: any miss is a clean 404.

import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { readSession, getPrismaClient } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import { MEDIA_DIR } from './store';
import { readSignatureParams, verifyMediaSignature } from './signedUrl';

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
  registerCustomRoute(async (req, res, ctx) => {
    const fullUrl = req.url ?? '';
    const rawUrl = fullUrl.split('?')[0] ?? '';
    if (!rawUrl.startsWith(PREFIX)) return false;
    const fail = (code: number): true => { res.statusCode = code; res.end(); return true; };
    if ((req.method ?? '').toUpperCase() !== 'GET') return fail(405);

    const abs = safeMediaPath(rawUrl);
    if (abs === null || !existsSync(abs)) return fail(404);

    //? F05/F42 — a signature is checked FIRST: it is the path a platform or a public page uses, and it
    //? needs no DB round-trip. Only an unsigned request falls through to session+membership.
    const name = rawUrl.slice(PREFIX.length);
    const { exp, sig } = readSignatureParams(fullUrl);
    const verdict = verifyMediaSignature(name, exp, sig);
    if (verdict !== 'valid') {
      //? An EXPIRED or forged signature is refused outright rather than silently falling back to the
      //? session path — otherwise a stale public link would keep working for any logged-in visitor.
      if (verdict === 'expired' || verdict === 'invalid') return fail(403);
      const session = await readSession(ctx.token);
      if (!session) return fail(401);
      //? Membership of ANY workspace, not a specific one: media ids carry no workspace, and inventing a
      //? binding here would be security theatre. This closes drive-by access, which is the actual gap.
      const member = await getPrismaClient().workspaceMember.findFirst({ where: { userId: session.id }, select: { id: true } });
      if (!member) return fail(403);
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
    const size = statSync(abs).size;
    if (size > 0) res.setHeader('Content-Length', String(size));
    createReadStream(abs).on('error', () => { res.destroy(); }).pipe(res);
    return true;
  }, { phase: 'pre-params' });
}
