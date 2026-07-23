import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { readAgentConfig, type AgentConfig } from './config.js';
import { ComposeExecutor } from './compose.js';
import { readJsonRequest, requestBearer, sendJson } from './http.js';
import { asRecord, KeyedLock, MAX_COMPOSE_BYTES, PROJECT_PATTERN, safeEqual, WORKSPACE_ID_PATTERN } from './runtime.js';
import type { ComposeDownRequest, ComposeUpRequest } from './types.js';

interface AgentDependencies {
  executor: ComposeExecutor;
}

function readUpRequest(value: unknown): ComposeUpRequest | null {
  const row = asRecord(value);
  if (!row || typeof row.workspaceId !== 'string' || typeof row.project !== 'string' || typeof row.compose !== 'string') return null;
  if (!WORKSPACE_ID_PATTERN.test(row.workspaceId) || !PROJECT_PATTERN.test(row.project) || Buffer.byteLength(row.compose, 'utf8') > MAX_COMPOSE_BYTES) return null;
  return { workspaceId: row.workspaceId.toLowerCase(), project: row.project, compose: row.compose };
}

function readDownRequest(value: unknown): ComposeDownRequest | null {
  const row = asRecord(value);
  if (!row || typeof row.workspaceId !== 'string' || typeof row.project !== 'string') return null;
  if (!WORKSPACE_ID_PATTERN.test(row.workspaceId) || !PROJECT_PATTERN.test(row.project)) return null;
  return { workspaceId: row.workspaceId.toLowerCase(), project: row.project };
}

export function createAgentServer(config: AgentConfig, dependencies?: AgentDependencies): Server {
  if (!WORKSPACE_ID_PATTERN.test(config.workspaceId)) throw new Error('AGENT_WORKSPACE_ID must be a 24-character hexadecimal id');
  const executor = dependencies?.executor ?? new ComposeExecutor(config);
  const locks = new KeyedLock();
  return createServer((request, response) => {
    const handle = async (): Promise<void> => {
      const url = new URL(request.url ?? '/', 'http://agent.internal');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        if (!safeEqual(requestBearer(request), config.token)) {
          sendJson(response, 401, { status: 'unauthorized' });
          return;
        }
        const docker = await executor.health();
        sendJson(response, docker ? 200 : 503, { status: docker ? 'ready' : 'not-ready', workspaceId: config.workspaceId, docker });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        if (!safeEqual(requestBearer(request), config.token)) {
          sendJson(response, 401, { ok: false, error: 'auth.invalid' });
          return;
        }
        sendJson(response, 200, { ok: true, activeProjects: await executor.activeProjects() });
        return;
      }
      if (request.method !== 'POST' || (url.pathname !== '/v1/compose/up' && url.pathname !== '/v1/compose/down')) {
        sendJson(response, 404, { ok: false, services: [], env: {}, error: 'route.notFound' });
        return;
      }
      if (!safeEqual(requestBearer(request), config.token)) {
        sendJson(response, 401, { ok: false, services: [], env: {}, error: 'auth.invalid' });
        return;
      }
      const body = await readJsonRequest(request, MAX_COMPOSE_BYTES + 16_384);
      if (!body.ok) {
        sendJson(response, body.error === 'request.tooLarge' ? 413 : 400, { ok: false, services: [], env: {}, error: body.error });
        return;
      }
      if (url.pathname.endsWith('/up')) {
        const input = readUpRequest(body.value);
        if (input?.workspaceId !== config.workspaceId) {
          sendJson(response, 400, { ok: false, services: [], env: {}, error: 'request.invalid' });
          return;
        }
        const result = await locks.run(input.project, () => executor.up(input));
        sendJson(response, result.ok ? 200 : 422, result);
        return;
      }
      const input = readDownRequest(body.value);
      if (input?.workspaceId !== config.workspaceId) {
        sendJson(response, 400, { ok: false, services: [], env: {}, error: 'request.invalid' });
        return;
      }
      const result = await locks.run(input.project, () => executor.down(input));
      sendJson(response, result.ok ? 200 : 422, result);
    };
    void handle().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown';
      console.error(JSON.stringify({ level: 'error', scope: 'compose-agent', message }));
      if (response.headersSent) {response.destroy();}
      else {sendJson(response, 500, { ok: false, services: [], env: {}, error: 'agent.internal' });}
    });
  });
}

export function startAgent(config: AgentConfig = readAgentConfig()): Server {
  const server = createAgentServer(config);
  server.listen(config.port, config.bindHost, () => {
    console.log(JSON.stringify({ level: 'info', scope: 'compose-agent', message: 'listening', host: config.bindHost, port: config.port, workspaceId: config.workspaceId }));
  });
  return server;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) startAgent();
