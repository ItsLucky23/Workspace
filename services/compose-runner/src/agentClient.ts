import { asRecord, parseJson, safeEqual } from './runtime.js';
import type { AgentComposeResponse, ComposeDownRequest, ComposeUpRequest, Result, SandboxDescriptor } from './types.js';

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function readComposeResponse(value: unknown): AgentComposeResponse | null {
  const row = asRecord(value);
  if (!row || typeof row.ok !== 'boolean') return null;
  const services = Array.isArray(row.services)
    ? row.services.filter((item): item is string => typeof item === 'string' && SERVICE_NAME.test(item)).slice(0, 256)
    : [];
  const envRecord = asRecord(row.env);
  const env = envRecord
    ? Object.fromEntries(Object.entries(envRecord).filter((entry): entry is [string, string] => ENV_KEY.test(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= 8192))
    : {};
  const gatewayPorts = Array.isArray(row.gatewayPorts)
    ? row.gatewayPorts.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 65_535).slice(0, 32)
    : [];
  const error = typeof row.error === 'string' ? row.error.slice(0, 500) : undefined;
  return { ok: row.ok, services, env, gatewayPorts, ...(error ? { error } : {}) };
}

export class AgentClient {
  constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = 300_000,
  ) {}

  async health(sandbox: SandboxDescriptor, token: string): Promise<boolean> {
    const url = new URL('/healthz', sandbox.agentUrl);
    const response = await this.transport(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, 10_000)),
    }).catch(() => null);
    if (!response?.ok) return false;
    const body = await response.text().catch(() => '');
    const parsed = parseJson(body);
    const row = parsed.ok ? asRecord(parsed.value) : null;
    return row?.status === 'ready' && row.workspaceId === sandbox.workspaceId;
  }

  async up(sandbox: SandboxDescriptor, token: string, input: ComposeUpRequest): Promise<Result<AgentComposeResponse>> {
    return this.composeRequest(sandbox, token, 'up', input);
  }

  async down(sandbox: SandboxDescriptor, token: string, input: ComposeDownRequest): Promise<Result<AgentComposeResponse>> {
    return this.composeRequest(sandbox, token, 'down', input);
  }

  async activeProjects(sandbox: SandboxDescriptor, token: string): Promise<Result<string[]>> {
    const response = await this.transport(new URL('/v1/status', sandbox.agentUrl), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, 15_000)),
    }).catch(() => null);
    if (!response?.ok) return { ok: false, error: 'agent.unavailable' };
    const text = await response.text().catch(() => '');
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024) return { ok: false, error: 'agent.responseTooLarge' };
    const parsed = parseJson(text);
    const row = parsed.ok ? asRecord(parsed.value) : null;
    const projects = Array.isArray(row?.activeProjects)
      ? row.activeProjects.filter((item): item is string => typeof item === 'string').slice(0, 512)
      : null;
    return projects ? { ok: true, value: projects } : { ok: false, error: 'agent.invalidResponse' };
  }

  private async composeRequest(
    sandbox: SandboxDescriptor,
    token: string,
    action: 'up' | 'down',
    input: ComposeUpRequest | ComposeDownRequest,
  ): Promise<Result<AgentComposeResponse>> {
    if (!safeEqual(input.workspaceId.toLowerCase(), sandbox.workspaceId)) return { ok: false, error: 'workspace.mismatch' };
    const response = await this.transport(new URL(`/v1/compose/${action}`, sandbox.agentUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(() => null);
    if (!response) return { ok: false, error: 'agent.unavailable' };
    const announced = Number(response.headers.get('content-length') ?? '0');
    if (announced > 64 * 1024) return { ok: false, error: 'agent.responseTooLarge' };
    const text = await response.text().catch(() => '');
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024) return { ok: false, error: 'agent.responseTooLarge' };
    const parsed = parseJson(text);
    const result = parsed.ok ? readComposeResponse(parsed.value) : null;
    if (!result) return { ok: false, error: 'agent.invalidResponse' };
    return response.ok && result.ok ? { ok: true, value: result } : { ok: false, error: result.error ?? `agent.http.${String(response.status)}` };
  }
}
