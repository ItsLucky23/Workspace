//? Workspaces — the tenant-aware Redis key formatter.
//?
//? Registered once at boot. App keys created INSIDE a tenant scope get a
//? per-workspace prefix (`<project>:ws:<workspaceId>:<namespace>`); framework
//? namespaces (`-session`, `:rate-limit`) and any key created outside a tenant
//? scope delegate to the framework's default formatter so historical key bytes
//? are byte-identical (zero migration, and framework internals never break).
//?
//? Spec: docs/luckystack/ARCHITECTURE_MULTI_TENANCY.md §3. A worker that forgets
//? `runInTenant` therefore keeps writing to the app-global keyspace rather than a
//? tenant's — pair this with the `runInTenant` checklist (MIGRATION §7) which is
//? the primary isolation guarantee (`currentWorkspaceId()` throws in `tenantDb`).

import { registerRedisKeyFormatter, defaultRedisKeyFormatter } from '@luckystack/core';

import { currentWorkspaceId, hasTenantScope } from './tenantContext';

export function registerTenantKeyFormatter(): void {
  registerRedisKeyFormatter((namespace, suffix) => {
    //? Framework namespaces (leading '-'/':') + any un-scoped call → historical bytes.
    if (/^[-:]/.test(namespace) || !hasTenantScope()) {
      return defaultRedisKeyFormatter(namespace, suffix);
    }
    const project = process.env.PROJECT_NAME ?? 'luckystack';
    const root = `${project}:ws:${currentWorkspaceId()}:${namespace}`;
    return suffix === '' ? root : `${root}:${suffix}`;
  });
}
