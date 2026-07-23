//? Standalone control-plane + sandbox-agent contracts. No Proxmox and no real Docker.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { assert, eq, report } from '../_helpers.mts';
import { AgentClient } from '../../services/compose-runner/src/agentClient.ts';
import type { AgentConfig, ControllerConfig } from '../../services/compose-runner/src/config.ts';
import { ComposeExecutor, type CommandRunner } from '../../services/compose-runner/src/compose.ts';
import { createControllerServer, runGarbageCollection, type SandboxProvider } from '../../services/compose-runner/src/controller.ts';
import { KeyedLock } from '../../services/compose-runner/src/runtime.ts';
import type { ManagedVm, SandboxDescriptor } from '../../services/compose-runner/src/types.ts';

const workspaceId = '507f1f77bcf86cd799439011';
const project = `ws-${workspaceId}-db`;
const temp = await mkdtemp(path.join(os.tmpdir(), 'compose-runner-unit-'));
const commands: string[][] = [];
const commandEnvironments: NodeJS.ProcessEnv[] = [];
const commandRunner: CommandRunner = async (_executable, args, options) => {
  commands.push(args);
  commandEnvironments.push(options.env ?? {});
  if (args.includes('config')) {
    return {
      code: 0,
      stdout: JSON.stringify({ services: { db: { labels: {
        'io.luckystack.gateway.ports': '5432,not-a-port',
        'io.luckystack.gateway.env.DATABASE_URL': 'postgres://{gatewayHost}:5432/app',
        'io.luckystack.gateway.env.BAD-KEY': 'drop',
      } } } }),
      stderr: '',
      timedOut: false,
    };
  }
  return { code: 0, stdout: '', stderr: '', timedOut: false };
};
const agentConfig: AgentConfig = {
  bindHost: '127.0.0.1', port: 8788, workspaceId, token: 'agent-token', dataDir: temp,
  dockerBin: 'docker', operationTimeoutMs: 30_000, gatewayHost: '10.77.0.10',
};
const executor = new ComposeExecutor(agentConfig, commandRunner);
const rawCompose = 'services:\n  db:\n    image: postgres:17\n    privileged: true\n    volumes: ["/:/host"]\n';

try {
  const up = await executor.up({ workspaceId, project, compose: rawCompose });
  assert(up.ok, 'the dedicated VM agent accepts unrestricted Compose syntax');
  eq(up.services, ['db'], 'service names come from docker compose config');
  eq(up.gatewayPorts, [5432], 'only valid labelled gateway ports are returned');
  eq(up.env.DATABASE_URL, 'postgres://10.77.0.10:5432/app', 'gateway placeholders resolve to the sandbox endpoint');
  assert(!('BAD-KEY' in up.env), 'invalid environment labels are dropped');
  eq(await readFile(path.join(temp, 'projects', project, 'compose.yml'), 'utf8'), rawCompose, 'raw Compose is preserved byte-for-byte inside the sandbox');
  assert(commands.some((args) => args.includes('up') && args.includes('--remove-orphans')), 'compose up is argv-only and removes orphans');
  assert(commandEnvironments.every((env) => env.AGENT_BEARER_TOKEN === undefined), 'Compose interpolation never receives the guest bearer token');

  const mismatch = await executor.up({ workspaceId: '507f191e810c19729de860ea', project, compose: rawCompose });
  eq(mismatch.error, 'workspace.mismatch', 'the guest refuses another workspace identity');

  const down = await executor.down({ workspaceId, project });
  assert(down.ok, 'compose down succeeds');
  assert(commands.some((args) => args.includes('down') && args.includes('-v')), 'teardown removes volumes');
  eq((await executor.activeProjects()).length, 0, 'successful teardown leaves no active project marker');
} finally {
  await rm(temp, { recursive: true, force: true });
}

const sandbox: SandboxDescriptor = {
  workspaceId, vmid: 20_000, node: 'pve', ip: '10.77.0.10', agentUrl: new URL('http://10.77.0.10:8788/'),
};
let ensured = 0;
let firewallPorts: number[] = [];
let destroyed = 0;
const provider: SandboxProvider = {
  health: async () => true,
  guestToken: () => 'derived-agent-token',
  getSandbox: async () => sandbox,
  ensureSandbox: async () => { ensured += 1; return sandbox; },
  configureGatewayFirewall: async (_sandbox, ports) => { firewallPorts = ports; },
  activeProjects: async () => ({ ok: true, value: [] }),
  destroySandbox: async () => { destroyed += 1; },
  listManagedVms: async (): Promise<ManagedVm[]> => [],
  descriptor: () => sandbox,
};
let agentAuthorization = '';
const agentTransport: typeof fetch = async (_input, init) => {
  agentAuthorization = new Headers(init?.headers).get('authorization') ?? '';
  return new Response(JSON.stringify({
    ok: true,
    services: ['db'],
    env: { DATABASE_URL: 'postgres://10.77.0.10:5432/app' },
    gatewayPorts: [5432],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const controllerConfig: ControllerConfig = {
  bindHost: '127.0.0.1', port: 8787, bearerToken: 'public-runner-token', guestTokenSecret: 'guest-secret',
  maxConcurrent: 4, requestTimeoutMs: 30_000, provisionTimeoutMs: 60_000, idleGcHours: 24, gcIntervalMs: 900_000,
  proxmox: {
    baseUrl: new URL('https://pve.example/'), apiTokenId: 'runner@pve!token', apiTokenSecret: 'secret', ca: undefined,
    node: 'pve', pool: 'workspaces-sandboxes', templateVmid: 9000, bridge: 'vmbr1', storage: 'local-lvm', sandboxCidr: '10.77.0.0/16',
    gateway: '10.77.0.1', dns: '1.1.1.1', vmidMin: 20_000, vmidMax: 29_999, cores: 2, memoryMb: 4096,
    diskGb: 40, agentPort: 8788, agentScheme: 'http', controllerSourceCidrs: ['10.77.0.2/32'], appSourceCidrs: [],
    outboundAllowCidrs: [], outboundDenyCidrs: ['10.0.0.0/8'], sshUser: 'workspaces', sshPrivateKeyFile: '/key',
    sshKnownHostsFile: '/known-hosts',
  },
};
const controller = createControllerServer(controllerConfig, {
  provider,
  agentClient: new AgentClient(agentTransport, 30_000),
  workspaceLocks: new KeyedLock(),
});
await new Promise<void>((resolve) => controller.listen(0, '127.0.0.1', resolve));
const address = controller.address() as AddressInfo;
const base = `http://127.0.0.1:${String(address.port)}`;
try {
  const unauthorized = await fetch(`${base}/workspaces/${workspaceId}/v1/compose/up`, { method: 'POST' });
  eq(unauthorized.status, 401, 'the public runner rejects a missing bearer token');

  const wrongWorkspace = await fetch(`${base}/workspaces/${workspaceId}/v1/compose/up`, {
    method: 'POST', headers: { authorization: 'Bearer public-runner-token', 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId: '507f191e810c19729de860ea', project, compose: rawCompose }),
  });
  eq(wrongWorkspace.status, 422, 'URL/body workspace mismatch is rejected');

  const response = await fetch(`${base}/workspaces/${workspaceId}/v1/compose/up`, {
    method: 'POST', headers: { authorization: 'Bearer public-runner-token', 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, project, compose: rawCompose }),
  });
  const body: unknown = await response.json();
  assert(response.ok, 'a valid runner request succeeds');
  assert(typeof body === 'object' && body !== null && 'ok' in body && body.ok === true, 'the response follows the Workspaces runner contract');
  eq(ensured, 1, 'the workspace VM is ensured exactly once');
  eq(agentAuthorization, 'Bearer derived-agent-token', 'the public bearer is never forwarded to the guest');
  eq(firewallPorts, [5432], 'the hypervisor opens only agent-declared gateway ports');

  const noConfirm = await fetch(`${base}/workspaces/${workspaceId}/v1/sandbox/reset`, {
    method: 'POST', headers: { authorization: 'Bearer public-runner-token' },
  });
  eq(noConfirm.status, 409, 'sandbox reset requires an exact workspace confirmation header');
  eq(destroyed, 0, 'an unconfirmed reset cannot destroy a VM');
} finally {
  await new Promise<void>((resolve, reject) => controller.close((error) => error ? reject(error) : resolve()));
}

let gcReads = 0;
let gcDestroyed = 0;
const gcProvider: SandboxProvider = {
  ...provider,
  listManagedVms: async () => {
    gcReads += 1;
    return [{ workspaceId, vmid: 20_000, node: 'pve', name: `ws-${workspaceId}`, status: 'running',
      lastUsedAt: gcReads === 1 ? new Date(Date.now() - 72 * 60 * 60 * 1000) : new Date() }];
  },
  destroySandbox: async () => { gcDestroyed += 1; },
};
await runGarbageCollection(controllerConfig, gcProvider, new KeyedLock());
eq(gcDestroyed, 0, 'GC re-reads metadata under the workspace lock and never destroys recently touched work');

const conductorSource = await readFile(path.join(process.cwd(), 'server', 'orchestrator', 'conductor.ts'), 'utf8');
assert(conductorSource.includes('const encrypted = encryptSecret(v);'), 'runner-returned connection values are encrypted before persistence');
assert(conductorSource.includes('value: encrypted, secret: true, serviceName: name'), 'service gateway env rows remain marked secret at rest');

report('tests/unit/composeRunnerService.test.mts');
