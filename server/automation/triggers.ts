//? Trigger evaluation (#2) — `fireEvent` NEVER mutates. It enqueues a server-only InternalOp behind
//? the current workspace chain; the InternalOp re-reads + matches triggers and runs their actions under
//? the Conductor writer/tenant context. Debounce (`debounceMs` vs `lastFiredAt`) rate-limits a noisy
//? event; `dedupeKey` (a cross-instance Redis once-claim, multi-instance-safe) stops a duplicate fire.
//? Cron triggers are handled by server/automation/cron.ts.

import { randomUUID } from 'node:crypto';

import type { PrismaClient, WorkspaceTrigger } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import { claimActionOnce } from '../orchestrator/cluster';
import { assertWorkspaceWriterContext } from '../orchestrator/writerContext';
import { runTriggerAction, registerSignalHook } from './executor';

//? #83 — the max signal→on_signal chain depth (a bounded fuse against a signal that re-emits itself).
const MAX_SIGNAL_DEPTH = 4;

//? The event that just happened. `on` matches WorkspaceTrigger.on (e.g. 'ticket.created',
//? 'stage.on_complete'); the rest narrows `match`.
export interface EngineEvent {
  on: string;
  ticketKey?: string;
  stageId?: string;
  status?: string;
  projectId?: string;
}

//? Read a string[] off a Json `match` field without a cast.
function jsonStrArr(v: unknown, key: string): string[] | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const field = (v as Record<string, unknown>)[key];
  return Array.isArray(field) ? field.filter((x): x is string => typeof x === 'string') : undefined;
}

//? Pure: does a trigger's `on` + `match` accept this event? An absent match facet = "any". Extracted
//? so the matching logic is unit-testable without a DB.
export function matchesTrigger(trigger: Pick<WorkspaceTrigger, 'on' | 'match'>, event: EngineEvent): boolean {
  if (trigger.on !== event.on) return false;
  const stageIds = jsonStrArr(trigger.match, 'stageIds');
  if (stageIds && (event.stageId === undefined || !stageIds.includes(event.stageId))) return false;
  const statusKeys = jsonStrArr(trigger.match, 'statusKeys');
  if (statusKeys && (event.status === undefined || !statusKeys.includes(event.status))) return false;
  const projectIds = jsonStrArr(trigger.match, 'projectIds');
  if (projectIds && (event.projectId === undefined || !projectIds.includes(event.projectId))) return false;
  return true;
}

//? Should this trigger fire now, given its debounce window? (dedupe is a separate Redis claim.)
export function passesDebounce(trigger: Pick<WorkspaceTrigger, 'debounceMs' | 'lastFiredAt'>, now: number): boolean {
  if (!trigger.debounceMs || trigger.debounceMs <= 0 || !trigger.lastFiredAt) return true;
  return now - trigger.lastFiredAt.getTime() >= trigger.debounceMs;
}

interface FireEventResult { fired: number; gated: number }
const emptyFireEventResult = (): FireEventResult => ({ fired: 0, gated: 0 });

//? Process-local ingress ordering only: registering the tail happens synchronously, before the lazy import
//? or any other await, so consecutive `void fireEvent(...)` occurrences enter one workspace in call order.
//? Execution remains ADR-0027 best-effort: enqueue/import failures are logged and reported as zero; this is
//? deliberately NOT a lossless or durable event-ingress claim.
const eventIngressChains = new Map<string, Promise<unknown>>();

async function enqueueAutomationEvent(workspaceId: string, event: EngineEvent, depth: number): Promise<FireEventResult> {
  const [error, enqueued] = await tryCatch(async () => {
    const { enqueueInternalAction } = await import('../orchestrator/internalOps');
    return enqueueInternalAction({
      workspaceId,
      op: 'automation-event-apply',
      target: {},
      payload: { event, depth },
      userId: 'automation',
      clientRequestId: `automation-event-${randomUUID()}`,
    });
  });
  if (error) {
    console.error(`[automation] event ${event.on} enqueue failed:`, error.message);
    return emptyFireEventResult();
  }
  const result = enqueued?.result;
  if (result === null || typeof result !== 'object') return emptyFireEventResult();
  const fired = 'fired' in result && typeof result.fired === 'number' ? result.fired : 0;
  const gated = 'gated' in result && typeof result.gated === 'number' ? result.gated : 0;
  return { fired, gated };
}

export function fireEvent(_prisma: PrismaClient, workspaceId: string, event: EngineEvent, depth = 0): Promise<FireEventResult> {
  if (depth > MAX_SIGNAL_DEPTH) return Promise.resolve(emptyFireEventResult());
  const previous = eventIngressChains.get(workspaceId) ?? Promise.resolve();
  const occurrence = previous.then(() => enqueueAutomationEvent(workspaceId, event, depth));
  const tail = occurrence.catch((error: unknown) => {
    console.error(`[automation] event ${event.on} ingress failed:`, error);
  });
  eventIngressChains.set(workspaceId, tail);
  void tail.then(() => {
    if (eventIngressChains.get(workspaceId) === tail) eventIngressChains.delete(workspaceId);
  });
  return occurrence;
}

//? Conductor-only InternalOp body. Trigger state is re-read after this action reaches the head of the
//? writer chain, so stale detached callbacks cannot decide against pre-lease state.
export async function applyAutomationEvent(prisma: PrismaClient, workspaceId: string, event: EngineEvent, depth = 0): Promise<{ fired: number; gated: number }> {
  assertWorkspaceWriterContext(workspaceId);
  if (depth > MAX_SIGNAL_DEPTH) return { fired: 0, gated: 0 };
  const triggers = await prisma.workspaceTrigger.findMany({ where: { workspaceId, on: event.on, enabled: true } });
  let fired = 0;
  let gated = 0;
  const now = Date.now();
  for (const t of triggers) {
    if (t.action === 'run-command') continue; //? run-command is operator-only + not event-driven in V1 (safety)
    if (!matchesTrigger(t, event) || !passesDebounce(t, now)) continue;
    if (t.dedupeKey) {
      const claimed = await claimActionOnce(`trigger:${t.id}:${t.dedupeKey}:${event.ticketKey ?? ''}`);
      if (!claimed) continue;
    }
    const [error, outcome] = await tryCatch(() => runTriggerAction(prisma, workspaceId, {
      action: t.action,
      params: (t.params !== null && typeof t.params === 'object' ? t.params : {}) as Record<string, unknown>,
      ...(event.ticketKey ? { ticketKey: event.ticketKey } : {}),
      triggerName: t.name,
      signalDepth: depth,
    }, t.requiresApproval));
    if (error) { console.error(`[automation] trigger ${t.name} failed:`, error.message); continue; }
    await prisma.workspaceTrigger.updateMany({ where: { workspaceId, id: t.id, enabled: true }, data: { lastFiredAt: new Date(now) } });
    if (outcome?.status === 'gated') gated += 1;
    else if (outcome?.status === 'executed') fired += 1;
  }
  return { fired, gated };
}

//? #83 — wire the executor's emit-signal to raise a `stage.on_signal` EVENT (module-load side effect; breaks
//? the executor→triggers import cycle). The signal's kind rides as the event payload + a match facet; depth+1
//? feeds the loop guard above so a signal that re-emits itself can't spin forever.
registerSignalHook((prisma, workspaceId, kind, ticketKey, depth) => {
  void fireEvent(prisma, workspaceId, { on: 'stage.on_signal', ...(ticketKey ? { ticketKey } : {}), status: kind }, depth + 1);
});
