//? Stage-runner — the autonomous per-stage execution loop (07 §A step 6-7). For a ticket
//? in an aiEnabled stage it renders the stage config into the container, drives an
//? in-container `claude` turn on the ticket (subscription-billed interactive PTY, NEVER
//? `-p`), parses the turn result, and persists the carry-over for the next stage. Runs OFF
//? the Conductor serial chain (the turn is minutes-long). The container-auth spike (07b §2)
//? proved container-claude authenticates via the projected creds — this is that engine.

import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import * as pty from 'node-pty';
import type { PrismaClient } from '@prisma/client';
import { tryCatch, tryCatchSync, getPrismaClient } from '@luckystack/core';
import { docker, DOCKER_BIN, isWorkspacesContainer, launchTicketContainer, teardownTicketContainer, type ContainerInfo, type DockerResult } from '../container/runtime';
import { startProcesses } from '../container/runtimeProcesses';
import { resolveProjectBaseImage } from '../container/baseImages';
import { workspaceContainerContext } from '../container/composeEngine';
import { isTestStage } from '../ci/gate';
import { runStageCiInContainer, type StageCiReport } from '../ci/runner';

import { renderStage, type StageArtifacts, type McpIntegration } from './renderStage';
import type { StageProcessCfg, StageToolCfg } from '../../src/workspaces/_data/types';
import { decryptSecret } from '../crypto/secretBox';
import { loadTicketArtifactContext } from './artifactContext';
import { toStageConfig } from '../read/workspaceSnapshot';
import { broadcastTicketDelta, broadcastAgentTerm } from '../read/broadcast';
import { pushTicketWork } from '../git/forge';
import { pushContainerBranch } from '../git/containerPush';
import { postIssueComment } from '../git/gitlabSync';
import { retrieve } from '../rag';
import { retrieveProductKnowledge } from '../rag/productKnowledge';
import { skillPromptBlock } from '../ai/skills';
import { workspaceAiPrefix } from '../ai/registry';
import { budgetForStage, shouldHandoff, parseHandoff, latestHandoff, renderHandoffReload, DEFAULT_HANDOFF_INSTRUCTION } from './handoff';
import { killClaudeByContainer } from './agentControl';
import { waitForOutput, matchesReady, matchesTrustOrReady } from './ptyReady';
import { parseTurnResult, type CarryOverEnvelope, type TurnResult } from './turnResult';
import { parseToolTrail } from './toolTrail';
import { resolveModelChoice, buildTurnArgs } from './modelSelect';
import { runInTenant } from '../tenant/tenantContext';
import { enqueueInternalAction, type StageRunTarget, type StageTurnCompleteInternalAction } from './internalOps';
import { currentWriterScope } from './writerContext';
import { reservationOwnsSlot, type ReservationGuard } from './capacity';
import { stageForgeIntentId } from './actionIds';
import {
  readStageForgeCompleteResult,
  readStageForgePrepareResult,
  readStageSessionStartResult,
  readStageToolTrailResult,
  readStageTurnCompleteResult,
  reloadStageTurnCompleteResult,
  stageActionPersisted,
  stageActionResultKeys,
  type StageTurnCompleteResult,
} from './stageWriter';

export { resolveStageGate } from './stageWriter';

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
const CAPTURE = '/work/.claude/turn-stop.json';
//? GAP_SCAN D2 — the PostToolUse hook appends one JSON line per tool call here; drained after each turn.
const TOOL_TRAIL = '/work/.claude/tool-calls.jsonl';
const TURN_MARKER = '/work/.claude/stage-turn-marker';
const RUN_OWNER = '/work/.workspaces-run-owner';
const RUN_OWNER_LOCK = '/work/.workspaces-run-owner.lock';

export interface StageRunOwner { runToken: string; runFence: number }

function stageRunOwnerValue(owner: StageRunOwner): string | null {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(owner.runToken) || !Number.isSafeInteger(owner.runFence) || owner.runFence <= 0) return null;
  return `${String(owner.runFence)}:${owner.runToken}`;
}

export async function readStageContainerOwner(
  container: string,
  runDocker: (args: string[]) => Promise<DockerResult> = docker,
): Promise<StageRunOwner | null> {
  const result = await runDocker(['exec', container, 'sh', '-c', `cat ${RUN_OWNER} 2>/dev/null || true`]);
  if (result.code !== 0) return null;
  const match = /^(\d+):([A-Za-z0-9._:-]{1,128})$/.exec(result.out.trim());
  if (!match) return null;
  const runFence = Number(match[1]);
  return Number.isSafeInteger(runFence) && runFence > 0 ? { runFence, runToken: match[2] ?? '' } : null;
}

export async function verifyStageContainerOwner(
  container: string,
  owner: StageRunOwner,
  runDocker: (args: string[]) => Promise<DockerResult> = docker,
): Promise<boolean> {
  const expected = stageRunOwnerValue(owner);
  const current = await readStageContainerOwner(container, runDocker);
  return expected !== null && current !== null && stageRunOwnerValue(current) === expected;
}

export interface StageContainerOwnershipDependencies {
  runDocker?: (args: string[]) => Promise<DockerResult>;
  ownsSlot?: typeof reservationOwnsSlot;
  killOldProcess?: typeof killClaudeByContainer;
}

//? A ticket container's volume survives stage owners. A successor may claim that reusable
//? worktree only after Redis proves its new token+fence; the old Claude process is killed
//? before the marker is atomically replaced. Git state and tool-trail recovery files remain.
export async function ensureStageContainerOwnership(
  container: string,
  workspaceId: string,
  ticketKey: string,
  owner: StageRunOwner,
  dependencies: StageContainerOwnershipDependencies = {},
): Promise<boolean> {
  const expected = stageRunOwnerValue(owner);
  if (expected === null) return false;
  const runDocker = dependencies.runDocker ?? docker;
  const acquiredLock = await runDocker(['exec', container, 'sh', '-c', `mkdir ${RUN_OWNER_LOCK}`]);
  if (acquiredLock.code !== 0) return false;

  const [takeoverError, taken] = await tryCatch(async () => {
    const markerMatches = await verifyStageContainerOwner(container, owner, runDocker);
    const ownsSlot = dependencies.ownsSlot ?? reservationOwnsSlot;
    if (!(await ownsSlot(workspaceId, ticketKey, owner.runToken, owner.runFence))) return false;
    if (markerMatches) return true;
    const killOldProcess = dependencies.killOldProcess ?? killClaudeByContainer;
    if (!(await killOldProcess(container))) return false;
    //? A may pause in/after kill while its short lease expires and B acquires Redis.
    //? Recheck while the file lock is still held before A can overwrite B's marker.
    if (!(await ownsSlot(workspaceId, ticketKey, owner.runToken, owner.runFence))) return false;
    const encoded = Buffer.from(expected, 'utf8').toString('base64');
    const replaced = await runDocker([
      'exec', container, 'sh', '-c',
      `tmp=${RUN_OWNER}.tmp.$$; printf '%s' '${encoded}' | base64 -d > "$tmp" && mv "$tmp" ${RUN_OWNER} && rm -f ${CAPTURE}`,
    ]);
    return replaced.code === 0 && await verifyStageContainerOwner(container, owner, runDocker);
  });
  const releasedLock = await runDocker(['exec', container, 'sh', '-c', `rmdir ${RUN_OWNER_LOCK}`]);
  return takeoverError === null && taken === true && releasedLock.code === 0;
}

//? Write a small text file INTO the container volume as `agent` (the worktree is a docker
//? volume, not a host path — 07b §4). base64 round-trip so any content is shell-safe.
async function writeFileInContainer(container: string, filePath: string, content: string): Promise<boolean> {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const dir = filePath.slice(0, filePath.lastIndexOf('/'));
  const r = await docker(['exec', container, 'sh', '-c', `mkdir -p '${dir}' && printf '%s' '${b64}' | base64 -d > '${filePath}'`]);
  return r.code === 0;
}

//? Materialize the rendered stage artifacts into the container worktree (07 §A step 6).
export async function materializeStageConfig(container: string, artifacts: StageArtifacts): Promise<boolean> {
  if (!(await isWorkspacesContainer(container))) return false;
  const writes: [string, string][] = [
    ['/work/CLAUDE.md', artifacts.claudeMd],
    ['/work/.claude/settings.json', artifacts.settingsJson],
    ['/work/.claude/stage-instructions.txt', artifacts.stageInstructions],
    ['/work/.mcp.json', artifacts.mcpJson],
  ];
  for (const [path, content] of writes) {
    if (!(await writeFileInContainer(container, path, content))) return false;
  }
  return true;
}

//? F29 — start the stage's declared long-running PROCESSES (a dev server, a watcher, …).
//?
//? These were configurable in the stage editor and rendered as terminal tabs on the ticket, but nothing
//? ever ran them: opening the "server" tab attached to a bare shell in the image's default directory. The
//? tab existed, the process did not — a UI that lies about what is running.
//?
//? Each process runs detached with its own cwd + env, and its output is teed to a per-process log on the
//? /work volume so the terminal tab can show what it actually did. Best-effort: a stage must still run
//? when a user's dev-server command is wrong, so a failure is logged, not fatal.
async function startStageProcesses(container: string, processes: StageProcessCfg[]): Promise<void> {
  //? ADR 0317 — one implementation, shared with the project runtime. The stage list stays as the
  //? per-stage EXTRA (a test stage that also wants a fixture server); the app's own processes now live
  //? on the project, which is where a user looks for them and where they stop changing per stage.
  await startProcesses(container, processes);
}

//? Copy the RO-projected subscription creds into a writable, agent-owned ~/.claude (0600)
//? so the CLI's permission check passes (the RO Windows mount is 0777) and no container
//? ever writes the shared source. Also clears any stale turn-capture. Idempotent.
//? The managed-token refresh loop, on-demand (07b §2.2): the projected token is short-lived
//? and the HOST's `claude` keeps its own copy fresh, so re-copy the live host creds into the
//? RO-mounted projection dir before each turn. Without this, container-claude hits
//? "Not logged in" once the initial copy expires (~hours). Best-effort, host-side.
function refreshProjectedAuth(): void {
  const authDir = process.env.WS_AUTH_DIR ?? path.join(process.cwd(), 'data', '_auth');
  const hostCreds = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), '.credentials.json');
  if (existsSync(hostCreds) && existsSync(authDir)) {
    tryCatchSync(() => { copyFileSync(hostCreds, path.join(authDir, '.credentials.json')); });
  }
}

export async function projectAuth(
  container: string,
  runDocker: (args: string[]) => Promise<DockerResult> = docker,
): Promise<void> {
  //? FIXED path (matches the container's CLAUDE_CONFIG_DIR env) — never `~` (docker exec
  //? sets no HOME, so `~` would resolve wrong and claude would fall into the login flow).
  //? Also give the worktree a git identity (local, agent-owned) so a code stage's
  //? `git commit` succeeds instead of hanging on "who are you".
  await runDocker(['exec', container, 'sh', '-c',
    'mkdir -p /home/agent/.claude && cp /auth-ro/.credentials.json /auth-ro/.claude.json /home/agent/.claude/ 2>/dev/null; chmod 700 /home/agent/.claude 2>/dev/null; chmod 600 /home/agent/.claude/.credentials.json 2>/dev/null; '
    + 'git -C /work config user.name "Workspaces AI" 2>/dev/null; git -C /work config user.email "ai@workspaces.local" 2>/dev/null; '
    + 'rm -f ' + CAPTURE + '; true']);
}

export function claudeAuthStatusLoggedIn(raw: string): boolean {
  const [error, parsed] = tryCatchSync(() => JSON.parse(raw) as unknown);
  return !error && parsed !== null && typeof parsed === 'object' && 'loggedIn' in parsed
    && (parsed as { loggedIn?: unknown }).loggedIn === true;
}

export async function containerClaudeAuthenticated(
  container: string,
  runDocker: (args: string[]) => Promise<DockerResult> = docker,
): Promise<boolean> {
  const result = await runDocker(['exec', container, 'claude', 'auth', 'status']);
  return result.code === 0 && claudeAuthStatusLoggedIn(result.out);
}

//? Drive ONE interactive `claude` turn inside the container and return its final message.
//? The result is captured off the in-container Stop hook (settings.json writes it to CAPTURE)
//? — NOT by parsing the PTY. We NEVER call `term.kill()` (its Windows conpty console-list
//? agent can crash the host process); instead `pkill` claude inside the container so the
//? `docker exec` exits and the PTY closes naturally.
export async function driveContainerTurn(container: string, kickoff: string, opts: { timeoutMs?: number; resumeSessionId?: string; workspaceId?: string; ticketKey?: string; model?: string; runOwner?: StageRunOwner } = {}): Promise<{ ok: boolean; message: string; claudeSessionId?: string; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 240_000;
  if (!(await isWorkspacesContainer(container))) return { ok: false, message: '', error: 'container.notOurs' };
  //? Every PTY drive, including the self-handoff drive, rechecks both the mutable
  //? volume marker and Redis authority. A matching stale marker alone cannot relaunch Claude.
  if (opts.runOwner && (
    !opts.workspaceId
    || !opts.ticketKey
    || !(await reservationOwnsSlot(opts.workspaceId, opts.ticketKey, opts.runOwner.runToken, opts.runOwner.runFence))
    || !(await verifyStageContainerOwner(container, opts.runOwner))
  )) return { ok: false, message: '', error: 'stage.ownerMismatch' };
  refreshProjectedAuth();   //? keep the projected token fresh (07b §2.2 refresh loop)
  await projectAuth(container);
  //? `claude --version` only proves the binary. Fail before opening a PTY when the
  //? projected Max-subscription login is absent/expired, rather than burning repeated
  //? four-minute timeout turns that can never produce a Stop-hook capture.
  if (!(await containerClaudeAuthenticated(container))) return { ok: false, message: '', error: 'claude.notAuthenticated' };

  //? bypassPermissions: the agent runs autonomously INSIDE the hardened, isolated,
  //? disposable container (cap-drop ALL, non-root, no host access) — the CONTAINER is the
  //? security boundary, so in-agent permission prompts only stall the turn. The stage
  //? instructions (+ the settings deny set as defense-in-depth) shape what it does.
  //? `--resume <id>` continues an interrupted session verbatim (crash-recovery, #1) rather than
  //? starting a fresh conversation — the CLI restores the transcript, so the kickoff just nudges it on.
  //? `--model` = the stage's RESOLVED model choice (base or an escalation rule) — the argv is
  //? built by the pure buildTurnArgs so the spawn-args are unit-testable (modelSelect).
  const term = pty.spawn(DOCKER_BIN, ['exec', '-it', container, 'claude', ...buildTurnArgs({ ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}), ...(opts.model ? { model: opts.model } : {}) })], {
    name: 'xterm-color', cols: 120, rows: 34, cwd: process.cwd(), env: process.env,
  });
  //? Object property (not a local) so TS doesn't treat the onExit-mutated flag as constant.
  const state = { exited: false };
  term.onExit(() => { state.exited = true; });
  //? Accumulate PTY output (capped) so prompt-ready detection can scan it — the TURN result still
  //? comes from the Stop hook, not the PTY (C4 only uses the stream to time the handshake).
  const buf = { text: '' };
  //? #20 — optional live tail: batch PTY output (300ms) → broadcast to the ticket's Live-agent channel.
  //? Throttled so a chatty turn can't storm the room; observability only (never gates/echoes the turn).
  const tail = opts.workspaceId && opts.ticketKey ? { wsId: opts.workspaceId, key: opts.ticketKey, pending: '', timer: null as ReturnType<typeof setTimeout> | null } : null;
  const flushTail = (): void => { if (tail && tail.pending.length > 0) { const chunk = tail.pending; tail.pending = ''; broadcastAgentTerm(tail.wsId, tail.key, chunk); } };
  term.onData((d: string) => {
    buf.text = (buf.text + d).slice(-8000);
    if (tail) {
      tail.pending = (tail.pending + d).slice(-16_000);
      tail.timer ??= setTimeout(() => { tail.timer = null; flushTail(); }, 300);
    }
  });

  //? Boot handshake — wait until the trust prompt OR the input prompt actually appears (early-exit),
  //? with a ceiling so a wrong/missing marker degrades to a bounded wait rather than a hang (C4).
  await waitForOutput(() => buf.text, matchesTrustOrReady, { timeoutMs: 12_000 });
  term.write('\r'); // confirm folder-trust (harmless if already trusted)
  //? Then wait for the input prompt to be ready before sending the kickoff.
  await waitForOutput(() => buf.text, matchesReady, { timeoutMs: 8000 });
  term.write(kickoff); await wait(1200); term.write('\r'); await wait(1500); term.write('\r');

  //? Poll for the Stop-hook capture (turn end) up to the timeout.
  const deadline = Date.now() + timeoutMs;
  let captured = '';
  while (Date.now() < deadline && captured.length === 0) {
    await wait(2500);
    const r = await docker(['exec', container, 'sh', '-c', `cat ${CAPTURE} 2>/dev/null`]);
    if (r.code === 0 && r.out.length > 0) captured = r.out;
  }
  //? Stop claude IN the container → the docker-exec PTY exits on its own (no term.kill()).
  //? Procps-free (/proc walk): `pkill` silently no-op'd — ps/pgrep aren't in the base image.
  await killClaudeByContainer(container);
  for (let i = 0; i < 12 && !state.exited; i++) await wait(300);
  //? #20 — flush any buffered tail chunk + cancel the pending timer so nothing leaks past the turn.
  if (tail?.timer) { clearTimeout(tail.timer); tail.timer = null; }
  flushTail();

  if (captured.length === 0) return { ok: false, message: '', error: 'turn.timeout' };
  const [, payload] = await tryCatch(() => Promise.resolve(JSON.parse(captured) as { last_assistant_message?: unknown; session_id?: unknown }));
  const message = (payload && typeof payload.last_assistant_message === 'string') ? payload.last_assistant_message : '';
  const claudeSessionId = (payload && typeof payload.session_id === 'string') ? payload.session_id : undefined;
  return { ok: true, message, ...(claudeSessionId ? { claudeSessionId } : {}) };
}

function stageDigest(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function shouldRetryStageFailure(error: string | undefined): boolean {
  return error !== 'claude.notAuthenticated';
}

export function stableStageCompletionId(input: { runToken: string; runFence: number; turnMarker: string; message: string; report: StageCiReport | null }): string {
  return stageDigest(
    input.runToken,
    String(input.runFence),
    input.turnMarker,
    stageDigest(input.message),
    stageDigest(JSON.stringify(input.report)),
  );
}

export function stableStageHandoffId(input: { runToken: string; runFence: number; turnMarker: string; claudeSessionId: string; body: unknown; reason: string }): string {
  return stageDigest(
    input.runToken,
    String(input.runFence),
    input.turnMarker,
    input.claudeSessionId,
    stageDigest(JSON.stringify(input.body)),
    input.reason,
  );
}

export interface ToolTrailPersistenceDependencies {
  runDocker?: (args: string[]) => Promise<DockerResult>;
  enqueue?: typeof enqueueInternalAction;
}

//? This random-looking marker is persisted in the ticket volume. A crash, failed cleanup,
//? or successor reservation keeps it, so retained JSONL lines keep the same per-entry IDs.
async function ensurePersistentTurnMarker(
  container: string,
  proposedMarker: string,
  runDocker: (args: string[]) => Promise<DockerResult> = docker,
): Promise<string | null> {
  if (!/^[a-f\d]{64}$/i.test(proposedMarker)) return null;
  const result = await runDocker(['exec', container, 'sh', '-c', `test -s ${TURN_MARKER} || printf '%s' '${proposedMarker}' > ${TURN_MARKER}; cat ${TURN_MARKER}`]);
  const marker = result.out.trim();
  return result.code === 0 && /^[a-f\d]{64}$/i.test(marker) ? marker : null;
}

//? The marker lives on /work and survives a Node/orchestrator restart. Every retained
//? raw line receives a stable eventId; batches only satisfy the bounded InternalOp shape.
//? Truncation + marker removal happen only after every chunk is writer-proven. A failed
//? cleanup restores both files, allowing a successor token to append without duplicates.
export async function persistToolTrail(input: {
  container: string;
  containerId: string;
  workspaceId: string;
  target: StageRunTarget;
  turnMarker: string;
}, dependencies: ToolTrailPersistenceDependencies = {}): Promise<number> {
  const runDocker = dependencies.runDocker ?? docker;
  const enqueue = dependencies.enqueue ?? enqueueInternalAction;
  const marker = await ensurePersistentTurnMarker(input.container, input.turnMarker, runDocker);
  if (marker !== input.turnMarker) return 0;
  const [readError, result] = await tryCatch(() => runDocker(['exec', input.container, 'sh', '-c', `tail -c 262144 ${TOOL_TRAIL} 2>/dev/null`]));
  if (readError || result?.code !== 0 || result.out.trim().length === 0) return 0;
  const entries = parseToolTrail(result.out, { workspaceId: input.workspaceId, sessionId: input.target.sessionId, turnMarker: marker });
  if (entries.length === 0) return 0;

  let appended = 0;
  for (let offset = 0; offset < entries.length; offset += 100) {
    const chunk = entries.slice(offset, offset + 100);
    const first = chunk[0];
    const last = chunk.at(-1);
    if (!first || !last) return 0;
    const [writeError, enqueued] = await tryCatch(() => enqueue({
      workspaceId: input.workspaceId,
      op: 'stage-tool-trail-append',
      target: input.target,
      payload: { containerId: input.containerId, entries: chunk },
      userId: 'stage-runner',
      clientRequestId: `stage-tool-trail:${input.target.sessionId}:${input.target.runToken}:${String(input.target.runFence)}:${marker}:${first.eventId}:${last.eventId}`,
    }));
    if (writeError || !enqueued || !stageActionPersisted(enqueued.result, input.target.ticketKey)) return 0;
    appended += readStageToolTrailResult(enqueued.result)?.appended ?? 0;
  }

  const [cleanupError, cleanup] = await tryCatch(() => runDocker([
    'exec', input.container, 'sh', '-c',
    `if ! cp ${TOOL_TRAIL} ${TOOL_TRAIL}.persisted-backup 2>/dev/null || ! cp ${TURN_MARKER} ${TURN_MARKER}.persisted-backup 2>/dev/null; then exit 1; fi; `
      + `if : > ${TOOL_TRAIL} 2>/dev/null && rm -f ${TURN_MARKER}; then `
      + `rm -f ${TOOL_TRAIL}.persisted-backup ${TURN_MARKER}.persisted-backup || true; exit 0; fi; `
      + `cp ${TOOL_TRAIL}.persisted-backup ${TOOL_TRAIL} || true; cp ${TURN_MARKER}.persisted-backup ${TURN_MARKER} || true; exit 1`,
  ]));
  if (cleanupError || cleanup?.code !== 0) return 0;
  return appended;
}

export interface StageRunResult { ok: boolean; kind?: TurnResult['kind']; envelope?: CarryOverEnvelope; message?: string; error?: string }

export type StageCiBoundary = (container: string) => Promise<StageCiReport>;

//? Injectable for no-Docker regression tests. Production executes commands in the CURRENT ticket
//? container/worktree and returns facts only; no Prisma-writing runPipeline call is reachable here.
export function runStageCiOutsideWriter(
  container: string,
  boundary: StageCiBoundary = runStageCiInContainer,
): Promise<StageCiReport> {
  if (currentWriterScope() !== null) throw new Error('[stage-runner] slow CI boundary cannot run under the workspace writer');
  return boundary(container);
}

export interface ResolvedStageTurnWriterOutcome {
  persisted: boolean;
  keys: string[];
  completion: StageTurnCompleteResult | null;
}

//? Terminal replay intentionally loses the rich result. Re-read the current ticket/session/stage
//? behind the runToken CAS so broadcast/forge/handoff decisions survive a post-write crash.
export async function resolveStageTurnWriterOutcome(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageTurnCompleteInternalAction,
  result: unknown,
): Promise<ResolvedStageTurnWriterOutcome> {
  const keys = stageActionResultKeys(result);
  if (!stageActionPersisted(result, action.target.ticketKey)) return { persisted: false, keys: [], completion: null };
  const rich = readStageTurnCompleteResult(result);
  return {
    persisted: true,
    keys,
    completion: rich?.applied === true ? rich : await reloadStageTurnCompleteResult(prisma, workspaceId, action),
  };
}

export interface StageCleanupDependencies {
  ownsSlot?: typeof reservationOwnsSlot;
  readRunOwner?: typeof readStageContainerOwner;
  teardown?: (workspaceId: string, ticketKey: string) => Promise<void>;
}

export async function cleanupFailedStageContainer(
  workspaceId: string,
  ticketKey: string,
  runToken: string,
  runFence: number,
  container: ContainerInfo,
  dependencies: StageCleanupDependencies = {},
): Promise<boolean> {
  if (!container.created) return false;
  const ownsSlot = dependencies.ownsSlot ?? reservationOwnsSlot;
  const readRunOwner = dependencies.readRunOwner ?? readStageContainerOwner;
  const teardown = dependencies.teardown ?? teardownTicketContainer;
  if (!(await ownsSlot(workspaceId, ticketKey, runToken, runFence))) return false;
  const owner = await readRunOwner(container.name);
  if (owner?.runToken !== runToken || owner.runFence !== runFence) return false;
  const [error] = await tryCatch(() => teardown(workspaceId, ticketKey));
  return error === null;
}

//? Narrow a stored Prisma Json envelope back to a CarryOverEnvelope (never trust the shape).
function coerceEnvelope(v: unknown): CarryOverEnvelope | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    summary: typeof o.summary === 'string' ? o.summary : '',
    changedFiles: Array.isArray(o.changedFiles) ? o.changedFiles.filter((x): x is string => typeof x === 'string') : [],
    openQuestions: Array.isArray(o.openQuestions) ? o.openQuestions.filter((x): x is string => typeof x === 'string') : [],
    ...(typeof o.commitHash === 'string' ? { commitHash: o.commitHash } : {}),
    ...(typeof o.complexityScore === 'number' ? { complexityScore: o.complexityScore } : {}),
  };
}

const isObjectId = (value: string): boolean => /^[a-f\d]{24}$/i.test(value);

//? X1 — load ONLY the MCP integrations selected by this stage's StageToolCfg.
//? Arbitrary MCP servers have no generic read-only enforcement, so a `ro` selection
//? fails closed (omitted) instead of receiving `rw` credentials; only `rw` mounts.
//? IntegrationField.envVarId is a loose reference, so both tool and env queries carry
//? workspaceId. A malformed/missing/foreign ref (or undecryptable secret) omits the
//? complete integration: no command, secret, or partial config reaches `.mcp.json`.
export async function loadMcpIntegrations(
  prisma: PrismaClient,
  workspaceId: string,
  selectedTools: readonly StageToolCfg[],
): Promise<McpIntegration[]> {
  const toolIds = [...new Set(selectedTools.filter((tool) => tool.tier === 'rw').map((tool) => tool.toolId).filter((id) => isObjectId(id)))];
  if (toolIds.length === 0) return [];
  const toolRows = await prisma.integrationTool.findMany({ where: { workspaceId, id: { in: toolIds } } });
  const enabled = toolRows.filter((tool) => tool.mcp.enabled && tool.mcp.command.trim().length > 0);
  if (enabled.length === 0) return [];

  const envIds = [...new Set(enabled.flatMap((tool) => tool.fields.flatMap((field) => field.envVarId === null ? [] : [field.envVarId])).filter((id) => isObjectId(id)))];
  const envRows = envIds.length > 0
    ? await prisma.envVar.findMany({ where: { workspaceId, id: { in: envIds } } })
    : [];
  const byId = new Map(envRows.map((envVar) => [envVar.id, envVar]));

  return enabled.flatMap((tool): McpIntegration[] => {
    const refs = tool.fields.flatMap((field) => field.envVarId === null ? [] : [field.envVarId]);
    if (refs.some((id) => !isObjectId(id) || !byId.has(id))) return [];

    const env: Record<string, string> = {};
    for (const field of tool.fields) {
      if (field.envVarId === null) continue;
      const envVar = byId.get(field.envVarId);
      if (!envVar) return [];
      const value = envVar.secret ? decryptSecret(envVar.value) : envVar.value;
      if (value === null) return [];
      env[envVar.key] = value;
    }
    return [{ name: tool.name, command: tool.mcp.command, ...(Object.keys(env).length > 0 ? { env } : {}) }];
  });
}

//? The ticket is the authoritative runtime-project source. A stale provisioning request for
//? another stage, or an identically-keyed stage in a sibling project, fails closed.
export async function resolveStageRuntime(prisma: PrismaClient, workspaceId: string, ticketKey: string, stageKey: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { workspaceId, key: ticketKey, archived: false, status: { notIn: ['done', 'paused', 'stuck'] } },
  });
  if (ticket?.stageId !== stageKey) return null;
  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: ticket.projectId, key: stageKey } });
  return stage ? { ticket, stage } : null;
}

//? Project-owned context may only cross into that project's agent. The design-system remains
//? workspace-wide per ADR 0034; explicit stage sources may be workspace-wide or ticket-project-owned.
export async function loadStageContextDocs(prisma: PrismaClient, workspaceId: string, projectId: string, sourceIds: readonly string[]): Promise<{ name: string; content: string }[]> {
  const explicitIds = sourceIds.filter((id) => /^[a-fA-F0-9]{24}$/.test(id));
  const rows = await prisma.infoSource.findMany({
    where: {
      workspaceId,
      mode: 'context-doc',
      //? ADR 0310 — an archived doc must actually STOP reaching the agent, otherwise "archived" is a
      //? label on a list rather than a decision about what the AI reads.
      archivedAt: null,
      OR: [
        { source: 'starter', enabled: true, projectId },
        { source: 'design-system', enabled: true },
        ...(explicitIds.length > 0 ? [{ id: { in: explicitIds }, OR: [{ projectId }, { projectId: null }] }] : []),
      ],
    },
    select: { name: true, content: true },
    take: 12,
  });
  return rows.filter((row) => (row.content ?? '').trim().length > 0).map((row) => ({ name: row.name, content: row.content ?? '' }));
}

export async function resolveNextProjectStage(prisma: PrismaClient, workspaceId: string, projectId: string, afterOrder: number) {
  return prisma.pipelineStage.findFirst({ where: { workspaceId, projectId, order: { gt: afterOrder } }, orderBy: { order: 'asc' } });
}

async function updateStageSession(input: {
  workspaceId: string;
  target: StageRunTarget;
  containerId: string;
  status: 'busy' | 'stopped';
  reason: string;
  claudeSessionId?: string;
  failure?: 'claude.notAuthenticated';
}): Promise<boolean> {
  const [error, enqueued] = await tryCatch(() => enqueueInternalAction({
    workspaceId: input.workspaceId,
    op: 'stage-session-update',
    target: input.target,
    payload: {
      containerId: input.containerId,
      status: input.status,
      ...(input.claudeSessionId === undefined ? {} : { claudeSessionId: input.claudeSessionId }),
      ...(input.failure === undefined ? {} : { failure: input.failure }),
    },
    userId: 'stage-runner',
    clientRequestId: `stage-session-update:${stageDigest(input.target.sessionId, input.target.runToken, input.containerId, input.reason)}`,
  }));
  return !error && stageActionPersisted(enqueued?.result, input.target.ticketKey);
}

//? Run one aiEnabled stage for a ticket: render → materialize → drive claude → parse →
//? persist carry-over (+ advance the ticket if the stage isn't gated). Best-effort, off the
//? serial chain.
async function runStageInTenant(workspaceId: string, ticketKey: string, stageKey: string, opts: { runToken: string; runFence: number; reservationGuard: ReservationGuard; resume?: boolean; resumePrompt?: string }): Promise<StageRunResult> {
  const prisma = getPrismaClient();
  await opts.reservationGuard.assertOwned();
  const runtime = await resolveStageRuntime(prisma, workspaceId, ticketKey, stageKey);
  if (!runtime) return { ok: false, error: 'ticket-or-stage.notFound' };
  const { ticket, stage: stageRow } = runtime;
  const cfg = toStageConfig(stageRow);

  //? Incoming carry-over = the previous stage's envelope addressed to this stage (null first).
  const prior = await prisma.carryOver.findFirst({ where: { ticketId: ticket.id, toStageId: stageKey }, orderBy: { createdAt: 'desc' } });
  const carryOver = coerceEnvelope(prior?.envelope ?? null);

  //? F29 — `visibleStageIds` let a stage read the output of stages OTHER than the one immediately before
  //? it ("implement should still see what refine decided"). It was configurable in the stage editor and
  //? read by nothing, so the setting was purely decorative: every stage only ever saw its direct
  //? predecessor's envelope. Those extra stages are now loaded and handed to the renderer as context.
  const visibleIds = cfg.visibleStageIds.filter((id) => id !== stageKey);
  const visibleEnvelopes = visibleIds.length === 0 ? [] : await prisma.carryOver.findMany({
    where: { workspaceId, ticketId: ticket.id, toStageId: { in: visibleIds } },
    orderBy: { createdAt: 'desc' }, take: 20,
  });
  //? Newest per stage only — an older run of the same stage is superseded, not extra context.
  const seenStages = new Set<string>();
  const visibleDocs: { name: string; content: string; provenance: string; trusted: boolean }[] = [];
  for (const row of visibleEnvelopes) {
    if (seenStages.has(row.toStageId)) continue;
    seenStages.add(row.toStageId);
    const envelope = coerceEnvelope(row.envelope);
    const summary = (envelope?.summary ?? '').trim();
    if (summary.length > 0) {
      visibleDocs.push({ name: `Output of stage: ${row.toStageId}`, content: summary.slice(0, 4000), provenance: `carry-over from ${row.toStageId}`, trusted: true });
    }
  }

  //? Resolve the ACTUAL model/effort for this turn: the stage's base choice, or (autoEscalate) the
  //? escalation rule matched by the agent's own complexity score from the previous stage.
  const choice = resolveModelChoice(cfg.modelCfg, carryOver?.complexityScore ?? null);
  const scoreNote = typeof carryOver?.complexityScore === 'number' ? ` (score ${String(carryOver.complexityScore)})` : '';
  console.log(`[stage] ${ticketKey}@${stageKey} model=${choice.model} effort=${choice.effort}${scoreNote}${cfg.modelCfg.autoEscalate ? ' autoEscalate' : ''}`);

  //? Context-docs are scoped from the ticket's authoritative project. Workspace-wide design-system
  //? guidance remains visible per ADR 0034; sibling-project starters/explicit docs never are.
  const starterDocs = await loadStageContextDocs(prisma, workspaceId, ticket.projectId, cfg.sourceIds);
  //? ADR 0034: per-ticket linked artifacts (the specific design/spec this ticket implements) — injected
  //? alongside the workspace-wide design-system doc + project-scoped starter docs.
  const linkedArtifacts = await loadTicketArtifactContext(prisma, workspaceId, ticket.id);
  //? Zelf-bewuste-AI-brug: the product-knowledge corpus (was chat-only) as ONE bounded context-doc, so
  //? a dev stage knows the platform around the code it writes. Best-effort — empty corpus = omitted.
  const [, pkChunks] = await tryCatch(() => retrieveProductKnowledge(prisma, `${ticket.title}\n${ticket.description ?? ''}`, 2));
  const productDoc = (pkChunks ?? []).map((c) => c.content).join('\n\n').slice(0, 2500);
  //? SK2 — enabled 'dev' skills reach the PTY coding agent as a context-doc (the one-shot choke-point
  //? in ai/registry.ts doesn't cover the PTY path). Best-effort: read failure = no doc.
  const [, skillsDoc] = await tryCatch(() => skillPromptBlock(workspaceId, 'dev'));
  //? ADR 0311 — the workspace-wide AI instruction + output language. `ai/registry.ts` prefixes it onto
  //? every ONE-SHOT feature's system prompt, but the PTY path renders its own prompt and so never saw
  //? it: a user's "always-on" instruction steered docs/Dockerfile/chat and silently skipped the agent
  //? that writes the code. Same function, so the two paths can't drift apart again.
  const [, wsPrefix] = await tryCatch(() => workspaceAiPrefix(workspaceId));
  const contextDocs = [...starterDocs, ...visibleDocs, ...linkedArtifacts, ...(productDoc.length > 0 ? [{ name: 'Platform capabilities (product knowledge)', content: productDoc, provenance: 'RAG chunks: product knowledge' }] : []), ...((skillsDoc ?? '').length > 0 ? [{ name: 'Active skills', content: skillsDoc ?? '', trusted: true }] : [])];

  //? RAG (07 §D): retrieve the code most relevant to this ticket + inject it. Best-effort — a
  //? missing/empty index just yields no hits (the agent still gets its docs + can explore the repo).
  const [ragErr, hits] = await tryCatch(() => retrieve(prisma, workspaceId, `${ticket.title}\n${ticket.description ?? ''}`, 6, ticket.commitHash ?? undefined, ticket.projectId));
  const retrieved = ragErr || !hits ? [] : hits.map((h) => ({ filePath: h.filePath, content: h.content }));

  //? R3-b — prefer THIS ticket's project's built L2 image, else the L1 base for its stack (S1 — any-stack).
  const project = await prisma.project.findFirst({ where: { workspaceId, id: ticket.projectId }, select: { baseImageRef: true, stack: true } });
  //? K3 — inject the workspace env + service network so the coding agent's build/test reaches the app's services.
  const ctx = await workspaceContainerContext(prisma, workspaceId);
  await opts.reservationGuard.assertOwned();
  const container = await launchTicketContainer({ workspaceId, projectId: ticket.projectId, ticketKey, branch: ticket.branch ?? ticketKey, runToken: opts.runToken, image: resolveProjectBaseImage(project), ...ctx });
  if (!container) return { ok: false, error: 'container.launchFailed' };
  const runOwner: StageRunOwner = { runToken: opts.runToken, runFence: opts.runFence };
  //? This is the reuse fence: it kills predecessor A before B may materialize config or
  //? drive a PTY, while preserving the existing /work git checkout and its commits.
  if (!(await ensureStageContainerOwnership(container.name, workspaceId, ticketKey, runOwner))) {
    await cleanupFailedStageContainer(workspaceId, ticketKey, opts.runToken, opts.runFence, container);
    return { ok: false, error: 'stage.ownerMismatch' };
  }

  const sessionKey = `worker:${ticket.id}:${stageKey}`;
  const previousSession = await prisma.agentSession.findFirst({
    where: { workspaceId, ticketId: ticket.id, stageId: stageKey, kind: 'worker', sessionKey },
    select: { claudeSessionId: true },
  });

  //? A fresh session reloads its latest self-handoff; a resumable session continues its own transcript.
  const [, reloadHandoff] = previousSession?.claudeSessionId
    ? [null, null]
    : await tryCatch(() => latestHandoff(prisma, workspaceId, sessionKey));
  const handoffReload = reloadHandoff ? renderHandoffReload(reloadHandoff) : undefined;

  const integrations = await loadMcpIntegrations(prisma, workspaceId, cfg.tools);
  const artifacts = renderStage(cfg, { ticketId: ticket.key, ...(ticket.commitHash ? { commitHash: ticket.commitHash } : {}), carryOver, contextDocs, retrieved, ...(handoffReload ? { handoffReload } : {}), ...(integrations.length > 0 ? { integrations } : {}), modelChoice: choice, ...((wsPrefix ?? '').length > 0 ? { workspaceInstruction: wsPrefix ?? '' } : {}) });
  if (!(await materializeStageConfig(container.name, artifacts))) {
    await cleanupFailedStageContainer(workspaceId, ticketKey, opts.runToken, opts.runFence, container);
    return { ok: false, error: 'materialize.failed' };
  }

  //? F29 — the stage's declared processes start AFTER its config is materialized (they may read it) and
  //? BEFORE the agent turn, so a dev server the agent is meant to hit is already up.
  await startStageProcesses(container.name, cfg.processes);

  //? The slow container launch/config materialization happened without the writer. Revalidate the exact
  //? ticket/project/stage and persist the unique capacity runToken immediately before PTY; a reused
  //? container id is binding metadata, never run identity.
  await opts.reservationGuard.assertOwned();
  const sessionStartId = stageDigest(ticket.id, stageKey, opts.runToken, String(opts.runFence), container.containerId);
  const [startError, startedAction] = await tryCatch(() => enqueueInternalAction({
    workspaceId,
    op: 'stage-session-start',
    target: { ticketId: ticket.id, ticketKey, projectId: ticket.projectId, stageId: stageKey },
    payload: { sessionKey, runToken: opts.runToken, runFence: opts.runFence, containerId: container.containerId, model: choice.model, cliVersion: '2.1.198' },
    userId: 'stage-runner',
    clientRequestId: `stage-session-start:${sessionStartId}`,
  }));
  const started = readStageSessionStartResult(startedAction?.result);
  if (startError || !started?.applied || started.session.runToken !== opts.runToken || started.session.runFence !== opts.runFence) {
    await cleanupFailedStageContainer(workspaceId, ticketKey, opts.runToken, opts.runFence, container);
    return { ok: false, error: 'stage.stale' };
  }
  const runTarget: StageRunTarget = {
    ticketId: ticket.id,
    ticketKey,
    projectId: ticket.projectId,
    stageId: stageKey,
    sessionId: started.session.id,
    runToken: opts.runToken,
    runFence: opts.runFence,
  };
  const turnMarker = await ensurePersistentTurnMarker(container.name, stageDigest(started.session.id, randomUUID()));
  if (!turnMarker) return { ok: false, error: 'stage.turnMarkerFailed' };

  const hasAnswer = opts.resumePrompt !== undefined;
  const wantResume = (opts.resume === true || hasAnswer) && started.session.claudeSessionId !== null;
  const resumeSessionId = wantResume ? (started.session.claudeSessionId ?? undefined) : undefined;
  const kickoff = ((): string => {
    if (hasAnswer) return `The human answered your open question:\n\n${String(opts.resumePrompt)}\n\nContinue this stage using that answer. When you are done, end your final message with the ws-carryover block exactly as instructed.`;
    if (resumeSessionId) return 'Continue exactly where you left off on this stage. When you are done, end your final message with the ws-carryover block exactly as instructed.';
    return 'Begin working on this stage now. Read CLAUDE.md and follow the instructions. When you are done, end your final message with the ws-carryover block exactly as instructed.';
  })();
  await opts.reservationGuard.assertOwned();
  const drive = await driveContainerTurn(container.name, kickoff, { ...(resumeSessionId ? { resumeSessionId } : {}), workspaceId, ticketKey, model: choice.model, runOwner });
  await opts.reservationGuard.assertOwned();
  if (!drive.ok) {
    const failure = drive.error === 'claude.notAuthenticated' ? 'claude.notAuthenticated' as const : undefined;
    await updateStageSession({ workspaceId, target: runTarget, containerId: container.containerId, status: 'stopped', reason: `${turnMarker}:${drive.error ?? 'turn-failed'}`, ...(failure ? { failure } : {}) });
    return { ok: false, error: drive.error ?? 'turn.failed' };
  }

  await persistToolTrail({
    container: container.name,
    containerId: container.containerId,
    workspaceId,
    target: runTarget,
    turnMarker,
  });

  const result = await parseTurnResult(drive.message);
  //? CI executes against THIS ticket container's current /work and reads its actual HEAD. It returns
  //? facts only; Pipeline/PipelineRun/PipelineJob/Event writes happen in stage-turn-complete.
  await opts.reservationGuard.assertOwned();
  const [ciError, ci] = result.kind === 'done' && isTestStage(stageRow.kind)
    ? await tryCatch(() => runStageCiOutsideWriter(container.name))
    : [null, null];
  if (ciError) console.error(`[ci] ${ticketKey}@${stageKey} failed to produce a report:`, ciError.message);
  await opts.reservationGuard.assertOwned();
  const turnId = stableStageCompletionId({
    runToken: runTarget.runToken,
    runFence: runTarget.runFence,
    turnMarker,
    message: drive.message,
    report: ci ?? null,
  });
  const completionRequest: StageTurnCompleteInternalAction = {
    workspaceId,
    op: 'stage-turn-complete',
    target: runTarget,
    payload: {
      containerId: container.containerId,
      ...(drive.claudeSessionId ? { claudeSessionId: drive.claudeSessionId } : {}),
      turn: result,
      spend: {
        userId: ticket.assigneeId,
        model: choice.model,
        inputChars: artifacts.claudeMd.length + artifacts.stageInstructions.length,
        outputChars: drive.message.length,
      },
      ...(ci ? { ci } : {}),
    },
    userId: 'stage-runner',
    clientRequestId: `stage-turn-complete:${turnId}`,
  };
  const [completionError, completionAction] = await tryCatch(() => enqueueInternalAction(completionRequest));
  if (completionError || !completionAction) return { ok: false, error: 'stage.stale' };
  const outcome = await resolveStageTurnWriterOutcome(prisma, workspaceId, completionRequest, completionAction.result);
  if (!outcome.persisted) return { ok: false, error: 'stage.stale' };
  //? Broadcast as soon as the writer proves persistence. Rich result loss on terminal replay can
  //? never suppress the delta; stale outcomes have no keys and never reach this call.
  await broadcastTicketDelta(prisma, workspaceId, outcome.keys);
  const completed = outcome.completion;
  if (!completed) return { ok: true, kind: result.kind, ...(result.kind === 'done' ? { envelope: result.envelope } : {}), message: drive.message };
  const currentTicket = await prisma.ticket.findFirst({
    where: { id: ticket.id, workspaceId, projectId: ticket.projectId, key: ticketKey },
    select: { branch: true },
  });
  const forgeBranch = currentTicket?.branch ?? null;

  if (result.kind === 'done' && completed.forgeRequired && forgeBranch) {
    //? Durable intent BEFORE the irreversible boundary. Prepare revalidates ticket,
    //? stage, session, runToken, capacity owner, container, and branch under the writer.
    const prepareRequestId = `stage-forge-prepare:${stageDigest(runTarget.sessionId, runTarget.runToken, String(runTarget.runFence), container.containerId, forgeBranch)}`;
    const prepareAction = {
      workspaceId,
      op: 'stage-forge-prepare' as const,
      target: runTarget,
      payload: { containerId: container.containerId, expectedBranch: forgeBranch },
      userId: 'stage-runner',
      clientRequestId: prepareRequestId,
    };
    const [prepareError, preparedAction] = await tryCatch(() => enqueueInternalAction(prepareAction));
    const prepared = readStageForgePrepareResult(preparedAction?.result);
    const intentId = stageForgeIntentId(workspaceId, prepareRequestId);
    const preparePersisted = !prepareError
      && preparedAction !== null
      && stageActionPersisted(preparedAction.result, ticketKey)
      && (prepared === null || prepared.intentId === intentId);
    if (preparePersisted) {
      await opts.reservationGuard.assertOwned();
      //? Git push + forge HTTP run with NO workspace writer lease. pushTicketWork
      //? re-reads expected project+branch immediately before its first external call.
      const [forgeError, forge] = await tryCatch(() => pushTicketWork(prisma, workspaceId, ticketKey, {
        ticketId: ticket.id,
        projectId: ticket.projectId,
        branch: forgeBranch,
        assertAuthority: () => opts.reservationGuard.assertOwned(),
      }, {
        push: ({ gitUrl, token, branch }) => pushContainerBranch({ container: container.name, workspaceId, ticketKey, gitUrl, token, branch }),
      }));
      if (forgeError) console.error(`[forge] ${ticketKey} failed:`, forgeError.message);
      else if (forge && !forge.ok) console.warn(`[forge] ${ticketKey}: ${forge.error ?? ''}`);
      else if (forge?.mrUrl) {
        await opts.reservationGuard.assertOwned();
        const forgeId = stageDigest(intentId, runTarget.runToken, String(runTarget.runFence), forge.mrUrl);
        const [applyError, appliedAction] = await tryCatch(() => enqueueInternalAction({
          workspaceId,
          op: 'stage-forge-complete',
          target: runTarget,
          payload: { containerId: container.containerId, intentId, expectedBranch: forgeBranch, mrUrl: forge.mrUrl ?? '' },
          userId: 'stage-runner',
          clientRequestId: `stage-forge-complete:${forgeId}`,
        }));
        const applied = readStageForgeCompleteResult(appliedAction?.result);
        if (!applyError && appliedAction && stageActionPersisted(appliedAction.result, ticketKey)) {
          await broadcastTicketDelta(prisma, workspaceId, stageActionResultKeys(appliedAction.result));
          if (applied?.changed !== false) {
            await tryCatch(() => postIssueComment(prisma, workspaceId, ticketKey, `🤖 AI opened a merge request: ${forge.mrUrl ?? ''}`));
          }
        }
      }
    }
  }
  if (result.kind === 'done' && completed.pipelineDone) {
    await tryCatch(() => postIssueComment(prisma, workspaceId, ticketKey, '🤖 AI completed the pipeline for this ticket.'));
  }
  if (result.kind === 'done') return { ok: true, kind: 'done', envelope: result.envelope, message: drive.message };

  //? Handoff PTY drive + precompact-file I/O stay outside the lease. Handoff persistence,
  //? token reset, and claudeSessionId clear happen together behind the session/container CAS.
  const handoffSessionId = completed.claudeSessionId;
  if (handoffSessionId) {
    await tryCatch(async () => {
      const budget = budgetForStage(stageRow.modelCfg.contextBudgetTokens);
      const pcProbe = await docker(['exec', container.name, 'sh', '-c', 'test -f /work/.claude/precompact-signal && echo yes || echo no']);
      const preCompact = pcProbe.out.trim() === 'yes';
      if (!preCompact && !shouldHandoff(completed.tokenEstimate, budget)) return;
      await opts.reservationGuard.assertOwned();
      const drivenHandoff = await driveContainerTurn(container.name, DEFAULT_HANDOFF_INSTRUCTION, { resumeSessionId: handoffSessionId, workspaceId, ticketKey, model: choice.model, runOwner });
      const body = drivenHandoff.ok ? parseHandoff(drivenHandoff.message) : null;
      if (!body) return;
      const reason = preCompact ? 'precompact' : 'budget';
      await opts.reservationGuard.assertOwned();
      const handoffId = stableStageHandoffId({
        runToken: runTarget.runToken,
        runFence: runTarget.runFence,
        turnMarker,
        claudeSessionId: handoffSessionId,
        body,
        reason,
      });
      const [applyError, appliedAction] = await tryCatch(() => enqueueInternalAction({
        workspaceId,
        op: 'stage-handoff-complete',
        target: runTarget,
        payload: { containerId: container.containerId, expectedClaudeSessionId: handoffSessionId, body, reason },
        userId: 'stage-runner',
        clientRequestId: `stage-handoff-complete:${handoffId}`,
      }));
      if (applyError || !appliedAction || !stageActionPersisted(appliedAction.result, ticketKey)) return;
      await docker(['exec', container.name, 'sh', '-c', 'rm -f /work/.claude/precompact-signal']);
      console.log(`[handoff] ${ticketKey}@${stageKey} token-optimized (${preCompact ? 'precompact' : `est ${String(completed.tokenEstimate)} ≥ ${String(budget)}`})`);
    });
  }

  return { ok: true, kind: result.kind, message: drive.message };
}

export function runStage(workspaceId: string, ticketKey: string, stageKey: string, opts: { runToken: string; runFence: number; reservationGuard: ReservationGuard; resume?: boolean; resumePrompt?: string }): Promise<StageRunResult> {
  return runInTenant(workspaceId, () => runStageInTenant(workspaceId, ticketKey, stageKey, opts));
}
