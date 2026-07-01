//? Workspaces — the request-scoped tenant context (tenant = Workspace).
//?
//? Resolve the active workspace ONCE at the request boundary (a `preApiExecute`
//? subscriber for `/api`; an explicit `runInTenant(...)` for every non-`/api`
//? background worker — the Conductor, sync handlers, crons, the signal-consumer)
//? and stash it in AsyncLocalStorage so the isolation layers (`tenantDb`, the
//? Redis key formatter) can read it without threading it through every call.
//?
//? Spec: docs/luckystack/ARCHITECTURE_MULTI_TENANCY.md §1; the mandatory-coverage
//? checklist for background workers is MIGRATION §7 (04b §11c) — a forgotten
//? `runInTenant` is a LOUD crash (currentWorkspaceId throws), never a silent
//? cross-tenant read.

import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContext {
  workspaceId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

//? Run `fn` inside the given workspace's tenant scope. Everything the callback
//? touches (`tenantDb.*`, `formatKey(...)`) is auto-scoped to `workspaceId`.
export const runInTenant = <T>(workspaceId: string, fn: () => T): T =>
  storage.run({ workspaceId }, fn);

//? The active workspace id. THROWS outside a tenant scope — a loud failure beats
//? silently querying across tenants (this is the isolation guarantee, not a bug).
export const currentWorkspaceId = (): string => {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('No tenant context — call runInTenant() at the request boundary.');
  return ctx.workspaceId;
};

//? Non-throwing probe: is a tenant scope active? (For code paths shared between
//? tenant-scoped and framework-global contexts, e.g. the Redis key formatter.)
export const hasTenantScope = (): boolean => storage.getStore() !== undefined;
