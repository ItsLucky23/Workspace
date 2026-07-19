//? K1-b — the compose-engine provisioner. Runs a workspace's SANITIZED docker-compose stack (K1-a) namespaced so
//? two workspaces never collide: a compose PROJECT name `ws-<id>-<name>`, an EXTERNAL per-workspace default
//? network `ws-<id>-svc` (so every service + the app/preview container share one net + reach each other by
//? service name), and Docker-managed volumes are project-prefixed automatically. The naming + arg + network-inject
//? helpers are pure + unit-tested; the actual `docker compose` calls take an injectable runner. Conductor-only
//? writer (a `service-provision`/`service-teardown` control-op). No host ports are published (K1-a stripped them).

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { docker, dockerAvailable } from './runtime';
import { workspaceDataDir } from '../git/repoStore';
import { sanitizeCompose } from './composeSanitize';
import { resolveWorkspaceEnv } from './serviceEnv';

const safe = (s: string): string => s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');

//? The compose project name (namespaces every container/network/volume) + the per-workspace service network.
export function stackProject(workspaceId: string, name: string): string { return `ws-${safe(workspaceId)}-${safe(name)}`; }
export function stackNetwork(workspaceId: string): string { return `ws-${safe(workspaceId)}-svc`; }

//? Inject an EXTERNAL per-workspace default network into the sanitized compose, so all services join the same net
//? the app/preview container is on. Skipped if the compose already declares `networks:` (respect the author).
export function withWorkspaceNetwork(sanitized: string, network: string): string {
  if (/\nnetworks\s*:/.test(`\n${sanitized}`)) return sanitized;
  return `${sanitized.trimEnd()}\nnetworks:\n  default:\n    name: ${network}\n    external: true\n`;
}

//? K3 — the launch context for a workspace's containers: the app env (resolveWorkspaceEnv) + the per-workspace
//? service network WHEN the workspace has a running service stack (so the app can reach its services by name).
//? Threaded into `launchTicketContainer` by the stage/preview/ref-preview callers.
export async function workspaceContainerContext(prisma: PrismaClient, workspaceId: string): Promise<{ env: Record<string, string>; serviceNetwork?: string }> {
  const env = await resolveWorkspaceEnv(prisma, workspaceId);
  const running = await prisma.serviceStack.count({ where: { workspaceId, status: 'running' } });
  return running > 0 ? { env, serviceNetwork: stackNetwork(workspaceId) } : { env };
}

export function composeUpArgs(project: string, file: string): string[] { return ['compose', '-p', project, '-f', file, 'up', '-d', '--remove-orphans']; }
export function composeDownArgs(project: string, file: string): string[] { return ['compose', '-p', project, '-f', file, 'down', '-v']; }
export function composePsArgs(project: string, file: string): string[] { return ['compose', '-p', project, '-f', file, 'ps', '--format', '{{.Service}} {{.State}}']; }

//? Where the sanitized compose file for a stack lives on disk (mounted for `docker compose -f`).
function stackFile(workspaceId: string, name: string): string { return path.join(workspaceDataDir(workspaceId), 'services', `${safe(name)}.compose.yml`); }

export type DockerRun = (args: string[]) => Promise<{ code: number; out: string; err: string }>;
const realRun: DockerRun = (args) => docker(args);

export interface ProvisionResult { ok: boolean; services?: string[]; violations?: string[]; error?: string }

//? Provision (or update) a service stack: sanitize the compose (reject host-escapes, rewrite host-ports) →
//? persist the SANITIZED compose as the ServiceStack (Conductor is the only writer) → ensure the per-workspace
//? network → `docker compose up -d` under the namespaced project. Injectable runner; Docker failures mark the
//? stack 'error' but keep the row. A sanitizer rejection never touches Docker.
export async function provisionServiceStack(
  prisma: PrismaClient, workspaceId: string, name: string, composeYaml: string,
  opts: { run?: DockerRun } = {},
): Promise<ProvisionResult> {
  const clean = sanitizeCompose(composeYaml);
  if (!clean.ok) return { ok: false, violations: clean.violations };
  const network = stackNetwork(workspaceId);
  const composed = withWorkspaceNetwork(clean.sanitized, network);
  await prisma.serviceStack.upsert({
    where: { workspaceId_name: { workspaceId, name } },
    create: { workspaceId, name, compose: composed, services: clean.services, status: 'stopped' },
    update: { compose: composed, services: clean.services, status: 'stopped' },
  });

  const run = opts.run ?? realRun;
  const file = stackFile(workspaceId, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, composed, 'utf8');
  await run(['network', 'create', network]);
  const up = await run(composeUpArgs(stackProject(workspaceId, name), file));
  const status = up.code === 0 ? 'running' : 'error';
  await prisma.serviceStack.updateMany({ where: { workspaceId, name }, data: { status } });
  return status === 'running' ? { ok: true, services: clean.services } : { ok: false, services: clean.services, error: up.err.slice(0, 200) };
}

//? Tear down a stack: `docker compose down -v` + drop the row + the on-disk file. Injectable runner.
export async function teardownWorkspaceServiceNetwork(workspaceId: string, opts: { run?: DockerRun } = {}): Promise<boolean> {
  if (!(await dockerAvailable())) return false;
  const run = opts.run ?? realRun;
  const network = stackNetwork(workspaceId);
  const list = async (): Promise<string[] | null> => {
    const result = await run(['network', 'ls', '--filter', `name=${network}`, '--format', '{{.Name}}']);
    return result.code === 0
      ? result.out.split('\n').map((value) => value.trim()).filter((value) => value === network)
      : null;
  };
  const existing = await list();
  if (existing === null) return false;
  if (existing.length === 0) return true;
  const removed = await run(['network', 'rm', network]);
  if (removed.code !== 0) return false;
  const remaining = await list();
  return remaining !== null && remaining.length === 0;
}

export async function teardownServiceStack(prisma: PrismaClient, workspaceId: string, name: string, opts: { run?: DockerRun } = {}): Promise<{ ok: boolean }> {
  const run = opts.run ?? realRun;
  const file = stackFile(workspaceId, name);
  const stack = await prisma.serviceStack.findFirst({ where: { workspaceId, name }, select: { status: true } });
  if (!stack) return { ok: true };
  if (existsSync(file)) {
    const down = await run(composeDownArgs(stackProject(workspaceId, name), file));
    if (down.code !== 0) return { ok: false };
  } else if (stack.status !== 'stopped') {
    //? A failed compose up may have created only part of the stack before status='error'. Without
    //? the exact sanitized compose file, `down -v` cannot prove project-container/volume ownership.
    //? Only an explicitly stopped row is safe to discard without that file.
    return { ok: false };
  }
  rmSync(file, { force: true });
  const removed = await prisma.serviceStack.deleteMany({ where: { workspaceId, name } });
  return { ok: removed.count === 1 };
}
