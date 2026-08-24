//? Seat-login PTY policy (ADR 0324): the argv is a fixed server-side constant per seat, and only a host
//? superadmin may open the flow. Pure/injected — no Docker, socket, or Prisma needed.
import assert from 'node:assert/strict';

await import('../../config.ts');
const { seatLoginCommand, authorizeSeatLogin } = await import('../../server/hooks/workspacesTerminal.ts');

// --- seatLoginCommand: fixed argv, never client-supplied -------------------------------------------
{
  const claude = seatLoginCommand('claude', 'linux');
  assert.deepEqual(claude.args, ['/login'], 'claude seat runs exactly `claude /login`');

  const codex = seatLoginCommand('codex', 'linux');
  assert.deepEqual(codex.args, ['--provider', 'openai-codex'], 'codex seat opens the pi TUI pinned to openai-codex');

  //? Windows: pi is an npm .cmd shim conpty cannot exec — the command must be wrapped in cmd.exe.
  const codexWin = seatLoginCommand('codex', 'win32');
  assert.equal(codexWin.file, 'cmd.exe');
  assert.equal(codexWin.args[0], '/c');
  assert.deepEqual(codexWin.args.slice(2), ['--provider', 'openai-codex']);
}

// --- authorizeSeatLogin: host-superadmin only (User.admin or WS_SUPERADMIN_EMAILS) -----------------
{
  const asUser = (identity: { admin?: boolean | null; email?: string | null } | null) => ({
    getIdentity: () => Promise.resolve(identity),
  });

  assert.equal(await authorizeSeatLogin('u1', asUser({ admin: true, email: 'a@b.c' })), true, 'User.admin opens the flow');
  assert.equal(await authorizeSeatLogin('u1', asUser({ admin: false, email: 'member@example.com' })), false, 'a plain member is rejected');
  assert.equal(await authorizeSeatLogin('u1', asUser(null)), false, 'an unknown user is rejected');
  assert.equal(await authorizeSeatLogin('', asUser({ admin: true, email: 'a@b.c' })), false, 'an empty userId never authorizes');

  //? The env allowlist half of ADR 0287 — honoured through isHostSuperadmin.
  const prev = process.env.WS_SUPERADMIN_EMAILS;
  process.env.WS_SUPERADMIN_EMAILS = 'Owner@Example.com';
  assert.equal(await authorizeSeatLogin('u1', asUser({ admin: false, email: 'owner@example.com' })), true, 'allowlisted email opens the flow');
  if (prev === undefined) delete process.env.WS_SUPERADMIN_EMAILS; else process.env.WS_SUPERADMIN_EMAILS = prev;
}

console.log('seat-login unit tests passed');
