export interface PublicRunnerResponse {
  ok: boolean;
  services: string[];
  env: Record<string, string>;
  error?: string;
}

export interface AgentComposeResponse extends PublicRunnerResponse {
  gatewayPorts: number[];
}

export interface ComposeUpRequest {
  workspaceId: string;
  project: string;
  compose: string;
}

export interface ComposeDownRequest {
  workspaceId: string;
  project: string;
}

export interface SandboxDescriptor {
  workspaceId: string;
  vmid: number;
  node: string;
  ip: string;
  agentUrl: URL;
}

export interface ManagedVm {
  workspaceId: string;
  vmid: number;
  node: string;
  status: string;
  name: string;
  lastUsedAt: Date | null;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
