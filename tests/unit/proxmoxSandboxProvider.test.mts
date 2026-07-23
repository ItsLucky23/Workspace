//? Proxmox control-plane contract with a deterministic fake API. No hypervisor/network.

import os from 'node:os';
import path from 'node:path';

import { assert, eq, report } from '../_helpers.mts';
import type { ControllerConfig } from '../../services/compose-runner/src/config.ts';
import { ProxmoxSandboxProvider, type ProxmoxTransport, type SandboxAgentProbe, type SystemCommandRunner } from '../../services/compose-runner/src/proxmox.ts';
import type { Result } from '../../services/compose-runner/src/types.ts';

const workspaceId = '507f1f77bcf86cd799439011';
const calls: Array<{ method: string; path: string; parameters: Record<string, string | number | boolean> }> = [];
const description = `workspaces-compose-runner:v1\nworkspaceId=${workspaceId}\nlastUsedAt=2026-07-22T20:00:00.000Z`;

class FakeProxmoxApi implements ProxmoxTransport {
  async get(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    calls.push({ method: 'GET', path, parameters });
    if (path === 'version') return { ok: true, value: { version: '8.4' } };
    if (path === 'cluster/resources') return { ok: true, value: [{ vmid: 20_000, node: 'pve', name: `ws-${workspaceId}`, status: 'running', template: 0 }] };
    if (path.endsWith('/config')) return { ok: true, value: { description, scsi0: 'local-lvm:vm-20000-disk-0,size=40G' } };
    if (path.endsWith('/firewall/rules')) return { ok: true, value: [{ pos: 1, comment: 'workspaces-runner:old' }] };
    return { ok: false, error: `unexpected GET ${path}` };
  }

  async post(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    calls.push({ method: 'POST', path, parameters });
    return { ok: true, value: null };
  }

  async put(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    calls.push({ method: 'PUT', path, parameters });
    return { ok: true, value: null };
  }

  async delete(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    calls.push({ method: 'DELETE', path, parameters });
    return { ok: true, value: null };
  }
}

const probe: SandboxAgentProbe = {
  health: async () => true,
  activeProjects: async () => ({ ok: true, value: [] }),
};
const config: ControllerConfig = {
  bindHost: '127.0.0.1', port: 8787, bearerToken: 'public', guestTokenSecret: 'guest-secret', maxConcurrent: 4,
  requestTimeoutMs: 30_000, provisionTimeoutMs: 60_000, idleGcHours: 24, gcIntervalMs: 900_000,
  proxmox: {
    baseUrl: new URL('https://pve.example:8006/'), apiTokenId: 'runner@pve!runner', apiTokenSecret: 'secret', ca: undefined,
    node: 'pve', pool: 'workspaces-sandboxes', templateVmid: 9000, bridge: 'vmbr1', storage: 'local-lvm', sandboxCidr: '10.77.0.0/16',
    gateway: '10.77.0.1', dns: '1.1.1.1', vmidMin: 20_000, vmidMax: 29_999, cores: 2, memoryMb: 4096,
    diskGb: 40, agentPort: 8788, agentScheme: 'http', controllerSourceCidrs: ['10.77.0.2/32'],
    appSourceCidrs: ['10.88.0.5/32'], outboundAllowCidrs: ['10.77.0.53/32'],
    outboundDenyCidrs: ['10.0.0.0/8', '169.254.0.0/16'], sshUser: 'workspaces', sshPrivateKeyFile: '/key',
    sshKnownHostsFile: path.join(os.tmpdir(), 'compose-runner-test', 'known-hosts'),
  },
};
const provider = new ProxmoxSandboxProvider(config, probe, new FakeProxmoxApi());

assert(await provider.health(), 'runner health proves the Proxmox API is reachable');
const managed = await provider.listManagedVms();
eq(managed.length, 1, 'only marker-owned VMs are discovered');
eq(managed[0]?.workspaceId, workspaceId, 'workspace identity is recovered from hypervisor metadata');
const sandbox = await provider.ensureSandbox(workspaceId);
eq(sandbox.vmid, 20_000, 'an existing workspace VM is reused');
eq(sandbox.ip, '10.77.0.10', 'VM id deterministically maps to a unique private address');
assert(provider.guestToken(workspaceId) !== provider.guestToken('507f191e810c19729de860ea'), 'guest bearer tokens are workspace-specific');

await provider.configureGatewayFirewall(sandbox, [5432, 6379]);
assert(calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/firewall/rules/1')), 'old runner-owned firewall rules are replaced');
assert(calls.some((call) => call.method === 'POST' && call.parameters.source === '10.77.0.2/32' && call.parameters.dport === '8788'), 'agent ingress is limited to the controller CIDR');
assert(calls.some((call) => call.method === 'POST' && call.parameters.source === '10.88.0.5/32' && call.parameters.dport === '5432,6379'), 'gateway ports are limited to the Workspaces app CIDR');
assert(calls.some((call) => call.method === 'POST' && call.parameters.action === 'DROP' && call.parameters.dest === '169.254.0.0/16'), 'metadata/private destinations are denied outside the guest');
assert(calls.some((call) => call.method === 'PUT' && call.path.endsWith('/firewall/options') && call.parameters.policy_in === 'DROP'), 'the hypervisor firewall is deny-by-default');

class UnmanagedFirewallApi extends FakeProxmoxApi {
  override async get(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    if (path.endsWith('/firewall/rules')) return { ok: true, value: [{ pos: 0, comment: 'unexpected-accept', action: 'ACCEPT' }] };
    return super.get(path, parameters);
  }
}
const guardedProvider = new ProxmoxSandboxProvider(config, probe, new UnmanagedFirewallApi());
const unmanagedRejected = await guardedProvider.configureGatewayFirewall(sandbox, []).then(() => false).catch(() => true);
assert(unmanagedRejected, 'an unmanaged VM firewall rule fails provisioning instead of weakening isolation');

const createCalls: Array<{ method: string; path: string; parameters: Record<string, string | number | boolean> }> = [];
class CreatingProxmoxApi implements ProxmoxTransport {
  async get(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    createCalls.push({ method: 'GET', path, parameters });
    if (path === 'cluster/resources') return { ok: true, value: [{ vmid: 9000, node: 'pve', name: 'golden', status: 'stopped', template: 1 }] };
    if (path.endsWith('/tasks/UPID%3Aclone/status') || path.endsWith('/tasks/UPID%3Astart/status')) return { ok: true, value: { status: 'stopped', exitstatus: 'OK' } };
    if (path.endsWith('/config')) return { ok: true, value: { scsi0: 'local-lvm:vm-20000-disk-0,size=8G' } };
    if (path.endsWith('/firewall/rules')) return { ok: true, value: [] };
    return { ok: false, error: `unexpected GET ${path}` };
  }
  async post(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    createCalls.push({ method: 'POST', path, parameters });
    if (path.endsWith('/clone')) return { ok: true, value: 'UPID:clone' };
    if (path.endsWith('/status/start')) return { ok: true, value: 'UPID:start' };
    return { ok: true, value: null };
  }
  async put(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    createCalls.push({ method: 'PUT', path, parameters });
    return { ok: true, value: null };
  }
  async delete(path: string, parameters: Record<string, string | number | boolean> = {}): Promise<Result<unknown>> {
    createCalls.push({ method: 'DELETE', path, parameters });
    return { ok: true, value: null };
  }
}
let sshInput = '';
const commandRunner: SystemCommandRunner = async (executable, args, options) => {
  if (executable === 'ssh-keygen' && args.includes('-y')) return { code: 0, stdout: 'ssh-ed25519 AAAATEST runner\n', stderr: '', timedOut: false };
  if (executable === 'ssh') sshInput = options.stdin ?? '';
  return { code: 0, stdout: '', stderr: '', timedOut: false };
};
const creatingProvider = new ProxmoxSandboxProvider(config, probe, new CreatingProxmoxApi(), commandRunner);
const created = await creatingProvider.ensureSandbox('507f191e810c19729de860ea');
eq(created.vmid, 20_000, 'a new workspace receives the first free VM id');
assert(createCalls.some((call) => call.path.endsWith('/clone') && call.parameters.full === 1 && call.parameters.pool === 'workspaces-sandboxes'), 'the golden template is full-cloned into the restricted pool');
assert(createCalls.some((call) => call.path.endsWith('/config') && call.parameters.net0 === 'virtio,bridge=vmbr1,firewall=1'), 'the clone enables the external Proxmox firewall on its NIC');
assert(createCalls.some((call) => call.path.endsWith('/resize') && call.parameters.size === '40G'), 'the VM disk quota is applied');
assert(createCalls.some((call) => call.path.endsWith('/status/start')), 'the configured VM is started');
assert(sshInput.includes('AGENT_WORKSPACE_ID=507f191e810c19729de860ea'), 'SSH bootstrap binds the guest agent to the exact workspace');
assert(sshInput.includes(`AGENT_BEARER_TOKEN=${creatingProvider.guestToken('507f191e810c19729de860ea')}`), 'SSH bootstrap injects only the derived guest token');
assert(!sshInput.includes(config.bearerToken), 'the public runner token never enters the VM');

report('tests/unit/proxmoxSandboxProvider.test.mts');
