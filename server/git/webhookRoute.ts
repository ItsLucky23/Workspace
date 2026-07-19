//? Forge webhook endpoint. Authentication + bounded parse happen at the HTTP edge;
//? every accepted event (including ignored kinds) is then handed to the server-only
//? Conductor writer. The route itself performs no authoritative DB write.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { getPrismaClient, tryCatch, tryCatchSync } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import type { EnqueuedControlAction } from '../orchestrator/conductor';
import type { ForgeEventInternalAction } from '../orchestrator/internalOps';
import { broadcastTicketDelta } from '../read/broadcast';
import { forgeTouchedKeys } from './gitlabSync';
import { parseWebhookEvent } from './webhookIngest';

export const MAX_FORGE_WEBHOOK_BYTES = 1_000_000;
export const FORGE_WEBHOOK_BODY_TIMEOUT_MS = 10_000;
const WEBHOOK_PREFIX = '/webhooks/forge/';

interface ProcessWebhookInput {
  workspaceId: string;
  headers: IncomingHttpHeaders;
  rawBody: string;
}

export interface ForgeWebhookDependencies {
  prisma: PrismaClient;
  enqueue: (action: ForgeEventInternalAction) => Promise<EnqueuedControlAction>;
  broadcast: (workspaceId: string, keys: string[]) => Promise<void>;
  now: () => number;
}

interface WebhookOutcome { code: number; message: string }

function send(res: ServerResponse, code: number, message: string): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: code < 300 ? 'ok' : 'error', message }));
}

function sendAndTerminate(req: IncomingMessage, res: ServerResponse, code: number, message: string): void {
  req.pause();
  res.shouldKeepAlive = false;
  res.setHeader('Connection', 'close');
  res.once('finish', () => {
    if (!req.destroyed) req.destroy();
  });
  send(res, code, message);
}

function header(headers: IncomingHttpHeaders, key: string): string {
  const value = headers[key];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function verifyGithubHmac(secret: string, raw: string, signature: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

//? Hash both values to a fixed-size digest before comparison: GitLab's shared-token
//? header and the generic shared-secret header must not short-circuit on length/value.
export function verifyWebhookSecret(secret: string, supplied: string): boolean {
  const expectedDigest = createHash('sha256').update(secret).digest();
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

//? Header ids are hashed before entering the durable signal metadata: still stable
//? per delivery, but bounded and unable to inject an oversized/hostile request id.
export function forgeEventRequestId(
  workspaceId: string,
  rawBody: string,
  headers: IncomingHttpHeaders,
): string {
  const githubDelivery = header(headers, 'x-github-delivery');
  const gitlabEventUuid = header(headers, 'x-gitlab-event-uuid');
  if (githubDelivery.length > 0) {
    return `forge-event:github:${createHash('sha256').update(githubDelivery).digest('hex')}`;
  }
  if (gitlabEventUuid.length > 0) {
    return `forge-event:gitlab:${createHash('sha256').update(gitlabEventUuid).digest('hex')}`;
  }
  const githubEvent = header(headers, 'x-github-event').trim().toLowerCase().slice(0, 256);
  const gitlabEvent = header(headers, 'x-gitlab-event').trim().toLowerCase().slice(0, 256);
  const provider = githubEvent.length > 0 ? 'github' : 'gitlab';
  const eventType = githubEvent || gitlabEvent || 'unknown';
  const digest = createHash('sha256')
    .update(workspaceId).update('\0')
    .update(provider).update('\0')
    .update(eventType).update('\0')
    .update(rawBody)
    .digest('hex');
  return `forge-event:body:${digest}`;
}

function webhookChunkBytes(chunk: unknown): Uint8Array | null {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return chunk instanceof Uint8Array ? chunk : null;
}

type ForgeWebhookBodyResult =
  | { status: 'ok'; raw: string }
  | { status: 'too-large' }
  | { status: 'failed' }
  | { status: 'timeout' };

type ForgeWebhookContentLength =
  | { status: 'absent' | 'valid' }
  | { status: 'invalid' | 'oversize' };

function forgeWebhookContentLength(headers: IncomingHttpHeaders): ForgeWebhookContentLength {
  const raw = header(headers, 'content-length').trim();
  if (raw.length === 0) return { status: 'absent' };
  if (!/^\d+$/.test(raw)) return { status: 'invalid' };
  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes) || bytes < 0) return { status: 'invalid' };
  return bytes > MAX_FORGE_WEBHOOK_BYTES ? { status: 'oversize' } : { status: 'valid' };
}

async function readBody(req: IncomingMessage, timeoutMs: number): Promise<ForgeWebhookBodyResult> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      req.pause();
      chunks.length = 0;
      finish({ status: 'timeout' });
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onFailure);
      req.removeListener('aborted', onFailure);
    }
    function finish(result: ForgeWebhookBodyResult): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }
    function onData(chunk: unknown): void {
      const bytes = webhookChunkBytes(chunk);
      if (!bytes) return;
      size += bytes.byteLength;
      if (size > MAX_FORGE_WEBHOOK_BYTES) {
        req.pause();
        chunks.length = 0;
        finish({ status: 'too-large' });
        return;
      }
      chunks.push(bytes);
    }
    function onEnd(): void {
      finish({ status: 'ok', raw: Buffer.concat(chunks).toString('utf8') });
    }
    function onFailure(): void {
      finish({ status: 'failed' });
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onFailure);
    req.on('aborted', onFailure);
  });
}

function defaultDependencies(): ForgeWebhookDependencies {
  const prisma = getPrismaClient();
  return {
    prisma,
    enqueue: async (action) => {
      const { enqueueInternalAction } = await import('../orchestrator/internalOps');
      return enqueueInternalAction(action);
    },
    broadcast: (workspaceId, keys) => broadcastTicketDelta(prisma, workspaceId, keys),
    now: Date.now,
  };
}

//? Exported at the post-body boundary so tests can prove the route only enqueues and
//? that duplicate delivery ids collapse, without booting a custom HTTP server.
export async function processForgeWebhook(
  input: ProcessWebhookInput,
  dependencies?: ForgeWebhookDependencies,
): Promise<WebhookOutcome> {
  const deps = dependencies ?? defaultDependencies();
  if (Buffer.byteLength(input.rawBody) > MAX_FORGE_WEBHOOK_BYTES) {
    return { code: 413, message: 'body too large' };
  }

  const [workspaceError, workspace] = await tryCatch(() => deps.prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { webhookSecret: true },
  }));
  if (workspaceError) return { code: 503, message: 'webhook unavailable' };
  const secret = (workspace?.webhookSecret ?? '') || (process.env.WS_WEBHOOK_SECRET ?? '');
  if (secret.length === 0) return { code: 503, message: 'webhook not configured' };

  const githubSignature = header(input.headers, 'x-hub-signature-256');
  const authenticated = githubSignature.length > 0
    ? verifyGithubHmac(secret, input.rawBody, githubSignature)
    : verifyWebhookSecret(secret, header(input.headers, 'x-webhook-secret') || header(input.headers, 'x-gitlab-token'));
  if (!authenticated) return { code: 401, message: 'bad secret' };

  const [parseError, body] = tryCatchSync((): unknown => JSON.parse(input.rawBody));
  if (parseError) return { code: 400, message: 'bad json' };
  const githubEvent = header(input.headers, 'x-github-event') || undefined;
  const event = parseWebhookEvent(body, githubEvent);
  const action: ForgeEventInternalAction = {
    workspaceId: input.workspaceId,
    op: 'forge-event-apply',
    target: {},
    payload: { event, acceptedAt: deps.now() },
    userId: 'forge-webhook',
    clientRequestId: forgeEventRequestId(input.workspaceId, input.rawBody, input.headers),
  };
  const [enqueueError, enqueued] = await tryCatch(() => deps.enqueue(action));
  if (enqueueError || !enqueued) return { code: 500, message: 'ingest failed' };

  const keys = forgeTouchedKeys(enqueued.result);
  if (keys.length > 0) await tryCatch(() => deps.broadcast(input.workspaceId, keys));
  if (event.kind !== 'issue') return { code: 200, message: 'ignored' };
  return { code: 200, message: keys.length > 0 ? `ingested ${keys.join(',')}` : 'no-op' };
}

export interface ForgeWebhookRequestOptions {
  dependencies?: ForgeWebhookDependencies;
  bodyTimeoutMs?: number;
}

export async function handleForgeWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ForgeWebhookRequestOptions = {},
): Promise<boolean> {
  const rawUrl = (req.url ?? '').split('?')[0] ?? '';
  if (!rawUrl.startsWith(WEBHOOK_PREFIX)) return false;
  const workspaceId = rawUrl.slice(WEBHOOK_PREFIX.length).replace(/\/+$/, '');
  if ((req.method ?? '').toUpperCase() !== 'POST') {
    sendAndTerminate(req, res, 405, 'method not allowed');
    return true;
  }
  if (workspaceId.length === 0) {
    sendAndTerminate(req, res, 400, 'missing workspace');
    return true;
  }

  const contentLength = forgeWebhookContentLength(req.headers);
  if (contentLength.status === 'invalid') {
    sendAndTerminate(req, res, 400, 'bad content length');
    return true;
  }
  if (contentLength.status === 'oversize') {
    sendAndTerminate(req, res, 413, 'body too large');
    return true;
  }

  const configuredTimeout = options.bodyTimeoutMs ?? FORGE_WEBHOOK_BODY_TIMEOUT_MS;
  const bodyTimeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : FORGE_WEBHOOK_BODY_TIMEOUT_MS;
  const body = await readBody(req, bodyTimeoutMs);
  if (body.status === 'too-large') {
    sendAndTerminate(req, res, 413, 'body too large');
    return true;
  }
  if (body.status === 'timeout') {
    sendAndTerminate(req, res, 408, 'body timeout');
    return true;
  }
  if (body.status === 'failed') {
    sendAndTerminate(req, res, 400, 'bad body');
    return true;
  }
  const outcome = await processForgeWebhook(
    { workspaceId, headers: req.headers, rawBody: body.raw },
    options.dependencies,
  );
  send(res, outcome.code, outcome.message);
  return true;
}

export function registerForgeWebhook(): void {
  registerOriginExemptPath({ pathPrefix: WEBHOOK_PREFIX });
  registerCustomRoute((req, res) => handleForgeWebhookRequest(req, res), { phase: 'pre-params' });
}
