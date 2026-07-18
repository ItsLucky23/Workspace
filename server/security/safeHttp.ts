//? DNS-pinned HTTP(S) transport for untrusted outbound URLs. Redirects are followed manually and every
//? hop is independently resolved + validated. The socket connects directly to the selected validated IP,
//? while Host and TLS SNI retain the original hostname. Total time, request bytes, response bytes and
//? redirect count are bounded; unsafe redirect replays are refused and cross-origin safe reads lose credentials.

import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type RequestOptions as HttpRequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { tryCatch, tryCatchSync } from '@luckystack/core';

import {
  defaultOutboundResolver,
  resolveOutboundTarget,
  type OutboundErrorCode,
  type OutboundResolver,
} from './outboundUrl';

export type SafeHttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface PinnedHttpRequest {
  url: URL;
  method: SafeHttpMethod;
  headers: Record<string, string>;
  body?: Buffer;
  connectAddress: string;
  connectFamily: 4 | 6;
  hostHeader: string;
  servername?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  signal: AbortSignal;
}

export interface HttpTransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export type OutboundTransport = (request: PinnedHttpRequest) => Promise<HttpTransportResponse>;

export interface SafeHttpDependencies {
  resolver?: OutboundResolver;
  transport?: OutboundTransport;
}

export interface SafeHttpOptions extends SafeHttpDependencies {
  method?: SafeHttpMethod;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxRedirects?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  allowInsecureHttp?: boolean;
}

export interface SafeHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  url: string;
  redirects: number;
}

export interface SafeHttpFailure {
  code: SafeHttpErrorCode;
  message: string;
}

export type SafeHttpResult =
  | { ok: true; response: SafeHttpResponse }
  | { ok: false; error: SafeHttpFailure };

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 4;
const DEFAULT_MAX_REQUEST_BYTES = 1_000_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

class SafeHttpError extends Error {
  readonly code: OutboundErrorCode | 'request-too-large' | 'response-too-large' | 'too-many-redirects' | 'invalid-redirect' | 'https-downgrade-redirect' | 'cross-origin-redirect-not-allowed' | 'transport-failed';

  constructor(code: SafeHttpError['code'], message: string) {
    super(message);
    this.name = 'SafeHttpError';
    this.code = code;
  }
}

export type SafeHttpErrorCode = SafeHttpError['code'];

function failed(code: SafeHttpErrorCode, message: string): SafeHttpResult {
  return { ok: false, error: { code, message } };
}

function normalizeHeaders(input: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input)) {
    const name = rawName.trim().toLowerCase();
    if (name.length === 0 || name === 'host' || name === 'content-length' || HOP_BY_HOP_HEADERS.has(name)) continue;
    headers[name] = value;
  }
  return headers;
}

function requestHeaders(base: Record<string, string>, url: URL, body: Buffer | undefined): Record<string, string> {
  const headers: Record<string, string> = { ...base, host: url.host };
  if (body !== undefined) headers['content-length'] = String(body.byteLength);
  return headers;
}

function isSensitiveHeader(name: string): boolean {
  return name === 'authorization'
    || name === 'proxy-authorization'
    || name === 'cookie'
    || name.includes('token')
    || name.includes('secret')
    || name.includes('api-key')
    || name.includes('apikey');
}

function hasSensitiveHeaders(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => isSensitiveHeader(name));
}

function stripCrossOriginCredentials(headers: Record<string, string>): Record<string, string> {
  const stripped: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (!isSensitiveHeader(name)) stripped[name] = value;
  return stripped;
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function transportError(error: Error): SafeHttpResult {
  if (error instanceof SafeHttpError) return failed(error.code, error.message);
  return failed('transport-failed', error.message || 'Outbound transport failed');
}

function normalizedTimeout(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? DEFAULT_TIMEOUT_MS));
}

function normalizedCap(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.floor(value ?? fallback));
}

function responseHeaders(headers: IncomingHttpHeaders): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers)) result[name.toLowerCase()] = value;
  return result;
}

//? Default transport: connect to the validated IP directly (no second DNS lookup), but retain the URL host
//? in Host and, for HTTPS hostnames, in SNI/certificate verification. agent:false prevents socket reuse from
//? weakening the per-request pin.
export const defaultOutboundTransport: OutboundTransport = (pinned) => new Promise<HttpTransportResponse>((resolve, reject) => {
  const common: HttpRequestOptions = {
    protocol: pinned.url.protocol,
    hostname: pinned.connectAddress,
    family: pinned.connectFamily,
    port: pinned.url.protocol === 'https:' ? 443 : 80,
    method: pinned.method,
    path: `${pinned.url.pathname}${pinned.url.search}`,
    headers: pinned.headers,
    agent: false,
  };

  const req: ClientRequest = pinned.url.protocol === 'https:'
    ? httpsRequest({
        ...common,
        rejectUnauthorized: true,
        ...(pinned.servername === undefined ? {} : { servername: pinned.servername }),
      })
    : httpRequest(common);

  let settled = false;
  const cleanup = (): void => { pinned.signal.removeEventListener('abort', abortRequest); };
  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  const succeed = (response: HttpTransportResponse): void => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(response);
  };
  const abortRequest = (): void => {
    const error = new SafeHttpError('timeout', 'Outbound request timed out');
    const socket = req.socket;
    fail(error);
    req.destroy(error);
    socket?.destroy();
  };

  pinned.signal.addEventListener('abort', abortRequest, { once: true });
  if (pinned.signal.aborted) {
    abortRequest();
    return;
  }

  req.on('response', (res) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    res.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.byteLength;
      if (bytes > pinned.maxResponseBytes) {
        fail(new SafeHttpError('response-too-large', 'Outbound response exceeded the byte cap'));
        res.destroy();
        return;
      }
      chunks.push(chunk);
    });
    res.on('aborted', () => { fail(new SafeHttpError('transport-failed', 'Outbound response was aborted')); });
    res.on('error', (error) => { fail(error); });
    res.on('end', () => {
      succeed({ status: res.statusCode ?? 0, headers: responseHeaders(res.headers), body: Buffer.concat(chunks, bytes) });
    });
  });
  req.on('error', (error) => { fail(error); });
  req.setTimeout(pinned.timeoutMs, () => {
    const error = new SafeHttpError('timeout', 'Outbound request timed out');
    const socket = req.socket;
    fail(error);
    req.destroy(error);
    socket?.destroy();
  });
  if (pinned.body !== undefined) req.write(pinned.body);
  req.end();
});

async function runTransport(transport: OutboundTransport, request: PinnedHttpRequest): Promise<{ response: HttpTransportResponse | null; error: Error | null }> {
  if (request.signal.aborted) return { response: null, error: new SafeHttpError('timeout', 'Outbound request timed out') };
  const abortListener = new AbortController();
  const aborted = new Promise<HttpTransportResponse>((_, reject) => {
    request.signal.addEventListener('abort', () => {
      reject(new SafeHttpError('timeout', 'Outbound request timed out'));
    }, { once: true, signal: abortListener.signal });
  });
  const [error, response] = await tryCatch(() => Promise.race([transport(request), aborted]));
  abortListener.abort();
  return { response, error };
}

//? Safe request entry point. `resolver` and `transport` are injectable for deterministic security tests;
//? production defaults are all-address DNS resolution + the direct-IP Node HTTP(S) transport above.
export async function safeHttpRequest(rawUrl: string, options: SafeHttpOptions = {}): Promise<SafeHttpResult> {
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const maxRedirects = normalizedCap(options.maxRedirects, DEFAULT_MAX_REDIRECTS);
  const maxRequestBytes = normalizedCap(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES);
  const maxResponseBytes = normalizedCap(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
  const resolver = options.resolver ?? defaultOutboundResolver;
  const transport = options.transport ?? defaultOutboundTransport;
  const controller = new AbortController();
  const startedAt = performance.now();
  const totalTimeout = setTimeout(() => { controller.abort(); }, timeoutMs);
  let method = options.method ?? 'GET';
  let body = options.body === undefined ? undefined : (typeof options.body === 'string' ? Buffer.from(options.body) : Buffer.from(options.body));
  let headers = normalizeHeaders(options.headers ?? {});
  let currentUrl = rawUrl;
  let redirects = 0;
  let remainingResponseBytes = maxResponseBytes;

  const execute = async (): Promise<SafeHttpResult> => {
    if (body !== undefined && body.byteLength > maxRequestBytes) return failed('request-too-large', 'Outbound request body exceeded the byte cap');

    for (;;) {
      const remaining = Math.floor(timeoutMs - (performance.now() - startedAt));
      if (controller.signal.aborted || remaining <= 0) return failed('timeout', 'Outbound request timed out');
      const allowInsecureHttp = options.allowInsecureHttp === true
        && (method === 'GET' || method === 'HEAD')
        && body === undefined
        && !hasSensitiveHeaders(headers);
      const targetResult = await resolveOutboundTarget(currentUrl, resolver, remaining, { allowInsecureHttp });
      if (!targetResult.ok) return { ok: false, error: targetResult.error };
      const { target } = targetResult;
      const servername = target.hostname === target.pinnedAddress.address ? undefined : target.hostname;
      const pinnedRequest: PinnedHttpRequest = {
        url: target.url,
        method,
        headers: requestHeaders(headers, target.url, body),
        ...(body === undefined ? {} : { body }),
        connectAddress: target.pinnedAddress.address,
        connectFamily: target.pinnedAddress.family,
        hostHeader: target.url.host,
        ...(servername === undefined ? {} : { servername }),
        timeoutMs: remaining,
        maxResponseBytes: remainingResponseBytes,
        signal: controller.signal,
      };

      const transported = await runTransport(transport, pinnedRequest);
      if (transported.error) return transportError(transported.error);
      if (!transported.response) return failed('transport-failed', 'Outbound transport returned no response');
      if (transported.response.body.byteLength > remainingResponseBytes) return failed('response-too-large', 'Outbound response exceeded the byte cap');
      remainingResponseBytes -= transported.response.body.byteLength;

      const location = headerValue(transported.response.headers, 'location');
      if (!REDIRECT_STATUSES.has(transported.response.status) || location === null) {
        return {
          ok: true,
          response: {
            status: transported.response.status,
            headers: transported.response.headers,
            body: transported.response.body,
            url: target.url.toString(),
            redirects,
          },
        };
      }

      if (redirects >= maxRedirects) return failed('too-many-redirects', 'Outbound redirect limit exceeded');
      const [redirectError, nextUrl] = tryCatchSync(() => new URL(location, target.url));
      if (redirectError || !nextUrl) return failed('invalid-redirect', 'Outbound response contained an invalid redirect');
      if (target.url.protocol === 'https:' && nextUrl.protocol === 'http:') return failed('https-downgrade-redirect', 'HTTPS redirects to HTTP are not allowed');
      const crossOrigin = target.url.origin !== nextUrl.origin;
      if (crossOrigin && (body !== undefined || (method !== 'GET' && method !== 'HEAD'))) {
        return failed('cross-origin-redirect-not-allowed', 'Cross-origin redirects cannot replay a body or non-GET/HEAD method');
      }
      if (crossOrigin) headers = stripCrossOriginCredentials(headers);
      if (transported.response.status === 303 || ((transported.response.status === 301 || transported.response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        delete headers['content-type'];
        delete headers['content-encoding'];
      }
      currentUrl = nextUrl.toString();
      redirects += 1;
    }
  };

  const result = await execute();
  clearTimeout(totalTimeout);
  return result;
}

export type { OutboundResolver, ResolvedAddress } from './outboundUrl';
