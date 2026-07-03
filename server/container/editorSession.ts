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
import { deriveHostSlug } from '../git/branchStrategy';
import { getProxyProvider, baseDomain, type ProxyRoute } from '../proxy';

//? The shared docker network the proxy dials container names on. Host-level infra config.
const EDITOR_NET = process.env.WS_NET ?? 'workspaces-net';

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

//? Open (or re-open) the editor for a ticket. Idempotent: reuses a running container, replaces
//? the route. Returns the minted per-session URL + connection token.
export async function openEditorForTicket(input: {
  workspaceId: string; ticketKey: string; branch: string; userId: string;
  image?: string; extensions?: string[]; settingsJson?: string;
}): Promise<OpenEditorResult> {
  //? 1. Ensure the ticket container (reuses if already running; null ⇒ no linked repo).
  const [launchErr, container] = await tryCatch(() => launchTicketContainer({
    workspaceId: input.workspaceId, ticketKey: input.ticketKey, branch: input.branch, ...(input.image ? { image: input.image } : {}),
  }));
  if (launchErr) return { ok: false, error: `editor.launchFailed: ${String(launchErr).slice(0, 150)}` };
  if (!container) return { ok: false, error: 'editor.noContainer' };

  //? 2. Put it on the proxy network so the proxy can dial it by name.
  await attachToProxyNet(container.name);

  //? 3. Install openvscode (if needed) + project the user's profile + start the workbench.
  const token = randomUUID();
  const started = await startEditorInContainer({
    container: container.name, userId: input.userId, token, workdir: '/work',
    ...(input.extensions ? { extensions: input.extensions } : {}),
    ...(input.settingsJson ? { settingsJson: input.settingsJson } : {}),
  });
  if (started.error !== undefined) return { ok: false, error: started.error };

  //? 4. Upsert the reverse-proxy route → the per-ticket subdomain.
  const route = editorRoute({ ticketKey: input.ticketKey, branch: input.branch, containerName: container.name });
  const proxied = await getProxyProvider().upsertRoute(route);
  //? A missing proxy is not fatal for the caller — surface the host + token anyway (the editor
  //? IS up in the container); the URL just won't resolve until the proxy is reachable.
  const protocol = baseDomain() === 'localhost' ? 'http' : 'https';
  return {
    ok: true, host: route.host, token,
    url: `${protocol}://${route.host}/?tkn=${token}`,
    ...(proxied.ok ? {} : { error: `proxy.unreachable: ${proxied.error ?? ''}` }),
  };
}

//? Close the editor for a ticket: capture the profile back (so this session's logins/extensions
//? persist to the user), then remove the proxy route. The container itself is left to the normal
//? teardown lifecycle.
export async function closeEditorForTicket(input: { workspaceId: string; ticketKey: string; userId: string }): Promise<{ ok: boolean; error?: string }> {
  const name = containerName(input.workspaceId, input.ticketKey);
  const captured = await captureProfileFromContainer(name, input.userId);
  await getProxyProvider().removeRoute(`vscode-${input.ticketKey.toLowerCase()}`);
  //? Stop the workbench process but keep the container (the agent may still be using it).
  await docker(['exec', name, 'bash', '-lc', 'pkill -f openvscode-server || true']);
  return captured.ok ? { ok: true } : { ok: false, error: captured.error };
}
