# Multi-tenancy pattern (tenant = Workspace)

> How to build a multi-tenant product on LuckyStack where **each tenant is a
> Workspace**. The framework gives you the authentication gate and three
> composable isolation primitives; the **tenant model and authorization (RBAC)
> are app domain** — the framework deliberately stays at the transport/session
> altitude (auth ≠ authz). Read alongside `docs/ARCHITECTURE_SESSION.md`,
> `docs/ARCHITECTURE_SECRET_MANAGER.md`, and the `@luckystack/core` client +
> key-formatter registries.

## What the framework owns vs. what you build

| Concern | Framework | You |
|---|---|---|
| "Is there a logged-in user?" | `auth={ login: true }` gate | — |
| "Which workspace is this request for?" | — | resolve + carry a tenant context |
| "May this user do this in this workspace?" | — | RBAC (Owner/Admin/Member) in your handlers |
| DB row isolation | Prisma client registry (`getPrismaClientFor`) | a tenant-scoped `$extends` client |
| Redis key isolation | `registerRedisKeyFormatter` / `formatKey` | a tenant-aware formatter |
| Per-tenant secrets | `@luckystack/secret-manager` | a per-workspace token, encrypted on the Workspace row |

The framework's auth gate only proves identity. Owner/Admin/Member membership, per-workspace permission checks, and tenant resolution are **policy** — keep them in `main(...)` or one project-wide `preApiExecute` hook subscriber.

## 1. Carry the tenant in a request-scoped context

Resolve the workspace once per request (from the route, a header, or the
session) and stash it in `AsyncLocalStorage` so the isolation layers below can
read it without threading it through every call.

```ts
// functions/tenantContext.ts
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContext { workspaceId: string; }
const storage = new AsyncLocalStorage<TenantContext>();

export const runInTenant = <T>(workspaceId: string, fn: () => T): T =>
  storage.run({ workspaceId }, fn);

//? Throws when called outside a tenant scope — a loud failure beats silently
//? querying across tenants.
export const currentWorkspaceId = (): string => {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('No tenant context — call runInTenant() at the request boundary.');
  return ctx.workspaceId;
};
```

Enter the scope at the request boundary (e.g. a `preApiExecute` hook subscriber that reads the workspace from the validated session/route and verifies membership before any handler runs).

## 2. DB row isolation — Prisma `$extends` where-injection

Wrap the framework's Prisma client in a query-extension that injects
`workspaceId` into every read and write of tenant-scoped models. Register the
**base** client on the default slot (framework internals use it for sessions
etc.); build the tenant-scoped client on top for app queries.

```ts
// functions/tenantDb.ts
import { getPrismaClient } from '@luckystack/core';
import { currentWorkspaceId } from './tenantContext';

const TENANT_MODELS = new Set(['Ticket', 'Event', 'Membership']); // models that carry workspaceId

export const tenantDb = getPrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_MODELS.has(model)) return query(args);
        const workspaceId = currentWorkspaceId();
        if (operation === 'create') {
          args.data = { ...args.data, workspaceId };
        } else if ('where' in args) {
          args.where = { ...args.where, workspaceId };
        }
        return query(args);
      },
    },
  },
});
```

Now `tenantDb.ticket.findMany()` only ever sees the current workspace's rows,
and `tenantDb.ticket.create({ data })` stamps the `workspaceId` automatically.
Keep `prisma`/`getPrismaClient()` for framework-global tables (the `User`
record, sessions). See `docs/ARCHITECTURE_SESSION.md` for the session layer.

### Graded credentials per tenant or per privilege (R2)

The client registry is **keyed** — register more than one client and resolve
by slot for read-only vs read-write, or a client per tenant:

```ts
import { registerPrismaClient, getPrismaClientFor } from '@luckystack/core';

registerPrismaClient(new PrismaClient({ datasourceUrl: process.env.DB_RO }), 'ro');
registerPrismaClient(new PrismaClient({ datasourceUrl: process.env.DB_RW }), 'rw');

const reader = getPrismaClientFor('ro'); // a stage that may only read
```

A keyed lookup never silently falls back to the privileged default — an
unregistered slot throws, so a read-only stage can't accidentally get write
access. (`registerRedisClient`/`getRedisClientFor` mirror this.)

## 3. Redis key isolation — `registerRedisKeyFormatter` (R3)

Every framework Redis key flows through `formatKey(namespace, suffix)`. Register
a tenant-aware formatter at boot so **app** keys are partitioned per workspace.
The formatter reads the same request-scoped tenant context:

```ts
import { registerRedisKeyFormatter, formatKey } from '@luckystack/core';
import { currentWorkspaceId } from './tenantContext';

registerRedisKeyFormatter((namespace, suffix) => {
  //? App namespaces (no leading separator) get a per-workspace prefix.
  //? Framework namespaces (leading '-'/':', e.g. '-session', ':rate-limit')
  //? stay app-global — sessions belong to a user across the whole app, not to
  //? one workspace — so reproduce the historical shape for them.
  const project = process.env.PROJECT_NAME ?? 'luckystack';
  if (/^[-:]/.test(namespace)) {
    const root = `${project}${namespace}`;
    return suffix === '' ? root : `${root}:${suffix}`;
  }
  const root = `${project}:ws:${currentWorkspaceId()}:${namespace}`;
  return suffix === '' ? root : `${root}:${suffix}`;
});

// App code:
await redis.sadd(formatKey('presence', `ticket:${ticketId}`), userId);
// -> "<project>:ws:<workspaceId>:presence:ticket:<id>"
```

> A custom formatter MUST keep the `<namespace-root>:<suffix>` join — the
> framework derives `SCAN` match patterns from `formatKey(namespace, '')` for
> session/rate-limit enumeration. Decide deliberately whether sessions and
> rate-limits are app-global (recommended — a user's session spans workspaces)
> or per-workspace.

## 4. Per-workspace secrets

Each workspace can hold its own credentials (e.g. a GitLab token). Store the
token **encrypted on the Workspace row** and decrypt per request, or — for
shared infra secrets — resolve `.env` pointers at boot via
`@luckystack/secret-manager` (see `docs/ARCHITECTURE_SECRET_MANAGER.md`). The
per-workspace, user-supplied token is app data on the Workspace entity, not a
framework env pointer.

## 5. RBAC stays app domain

The framework stops at `auth={ login: true }`. Model membership + roles
yourself:

```prisma
model Membership {
  id          String @id @default(cuid())
  userId      String
  workspaceId String
  role        Role   // OWNER | ADMIN | MEMBER
  @@unique([userId, workspaceId])
}
```

Enforce the matrix in `main(...)` (or one project-wide `preApiExecute`
subscriber that can stop the request): resolve the caller's membership for the
target workspace, check the role against the action, and only then enter
`runInTenant(...)`. `AuthProps.additional[]` handles flat session predicates
(`auth={ login: true, additional: [...] }`) but a stage→tool permission matrix
is authz policy — keep it in the handler.

## Putting it together (request lifecycle)

1. `auth={ login: true }` → framework proves identity.
2. `preApiExecute` subscriber resolves the target `workspaceId`, loads the
   caller's `Membership`, checks the role (else stop with a reason), then
   `runInTenant(workspaceId, () => ...)`.
3. Inside the scope: `tenantDb.*` auto-filters rows, `formatKey(...)`
   auto-prefixes Redis keys, per-workspace secrets decrypt from the Workspace
   row — all reading the one tenant context.
