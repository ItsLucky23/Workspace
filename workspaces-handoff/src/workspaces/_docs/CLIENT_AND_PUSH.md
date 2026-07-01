# Client & Push — the "phone-from-the-beach" PWA + web-push pipeline

> The core UX the whole product is sold on — *answer the AI, approve a merge, manage the board from a phone on the beach* — is, today, modeled **only at the data layer** (`Notification`/`PushSubscription` rows in [04b §10], B-34). This doc specifies the **client shell** (installable PWA, service worker, offline read) and the **end-to-end web-push pipeline** (VAPID setup → subscription → redacted-payload delivery → in-app full-body fetch) that turns those rows into a lock-screen tap. It extends [18 §web-push opt-in] (the bell + opt-in banner), [09 §mobile one-question-per-screen] (the tappable QuestionSet cards that are the *thing* you answer from the lock screen), [11 §mobile parity] (the Assistant panel), and rides the same Conductor-only-writer + [control-API] write path as everything else. Operator setup (VAPID keypair, env) folds into [08_DEPLOYMENT]. Cites architecture as `[01 §x]`…`[08]`/`[18]`/`[09]`/`[11]`/`[04b §N]`/`[CONTROL_API]`; codes via [REFERENCE_CODES]. Last updated: 2026-06-04.
>
> **No new verbs.** This doc introduces **zero** structured-channel verbs. The PWA is a *read+propose* client of surfaces that already exist; every write it triggers — mark-read, answer a QuestionSet, register/unregister a push device, approve/promote — is a **[control-API] route → `preApiExecute` RBAC → enqueue a Conductor action** ([CONTROL_API], B-23, [01 §3.3]), drained by the single-instance Conductor (the only writer). The service worker **renders and fetches**; it never writes the engine state. Push *send* reuses the existing `Notification` fan-out — no new channel verb (B-34).

---

## 0. One-paragraph summary

The client is a **PWA-first** install of the existing LuckyStack web-app: an installable, service-worker-backed shell that (a) reads the board/tickets/notifications offline from a local cache, (b) receives **web-push** even when the tab is closed, and (c) lets a user **answer a QuestionSet or approve a promote from the lock screen** with one tap — the literal phone-from-the-beach requirement. The push pipeline is: operator generates a **VAPID** keypair once ([08]); each device registers a **`PushSubscription`** (B-34, [04b §10], framework-global per the user-device scoping); the Conductor, when it writes a `Notification`, fans out a **redacted** push (title + "open to view" — D80 **reversed** to redacted-by-default, `Q-SEC-NOTIF-PUSH`); the **service-worker push handler** renders that redacted payload as a system notification, and on tap deep-links into the PWA where the **full body is fetched in-app behind auth** (and, for a `needs-input`, the QuestionSet cards of [09] render for a one-tap answer). Native apps are **not** built in v1 — PWA covers the requirement at a fraction of the cost; the one place PWA bites (iOS background-push caveats) is documented, not worked-around with a native shell. Everything stays inside the locked architecture: the Conductor is the only writer, the PTY engine is untouched, the verb surface is frozen, and the orchestrator is single-instance.

---

## 1. PWA-first vs native — the decision (`Q-CLIENT-SHELL`)

**Recommendation: PWA-first. No native app in v1.** The web-app is already a React 19 / LuckyStack SPA served behind `app.<domain>` ([08 §1]); making it an **installable PWA** (manifest + service worker) is the smallest possible delta (Rule 7b) that delivers all four phone-from-the-beach capabilities — install-to-home-screen, offline read, background web-push, lock-screen answer — without a second codebase, an app-store review loop, or a native-bridge to the `ws-ai:*`/[control-API] surfaces it already speaks.

| Capability the vision needs | PWA delivers it via | Native would add |
|---|---|---|
| Install to home screen, full-screen chrome | Web App Manifest (`display: standalone`, icons, theme color) | nothing the manifest doesn't (app-store distribution only) |
| Offline read of board / tickets / notifications | Service-worker cache + a read snapshot (§4) | a local DB sync layer (more code, same result) |
| Push when the tab is closed | Web Push API + VAPID (§5) — works on Android/desktop fully; iOS 16.4+ for installed PWAs (§7) | APNs/FCM (only material win = iOS reliability, §7) |
| One-tap answer / approve from the lock screen | Notification `actions` + the [09] QuestionSet cards in-app (§6) | richer native notification UI (marginal) |

- **Options weighed (`Q-CLIENT-SHELL`):** (A) **PWA-first [recommended]** — one codebase, the existing SPA, a manifest + SW; (B) **PWA + a thin native wrapper later** (Capacitor/TWA) *only if* iOS push reliability (§7) proves unacceptable for the team — a P3 escape hatch, not v1; (C) **full native (React Native / Swift+Kotlin)** — rejected: a whole second client for a **trusted small team** (B-26) self-hosting a dev tool is gross over-build (Rule 7b), and it would have to re-implement the `ws-ai:*` socket contract ([05 P1]) + the [control-API] typed client for no capability the PWA lacks except iOS-push polish.
- **Why PWA is *enough* for this product specifically:** the audience is a ≤5-person engineering team self-hosting their own orchestrator (B-26) — not a consumer app needing app-store reach. They will happily "Add to Home Screen". The one real PWA weakness (iOS background push, §7) is bounded and has a documented fallback (option B), so it does not justify a native build now.

**No new verbs.** The shell is a packaging of the existing client; it adds manifest + SW assets, not protocol.

---

## 2. The PWA shell — manifest + service worker registration

The PWA is the existing LuckyStack SPA plus two static assets and one registration call, served from the same `app.<domain>` replicas ([08 §1]).

- **Web App Manifest** (`/manifest.webmanifest`): `name`/`short_name` ("Workspaces"), `display: standalone`, `start_url: '/'` (or the last board), `theme_color`/`background_color` from the app's `src/index.css` `@theme` tokens (Rule 14 — no arbitrary hex), maskable + standard icons, and a `scope` of `/`. Served as a static file; no per-tenant manifest in v1 (a single app, many workspaces behind it).
- **Service-worker registration**: registered once on app boot **after** the session is established, from the client root (the provider tree — see §3). The SW file (`/sw.js`) is served from origin scope so it can intercept fetches and receive push. Registration is idempotent; the SW `skipWaiting`/`clients.claim` posture is "update on next navigation" (no forced reload mid-session — matches the "no forced reload" posture of [11]'s Compact handling).
- **Update strategy (`Q-CLIENT-SW-UPDATE`):** **prompt-to-refresh, not silent-swap.** When a new SW is waiting, the app shows a small "A new version is ready — refresh" toast (reusing the existing toast/`Banner` primitive) the user taps to apply. *Recommended* over silent auto-reload because a forced reload can interrupt a terminal relay or an in-flight QuestionSet answer; the user controls the moment. Options: (A) prompt-to-refresh [recommended]; (B) silent swap on next navigation (simpler, but can drop a half-typed answer); (C) hard auto-reload (worst — interrupts terminals).
- **Build seam:** the SW is built alongside the SPA (Vite PWA plugin or a hand-rolled SW — `Q-CLIENT-SW-BUILD`, default: the framework's existing Vite build with a PWA plugin, since LuckyStack already ships Vite; do not hand-roll cache-busting). This is build tooling, not engine code — it touches no `packages/*` framework surface and no Conductor path.

**No new verbs.** Manifest + SW registration are client-static concerns.

---

## 3. Provider hierarchy placement (where the SW + push state live)

The client wiring slots **inside** the existing provider tree (CLAUDE.md):

```
SocketStatusProvider > SessionProvider > TranslationProvider > AvatarProvider > MenuHandlerProvider > Router
```

- **SW registration + push-subscription state hang off `SessionProvider`.** The SW must register only for an authenticated user (a `PushSubscription` is keyed to `userId`, framework-global, [04b §10]/§11b), so registration fires **after** `SessionProvider` resolves a session — never before. On logout, the push subscription is **left registered but the device is unbound server-side** is *wrong*; instead logout SHOULD `pushManager.unsubscribe()` + delete the `PushSubscription` row (`Q-CLIENT-LOGOUT-UNSUB`, default: unsubscribe-on-logout, so a shared/borrowed device stops receiving another user's redacted titles).
- **The opt-in banner ([18 §6]) is rendered by the notification surface**, not a new provider — it reads `Notification.permission` + whether a `PushSubscription` exists for this device, both panel-local UI state (matching how `AIPanel` holds `tab`/`draft` in `Shell.tsx`, [18 Data]).
- **`SocketStatusProvider` already owns online/offline** — the offline-read shell (§4) reads its `disconnected` state to flip the board/ticket views into cached-read mode and show the offline banner. No new provider; the SW and the socket-status are complementary (SW = transport-level cache + push; `SocketStatusProvider` = app-level connection state for the catch-up/`postSocketReconnect` snapshot, B-22).

**No new verbs.** Provider placement is client composition.

---

## 4. Offline read + background sync

Offline read is a **read-only projection** of surfaces the user already had loaded — never an offline *write* path (writes are Conductor-only, [01 §3.3]; a queued offline write would be a second writer, which the architecture forbids).

| Surface | Offline behavior | Backed by |
|---|---|---|
| **Board / tickets** | Last-loaded board + ticket detail render from the SW cache (read-only); a banner reads "Offline — showing last-synced state". | SW runtime cache of the `[control-API]`/snapshot reads ([12]/[13] board, B-22 snapshot) |
| **Notifications** | The notification center ([18]) renders cached `NotificationItem`s; unread badge shows the last-known count. | SW cache of the notifications read |
| **Terminals / live AI chat** | **Not available offline** — they are live PTY relays ([01 §1]); the offline view shows "Reconnect to view live terminal". | n/a (live-only by construction) |
| **Any write** (mark-read, answer, approve) | **Queued? No — disabled offline** with "you're offline" affordance; re-enabled on reconnect. | — (no offline write, §below) |

- **Background sync (`Q-CLIENT-BGSYNC`).** Recommended: **on reconnect, the SW signals the app to run the existing `postSocketReconnect` → snapshot → merge-on-`seq` catch-up (B-22)** — i.e. reuse the *already-built* catch-up path rather than a separate Background Sync API queue. The Web Background Sync API (`sync` event) is used **only** to retry a *failed redacted-body fetch* (§6) when connectivity returns, not to replay writes. Options: (A) reuse `postSocketReconnect` catch-up on reconnect [recommended — zero new sync logic]; (B) full Background Sync write-replay queue (rejected — would create an offline write path = a second writer, violating [01 §3.3]); (C) periodic background fetch of the board (rejected — battery cost, and the push pipeline already wakes the app for the things that matter).
- **No offline writes — and why generically:** the Conductor is the only writer (B-23, [01 §3.3]); an offline mutation queue would let the client author state the Conductor hasn't serialized, breaking the single-writer invariant the whole engine rests on. So offline is **read + receive-push** only; the *first* online tap re-arms writes. This is the principled answer (Rule 22), not a per-button disable.

**No new verbs.** Offline read is cached reads; sync is the existing catch-up.

---

## 5. The web-push pipeline, end to end

This is the spine of the feature. Six stages, operator → device → Conductor → lock screen → in-app. Every server-side write is a Conductor/[control-API] action; the SW only renders and fetches.

### 5.1 Operator setup — VAPID keypair ([08_DEPLOYMENT])

Web Push requires a **VAPID** (Voluntary Application Server Identification) keypair so push services trust the sender. It is generated **once per deployment** by the operator and lives as server-only config — this is a deployment step, folded into [08].

- **Generate:** `web-push generate-vapid-keys` (or the `web-push` lib's keygen) → `{ publicKey, privateKey }`. The **public** key is shipped to the client (it is *not* secret — it's the `applicationServerKey` for `subscribe()`); the **private** key is a server secret used to sign push requests.
- **Store:** `WORKSPACES_VAPID_PUBLIC` (client-exposed) + `WORKSPACES_VAPID_PRIVATE` (server-only) + `WORKSPACES_VAPID_SUBJECT` (a `mailto:` or origin URL the push service requires). Per Rule 17, add these to `.env_template`/`.env.local_template`; the private key follows the secret posture (`@luckystack/secrets` pointer if configured, else env — `project_secrets_package_design`). The private key is **never** sent to the client and **never** logged ([OBSERVABILITY] redaction).
- **`Q-CLIENT-VAPID-SCOPE`:** one keypair per deployment (recommended — VAPID identifies the *application server*, not a tenant; all workspaces share the same push server identity) vs per-workspace keypairs (rejected — push subscriptions are framework-global/per-device [04b §11b], not tenant-scoped, so a per-tenant key would mis-model the device).

### 5.2 Device registration — creating a `PushSubscription`

The opt-in is the [18 §6] inline banner ("Get notified even when this tab is closed — [Enable]"). On Enable:

1. The client requests `Notification.requestPermission()`; on `granted` it calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <WORKSPACES_VAPID_PUBLIC> })`.
2. The browser returns a `PushSubscription` `{ endpoint, keys: { p256dh, auth } }`.
3. The client POSTs it to a **[control-API] route** (`push-subscribe`) → `preApiExecute` (`login:true`) → enqueue a Conductor action that persists the `PushSubscription` row (B-34, [04b §10]). The `keys` are a **server-only secret** ([04b §10]) — they are the per-device encryption material the push send needs; never exposed back to any other client.
4. `fullBodyOptIn` defaults `false` (redacted posture, D80-reversed, §5.5). A device may later opt in via a `push-fullbody-optin` [control-API] toggle (§5.5).
- **Unsubscribe** (`push-unsubscribe`): on logout (`Q-CLIENT-LOGOUT-UNSUB`), permission revoke, or a `410 Gone` from the push service (§5.6), the row is deleted. **No new verbs** — register/unregister/optin are [control-API] ops, not structured-channel verbs.

### 5.3 The trigger — Conductor writes a `Notification`, then fans out push

Unchanged from [18 §user-flow] + B-34: a lifecycle event ([07 §A]/[07 §C], the four classes `needs-input`/`merge`/`ai-suggestion`/`container-failure`) makes the **Conductor** (the only writer) write a `Notification` row and fan it out in-app over `workspace-<wsId>` (subscribe-first → snapshot → merge-on-`seq`, B-22). **Additionally**, if the recipient has `'push'` in `Notification.channels` and a `PushSubscription` exists, the Conductor (or a leased fan-out worker it drives, under `lease:orchestrator`) sends a web-push. Push send runs `runInTenant(workspaceId, …)` like every orchestrator-side action ([04b §11c], B-O8) — though the `PushSubscription` itself is framework-global ([04b §11b]), the *triggering notification* is tenant-scoped.

### 5.4 The push send — signing + the redacted payload (D80 reversed)

The server uses the VAPID private key + the device's `keys{p256dh,auth}` to encrypt and sign a Web Push request to `subscription.endpoint`. **The payload is redacted by default** — `Q-SEC-NOTIF-PUSH`, **D80 REVERSED** ([18 §Resolved], [04b §10], B-34, 2026-06-04):

```jsonc
// Redacted push payload (default) — carries NO sensitive body.
// Rationale (rule 19): a `needs-input` body routinely quotes secrets
// ("where should the MS client secret live?"), so the lock screen must not show it.
{
  "type": "needs-input",                 // the four-class type (drives the SW glyph)
  "title": "DEV-1241 needs your input",  // safe, non-secret summary
  "notifId": "<Notification.id>",        // the handle the SW uses to fetch the full body in-app
  "deepLink": { "view": "ticket", "ticketId": "...", "tab": "overview" }, // D65 nav target
  "redacted": true                       // SW renders title + "Open to view"; full body fetched in-app
}
```

- **Full-body push** is a **per-device opt-in** (`PushSubscription.fullBodyOptIn === true`). When opted in, the server may include `body` in the payload; the SW renders it directly. Default is **off** — the team trades lock-screen richness for not leaking secrets to the OS notification store / a shoulder-surfer.
- **No new verbs.** The send reuses the existing `Notification` fan-out; redaction is a payload shape, not a protocol surface (B-34).

### 5.5 The service-worker `push` handler — render redacted, then deep-link

The SW's `push` event handler renders the **redacted** payload as a system notification — it does **not** fetch the body here (the SW has no auth session to fetch behind auth, and we don't want secrets in the OS notification store):

```js
// /sw.js — push handler. Renders the REDACTED payload only. No body fetch here.
self.addEventListener('push', (event) => {
  const p = event.data?.json() ?? {};
  const body = p.redacted ? 'Open to view' : (p.body ?? 'Open to view');
  event.waitUntil(self.registration.showNotification(p.title, {
    body,
    tag: p.notifId,                 // collapse duplicates of the same notification (dedupe, §8)
    data: { deepLink: p.deepLink, notifId: p.notifId, type: p.type },
    actions: actionsFor(p.type),    // e.g. needs-input → [Approve] [Open] (§6)
    // glyph/badge per type (mirrors NOTIF_TINT in [18])
  }));
});
```

```js
// notificationclick — focus-or-open the PWA and post the deep-link; the IN-APP code
// fetches the full body behind auth and renders the [09] QuestionSet cards.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { deepLink, notifId } = event.notification.data;
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => c.url.includes('/')) ?? await clients.openWindow(deepLinkToUrl(deepLink));
    client?.focus();
    client?.postMessage({ kind: 'open-notification', deepLink, notifId, action: event.action });
  })());
});
```

- **The full body is fetched IN-APP, behind auth.** When the focused PWA receives the `open-notification` message, the app calls the existing notifications read ([18]) for `notifId` — a normal authenticated request through `SessionProvider`'s session — and renders the **full** `Notification.body` + deep-links via the D65 `navigate({view,ticketId,tab})` payload ([18 §5]). This is the security pivot of the D80 reversal: the OS only ever saw the title; the secret-bearing body crosses only the authenticated app boundary.
- **No new verbs.** The SW renders + routes; the in-app fetch is an existing authenticated read; the deep-link is the D65 `navigate`.

### 5.6 Delivery failures — pruning dead subscriptions

A push endpoint can die (browser cleared, device wiped). The push service returns **`404`/`410 Gone`** → the fan-out worker deletes that `PushSubscription` row (a Conductor/[control-API] cleanup, never a client write). Transient `429`/`5xx` → respect `Retry-After`, backoff, and (with connectivity) the SW `sync` event retries (§4). This keeps the subscription set self-healing without a manual prune.

---

## 6. Answer / approve from the lock screen — the QuestionSet ergonomics

This is *the* killer interaction: a `needs-input` push that a user resolves **without unlocking into a full session**, or with one tap into the PWA. It composes [09] (the QuestionSet cards) over the SW notification surface.

- **Notification `actions` for fast paths (`Q-CLIENT-NOTIF-ACTIONS`).** For an `approve`-kind QuestionSet (the promote gate, [09 §promote-as-approve]) the SW notification carries **`[Approve] [Open]`** actions; for a single `choice` question it *may* carry the top choices as actions (platform caps actions at ~2, so only the binary/approve case fits cleanly). Tapping **Approve** in the notification:
  - **Recommended default: deep-link into the PWA and pre-arm the Approve**, *not* a blind background write. Rationale: an action button has **no auth session** and the payload is **redacted** — the body the user is approving was never on the lock screen (§5.4). Approving sight-unseen on secret-bearing input violates the same rule-19 reason redaction exists. So `[Approve]` opens the PWA focused on the [09] card with the full body shown and the Approve primed — **one more tap** confirms. Options: (A) deep-link + pre-armed Approve [recommended — safe, still ~2 taps from lock screen]; (B) true one-tap background approve from the action (rejected — approves redacted/unseen content, and an action button can't carry the authenticated [control-API] call without re-establishing session); (C) no actions, tap-to-open only (safe but loses the fast path).
- **Once in the PWA**, the [09] **one-question-per-screen** mobile flow renders: `choice`/`approve` need **zero keyboard** (big tap targets ≥44px), only `free` raises it. Submitting routes through the existing answer path — a [control-API]/`ws-ai:reply {ticketId, answers}` ([09]/[11 §6]) → Conductor resumes the **same** agent via `--resume` ([09 §user-flow]). **No new verbs** — the cards propose `answers`; the Conductor writes.
- **Approve == Promote** stays the same gate ([09 §promote-as-approve]): Approve carries the stage A→B; Reject re-opens with the note as the `--resume` prompt. The lock-screen action is just a faster entry into that existing gate.

**No new verbs.** Lock-screen answer/approve is the [09]/[11] propose-path entered from a notification; the Conductor executes.

---

## 7. iOS PWA push caveats (the one place PWA bites)

PWA push on iOS is the real constraint behind `Q-CLIENT-SHELL` — call it out so the team isn't surprised:

- **iOS supports Web Push only for PWAs added to the Home Screen, Safari 16.4+ / iOS 16.4+.** A PWA merely opened in a Safari *tab* gets **no** push on iOS — the user **must** "Add to Home Screen" first. The opt-in banner ([18 §6]) on iOS therefore shows an **"Add to Home Screen to enable alerts"** pre-step before `requestPermission()` (detect standalone-mode + iOS; show the install hint otherwise).
- **No silent/background data push on iOS** — only `userVisibleOnly: true` visible notifications (which is already our posture). Background data sync (§4) is best-effort on iOS; the redacted-then-fetch model (§5) tolerates this because the body fetch happens when the user opens the app anyway.
- **Permission UX differs** — iOS only surfaces the permission prompt from an installed PWA and only after a user gesture; the [18] banner's `[Enable]` is that gesture.
- **`Q-CLIENT-IOS-FALLBACK`:** if iOS push reliability is unacceptable for the team in practice, the documented escape hatch is the **thin native wrapper** (`Q-CLIENT-SHELL` option B, Capacitor/PWABuilder) wrapping the *same* PWA + APNs — a P3 add, **not** v1. Recommendation: **ship PWA-first; revisit only if iOS users report missed alerts.** Android/desktop have no equivalent caveat (full Web Push).

**No new verbs.** Platform caveats are client capability notes.

---

## 8. Notification batching & fatigue control

Push fatigue (every `observation` buzzing a phone) would make users disable notifications entirely — defeating the feature. Controls, layered cheapest-first:

- **Type-gated channels (already modeled).** Only the high-signal classes default to `'push'` in `Notification.channels` (B-34): **`needs-input`** (blocking — always) and **`container-failure`** (loud) push by default; **`merge`** and **`ai-suggestion`** default to in-app/email and are push-opt-in. The low-volume `observation` signals never push (they're the [11] signal-stream, not `Notification`s). The per-type channel matrix is the deferred [18] preferences UI — reserved on `Notification.channels` now.
- **Collapse / dedupe on the OS side.** The SW uses `tag: notifId` so a re-pushed same notification **replaces** rather than stacks; a *renotify* is suppressed unless the underlying set materially changed (e.g. a superseding QuestionSet, [09]).
- **Server-side coalescing (`Q-CLIENT-BATCH`).** Recommended: a **short debounce window per (user,type)** in the fan-out worker — e.g. N `container-failure`s within ~30s collapse into one "3 containers failed" push (the in-app center still shows all rows; only the *push* coalesces). Options: (A) per-(user,type) debounce + count-summary push [recommended — kills storm-buzzing without losing in-app fidelity]; (B) no coalescing (rejected — a flapping container = a phone tantrum); (C) digest-only (rejected — defeats the blocking-`needs-input` immediacy the product is sold on). `needs-input` is **exempt** from coalescing (each block is individually actionable).
- **Quiet hours / do-not-disturb (`Q-CLIENT-QUIET`):** *deferred* — recommended out of v1 (the team is small; OS-level DND suffices). Reserved as a future per-user preference next to the [18] channel matrix; flagged so it isn't silently assumed-built.

**No new verbs.** Batching is fan-out-worker policy + SW `tag` dedupe; the Conductor still writes each `Notification` row.

---

## 9. Composition & seams

| Surface | Owned by | This doc's role |
|---|---|---|
| `Notification`/`PushSubscription` models | [04b §10], B-34 | the client + pipeline that **consume** them; introduces no new field |
| The bell, center, opt-in banner, deep-link (D65) | [18] | the **PWA/SW transport** beneath [18]'s opt-in; renders [18]'s deep-link from the SW |
| QuestionSet cards (one-question-per-screen, approve gate) | [09] | the **lock-screen entry** into [09]'s mobile answer flow |
| Assistant chat, telemetry, control buttons | [11] | the panel the PWA hosts full-screen on mobile (no change) |
| VAPID keys, env, operator setup | [08] | adds the VAPID keygen + 3 env keys to [08]'s deploy + `.env_template` |
| Conductor-only-writer, [control-API] write path | [01 §3.3], [CONTROL_API] | every client write (subscribe, optin, mark-read, answer, approve) routes through it |
| Catch-up snapshot (B-22), socket status | [12]/[13], `SocketStatusProvider` | the offline-read + on-reconnect sync reuses the existing catch-up |

---

## 10. Open questions (`Q-CLIENT-*`) — defaults recommended, user to confirm/override

| id | Question | Recommendation | Why |
|---|---|---|---|
| `Q-CLIENT-SHELL` | PWA-first vs native? | **PWA-first; no native in v1 (thin native wrapper is a P3 iOS escape hatch only).** | One codebase, the existing SPA + manifest/SW delivers all four phone-from-the-beach capabilities for a trusted ≤5-person team (B-26, Rule 7b); the only native win is iOS-push polish (§7), bounded + deferrable. |
| `Q-CLIENT-SW-UPDATE` | How does a new SW version activate? | **Prompt-to-refresh toast, not silent swap.** | A forced reload can interrupt a terminal relay or in-flight QuestionSet answer ([11] Compact posture); the user picks the moment. |
| `Q-CLIENT-SW-BUILD` | Hand-roll the SW or use the Vite PWA plugin? | **Vite PWA plugin (LuckyStack already ships Vite).** | Reuses existing build tooling; avoids hand-rolled cache-busting bugs. Pure build tooling — touches no engine/`packages/*` surface. |
| `Q-CLIENT-LOGOUT-UNSUB` | On logout, keep or drop the push subscription? | **Unsubscribe + delete the `PushSubscription` row on logout.** | A shared/borrowed device must not keep receiving another user's redacted titles; framework-global per-device scoping ([04b §11b]) makes this a clean per-device delete. |
| `Q-CLIENT-BGSYNC` | Background-sync mechanism for offline? | **Reuse `postSocketReconnect` catch-up (B-22) on reconnect; Background Sync API only for retrying a failed body-fetch.** | No new sync logic; an offline *write*-replay queue would create a second writer, violating [01 §3.3]. |
| `Q-CLIENT-VAPID-SCOPE` | One VAPID keypair per deployment or per workspace? | **One per deployment.** | VAPID identifies the application server, not a tenant; `PushSubscription` is framework-global per-device ([04b §11b]), so a per-tenant key mis-models the device. |
| `Q-CLIENT-NOTIF-ACTIONS` | True one-tap background approve from the notification action, or deep-link + pre-armed approve? | **Deep-link + pre-armed approve (one more tap, with the full body shown).** | The payload is redacted (§5.4) and an action button has no auth session; approving unseen secret-bearing input violates the rule-19 reason redaction exists. |
| `Q-CLIENT-BATCH` | Server-side push coalescing? | **Per-(user,type) debounce + count-summary push; `needs-input` exempt.** | Kills storm-buzzing (flapping `container-failure`) without losing in-app fidelity; blocking `needs-input` stays immediate. |
| `Q-CLIENT-QUIET` | Quiet-hours / DND? | **Deferred — out of v1; OS-level DND suffices for a small team.** | Reserved next to the [18] channel matrix; flagged so it isn't silently assumed-built. |

---

## 11. Self-check (review invariants)

- **No new verbs** anywhere. The frozen 7+6 surface ([02 §2]) is untouched; the SW renders + fetches, never writes engine state.
- **Conductor stays the only writer.** Every client write — `push-subscribe`/`push-unsubscribe`/`push-fullbody-optin`, mark-read, answer-QuestionSet, approve/promote — is a [control-API] route → `preApiExecute` RBAC → enqueue → Conductor (B-23, [01 §3.3]). No offline write path (§4) — that would be a second writer.
- **D80 reversal honored.** The push payload is **redacted by default** (title + "open to view"); the full `Notification.body` is fetched **in-app behind auth**; full-body push is per-device opt-in (`PushSubscription.fullBodyOptIn`) — `Q-SEC-NOTIF-PUSH`, [04b §10], [18 §Resolved].
- **PTY engine + single-instance + multi-tenancy preserved.** Terminals/live chat are live-only (not offline-cached); push fan-out runs under `lease:orchestrator` + `runInTenant` ([04b §11c], B-O8); `PushSubscription` is correctly framework-global per-device ([04b §11b]).
- **Provider hierarchy respected.** SW registration + push state hang off `SessionProvider`; offline mode reads `SocketStatusProvider`; no new provider added.
- **PWA-first is justified, not assumed.** §1 weighs native explicitly; the one PWA weakness (iOS push, §7) is documented with a deferred escape hatch, not papered over.
- **Every genuine fork is an open question** (§10) with a recommended default — `Q-CLIENT-SHELL`, `Q-CLIENT-SW-UPDATE`, `Q-CLIENT-SW-BUILD`, `Q-CLIENT-LOGOUT-UNSUB`, `Q-CLIENT-BGSYNC`, `Q-CLIENT-VAPID-SCOPE`, `Q-CLIENT-NOTIF-ACTIONS`, `Q-CLIENT-BATCH`, `Q-CLIENT-QUIET`.
- This doc **edits no existing file** — it is the new client+push spec the notification/question docs ([18]/[09]/[11]) and deployment ([08]) cite as `[CLIENT_AND_PUSH §N]`.
</content>
</invoke>
