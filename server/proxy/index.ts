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

//? Shared edge-auth dial for editor AND preview routes. Keeping this in the route factory
//? prevents a workspace-aware preview from silently staying public when edge auth is enabled.
export function edgeAuthBackend(): string | undefined {
  return process.env.WS_EDITOR_EDGE_AUTH === undefined
    ? undefined
    : (process.env.WS_EDITOR_AUTH_BACKEND ?? 'host.docker.internal:80');
}

let cached: ProxyProvider | null = null;
export function getProxyProvider(): ProxyProvider {
  if (cached?.kind === proxyKind()) return cached;
  cached = proxyKind() === 'nginx' ? nginxProvider : caddyProvider;
  return cached;
}

//? Route identities and generated hosts include the full workspace id. Ticket keys, branch names,
//? project names and environment ids are tenant-local; using them alone lets one workspace overwrite
//? another workspace's proxy route.
export const previewRouteId = (workspaceId: string, ticketKey: string): string => `preview-${workspaceId}-${ticketKey}`.toLowerCase();
export const editorRouteId = (workspaceId: string, ticketKey: string): string => `vscode-${workspaceId}-${ticketKey}`.toLowerCase();
export const environmentRouteId = (workspaceId: string, envId: string): string => `env-${workspaceId}-${envId}`.toLowerCase();

//? Build the preview route for a ticket. Workspace ownership is mandatory and scopes both route id
//? and host so identical branch/ticket names in two tenants can coexist without route takeover.
export function previewRoute(input: { ticketKey: string; branch: string; containerName: string; port?: number; workspaceId: string }): ProxyRoute {
  return {
    id: previewRouteId(input.workspaceId, input.ticketKey),
    host: `${deriveHostSlug(`${input.workspaceId}-${input.branch}`)}.${baseDomain()}`,
    target: `${input.containerName}:${String(input.port ?? 5173)}`,
    workspaceId: input.workspaceId,
    ...(edgeAuthBackend() === undefined ? {} : { forwardAuth: edgeAuthBackend() }),
  };
}

//? T1 — a workspace-scoped REF-preview: keyed by tenant + ticket + ref so refs and tenants coexist.
export function refPreviewRoute(input: { ticketKey: string; branch: string; refSlug: string; containerName: string; port?: number; workspaceId: string }): ProxyRoute {
  return {
    id: `${previewRouteId(input.workspaceId, input.ticketKey)}-ref-${input.refSlug}`,
    host: `${deriveHostSlug(`${input.workspaceId}-${input.branch}-${input.refSlug}`)}.${baseDomain()}`,
    target: `${input.containerName}:${String(input.port ?? 5173)}`,
    workspaceId: input.workspaceId,
    ...(edgeAuthBackend() === undefined ? {} : { forwardAuth: edgeAuthBackend() }),
  };
}

//? Build the STABLE workspace-scoped route for a persistent environment.
export function envRoute(input: { envId: string; kind: string; serviceSlug: string; containerName: string; port?: number; workspaceId: string }): ProxyRoute {
  return {
    id: environmentRouteId(input.workspaceId, input.envId),
    host: `${deriveHostSlug(`${input.workspaceId}-${input.kind}-${input.serviceSlug}`)}.${baseDomain()}`,
    target: `${input.containerName}:${String(input.port ?? 5173)}`,
    workspaceId: input.workspaceId,
  };
}

export type { ProxyProvider, ProxyRoute, ProxyResult } from './types';
