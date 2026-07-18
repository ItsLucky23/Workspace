//? Forge webhook endpoint. Authentication + bounded parse happen at the HTTP edge;
//? every accepted event (including ignored kinds) is then handed to the server-only
//? Conductor writer. The route itself performs no authoritative DB write.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

import { getPrismaClient, tryCatch, tryCatchSync } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import type { EnqueuedControlAction } from '../orchestrator/conductor';
import type { ForgeEventInternalAction } from '../orchestrator/internalOps';
import { broadcastTicketDelta } from '../read/broadcast';
import { forgeTouchedKeys } from './gitlabSync';
import { parseWebhookEvent } from './webhookIngest';

export const MAX_FORGE_WEBHOOK_BYTES = 1_000_000;
const WEBHOOK_PREFIX = '/webhooks/forge/';

interface Res {
  statusCode: number;
  setHeader: (key: string, value: string) => void;
  end: (body?: string) => void;
}

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

function send(res: Res, code: number, message: string): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: code < 300 ? 'ok' : 'error', message }));
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
  const digest = createHash('sha256').update(workspaceId).update('\0').update(rawBody).digest('hex');
  return `forge-event:body:${digest}`;
}

function webhookChunkBytes(chunk: unknown): Uint8Array | null {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return chunk instanceof Uint8Array ? chunk : null;
}

async function readBody(req: IncomingMessage): Promise<{ raw: string; tooLarge: boolean; failed: boolean }> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const finish = (result: { raw: string; tooLarge: boolean; failed: boolean }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (chunk: unknown) => {
      const bytes = webhookChunkBytes(chunk);
      if (!bytes) return;
      size += bytes.byteLength;
      if (size > MAX_FORGE_WEBHOOK_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => {
      finish({
        raw: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'),
        tooLarge,
        failed: false,
      });
    });
    req.on('error', () => {
      finish({ raw: '', tooLarge: false, failed: true });
    });
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
    : (header(input.headers, 'x-webhook-secret') || header(input.headers, 'x-gitlab-token')) === secret;
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

export function registerForgeWebhook(): void {
  registerOriginExemptPath({ pathPrefix: WEBHOOK_PREFIX });
  registerCustomRoute(async (req, res) => {
    const rawUrl = (req.url ?? '').split('?')[0] ?? '';
    if (!rawUrl.startsWith(WEBHOOK_PREFIX)) return false;
    const workspaceId = rawUrl.slice(WEBHOOK_PREFIX.length).replace(/\/+$/, '');
    if ((req.method ?? '').toUpperCase() !== 'POST') {
      send(res, 405, 'method not allowed');
      return true;
    }
    if (workspaceId.length === 0) {
      send(res, 400, 'missing workspace');
      return true;
    }

    const body = await readBody(req);
    if (body.tooLarge) {
      send(res, 413, 'body too large');
      return true;
    }
    if (body.failed) {
      send(res, 400, 'bad body');
      return true;
    }
    const outcome = await processForgeWebhook({ workspaceId, headers: req.headers, rawBody: body.raw });
    send(res, outcome.code, outcome.message);
    return true;
  }, { phase: 'pre-params' });
}
