//? Per-ticket editor SESSION orchestration (ADR 0010, CODE_EDITOR §1). One call opens the
//? real VS Code for a (user, ticket): ensure the ticket container is up + on the shared proxy
//? network, install openvscode if needed, project the user's profile (extensions + auth), start
//? the workbench, and upsert the reverse-proxy route (server/proxy — Caddy/nginx). Closing
//? captures the profile back (so logins persist) and removes the route.
//?
//? Reuses, not reinvents: `launchTicketContainer`/`docker`/`containerName` (runtime.ts),
//? `getProxyProvider`/`baseDomain` (server/proxy), `deriveHostSlug` (branchStrategy),
//? `startEditorInContainer`/`captureProfileFromContainer` (editor layer).

import { randomUUID } from 'node:crypto';

import { tryCatch } from '@luckystack/core';

import { docker, containerName, launchTicketContainer } from './runtime';
import { startEditorInContainer, EDITOR_IN_CONTAINER_PORT } from './editorServer';
import { captureProfileFromContainer } from './editorProfile';
import { isEditorRunning } from '../orchestrator/editGuard';
import { deriveHostSlug } from '../git/branchStrategy';
import { getProxyProvider, baseDomain, type ProxyRoute } from '../proxy';

//? The shared docker network the proxy dials container names on. Host-level infra config.
const EDITOR_NET = process.env.WS_NET ?? 'workspaces-net';

//? In-memory reuse cache: the openvscode connection-token minted per (workspace, ticket). On
//? reopen, if the editor is still serving we return the SAME token/URL instead of relaunching
//? (avoids a second openvscode + a fresh token). Lost on server restart → reopen relaunches
//? cleanly. Kept off the shared `Ticket` row on purpose (no schema change / no cross-agent churn).
const editorTokens = new Map<string, string>();
const cacheKey = (workspaceId: string, ticketKey: string): string => `${workspaceId}:${ticketKey}`;

export interface OpenEditorResult { ok: boolean; url?: string; host?: string; token?: string; error?: string }

//? The proxy route for a ticket's editor: a `vscode-<slug>` subdomain → the container's
//? in-container editor port. `id` is `vscode-<ticketKey>` so it never collides with the
//? preview route (`previewRoute` uses the bare ticket key).
export function editorRoute(input: { ticketKey: string; branch: string; containerName: string }): ProxyRoute {
  return {
    id: `vscode-${input.ticketKey.toLowerCase()}`,
    host: `vscode-${deriveHostSlug(input.branch)}.${baseDomain()}`,
    target: `${input.containerName}:${String(EDITOR_IN_CONTAINER_PORT)}`,
  };
}

//? Ensure the shared proxy network exists + the container is attached (both idempotent).
async function attachToProxyNet(name: string): Promise<void> {
  await docker(['network', 'create', EDITOR_NET]); // errors if it exists — ignored
  await docker(['network', 'connect', EDITOR_NET, name]); // errors if already attached — ignored
}

//? Upsert the ticket's editor route and build the reachable URL. Shared by the fresh-launch
//? and reuse paths. Dev (`localhost`) serves plain http on Caddy :80; a real base domain uses
//? https (:443, wildcard cert).
async function finalizeEditor(ticketKey: string, branch: string, name: string, token: string): Promise<OpenEditorResult> {
  const route = editorRoute({ ticketKey, branch, containerName: name });
  const proxied = await getProxyProvider().upsertRoute(route);
  //? Caddy serves TLS on :443 (internal CA for *.localhost in dev, wildcard cert in prod), so the
  //? editor URL is always https. `npm run caddy:launch` never publishes :80 → no clash with the
  //? backend's own port. Dev: `caddy trust` (or accept the warning) for the internal CA.
  return {
    ok: true, host: route.host, token,
    url: `https://${route.host}/?tkn=${token}`,
    ...(proxied.ok ? {} : { error: `proxy.unreachable: ${proxied.error ?? ''}` }),
  };
}

//? Open (or re-open) the editor for a ticket. Idempotent: if the editor is already serving,
//? reuse the same token/URL (no relaunch). Otherwise ensure the container, project the profile,
//? and start the workbench. Returns the per-session URL + connection token.
export async function openEditorForTicket(input: {
  workspaceId: string; ticketKey: string; branch: string; userId: string;
  image?: string; extensions?: string[]; settingsJson?: string;
}): Promise<OpenEditorResult> {
  const key = cacheKey(input.workspaceId, input.ticketKey);
  const name = containerName(input.workspaceId, input.ticketKey);
  const cached = editorTokens.get(key);

  //? REUSE: the editor is still serving for this ticket → same token/URL, just re-ensure the
  //? net + route (a reopen shouldn't launch a second openvscode or mint a new token).
  if (cached !== undefined && await isEditorRunning(input.workspaceId, input.ticketKey)) {
    await attachToProxyNet(name);
    return finalizeEditor(input.ticketKey, input.branch, name, cached);
  }

  //? FRESH: ensure the ticket container (reuses if running; null ⇒ no linked repo).
  const [launchErr, container] = await tryCatch(() => launchTicketContainer({
    workspaceId: input.workspaceId, ticketKey: input.ticketKey, branch: input.branch, ...(input.image ? { image: input.image } : {}),
  }));
  if (launchErr) return { ok: false, error: `editor.launchFailed: ${String(launchErr).slice(0, 150)}` };
  if (!container) return { ok: false, error: 'editor.noContainer' };
  //? Put it on the proxy network so the proxy can dial it by name.
  await attachToProxyNet(container.name);
  //? Install openvscode (if needed) + project the user's profile + start the workbench.
  const token = randomUUID();
  const started = await startEditorInContainer({
    container: container.name, userId: input.userId, token, workdir: '/work',
    ...(input.extensions ? { extensions: input.extensions } : {}),
    ...(input.settingsJson ? { settingsJson: input.settingsJson } : {}),
  });
  if (started.error !== undefined) return { ok: false, error: started.error };
  editorTokens.set(key, token);
  return finalizeEditor(input.ticketKey, input.branch, container.name, token);
}

//? Close the editor for a ticket: capture the profile back (so this session's logins/extensions
//? persist to the user), then remove the proxy route. The container itself is left to the normal
//? teardown lifecycle.
export async function closeEditorForTicket(input: { workspaceId: string; ticketKey: string; userId: string }): Promise<{ ok: boolean; error?: string }> {
  const name = containerName(input.workspaceId, input.ticketKey);
  editorTokens.delete(cacheKey(input.workspaceId, input.ticketKey));
  const captured = await captureProfileFromContainer(name, input.userId);
  await getProxyProvider().removeRoute(`vscode-${input.ticketKey.toLowerCase()}`);
  //? Stop the workbench process but keep the container (the agent may still be using it).
  await docker(['exec', name, 'bash', '-lc', 'pkill -f openvscode-server || true']);
  return captured.ok ? { ok: true } : { ok: false, error: captured.error };
}
