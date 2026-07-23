import { readFileSync } from 'node:fs';

import { optionalBoolean, optionalInt, requiredString, splitCsv } from './runtime.js';

export type SandboxProviderKind = 'proxmox' | 'incus';

export interface ControllerConfig {
  provider: SandboxProviderKind;
  bindHost: string;
  port: number;
  bearerToken: string;
  guestTokenSecret: string;
  maxConcurrent: number;
  requestTimeoutMs: number;
  provisionTimeoutMs: number;
  idleGcHours: number;
  gcIntervalMs: number;
  incus: {
    binary: string;
    clientDir: string;
    remote: string;
    project: string;
    image: string;
    network: string;
    sandboxCidr: string;
    networkPrefix: number;
    gateway: string;
    cores: number;
    memoryMb: number;
    diskGb: number;
    agentPort: number;
    agentScheme: 'http';
    firewallSocket: string;
  };
  proxmox: {
    baseUrl: URL;
    apiTokenId: string;
    apiTokenSecret: string;
    ca: Buffer | undefined;
    node: string;
    pool: string;
    templateVmid: number;
    bridge: string;
    storage: string;
    sandboxCidr: string;
    gateway: string;
    dns: string;
    vmidMin: number;
    vmidMax: number;
    cores: number;
    memoryMb: number;
    diskGb: number;
    agentPort: number;
    agentScheme: 'http';
    controllerSourceCidrs: string[];
    appSourceCidrs: string[];
    outboundAllowCidrs: string[];
    outboundDenyCidrs: string[];
    sshUser: string;
    sshPrivateKeyFile: string;
    sshKnownHostsFile: string;
  };
}

export interface AgentConfig {
  bindHost: string;
  port: number;
  workspaceId: string;
  token: string;
  dataDir: string;
  dockerBin: string;
  operationTimeoutMs: number;
  gatewayHost: string;
}

const configuredString = (env: NodeJS.ProcessEnv, key: string, fallback: string): string => {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : fallback;
};

const requireHttpsUrl = (value: string, key: string): URL => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${key} must be a credential-free HTTPS origin without query or fragment`);
  }
  return url;
};

export function readControllerConfig(env: NodeJS.ProcessEnv = process.env): ControllerConfig {
  const providerValue = configuredString(env, 'RUNNER_PROVIDER', 'proxmox');
  if (providerValue !== 'proxmox' && providerValue !== 'incus') throw new Error('RUNNER_PROVIDER must be proxmox or incus');
  const provider: SandboxProviderKind = providerValue;
  const caFile = provider === 'proxmox' ? env.PVE_CA_FILE?.trim() : undefined;
  const pveString = (key: string, fallback: string): string => provider === 'proxmox'
    ? requiredString(env, key)
    : configuredString(env, key, fallback);
  return {
    provider,
    bindHost: configuredString(env, 'RUNNER_BIND_HOST', '127.0.0.1'),
    port: optionalInt(env, 'RUNNER_PORT', 8787, 1, 65_535),
    bearerToken: requiredString(env, 'RUNNER_BEARER_TOKEN'),
    guestTokenSecret: requiredString(env, 'RUNNER_GUEST_TOKEN_SECRET'),
    maxConcurrent: optionalInt(env, 'RUNNER_MAX_CONCURRENT', 8, 1, 128),
    requestTimeoutMs: optionalInt(env, 'RUNNER_REQUEST_TIMEOUT_MS', 120_000, 5000, 900_000),
    provisionTimeoutMs: optionalInt(env, 'RUNNER_PROVISION_TIMEOUT_MS', 600_000, 30_000, 3_600_000),
    idleGcHours: optionalInt(env, 'RUNNER_IDLE_GC_HOURS', 24, 1, 8760),
    gcIntervalMs: optionalInt(env, 'RUNNER_GC_INTERVAL_MS', 900_000, 60_000, 86_400_000),
    incus: {
      binary: configuredString(env, 'INCUS_BIN', '/usr/bin/incus'),
      clientDir: configuredString(env, 'INCUS_CLIENT_DIR', '/var/lib/workspaces-compose-runner'),
      remote: configuredString(env, 'INCUS_REMOTE', 'workspaces'),
      project: configuredString(env, 'INCUS_PROJECT', 'workspaces-sandboxes'),
      image: configuredString(env, 'INCUS_IMAGE', 'workspaces-compose-golden'),
      network: configuredString(env, 'INCUS_NETWORK', 'workspaces0'),
      sandboxCidr: configuredString(env, 'INCUS_SANDBOX_CIDR', '10.78.0.0/17'),
      networkPrefix: optionalInt(env, 'INCUS_NETWORK_PREFIX', 16, 8, 30),
      gateway: configuredString(env, 'INCUS_SANDBOX_GATEWAY', '10.78.0.1'),
      cores: optionalInt(env, 'INCUS_VM_CORES', 2, 1, 128),
      memoryMb: optionalInt(env, 'INCUS_VM_MEMORY_MB', 3072, 512, 1_048_576),
      diskGb: optionalInt(env, 'INCUS_VM_DISK_GB', 40, 8, 16_384),
      agentPort: optionalInt(env, 'INCUS_AGENT_PORT', 8788, 1, 65_535),
      agentScheme: 'http',
      firewallSocket: configuredString(env, 'INCUS_FIREWALL_SOCKET', '/run/workspaces-compose-runner/firewall.sock'),
    },
    proxmox: {
      baseUrl: requireHttpsUrl(pveString('PVE_BASE_URL', 'https://127.0.0.1:8006'), 'PVE_BASE_URL'),
      apiTokenId: pveString('PVE_API_TOKEN_ID', 'unused'),
      apiTokenSecret: pveString('PVE_API_TOKEN_SECRET', 'unused'),
      ca: caFile ? readFileSync(caFile) : undefined,
      node: pveString('PVE_NODE', 'unused'),
      pool: configuredString(env, 'PVE_POOL', 'workspaces-sandboxes'),
      templateVmid: optionalInt(env, 'PVE_TEMPLATE_VMID', 9000, 100, 999_999_999),
      bridge: configuredString(env, 'PVE_SANDBOX_BRIDGE', 'vmbr1'),
      storage: configuredString(env, 'PVE_STORAGE', 'local-lvm'),
      sandboxCidr: configuredString(env, 'PVE_SANDBOX_CIDR', '10.77.0.0/16'),
      gateway: configuredString(env, 'PVE_SANDBOX_GATEWAY', '10.77.0.1'),
      dns: configuredString(env, 'PVE_SANDBOX_DNS', '1.1.1.1'),
      vmidMin: optionalInt(env, 'PVE_VMID_MIN', 20_000, 100, 999_999_999),
      vmidMax: optionalInt(env, 'PVE_VMID_MAX', 29_999, 100, 999_999_999),
      cores: optionalInt(env, 'PVE_VM_CORES', 2, 1, 128),
      memoryMb: optionalInt(env, 'PVE_VM_MEMORY_MB', 4096, 512, 1_048_576),
      diskGb: optionalInt(env, 'PVE_VM_DISK_GB', 40, 8, 16_384),
      agentPort: optionalInt(env, 'PVE_AGENT_PORT', 8788, 1, 65_535),
      agentScheme: 'http',
      controllerSourceCidrs: splitCsv(pveString('PVE_CONTROLLER_SOURCE_CIDRS', '127.0.0.1/32')),
      appSourceCidrs: splitCsv(env.PVE_APP_SOURCE_CIDRS),
      outboundAllowCidrs: splitCsv(env.PVE_OUTBOUND_ALLOW_CIDRS),
      outboundDenyCidrs: splitCsv(configuredString(env, 'PVE_OUTBOUND_DENY_CIDRS', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16')),
      sshUser: configuredString(env, 'PVE_SSH_USER', 'workspaces'),
      sshPrivateKeyFile: pveString('PVE_SSH_PRIVATE_KEY_FILE', '/dev/null'),
      sshKnownHostsFile: configuredString(env, 'PVE_SSH_KNOWN_HOSTS_FILE', '/var/lib/workspaces-compose-runner/known_hosts'),
    },
  };
}

export function readAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    bindHost: configuredString(env, 'AGENT_BIND_HOST', '0.0.0.0'),
    port: optionalInt(env, 'AGENT_PORT', 8788, 1, 65_535),
    workspaceId: requiredString(env, 'AGENT_WORKSPACE_ID').toLowerCase(),
    token: requiredString(env, 'AGENT_BEARER_TOKEN'),
    dataDir: configuredString(env, 'AGENT_DATA_DIR', '/var/lib/workspaces-compose-agent'),
    dockerBin: configuredString(env, 'AGENT_DOCKER_BIN', 'docker'),
    operationTimeoutMs: optionalInt(env, 'AGENT_OPERATION_TIMEOUT_MS', 300_000, 5000, 1_800_000),
    gatewayHost: requiredString(env, 'AGENT_GATEWAY_HOST'),
  };
}

export const shouldDestroyOnLastDown = (env: NodeJS.ProcessEnv = process.env): boolean => optionalBoolean(env, 'RUNNER_DESTROY_ON_LAST_DOWN', false);
