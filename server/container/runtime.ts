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
import { tryCatchSync } from '@luckystack/core';
import { bareMirrorPathFor } from '../git/repoStore';
import { ensureEgressInfra, egressLaunchArgs, egressMode, noteUnconfinedWorker } from './egress';
import { serviceEnvArgs } from './serviceEnv';

const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';
//? Exported so the terminal bridge spawns the SAME docker binary (Windows conpty can't
//? resolve a bare `docker` — WS_DOCKER_BIN carries the full path there).
export const DOCKER_BIN = process.env.WS_DOCKER_BIN ?? 'docker';
//? Port the in-container pty-agent (07b §9, #11) listens on; published to the host loopback per
//? container. Matches PTY_AGENT_PORT in docker/pty-agent/agent.mjs.
export const PTY_AGENT_PORT = Number(process.env.WS_PTY_AGENT_PORT ?? '7681');

export interface DockerResult {
  code: number;
  out: string;
  err: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}

export interface DockerRunOptions {
  timeoutMs?: number;
  //? Cap each captured stream. The retained value is its tail, so diagnostics stay useful without
  //? letting a noisy Docker child retain unbounded output in the Node process.
  maxOutputBytes?: number;
}

//? Run `docker` capturing stdout/stderr. NEVER rejects on a non-zero exit — the caller branches on `code`.
//? The optional timeout is used by untrusted parser/render tools; ordinary runtime calls stay unchanged.
export function docker(args: string[], options: DockerRunOptions = {}): Promise<DockerResult> {
  return new Promise((resolve) => {
    const proc = spawn(DOCKER_BIN, args, { windowsHide: true });
    let out = '';
    let err = '';
    let settled = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const maxOutputBytes = options.maxOutputBytes;

    const stopProcess = (): void => { tryCatchSync(() => { proc.kill('SIGKILL'); }); };
    const finish = (code: number, spawnError?: string): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      const fallbackError = timedOut ? 'docker command timed out' : (outputLimitExceeded ? 'docker command output exceeded its limit' : '');
      resolve({ code, out: out.trim(), err: (spawnError ?? err).trim() || fallbackError, timedOut, outputLimitExceeded });
    };
    const appendOutput = (current: string, data: unknown): string => {
      const chunk = String(data);
      if (maxOutputBytes === undefined || maxOutputBytes <= 0) return current + chunk;
      const next = current + chunk;
      if (Buffer.byteLength(next, 'utf8') <= maxOutputBytes) return next;
      outputLimitExceeded = true;
      return Buffer.from(next, 'utf8').subarray(-maxOutputBytes).toString('utf8');
    };
    const stopForOutputLimit = (): void => {
      if (!outputLimitExceeded) return;
      stopProcess();
      finish(-1);
    };

    proc.stdout.on('data', (data) => { out = appendOutput(out, data); stopForOutputLimit(); });
    proc.stderr.on('data', (data) => { err = appendOutput(err, data); stopForOutputLimit(); });
    proc.on('error', (error) => { finish(-1, error.message); });
    proc.on('close', (code) => { finish(code ?? -1); });

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        stopProcess();
        finish(-1);
      }, options.timeoutMs);
      timer.unref();
    }
  });
}

//? docker object names allow [a-zA-Z0-9][a-zA-Z0-9_.-]; normalize ids/keys to a safe slug.
function safe(s: string): string {
  return s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}
//? T1 — an optional `refSuffix` scopes a container/volume to a specific git ref, so a ref-preview at an OLD
//? commit gets its OWN ephemeral container and never clobbers the ticket's tip worker container.
export function containerName(workspaceId: string, ticketKey: string, refSuffix?: string): string { return `ws-${safe(workspaceId)}-${safe(ticketKey)}${refSuffix ? `-ref-${refSuffix}` : ''}`; }
function volumeName(workspaceId: string, ticketKey: string, refSuffix?: string): string { return `wsvol-${safe(workspaceId)}-${safe(ticketKey)}${refSuffix ? `-ref-${refSuffix}` : ''}`; }
//? R3-b — the container clones from the owning PROJECT's bare mirror (was per-workspace → a 2nd project's
//? ticket would clone the 1st project's repo). Uses the shared legacy-fallback resolution.
const bareMirrorPath = bareMirrorPathFor;

//? T1 — a git ref (SHA / branch / tag) is safe to interpolate into the clone shell ONLY if it's plain
//? `[0-9a-zA-Z._/-]` and carries no `..` (range / path-traversal). Pure + exported for the caller to gate on.
const SAFE_REF = /^[0-9a-zA-Z._/-]{1,200}$/;
export function isSafeRef(ref: string): boolean { return SAFE_REF.test(ref) && !ref.includes('..'); }

//? T1 — a short docker-safe slug for a ref (≤12 normalized chars) → the ref-scoped container/volume/route name.
export function refSlug(ref: string): string { return safe(ref).slice(0, 12) || 'ref'; }

//? T1 — the docker-exec that populates /work: a plain branch-tip clone (the default, unchanged) OR, when a
//? `ref` is given, a FULL-history clone + `git checkout <ref>` (detached for a SHA) so any commit is previewable.
//? The ref MUST be pre-validated with `isSafeRef` (the caller does). Pure + exported for tests.
export function cloneExecArgs(name: string, branch: string, ref?: string): string[] {
  if (ref !== undefined && ref.length > 0) {
    return ['exec', name, 'sh', '-lc', `git clone /mirror /work && git -C /work checkout ${ref}`];
  }
  return ['exec', name, 'git', 'clone', '--branch', branch, '--single-branch', '/mirror', '/work'];
}

export interface ContainerInfo { containerId: string; name: string; volume: string; created: boolean }
export interface WorkerContainerIdentity {
  workspaceId: string;
  projectId: string;
  ticketKey: string;
  containerId: string;
  name: string;
}
export interface ContainerExecutionIdentity { projectId: string; ref: string; intentId: string }

export async function containerMatchesExecutionIdentity(name: string, identity: ContainerExecutionIdentity): Promise<boolean> {
  const result = await docker([
    'inspect', '-f',
    '{{index .Config.Labels "org.workspaces.project"}}\t{{index .Config.Labels "org.workspaces.ref"}}\t{{index .Config.Labels "org.workspaces.intent"}}',
    name,
  ]);
  return result.code === 0 && result.out === `${identity.projectId}\t${identity.ref}\t${identity.intentId}`;
}

//? Public CI may stamp a diagnostic owner label on its immutable, intent-scoped container.
//? Stage ownership is mutable across reuse and therefore lives inside /work/.workspaces-run-owner.
export async function containerRunToken(name: string): Promise<string | null> {
  const result = await docker(['inspect', '-f', '{{index .Config.Labels "org.workspaces.run-token"}}', name]);
  return result.code === 0 && result.out.length > 0 ? result.out : null;
}

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
export async function launchTicketContainer(args: { workspaceId: string; projectId: string; ticketKey: string; branch: string; image?: string; ref?: string; runToken?: string; executionIdentity?: ContainerExecutionIdentity; env?: Record<string, string>; serviceNetwork?: string }): Promise<ContainerInfo | null> {
  const { workspaceId, projectId, ticketKey, branch, ref } = args;
  //? Prefer the project's L2 image (Q-CT-IMAGESEL) when the caller resolved one, else L1.
  const image = args.image ?? BASE_IMAGE;
  const mirror = bareMirrorPath(workspaceId, projectId);
  if (!existsSync(mirror)) return null;
  //? T1 — a ref-preview gets its OWN ephemeral container/volume (ref-scoped name), so it never disturbs the
  //? ticket's tip worker container and two refs of one branch can run side by side.
  const suffix = ref !== undefined && ref.length > 0 ? refSlug(ref) : undefined;
  const name = containerName(workspaceId, ticketKey, suffix);
  const volume = volumeName(workspaceId, ticketKey, suffix);

  //? Reuse an existing container (re-activation / re-entry) instead of recreating.
  const existing = await docker(['inspect', '-f', '{{.State.Running}}', name]);
  if (existing.code === 0) {
    if (args.executionIdentity && !(await containerMatchesExecutionIdentity(name, args.executionIdentity))) {
      throw new Error('container execution identity mismatch');
    }
    if (existing.out !== 'true') {
      const started = await docker(['start', name]);
      if (started.code !== 0) throw new Error('container restart failed');
    }
    //? K3 — ensure a reused container is on the per-workspace service network (idempotent; harmless if already connected).
    if (args.serviceNetwork) await docker(['network', 'connect', args.serviceNetwork, name]);
    const id = await docker(['inspect', '-f', '{{.Id}}', name]);
    return id.code === 0 && id.out.length > 0 ? { containerId: id.out, name, volume, created: false } : null;
  }

  //? RO subscription-auth projection (07b §2): mount the host's ONE-TIME login creds
  //? read-only; the stage-runner copies them per-container into a writable agent-owned
  //? ~/.claude before driving claude (so no container refreshes the shared file, and the
  //? 0600 copy passes the CLI's permission check — the RO Windows mount is 0777).
  const authDir = process.env.WS_AUTH_DIR ?? path.join(process.cwd(), 'data', '_auth');
  //? Mount the creds RO + pin CLAUDE_CONFIG_DIR to a FIXED path (docker exec sets no HOME,
  //? so `~/.claude` is ambiguous — the spike proved an explicit dir works). The stage-runner
  //? copies the RO creds into this writable agent-owned dir before driving claude.
  const authMount = existsSync(path.join(authDir, '.credentials.json'))
    ? ['-v', `${authDir}:/auth-ro:ro`, '-e', 'CLAUDE_CONFIG_DIR=/home/agent/.claude']
    : [];

  //? Egress control (§6). WS_EGRESS=1 confines the worker to an allowlist proxy on an internal network.
  //? GAP_SCAN E3 — when it is NOT enforced the launch is now RECORDED (report mode) instead of silently
  //? granting the container the open internet; the report is what justifies flipping enforcement on.
  await ensureEgressInfra();
  if (egressMode() === 'report') noteUnconfinedWorker();
  await docker(['volume', 'create', volume]);
  const run = await docker([
    'run', '-d', '--name', name, '--hostname', safe(ticketKey),
    '-v', `${volume}:/work`, '-v', `${mirror}:/mirror:ro`, ...authMount,
    //? §7 hardening — NEVER run without these.
    '--user', 'agent', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '512', '--memory', '3g', '--memory-swap', '3g', '--cpus', '2',
    '--restart', 'unless-stopped',
    //? Publish the in-container pty-agent (07b §9, #11) to the host loopback on an ephemeral port;
    //? the terminal bridge resolves it via `docker inspect` (ptyAgentClient.resolvePtyAgentPort).
    '-p', `127.0.0.1::${String(PTY_AGENT_PORT)}`,
    //? K3 — the workspace's app env (service connection strings + BYO EnvVars, `__`-internal keys filtered out).
    ...serviceEnvArgs(args.env ?? {}),
    ...egressLaunchArgs(),
    '--label', `org.workspaces.workspace=${workspaceId}`, '--label', `org.workspaces.ticket=${ticketKey}`,
    '--label', `org.workspaces.project=${projectId}`,
    ...(args.runToken && args.executionIdentity ? ['--label', `org.workspaces.run-token=${args.runToken}`] : []),
    ...(args.executionIdentity ? [
      '--label', `org.workspaces.ref=${args.executionIdentity.ref}`,
      '--label', `org.workspaces.intent=${args.executionIdentity.intentId}`,
    ] : []),
    image,
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
  const clone = await docker(cloneExecArgs(name, branch, ref));
  if (clone.code !== 0) {
    await docker(['rm', '-f', name]);
    await docker(['volume', 'rm', '-f', volume]);
    throw new Error(`worktree clone failed: ${clone.err}`);
  }
  //? K3 — join the per-workspace service network so the app can reach its K1/K2 services by name (best-effort).
  if (args.serviceNetwork) await docker(['network', 'connect', args.serviceNetwork, name]);
  return { containerId, name, volume, created: true };
}

//? List a workspace's RUNNING ticket containers (by label) → their ticket + container
//? name, so the terminals page can render one live shell per active ticket. [] when
//? Docker is down or nothing is running.
export async function listWorkspaceContainers(workspaceId: string): Promise<{ ticketKey: string; container: string }[]> {
  const r = await docker(['ps', '--filter', `label=org.workspaces.workspace=${workspaceId}`, '--format', '{{.Names}}\t{{.Label "org.workspaces.ticket"}}']);
  if (r.code !== 0 || r.out.length === 0) return [];
  return r.out.split('\n').map((line) => {
    const [container, ticketKey] = line.split('\t');
    return { container: (container ?? '').trim(), ticketKey: (ticketKey ?? '').trim() };
  }).filter((c) => c.container.length > 0 && c.ticketKey.length > 0);
}

function parseWorkerIdentity(row: string): WorkerContainerIdentity | null {
  const [containerId, name, workspaceId, projectId, ticketKey] = row.split('\t').map((value) => value.trim());
  if (!containerId || !name || !workspaceId || !projectId || !ticketKey) return null;
  return { containerId, name: name.replace(/^\//, ''), workspaceId, projectId, ticketKey };
}

//? Host-global, read-only runtime enumeration. `--no-trunc` makes containerId the exact
//? immutable Docker identity; callers must never key this list by ticketKey alone.
export async function listRunningWorkerContainers(): Promise<WorkerContainerIdentity[]> {
  const result = await docker([
    'ps', '--no-trunc', '--filter', 'label=org.workspaces.ticket',
    '--format', '{{.ID}}\t{{.Names}}\t{{.Label "org.workspaces.workspace"}}\t{{.Label "org.workspaces.project"}}\t{{.Label "org.workspaces.ticket"}}',
  ]);
  if (result.code !== 0 || result.out.length === 0) return [];
  return result.out.split('\n').map((row) => parseWorkerIdentity(row)).filter((identity): identity is WorkerContainerIdentity => identity !== null);
}

//? Re-inspect one immutable container id immediately before an external recovery action.
//? Label/name mismatches fail closed instead of falling back to the reusable ticket name.
export async function inspectWorkerContainer(containerId: string): Promise<WorkerContainerIdentity | null> {
  const result = await docker([
    'inspect', '-f',
    '{{.Id}}\t{{.Name}}\t{{index .Config.Labels "org.workspaces.workspace"}}\t{{index .Config.Labels "org.workspaces.project"}}\t{{index .Config.Labels "org.workspaces.ticket"}}',
    containerId,
  ]);
  return result.code === 0 ? parseWorkerIdentity(result.out) : null;
}

export async function workerContainerRunning(containerId: string): Promise<boolean | null> {
  const result = await docker(['inspect', '-f', '{{.State.Running}}', containerId]);
  if (result.code !== 0) return null;
  return result.out === 'true' ? true : (result.out === 'false' ? false : null);
}

//? Is `name` one of OUR containers (carries the workspace label)? Generic host-side recovery code may
//? use this broad check, but user-facing terminal/file routes MUST use the exact workspace+ticket check below.
export async function isWorkspacesContainer(name: string): Promise<boolean> {
  const r = await docker(['inspect', '-f', '{{index .Config.Labels "org.workspaces.workspace"}}', name]);
  return r.code === 0 && r.out.length > 0;
}

//? A browser terminal may only enter the canonical container for the exact workspace+ticket it requested.
//? Checking both immutable labels and the derived name prevents a caller from naming another tenant's
//? Workspaces container (the old `isWorkspacesContainer`-only gate accepted any labelled container).
export async function isWorkspaceTicketContainer(name: string, workspaceId: string, ticketKey: string): Promise<boolean> {
  if (name !== containerName(workspaceId, ticketKey)) return false;
  const result = await docker([
    'inspect', '-f',
    '{{index .Config.Labels "org.workspaces.workspace"}}\t{{index .Config.Labels "org.workspaces.ticket"}}',
    name,
  ]);
  return result.code === 0 && result.out === `${workspaceId}\t${ticketKey}`;
}

//? Remove the ticket's container + its worktree volume (ticket teardown, §4/§7).
export async function teardownTicketContainer(workspaceId: string, ticketKey: string, ref?: string): Promise<void> {
  const suffix = ref !== undefined && ref.length > 0 ? refSlug(ref) : undefined;
  const name = containerName(workspaceId, ticketKey, suffix);
  await docker(['rm', '-f', name]);
  await docker(['volume', 'rm', '-f', volumeName(workspaceId, ticketKey, suffix)]);
}

//? Destructive workspace deletion cannot discard DB ownership while labelled ticket/editor/ref
//? containers or their named worktree volumes still exist. Enumerate by immutable workspace label,
//? remove every state (running and stopped), then prove both containers and mounted volumes are gone.
export async function teardownWorkspaceContainers(workspaceId: string): Promise<boolean> {
  if (!(await dockerAvailable())) return false;
  const [listed, listedVolumes] = await Promise.all([
    docker(['ps', '-aq', '--filter', `label=org.workspaces.workspace=${workspaceId}`]),
    docker(['volume', 'ls', '-q', '--filter', `name=wsvol-${safe(workspaceId)}-`]),
  ]);
  if (listed.code !== 0 || listedVolumes.code !== 0) return false;
  const containerIds = listed.out.split('\n').map((value) => value.trim()).filter((value) => value.length > 0);
  const volumePrefix = `wsvol-${safe(workspaceId)}-`;
  const volumes = new Set(listedVolumes.out.split('\n')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(volumePrefix)));
  for (const containerId of containerIds) {
    const mounts = await docker(['inspect', '-f', '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}', containerId]);
    if (mounts.code !== 0) return false;
    for (const name of mounts.out.split('\n').map((value) => value.trim()).filter((value) => value.length > 0)) volumes.add(name);
  }
  if (containerIds.length > 0) {
    const removed = await docker(['rm', '-f', ...containerIds]);
    if (removed.code !== 0) return false;
  }
  for (const containerId of containerIds) {
    const stillThere = await docker(['inspect', '-f', '{{.Id}}', containerId]);
    if (stillThere.code === 0) return false;
  }
  for (const volume of volumes) {
    await docker(['volume', 'rm', '-f', volume]);
    const volumeStillThere = await docker(['volume', 'inspect', volume]);
    if (volumeStillThere.code === 0) return false;
  }
  return true;
}
