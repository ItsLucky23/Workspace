//? Forge webhook endpoint (#10). Registers `POST /webhooks/forge/<workspaceId>` as a pre-params
//? custom route (origin-exempt, like the observability probes) so a forge can POST issue events for
//? continuous ingest. SECURITY: the request MUST present the shared secret (`WS_WEBHOOK_SECRET`) in
//? `X-Webhook-Secret` (or GitLab's `X-Gitlab-Token`) — if the secret is not configured the endpoint
//? is DISABLED (503), a secure default (no unauthenticated write path). Provider is auto-detected
//? (GitHub via `X-GitHub-Event`, else GitLab). Best-effort: a bad body is a 400, never a crash.

import { tryCatch, tryCatchSync, getPrismaClient } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import { broadcastTicketDelta } from '../read/broadcast';
import { parseWebhookEvent, ingestIssueEvent } from './webhookIngest';

interface Res { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void }
const send = (res: Res, code: number, msg: string): void => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: code < 300 ? 'ok' : 'error', message: msg })); };

//? Read the raw request body (bounded) off the Node stream.
async function readBody(req: { on: (ev: string, cb: (c?: unknown) => void) => void }): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c?: unknown) => { if (c) { const buf = Buffer.from(c as Buffer); size += buf.length; if (size <= 1_000_000) chunks.push(buf); } });
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', () => { resolve(''); });
  });
}

const WEBHOOK_PREFIX = '/webhooks/forge/';

//? Register the webhook route (call once at boot). The origin exemption removes the browser-CSRF
//? origin gate for the dedicated /webhooks/forge prefix (a server-to-server POST has no Origin);
//? authentication is the shared-secret check below — exemption is NOT auth (ARCHITECTURE_HTTP §origin).
export function registerForgeWebhook(): void {
  registerOriginExemptPath({ pathPrefix: WEBHOOK_PREFIX });
  registerCustomRoute(async (req, res) => {
    const rawUrl = (req.url ?? '').split('?')[0] ?? '';
    if (!rawUrl.startsWith(WEBHOOK_PREFIX)) return false;
    const workspaceId = rawUrl.slice(WEBHOOK_PREFIX.length).replace(/\/+$/, '');
    if ((req.method ?? '').toUpperCase() !== 'POST') { send(res, 405, 'method not allowed'); return true; }

    //? Secure default: no configured secret ⇒ endpoint disabled.
    const secret = process.env.WS_WEBHOOK_SECRET ?? '';
    if (secret.length === 0) { send(res, 503, 'webhook not configured'); return true; }
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const presented = (headers['x-webhook-secret'] ?? headers['x-gitlab-token'] ?? '');
    if ((Array.isArray(presented) ? presented[0] : presented) !== secret) { send(res, 401, 'bad secret'); return true; }
    if (workspaceId.length === 0) { send(res, 400, 'missing workspace'); return true; }

    const ghEventRaw = headers['x-github-event'];
    const ghEvent = Array.isArray(ghEventRaw) ? ghEventRaw[0] : ghEventRaw;
    const [, raw] = await tryCatch(() => readBody(req as { on: (ev: string, cb: (c?: unknown) => void) => void }));
    const [parseErr, body] = tryCatchSync(() => JSON.parse(raw ?? '') as unknown);
    if (parseErr) { send(res, 400, 'bad json'); return true; }

    const event = parseWebhookEvent(body, ghEvent);
    if (event.kind !== 'issue') { send(res, 200, 'ignored'); return true; }
    const [ingestErr, key] = await tryCatch(() => ingestIssueEvent(getPrismaClient(), workspaceId, event));
    if (ingestErr) { send(res, 500, 'ingest failed'); return true; }
    if (key) void tryCatch(() => broadcastTicketDelta(getPrismaClient(), workspaceId, [key]));
    send(res, 200, key ? `ingested ${key}` : 'no-op');
    return true;
  }, { phase: 'pre-params' });
}
