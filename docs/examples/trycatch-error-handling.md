---
name: trycatch-error-handling
title: The tryCatch [error, result] pattern
pattern: trycatch
tags: [error-handling, api, sync, conventions]
---

# The tryCatch [error, result] pattern

## When to use

Whenever a call can throw — JSON parsing, DB/IO, an external fetch — wrap it in the LuckyStack `tryCatch` so failures come back as a checked `[error, result]` tuple instead of an unwound stack. Use `functions.tryCatch.tryCatch(...)` **inside API + sync handlers** (it's injected); use `import { tryCatch } from '@luckystack/core'` in server utilities/scripts, or `@luckystack/core/client` in React components. Do NOT reach for raw `try/catch` anywhere — it bypasses the capture seam and is flagged by `npm run ai:lint`.

## Canonical example

```ts
// src/settings/_api/revokeSession_v1.ts — INSIDE a handler: use the injected tryCatch.
//? Revoke one of the caller's own sessions by token. Auth-gated + rate-limited.
/** @docs owner sample */
import { deleteSession, getSessionAdapter } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { token: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const sessionRaw = await getSessionAdapter().getRaw(data.token);
  if (!sessionRaw) return { status: 'error', errorCode: 'session.invalid' };

  // tryCatch returns [error, result]. Check the FIRST value; never read result before it.
  const [parseError, parsed] = await functions.tryCatch.tryCatch(
    () => JSON.parse(sessionRaw) as { id?: string },
  );
  if (parseError || parsed?.id !== user.id) {
    return { status: 'error', errorCode: 'auth.forbidden' };
  }

  await deleteSession(data.token);
  return { status: 'success', result: {} };
};
```

```ts
// src/_functions/avatarFetch.ts — OUTSIDE a handler (server util/script): import from core.
import { tryCatch } from '@luckystack/core';

export const fetchAvatarBytes = async (url: string): Promise<Buffer | null> => {
  const [fetchError, response] = await tryCatch(() => fetch(url));
  if (fetchError || !response.ok) return null; // error branch is already captured to Sentry

  const [readError, bytes] = await tryCatch(() => response.arrayBuffer());
  if (readError) return null;

  return Buffer.from(bytes);
};
```

## Why this shape

- **Two import paths, one tuple contract.** `functions.tryCatch.tryCatch` is auto-injected into every API/sync handler via the function-injection system (`shared/tryCatch.ts`), so handlers never import it directly. Everywhere else you import the same `[error, result]` helper from `@luckystack/core` (server) — or `@luckystack/core/client` for React components, which resolves to the browser-safe `tryCatchClient` that lazy-loads the capture seam on the error branch only, keeping `node:async_hooks` out of the Vite client bundle. Both branches share the identical signature `tryCatch<T, P = void>(fn, params?, context?) => Promise<[Error | null, T | null]>`.
- **Check the error first, always.** The result slot is `T | null`; it is only trustworthy once you've confirmed `error` is falsy. Guarding `if (parseError || parsed?.id !== user.id)` before touching `parsed` is what makes the tuple safe — reading `result` without the guard reintroduces the exact null-deref the pattern exists to prevent.
- **Raw `try/catch` is banned for a reason.** The server `tryCatch` routes the catch through `captureException`, so every swallowed failure still reaches the registered error-tracker. A hand-rolled `try/catch` silently drops that capture (and trips the `ai:lint` invariant). One narrow exception exists — `src/docs/page.tsx` documents why a raw block is intentional there — but new code should never add one.
- **Errors stay typed and i18n-clean.** Handlers surface failures as `errorCode` strings (`'auth.forbidden'`, `'session.invalid'`) that the client maps to translated copy via `useTranslator` — never a raw English message baked into the response. The util returns `null` and lets the caller decide the user-facing text. No `as any`, no `as unknown as`: the parsed shape is asserted to a real interface and the route/version literals stay in the generated `ApiResponse`/`Functions` types.
