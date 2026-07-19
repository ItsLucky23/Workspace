//? Cron triggers (#2) — the leased scheduler that fires `on:'cron'` WorkspaceTriggers on schedule
//? (leader-gated, multi-instance-safe: exactly one instance runs it). A minimal 5-field cron matcher
//? (minute hour day-of-month month day-of-week) supporting `*`, `*/n`, `a-b`, `a,b,c`, and exact
//? numbers — enough for the common "every N minutes / daily at HH:MM / weekdays" schedules. A cron
//? trigger has no ticket context, so it runs its action workspace-level through the same approval gate.

import type { PrismaClient } from '@prisma/client';

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { assertWorkspaceWriterContext } from '../orchestrator/writerContext';
import { runTriggerAction } from './executor';

//? One tick per minute (cron's finest granularity). Exported so the @luckystack/cron overlay job schedules it.
export const CRON_TICK_MS = 60_000;

//? Parse and match one strict cron field. Every list member is validated before the field may match:
//? one valid member can never hide an out-of-range/backwards range or a zero/invalid step.
function fieldMatches(field: string, value: number, min: number, max: number): boolean | null {
  const members = field.split(',');
  if (members.length === 0 || members.some((member) => member.length === 0)) return null;
  let matched = false;
  for (const member of members) {
    if (member === '*') {
      matched = true;
      continue;
    }
    const stepMatch = /^\*\/(\d+)$/.exec(member);
    if (stepMatch) {
      const step = Number(stepMatch[1]);
      if (!Number.isSafeInteger(step) || step <= 0) return null;
      if ((value - min) % step === 0) matched = true;
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(member);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < min || end > max || start > end) return null;
      if (value >= start && value <= end) matched = true;
      continue;
    }
    if (!/^\d+$/.test(member)) return null;
    const exact = Number(member);
    if (!Number.isSafeInteger(exact) || exact < min || exact > max) return null;
    if (exact === value) matched = true;
  }
  return matched;
}

interface CronDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

const WEEKDAY_NUMBER: Readonly<Record<string, number>> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function cronDateParts(instant: Date, timezone: string): CronDateParts | null {
  if (Number.isNaN(instant.getTime()) || timezone.length === 0) return null;
  const [error, parts] = tryCatchSync(() => new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant));
  if (error || !parts) return null;
  let minute: number | undefined;
  let hour: number | undefined;
  let dayOfMonth: number | undefined;
  let month: number | undefined;
  let dayOfWeek: number | undefined;
  for (const part of parts) {
    switch (part.type) {
      case 'minute': {
        minute = Number(part.value);
        break;
      }
      case 'hour': {
        hour = Number(part.value);
        break;
      }
      case 'day': {
        dayOfMonth = Number(part.value);
        break;
      }
      case 'month': {
        month = Number(part.value);
        break;
      }
      case 'weekday': {
        dayOfWeek = WEEKDAY_NUMBER[part.value];
        break;
      }
      default: {
        break;
      }
    }
  }
  if (minute === undefined || hour === undefined || dayOfMonth === undefined || month === undefined || dayOfWeek === undefined) return null;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

//? Match a 5-field cron expression against an instant in an explicit IANA timezone. Invalid grammar,
//? dates, or timezones fail closed. UTC is the deterministic default for pure callers.
export function cronMatches(expr: string, instant: Date, timezone = 'UTC'): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const date = cronDateParts(instant, timezone);
  if (!date) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
  const matches = [
    fieldMatches(minute, date.minute, 0, 59),
    fieldMatches(hour, date.hour, 0, 23),
    fieldMatches(dayOfMonth, date.dayOfMonth, 1, 31),
    fieldMatches(month, date.month, 1, 12),
    fieldMatches(dayOfWeek, date.dayOfWeek, 0, 6),
  ];
  return matches.every((match) => match === true);
}

function executedCount(result: unknown): number {
  if (result === null || typeof result !== 'object' || !('fired' in result)) return 0;
  return result.fired === 1 ? 1 : 0;
}

//? The cross-tenant scheduler scan is READ-ONLY. Every due row becomes a stable trigger+minute InternalOp;
//? that op revalidates the trigger and performs action + lastFiredAt under the workspace writer lease.
export async function runCronTriggers(prisma: PrismaClient, now: Date): Promise<{ fired: number }> {
  const triggers = await prisma.workspaceTrigger.findMany({ where: { on: 'cron', enabled: true } });
  const workspaceIds = [...new Set(triggers.map((trigger) => trigger.workspaceId))];
  const workspaces = workspaceIds.length === 0
    ? []
    : await prisma.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, timezone: true } });
  const timezoneByWorkspace = new Map(workspaces.map((workspace) => [workspace.id, workspace.timezone]));
  const minuteAt = Math.floor(now.getTime() / 60_000) * 60_000;
  const { enqueueInternalAction } = await import('../orchestrator/internalOps');
  let fired = 0;
  for (const t of triggers) {
    const timezone = timezoneByWorkspace.get(t.workspaceId);
    if (!t.cron || timezone === undefined || !cronMatches(t.cron, now, timezone)) continue;
    if (t.lastFiredAt && t.lastFiredAt.getTime() >= minuteAt) continue;
    const [error, enqueued] = await tryCatch(() => enqueueInternalAction({
      workspaceId: t.workspaceId,
      op: 'automation-cron-fire',
      target: { triggerId: t.id },
      payload: { minuteAt },
      userId: 'automation',
      clientRequestId: `automation-cron-${t.id}-${String(minuteAt)}`,
    }));
    if (error) { console.error(`[automation] cron trigger ${t.name} enqueue failed:`, error.message); continue; }
    //? Terminal dedup replay intentionally carries no arbitrary internal result, therefore counts zero.
    fired += executedCount(enqueued?.result);
  }
  return { fired };
}

//? Conductor-only InternalOp body. Re-read every mutable trigger field instead of trusting the
//? cross-tenant scan; a concurrent toggle/edit or duplicate tick therefore fails/replays safely.
export async function fireCronTrigger(prisma: PrismaClient, workspaceId: string, triggerId: string, minuteAt: number): Promise<{ fired: number }> {
  assertWorkspaceWriterContext(workspaceId);
  const now = new Date(minuteAt);
  const [trigger, workspace] = await Promise.all([
    prisma.workspaceTrigger.findFirst({ where: { workspaceId, id: triggerId, on: 'cron', enabled: true } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } }),
  ]);
  if (!trigger?.cron || !workspace || !cronMatches(trigger.cron, now, workspace.timezone)) return { fired: 0 };
  if (trigger.lastFiredAt && trigger.lastFiredAt.getTime() >= minuteAt) return { fired: 0 };
  const outcome = await runTriggerAction(prisma, workspaceId, {
    action: trigger.action,
    params: (trigger.params !== null && typeof trigger.params === 'object' ? trigger.params : {}) as Record<string, unknown>,
    triggerName: trigger.name,
  }, trigger.requiresApproval);
  //? A gate is a real occurrence (the suggestion exists), so debounce it. A noop/error may be retried
  //? after its configuration/dependency is fixed and therefore must not be marked as fired.
  if (outcome.status === 'executed' || outcome.status === 'gated') {
    //? The trigger was re-read after entering the serial workspace writer and every same-workspace tick
    //? runs on that chain, so no newer timestamp can appear between the >= guard above and this write.
    await prisma.workspaceTrigger.updateMany({
      where: { workspaceId, id: trigger.id, on: 'cron', enabled: true },
      data: { lastFiredAt: now },
    });
  }
  return { fired: outcome.status === 'executed' ? 1 : 0 };
}
