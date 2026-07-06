//? Build-artifact download endpoint (ADR 0038, B2). Serves a `docker save` tarball over a signed,
//? TTL'd, token-gated link (`GET /downloads/build/<token>`) so a user can export a build and self-host
//? it elsewhere. SECURITY: the ONLY key is the unguessable per-artifact `downloadToken` (24 random
//? bytes); an unknown/expired/not-ready token is a 404 (no existence oracle). Origin-exempt (a direct
//? download has no browser Origin) — exemption is NOT auth; the token is. Streams the file (bounded by
//? the OS), never buffers it. Best-effort: any error is a clean 404/500, never a crash.

import { createReadStream, existsSync } from 'node:fs';

import { getPrismaClient } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

const PREFIX = '/downloads/build/';

//? Register the download route (call once at boot). `res`/`req` are already typed (ServerResponse /
//? IncomingMessage) by the framework CustomRouteHandler — no casts needed.
export function registerBuildDownload(): void {
  registerOriginExemptPath({ pathPrefix: PREFIX });
  registerCustomRoute(async (req, res) => {
    const rawUrl = (req.url ?? '').split('?')[0] ?? '';
    if (!rawUrl.startsWith(PREFIX)) return false;
    const fail = (code: number): true => { res.statusCode = code; res.end(); return true; };
    if ((req.method ?? '').toUpperCase() !== 'GET') return fail(405);

    const token = rawUrl.slice(PREFIX.length).replace(/\/+$/, '');
    if (token.length === 0) return fail(404);

    const artifact = await getPrismaClient().buildArtifact.findFirst({ where: { downloadToken: token } });
    if (!artifact) return fail(404);
    if (artifact.status !== 'ready' || !artifact.filePath || !existsSync(artifact.filePath)) return fail(404);
    if (artifact.expiresAt && artifact.expiresAt.getTime() < Date.now()) return fail(404);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-tar');
    res.setHeader('Content-Disposition', `attachment; filename="build-${artifact.kind}-${artifact.id}.tar"`);
    if (artifact.sizeBytes > 0) res.setHeader('Content-Length', String(artifact.sizeBytes));
    createReadStream(artifact.filePath).on('error', () => { res.destroy(); }).pipe(res);
    return true;
  }, { phase: 'pre-params' });
}
