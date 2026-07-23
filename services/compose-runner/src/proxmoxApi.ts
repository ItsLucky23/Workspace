import https from 'node:https';

import { asRecord, parseJson } from './runtime.js';
import type { Result } from './types.js';

export interface ProxmoxApiConfig {
  baseUrl: URL;
  apiTokenId: string;
  apiTokenSecret: string;
  ca: Buffer | undefined;
}

type Parameters = Record<string, string | number | boolean>;

const encodeParameters = (parameters: Parameters): string => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) body.set(key, String(value));
  return body.toString();
};

export class ProxmoxApi {
  constructor(private readonly config: ProxmoxApiConfig) {}

  async get(pathname: string, parameters: Parameters = {}): Promise<Result<unknown>> {
    return this.request('GET', pathname, parameters);
  }

  async post(pathname: string, parameters: Parameters = {}): Promise<Result<unknown>> {
    return this.request('POST', pathname, parameters);
  }

  async put(pathname: string, parameters: Parameters = {}): Promise<Result<unknown>> {
    return this.request('PUT', pathname, parameters);
  }

  async delete(pathname: string, parameters: Parameters = {}): Promise<Result<unknown>> {
    return this.request('DELETE', pathname, parameters);
  }

  private async request(method: string, pathname: string, parameters: Parameters): Promise<Result<unknown>> {
    const basePath = this.config.baseUrl.pathname.replace(/\/$/, '');
    const url = new URL(`${basePath}/api2/json/${pathname.replace(/^\//, '')}`, this.config.baseUrl.origin);
    const encoded = encodeParameters(parameters);
    if (method === 'GET' && encoded) url.search = encoded;
    const body = method === 'GET' || !encoded ? undefined : encoded;
    return new Promise((resolve) => {
      const request = https.request(url, {
        method,
        ca: this.config.ca,
        rejectUnauthorized: true,
        headers: {
          authorization: `PVEAPIToken=${this.config.apiTokenId}=${this.config.apiTokenSecret}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body, 'utf8') } : {}),
        },
        timeout: 30_000,
      }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes <= 1024 * 1024) chunks.push(chunk);
          else request.destroy(new Error('Proxmox response exceeded 1 MiB'));
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = response.statusCode ?? 500;
          const parsed = parseJson(text);
          if (!parsed.ok) {
            resolve({ ok: false, error: `proxmox.http.${String(status)}.invalidJson` });
            return;
          }
          const envelope = asRecord(parsed.value);
          if (status < 200 || status >= 300) {
            const message = typeof envelope?.message === 'string' ? envelope.message.slice(0, 300) : `HTTP ${String(status)}`;
            resolve({ ok: false, error: `proxmox.http.${String(status)}:${message}` });
            return;
          }
          resolve({ ok: true, value: envelope?.data });
        });
      });
      request.on('timeout', () => request.destroy(new Error('Proxmox request timed out')));
      request.on('error', (error) => { resolve({ ok: false, error: `proxmox.unavailable:${error.message}` }); });
      if (body) request.write(body);
      request.end();
    });
  }
}
