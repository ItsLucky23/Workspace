import type { IncomingMessage, ServerResponse } from 'node:http';

import { MAX_PUBLIC_RESPONSE_BYTES, parseJson } from './runtime.js';
import type { Result } from './types.js';

export async function readJsonRequest(request: IncomingMessage, maxBytes: number): Promise<Result<unknown>> {
  const announced = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(announced) && announced > maxBytes) return { ok: false, error: 'request.tooLarge' };
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (result: Result<unknown>): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        finish({ ok: false, error: 'request.tooLarge' });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const parsed = parseJson(Buffer.concat(chunks).toString('utf8'));
      finish(parsed.ok ? parsed : { ok: false, error: 'request.invalidJson' });
    });
    request.on('aborted', () => { finish({ ok: false, error: 'request.aborted' }); });
    request.on('error', () => { finish({ ok: false, error: 'request.readFailed' }); });
  });
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  const bounded = Buffer.byteLength(serialized, 'utf8') <= MAX_PUBLIC_RESPONSE_BYTES
    ? serialized
    : JSON.stringify({ ok: false, services: [], env: {}, error: 'response.tooLarge' });
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(bounded, 'utf8'),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(bounded);
}

export function requestBearer(request: IncomingMessage): string {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}
