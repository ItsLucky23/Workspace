//? HTTP e2e — the Workspaces control-API write path, end to end over the REAL running
//? dev server (http://localhost:80). Exercises the exact browser contract: cookie-mode
//? session + the session-bound CSRF token + the origin gate. The generic /control/v1
//? endpoint was split into typed per-action routes (Fase-0), so this drives those. Flow:
//?   register (credentials, CSRF-exempt) -> a fresh user has NO workspace (login seeding
//?   disabled — they onboard) -> GET /auth/csrf -> snapshot (0 workspaces) -> createWorkspace
//?   (dedicated route, returns the new id) -> snapshot (1 workspace + starter seed) ->
//?   markRead (a second per-action control write) acks. quick-add is now a `_sync` socket
//?   op (covered by its own suite), not reachable over plain HTTP here.
//? The Conductor writes ASYNC off the serial chain, so snapshots poll.
//? Best-effort cleanup (throwaway owner + created workspace) before report().

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { ports } from '../../config.ports';

//? Gap-fix: the base/origin were hardcoded to the OLD dev ports (80/5173) — after the port move to
//? 4787/5391 every request hit nothing and the whole suite failed ("register returned status:true").
//? Resolve like vite.config does: the server's ACTUALLY-bound port file, falling back to config.ports.
function backendPort(): number {
  try {
    const raw = readFileSync(path.join(process.cwd(), 'node_modules', '.luckystack', 'dev-server.json'), 'utf8');
    const info = JSON.parse(raw) as { port?: number };
    return info.port ?? ports.backend;
  } catch { return ports.backend; }
}
const BASE = `http://localhost:${String(backendPort())}`;
const ORIGIN = `http://localhost:${String(ports.frontend)}`; // the dev public origin (Vite) — passes the origin gate
const email = `e2e-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@test.local`;
const password = 'Test1234!aA'; // upper + lower + digit + special, len 11 — satisfies the default policy

// ---- a tiny cookie jar: capture every Set-Cookie, replay them all ----
const jar = new Map<string, string>();
function storeCookies(res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(';', 1)[0];
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }
}
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

let csrfToken = '';
async function apiPost(path: string, data: unknown): Promise<{ status?: string; result?: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      Cookie: cookieHeader(),
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(data), // the raw data object IS the body (not wrapped in { data })
  });
  storeCookies(res);
  return res.json() as Promise<{ status?: string; result?: Record<string, unknown> }>;
}

function ticketCount(snapshot: { result?: Record<string, unknown> }): number {
  const tickets = snapshot.result?.tickets;
  return Array.isArray(tickets) ? tickets.length : -1;
}
function workspaceCount(snapshot: { result?: Record<string, unknown> }): number {
  const w = snapshot.result?.workspaces;
  return Array.isArray(w) ? w.length : -1;
}

let ownerId: string | undefined;
let workspaceId: string | undefined;

try {
  // 1) Register a fresh credentials user. The route is CSRF-exempt; the postLogin
  //    hook seeds the demo workspace (awaited) before the response returns.
  const regRes = await fetch(`${BASE}/auth/api/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password, name: 'E2E Tester', confirmPassword: password, provider: 'credentials' }),
  });
  storeCookies(regRes);
  const regBody = (await regRes.json()) as { status?: boolean; authenticated?: boolean };
  assert(regBody.status === true, 'register returned status:true');
  assert(regBody.authenticated === true, 'register authenticated the new user');
  assert(jar.has('token'), 'register set the session cookie');

  // 2) Fetch the session-bound CSRF token (needs the session cookie).
  const csrfRes = await fetch(`${BASE}/auth/csrf`, { headers: { Origin: ORIGIN, Cookie: cookieHeader() } });
  storeCookies(csrfRes);
  const csrfBody = (await csrfRes.json()) as { csrfToken?: string };
  csrfToken = csrfBody.csrfToken ?? '';
  assert(csrfToken.length > 0, 'GET /auth/csrf returned a token');

  // 3) First snapshot — a fresh user now has NO workspace (login seeding disabled;
  //    they go through onboarding). Expect zero workspaces + no active workspace.
  const snap1 = await apiPost('/api/workspaces/snapshot/v1', {});
  assert(snap1.status === 'success', 'snapshot v1 returned success');
  eq(workspaceCount(snap1), 0, 'a fresh user starts with zero workspaces');
  assert(snap1.result?.activeWorkspaceId == null, 'no active workspace before onboarding');

  // 4) Onboarding: create a workspace via the DEDICATED per-action [control-API] route
  //    (the generic /control/v1 endpoint was split into typed per-action routes — Fase-0).
  //    Login-only op: the caller becomes Owner; the route returns the new workspaceId.
  const cw = await apiPost('/api/workspaces/createWorkspace/v1', {
    name: 'E2E Workspace', clientRequestId: 'cw1',
  });
  assert(cw.status === 'success', 'createWorkspace returned success');
  const cwId = cw.result?.workspaceId;
  assert(typeof cwId === 'string' && cwId.length > 0, 'createWorkspace returned the new workspaceId');
  workspaceId = typeof cwId === 'string' ? cwId : undefined;

  // 5) Poll the snapshot until the new workspace lands — it has a pipeline + the light
  //    starter seed. createBlankWorkspace is awaited before the route acks, so the seed
  //    is present on the next snapshot (the Conductor drains async off the serial chain).
  let created: { result?: Record<string, unknown> } = {};
  for (let i = 0; i < 30; i += 1) {
    created = await apiPost('/api/workspaces/snapshot/v1', {});
    if (workspaceCount(created) === 1) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  eq(workspaceCount(created), 1, 'after createWorkspace the user has one workspace');
  assert(ticketCount(created) >= 1, 'the freshly-created workspace ships the starter-seed tickets');
  const activeId = created.result?.activeWorkspaceId;
  assert(activeId === workspaceId, 'the new workspace is the active one');

  // 6) A second per-action control write over HTTP — mark all notifications read
  //    ([control-API] path: _api route -> RBAC -> enqueue -> Conductor). Asserts the
  //    dedicated write route accepts + acks (quick-add itself is now a `_sync` socket op,
  //    covered by the quickAdd + activityFeed suites — not reachable over plain HTTP here).
  const mr = await apiPost('/api/workspaces/markRead/v1', { workspaceId, all: true, clientRequestId: 'e1' });
  assert(mr.status === 'success', 'a second control write (markRead) succeeded over HTTP');
  assert(mr.result?.accepted === true, 'the control write acked (accepted)');
} finally {
  // Best-effort cleanup: delete the seeded workspace + all tenant rows + the
  // throwaway owner (and demo member Users) so the DB is left clean.
  const [cleanupErr] = await (async (): Promise<[Error | null]> => {
    try {
      const prisma = await db();
      const user = await prisma.user.findFirst({ where: { email } });
      ownerId = user?.id;
      if (ownerId) {
        const memberships = await prisma.workspaceMember.findMany({ where: { userId: ownerId }, select: { workspaceId: true } });
        const ids = new Set([...memberships.map((m) => m.workspaceId), ...(workspaceId ? [workspaceId] : [])]);
        for (const id of ids) await cleanupWorkspace(prisma, id, [ownerId]);
        await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
      }
      return [null];
    } catch (error) {
      return [error instanceof Error ? error : new Error(String(error))];
    }
  })();
  assert(!cleanupErr, `cleanup completed${cleanupErr ? `: ${cleanupErr.message}` : ''}`);
}

report('tests/e2e/httpControl.test.mts');
