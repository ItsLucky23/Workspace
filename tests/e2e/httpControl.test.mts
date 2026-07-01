//? HTTP e2e — the Fase-1 Workspaces control-API write path, end to end over the
//? REAL running dev server (http://localhost:80). Exercises the exact browser
//? contract: cookie-mode session + the double-submit-less, session-bound CSRF
//? token + the origin gate. Flow:
//?   register (credentials, CSRF-exempt) -> postLogin hook seeds the demo workspace
//?   -> GET /auth/csrf (session-bound token) -> POST snapshot (12 tickets)
//?   -> POST control quick-add -> Conductor drains -> snapshot (13 tickets).
//? The Conductor writes ASYNC off the serial chain, so the second snapshot polls.
//? Best-effort cleanup (throwaway owner + seeded workspace) before report().

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const BASE = 'http://localhost:80';
const ORIGIN = 'http://localhost:5173'; // the dev public origin (Vite) — passes the origin gate
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

  // 3) First snapshot — the seeded demo workspace has exactly 12 tickets.
  const snap1 = await apiPost('/api/workspaces/snapshot/v1', {});
  assert(snap1.status === 'success', 'snapshot v1 returned success');
  eq(ticketCount(snap1), 12, 'seeded workspace has 12 tickets');
  const activeId = snap1.result?.activeWorkspaceId;
  assert(typeof activeId === 'string' && activeId.length > 0, 'snapshot carries an active workspaceId');
  workspaceId = typeof activeId === 'string' ? activeId : undefined;

  // 4) Control quick-add — the single write op through the [control-API] path.
  const ctrl = await apiPost('/api/workspaces/control/v1', {
    workspaceId,
    op: 'quick-add',
    target: {},
    payload: { title: 'HTTP E2E' },
    clientRequestId: 'e1',
  });
  assert(ctrl.status === 'success', 'control quick-add returned success');
  assert(ctrl.result?.accepted === true, 'control ack: accepted');

  // 5) The Conductor writes asynchronously — poll the snapshot until the ticket lands.
  let after = -1;
  for (let i = 0; i < 30; i += 1) {
    const snap = await apiPost('/api/workspaces/snapshot/v1', {});
    after = ticketCount(snap);
    if (after === 13) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  eq(after, 13, 'after quick-add the workspace has 13 tickets');
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
