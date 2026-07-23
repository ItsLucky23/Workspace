import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { asRecord, parseJson } from './runtime.js';

const WORKSPACE_PATTERN = /^[a-f0-9]{24}$/;
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const CIDR_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const TABLE = 'workspaces_runner';

export interface IncusFirewallRequest {
  operation: 'apply' | 'delete';
  workspaceId: string;
  ip: string;
  agentPort: number;
  ports: number[];
}

interface FirewallState {
  workspaceId: string;
  ip: string;
  ports: number[];
}

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim() ?? '';
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const csv = (value: string | undefined): string[] => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

function run(executable: string, args: string[], stdin?: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(executable, args, {
    input: stdin,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 128 * 1024,
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
  });
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr || String(result.error ?? '') };
}

function validateIp(value: string): void {
  if (!IPV4_PATTERN.test(value) || value.split('.').map(Number).some((part) => part < 0 || part > 255)) throw new Error('invalid sandbox IP');
}

function validateCidrs(values: string[]): void {
  if (values.some((value) => !CIDR_PATTERN.test(value))) throw new Error('invalid configured CIDR');
}

function validatePorts(ports: number[]): number[] {
  if (ports.length > 32 || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) throw new Error('invalid gateway ports');
  return [...new Set(ports)].toSorted((left, right) => left - right);
}

function readState(value: unknown): FirewallState | null {
  const row = asRecord(value);
  const portsValue: unknown = row?.ports;
  if (!row || typeof row.workspaceId !== 'string' || !WORKSPACE_PATTERN.test(row.workspaceId)
    || typeof row.ip !== 'string' || !Array.isArray(portsValue)
    || !portsValue.every((port): port is number => typeof port === 'number')) return null;
  validateIp(row.ip);
  return { workspaceId: row.workspaceId, ip: row.ip, ports: validatePorts([...portsValue]) };
}

function loadStates(stateDir: string): FirewallState[] {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const states: FirewallState[] = [];
  for (const file of readdirSync(stateDir).filter((name) => /^[a-f0-9]{24}\.json$/.test(name))) {
    const parsed = parseJson(readFileSync(path.join(stateDir, file), 'utf8'));
    const state = parsed.ok ? readState(parsed.value) : null;
    if (!state) throw new Error(`invalid persisted firewall state: ${file}`);
    states.push(state);
  }
  return states.toSorted((left, right) => left.workspaceId.localeCompare(right.workspaceId));
}

function renderNft(states: FirewallState[], network: string, agentPort: number, denies: string[]): string {
  const ips = states.map((state) => state.ip);
  const pairs = states.flatMap((state) => [agentPort, ...state.ports].map((port) => `${state.ip} . ${String(port)}`));
  const lines = [
    `add table inet ${TABLE}`,
    `add set inet ${TABLE} sandbox_ips { type ipv4_addr; }`,
    `add set inet ${TABLE} allowed_tcp { type ipv4_addr . inet_service; }`,
  ];
  if (ips.length > 0) lines.push(`add element inet ${TABLE} sandbox_ips { ${ips.join(', ')} }`);
  if (pairs.length > 0) lines.push(`add element inet ${TABLE} allowed_tcp { ${pairs.join(', ')} }`);
  lines.push(
    `add chain inet ${TABLE} input { type filter hook input priority -10; policy accept; }`,
    `add rule inet ${TABLE} input iifname ${JSON.stringify(network)} ip saddr @sandbox_ips udp dport 53 accept`,
    `add rule inet ${TABLE} input iifname ${JSON.stringify(network)} ip saddr @sandbox_ips tcp dport 53 accept`,
    `add rule inet ${TABLE} input iifname ${JSON.stringify(network)} ip saddr @sandbox_ips ct state established,related accept`,
    `add rule inet ${TABLE} input iifname ${JSON.stringify(network)} ip saddr @sandbox_ips drop`,
    `add chain inet ${TABLE} output { type filter hook output priority -10; policy accept; }`,
    `add rule inet ${TABLE} output oifname ${JSON.stringify(network)} ip daddr @sandbox_ips udp sport 53 accept`,
    `add rule inet ${TABLE} output oifname ${JSON.stringify(network)} ip daddr @sandbox_ips tcp sport 53 accept`,
    `add rule inet ${TABLE} output oifname ${JSON.stringify(network)} ip daddr . tcp dport @allowed_tcp accept`,
    `add rule inet ${TABLE} output oifname ${JSON.stringify(network)} ip daddr @sandbox_ips drop`,
    `add chain inet ${TABLE} forward { type filter hook forward priority -10; policy accept; }`,
  );
  for (const destination of denies) {
    lines.push(`add rule inet ${TABLE} forward iifname ${JSON.stringify(network)} ip saddr @sandbox_ips ip daddr ${destination} drop`);
  }
  lines.push(
    `add rule inet ${TABLE} forward iifname ${JSON.stringify(network)} ip saddr @sandbox_ips accept`,
    `add rule inet ${TABLE} forward oifname ${JSON.stringify(network)} ip daddr @sandbox_ips ct state established,related accept`,
    `add rule inet ${TABLE} forward oifname ${JSON.stringify(network)} ip daddr @sandbox_ips drop`,
    '',
  );
  return lines.join('\n');
}

export function reconcileIncusFirewall(env: NodeJS.ProcessEnv = process.env): void {
  const nft = required(env, 'NFT_BIN');
  const stateDir = required(env, 'INCUS_FIREWALL_STATE_DIR');
  const network = required(env, 'INCUS_NETWORK');
  if (!/^[a-zA-Z0-9_.-]{1,15}$/.test(network)) throw new Error('invalid Incus bridge name');
  const agentPort = Number(required(env, 'INCUS_AGENT_PORT'));
  if (!Number.isInteger(agentPort) || agentPort < 1 || agentPort > 65_535) throw new Error('invalid agent port');
  const denies = csv(env.INCUS_OUTBOUND_DENY_CIDRS ?? '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16');
  validateCidrs(denies);
  const existing = run(nft, ['list', 'table', 'inet', TABLE]);
  const script = `${existing.code === 0 ? `delete table inet ${TABLE}\n` : ''}${renderNft(loadStates(stateDir), network, agentPort, denies)}`;
  const applied = run(nft, ['-f', '-'], script);
  if (applied.code !== 0) throw new Error(`nftables update failed: ${applied.stderr}`);
}

export function applyIncusFirewall(input: IncusFirewallRequest, env: NodeJS.ProcessEnv = process.env): void {
  const workspaceId = input.workspaceId.toLowerCase();
  if (!WORKSPACE_PATTERN.test(workspaceId)) throw new Error('invalid workspace id');
  validateIp(input.ip);
  if (!Number.isInteger(input.agentPort) || input.agentPort < 1 || input.agentPort > 65_535) throw new Error('invalid agent port');
  const ports = validatePorts(input.ports);
  const stateDir = required(env, 'INCUS_FIREWALL_STATE_DIR');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(stateDir, `${workspaceId}.json`);
  if (input.operation === 'delete') {
    // eslint-disable-next-line luckystack/no-raw-try-catch -- idempotent deletion accepts only ENOENT
    try { unlinkSync(file); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  } else {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ workspaceId, ip: input.ip, ports })}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  }
  reconcileIncusFirewall(env);
}

function main(): void {
  const [operation, workspaceId = '', ip = '', agentPortRaw = '', portsRaw = ''] = process.argv.slice(2);
  if (operation !== 'apply' && operation !== 'delete') throw new Error('invalid operation');
  applyIncusFirewall({ operation, workspaceId, ip, agentPort: Number(agentPortRaw), ports: portsRaw ? portsRaw.split(',').map(Number) : [] });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  // eslint-disable-next-line luckystack/no-raw-try-catch -- root helper must emit one bounded stderr error without app dependencies
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Incus firewall helper failed');
    process.exitCode = 1;
  }
}
