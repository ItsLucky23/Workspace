//? Incus/KVM control-plane contract with a deterministic CLI fake. No hypervisor/network.

import { assert, eq, report } from '../_helpers.mts';
import { readControllerConfig, type ControllerConfig } from '../../services/compose-runner/src/config.ts';
import { IncusSandboxProvider, type IncusCommandTransport } from '../../services/compose-runner/src/incus.ts';
import type { CommandResult } from '../../services/compose-runner/src/types.ts';
import type { SandboxAgentProbe } from '../../services/compose-runner/src/proxmox.ts';

const workspaceId = '507f1f77bcf86cd799439011';
const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false });
const config: ControllerConfig = {
  provider: 'incus', bindHost: '127.0.0.1', port: 8787, bearerToken: 'public-runner-token', guestTokenSecret: 'guest-secret',
  maxConcurrent: 3, requestTimeoutMs: 30_000, provisionTimeoutMs: 60_000, idleGcHours: 24, gcIntervalMs: 900_000,
  incus: {
    binary: '/usr/bin/incus', clientDir: '/var/lib/workspaces-compose-runner', remote: 'workspaces', project: 'workspaces-sandboxes',
    image: 'workspaces-compose-golden', network: 'workspaces0', sandboxCidr: '10.78.0.0/17', networkPrefix: 16, gateway: '10.78.0.1',
    cores: 2, memoryMb: 3072, diskGb: 40, agentPort: 8788, agentScheme: 'http',
    firewallSocket: '/run/workspaces-compose-runner/firewall.sock',
  },
  proxmox: {
    baseUrl: new URL('https://unused/'), apiTokenId: 'unused', apiTokenSecret: 'unused', ca: undefined, node: 'unused',
    pool: 'unused', templateVmid: 9000, bridge: 'unused', storage: 'unused', sandboxCidr: '10.77.0.0/16', gateway: '10.77.0.1',
    dns: '1.1.1.1', vmidMin: 20_000, vmidMax: 29_999, cores: 2, memoryMb: 4096, diskGb: 40, agentPort: 8788,
    agentScheme: 'http', controllerSourceCidrs: [], appSourceCidrs: [], outboundAllowCidrs: [], outboundDenyCidrs: [],
    sshUser: 'unused', sshPrivateKeyFile: '/dev/null', sshKnownHostsFile: '/tmp/unused',
  },
};
const parsedConfig = readControllerConfig({
  RUNNER_PROVIDER: 'incus', RUNNER_BEARER_TOKEN: 'public', RUNNER_GUEST_TOKEN_SECRET: 'guest',
});
eq(parsedConfig.provider, 'incus', 'Incus configuration does not require fake Proxmox credentials');
eq(parsedConfig.incus.sandboxCidr, '10.78.0.0/17', 'the Pi-safe static address range is bounded away from DHCP');

const probe: SandboxAgentProbe = {
  health: async () => true,
  activeProjects: async () => ({ ok: true, value: [] }),
};
const existingJson = JSON.stringify([{
  name: `ws-${workspaceId}`, status: 'Running', type: 'virtual-machine', config: {
    'user.workspaces.compose_runner': 'workspaces-compose-runner:incus-v1',
    'user.workspaces.workspace_id': workspaceId,
    'user.workspaces.ip': '10.78.0.10',
    'user.workspaces.last_used_at': '2026-07-23T08:00:00.000Z',
  },
}, { name: 'unmanaged', status: 'Running', type: 'virtual-machine', config: {} }]);

const calls: string[][] = [];
const firewalls: Array<{ workspaceId: string; ip: string; ports: number[]; remove: boolean }> = [];
const existingTransport: IncusCommandTransport = {
  run: async (args) => {
    calls.push(args);
    if (args[0] === 'info') return ok('server');
    if (args[0] === 'list') return ok(existingJson);
    return ok();
  },
  firewall: async (id, ip, _agentPort, ports, remove = false) => {
    firewalls.push({ workspaceId: id, ip, ports, remove });
    return ok();
  },
};
const provider = new IncusSandboxProvider(config, probe, existingTransport);
assert(await provider.health(), 'runner health proves the restricted Incus remote is reachable');
const managed = await provider.listManagedVms();
eq(managed.length, 1, 'only marker-owned full VMs are discovered');
eq(managed[0]?.workspaceId, workspaceId, 'workspace identity is recovered from Incus metadata');
eq(managed[0]?.node, '10.78.0.10', 'the durable static sandbox address is recovered');
const existing = await provider.ensureSandbox(workspaceId);
eq(existing.ip, '10.78.0.10', 'an existing workspace VM is reused');
assert(provider.guestToken(workspaceId) !== provider.guestToken('507f191e810c19729de860ea'), 'guest tokens remain workspace-specific');
await provider.configureGatewayFirewall(existing, [5432]);
eq(firewalls.at(-1)?.ports, [5432], 'only agent-declared gateway ports reach the root-owned ACL helper');
assert(calls.some((args) => args[0] === 'config' && args[1] === 'set'), 'using a sandbox refreshes durable last-used metadata');

let listCalls = 0;
const createCalls: Array<{ args: string[]; stdin?: string }> = [];
const createFirewalls: Array<{ remove: boolean; ports: number[] }> = [];
const creatingTransport: IncusCommandTransport = {
  run: async (args, options) => {
    createCalls.push({ args, stdin: options?.stdin });
    if (args[0] === 'list') {
      listCalls += 1;
      return ok(listCalls <= 3 ? '[]' : existingJson);
    }
    return ok();
  },
  firewall: async (_id, _ip, _agentPort, ports, remove = false) => {
    createFirewalls.push({ remove, ports });
    return ok();
  },
};
const creating = new IncusSandboxProvider(config, probe, creatingTransport);
const created = await creating.ensureSandbox(workspaceId);
eq(created.ip, '10.78.0.10', 'new VM allocation starts at the bounded static address range');
const init = createCalls.find((call) => call.args[0] === 'init');
assert(Boolean(init?.args.includes('--vm')), 'Incus always provisions a full KVM virtual machine');
assert(Boolean(init?.args.includes('limits.cpu=2')), 'the VM receives a CPU quota before boot');
assert(Boolean(init?.args.includes('limits.memory=3072MiB')), 'the VM receives a RAM quota before boot');
assert(Boolean(init?.args.includes('root,size=40GiB')), 'the VM receives a disk quota before boot');
const metadata = createCalls.find((call) => call.args[0] === 'config' && call.args[1] === 'set' && call.args.some((arg) => arg.startsWith('cloud-init.network-config=')));
assert(metadata?.args.some((arg) => arg.includes('addresses: [10.78.0.10/16]')) === true, 'cloud-init pins the isolated address before first boot');
const nic = createCalls.find((call) => call.args[0] === 'config' && call.args[1] === 'device');
assert(createFirewalls[0]?.remove === false, 'the external nftables boundary is created before VM boot');
assert(Boolean(nic?.args.includes('security.ipv4_filtering=true')), 'the hypervisor rejects guest IP spoofing');
assert(Boolean(nic?.args.includes('security.mac_filtering=true')), 'the hypervisor rejects guest MAC spoofing');
const bootstrap = createCalls.find((call) => call.args[0] === 'exec');
assert(bootstrap?.stdin?.includes(`AGENT_WORKSPACE_ID=${workspaceId}`) === true, 'Incus exec binds the guest agent to one workspace');
assert(bootstrap?.stdin?.includes(`AGENT_BEARER_TOKEN=${creating.guestToken(workspaceId)}`) === true, 'only the derived guest token enters the VM');
assert(!bootstrap?.stdin?.includes(config.bearerToken), 'the public runner bearer never enters the VM');
await creating.destroySandbox(created);
assert(createCalls.some((call) => call.args[0] === 'delete' && call.args.includes('--force')), 'sandbox reset deletes the full VM');
assert(createFirewalls.at(-1)?.remove === true, 'sandbox reset removes its external nftables state');

report('tests/unit/incusSandboxProvider.test.mts');
