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
export function previewRoute(input: { ticketKey: string; branch: string; containerName: string; port?: number; workspaceId?: string }): ProxyRoute {
  return {
    id: input.ticketKey.toLowerCase(),
    host: `${deriveHostSlug(input.branch)}.${baseDomain()}`,
    target: `${input.containerName}:${String(input.port ?? 5173)}`,
    //? Carry the workspace so edge-auth can verify membership on this preview subdomain.
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
  };
}

//? T1 — the route for a REF-preview: keyed by ticket + ref (distinct id + host per ref) so two refs of one
//? branch coexist. host = `<branch-slug>-<refSlug>.<baseDomain>`, id = `<ticketKey>-ref-<refSlug>`.
export function refPreviewRoute(input: { ticketKey: string; branch: string; refSlug: string; containerName: string; port?: number; workspaceId?: string }): ProxyRoute {
  return {
    id: `${input.ticketKey.toLowerCase()}-ref-${input.refSlug}`,
    host: `${deriveHostSlug(`${input.branch}-${input.refSlug}`)}.${baseDomain()}`,
    target: `${input.containerName}:${String(input.port ?? 5173)}`,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
  };
}

//? Build the STABLE route for a persistent environment (ADR 0037, B1): host =
//? `<kind>-<serviceSlug>.<baseDomain>`, target = `<containerName>:<port>`. Unlike previewRoute
//? (keyed by ticket + branch, ephemeral), the id/host are stable across deploys so the URL never
//? changes. `serviceSlug` falls back to the project slug for a single-service (project-root) env.
export function envRoute(input: { envId: string; kind: string; serviceSlug: string; containerName: string; port?: number; workspaceId?: string }): ProxyRoute {
  return {
    id: `env-${input.envId}`.toLowerCase(),
    host: `${deriveHostSlug(`${input.kind}-${input.serviceSlug}`)}.${baseDomain()}`,
    target: `${input.containerName}:${String(input.port ?? 5173)}`,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
  };
}

export type { ProxyProvider, ProxyRoute, ProxyResult } from './types';
