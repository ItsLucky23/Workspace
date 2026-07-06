//? Preview flow (P4) — run a ticket's app dev-server IN its container and expose it at the
//? preview subdomain (`<branch-slug>.<baseDomain>`). The complement to the live editor: edit vs
//? RUN. Reuses launchTicketContainer + the proxy abstraction + `previewRoute`. The dev command
//? comes from `Project.devCommand` (default `npm run dev`); it must bind 0.0.0.0:<WS_PREVIEW_PORT>
//? so the proxy can dial it (HOST/PORT env are set for the common dev servers; put explicit
//? `--host 0.0.0.0 --port 5173` flags in devCommand for Vite). Idle previews are cleaned up when
//? the container is torn down.

import { getPrismaClient } from '@luckystack/core';

import { launchTicketContainer, docker } from './runtime';
import { waitForContainerReady } from './health';
import { getProxyProvider, previewRoute, baseDomain } from '../proxy';

const PREVIEW_PORT = Number(process.env.WS_PREVIEW_PORT ?? '5173');
const NET = process.env.WS_NET ?? 'workspaces-net';

export interface PreviewResult { ok: boolean; url?: string; host?: string; error?: string }

//? Ensure the ticket container is up + on the proxy net, start the dev server, and upsert the
//? preview route. Idempotent: re-opening reuses the container + replaces the route.
export async function openPreviewForTicket(workspaceId: string, ticketKey: string): Promise<PreviewResult> {
  const prisma = getPrismaClient();
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { branch: true } });
  if (!ticket?.branch) return { ok: false, error: 'preview.notActivated' };
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { baseImageRef: true, devCommand: true } });
  const container = await launchTicketContainer({ workspaceId, ticketKey, branch: ticket.branch, ...(project?.baseImageRef ? { image: project.baseImageRef } : {}) });
  if (!container) return { ok: false, error: 'preview.noContainer' };

  //? Put it on the shared proxy net so the proxy can dial it by name (both idempotent).
  await docker(['network', 'create', NET]);
  await docker(['network', 'connect', NET, container.name]);

  //? Start the dev server detached in /work. HOST/PORT env cover CRA/Next; Vite needs the flags
  //? in devCommand. A previous run's server is left as-is (idempotent — same port).
  const devCmd = (project?.devCommand ?? '').trim().length > 0 ? (project?.devCommand ?? '') : 'npm run dev';
  await docker(['exec', '-d', '-w', '/work', '-e', 'HOST=0.0.0.0', '-e', `PORT=${String(PREVIEW_PORT)}`, container.name, 'sh', '-lc', devCmd]);

  //? C2: don't advertise the URL until the dev server actually binds the port — probe before flipping
  //? the route (no fire-and-forget). A dev server can take 10–30s; a typed timeout beats a 502.
  const ready = await waitForContainerReady(container.name, PREVIEW_PORT);
  if (!ready) return { ok: false, error: 'preview.notReady' };

  const route = previewRoute({ ticketKey, branch: ticket.branch, containerName: container.name, port: PREVIEW_PORT, workspaceId });
  const proxied = await getProxyProvider().upsertRoute(route);
  const protocol = baseDomain() === 'localhost' ? 'http' : 'https';
  return {
    ok: true, host: route.host, url: `${protocol}://${route.host}/`,
    ...(proxied.ok ? {} : { error: `proxy.unreachable: ${proxied.error ?? ''}` }),
  };
}

//? Stop exposing a ticket's preview: remove its proxy route. The dev-server process is left to
//? the container's teardown lifecycle (per-ticket container).
export async function closePreviewForTicket(_workspaceId: string, ticketKey: string): Promise<{ ok: boolean }> {
  await getProxyProvider().removeRoute(ticketKey.toLowerCase());
  return { ok: true };
}
