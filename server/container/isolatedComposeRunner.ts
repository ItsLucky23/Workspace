//? Full-freedom Docker Compose execution boundary. Arbitrary Compose can request privileged mode, host binds,
//? external networks and Docker sockets; no in-process sanitizer can make that safe on the application daemon.
//? Production therefore sends it only to an operator-provisioned, dedicated per-workspace sandbox endpoint
//? (VM/microVM/physical worker). Taking over that sandbox is allowed; crossing into the app host or another
//? workspace is not. The URL is root configuration, never user input, and MUST vary by {workspaceId}.

import { tryCatch, tryCatchSync } from '@luckystack/core';

const MAX_COMPOSE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const WORKSPACE_ID = /^[a-fA-F0-9]{24}$/;

export interface IsolatedComposeResponse {
  ok: boolean;
  services: string[];
  env: Record<string, string>;
  error?: string;
}

export interface IsolatedComposeRunner {
  up: (input: { workspaceId: string; project: string; compose: string }) => Promise<IsolatedComposeResponse>;
  down: (input: { workspaceId: string; project: string }) => Promise<IsolatedComposeResponse>;
}

export interface IsolatedComposeRunnerConfig {
  urlTemplate: string;
  token: string;
  timeoutMs?: number;
}

export function isolatedComposeRunnerConfig(env: NodeJS.ProcessEnv = process.env): IsolatedComposeRunnerConfig | null {
  const urlTemplate = (env.WS_COMPOSE_RUNNER_URL_TEMPLATE ?? '').trim();
  const token = (env.WS_COMPOSE_RUNNER_TOKEN ?? '').trim();
  if (!urlTemplate || !token || !urlTemplate.includes('{workspaceId}')) return null;
  const requestedTimeout = Number(env.WS_COMPOSE_RUNNER_TIMEOUT_MS ?? '600000');
  const timeoutMs = Number.isInteger(requestedTimeout) && requestedTimeout >= 5000 && requestedTimeout <= 1_800_000
    ? requestedTimeout
    : 600_000;
  return { urlTemplate, token, timeoutMs };
}

export function resolveIsolatedComposeRunnerUrl(template: string, workspaceId: string, action: 'up' | 'down'): URL | null {
  if (!WORKSPACE_ID.test(workspaceId) || !template.includes('{workspaceId}')) return null;
  const rendered = template.replaceAll('{workspaceId}', workspaceId.toLowerCase());
  const [urlError, base] = tryCatchSync(() => new URL(rendered.endsWith('/') ? rendered : `${rendered}/`));
  if (urlError || !base) return null;
  //? Credentials in URLs leak through process/error tooling. TLS is mandatory because the bearer token is
  //? host authority over the dedicated sandbox. Query/hash are not part of an operator endpoint identity.
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return null;
  return new URL(`v1/compose/${action}`, base);
}

function readStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) && typeof item === 'string' && item.length <= 8192) result[key] = item;
  }
  return result;
}

function readResponse(value: unknown, httpOk: boolean): IsolatedComposeResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, services: [], env: {}, error: 'runner.invalidResponse' };
  const row = value as Record<string, unknown>;
  const services = Array.isArray(row.services)
    ? row.services.filter((item): item is string => typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item)).slice(0, 256)
    : [];
  const error = typeof row.error === 'string' ? row.error.slice(0, 500) : undefined;
  return { ok: httpOk && row.ok === true, services, env: readStringRecord(row.env), ...(error ? { error } : {}) };
}

export function createIsolatedComposeRunner(
  config: IsolatedComposeRunnerConfig,
  transport: typeof fetch = fetch,
): IsolatedComposeRunner {
  const request = async (action: 'up' | 'down', input: { workspaceId: string; project: string; compose?: string }): Promise<IsolatedComposeResponse> => {
    const url = resolveIsolatedComposeRunnerUrl(config.urlTemplate, input.workspaceId, action);
    if (!url) return { ok: false, services: [], env: {}, error: 'runner.invalidConfiguration' };
    if (input.compose !== undefined && Buffer.byteLength(input.compose, 'utf8') > MAX_COMPOSE_BYTES) return { ok: false, services: [], env: {}, error: 'compose.tooLarge' };
    const [transportError, response] = await tryCatch(() => transport(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: input.workspaceId, project: input.project, ...(input.compose === undefined ? {} : { compose: input.compose }) }),
      //? A cold full-clone VM provision legitimately takes minutes. The Conductor job is durable; this timeout
      //? bounds one attempt without cutting the controller off at the old 60-second in-process Docker budget.
      signal: AbortSignal.timeout(config.timeoutMs ?? 600_000),
    }));
    if (transportError || !response) return { ok: false, services: [], env: {}, error: 'runner.unavailable' };
    const announcedLength = Number(response.headers.get('content-length') ?? '0');
    if (announcedLength > MAX_RESPONSE_BYTES) return { ok: false, services: [], env: {}, error: 'runner.responseTooLarge' };
    const [bodyError, text] = await tryCatch(() => response.text());
    if (bodyError || text === null) return { ok: false, services: [], env: {}, error: 'runner.invalidResponse' };
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return { ok: false, services: [], env: {}, error: 'runner.responseTooLarge' };
    const [parseError, parsed] = tryCatchSync((): unknown => JSON.parse(text));
    if (parseError) return { ok: false, services: [], env: {}, error: 'runner.invalidResponse' };
    return readResponse(parsed, response.ok);
  };

  return {
    up: (input) => request('up', input),
    down: (input) => request('down', input),
  };
}
