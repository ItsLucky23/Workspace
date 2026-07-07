---
title: Web push + PWA — env-VAPID, a service worker, and push piggybacked on notifications
status: accepted
date: 2026-07-07
tags: [push, pwa, notifications, freedom-program, phone-first]
---

## Context

FREEDOM_PROGRAM item **A1**, and the explicit `/goal` ask ("voeg ook de sw.js toe"). The product is phone-first
(the human is a man-in-the-middle who approves + answers from their phone), but there was NO push at all: the
`PushSubscription` model existed but nothing wrote or read it, there was no service worker, no manifest, no
VAPID, and the settings toggle was cosmetic (a local `useState` with a "Fase 2" comment).

## Decision

- **Self-hosted env-VAPID** (decided OV-5). Keys live in `.env.local` (`WS_VAPID_PUBLIC/PRIVATE/SUBJECT`),
  documented in `.env.local_template`. `web-push` installed; imported **lazily** in `server/hooks/webPush.ts`
  (its API lands on `.default` under the ESM loader) so the server boots without it and a send failure never
  breaks the notification write it rides on.
- **A dependency-free `public/sw.js`** (push → `showNotification`; `notificationclick` → focus/open) +
  `public/manifest.webmanifest`, both served at root by Vite's default `publicDir`. Registered from
  `main.tsx` on load; manifest linked from `index.html`.
- **Two `_api` routes**: `pushConfig` delivers the PUBLIC VAPID key to the browser (the key can't reach the
  client via `config.ts` — its env reader is browser-safe-`undefined`, and no `VITE_` bridge is wired);
  `savePushSubscription` upserts the browser subscription keyed on the **authenticated** user + the (now
  `@unique`) endpoint. The settings toggle drives a real subscribe/unsubscribe (`pushSubscribe.ts`).
- **Push piggybacks on notifications**: `sendWebPush(prisma, userId, payload)` fans out to all the user's
  devices + prunes 404/410-dead subscriptions. Wired into the assignment-notify choke-point
  (`conductor.notifyAssignment`) first.

## Rejected alternatives

- **Fold the VAPID public key into the session payload.** A dedicated `login:true` route is cleaner and avoids
  leaking it into anonymous sessions.
- **A `createNotification` helper swapped into all 3 notify sites now.** The two `executor.ts` fan-outs use
  `createMany` — restructuring them is a separate refactor; the assignment site is the e2e proof. Wiring the
  executor sites is a documented fast-follow (A2).
- **A push/PWA vite plugin (offline-first).** The app isn't offline-first; a minimal hand-written SW for push +
  installability is the honest scope.

## Consequences

- A logged-in user can enable notifications on their phone and receive an assignment as a real push, tappable
  to the app. Live end-to-end verification (a real device + browser permission) is user-triggered; the
  subscription store + send fail-soft + route logic are covered headless (pushSubscription 7/7). Next:
  needs-input → push (A2), notification preferences (A3), autonomy dials (A4).
