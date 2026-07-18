//? Media upload route (FREEDOM_PROGRAM K1) — the seam that lets a user bring their OWN image/video into the
//? app instead of pasting a hosted URL. `POST /media/upload?ws=<workspaceId>&ext=<ext>` with the file as the
//? RAW request body (no multipart parser is bundled) → persisted under MEDIA_DIR → returns `{ url, kind }`
//? where `url` is a `/media/<uuid>.<ext>` served by the download route. Authed (session token) + membership-
//? gated (workTickets, like every content op) + tenant-scoped by the `ws` param. The returned url is used as
//? a reference for reference-conditioned gen (K1) and imported as a first-class ContentAsset via the
//? `content-import-asset` control-op (single-writer, B-23).

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { readSession, getPrismaClient } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import { hasCapability, CAP } from '../control/rbac';
import { persistMediaBytes } from './store';

const UPLOAD_PATH = '/media/upload';
const MAX_BYTES = 64 * 1024 * 1024; // 64 MB — generous for a short clip, bounded so a request can't OOM the server.

//? The accepted upload types → the ContentAsset kind. Extension is the source of truth (validated); the
//? client derives it from the file. Nothing else is written to disk.
const ALLOWED_EXT: Record<string, string> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  mp4: 'video', webm: 'video', mov: 'video',
  //? VO — voice clips (browser MediaRecorder → audio/webm; also common upload formats) for speech-to-text.
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
  //? Documents (DESIGN_DOCS_PROGRAM 1.1) — source files attached to a Document; kind 'file' so the
  //? document-edit asset-attach path stores them (the AI then extracts their text, 1.2). Never treated
  //? as image/video by content-import (which coerces to image/video anyway).
  pdf: 'file', docx: 'file', txt: 'file', md: 'file',
};

const sendJson = (res: ServerResponse, code: number, body: Record<string, unknown>): void => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

//? Read the raw request body into a Buffer, bounded by MAX_BYTES (returns null when the cap is exceeded so a
//? too-large upload is rejected, not silently truncated). Mirrors the webhook body-reader (the only body
//? pattern in the codebase) but keeps bytes + a hard cap.
async function readBodyBuffer(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer | string) => {
      const buf = Buffer.from(c);
      size += buf.length;
      if (size > MAX_BYTES) tooBig = true;
      else chunks.push(buf);
    });
    req.on('end', () => { resolve(tooBig ? null : Buffer.concat(chunks)); });
    req.on('error', () => { resolve(null); });
  });
}

export function registerMediaUpload(): void {
  //? Origin-exempt (like the other custom routes) so it works cross-origin in dev + behind the proxy; the
  //? real protection is the session token + capability + the required (unguessable) workspaceId.
  registerOriginExemptPath({ pathPrefix: UPLOAD_PATH });
  registerCustomRoute(async (req, res, ctx) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path !== UPLOAD_PATH) return false;
    if ((req.method ?? '').toUpperCase() !== 'POST') { sendJson(res, 405, { error: 'method' }); return true; }

    const session = await readSession(ctx.token);
    if (!session) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
    const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const workspaceId = query.get('ws') ?? '';
    if (workspaceId.length === 0) { sendJson(res, 400, { error: 'missing workspace' }); return true; }
    const member = await hasCapability(getPrismaClient(), workspaceId, session.id, CAP.workTickets);
    if (!member) { sendJson(res, 403, { error: 'forbidden' }); return true; }

    const ext = (query.get('ext') ?? '').toLowerCase().replaceAll(/[^a-z0-9]/g, '');
    const kind = ALLOWED_EXT[ext];
    if (kind === undefined) { sendJson(res, 415, { error: 'unsupported type' }); return true; }

    const body = await readBodyBuffer(req);
    if (body === null || body.length === 0) { sendJson(res, 413, { error: 'empty or too large' }); return true; }

    const { url } = persistMediaBytes(body, ext, randomUUID());
    sendJson(res, 200, { url, kind });
    return true;
  }, { phase: 'pre-params' });
}
