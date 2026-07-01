//? Server overlay entry. `bootstrapLuckyStack` auto-imports every other
//? overlay file before this one, so by the time you see anything here every
//? registry is populated. Put framework-hook registrations
//? (`registerHook('postLogin', ...)`, `registerCustomRoute(...)`) here.

import { registerHook, resolveEnvKey } from '@luckystack/core';
import { registerNotificationHooks } from '../../server/hooks/notifications';
import { registerWorkspacesTerminalHooks } from '../../server/hooks/workspacesTerminal';
import { registerTenantKeyFormatter } from '../../server/tenant/tenantRedis';

//? Wires the transactional notification hooks (new sign-in email,
//? password-change email). Reads `user.preferences` to respect opt-in. Safe
//? to leave on even if @luckystack/email isn't installed — the email
//? sender no-ops with `{ ok: false, reason: 'no-sender' }`.
registerNotificationHooks();

//? Wires per-workspace Redis key isolation (tenant = Workspace). App keys created
//? inside a `runInTenant(...)` scope are prefixed `:ws:<workspaceId>:`; framework
//? + un-scoped keys keep their historical bytes. Spec: ARCHITECTURE_MULTI_TENANCY §3.
registerTenantKeyFormatter();

//? Wires the Workspaces dev terminal PTY bridge (Socket.io ⇄ node-pty). It
//? HARD-gates itself to non-production (a browser→host-shell channel is an RCE
//? surface); the real product replaces it with the per-container pty-agent.
//? Only needed so the prototype Terminals screen works locally during the build.
registerWorkspacesTerminalHooks();

//? Example dev-only logger — delete or replace with your own audit hook.
registerHook('postLogin', ({ userId, provider, isNewUser }) => {
  if (resolveEnvKey() !== 'production') {
    console.log(`[hooks] login: user=${userId}, provider=${provider}, new=${String(isNewUser)}`);
  }
  return undefined;
});
