//? T1 — preview a ticket's app at an ARBITRARY git ref (SHA / tag / branch), not just the branch tip. Runs an
//? EPHEMERAL, ref-scoped container (its own name/volume/subdomain) so it never disturbs the ticket's tip worker
//? container and two refs of one branch can run side by side — the user's "start main but from commit X" /
//? "the version of yesterday" ask (T2 builds the synthetic-ref producer on top of this). Docker-dependent; the
//? naming + clone/checkout + route plan is pure + unit-tested (runtime `cloneExecArgs`/`refSlug`, `refPreviewRoute`).

import { getPrismaClient } from '@luckystack/core';

import { launchTicketContainer, docker, isSafeRef, refSlug } from './runtime';
import { resolveProjectBaseImage } from './baseImages';
import { resolveRuntime, startProcesses } from './runtimeProcesses';
import { workspaceContainerContext } from './composeEngine';
import { ensureWorkerProxyNetwork } from './egress';
import { waitForContainerReady } from './health';
import { getProxyProvider, refPreviewRoute, baseDomain } from '../proxy';
import { workdirOrRoot } from '../deploy/servicePath';

const PREVIEW_PORT = Number(process.env.WS_PREVIEW_PORT ?? '5173');
const NET = process.env.WS_NET ?? 'workspaces-net';

export interface RefPreviewResult { ok: boolean; url?: string; host?: string; ref?: string; error?: string }

//? Launch (or reuse) the ref-scoped preview container, start the dev server, and expose it at the ref subdomain.
export async function openRefPreview(workspaceId: string, ticketKey: string, ref: string): Promise<RefPreviewResult> {
  if (!isSafeRef(ref)) return { ok: false, error: 'preview.badRef' };
  const prisma = getPrismaClient();
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { branch: true, projectId: true, serviceId: true } });
  if (!ticket?.branch) return { ok: false, error: 'preview.notActivated' };
  const project = await prisma.project.findFirst({ where: { workspaceId, id: ticket.projectId }, select: { baseImageRef: true, stack: true, devCommand: true, runProcesses: true, previewProcessId: true } });
  //? Same per-unit resolution as the branch preview: a ref preview of a service ticket must boot THAT
  //? service, not the project root, or it shows the reviewer something other than what they asked for.
  const service = ticket.serviceId === null
    ? null
    : await prisma.service.findFirst({ where: { workspaceId, id: ticket.serviceId, projectId: ticket.projectId }, select: { path: true, devCommand: true, baseImageRef: true } });

  //? Ref-scoped ephemeral container (full-history clone + `git checkout <ref>` — see runtime.cloneExecArgs). K3 —
  //? inject the workspace env + service network.
  const ctx = await workspaceContainerContext(prisma, workspaceId);
  const container = await launchTicketContainer({ workspaceId, projectId: ticket.projectId, ticketKey, branch: ticket.branch, ref, image: service?.baseImageRef ?? resolveProjectBaseImage(project), ...ctx });
  if (!container) return { ok: false, error: 'preview.noContainer' };

  if (!(await ensureWorkerProxyNetwork(NET))) return { ok: false, error: 'egress.unsafeProxyNetwork' };
  await docker(['network', 'connect', NET, container.name]);

  //? ADR 0317 — the same multi-process runtime the branch preview starts, so a ref preview of an app
  //? that needs a backend is not silently half an app.
  const runtime = resolveRuntime(project, service);
  await startProcesses(container.name, runtime.processes, {
    baseDir: workdirOrRoot(service?.path),
    previewId: runtime.previewId,
    previewEnv: { HOST: '0.0.0.0', PORT: String(PREVIEW_PORT) },
  });

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
