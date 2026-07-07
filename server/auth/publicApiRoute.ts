//? X3 — the public API transport: `POST /api/public/v1/op` with `Authorization: Bearer wsk_…` + a JSON body
//? `{ op, payload }`. Authenticates the PAT, checks its scope, and drives ONE control-op on the single-writer
//? Conductor (never a direct writer — same RBAC path as the app). Origin-exempt (a machine API, not a browser
//? session). Mirrors the media-upload custom-route pattern.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { getPrismaClient, tryCatchSync } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import { driveViaPat, isPublicOp } from './pat';

const PUBLIC_PATH = '/api/public/v1/op';
const MAX_BODY = 256 * 1024; // a control-op payload is small; bound it hard.

const sendJson = (res: ServerResponse, code: number, body: Record<string, unknown>): void => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer | string) => {
      const buf = Buffer.from(c);
      size += buf.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(buf);
    });
    req.on('end', () => {
      if (tooBig) { resolve(null); return; }
      const [err, parsed] = tryCatchSync(() => JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown);
      if (err) { resolve(null); return; }
      resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null);
    });
    req.on('error', () => { resolve(null); });
  });
}

export function registerPublicApi(): void {
  registerOriginExemptPath({ pathPrefix: PUBLIC_PATH });
  registerCustomRoute(async (req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path !== PUBLIC_PATH) return false;
    if ((req.method ?? '').toUpperCase() !== 'POST') { sendJson(res, 405, { error: 'method' }); return true; }

    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const body = await readJsonBody(req);
    if (!body) { sendJson(res, 400, { error: 'bad body' }); return true; }
    const op = typeof body.op === 'string' ? body.op : '';
    if (!isPublicOp(op)) { sendJson(res, 400, { error: 'unsupported op' }); return true; }
    const payload = body.payload !== null && typeof body.payload === 'object' && !Array.isArray(body.payload) ? (body.payload as Record<string, unknown>) : {};

    const result = await driveViaPat(getPrismaClient(), token, op, payload);
    sendJson(res, result.status, result.ok ? { ok: true } : { error: result.error ?? 'error' });
    return true;
  }, { phase: 'pre-params' });
}
