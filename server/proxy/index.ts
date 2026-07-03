//? Workspaces — proxy-provider factory + preview-route helper. Selects the backend from
//? config (`WS_PROXY`) and builds the per-ticket preview host from the branch slug +
//? host-level base domain (`WS_BASE_DOMAIN`, e.g. `workspace.keetlerop.nl`). The proxy choice
//? + base domain are HOST-level infra config (one proxy per host, shared by all workspaces),
//? deliberately NOT per-workspace DB state — see the hosting-proxy plan + docs/HOSTING.md.

import { deriveHostSlug } from '../git/branchStrategy';
import { caddyProvider } from './caddyProvider';
import { nginxProvider } from './nginxProvider';
import type { ProxyProvider, ProxyRoute } from './types';

export type ProxyKind = 'caddy' | 'nginx';

//? Configured backend. Defaults to `caddy` (dynamic Admin API, the easiest churn fit); set
//? `WS_PROXY=nginx` to use the debounced-reload nginx backend instead.
export function proxyKind(): ProxyKind {
  return process.env.WS_PROXY === 'nginx' ? 'nginx' : 'caddy';
}

//? The host-level base domain every preview subdomain hangs off. Dev default `localhost`
//? (Caddy internal-CA `*.localhost`); prod e.g. `workspace.keetlerop.nl` (wildcard DNS + cert).
export function baseDomain(): string {
  return process.env.WS_BASE_DOMAIN ?? 'localhost';
}

let cached: ProxyProvider | null = null;
export function getProxyProvider(): ProxyProvider {
  if (cached?.kind === proxyKind()) return cached;
  cached = proxyKind() === 'nginx' ? nginxProvider : caddyProvider;
  return cached;
}

//? Build the preview route for a ticket: host = `<branch-slug>.<baseDomain>`, target =
//? `<containerName>:<port>` on the shared container network. `id` is the (unique) ticket key
//? so upsert/remove/reconcile are idempotent per ticket. `port` is the in-container preview
//? server (defaults to the Vite dev port, 07b §5.2).
export function previewRoute(input: { ticketKey: string; branch: string; containerName: string; port?: number }): ProxyRoute {
  return {
    id: input.ticketKey.toLowerCase(),
    host: `${deriveHostSlug(input.branch)}.${baseDomain()}`,
    target: `${input.containerName}:${String(input.port ?? 5173)}`,
  };
}

export type { ProxyProvider, ProxyRoute, ProxyResult } from './types';
