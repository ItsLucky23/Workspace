//? "Does this integration actually work?" — answered by connecting, not by looking at the config.
//?
//? The owner asked for a ping "waar mogelijk". That qualifier is the whole design: this file NEVER
//? reports more than it verified. A green tick that only means "the string parses" is worse than no
//? button at all, because it moves the discovery of a broken integration from this page to the middle
//? of a pipeline run.
//?
//? So there are three degrees of success, and they are different words in the UI:
//?
//?   ok         — we spoke the protocol and the credentials were accepted.
//?   reachable  — the host resolves and the port accepts a TCP connection; credentials NOT verified.
//?   unsupported— there is nothing here we can check without guessing.
//?
//? `reachable` is not a consolation prize. Wrong host, wrong port, typo, firewall and "the container
//? isn't running" are the overwhelming majority of broken integrations, and a TCP dial catches every
//? one of them. What it cannot catch is a wrong password — so it does not say it did.
//?
//? Why not a real driver for every type: `ioredis` is a dependency of this project, so Redis gets a real
//? authenticated PING. Mongo, Postgres, MySQL, Kafka and AMQP would each need a client library added for
//? the sake of a settings-page button. That trade is the owner's to make, not this file's; until then
//? they get an honest TCP dial. Adding one later is a per-type `probe` function and nothing else.
//? @adr 0320

import { connect, type Socket } from 'node:net';

import { tryCatch } from '@luckystack/core';
import Redis from 'ioredis';

import type { IntegrationTestStatus } from '../../src/workspaces/_data/types';

//? Shared with the client rather than redeclared: the four words ARE the contract between this file,
//? the snapshot and the chip in the settings table, and two copies would drift.
export type ProbeStatus = IntegrationTestStatus;

export interface ProbeResult {
  status: ProbeStatus;
  /** One short line for the UI. Never contains the credential itself. */
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 6000;

//? The port to dial when a connection string omits one. Getting this wrong would report `failed` for a
//? perfectly good integration, so every entry is the protocol's registered default.
const DEFAULT_PORT: Record<string, number> = {
  mongodb: 27_017,
  postgres: 5432,
  mysql: 3306,
  redis: 6379,
  kafka: 9092,
  rabbitmq: 5672,
};

/** Strip a credential out of anything we are about to show the user or write to an audit row. */
export function redact(text: string): string {
  //? `scheme://user:pass@host` — the password is the part that must never survive into a UI string.
  return text.replaceAll(/(\w+:\/\/)[^@/\s]*@/g, '$1***@');
}

/**
 * Best-effort host+port for a connection string. Handles a full URL (`mongodb://u:p@host:27017/db`),
 * a bare `host:port`, a comma-separated broker list (Kafka), and a bare hostname.
 * Exported for tests — the parsing is where a wrong answer would be most embarrassing.
 */
export function hostPort(raw: string, type: string): { host: string; port: number } | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  //? A broker list is N of the same thing; the first one answers "can I reach the cluster at all".
  const first = value.split(',')[0]?.trim() ?? '';
  if (first.length === 0) return null;

  //? `canParse` rather than a try/catch around `new URL` — the codebase bans raw try/catch, and
  //? `tryCatch` is async-only, so wrapping a synchronous parse in a promise just to satisfy it would be
  //? the worse trade. This asks the same question without throwing.
  if (URL.canParse(first)) {
    const url = new URL(first);
    if (url.hostname.length > 0) {
      const port = url.port.length > 0 ? Number(url.port) : (DEFAULT_PORT[type] ?? (url.protocol === 'http:' ? 80 : 443));
      return Number.isFinite(port) ? { host: url.hostname, port } : null;
    }
  }

  //? Not a URL: `host:port`, or a bare host that takes the type's default port. An IPv6 literal is
  //? deliberately not handled — it would need bracket parsing, and reporting `unsupported` for one is
  //? honest, where guessing wrong would report `failed` for something that works.
  const match = /^\[?([\w.-]+)\]?(?::(\d+))?$/.exec(first);
  if (!match?.[1]) return null;
  const port = match[2] ? Number(match[2]) : DEFAULT_PORT[type];
  return typeof port === 'number' && Number.isFinite(port) ? { host: match[1], port } : null;
}


/** Open a TCP connection and close it again. Proves reachability, nothing about credentials. */
export async function tcpReachable(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  return await new Promise((resolve) => {
    let socket: Socket | null = null;
    let settled = false;
    const finish = (ok: boolean, detail: string): void => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve({ ok, detail });
    };
    const timer = setTimeout(() => { finish(false, `no answer from ${host}:${String(port)} within ${String(Math.round(timeoutMs / 1000))}s`); }, timeoutMs);
    socket = connect({ host, port }, () => { clearTimeout(timer); finish(true, `${host}:${String(port)} accepted a connection`); });
    socket.on('error', (error: Error) => { clearTimeout(timer); finish(false, `${host}:${String(port)} — ${error.message}`); });
  });
}

/** Redis speaks a real authenticated PING, because `ioredis` is already a dependency here. */
async function probeRedis(url: string, timeoutMs: number): Promise<ProbeResult> {
  //? `retryStrategy: null` matters more than it looks: ioredis reconnects forever by default, so a
  //? wrong host would leave a socket looping in the background of the server after the user navigated
  //? away — a settings-page click must not outlive itself.
  const client = new Redis(url, {
    lazyConnect: true, connectTimeout: timeoutMs, commandTimeout: timeoutMs,
    maxRetriesPerRequest: 0, retryStrategy: () => null, enableOfflineQueue: false,
  });
  const [error, reply] = await tryCatch(async () => {
    await client.connect();
    return await client.ping();
  });
  client.disconnect();
  if (error) return { status: 'failed', detail: redact(error.message) };
  return reply === 'PONG'
    ? { status: 'ok', detail: 'PING answered PONG' }
    : { status: 'reachable', detail: `connected, but PING answered ${String(reply)}` };
}

/** An HTTP-shaped backend: the status code says whether the credentials were accepted. */
async function probeHttp(baseUrl: string, authHeader: string, timeoutMs: number): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  const [error, res] = await tryCatch(async () => await fetch(baseUrl, {
    method: 'GET',
    ...(authHeader.length > 0 ? { headers: { Authorization: authHeader } } : {}),
    signal: controller.signal,
  }));
  clearTimeout(timer);
  if (error || !res) return { status: 'failed', detail: redact(error?.message ?? 'no response') };
  //? 401/403 is the one case where a response is a FAILURE: the host is fine and the credential is not,
  //? which is exactly the thing a "reachable" verdict would hide.
  if (res.status === 401 || res.status === 403) return { status: 'failed', detail: `${String(res.status)} — credentials rejected` };
  if (res.ok || (res.status >= 300 && res.status < 400)) return { status: 'ok', detail: `HTTP ${String(res.status)}` };
  return { status: 'reachable', detail: `answered HTTP ${String(res.status)} — the host is up, the request was not accepted` };
}

/**
 * Test one configured integration. `values` are the RESOLVED field values in the type's field order
 * (already decrypted by the caller); an unmapped or empty field arrives as ''.
 */
export async function probeIntegration(type: string, values: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProbeResult> {
  const primary = (values[0] ?? '').trim();
  if (primary.length === 0) {
    return { status: 'unsupported', detail: 'nothing to test — this integration has no value configured for its first field' };
  }

  if (type === 'redis') return await probeRedis(primary, timeoutMs);
  if (type === 'http') return await probeHttp(primary, (values[1] ?? '').trim(), timeoutMs);
  //? Elasticsearch answers cluster info on `GET /`, so the HTTP probe is the real thing here, not a
  //? fallback. Its auth header, when present, rides in the same field position as the HTTP type's.
  if (type === 'elasticsearch') return await probeHttp(primary, (values[1] ?? '').trim(), timeoutMs);

  const target = hostPort(primary, type);
  if (!target) {
    return { status: 'unsupported', detail: 'could not read a host and port out of this value, so there is nothing to dial' };
  }
  const { ok, detail } = await tcpReachable(target.host, target.port, timeoutMs);
  if (!ok) return { status: 'failed', detail: redact(detail) };
  //? Deliberately NOT 'ok': a TCP handshake says the port is open, and says nothing at all about
  //? whether the username and password would be accepted.
  return { status: 'reachable', detail: redact(detail) };
}
