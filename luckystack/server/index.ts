//? Server overlay entry. `bootstrapLuckyStack` auto-imports every other
//? overlay file before this one, so by the time you see anything here every
//? registry is populated. Put framework-hook registrations
//? (`registerHook('postLogin', ...)`, `registerCustomRoute(...)`) here.

import { registerHook, resolveEnvKey } from '@luckystack/core';
import { registerNotificationHooks } from '../../server/hooks/notifications';
import { registerWorkspacesTerminalHooks } from '../../server/hooks/workspacesTerminal';
import { registerConsoleErrorTracker } from '../../server/hooks/errorTrackingConsole';
import { registerTenantKeyFormatter } from '../../server/tenant/tenantRedis';
import { registerFirstLoginBootstrap } from '../../server/bootstrap/registerBootstrap';

//? Wires the transactional notification hooks (new sign-in email,
//? password-change email). Reads `user.preferences` to respect opt-in. Safe
//? to leave on even if @luckystack/email isn't installed — the email
//? sender no-ops with `{ ok: false, reason: 'no-sender' }`.
registerNotificationHooks();

//? Error-tracking observability (@luckystack/error-tracking): a CONSOLE ErrorTracker so we SEE at runtime
//? what the framework captures (exceptions/messages/identity), + auto-instruments the api/sync hooks. Add a
//? real backend later by setting SENTRY_DSN / POSTHOG_KEY (or `createSentryAdapter()` alongside this one).
registerConsoleErrorTracker();

//? Wires per-workspace Redis key isolation (tenant = Workspace). App keys created
//? inside a `runInTenant(...)` scope are prefixed `:ws:<workspaceId>:`; framework
//? + un-scoped keys keep their historical bytes. Spec: ARCHITECTURE_MULTI_TENANCY §3.
registerTenantKeyFormatter();

//? On first login (no workspace membership yet), seed a demo workspace so the app
//? opens onto populated screens. Idempotent (guarded by the membership count).
registerFirstLoginBootstrap();

//? Wires the Workspaces container terminal relay. It authenticates + workspace-authorizes the socket,
//? derives the ticket container server-side and relays its pty-agent / docker-exec shell. There is no
//? browser→app/host-shell mode in development or production.
registerWorkspacesTerminalHooks();

//? Example dev-only logger — delete or replace with your own audit hook.
registerHook('postLogin', ({ userId, provider, isNewUser }) => {
  if (resolveEnvKey() !== 'production') {
    console.log(`[hooks] login: user=${userId}, provider=${provider}, new=${String(isNewUser)}`);
  }
  return undefined;
});
