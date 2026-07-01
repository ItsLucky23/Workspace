//? Server overlay entry. `bootstrapLuckyStack` auto-imports every other
//? overlay file before this one, so by the time you see anything here every
//? registry is populated. Put framework-hook registrations
//? (`registerHook('postLogin', ...)`, `registerCustomRoute(...)`) here.

import { registerHook, resolveEnvKey } from '@luckystack/core';
import { registerNotificationHooks } from '../../server/hooks/notifications';

//? Wires the transactional notification hooks (new sign-in email,
//? password-change email). Reads `user.preferences` to respect opt-in. Safe
//? to leave on even if @luckystack/email isn't installed — the email
//? sender no-ops with `{ ok: false, reason: 'no-sender' }`.
registerNotificationHooks();

//? Example dev-only logger — delete or replace with your own audit hook.
registerHook('postLogin', ({ userId, provider, isNewUser }) => {
  if (resolveEnvKey() !== 'production') {
    console.log(`[hooks] login: user=${userId}, provider=${provider}, new=${String(isNewUser)}`);
  }
  return undefined;
});
