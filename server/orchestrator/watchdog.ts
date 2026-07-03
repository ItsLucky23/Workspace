//? Crash-recovery watchdog (#1). Two responsibilities, both leader-gated (multi-instance-safe,
//? ADR 0015) so exactly one instance drives recovery:
//?
//?  1. `resumeEngineOnBoot` — on startup, reconcile interrupted turns: a worker AgentSession left
//?     `busy` by a crash is re-associated with its container and RESUMED (`claude --resume`) if the
//?     container survived, RE-PROVISIONED fresh if it died, or STOPPED if the ticket has moved on
//?     (done / stage no longer AI-enabled). Legitimately-parked turns (paused, or waiting on a real
//?     human question) are left alone.
//?  2. `runWatchdogSweep` — periodically detect + intervene on: STUCK turns (a `busy` session older
//?     than the turn-max, i.e. hung / rate-limited without ending) → kill + re-provision; and IDLE
//?     tickets (activated, in an AI-enabled non-gate stage, but no turn ever ran on this stage — a
//?     dropped provisioning) → re-provision. Turns that completed or park for approval are untouched.
//?
//? The re-fire goes through the engine's own `reprovisionTicket` (same path the `resume` control-op
//? uses) — the watchdog is part of the ENGINE (not a user), so it triggers turns directly; the
//? authoritative session/ticket writes are still made by `runStage`, exactly as in normal operation.

import { getPrismaClient } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { docker, dockerAvailable } from '../container/runtime';
import { isLeader } from './cluster';
import { killTicketAgent } from './agentControl';
import { reprovisionTicket, EDITOR_DEFER_MSG, CAPACITY_DEFER_MSG } from './conductor';

//? A `busy` turn older than this is treated as hung (matches the CapacityManager slot TTL).
const STUCK_MS = Number(process.env.WS_TURN_MAX_MS ?? String(30 * 60 * 1000));
const INTERVAL_MS = Number(process.env.WS_WATCHDOG_INTERVAL_MIN ?? '3') * 60_000;

//? Lists the ticket keys that currently have a live container. Injectable so tests can simulate
//? crashed / surviving containers without Docker.
export type ContainerLister = () => Promise<Set<string>>;

async function liveTicketContainers(): Promise<Set<string>> {
  const r = await docker(['ps', '--filter', 'label=org.workspaces.ticket', '--format', '{{.Label "org.workspaces.ticket"}}']);
  return new Set(r.out.split('\n').map((s) => s.trim()).filter((s) => s.length > 0));
}

//? A `needsInput` banner is a REAL human question (leave the turn parked) unless it's one of the
//? engine's own defer banners (editor-lock / capacity) — those are safe to re-run.
export function isRealNeedsInput(needsInput: string | null | undefined): boolean {
  if (!needsInput) return false;
  return needsInput !== EDITOR_DEFER_MSG && needsInput !== CAPACITY_DEFER_MSG;
}

//? Pure decision for a `busy` worker session found at boot. Extracted so it's unit-testable
//? without Docker/Prisma. 'stop' = stale (clean up); 'skip' = legitimately parked; 'resume' =
//? interrupted with a live container (continue via --resume); 'reprovision' = container gone.
export type SessionAction = 'resume' | 'reprovision' | 'stop' | 'skip';
export function classifyBusySession(input: {
  wsPaused: boolean; ticketPaused: boolean; ticketDone: boolean; stageAiEnabled: boolean;
  realNeedsInput: boolean; hasContainer: boolean;
}): SessionAction {
  if (input.ticketDone || !input.stageAiEnabled) return 'stop';
  if (input.wsPaused || input.ticketPaused || input.realNeedsInput) return 'skip';
  return input.hasContainer ? 'resume' : 'reprovision';
}

async function markStopped(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.agentSession.updateMany({ where: { id: sessionId }, data: { status: 'stopped' } });
}

export interface ResumeCounts { resumed: number; reprovisioned: number; stopped: number; skipped: number }

//? Boot reconciliation — see the file header. `opts.listContainers` overrides the Docker probe.
export async function resumeEngineOnBoot(opts: { listContainers?: ContainerLister } = {}): Promise<ResumeCounts> {
  const prisma = getPrismaClient();
  const counts: ResumeCounts = { resumed: 0, reprovisioned: 0, stopped: 0, skipped: 0 };
  const busy = await prisma.agentSession.findMany({ where: { kind: 'worker', status: 'busy' } });
  if (busy.length === 0) return counts;

  const probeContainers = async (): Promise<Set<string>> => ((await dockerAvailable()) ? liveTicketContainers() : new Set<string>());
  const live = await (opts.listContainers ?? probeContainers)();

  for (const s of busy) {
    if (!s.ticketId) { counts.skipped += 1; continue; }
    const ticket = await prisma.ticket.findFirst({ where: { workspaceId: s.workspaceId, id: s.ticketId }, select: { key: true, stageId: true, status: true, archived: true, needsInput: true } });
    if (!ticket) { await markStopped(prisma, s.id); counts.stopped += 1; continue; }
    const ws = await prisma.workspace.findUnique({ where: { id: s.workspaceId }, select: { paused: true } });
    const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId: s.workspaceId, key: ticket.stageId }, select: { aiEnabled: true } });
    const action = classifyBusySession({
      wsPaused: ws?.paused === true,
      ticketPaused: ticket.status === 'paused',
      ticketDone: ticket.status === 'done' || ticket.archived,
      stageAiEnabled: stage?.aiEnabled === true,
      realNeedsInput: isRealNeedsInput(ticket.needsInput),
      hasContainer: live.has(ticket.key),
    });
    if (action === 'skip') { counts.skipped += 1; continue; }
    if (action === 'stop') { await markStopped(prisma, s.id); counts.stopped += 1; continue; }
    if (action === 'reprovision') { await markStopped(prisma, s.id); void reprovisionTicket(s.workspaceId, ticket.key, false); counts.reprovisioned += 1; continue; }
    //? resume: the container survived — re-fire the SAME session with `--resume` (reprovisionTicket
    //? → runStage reuses the row + its claudeSessionId).
    void reprovisionTicket(s.workspaceId, ticket.key, true);
    counts.resumed += 1;
  }
  console.log(`[watchdog] boot resume: ${JSON.stringify(counts)}`);
  return counts;
}

export interface SweepCounts { stuck: number; idle: number }

//? One watchdog sweep — see the file header. `now` is injected so staleness is deterministic in tests.
export async function runWatchdogSweep(now: number): Promise<SweepCounts> {
  const prisma = getPrismaClient();
  const counts: SweepCounts = { stuck: 0, idle: 0 };

  //? STUCK: a busy worker turn older than the turn-max that isn't legitimately parked → kill + re-run.
  const busy = await prisma.agentSession.findMany({ where: { kind: 'worker', status: 'busy' } });
  for (const s of busy) {
    if (!s.ticketId || now - s.startedAt.getTime() < STUCK_MS) continue;
    const ticket = await prisma.ticket.findFirst({ where: { workspaceId: s.workspaceId, id: s.ticketId }, select: { key: true, status: true, needsInput: true } });
    if (!ticket) { await markStopped(prisma, s.id); continue; }
    if (ticket.status === 'paused' || isRealNeedsInput(ticket.needsInput)) continue;
    await killTicketAgent(prisma, s.workspaceId, ticket.key);
    void reprovisionTicket(s.workspaceId, ticket.key, false);
    counts.stuck += 1;
  }

  //? IDLE: an activated ticket sitting in an AI-enabled, non-gate stage that NEVER ran a turn on
  //? this stage (a dropped provisioning). A stage that already produced a session is left alone
  //? (its turn completed, advanced, or parks for approval — never re-fire that). Defer banners
  //? (capacity/editor) are handled by their own re-entry paths, so a null banner is required here.
  //? `needsInput` is filtered in code (not the query): Prisma+Mongo's `{ needsInput: null }` misses
  //? documents where the field is unset, and a defer banner (capacity/editor) IS re-runnable — only a
  //? REAL human question parks. So: fetch idle activated tickets, then drop the ones parked on a question.
  const candidates = await prisma.ticket.findMany({ where: { branch: { not: null }, archived: false, status: 'idle' }, select: { id: true, key: true, workspaceId: true, stageId: true, needsInput: true } });
  for (const t of candidates) {
    if (isRealNeedsInput(t.needsInput)) continue;
    const ws = await prisma.workspace.findUnique({ where: { id: t.workspaceId }, select: { paused: true } });
    if (ws?.paused === true) continue;
    const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId: t.workspaceId, key: t.stageId }, select: { aiEnabled: true, gateForApproval: true } });
    if (stage?.aiEnabled !== true || stage.gateForApproval) continue;
    const ran = await prisma.agentSession.findFirst({ where: { workspaceId: t.workspaceId, sessionKey: `worker:${t.id}:${t.stageId}` }, select: { id: true } });
    if (ran) continue; // this stage already ran — respect its outcome
    void reprovisionTicket(t.workspaceId, t.key, false);
    counts.idle += 1;
  }

  if (counts.stuck > 0 || counts.idle > 0) console.log(`[watchdog] sweep intervened: ${JSON.stringify(counts)}`);
  return counts;
}

//? Start the crash-recovery watchdog: a one-shot boot reconciliation + a periodic sweep, both
//? leader-gated. Returns the timer so it can be cleared. Boot reconciliation is deferred slightly
//? so leadership has settled first.
export function startTicketWatchdog(): ReturnType<typeof setInterval> {
  setTimeout(() => { if (isLeader()) void resumeEngineOnBoot().catch((error: unknown) => { console.error('[watchdog] boot resume error:', error); }); }, 8000);
  return setInterval(() => { if (isLeader()) void runWatchdogSweep(Date.now()).catch((error: unknown) => { console.error('[watchdog] sweep error:', error); }); }, INTERVAL_MS);
}
