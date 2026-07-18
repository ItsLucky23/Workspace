//? Real HTTP-stream regressions for the forge webhook edge. Oversized declared/chunked
//? requests and a no-end slow request must receive a response without waiting for EOF.

import { createServer, request, type ClientRequest } from 'node:http';

import { tryCatch } from '@luckystack/core';

import { assert, eq, report } from '../_helpers.mts';

const {
  handleForgeWebhookRequest,
  MAX_FORGE_WEBHOOK_BYTES,
} = await import('../../server/git/webhookRoute.ts');

const server = createServer((req, res) => {
  const bodyTimeoutMs = (req.url ?? '').endsWith('/timeout') ? 40 : 2000;
  void tryCatch(() => handleForgeWebhookRequest(req, res, { bodyTimeoutMs })).then(([error, handled]) => {
    if (error && !res.writableEnded) {
      res.statusCode = 500;
      res.end('test handler failed');
      return;
    }
    if (handled !== true && !res.writableEnded) {
      res.statusCode = 404;
      res.end('not handled');
    }
  });
});

const [listenError] = await tryCatch(() => new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
}));
assert(listenError === null, 'the local webhook stream fixture starts');

const address = server.address();
const port = address !== null && typeof address === 'object' ? address.port : 0;
assert(port > 0, 'the local webhook stream fixture has an ephemeral port');

interface StreamResponse {
  status: number;
  body: string;
  elapsedMs: number;
  error: string | null;
}

async function sendWithoutEnd(
  workspace: string,
  headers: Record<string, string>,
  writeRequest: (req: ClientRequest) => void,
): Promise<StreamResponse> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let client: ClientRequest | null = null;
    const finish = (result: Omit<StreamResponse, 'elapsedMs'>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client?.destroy();
      resolve({ ...result, elapsedMs: Date.now() - startedAt });
    };
    const timer = setTimeout(() => {
      finish({ status: 0, body: '', error: 'client timeout' });
    }, 3000);
    client = request({
      host: '127.0.0.1',
      port,
      path: `/webhooks/forge/${workspace}`,
      method: 'POST',
      headers,
    }, (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => {
        finish({ status: response.statusCode ?? 0, body, error: null });
      });
    });
    client.on('error', (error) => {
      finish({ status: 0, body: '', error: error.message });
    });
    writeRequest(client);
  });
}

const declaredOversize = await sendWithoutEnd(
  'declared',
  { 'content-length': String(MAX_FORGE_WEBHOOK_BYTES + 1) },
  (client) => { client.flushHeaders(); },
);
eq(declaredOversize.status, 413, 'oversized Content-Length is rejected before any body or EOF');
assert(declaredOversize.error === null && declaredOversize.elapsedMs < 1500, 'Content-Length rejection is prompt and response-complete');

const chunkedOversize = await sendWithoutEnd(
  'chunked',
  { 'transfer-encoding': 'chunked' },
  (client) => { client.write(Buffer.alloc(MAX_FORGE_WEBHOOK_BYTES + 1, 0x61)); },
);
eq(chunkedOversize.status, 413, 'a chunked stream crossing 1 MB is rejected without EOF');
assert(chunkedOversize.error === null && chunkedOversize.elapsedMs < 1500, 'chunked oversize rejection stops waiting and returns promptly');

const timedOut = await sendWithoutEnd(
  'timeout',
  { 'transfer-encoding': 'chunked' },
  (client) => { client.write('{'); },
);
eq(timedOut.status, 408, 'an unauthenticated under-cap request that never ends is time-bounded');
assert(timedOut.error === null && timedOut.elapsedMs < 1500, 'the no-end request cannot occupy the route indefinitely');

server.closeAllConnections();
await new Promise<void>((resolve) => { server.close(() => resolve()); });

report('tests/unit/forgeWebhookStream.test.mts');
