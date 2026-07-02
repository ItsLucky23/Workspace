//? Stage-runner — the autonomous per-stage execution loop (07 §A step 6-7). For a ticket
//? in an aiEnabled stage it renders the stage config into the container, drives an
//? in-container `claude` turn on the ticket (subscription-billed interactive PTY, NEVER
//? `-p`), parses the turn result, and persists the carry-over for the next stage. Runs OFF
//? the Conductor serial chain (the turn is minutes-long). The container-auth spike (07b §2)
//? proved container-claude authenticates via the projected creds — this is that engine.

import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import * as pty from 'node-pty';
import type { Prisma } from '@prisma/client';
import { tryCatch, tryCatchSync, getPrismaClient } from '@luckystack/core';
import { docker, DOCKER_BIN, isWorkspacesContainer, launchTicketContainer } from '../container/runtime';
import { renderStage, type StageArtifacts } from './renderStage';
import { toStageConfig } from '../read/workspaceSnapshot';
import { parseTurnResult, type CarryOverEnvelope, type TurnResult } from './turnResult';

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
const CAPTURE = '/work/.claude/turn-stop.json';

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

//? Copy the RO-projected subscription creds into a writable, agent-owned ~/.claude (0600)
//? so the CLI's permission check passes (the RO Windows mount is 0777) and no container
//? ever writes the shared source. Also clears any stale turn-capture. Idempotent.
//? The managed-token refresh loop, on-demand (07b §2.2): the projected token is short-lived
//? and the HOST's `claude` keeps its own copy fresh, so re-copy the live host creds into the
//? RO-mounted projection dir before each turn. Without this, container-claude hits
//? "Not logged in" once the initial copy expires (~hours). Best-effort, host-side.
function refreshProjectedAuth(): void {
  const authDir = process.env.WS_AUTH_DIR ?? path.join(process.cwd(), 'data', '_auth');
  const hostCreds = path.join(homedir(), '.claude', '.credentials.json');
  if (existsSync(hostCreds) && existsSync(authDir)) {
    tryCatchSync(() => { copyFileSync(hostCreds, path.join(authDir, '.credentials.json')); });
  }
}

async function projectAuth(container: string): Promise<void> {
  //? FIXED path (matches the container's CLAUDE_CONFIG_DIR env) — never `~` (docker exec
  //? sets no HOME, so `~` would resolve wrong and claude would fall into the login flow).
  //? Also give the worktree a git identity (local, agent-owned) so a code stage's
  //? `git commit` succeeds instead of hanging on "who are you".
  await docker(['exec', container, 'sh', '-c',
    'mkdir -p /home/agent/.claude && cp /auth-ro/.credentials.json /auth-ro/.claude.json /home/agent/.claude/ 2>/dev/null; chmod 700 /home/agent/.claude 2>/dev/null; chmod 600 /home/agent/.claude/.credentials.json 2>/dev/null; '
    + 'git -C /work config user.name "Workspaces AI" 2>/dev/null; git -C /work config user.email "ai@workspaces.local" 2>/dev/null; '
    + 'rm -f ' + CAPTURE + '; true']);
}

//? Drive ONE interactive `claude` turn inside the container and return its final message.
//? The result is captured off the in-container Stop hook (settings.json writes it to CAPTURE)
//? — NOT by parsing the PTY. We NEVER call `term.kill()` (its Windows conpty console-list
//? agent can crash the host process); instead `pkill` claude inside the container so the
//? `docker exec` exits and the PTY closes naturally.
export async function driveContainerTurn(container: string, kickoff: string, timeoutMs = 240_000): Promise<{ ok: boolean; message: string; claudeSessionId?: string; error?: string }> {
  if (!(await isWorkspacesContainer(container))) return { ok: false, message: '', error: 'container.notOurs' };
  refreshProjectedAuth();   //? keep the projected token fresh (07b §2.2 refresh loop)
  await projectAuth(container);

  //? bypassPermissions: the agent runs autonomously INSIDE the hardened, isolated,
  //? disposable container (cap-drop ALL, non-root, no host access) — the CONTAINER is the
  //? security boundary, so in-agent permission prompts only stall the turn. The stage
  //? instructions (+ the settings deny set as defense-in-depth) shape what it does.
  const term = pty.spawn(DOCKER_BIN, ['exec', '-it', container, 'claude', '--permission-mode', 'bypassPermissions', '--settings', '/work/.claude/settings.json', '--append-system-prompt-file', '/work/.claude/stage-instructions.txt'], {
    name: 'xterm-color', cols: 120, rows: 34, cwd: process.cwd(), env: process.env,
  });
  //? Object property (not a local) so TS doesn't treat the onExit-mutated flag as constant.
  const state = { exited: false };
  term.onExit(() => { state.exited = true; });
  term.onData(() => { /* drained; the turn is captured via the Stop hook, not the PTY */ });

  await wait(7000); term.write('\r'); await wait(3000);   // boot + confirm folder-trust
  term.write(kickoff); await wait(1500); term.write('\r'); await wait(2500); term.write('\r');

  //? Poll for the Stop-hook capture (turn end) up to the timeout.
  const deadline = Date.now() + timeoutMs;
  let captured = '';
  while (Date.now() < deadline && captured.length === 0) {
    await wait(2500);
    const r = await docker(['exec', container, 'sh', '-c', `cat ${CAPTURE} 2>/dev/null`]);
    if (r.code === 0 && r.out.length > 0) captured = r.out;
  }
  //? Stop claude IN the container → the docker-exec PTY exits on its own (no term.kill()).
  await docker(['exec', container, 'sh', '-c', 'pkill -f claude 2>/dev/null; true']);
  for (let i = 0; i < 12 && !state.exited; i++) await wait(300);

  if (captured.length === 0) return { ok: false, message: '', error: 'turn.timeout' };
  const [, payload] = await tryCatch(() => Promise.resolve(JSON.parse(captured) as { last_assistant_message?: unknown; session_id?: unknown }));
  const message = (payload && typeof payload.last_assistant_message === 'string') ? payload.last_assistant_message : '';
  const claudeSessionId = (payload && typeof payload.session_id === 'string') ? payload.session_id : undefined;
  return { ok: true, message, ...(claudeSessionId ? { claudeSessionId } : {}) };
}

export interface StageRunResult { ok: boolean; kind?: TurnResult['kind']; envelope?: CarryOverEnvelope; message?: string; error?: string }

//? Narrow a stored Prisma Json envelope back to a CarryOverEnvelope (never trust the shape).
function coerceEnvelope(v: unknown): CarryOverEnvelope | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    summary: typeof o.summary === 'string' ? o.summary : '',
    changedFiles: Array.isArray(o.changedFiles) ? o.changedFiles.filter((x): x is string => typeof x === 'string') : [],
    openQuestions: Array.isArray(o.openQuestions) ? o.openQuestions.filter((x): x is string => typeof x === 'string') : [],
    ...(typeof o.commitHash === 'string' ? { commitHash: o.commitHash } : {}),
  };
}

//? A plain JSON object for the Prisma Json column (CarryOverEnvelope has an optional field).
function envelopeJson(e: CarryOverEnvelope): Prisma.InputJsonObject {
  return e.commitHash
    ? { summary: e.summary, changedFiles: e.changedFiles, openQuestions: e.openQuestions, commitHash: e.commitHash }
    : { summary: e.summary, changedFiles: e.changedFiles, openQuestions: e.openQuestions };
}

//? Run one aiEnabled stage for a ticket: render → materialize → drive claude → parse →
//? persist carry-over (+ advance the ticket if the stage isn't gated). Best-effort, off the
//? serial chain. `prisma` is passed in so this stays callable from the Conductor.
export async function runStage(workspaceId: string, ticketKey: string, stageKey: string): Promise<StageRunResult> {
  const prisma = getPrismaClient();
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey } });
  const stageRow = await prisma.pipelineStage.findFirst({ where: { workspaceId, key: stageKey } });
  if (!ticket || !stageRow) return { ok: false, error: 'ticket-or-stage.notFound' };
  const cfg = toStageConfig(stageRow);

  //? Incoming carry-over = the previous stage's envelope addressed to this stage (null first).
  const prior = await prisma.carryOver.findFirst({ where: { ticketId: ticket.id, toStageId: stageKey }, orderBy: { createdAt: 'desc' } });
  const carryOver = coerceEnvelope(prior?.envelope ?? null);

  //? Prefer the project's built L2 image (idempotent — reuses a running container).
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { baseImageRef: true } });
  const container = await launchTicketContainer({ workspaceId, ticketKey, branch: ticket.branch ?? ticketKey, ...(project?.baseImageRef ? { image: project.baseImageRef } : {}) });
  if (!container) return { ok: false, error: 'container.launchFailed' };

  const artifacts = renderStage(cfg, { ticketId: ticket.key, ...(ticket.commitHash ? { commitHash: ticket.commitHash } : {}), carryOver });
  if (!(await materializeStageConfig(container.name, artifacts))) return { ok: false, error: 'materialize.failed' };

  //? The ONE runtime row for this worker session (04b §7) — created here (nothing else
  //? writes worker rows). Its id anchors the CarryOver; status is Conductor-owned.
  const sessionKey = `worker:${ticket.id}:${stageKey}`;
  const session = await prisma.agentSession.upsert({
    where: { workspaceId_sessionKey: { workspaceId, sessionKey } },
    create: { workspaceId, ticketId: ticket.id, stageId: stageKey, kind: 'worker', sessionKey, status: 'busy', containerId: container.containerId, worktreePath: '/work', cliVersion: '2.1.198', model: cfg.modelCfg.base.model },
    update: { status: 'busy', containerId: container.containerId },
  });

  const kickoff = 'Begin working on this stage now. Read CLAUDE.md and follow the instructions. When you are done, end your final message with the ws-carryover block exactly as instructed.';
  const drive = await driveContainerTurn(container.name, kickoff);
  if (!drive.ok) {
    await prisma.agentSession.updateMany({ where: { id: session.id }, data: { status: 'stopped' } });
    return { ok: false, error: drive.error ?? 'turn.failed' };
  }
  //? Capture the resumable claude session id off the Stop hook.
  if (drive.claudeSessionId) await prisma.agentSession.updateMany({ where: { id: session.id }, data: { claudeSessionId: drive.claudeSessionId } });

  const result = await parseTurnResult(drive.message);
  if (result.kind === 'done') {
    //? Persist the carry-over: the machine envelope + the human one-liner on the ticket, so
    //? the NEXT stage's promptTemplate chips are filled from it (02 §4).
    const nextStage = await prisma.pipelineStage.findFirst({ where: { workspaceId, order: { gt: stageRow.order } }, orderBy: { order: 'asc' } });
    await prisma.carryOver.create({ data: { workspaceId, ticketId: ticket.id, fromStageId: stageKey, toStageId: nextStage?.key ?? stageKey, sessionId: session.id, envelope: envelopeJson(result.envelope) } });
    await prisma.ticket.updateMany({ where: { workspaceId, key: ticketKey }, data: { carryOver: result.envelope.summary } });
    await prisma.agentSession.updateMany({ where: { id: session.id }, data: { status: 'stopped' } });
    //? Advance the ticket to the next stage unless this stage is gated for human approval.
    if (nextStage && !stageRow.gateForApproval) {
      await prisma.ticket.updateMany({ where: { workspaceId, key: ticketKey }, data: { stageId: nextStage.key } });
    }
    return { ok: true, kind: 'done', envelope: result.envelope, message: drive.message };
  }
  //? needs-input → session parks busy (a human answers); continue → the turn just ended.
  await prisma.agentSession.updateMany({ where: { id: session.id }, data: { status: result.kind === 'needs-input' ? 'busy' : 'stopped' } });
  return { ok: true, kind: result.kind, message: drive.message };
}
