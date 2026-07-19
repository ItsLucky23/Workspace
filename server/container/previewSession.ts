//? Preview flow (P4) — run a ticket's app dev-server IN its container and expose it at the
//? preview subdomain (`<branch-slug>.<baseDomain>`). The complement to the live editor: edit vs
//? RUN. Reuses launchTicketContainer + the proxy abstraction + `previewRoute`. The dev command
//? comes from `Project.devCommand` (default `npm run dev`); it must bind 0.0.0.0:<WS_PREVIEW_PORT>
//? so the proxy can dial it (HOST/PORT env are set for the common dev servers; put explicit
//? `--host 0.0.0.0 --port 5173` flags in devCommand for Vite). Idle previews are cleaned up when
//? the container is torn down.

import { getPrismaClient } from '@luckystack/core';

import { launchTicketContainer, docker } from './runtime';
import { resolveProjectBaseImage, resolveDevCommand } from './baseImages';
import { workspaceContainerContext } from './composeEngine';
import { waitForContainerReady } from './health';
import { getProxyProvider, previewRoute, baseDomain } from '../proxy';
import { workdirOrRoot } from '../deploy/servicePath';

const PREVIEW_PORT = Number(process.env.WS_PREVIEW_PORT ?? '5173');
const NET = process.env.WS_NET ?? 'workspaces-net';

export interface PreviewResult { ok: boolean; url?: string; host?: string; error?: string }

//? Ensure the ticket container is up + on the proxy net, start the dev server, and upsert the
//? preview route. Idempotent: re-opening reuses the container + replaces the route.
export async function openPreviewForTicket(workspaceId: string, ticketKey: string): Promise<PreviewResult> {
  const prisma = getPrismaClient();
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { branch: true, projectId: true, serviceId: true } });
  if (!ticket?.branch) return { ok: false, error: 'preview.notActivated' };
  //? The ticket's OWN project (FIX-E) — not `findFirst` (which picks the workspace's oldest project and
  //? would run the wrong image/dev-command in a multi-project workspace, ADR 0035).
  const project = await prisma.project.findFirst({ where: { workspaceId, id: ticket.projectId }, select: { baseImageRef: true, stack: true, devCommand: true } });
  //? The ticket's monorepo UNIT, if it has one. `Service.path`, `devCommand` and `baseImageRef` were all
  //? ignored here: a preview of a service ticket booted the project root's dev server in the repo root and
  //? presented it as that service — so the user reviewed the wrong thing while the UI claimed otherwise.
  const service = ticket.serviceId === null
    ? null
    : await prisma.service.findFirst({ where: { workspaceId, id: ticket.serviceId, projectId: ticket.projectId }, select: { path: true, devCommand: true, baseImageRef: true } });
  //? S1 — the project's L2 image, else the L1 base for its stack (any-stack). K3 — inject the workspace env +
  //? the service network so the running app reaches its K1/K2 services by name.
  const ctx = await workspaceContainerContext(prisma, workspaceId);
  const container = await launchTicketContainer({ workspaceId, projectId: ticket.projectId, ticketKey, branch: ticket.branch, image: service?.baseImageRef ?? resolveProjectBaseImage(project), ...ctx });
  if (!container) return { ok: false, error: 'preview.noContainer' };

  //? Put it on the shared proxy net so the proxy can dial it by name (both idempotent).
  await docker(['network', 'create', NET]);
  await docker(['network', 'connect', NET, container.name]);

  //? Start the dev server detached in /work. HOST/PORT env cover CRA/Next; Vite needs the flags
  //? in devCommand. A previous run's server is left as-is (idempotent — same port).
  //? S3 — the SERVICE's devCommand wins, then the project's, then its stack default.
  const devCmd = resolveDevCommand({ devCommand: service?.devCommand ?? project?.devCommand ?? null, stack: project?.stack ?? null });
  const previewDir = workdirOrRoot(service?.path);
  await docker(['exec', '-d', '-w', previewDir, '-e', 'HOST=0.0.0.0', '-e', `PORT=${String(PREVIEW_PORT)}`, container.name, 'sh', '-lc', devCmd]);

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
