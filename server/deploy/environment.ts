//? Persistent environments (ADR 0037, B1) — deploy a project/service to a long-running container at
//? a STABLE route (`<kind>-<service>.<baseDomain>`), the first thing that runs a user's app beyond the
//? 30-min ticket preview. Reuses `launchTicketContainer` (clones the DEPLOY branch, not a ticket
//? branch) + the proxy abstraction + the readiness probe. The Conductor is the only caller (B-23); the
//? leader provisions (the caller already holds the workspace lease). Best-effort: never throws — every
//? failure lands on the Environment row as `status:'error'` + `lastError`.

import { getPrismaClient } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { launchTicketContainer, teardownTicketContainer, docker, dockerAvailable } from '../container/runtime';
import { waitForContainerReady } from '../container/health';
import { getProxyProvider, envRoute, baseDomain } from '../proxy';
import { normalizeGitConfig, deriveHostSlug } from '../git/branchStrategy';

const ENV_PORT = Number(process.env.WS_PREVIEW_PORT ?? '5173');
const NET = process.env.WS_NET ?? 'workspaces-net';
export const ENV_KINDS = ['dev', 'staging', 'prod'] as const;
export type EnvKind = (typeof ENV_KINDS)[number];

export interface DeployResult { ok: boolean; envId?: string; url?: string; status: string; error?: string }

const asKind = (s: string): EnvKind => ((ENV_KINDS as readonly string[]).includes(s) ? s : 'dev') as EnvKind;
//? The synthetic container "ticket key" for an env — stable across deploys so the container name is stable.
const envKey = (envId: string): string => `env-${envId}`;

//? Find-or-create the Environment row for (project, service, kind). Returns its id. The route host is
//? derived from the kind + the service/project slug and stored so the URL is stable across deploys.
export async function ensureEnvironment(prisma: PrismaClient, workspaceId: string, projectId: string, serviceId: string | null, kind: string): Promise<string | null> {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { name: true } });
  if (!project) return null;
  const service = serviceId ? await prisma.service.findFirst({ where: { id: serviceId, projectId }, select: { name: true } }) : null;
  const slug = deriveHostSlug(service?.name ?? project.name);
  const host = `${deriveHostSlug(`${asKind(kind)}-${slug}`)}.${baseDomain()}`;

  const existing = await prisma.environment.findFirst({ where: { projectId, kind: asKind(kind), serviceId: serviceId ?? null }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.environment.create({
    data: { workspaceId, projectId, serviceId: serviceId ?? null, kind: asKind(kind), route: host, status: 'idle' },
  });
  return created.id;
}

//? Deploy (or redeploy) an environment: launch a persistent container running the deploy branch, start
//? the serve command, wait for readiness, then flip the STABLE route to it. Status: deploying→live|error.
//? `opts.imageRef` PINS the image (promotion deploys the exact image the source env was tested on, ADR 0038).
export async function deployEnvironment(prisma: PrismaClient, workspaceId: string, envId: string, opts: { imageRef?: string } = {}): Promise<DeployResult> {
  const env = await prisma.environment.findFirst({ where: { id: envId, workspaceId } });
  if (!env) return { ok: false, status: 'error', error: 'env.notFound' };
  if (!(await dockerAvailable())) {
    await prisma.environment.update({ where: { id: envId }, data: { status: 'error', lastError: 'docker.unavailable' } });
    return { ok: false, envId, status: 'error', error: 'docker.unavailable' };
  }
  await prisma.environment.update({ where: { id: envId }, data: { status: 'deploying', lastError: null } });

  //? Resolve the deploy branch (gitConfig.targetBranch, default main) + image + serve command.
  const [ws, project, service] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitConfig: true } }),
    prisma.project.findFirst({ where: { id: env.projectId }, select: { baseImageRef: true, devCommand: true } }),
    env.serviceId ? prisma.service.findFirst({ where: { id: env.serviceId }, select: { baseImageRef: true, devCommand: true } }) : Promise.resolve(null),
  ]);
  const branch = normalizeGitConfig(ws?.gitConfig ?? null).targetBranch;
  const image = opts.imageRef ?? service?.baseImageRef ?? project?.baseImageRef ?? undefined;
  const devCmd = ((service?.devCommand ?? project?.devCommand) ?? '').trim() || 'npm run dev';

  const container = await launchTicketContainer({ workspaceId, ticketKey: envKey(envId), branch, ...(image ? { image } : {}) });
  if (!container) return failEnv(prisma, envId, 'env.noContainer');

  //? Put it on the shared proxy net so the proxy can dial it by name (both idempotent).
  await docker(['network', 'create', NET]);
  await docker(['network', 'connect', NET, container.name]);
  //? Start the serve command detached in /work (HOST/PORT cover CRA/Next; Vite needs flags in devCommand).
  await docker(['exec', '-d', '-w', '/work', '-e', 'HOST=0.0.0.0', '-e', `PORT=${String(ENV_PORT)}`, container.name, 'sh', '-lc', devCmd]);

  //? Only flip the stable route once the app actually serves (readiness), so a broken deploy doesn't
  //? blackhole the live URL.
  const ready = await waitForContainerReady(container.name, ENV_PORT);
  const route = envRoute({ envId, kind: env.kind, serviceSlug: deriveHostSlug(env.route.split('.')[0] ?? env.kind), containerName: container.name, port: ENV_PORT, workspaceId });
  //? Keep the ORIGINAL stable host (env.route) — envRoute recomputes the slug, but the row's route is truth.
  route.host = env.route;
  if (ready) await getProxyProvider().upsertRoute(route);

  const status = ready ? 'live' : 'error';
  await prisma.environment.update({
    where: { id: envId },
    data: { status, containerName: container.name, branch, imageRef: image ?? null, healthUrl: `http://localhost:${String(ENV_PORT)}`, lastDeployedAt: new Date(), ...(ready ? { lastError: null } : { lastError: 'env.notReady' }) },
  });
  const protocol = baseDomain() === 'localhost' ? 'http' : 'https';
  return ready
    ? { ok: true, envId, status, url: `${protocol}://${env.route}/` }
    : { ok: false, envId, status, error: 'env.notReady' };
}

async function failEnv(prisma: PrismaClient, envId: string, error: string): Promise<DeployResult> {
  await prisma.environment.update({ where: { id: envId }, data: { status: 'error', lastError: error } });
  return { ok: false, envId, status: 'error', error };
}

//? Tear an environment down: remove the stable route + stop/remove the container, mark it stopped.
export async function teardownEnvironment(prisma: PrismaClient, workspaceId: string, envId: string): Promise<{ ok: boolean }> {
  await getProxyProvider().removeRoute(`env-${envId}`.toLowerCase());
  await teardownTicketContainer(workspaceId, envKey(envId)).catch(() => null);
  await prisma.environment.update({ where: { id: envId }, data: { status: 'stopped', containerName: null } }).catch(() => null);
  return { ok: true };
}

//? Boot self-heal: re-assert the proxy route for every `live` environment whose container is still up,
//? so an orchestrator/proxy restart doesn't silently drop the stable URL (the boot reconcile prunes any
//? route not backed by a running container, but never RE-ADDS one). Leader-gated by the caller.
export async function reassertEnvironmentRoutes(): Promise<number> {
  if (!(await dockerAvailable())) return 0;
  const prisma = getPrismaClient();
  const live = await prisma.environment.findMany({ where: { status: 'live', containerName: { not: null } } });
  let reasserted = 0;
  for (const env of live) {
    if (!env.containerName) continue;
    const running = await docker(['inspect', '-f', '{{.State.Running}}', env.containerName]);
    if (running.out.trim() !== 'true') continue;
    await docker(['network', 'connect', NET, env.containerName]);
    await getProxyProvider().upsertRoute({ id: `env-${env.id}`.toLowerCase(), host: env.route, target: `${env.containerName}:${String(ENV_PORT)}`, workspaceId: env.workspaceId });
    reasserted += 1;
  }
  return reasserted;
}
