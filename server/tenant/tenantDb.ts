//? Workspaces — the tenant-scoped Prisma client (row isolation via `$extends`).
//?
//? Wraps the framework Prisma singleton in a query-extension that injects
//? `workspaceId` into every read/write of a TENANT model, reading the active
//? workspace from the request-scoped tenant context. App handlers use `tenantDb.*`
//? for tenant data; framework-global tables (`User`/`SshKey`/`PushSubscription`,
//? the session store) keep using `prisma`/`getPrismaClient()` directly.
//?
//? Spec: docs/luckystack/ARCHITECTURE_MULTI_TENANCY.md §2; the framework-global vs
//? tenant split is 04b §11b / MIGRATION §3.4. A cross-tenant read fails LOUDLY
//? (currentWorkspaceId throws when no scope is active).

import { getPrismaClient } from '@luckystack/core';

import { currentWorkspaceId } from './tenantContext';

//? Every model that carries a `workspaceId` column (04b §11b). Framework-global
//? rows (`User`, `SshKey`, `PushSubscription`) and the tenant ROOT (`Workspace`,
//? keyed by its own `id`, no `workspaceId`) are DELIBERATELY absent — injecting a
//? `workspaceId` filter on them would be wrong.
export const TENANT_MODELS = new Set<string>([
  'WorkspaceMember',
  'WorkspaceRole',
  'Invite',
  'Project',
  'PipelineStage',
  'Ticket',
  'TicketLink',
  'TicketReference',
  'Sprint',
  'TicketEvent',
  'AgentSession',
  'CarryOver',
  'Handoff',
  'QuestionSet',
  'WorkspaceTrigger',
  'WorkspaceSignal',
  'WorkspaceSuggestion',
  'WorkspaceNote',
  'SpendRecord',
  'WorkspaceBudget',
  'Notification',
  'InfoSource',
  'RagEntry',
  'EnvVar',
  'IntegrationTool',
]);

//? The tenant-scoped client. `tenantDb.ticket.findMany()` only ever sees the
//? current workspace's rows; `tenantDb.ticket.create({ data })` stamps
//? `workspaceId` automatically. Non-tenant models pass through untouched.
export const tenantDb = getPrismaClient().$extends({
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const workspaceId = currentWorkspaceId();
        const a: Record<string, unknown> = args;
        const data = a.data;
        //? create/createMany → stamp `workspaceId` onto the data.
        if (operation === 'create' && data !== null && typeof data === 'object') {
          a.data = { ...data, workspaceId };
          return query(args);
        }
        if (operation === 'createMany' && Array.isArray(data)) {
          const rows: unknown[] = data;
          a.data = rows.map((row) => (row !== null && typeof row === 'object' ? { ...row, workspaceId } : row));
          return query(args);
        }
        //? EVERY other operation (find*/update*/delete*/count/aggregate/upsert) → force
        //? `where.workspaceId`, INCLUDING no-arg reads like `findMany()` where no `where`
        //? exists yet. Missing this leaks cross-tenant rows (the whole point of tenantDb).
        const where = a.where;
        a.where = where !== null && typeof where === 'object' ? { ...where, workspaceId } : { workspaceId };
        //? upsert also creates — stamp the create payload too.
        if (operation === 'upsert' && a.create !== null && typeof a.create === 'object') {
          a.create = { ...a.create, workspaceId };
        }
        return query(args);
      },
    },
  },
});
