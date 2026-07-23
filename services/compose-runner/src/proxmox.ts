import { createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { ControllerConfig } from './config.js';
import { AgentClient } from './agentClient.js';
import { ProxmoxApi } from './proxmoxApi.js';
import { asRecord, KeyedLock, runCommand, WORKSPACE_ID_PATTERN } from './runtime.js';
import type { CommandResult, ManagedVm, Result, SandboxDescriptor } from './types.js';

const MARKER = 'workspaces-compose-runner:v1';
const MANAGED_COMMENT = 'workspaces-runner:';

interface ResourceRow {
  vmid: number;
  node: string;
  name: string;
  status: string;
  template: boolean;
}

function readResourceRows(value: unknown): ResourceRow[] {
  if (!Array.isArray(value)) return [];
  const result: ResourceRow[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const vmid = typeof row?.vmid === 'number' ? row.vmid : Number(row?.vmid);
    if (!row || !Number.isInteger(vmid) || typeof row.node !== 'string' || typeof row.name !== 'string') continue;
    result.push({
      vmid,
      node: row.node,
      name: row.name,
      status: typeof row.status === 'string' ? row.status : 'unknown',
      template: row.template === 1 || row.template === true,
    });
  }
  return result;
}

function descriptionFor(workspaceId: string, lastUsedAt: Date): string {
  return `${MARKER}\nworkspaceId=${workspaceId}\nlastUsedAt=${lastUsedAt.toISOString()}`;
}

function metadataFromDescription(description: string): { workspaceId: string; lastUsedAt: Date | null } | null {
  if (!description.split('\n').includes(MARKER)) return null;
  let workspaceId = '';
  let lastUsedAt = '';
  for (const line of description.split('\n')) {
    if (line.startsWith('workspaceId=')) workspaceId = line.slice('workspaceId='.length);
    if (line.startsWith('lastUsedAt=')) lastUsedAt = line.slice('lastUsedAt='.length);
  }
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) return null;
  const parsed = lastUsedAt ? new Date(lastUsedAt) : null;
  return { workspaceId: workspaceId.toLowerCase(), lastUsedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null };
}

const ipToNumber = (ip: string): number | null => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((((parts[0] ?? 0) * 256 + (parts[1] ?? 0)) * 256 + (parts[2] ?? 0)) * 256 + (parts[3] ?? 0)) >>> 0;
};

const numberToIp = (value: number): string => [24, 16, 8, 0].map((shift) => String((value >>> shift) & 255)).join('.');

function allocateIp(cidr: string, offset: number): { ip: string; prefix: number } {
  const [networkRaw, prefixRaw] = cidr.split('/');
  const network = ipToNumber(networkRaw ?? '');
  const prefix = Number(prefixRaw);
  if (network === null || !Number.isInteger(prefix) || prefix < 16 || prefix > 29) throw new Error('PVE_SANDBOX_CIDR must be an IPv4 /16 through /29');
  const capacity = 2 ** (32 - prefix);
  const host = offset + 10;
  if (host >= capacity - 1) throw new Error('PVE VM id range does not fit in PVE_SANDBOX_CIDR');
  const mask = (4_294_967_295 << (32 - prefix)) >>> 0;
  return { ip: numberToIp(((network & mask) + host) >>> 0), prefix };
}

const readTaskId = (result: Result<unknown>): string | null => result.ok && typeof result.value === 'string' ? result.value : null;

const readDescription = (value: unknown): string => {
  const row = asRecord(value);
  return typeof row?.description === 'string' ? row.description : '';
};

const currentDiskSizeGb = (value: unknown): number | null => {
  const row = asRecord(value);
  const disk = typeof row?.scsi0 === 'string' ? row.scsi0 : '';
  const match = /(?:^|,)size=(\d+(?:\.\d+)?)([GM])(?:,|$)/.exec(disk);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === 'M' ? amount / 1024 : amount;
};

export interface ProxmoxTransport {
  get: (pathname: string, parameters?: Record<string, string | number | boolean>) => Promise<Result<unknown>>;
  post: (pathname: string, parameters?: Record<string, string | number | boolean>) => Promise<Result<unknown>>;
  put: (pathname: string, parameters?: Record<string, string | number | boolean>) => Promise<Result<unknown>>;
  delete: (pathname: string, parameters?: Record<string, string | number | boolean>) => Promise<Result<unknown>>;
}

export type SystemCommandRunner = (
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; stdin?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export interface SandboxAgentProbe {
  health: (sandbox: SandboxDescriptor, token: string) => Promise<boolean>;
  activeProjects: (sandbox: SandboxDescriptor, token: string) => Promise<Result<string[]>>;
}

export class ProxmoxSandboxProvider {
  private readonly api: ProxmoxTransport;
  private readonly locks = new KeyedLock();
  private readonly provisionLock = new KeyedLock();

  constructor(
    private readonly config: ControllerConfig,
    private readonly agentClient: SandboxAgentProbe = new AgentClient(fetch, config.requestTimeoutMs),
    api?: ProxmoxTransport,
    private readonly commandRunner: SystemCommandRunner = runCommand,
  ) {
    this.api = api ?? new ProxmoxApi(config.proxmox);
  }

  guestToken(workspaceId: string): string {
    return createHmac('sha256', this.config.guestTokenSecret).update(`compose-agent:${workspaceId.toLowerCase()}`).digest('base64url');
  }

  async health(): Promise<boolean> {
    const result = await this.api.get('version');
    return result.ok;
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
      if (existing) return this.prepareExistingSandbox(existing, workspaceId);
      //? VMID/IP allocation is cluster-global, not workspace-local. Serialize only the short provisioning
      //? allocation/clone path and re-check inside it so two new workspaces cannot claim the same free VMID.
      return this.provisionLock.run('cluster-allocation', async () => {
        const raced = await this.findSandbox(workspaceId);
        return raced ? this.prepareExistingSandbox(raced, workspaceId) : this.createSandbox(workspaceId);
      });
    });
  }

  async configureGatewayFirewall(sandbox: SandboxDescriptor, ports: number[]): Promise<void> {
    if (ports.length > 0 && this.config.proxmox.appSourceCidrs.length === 0) {
      throw new Error('Compose declared gateway ports but PVE_APP_SOURCE_CIDRS is empty');
    }
    await this.applyFirewall(sandbox.node, sandbox.vmid, ports);
    await this.touch(sandbox);
  }

  async activeProjects(sandbox: SandboxDescriptor): Promise<Result<string[]>> {
    return this.agentClient.activeProjects(sandbox, this.guestToken(sandbox.workspaceId));
  }

  async destroySandbox(sandbox: SandboxDescriptor): Promise<void> {
    const status = await this.api.post(`nodes/${encodeURIComponent(sandbox.node)}/qemu/${String(sandbox.vmid)}/status/stop`);
    const stopTask = readTaskId(status);
    if (stopTask) await this.waitForTask(sandbox.node, stopTask);
    const deleted = await this.api.delete(`nodes/${encodeURIComponent(sandbox.node)}/qemu/${String(sandbox.vmid)}`, { purge: 1, 'destroy-unreferenced-disks': 1 });
    const deleteTask = readTaskId(deleted);
    if (!deleteTask && !deleted.ok) throw new Error(deleted.error);
    if (deleteTask) await this.waitForTask(sandbox.node, deleteTask);
  }

  async listManagedVms(): Promise<ManagedVm[]> {
    const resourcesResult = await this.api.get('cluster/resources', { type: 'vm' });
    if (!resourcesResult.ok) throw new Error(resourcesResult.error);
    const managed: ManagedVm[] = [];
    for (const resource of readResourceRows(resourcesResult.value).filter((item) => item.name.startsWith('ws-') && !item.template)) {
      const config = await this.api.get(`nodes/${encodeURIComponent(resource.node)}/qemu/${String(resource.vmid)}/config`);
      if (!config.ok) continue;
      const metadata = metadataFromDescription(readDescription(config.value));
      if (!metadata) continue;
      managed.push({ ...resource, workspaceId: metadata.workspaceId, lastUsedAt: metadata.lastUsedAt });
    }
    return managed;
  }

  descriptor(node: string, vmid: number, workspaceId: string): SandboxDescriptor {
    const address = allocateIp(this.config.proxmox.sandboxCidr, vmid - this.config.proxmox.vmidMin);
    return {
      workspaceId: workspaceId.toLowerCase(),
      vmid,
      node,
      ip: address.ip,
      agentUrl: new URL(`${this.config.proxmox.agentScheme}://${address.ip}:${String(this.config.proxmox.agentPort)}/`),
    };
  }

  private async prepareExistingSandbox(existing: ManagedVm, workspaceId: string): Promise<SandboxDescriptor> {
    if (existing.status !== 'running') await this.startVm(existing.node, existing.vmid);
    const descriptor = this.descriptor(existing.node, existing.vmid, workspaceId);
    if (!(await this.agentClient.health(descriptor, this.guestToken(workspaceId)))) await this.configureAgent(descriptor);
    await this.touch(descriptor);
    return descriptor;
  }

  private async createSandbox(workspaceId: string): Promise<SandboxDescriptor> {
    const resourcesResult = await this.api.get('cluster/resources', { type: 'vm' });
    if (!resourcesResult.ok) throw new Error(resourcesResult.error);
    const resources = readResourceRows(resourcesResult.value);
    const used = new Set(resources.map((item) => item.vmid));
    const vmid = this.findFreeVmid(used);
    const template = resources.find((item) => item.vmid === this.config.proxmox.templateVmid && item.template);
    if (!template) throw new Error(`Proxmox template VM ${String(this.config.proxmox.templateVmid)} was not found`);
    const now = new Date();
    const clone = await this.api.post(`nodes/${encodeURIComponent(template.node)}/qemu/${String(template.vmid)}/clone`, {
      newid: vmid,
      name: `ws-${workspaceId.toLowerCase()}`,
      full: 1,
      target: this.config.proxmox.node,
      storage: this.config.proxmox.storage,
      pool: this.config.proxmox.pool,
      description: descriptionFor(workspaceId.toLowerCase(), now),
    });
    const task = readTaskId(clone);
    if (!task) throw new Error(clone.ok ? 'Proxmox clone returned no task id' : clone.error);
    await this.waitForTask(template.node, task);

    const descriptor = this.descriptor(this.config.proxmox.node, vmid, workspaceId);
    const publicKey = await this.readSshPublicKey();
    const address = allocateIp(this.config.proxmox.sandboxCidr, vmid - this.config.proxmox.vmidMin);
    const configured = await this.api.put(`nodes/${encodeURIComponent(descriptor.node)}/qemu/${String(vmid)}/config`, {
      cores: this.config.proxmox.cores,
      memory: this.config.proxmox.memoryMb,
      agent: 'enabled=1',
      net0: `virtio,bridge=${this.config.proxmox.bridge},firewall=1`,
      ipconfig0: `ip=${address.ip}/${String(address.prefix)},gw=${this.config.proxmox.gateway}`,
      nameserver: this.config.proxmox.dns,
      ciuser: this.config.proxmox.sshUser,
      sshkeys: publicKey,
      tags: 'workspaces;compose-sandbox',
      description: descriptionFor(workspaceId.toLowerCase(), now),
      onboot: 0,
    });
    if (!configured.ok) throw new Error(configured.error);
    await this.ensureDiskSize(descriptor);
    await this.applyFirewall(descriptor.node, descriptor.vmid, []);
    await this.startVm(descriptor.node, descriptor.vmid);
    await this.configureAgent(descriptor);
    await this.touch(descriptor);
    return descriptor;
  }

  private async findSandbox(workspaceId: string): Promise<ManagedVm | null> {
    const managed = await this.listManagedVms();
    return managed.find((item) => item.workspaceId === workspaceId.toLowerCase()) ?? null;
  }

  private findFreeVmid(used: Set<number>): number {
    for (let vmid = this.config.proxmox.vmidMin; vmid <= this.config.proxmox.vmidMax; vmid += 1) {
      if (!used.has(vmid)) return vmid;
    }
    throw new Error('No free VM ids remain in the configured range');
  }

  private async startVm(node: string, vmid: number): Promise<void> {
    const result = await this.api.post(`nodes/${encodeURIComponent(node)}/qemu/${String(vmid)}/status/start`);
    const task = readTaskId(result);
    if (!task && !result.ok && !result.error.includes('already running')) throw new Error(result.error);
    if (task) await this.waitForTask(node, task);
  }

  private async ensureDiskSize(sandbox: SandboxDescriptor): Promise<void> {
    const config = await this.api.get(`nodes/${encodeURIComponent(sandbox.node)}/qemu/${String(sandbox.vmid)}/config`);
    if (!config.ok) throw new Error(config.error);
    const current = currentDiskSizeGb(config.value);
    if (current !== null && current >= this.config.proxmox.diskGb) return;
    const resized = await this.api.put(`nodes/${encodeURIComponent(sandbox.node)}/qemu/${String(sandbox.vmid)}/resize`, {
      disk: 'scsi0',
      size: `${String(this.config.proxmox.diskGb)}G`,
    });
    if (!resized.ok) throw new Error(resized.error);
  }

  private async applyFirewall(node: string, vmid: number, gatewayPorts: number[]): Promise<void> {
    const base = `nodes/${encodeURIComponent(node)}/qemu/${String(vmid)}/firewall`;
    const options = await this.api.put(`${base}/options`, { enable: 1, policy_in: 'DROP', policy_out: 'DROP', log_level_in: 'warning', log_level_out: 'warning' });
    if (!options.ok) throw new Error(options.error);
    const existing = await this.api.get(`${base}/rules`);
    if (!existing.ok) throw new Error(existing.error);
    const rules = Array.isArray(existing.value)
      ? existing.value.map((item) => asRecord(item)).filter((row): row is Record<string, unknown> => row !== null)
      : [];
    const unmanaged = rules.filter((row) => typeof row.comment !== 'string' || !row.comment.startsWith(MANAGED_COMMENT));
    //? A pre-existing ACCEPT could sit above our deny rules and silently destroy tenant isolation. Dedicated
    //? sandbox VMs are runner-owned, so unexpected rules are a configuration error rather than merge input.
    if (unmanaged.length > 0) throw new Error('Sandbox VM contains unmanaged firewall rules');
    const positions = rules.map((row) => Number(row.pos)).filter((position) => Number.isInteger(position)).toSorted((left, right) => right - left);
    for (const position of positions) {
      const removed = await this.api.delete(`${base}/rules/${String(position)}`);
      if (!removed.ok) throw new Error(removed.error);
    }
    for (const source of this.config.proxmox.controllerSourceCidrs) {
      await this.addFirewallRule(base, { type: 'in', action: 'ACCEPT', source, proto: 'tcp', dport: String(this.config.proxmox.agentPort), comment: `${MANAGED_COMMENT}agent` });
    }
    if (gatewayPorts.length > 0) {
      for (const source of this.config.proxmox.appSourceCidrs) {
        await this.addFirewallRule(base, { type: 'in', action: 'ACCEPT', source, proto: 'tcp', dport: gatewayPorts.join(','), comment: `${MANAGED_COMMENT}gateway` });
      }
    }
    for (const destination of this.config.proxmox.outboundAllowCidrs) {
      await this.addFirewallRule(base, { type: 'out', action: 'ACCEPT', dest: destination, comment: `${MANAGED_COMMENT}allow` });
    }
    for (const destination of this.config.proxmox.outboundDenyCidrs) {
      await this.addFirewallRule(base, { type: 'out', action: 'DROP', dest: destination, comment: `${MANAGED_COMMENT}deny-private` });
    }
    await this.addFirewallRule(base, { type: 'out', action: 'ACCEPT', dest: '0.0.0.0/0', comment: `${MANAGED_COMMENT}public-egress` });
  }

  private async addFirewallRule(base: string, rule: Record<string, string>): Promise<void> {
    const result = await this.api.post(`${base}/rules`, { enable: 1, ...rule });
    if (!result.ok) throw new Error(result.error);
  }

  private async configureAgent(sandbox: SandboxDescriptor): Promise<void> {
    await mkdir(path.dirname(this.config.proxmox.sshKnownHostsFile), { recursive: true, mode: 0o700 });
    await this.commandRunner('ssh-keygen', ['-f', this.config.proxmox.sshKnownHostsFile, '-R', sandbox.ip], { timeoutMs: 10_000 });
    const token = this.guestToken(sandbox.workspaceId);
    const body = [
      `AGENT_WORKSPACE_ID=${sandbox.workspaceId}`,
      `AGENT_BEARER_TOKEN=${token}`,
      `AGENT_PORT=${String(this.config.proxmox.agentPort)}`,
      `AGENT_GATEWAY_HOST=${sandbox.ip}`,
      '',
    ].join('\n');
    const deadline = Date.now() + this.config.provisionTimeoutMs;
    let lastError = 'ssh unavailable';
    while (Date.now() < deadline) {
      const configured = await this.commandRunner('ssh', [
        '-i', this.config.proxmox.sshPrivateKeyFile,
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', `UserKnownHostsFile=${this.config.proxmox.sshKnownHostsFile}`,
        `${this.config.proxmox.sshUser}@${sandbox.ip}`,
        'sudo', '/usr/local/sbin/workspaces-compose-agent-configure',
      ], { timeoutMs: 20_000, stdin: body });
      if (configured.code === 0 && await this.agentClient.health(sandbox, token)) return;
      lastError = configured.stderr.slice(-300) || 'agent health check failed';
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error(`Sandbox agent bootstrap timed out: ${lastError}`);
  }

  private async readSshPublicKey(): Promise<string> {
    const result = await this.commandRunner('ssh-keygen', ['-y', '-f', this.config.proxmox.sshPrivateKeyFile], { timeoutMs: 10_000 });
    if (result.code !== 0 || !result.stdout.trim()) throw new Error(`Cannot derive SSH public key: ${result.stderr.slice(-300)}`);
    return result.stdout.trim();
  }

  private async touch(sandbox: SandboxDescriptor): Promise<void> {
    const result = await this.api.put(`nodes/${encodeURIComponent(sandbox.node)}/qemu/${String(sandbox.vmid)}/config`, {
      description: descriptionFor(sandbox.workspaceId, new Date()),
    });
    if (!result.ok) throw new Error(result.error);
  }

  private async waitForTask(node: string, taskId: string): Promise<void> {
    const deadline = Date.now() + this.config.provisionTimeoutMs;
    while (Date.now() < deadline) {
      const status = await this.api.get(`nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(taskId)}/status`);
      if (!status.ok) throw new Error(status.error);
      const row = asRecord(status.value);
      if (row?.status === 'stopped') {
        if (row.exitstatus === 'OK') return;
        throw new Error(`Proxmox task failed: ${typeof row.exitstatus === 'string' ? row.exitstatus : 'unknown'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Proxmox task timed out');
  }
}
