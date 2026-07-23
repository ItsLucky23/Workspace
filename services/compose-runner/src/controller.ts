import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { AgentClient } from './agentClient.js';
import { readControllerConfig, shouldDestroyOnLastDown, type ControllerConfig } from './config.js';
import { readJsonRequest, requestBearer, sendJson } from './http.js';
import { IncusSandboxProvider } from './incus.js';
import { ProxmoxSandboxProvider } from './proxmox.js';
import { asRecord, KeyedLock, MAX_COMPOSE_BYTES, PROJECT_PATTERN, safeEqual, WORKSPACE_ID_PATTERN } from './runtime.js';
import type { AgentComposeResponse, ComposeDownRequest, ComposeUpRequest, ManagedVm, PublicRunnerResponse, Result, SandboxDescriptor } from './types.js';

export interface SandboxProvider {
  health: () => Promise<boolean>;
  guestToken: (workspaceId: string) => string;
  getSandbox: (workspaceId: string) => Promise<SandboxDescriptor | null>;
  ensureSandbox: (workspaceId: string) => Promise<SandboxDescriptor>;
  configureGatewayFirewall: (sandbox: SandboxDescriptor, ports: number[]) => Promise<void>;
  activeProjects: (sandbox: SandboxDescriptor) => Promise<Result<string[]>>;
  destroySandbox: (sandbox: SandboxDescriptor) => Promise<void>;
  listManagedVms: () => Promise<ManagedVm[]>;
  descriptor: (node: string, vmid: number, workspaceId: string) => SandboxDescriptor;
}

export interface ControllerDependencies {
  provider: SandboxProvider;
  agentClient: AgentClient;
  workspaceLocks: KeyedLock;
}

const publicFailure = (error: string): PublicRunnerResponse => ({ ok: false, services: [], env: {}, error });
const publicResult = (value: AgentComposeResponse): PublicRunnerResponse => ({
  ok: value.ok,
  services: value.services,
  env: value.env,
  ...(value.error ? { error: value.error } : {}),
});

function readUpRequest(value: unknown, routeWorkspaceId: string): ComposeUpRequest | null {
  const row = asRecord(value);
  if (!row || typeof row.workspaceId !== 'string' || typeof row.project !== 'string' || typeof row.compose !== 'string') return null;
  if (row.workspaceId.toLowerCase() !== routeWorkspaceId || !WORKSPACE_ID_PATTERN.test(row.workspaceId) || !PROJECT_PATTERN.test(row.project)) return null;
  if (Buffer.byteLength(row.compose, 'utf8') > MAX_COMPOSE_BYTES) return null;
  return { workspaceId: routeWorkspaceId, project: row.project, compose: row.compose };
}

function readDownRequest(value: unknown, routeWorkspaceId: string): ComposeDownRequest | null {
  const row = asRecord(value);
  if (!row || typeof row.workspaceId !== 'string' || typeof row.project !== 'string') return null;
  if (row.workspaceId.toLowerCase() !== routeWorkspaceId || !WORKSPACE_ID_PATTERN.test(row.workspaceId) || !PROJECT_PATTERN.test(row.project)) return null;
  return { workspaceId: routeWorkspaceId, project: row.project };
}

function parseRoute(pathname: string): { workspaceId: string; action: 'up' | 'down' | 'reset' } | null {
  const match = /^\/workspaces\/([a-fA-F0-9]{24})\/v1\/(?:compose\/(up|down)|sandbox\/(reset))$/.exec(pathname);
  const action = match?.[2] ?? match?.[3];
  return match?.[1] && (action === 'up' || action === 'down' || action === 'reset')
    ? { workspaceId: match[1].toLowerCase(), action }
    : null;
}

export function createControllerDependencies(config: ControllerConfig): ControllerDependencies {
  const agentClient = new AgentClient(fetch, config.requestTimeoutMs);
  const provider = config.provider === 'incus'
    ? new IncusSandboxProvider(config, agentClient)
    : new ProxmoxSandboxProvider(config, agentClient);
  return { agentClient, provider, workspaceLocks: new KeyedLock() };
}

export function createControllerServer(
  config: ControllerConfig,
  dependencies: ControllerDependencies = createControllerDependencies(config),
): Server {
  let active = 0;
  return createServer((request, response) => {
    const handle = async (): Promise<void> => {
      const url = new URL(request.url ?? '/', 'http://runner.internal');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        const hypervisor = await dependencies.provider.health();
        sendJson(response, hypervisor ? 200 : 503, { status: hypervisor ? 'ready' : 'not-ready', hypervisor, provider: config.provider });
        return;
      }
      const route = parseRoute(url.pathname);
      if (request.method !== 'POST' || !route) {
        sendJson(response, 404, publicFailure('route.notFound'));
        return;
      }
      if (!safeEqual(requestBearer(request), config.bearerToken)) {
        sendJson(response, 401, publicFailure('auth.invalid'));
        return;
      }
      if (route.action === 'reset') {
        if (request.headers['x-runner-confirm'] !== route.workspaceId) {
          sendJson(response, 409, publicFailure('sandbox.confirmRequired'));
          return;
        }
        const existing = await dependencies.provider.getSandbox(route.workspaceId);
        if (existing) await dependencies.workspaceLocks.run(route.workspaceId, () => dependencies.provider.destroySandbox(existing));
        sendJson(response, 200, { ok: true, services: [], env: {} });
        return;
      }
      const body = await readJsonRequest(request, MAX_COMPOSE_BYTES + 16_384);
      if (!body.ok) {
        sendJson(response, body.error === 'request.tooLarge' ? 413 : 400, publicFailure(body.error));
        return;
      }
      if (active >= config.maxConcurrent) {
        sendJson(response, 503, publicFailure('runner.capacity'));
        return;
      }
      active += 1;
      const result = await dependencies.workspaceLocks.run(route.workspaceId, async (): Promise<PublicRunnerResponse> => {
        if (route.action === 'up') {
          const input = readUpRequest(body.value, route.workspaceId);
          if (!input) return publicFailure('request.invalid');
          const sandbox = await dependencies.provider.ensureSandbox(route.workspaceId);
          const agent = await dependencies.agentClient.up(sandbox, dependencies.provider.guestToken(route.workspaceId), input);
          if (!agent.ok) return publicFailure(agent.error);
          await dependencies.provider.configureGatewayFirewall(sandbox, agent.value.gatewayPorts);
          return publicResult(agent.value);
        }
        const input = readDownRequest(body.value, route.workspaceId);
        if (!input) return publicFailure('request.invalid');
        const sandbox = await dependencies.provider.getSandbox(route.workspaceId);
        if (!sandbox) return { ok: true, services: [], env: {} };
        const agent = await dependencies.agentClient.down(sandbox, dependencies.provider.guestToken(route.workspaceId), input);
        if (!agent.ok) return publicFailure(agent.error);
        await dependencies.provider.configureGatewayFirewall(sandbox, []);
        const projects = await dependencies.provider.activeProjects(sandbox);
        if (shouldDestroyOnLastDown() && projects.ok && projects.value.length === 0) await dependencies.provider.destroySandbox(sandbox);
        return publicResult(agent.value);
      }).finally(() => { active -= 1; });
      sendJson(response, result.ok ? 200 : 422, result);
    };
    void handle().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown';
      console.error(JSON.stringify({ level: 'error', scope: 'compose-runner', message }));
      if (response.headersSent) {response.destroy();}
      else {sendJson(response, 500, publicFailure('runner.internal'));}
    });
  });
}

export async function runGarbageCollection(config: ControllerConfig, provider: SandboxProvider, workspaceLocks: KeyedLock): Promise<void> {
  const idleMs = config.idleGcHours * 60 * 60 * 1000;
  const candidates = await provider.listManagedVms();
  for (const candidate of candidates) {
    await workspaceLocks.run(candidate.workspaceId, async () => {
      //? A request may have touched the VM while GC waited for the workspace lock. Re-read durable hypervisor
      //? metadata inside the lock before deciding; stale pre-lock timestamps may never destroy active work.
      const refreshed = await provider.listManagedVms();
      const current = refreshed.find((vm) => vm.workspaceId === candidate.workspaceId);
      if (!current?.lastUsedAt) return;
      const idleForMs = Date.now() - current.lastUsedAt.getTime();
      if (idleForMs < idleMs) return;
      const sandbox = provider.descriptor(current.node, current.vmid, current.workspaceId);
      const activeProjects = await provider.activeProjects(sandbox);
      const hardExpired = idleForMs >= idleMs * 2;
      if ((activeProjects.ok && activeProjects.value.length === 0) || (!activeProjects.ok && hardExpired)) {
        await provider.destroySandbox(sandbox);
        console.log(JSON.stringify({ level: 'info', scope: 'compose-runner-gc', message: 'sandbox destroyed', workspaceId: current.workspaceId, vmid: current.vmid }));
      }
    });
  }
}

export function startController(config: ControllerConfig = readControllerConfig()): Server {
  const dependencies = createControllerDependencies(config);
  const server = createControllerServer(config, dependencies);
  const gc = (): void => {
    void runGarbageCollection(config, dependencies.provider, dependencies.workspaceLocks).catch((error: unknown) => {
      console.error(JSON.stringify({ level: 'error', scope: 'compose-runner-gc', message: error instanceof Error ? error.message : 'unknown' }));
    });
  };
  const interval = setInterval(gc, config.gcIntervalMs);
  interval.unref();
  server.on('close', () => { clearInterval(interval); });
  server.listen(config.port, config.bindHost, () => {
    console.log(JSON.stringify({ level: 'info', scope: 'compose-runner', message: 'listening', host: config.bindHost, port: config.port }));
    gc();
  });
  return server;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) startController();
