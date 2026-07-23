---
id: 0300
title: Session cookie domain bridge is narrow and temporary
status: accepted
date: 2026-07-23
tags: [auth, cookies, edge-auth, nginx, luckystack]
supersedes: []
---

# 0300 — Session cookie domain bridge is narrow and temporary

## Context

Authenticated preview/editor subdomains require the HttpOnly session cookie on `*.workspace.keetlerop.nl`.
LuckyStack 0.7.5 exposes and correctly stores `http.sessionCookieDomain`, but its HTTP cookie serializer does not
emit the `Domain` attribute. Production therefore produced host-only cookies and edge-auth always returned 401.
Editing `node_modules` is not durable, while rewriting every upstream cookie in nginx would unnecessarily share
OAuth-state and CSRF cookies with subdomains.

## Decision

Until the framework serializer consumes `sessionCookieDomain`, prepend a Node request listener that wraps
`ServerResponse.setHeader` and adds the configured Domain only to the named session cookie. OAuth-state, CSRF and
all unrelated cookies remain unchanged. Keep the existing Secure, HttpOnly and SameSite attributes and retain
workspace membership edge-auth plus the separate openvscode connection token.

## Rejected alternatives

- **Patch `node_modules`:** rejected because installs/deploys would erase it.
- **`proxy_cookie_path` nginx rewrite:** rejected because it would broaden every path-root cookie, including OAuth
  state, instead of only the session cookie.
- **Make previews public and rely only on opaque URLs:** rejected because route knowledge is not authorization.
- **Host-only cookie:** rejected because the browser cannot authenticate an edge-auth subrequest on a sibling host.

## Consequences

- Preview/editor requests can authenticate across the wildcard parent without broadening temporary auth cookies.
- `server/http/sessionCookieDomain.ts` must be removed once a verified LuckyStack release emits Domain itself, to
  avoid duplicate attributes.
- Production browser tests must continue to assert the cookie domain plus unauthenticated 401 and nonmember 403.
