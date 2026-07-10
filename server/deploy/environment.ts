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
import { branchHead } from '../git/repoStore';
import { resolveDevCommand, resolveProdCommand } from '../container/baseImages';

const ENV_PORT = Number(process.env.WS_PREVIEW_PORT ?? '5173');
const NET = process.env.WS_NET ?? 'workspaces-net';
//? `demo` (D3) = a persistent env that serves the deploy branch (main) at a stable route; with autoRedeploy
//? the demoWatch sweep redeploys it when main moves, or a pinnedCommit freezes it at a fixed commit.
export const ENV_KINDS = ['dev', 'staging', 'prod', 'demo'] as const;
export type EnvKind = (typeof ENV_KINDS)[number];

export interface DeployResult { ok: boolean; envId?: string; url?: string; status: string; error?: string }

const asKind = (s: string): EnvKind => ((ENV_KINDS as readonly string[]).includes(s) ? s : 'dev') as EnvKind;
//? The synthetic container "ticket key" for an env — stable across deploys so the container name is stable.
const envKey = (envId: string): string => `env-${envId}`;

//? Find-or-create the Environment row for (project, service, kind). Returns its id. The route host is
//? derived from the kind + the service/project slug and stored so the URL is stable across deploys.
//? D2 — a DNS-safe subdomain label: lowercase alphanumerics + single dashes, 1-63 chars, no leading/trailing
//? dash. Returns '' for an invalid/empty input (→ fall back to the derived host). Pure.
export function sanitizeSubdomain(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().toLowerCase().replaceAll(/[^a-z0-9-]/g, '-').replaceAll(/-+/g, '-').replaceAll(/^-|-$/g, '');
  return s.length > 0 && s.length <= 63 ? s : '';
}
//? D3 — a valid custom domain: a dotted FQDN of DNS-safe labels (e.g. `preview.mijndomein.nl`). Pure.
export function sanitizeCustomDomain(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().toLowerCase().replaceAll(/^https?:\/\//g, '').replaceAll(/\/.*$/g, '');
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s) ? s : '';
}

export async function ensureEnvironment(prisma: PrismaClient, workspaceId: string, projectId: string, serviceId: string | null, kind: string, opts: { autoRedeploy?: boolean; pinnedCommit?: string; subdomain?: string; customDomain?: string } = {}): Promise<string | null> {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { name: true } });
  if (!project) return null;
  const service = serviceId ? await prisma.service.findFirst({ where: { id: serviceId, projectId }, select: { name: true } }) : null;
  const slug = deriveHostSlug(service?.name ?? project.name);
  //? D2/D3 — host precedence: a valid customDomain (served with on-demand TLS) → a user-chosen subdomain on the
  //? base domain → the derived `<kind>-<slug>`. A subdomain must be unique across environments (loud fallback:
  //? a clash keeps the derived host rather than hijacking another env's route).
  const customDomain = sanitizeCustomDomain(opts.customDomain);
  const wantSub = sanitizeSubdomain(opts.subdomain);
  const subFree = wantSub.length > 0 ? (await prisma.environment.findFirst({ where: { subdomain: wantSub, NOT: { projectId, kind: asKind(kind), serviceId: serviceId ?? null } }, select: { id: true } })) === null : false;
  const subdomain = subFree ? wantSub : '';
  const derivedHost = `${deriveHostSlug(`${asKind(kind)}-${slug}`)}.${baseDomain()}`;
  const host = customDomain.length > 0 ? customDomain : (subdomain.length > 0 ? `${subdomain}.${baseDomain()}` : derivedHost);
  //? D3 — a demo env follows main by default (autoRedeploy) unless it is pinned to a fixed commit. A pin
  //? always wins and disables auto-redeploy. Non-demo kinds never auto-redeploy.
  const pin = (opts.pinnedCommit ?? '').trim();
  const isDemo = asKind(kind) === 'demo';
  const autoRedeploy = isDemo && pin.length === 0 && (opts.autoRedeploy ?? true);
  const routeFields = { route: host, ...(subdomain.length > 0 ? { subdomain } : { subdomain: null }), ...(customDomain.length > 0 ? { customDomain } : { customDomain: null }) };

  const existing = await prisma.environment.findFirst({ where: { projectId, kind: asKind(kind), serviceId: serviceId ?? null }, select: { id: true } });
  if (existing) {
    await prisma.environment.updateMany({ where: { id: existing.id, workspaceId }, data: { autoRedeploy, pinnedCommit: pin.length > 0 ? pin : null, ...routeFields } });
    return existing.id;
  }
  const created = await prisma.environment.create({
    data: { workspaceId, projectId, serviceId: serviceId ?? null, kind: asKind(kind), status: 'idle', autoRedeploy, ...(pin.length > 0 ? { pinnedCommit: pin } : {}), ...routeFields },
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
    prisma.project.findFirst({ where: { id: env.projectId }, select: { baseImageRef: true, devCommand: true, prodCommand: true, stack: true } }),
    env.serviceId ? prisma.service.findFirst({ where: { id: env.serviceId }, select: { baseImageRef: true, devCommand: true, prodCommand: true } }) : Promise.resolve(null),
  ]);
  const branch = normalizeGitConfig(ws?.gitConfig ?? null).targetBranch;
  const image = opts.imageRef ?? service?.baseImageRef ?? project?.baseImageRef ?? undefined;
  //? D1 — prod/demo envs serve the real BUILD (prodCommand: build then serve), not the dev server. dev/staging
  //? keep the dev server (fast iteration). A per-service/project override wins over the stack default.
  const isProd = env.kind === 'prod' || env.kind === 'demo';
  const stack = project?.stack ?? null;
  const serveCmd = isProd
    ? resolveProdCommand({ prodCommand: service?.prodCommand ?? project?.prodCommand ?? null, stack })
    : resolveDevCommand({ devCommand: service?.devCommand ?? project?.devCommand ?? null, stack });

  const container = await launchTicketContainer({ workspaceId, projectId: env.projectId, ticketKey: envKey(envId), branch, ...(image ? { image } : {}) });
  if (!container) return failEnv(prisma, envId, 'env.noContainer');

  //? D3 — record which commit this deploy runs (the watcher compares against the branch head). A demo pinned
  //? to a fixed commit checks that commit out in /work so it serves a FROZEN demo; otherwise it's the head.
  const head = await branchHead(workspaceId, env.projectId, branch);
  const pin = (env.pinnedCommit ?? '').trim();
  if (pin.length > 0) await docker(['exec', '-w', '/work', container.name, 'git', 'checkout', pin]);
  const deployedCommit = pin.length > 0 ? pin : head;

  //? Put it on the shared proxy net so the proxy can dial it by name (both idempotent).
  await docker(['network', 'create', NET]);
  await docker(['network', 'connect', NET, container.name]);
  //? Start the serve command detached in /work (HOST/PORT cover CRA/Next; Vite needs flags in the command).
  //? D1 — for prod/demo this builds + serves the production output; for dev/staging it's the dev server.
  await docker(['exec', '-d', '-w', '/work', '-e', 'HOST=0.0.0.0', '-e', `PORT=${String(ENV_PORT)}`, container.name, 'sh', '-lc', serveCmd]);

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
    data: { status, containerName: container.name, branch, imageRef: image ?? null, healthUrl: `http://localhost:${String(ENV_PORT)}`, lastDeployedAt: new Date(), ...(deployedCommit.length > 0 ? { deployedCommit } : {}), ...(ready ? { lastError: null } : { lastError: 'env.notReady' }) },
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
  // luckystack-allow tenant-scope: leader-gated boot self-heal — re-asserts routes for EVERY workspace's live envs cross-tenant by design (H1).
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
