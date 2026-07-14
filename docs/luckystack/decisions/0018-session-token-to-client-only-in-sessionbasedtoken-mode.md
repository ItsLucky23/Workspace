---
name: session-token-to-client-only-in-sessionbasedtoken-mode
title: The session token reaches page JS only in sessionBasedToken (sessionStorage) mode
status: accepted
date: 2026-07-02
deciders: [ItsLucky23]
tags: [security, session, auth, config]
supersedes: []
relates: []
---

## Context

LuckyStack supports two token-transport modes, selected by `config.sessionBasedToken` (surfaced as `session.basedToken` on `ProjectConfig`):

- **Cookie mode (`false`, default, production)** — the session token lives in an `HttpOnly` cookie. Page JS must NOT be able to read it; the whole point of `HttpOnly` is that an XSS foothold cannot exfiltrate the credential.
- **sessionBasedToken mode (`true`, a development option)** — the token lives in `sessionStorage` on the client (tab-scoped sessions, useful for multi-account testing). Here the token is intentionally in page-JS reach: the client sets it at login/OAuth-handoff and the socket handshake reads it from `sessionStorage` (`socketInitializer.ts`).

Security scans repeatedly flag "the session token reaches page JS" (e.g. `session_v1` returning the full `user`, and the `updateSession` broadcast carrying the token) as a HIGH finding, because in cookie mode that would defeat `HttpOnly`. The nuance the scanners miss is that token-to-client is a *deliberate, config-gated* behavior — correct in one mode, a leak in the other.

## Decision

The raw session `token` **never reaches page JS through the session object** — not via the `session_v1` bootstrap and not via the `updateSession` broadcast, in either mode. This is enforced by TYPE, not just discipline:

- A dedicated CLIENT-facing type `ClientSessionLayout = Omit<SessionLayout, 'token' | 'csrfToken'>` (in the consumer `config.ts`) is what page JS holds (`SessionProvider`, `useSession`, `useSocket`). Server-side API/sync handlers keep the full `SessionLayout` (they legitimately need `user.token` for revoke / sign-out flows), so **server typing is untouched** — only the client base is relaxed.
- Core's `BaseSessionLayout.token` (and the parallel `HookSessionShape.token`) are made OPTIONAL so a token-less client session satisfies the `T extends BaseSessionLayout` bound of the client session context / hooks / `useSocket`. The project's own `SessionLayout` redeclares `token: string` (required), so server handlers stay strict.
- `session_v1` returns the stripped `ClientSessionLayout`; the generated route result type therefore no longer carries `token`/`csrfToken`.
- `saveSession`'s `updateSession` broadcast always sends the token-stripped projection (the same `persistedWithoutToken` written to the adapter under LOGIN-M9).

Where the token DOES legitimately reach page JS: **only `sessionBasedToken` mode, and only via the login/OAuth flow → `sessionStorage`** (set at sign-in, read by the socket handshake). The session object is not that channel. In cookie mode the token stays in the `HttpOnly` cookie and never touches JS. The sibling contract in `listSessions_v1.ts` ("the raw token must NEVER reach page JS") is fully honoured.

## Rejected alternatives

- **Always broadcast/return the full session including the token** — rejected: in cookie mode it copies the `HttpOnly` credential into page-JS-readable React state, defeating `HttpOnly` and handing XSS a token to steal.
- **Keep the token on the client type but absent at runtime** — rejected: a type that promises `token: string` while runtime delivers `undefined` is a latent bug (client code could read a non-existent credential); the type must reflect reality.
- **Make `SessionLayout.token` itself optional (affecting server handlers)** — rejected: server handlers rely on `user.token` being present. Only the shared *base* is relaxed; the concrete server `SessionLayout` keeps it required.

## Consequences

- The session token cannot reach page JS via the session object in any mode, enforced at the type level (a handler that tried to return it would fail typecheck against `ClientSessionLayout`).
- `sessionBasedToken` (dev) mode is unaffected: the client still gets its token at login into `sessionStorage`; the socket handshake reads it there.
- Framework hook consumers now see `HookSessionShape.token?` as optional (it is present at runtime server-side); no framework handler read it as a guaranteed string.
- Files embodying this decision are tagged `//? @adr 0018` so future scans consult this ADR before re-flagging token-to-client as a bug: `packages/login/src/session.ts`, `packages/core/src/sessionTypes.ts` (via the base relax), `src/_api/session_v1.ts`, `src/_providers/SessionProvider.tsx`.
