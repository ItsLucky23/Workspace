//? Container-runtime spine (07b §0/§3/§4/§7). A ticket that enters an `aiEnabled` stage
//? gets ONE hardened container bound to its `DEV-####` checkout. Per §4 (Q-CT-WORKTREE) we
//? do NOT bind-mount the host worktree (its .git is a dangling gitdir pointer inside the
//? container) — instead the frozen branch is `git clone --single-branch`d into a
//? container-owned named volume. Idempotency is name-based (no schema change): an existing
//? container is reused. V1 lane-F scope = L1 base + provisioning skeleton; auth projection
//? (§2), egress proxy (§6), Caddy networking (§5), CapacityManager (§8) and the in-container
//? pty-agent (§9) are later slices — flagged, not silently omitted.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { workspaceDataDir } from '../git/repoStore';

const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';
//? Exported so the terminal bridge spawns the SAME docker binary (Windows conpty can't
//? resolve a bare `docker` — WS_DOCKER_BIN carries the full path there).
export const DOCKER_BIN = process.env.WS_DOCKER_BIN ?? 'docker';

interface DockerResult { code: number; out: string; err: string }

//? Run `docker` capturing stdout/stderr. NEVER rejects on a non-zero exit — the caller
//? branches on `code` so partial-launch rollback (§8.3) stays explicit.
function docker(args: string[]): Promise<DockerResult> {
  return new Promise((resolve) => {
    const proc = spawn(DOCKER_BIN, args, { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', (e) => { resolve({ code: -1, out: '', err: e.message }); });
    proc.on('close', (code) => { resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }); });
  });
}

//? docker object names allow [a-zA-Z0-9][a-zA-Z0-9_.-]; normalize ids/keys to a safe slug.
function safe(s: string): string {
  return s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}
export function containerName(workspaceId: string, ticketKey: string): string { return `ws-${safe(workspaceId)}-${safe(ticketKey)}`; }
function volumeName(workspaceId: string, ticketKey: string): string { return `wsvol-${safe(workspaceId)}-${safe(ticketKey)}`; }
function bareMirrorPath(workspaceId: string): string { return path.join(workspaceDataDir(workspaceId), 'repo.git'); }

export interface ContainerInfo { containerId: string; name: string; volume: string }

//? Is the Docker daemon reachable? Gates every launch — a host without Docker simply
//? never provisions containers (the git/worktree layer already works standalone).
export async function dockerAvailable(): Promise<boolean> {
  const r = await docker(['info', '--format', '{{.ServerVersion}}']);
  return r.code === 0 && r.out.length > 0;
}

//? Launch (or reuse) the ticket's container. Idempotent by name: a live container is
//? reused, a stopped one is restarted. A fresh launch creates the volume, runs the
//? hardened container mounting the volume (+ the bare mirror RO as the clone source),
//? then clones the frozen `DEV-####` branch into `/work` AS the agent user (so the
//? checkout is agent-owned). Rolls back the volume/container on a partial failure (§8.3).
//? Returns null when no repo is linked (no mirror to clone).
export async function launchTicketContainer(args: { workspaceId: string; ticketKey: string; branch: string }): Promise<ContainerInfo | null> {
  const { workspaceId, ticketKey, branch } = args;
  const mirror = bareMirrorPath(workspaceId);
  if (!existsSync(mirror)) return null;
  const name = containerName(workspaceId, ticketKey);
  const volume = volumeName(workspaceId, ticketKey);

  //? Reuse an existing container (re-activation / re-entry) instead of recreating.
  const existing = await docker(['inspect', '-f', '{{.State.Running}}', name]);
  if (existing.code === 0) {
    if (existing.out !== 'true') await docker(['start', name]);
    const id = await docker(['inspect', '-f', '{{.Id}}', name]);
    return { containerId: id.out, name, volume };
  }

  await docker(['volume', 'create', volume]);
  const run = await docker([
    'run', '-d', '--name', name, '--hostname', safe(ticketKey),
    '-v', `${volume}:/work`, '-v', `${mirror}:/mirror:ro`,
    //? §7 hardening — NEVER run without these.
    '--user', 'agent', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '512', '--memory', '3g', '--memory-swap', '3g', '--cpus', '2',
    '--restart', 'unless-stopped',
    '--label', `org.workspaces.workspace=${workspaceId}`, '--label', `org.workspaces.ticket=${ticketKey}`,
    BASE_IMAGE,
  ]);
  if (run.code !== 0) {
    await docker(['volume', 'rm', '-f', volume]);
    throw new Error(`container launch failed: ${run.err}`);
  }
  const containerId = run.out;

  //? Populate the worktree = clone the frozen branch into the volume (as agent). The
  //? branch was cut at the frozen commit (phase 1b), so its tip IS that commit — no
  //? detaching checkout needed; the branch stays put until the agent commits.
  //? (dubious-ownership on the host-uid-owned /mirror is handled by the baked
  //? `safe.directory=*` system config in L1 — `-c` is ignored by git for this key.)
  const clone = await docker(['exec', name, 'git', 'clone', '--branch', branch, '--single-branch', '/mirror', '/work']);
  if (clone.code !== 0) {
    await docker(['rm', '-f', name]);
    await docker(['volume', 'rm', '-f', volume]);
    throw new Error(`worktree clone failed: ${clone.err}`);
  }
  return { containerId, name, volume };
}

//? Is `name` one of OUR containers (carries the workspace label)? The terminal bridge
//? MUST gate `docker exec` on this — it must never exec into an arbitrary host container.
export async function isWorkspacesContainer(name: string): Promise<boolean> {
  const r = await docker(['inspect', '-f', '{{index .Config.Labels "org.workspaces.workspace"}}', name]);
  return r.code === 0 && r.out.length > 0;
}

//? Remove the ticket's container + its worktree volume (ticket teardown, §4/§7).
export async function teardownTicketContainer(workspaceId: string, ticketKey: string): Promise<void> {
  const name = containerName(workspaceId, ticketKey);
  await docker(['rm', '-f', name]);
  await docker(['volume', 'rm', '-f', volumeName(workspaceId, ticketKey)]);
}
