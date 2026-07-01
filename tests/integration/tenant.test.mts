//? Integration test — Workspaces Fase-1 tenant isolation (tenant = Workspace).
//?
//? Proves the row-isolation guarantee end-to-end against the REAL Mongo: two
//? workspaces created via bootstrapWorkspace, and a tenantDb read inside
//? runInTenant(wsA) sees ONLY wsA's rows; currentWorkspaceId() fails LOUDLY
//? outside any tenant scope; and TENANT_MODELS draws the framework-global vs
//? tenant-scoped line correctly (04b §11b, ARCHITECTURE_MULTI_TENANCY §1/§2).
//?
//? Run: npx tsx tests/integration/tenant.test.mts

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

//? Resolve secrets + Prisma FIRST, then dynamic-import the CUT — the server modules
//? call getPrismaClient()/$extends at module-load, so they must load post-init.
const prisma = await db();

const { bootstrapWorkspace } = await import('../../server/orchestrator/conductor');
const { runInTenant, currentWorkspaceId } = await import('../../server/tenant/tenantContext');
const { tenantDb, TENANT_MODELS } = await import('../../server/tenant/tenantDb');

let wsA: string | undefined;
let wsB: string | undefined;
let ownerId: string | undefined;

try {
  //? ---- setup: one owner User + two workspaces (each seeds its own 3 built-in roles) ----
  const owner = await prisma.user.create({
    data: { email: `test-tenant-${String(Date.now())}@example.com`, name: 'Tenant Test Owner' },
  });
  ownerId = owner.id;

  wsA = (await bootstrapWorkspace({ name: `TenantTestA-${String(Date.now())}`, ownerId: owner.id })).workspaceId;
  wsB = (await bootstrapWorkspace({ name: `TenantTestB-${String(Date.now())}`, ownerId: owner.id })).workspaceId;
  assert(wsA !== wsB, 'the two bootstrapped workspaces have distinct ids');

  //? ---- row isolation: a tenantDb read inside runInTenant(wsA) sees ONLY wsA's roles ----
  //? REGRESSION GUARD (lesson 0003): a NO-ARG `findMany()` MUST be tenant-scoped — the
  //? read path (workspaceSnapshot.ts) uses exactly this form. Earlier the extension only
  //? injected `workspaceId` when a `where` was already present, so no-arg reads leaked
  //? every workspace's rows. Fixed in tenantDb.ts; this asserts the no-arg form is scoped.
  const rolesA = await runInTenant(wsA, async () => tenantDb.workspaceRole.findMany());
  eq(rolesA.length, 3, 'runInTenant(wsA) → NO-ARG tenantDb.workspaceRole.findMany() returns exactly wsA\'s 3 roles');
  assert(rolesA.every((r) => r.workspaceId === wsA), 'every role returned inside wsA scope is scoped to wsA (never wsB)');
  assert(!rolesA.some((r) => r.workspaceId === wsB), 'no wsB role leaks into the no-arg wsA-scoped read');

  //? Symmetric check — wsB's scope returns its own disjoint 3 roles (also no-arg).
  const rolesB = await runInTenant(wsB, async () => tenantDb.workspaceRole.findMany());
  eq(rolesB.length, 3, 'runInTenant(wsB) returns exactly wsB\'s 3 roles');
  const idsA = new Set(rolesA.map((r) => r.id));
  assert(rolesB.every((r) => !idsA.has(r.id)), 'wsA and wsB role sets are fully disjoint');

  //? ---- loud-fail guarantee: currentWorkspaceId() throws OUTSIDE any tenant scope ----
  let threw = false;
  try {
    currentWorkspaceId();
  } catch {
    threw = true;
  }
  assert(threw, 'currentWorkspaceId() throws when called outside runInTenant (isolation guarantee, not a bug)');

  //? Inside a scope it returns the active id.
  const seen = runInTenant(wsA, () => currentWorkspaceId());
  eq(seen, wsA, 'currentWorkspaceId() returns the active workspaceId inside runInTenant');

  //? ---- the framework-global vs tenant-scoped model split (TENANT_MODELS) ----
  assert(!TENANT_MODELS.has('User'), 'TENANT_MODELS excludes User (framework-global)');
  assert(!TENANT_MODELS.has('Workspace'), 'TENANT_MODELS excludes Workspace (the tenant ROOT, keyed by its own id)');
  assert(!TENANT_MODELS.has('SshKey'), 'TENANT_MODELS excludes SshKey (framework-global)');
  assert(!TENANT_MODELS.has('PushSubscription'), 'TENANT_MODELS excludes PushSubscription (framework-global)');
  assert(TENANT_MODELS.has('Ticket'), 'TENANT_MODELS includes Ticket (tenant-scoped)');
  assert(TENANT_MODELS.has('WorkspaceMember'), 'TENANT_MODELS includes WorkspaceMember (tenant-scoped)');
  assert(TENANT_MODELS.has('EnvVar'), 'TENANT_MODELS includes EnvVar (tenant-scoped)');

  //? ---- REGRESSION GUARD: the MOST dangerous cross-tenant path — a NO-`where`
  //? MUTATION (updateMany/deleteMany with no filter) must hit ONLY the active tenant.
  //? A bug that injected workspaceId only when a `where` already existed would make
  //? these blanket-write/delete EVERY workspace's rows. Also covers create-stamping
  //? + no-arg count. bootstrapWorkspace seeds no EnvVars, so each ws starts at 0.
  const stamp = String(Date.now());
  //? create-stamping: no workspaceId in `data` → the extension stamps the active one.
  const envA = await runInTenant(wsA, async () => tenantDb.envVar.create({ data: { key: `K_A_${stamp}`, value: 'a', secret: false } }));
  const envB = await runInTenant(wsB, async () => tenantDb.envVar.create({ data: { key: `K_B_${stamp}`, value: 'b', secret: false } }));
  eq(envA.workspaceId, wsA, 'tenantDb.create in wsA scope stamps workspaceId=wsA (no explicit id in data)');
  eq(envB.workspaceId, wsB, 'tenantDb.create in wsB scope stamps workspaceId=wsB');

  //? no-arg count is tenant-scoped (never counts the other tenant's row).
  const countA = await runInTenant(wsA, async () => tenantDb.envVar.count());
  eq(countA, 1, 'runInTenant(wsA) → NO-ARG tenantDb.envVar.count() counts ONLY wsA rows');

  //? no-`where` updateMany in wsA MUST NOT touch wsB's row.
  await runInTenant(wsA, async () => tenantDb.envVar.updateMany({ data: { value: 'changed-A' } }));
  const bAfterUpdate = await prisma.envVar.findUnique({ where: { id: envB.id } });
  eq(bAfterUpdate?.value, 'b', 'no-`where` updateMany in wsA left wsB\'s env var UNCHANGED (no cross-tenant write)');
  const aAfterUpdate = await prisma.envVar.findUnique({ where: { id: envA.id } });
  eq(aAfterUpdate?.value, 'changed-A', 'no-`where` updateMany in wsA DID update wsA\'s own row');

  //? no-`where` deleteMany in wsA MUST NOT delete wsB's row.
  await runInTenant(wsA, async () => tenantDb.envVar.deleteMany({}));
  const bAfterDelete = await prisma.envVar.findUnique({ where: { id: envB.id } });
  assert(bAfterDelete !== null, 'no-`where` deleteMany in wsA left wsB\'s env var INTACT (no cross-tenant delete)');
  const aAfterDelete = await prisma.envVar.findUnique({ where: { id: envA.id } });
  assert(aAfterDelete === null, 'no-`where` deleteMany in wsA DID delete wsA\'s own row');
} finally {
  //? ---- best-effort cleanup: both workspaces + all tenant rows + the demo owner ----
  if (wsA) await cleanupWorkspace(prisma, wsA, ownerId ? [ownerId] : []);
  if (wsB) await cleanupWorkspace(prisma, wsB, ownerId ? [ownerId] : []);
}

report('tests/integration/tenant.test.mts');
