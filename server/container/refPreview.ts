//? T1 — preview a ticket's app at an ARBITRARY git ref (SHA / tag / branch), not just the branch tip. Runs an
//? EPHEMERAL, ref-scoped container (its own name/volume/subdomain) so it never disturbs the ticket's tip worker
//? container and two refs of one branch can run side by side — the user's "start main but from commit X" /
//? "the version of yesterday" ask (T2 builds the synthetic-ref producer on top of this). Docker-dependent; the
//? naming + clone/checkout + route plan is pure + unit-tested (runtime `cloneExecArgs`/`refSlug`, `refPreviewRoute`).

import { getPrismaClient } from '@luckystack/core';

import { launchTicketContainer, docker, isSafeRef, refSlug } from './runtime';
import { resolveProjectBaseImage, resolveDevCommand } from './baseImages';
import { waitForContainerReady } from './health';
import { getProxyProvider, refPreviewRoute, baseDomain } from '../proxy';

const PREVIEW_PORT = Number(process.env.WS_PREVIEW_PORT ?? '5173');
const NET = process.env.WS_NET ?? 'workspaces-net';

export interface RefPreviewResult { ok: boolean; url?: string; host?: string; ref?: string; error?: string }

//? Launch (or reuse) the ref-scoped preview container, start the dev server, and expose it at the ref subdomain.
export async function openRefPreview(workspaceId: string, ticketKey: string, ref: string): Promise<RefPreviewResult> {
  if (!isSafeRef(ref)) return { ok: false, error: 'preview.badRef' };
  const prisma = getPrismaClient();
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { branch: true, projectId: true } });
  if (!ticket?.branch) return { ok: false, error: 'preview.notActivated' };
  const project = await prisma.project.findFirst({ where: { workspaceId, id: ticket.projectId }, select: { baseImageRef: true, stack: true, devCommand: true } });

  //? Ref-scoped ephemeral container (full-history clone + `git checkout <ref>` — see runtime.cloneExecArgs).
  const container = await launchTicketContainer({ workspaceId, ticketKey, branch: ticket.branch, ref, image: resolveProjectBaseImage(project) });
  if (!container) return { ok: false, error: 'preview.noContainer' };

  await docker(['network', 'create', NET]);
  await docker(['network', 'connect', NET, container.name]);

  const devCmd = resolveDevCommand(project); // S3 — the project's devCommand, else its stack default
  await docker(['exec', '-d', '-w', '/work', '-e', 'HOST=0.0.0.0', '-e', `PORT=${String(PREVIEW_PORT)}`, container.name, 'sh', '-lc', devCmd]);

  const ready = await waitForContainerReady(container.name, PREVIEW_PORT);
  if (!ready) return { ok: false, error: 'preview.notReady' };

  const route = refPreviewRoute({ ticketKey, branch: ticket.branch, refSlug: refSlug(ref), containerName: container.name, port: PREVIEW_PORT, workspaceId });
  const proxied = await getProxyProvider().upsertRoute(route);
  const protocol = baseDomain() === 'localhost' ? 'http' : 'https';
  return {
    ok: true, host: route.host, url: `${protocol}://${route.host}/`, ref,
    ...(proxied.ok ? {} : { error: `proxy.unreachable: ${proxied.error ?? ''}` }),
  };
}
