//? GAP_SCAN E2 — tenant scoping for BACKGROUND WRITERS, shipped report-first.
//?
//? Invariant #4 says every orchestrator-side path runs inside `runInTenant`. Three background writers
//? never did: `server/automation/executor.ts`, `server/content/publish.ts` and `server/rag/memory.ts`.
//? They are cron/loop driven, so there is no request boundary to inherit a scope from — every query they
//? make is unscoped, and row isolation simply is not applied.
//?
//? Flipping that to a loud failure in one step is the wrong trade (the working agreement for Phase E):
//? these loops legitimately scan ACROSS tenants first (find all due jobs, all workspaces with a trigger)
//? and only then act on one workspace. So this guard does two things:
//?
//?   1. it OPENS the scope for the per-item work — strictly safer than no scope, and the actual fix;
//?   2. it RECORDS every call that arrived without a scope (what enforcement would have rejected), so the
//?      report can be reviewed before `WS_TENANT_ENFORCE=1` turns a nested mismatch into a crash.
//?
//? The cross-tenant SCAN stays deliberately outside a scope: a loop that must see every workspace's due
//? work cannot run inside one workspace's isolation, and pretending otherwise would break the scheduler.

import { runInTenant, hasTenantScope, currentWorkspaceId } from './tenantContext';

export const TENANT_ENFORCE = process.env.WS_TENANT_ENFORCE === '1';

export interface TenantScopeObservation { label: string; workspaceId: string; hadScope: boolean; mismatch: boolean; at: number }

//? Bounded in-memory ring — this is a review aid ("what would enforcement have blocked?"), not a log sink.
const observations: TenantScopeObservation[] = [];
const MAX_OBSERVATIONS = 500;

export function recordTenantObservation(o: TenantScopeObservation): void {
  observations.push(o);
  if (observations.length > MAX_OBSERVATIONS) observations.splice(0, observations.length - MAX_OBSERVATIONS);
}

export function tenantGuardReport(): { total: number; missingScope: number; mismatches: number; byLabel: { label: string; missingScope: number; mismatches: number }[] } {
  const byLabel = new Map<string, { missingScope: number; mismatches: number }>();
  for (const o of observations) {
    const entry = byLabel.get(o.label) ?? { missingScope: 0, mismatches: 0 };
    if (!o.hadScope) entry.missingScope += 1;
    if (o.mismatch) entry.mismatches += 1;
    byLabel.set(o.label, entry);
  }
  return {
    total: observations.length,
    missingScope: observations.filter((o) => !o.hadScope).length,
    mismatches: observations.filter((o) => o.mismatch).length,
    byLabel: [...byLabel.entries()].map(([label, v]) => ({ label, ...v })),
  };
}

export function resetTenantGuardReport(): void { observations.length = 0; }

//? Run background work inside `workspaceId`'s tenant scope.
//?
//? A MISMATCH (already inside a DIFFERENT workspace's scope) is the genuinely dangerous case — it means a
//? loop is reaching across tenants mid-flight. That is what `WS_TENANT_ENFORCE=1` turns into a throw; until
//? then it is recorded. A missing scope is simply opened, which is the fix, and recorded so the report
//? shows how much of the system was running unscoped.
export function withTenant<T>(workspaceId: string, label: string, fn: () => T): T {
  const hadScope = hasTenantScope();
  const outer = hadScope ? currentWorkspaceId() : null;
  const mismatch = outer !== null && outer !== workspaceId;
  recordTenantObservation({ label, workspaceId, hadScope, mismatch, at: Date.now() });
  if (mismatch) {
    const message = `[tenant] ${label}: nested scope switch ${outer} → ${workspaceId}`;
    if (TENANT_ENFORCE) throw new Error(message);
    console.warn(`${message} (report-only; set WS_TENANT_ENFORCE=1 to enforce)`);
  }
  return runInTenant(workspaceId, fn);
}
