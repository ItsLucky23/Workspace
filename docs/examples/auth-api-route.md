---
name: auth-api-route
title: Rate-limited authenticated API route
pattern: auth-api-route
tags: [api, auth, rate-limit, tryCatch]
---

# Rate-limited authenticated API route

## When to use

The canonical shape for a `src/<page>/_api/<name>_v1.ts` endpoint that requires a
logged-in user and caps request frequency. Use it for any per-user read/write that
touches the DB or session. Do NOT use it for public/unauthenticated endpoints
(drop `login: true` and reconsider the rate limit), for real-time fan-out (use a
`_sync/` handler instead), or for streaming responses (add the `stream` param from
`ApiParams` per `docs/ARCHITECTURE_API.md`).

## Canonical example

```ts
//? Returns the calling user's own notes. Auth-gated + rate-limited read route.
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../_sockets/apiTypes.generated';

// rateLimit = requests/minute for this route (false = fall back to config.rateLimiting.defaultApiLimit)
/**
 * @docs owner sample
 * @docs summary Returns the calling user's own notes — auth-gated + rate-limited read route.
 */
export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true, // unauthenticated callers get a generic `auth.required` envelope before validation runs
  additional: [], // extra gates go here, e.g. [{ key: 'admin', value: true }]
};

export interface ApiParams {
  data: { limit?: number };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  // Clamp untrusted input — never pass a client-supplied number straight to `take`.
  const take = Math.min(Math.max(data.limit ?? 20, 1), 100);

  const [error, notes] = await functions.tryCatch.tryCatch(() =>
    functions.db.prisma.note.findMany({
      where: { ownerId: user.id }, // scope to the session user, never to a client-supplied id
      orderBy: { createdAt: 'desc' },
      take,
    }),
  );

  if (error) {
    // `errorCode` is a translation key resolved server-side — never raw exception text.
    return { status: 'error', errorCode: 'common.500' };
  }

  return { status: 'success', result: { notes } };
};
```

## Why this shape

- **`auth: { login: true }` is the whole gate.** The framework runs auth *before*
  validation (`auth → rate-limit → validate → main`), so missing/invalid sessions
  get a generic `auth.required` envelope before route existence or input shape can
  leak. You never check the session by hand inside `main` — `user` is already a
  trusted `SessionLayout`. Extra requirements (roles, flags) go in `additional`, not
  in an `if` in the body.
- **`rateLimit` is a per-route number, not a config edit.** Exporting `60` overrides
  the global `defaultApiLimit` for this route only; `false` opts back into the global
  default. Tuning it here keeps the limit next to the handler it protects.
- **`functions.tryCatch.tryCatch` over raw `try/catch`.** The injected helper returns
  a `[error, result]` tuple and routes server-side failures to the registered
  error-tracker (Sentry). Raw `try/catch` would bypass that capture and is banned by
  the error-handling convention. Check the first element; on truthy, return an error
  envelope.
- **Errors return a translation `errorCode`, never a sentence.** `common.500` is an
  i18n key resolved server-side from the caller's language — putting `error.message`
  into `errorCode` leaks internals and ships an untranslated string. That is why no
  raw user-facing text appears in an API file (no `@theme` tokens or `useTranslator`
  here — those are client concerns; the server speaks in keys).
- **The success envelope is exactly `{ status: 'success', result }`.** The generated
  output type is inferred from this literal return, so the typed `apiRequest` caller
  gets `result.notes` with full autocomplete — no `as any`, no unsafe wrapper.
- **Ownership is scoped to `user.id`, input is clamped.** Querying by the session id
  (not a client-supplied id) plus clamping `take` avoids the classic IDOR + unbounded
  `take` mistakes a login gate alone doesn't cover.
- **`//?` summary + the `@docs owner` JSDoc tag are not decoration.** The top `//?`
  line feeds the product-intent / doc-coverage gate, and the `@docs owner` tag — which
  the index extractor only reads from a `/** ... */` JSDoc block, never a `//?` line —
  surfaces in `docs/AI_PROJECT_INDEX.md` so a later teammate knows who to ask.
