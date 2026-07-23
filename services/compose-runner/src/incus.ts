import { createHmac } from 'node:crypto';
import { connect } from 'node:net';

import type { ControllerConfig } from './config.js';
import { AgentClient } from './agentClient.js';
import { asRecord, KeyedLock, parseJson, runCommand, WORKSPACE_ID_PATTERN } from './runtime.js';
import type { CommandResult, ManagedVm, Result, SandboxDescriptor } from './types.js';
import type { SandboxAgentProbe, SystemCommandRunner } from './proxmox.js';

const MARKER = 'workspaces-compose-runner:incus-v1';
const MARKER_KEY = 'user.workspaces.compose_runner';
const WORKSPACE_KEY = 'user.workspaces.workspace_id';
const IP_KEY = 'user.workspaces.ip';
const LAST_USED_KEY = 'user.workspaces.last_used_at';

interface IncusInstanceRow {
  name: string;
  status: string;
  type: string;
  config: Record<string, unknown>;
}

const ipToNumber = (ip: string): number | null => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((((parts[0] ?? 0) * 256 + (parts[1] ?? 0)) * 256 + (parts[2] ?? 0)) * 256 + (parts[3] ?? 0)) >>> 0;
};

const numberToIp = (value: number): string => [24, 16, 8, 0].map((shift) => String((value >>> shift) & 255)).join('.');

function cidrBounds(cidr: string): { network: number; first: number; last: number } {
  const [networkRaw, prefixRaw] = cidr.split('/');
  const address = ipToNumber(networkRaw ?? '');
  const prefix = Number(prefixRaw);
  if (address === null || !Number.isInteger(prefix) || prefix < 16 || prefix > 29) {
    throw new Error('INCUS_SANDBOX_CIDR must be an IPv4 /16 through /29');
  }
  const mask = (4_294_967_295 << (32 - prefix)) >>> 0;
  const network = address & mask;
  const capacity = 2 ** (32 - prefix);
  return { network, first: network + 10, last: network + capacity - 2 };
}

function allocateIp(cidr: string, used: Set<string>): string {
  const bounds = cidrBounds(cidr);
  for (let value = bounds.first; value <= bounds.last; value += 1) {
    const ip = numberToIp(value >>> 0);
    if (!used.has(ip)) return ip;
  }
  throw new Error('No free Incus sandbox addresses remain');
}

function vmidFromIp(cidr: string, ip: string): number {
  const bounds = cidrBounds(cidr);
  const value = ipToNumber(ip);
  if (value === null || value < bounds.first || value > bounds.last) throw new Error('Managed Incus VM has an invalid sandbox address');
  return value - bounds.network;
}

function readRows(value: unknown): IncusInstanceRow[] {
  if (!Array.isArray(value)) return [];
  const rows: IncusInstanceRow[] = [];
  for (const valueRow of value) {
    const row = asRecord(valueRow);
    const config = asRecord(row?.config);
    if (!row || !config || typeof row.name !== 'string') continue;
    rows.push({
      name: row.name,
      status: typeof row.status === 'string' ? row.status : 'Unknown',
      type: typeof row.type === 'string' ? row.type : 'unknown',
      config,
    });
  }
  return rows;
}

const metadataString = (config: Record<string, unknown>, key: string): string => typeof config[key] === 'string' ? config[key] : '';

export interface IncusCommandTransport {
  run: (args: string[], options?: { stdin?: string; timeoutMs?: number }) => Promise<CommandResult>;
  firewall: (workspaceId: string, ip: string, agentPort: number, ports: number[], remove?: boolean) => Promise<CommandResult>;
}

class IncusCliTransport implements IncusCommandTransport {
  constructor(
    private readonly config: ControllerConfig,
    private readonly commandRunner: SystemCommandRunner = runCommand,
  ) {}

  run(args: string[], options: { stdin?: string; timeoutMs?: number } = {}): Promise<CommandResult> {
    return this.commandRunner(this.config.incus.binary, ['--project', this.config.incus.project, ...args], {
      timeoutMs: options.timeoutMs ?? this.config.provisionTimeoutMs,
      stdin: options.stdin,
      env: {
        ...process.env,
        HOME: this.config.incus.clientDir,
        XDG_CONFIG_HOME: `${this.config.incus.clientDir}/.config`,
      },
    });
  }

  firewall(workspaceId: string, ip: string, agentPort: number, ports: number[], remove = false): Promise<CommandResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const socket = connect(this.config.incus.firewallSocket);
      let response = '';
      let settled = false;
      const finish = (code: number, stderr = ''): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve({ code, stdout: response, stderr, timedOut: Date.now() - startedAt >= 30_000 });
      };
      const timer = setTimeout(() => { finish(1, 'Incus firewall helper timed out'); }, 30_000);
      timer.unref();
      socket.on('connect', () => {
        socket.end(`${JSON.stringify({ operation: remove ? 'delete' : 'apply', workspaceId, ip, agentPort, ports })}\n`);
      });
      socket.on('data', (chunk: Buffer) => { if (response.length < 4096) response += chunk.toString('utf8'); });
      socket.on('end', () => {
        const parsed = parseJson(response.trim());
        const row = parsed.ok ? asRecord(parsed.value) : null;
        finish(row?.ok === true ? 0 : 1, typeof row?.error === 'string' ? row.error : 'Invalid Incus firewall helper response');
      });
      socket.on('error', (error) => { finish(1, error.message); });
    });
  }
}

const commandError = (operation: string, result: CommandResult): Error => new Error(`${operation} failed: ${(result.stderr || result.stdout).slice(-500)}`);

export class IncusSandboxProvider {
  private readonly locks = new KeyedLock();
  private readonly provisionLock = new KeyedLock();
  private readonly transport: IncusCommandTransport;

  constructor(
    private readonly config: ControllerConfig,
    private readonly agentClient: SandboxAgentProbe = new AgentClient(fetch, config.requestTimeoutMs),
    transport?: IncusCommandTransport,
  ) {
    this.transport = transport ?? new IncusCliTransport(config);
  }

  guestToken(workspaceId: string): string {
    return createHmac('sha256', this.config.guestTokenSecret).update(`compose-agent:${workspaceId.toLowerCase()}`).digest('base64url');
  }

  async health(): Promise<boolean> {
    const result = await this.transport.run(['info', `${this.config.incus.remote}:`], { timeoutMs: 10_000 });
    return result.code === 0;
  }

  async getSandbox(workspaceId: string): Promise<SandboxDescriptor | null> {
    if (!WORKSPACE_ID_PATTERN.test(workspaceId)) return null;
    const existing = await this.findSandbox(workspaceId);
    return existing ? this.descriptor(existing.node, existing.vmid, workspaceId) : null;
  }

  async ensureSandbox(workspaceId: string): Promise<SandboxDescriptor> {
    if (!WORKSPACE_ID_PATTERN.test(workspaceId)) throw new Error('workspace id is invalid');
    return this.locks.run(workspaceId, async () => {
      const existing = await this.findSandbox(workspaceId);
      if (existing) return this.prepareExistingSandbox(existing);
      return this.provisionLock.run('host-allocation', async () => {
        const raced = await this.findSandbox(workspaceId);
        return raced ? this.prepareExistingSandbox(raced) : this.createSandbox(workspaceId.toLowerCase());
      });
    });
  }

  async configureGatewayFirewall(sandbox: SandboxDescriptor, ports: number[]): Promise<void> {
    const result = await this.transport.firewall(sandbox.workspaceId, sandbox.ip, this.config.incus.agentPort, ports);
    if (result.code !== 0) throw commandError('Incus firewall update', result);
    await this.touch(sandbox.workspaceId);
  }

  async activeProjects(sandbox: SandboxDescriptor): Promise<Result<string[]>> {
    return this.agentClient.activeProjects(sandbox, this.guestToken(sandbox.workspaceId));
  }

  async destroySandbox(sandbox: SandboxDescriptor): Promise<void> {
    const deleted = await this.transport.run(['delete', this.target(sandbox.workspaceId), '--force']);
    if (deleted.code !== 0 && !deleted.stderr.includes('not found')) throw commandError('Incus VM deletion', deleted);
    const firewall = await this.transport.firewall(sandbox.workspaceId, sandbox.ip, this.config.incus.agentPort, [], true);
    if (firewall.code !== 0) throw commandError('Incus firewall deletion', firewall);
  }

  async listManagedVms(): Promise<ManagedVm[]> {
    const result = await this.transport.run(['list', `${this.config.incus.remote}:`, '--format', 'json']);
    if (result.code !== 0) throw commandError('Incus VM list', result);
    const parsed = parseJson(result.stdout);
    if (!parsed.ok) throw new Error('Incus VM list returned invalid JSON');
    const managed: ManagedVm[] = [];
    for (const row of readRows(parsed.value)) {
      const workspaceId = metadataString(row.config, WORKSPACE_KEY).toLowerCase();
      const ip = metadataString(row.config, IP_KEY);
      if (row.type !== 'virtual-machine' || metadataString(row.config, MARKER_KEY) !== MARKER || !WORKSPACE_ID_PATTERN.test(workspaceId)) continue;
      const lastUsedRaw = metadataString(row.config, LAST_USED_KEY);
      const lastUsed = lastUsedRaw ? new Date(lastUsedRaw) : null;
      managed.push({
        workspaceId,
        vmid: vmidFromIp(this.config.incus.sandboxCidr, ip),
        node: ip,
        status: row.status.toLowerCase(),
        name: row.name,
        lastUsedAt: lastUsed && !Number.isNaN(lastUsed.getTime()) ? lastUsed : null,
      });
    }
    return managed;
  }

  descriptor(node: string, vmid: number, workspaceId: string): SandboxDescriptor {
    const ip = node;
    if (vmid !== vmidFromIp(this.config.incus.sandboxCidr, ip)) throw new Error('Incus sandbox identity mismatch');
    return {
      workspaceId: workspaceId.toLowerCase(),
      vmid,
      node: this.config.incus.remote,
      ip,
      agentUrl: new URL(`${this.config.incus.agentScheme}://${ip}:${String(this.config.incus.agentPort)}/`),
    };
  }

  private target(workspaceId: string): string {
    return `${this.config.incus.remote}:ws-${workspaceId.toLowerCase()}`;
  }

  private cloudInitNetwork(ip: string): string {
    return [
      'version: 2',
      'ethernets:',
      '  enp5s0:',
      '    dhcp4: false',
      `    addresses: [${ip}/${String(this.config.incus.networkPrefix)}]`,
      '    routes:',
      '      - to: 0.0.0.0/0',
      `        via: ${this.config.incus.gateway}`,
      '    nameservers:',
      `      addresses: [${this.config.incus.gateway}]`,
      '',
    ].join('\n');
  }

  private async findSandbox(workspaceId: string): Promise<ManagedVm | null> {
    const managed = await this.listManagedVms();
    return managed.find((item) => item.workspaceId === workspaceId.toLowerCase()) ?? null;
  }

  private async prepareExistingSandbox(existing: ManagedVm): Promise<SandboxDescriptor> {
    const sandbox = this.descriptor(existing.node, existing.vmid, existing.workspaceId);
    const firewall = await this.transport.firewall(existing.workspaceId, sandbox.ip, this.config.incus.agentPort, []);
    if (firewall.code !== 0) throw commandError('Incus firewall restore', firewall);
    if (existing.status !== 'running') {
      const started = await this.transport.run(['start', this.target(existing.workspaceId)]);
      if (started.code !== 0 && !started.stderr.includes('already running')) throw commandError('Incus VM start', started);
    }
    if (!(await this.agentClient.health(sandbox, this.guestToken(existing.workspaceId)))) await this.configureAgent(sandbox);
    await this.touch(existing.workspaceId);
    return sandbox;
  }

  private async createSandbox(workspaceId: string): Promise<SandboxDescriptor> {
    const managed = await this.listManagedVms();
    const ip = allocateIp(this.config.incus.sandboxCidr, new Set(managed.map((item) => item.node)));
    const target = this.target(workspaceId);
    const firewall = await this.transport.firewall(workspaceId, ip, this.config.incus.agentPort, []);
    if (firewall.code !== 0) throw commandError('Incus firewall creation', firewall);
    const initialized = await this.transport.run([
      'init', `${this.config.incus.remote}:${this.config.incus.image}`, target, '--vm',
      '--config', `limits.cpu=${String(this.config.incus.cores)}`,
      '--config', `limits.memory=${String(this.config.incus.memoryMb)}MiB`,
      '--device', `root,size=${String(this.config.incus.diskGb)}GiB`,
    ]);
    if (initialized.code !== 0) {
      await this.transport.firewall(workspaceId, ip, this.config.incus.agentPort, [], true);
      throw commandError('Incus VM initialization', initialized);
    }
    const now = new Date().toISOString();
    const metadata = await this.transport.run(['config', 'set', target,
      `${MARKER_KEY}=${MARKER}`, `${WORKSPACE_KEY}=${workspaceId}`, `${IP_KEY}=${ip}`, `${LAST_USED_KEY}=${now}`,
      `cloud-init.network-config=${this.cloudInitNetwork(ip)}`]);
    if (metadata.code !== 0) throw commandError('Incus VM metadata', metadata);
    const network = await this.transport.run(['config', 'device', 'override', target, 'eth0',
      `network=${this.config.incus.network}`, `ipv4.address=${ip}`,
      'security.ipv4_filtering=true', 'security.mac_filtering=true']);
    if (network.code !== 0) throw commandError('Incus VM network isolation', network);
    const started = await this.transport.run(['start', target]);
    if (started.code !== 0) throw commandError('Incus VM start', started);
    const sandbox = this.descriptor(ip, vmidFromIp(this.config.incus.sandboxCidr, ip), workspaceId);
    await this.configureAgent(sandbox);
    await this.touch(workspaceId);
    return sandbox;
  }

  private async configureAgent(sandbox: SandboxDescriptor): Promise<void> {
    const body = [
      `AGENT_WORKSPACE_ID=${sandbox.workspaceId}`,
      `AGENT_BEARER_TOKEN=${this.guestToken(sandbox.workspaceId)}`,
      `AGENT_PORT=${String(this.config.incus.agentPort)}`,
      `AGENT_GATEWAY_HOST=${sandbox.ip}`,
      '',
    ].join('\n');
    const deadline = Date.now() + this.config.provisionTimeoutMs;
    let lastError = 'Incus VM agent unavailable';
    while (Date.now() < deadline) {
      const configured = await this.transport.run(['exec', this.target(sandbox.workspaceId), '--',
        '/usr/local/sbin/workspaces-compose-agent-configure'], { stdin: body, timeoutMs: 30_000 });
      if (configured.code === 0 && await this.agentClient.health(sandbox, this.guestToken(sandbox.workspaceId))) return;
      lastError = (configured.stderr || 'agent health check failed').slice(-300);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error(`Incus sandbox agent bootstrap timed out: ${lastError}`);
  }

  private async touch(workspaceId: string): Promise<void> {
    const result = await this.transport.run(['config', 'set', this.target(workspaceId), `${LAST_USED_KEY}=${new Date().toISOString()}`]);
    if (result.code !== 0) throw commandError('Incus VM touch', result);
  }
}
