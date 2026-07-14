//? Cron triggers (#2) — the leased scheduler that fires `on:'cron'` WorkspaceTriggers on schedule
//? (leader-gated, multi-instance-safe: exactly one instance runs it). A minimal 5-field cron matcher
//? (minute hour day-of-month month day-of-week) supporting `*`, `*/n`, `a-b`, `a,b,c`, and exact
//? numbers — enough for the common "every N minutes / daily at HH:MM / weekdays" schedules. A cron
//? trigger has no ticket context, so it runs its action workspace-level through the same approval gate.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import { runTriggerAction } from './executor';

//? One tick per minute (cron's finest granularity). Exported so the @luckystack/cron overlay job schedules it.
export const CRON_TICK_MS = 60_000;

//? Does one cron FIELD (e.g. `*/5`) accept `value`, where the field's range starts at `min`? Pure.
function fieldMatches(field: string, value: number, min: number): boolean {
  for (const part of field.split(',')) {
    if (part === '*') return true;
    const step = part.startsWith('*/') ? Number(part.slice(2)) : null;
    if (step !== null) { if (step > 0 && (value - min) % step === 0) return true; continue; }
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (a !== undefined && b !== undefined && value >= a && value <= b) return true;
      continue;
    }
    if (Number(part) === value) return true;
  }
  return false;
}

//? Does a 5-field cron expression match `date` (to the minute)? Invalid expressions never match.
export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  return (
    fieldMatches(min, date.getMinutes(), 0) &&
    fieldMatches(hour, date.getHours(), 0) &&
    fieldMatches(dom, date.getDate(), 1) &&
    fieldMatches(mon, date.getMonth() + 1, 1) &&
    fieldMatches(dow, date.getDay(), 0)
  );
}

//? Fire every due cron trigger once for the current minute. A per-minute `lastFiredAt` guard stops a
//? double fire if a tick is late/retried. Best-effort per trigger. `now` injected for tests.
export async function runCronTriggers(prisma: PrismaClient, now: Date): Promise<{ fired: number }> {
  const triggers = await prisma.workspaceTrigger.findMany({ where: { on: 'cron', enabled: true } });
  let fired = 0;
  for (const t of triggers) {
    if (!t.cron || !cronMatches(t.cron, now)) continue;
    //? Already fired this minute? (lastFiredAt within the same minute floor.)
    if (t.lastFiredAt && Math.floor(t.lastFiredAt.getTime() / 60_000) === Math.floor(now.getTime() / 60_000)) continue;
    const [error] = await tryCatch(() => runTriggerAction(prisma, t.workspaceId, {
      action: t.action, params: (t.params !== null && typeof t.params === 'object' ? t.params : {}) as Record<string, unknown>, triggerName: t.name,
    }, t.requiresApproval));
    if (error) { console.error(`[automation] cron trigger ${t.name} failed:`, error.message); continue; }
    await prisma.workspaceTrigger.updateMany({ where: { id: t.id }, data: { lastFiredAt: now } });
    fired += 1;
  }
  return { fired };
}
