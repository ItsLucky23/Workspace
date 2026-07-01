# Addition 16 — Notification preferences + test-push

> **Tier:** V1 · **Lane:** C + B · **Status:** NEW (2026-06-11).
> **Pitch:** A per-(notification-type × {push, in-app}) preference matrix on the Account screen plus a one-tap "send me a test" that exercises the whole fragile iOS VAPID→subscribe→SW→lock-screen chain end-to-end and reports back in-app what actually arrived.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #16.

---

## 1. The gap this closes (reserved channels, no UI; fragile iOS chain unverifiable)

Two concrete holes the existing notification stack left open:

1. **Channels are modelled but have no UI.** [features/18 §Deferred] explicitly defers the "Notification preferences UI (per-type channel matrix: which types go to push vs email)" and parks it on the channel knowledge already baked into the system — only the high-signal classes (`needs-input` always, `container-failure` loud) push by default, `merge`/`ai-suggestion` are push-opt-in ([CLIENT_AND_PUSH §8]). But that policy is **hard-coded in the fan-out worker**; a user cannot *see* it, let alone change it. The account screen today ([17 §Notifications], `_screens/AccountSettings.tsx:174–179`) is a **single binary `Web push` toggle** — push is all-or-nothing. A multi-workspace user drowning in one noisy workspace's `container-failure` storms has exactly one lever: kill push entirely, defeating the phone-from-the-beach loop the whole product is sold on ([CLIENT_AND_PUSH §0]).

   > **Note on `Notification.channels`:** [features/18 §Data] and §8 describe the per-type channel routing as living on a `Notification.channels` array, and [04b §10]'s `Notification` model as written does **NOT** carry a `channels` column (it has `type`, `title`, `body`, `ticketId?`, `deepLink?`, `read`). The routing the docs attribute to "`channels` reserved on the row" is really a **per-recipient, per-type policy** — it belongs on a user-keyed preference, not re-stamped onto every `Notification` row. This addition proposes that the channel-routing decision moves to a new `NotificationPreference` set (§3.1); `Notification.channels` as "reserved on the row" is treated as the *conceptual* reservation [18] names, now given a real home. (Delta flagged in §3.1 + §7.)

2. **The iOS push chain is unverifiable.** [CLIENT_AND_PUSH §7] documents that iOS Web Push works **only** for a PWA added to the Home Screen on iOS 16.4+, surfaces no silent/background push, and prompts for permission only from the installed PWA after a user gesture. That is a five-link chain (VAPID public key → `requestPermission()` → `pushManager.subscribe()` → `PushSubscription` persisted → SW `push` handler renders on the lock screen), and **every link can fail silently** on iOS. A user who flips the toggle on has **no way to know** whether a real push will ever reach their lock screen until a genuine `needs-input` fires hours later — at which point a missed alert is a stalled agent. There is no "does this actually work on my phone right now?" affordance.

This addition closes both: it makes the channel policy **visible and editable per-(type × channel)**, and it adds a **test-push** that drives the *real* redacted pipeline once, on demand, and reports the outcome (or the known iOS limitation) back in-app.

---

## 2. Locked decision (per-type × {push,in-app} matrix + test-push; email & quiet-hours deferred)

**LOCKED:** *A per-(notification-type × {push, in-app}) boolean matrix + a one-tap test-push.*

| Decision | Locked outcome |
|---|---|
| **Matrix axes** | Rows = the four `Notification.type` values (`needs-input`, `merge`, `ai-suggestion`, `container-failure`, [18 §Data]/[04b §10]); columns = **`push`** and **`in-app`** only. |
| **Cell type** | A boolean per (type × channel) — "does this type reach me via this channel". |
| **Email channel** | **DEFERRED.** [18 §Out] keeps email as server-side `@luckystack/email` fan-out; no email column in V1. The matrix is built so a third column slots in later without a schema reshape (§3.1). |
| **App-level quiet-hours** | **DEFERRED → OS DND** (`Q-CLIENT-QUIET`, [CLIENT_AND_PUSH §8/§10]). No app quiet-hours UI; the matrix sits exactly where [CLIENT_AND_PUSH §8] reserved it. |
| **Defaults** | The matrix defaults to **today's behaviour** (§3.1): high-signal types push, all types show in-app. No behaviour change for a user who never opens the screen. |
| **Storage** | A user-keyed `NotificationPreference` set — **framework-global, like `PushSubscription`** ([04b §11b]) — proposed in §3.1. |
| **Save path** | A new `notif-prefs-save` **[control-API] op** ([CONTROL_API §8]); the Conductor is the writer (§3.4). |
| **Test-push** | Sends a **redacted** test notification through the **real** pipeline ([CLIENT_AND_PUSH §5]) and reports delivery / known-iOS-limits **in-app** (§3.3). |

**DEFAULT — flag if wrong (this is the default the prompt instructed me to assume; I endorse it — see §4):**

- The matrix is a **per-(type × channel) boolean**, **defaulting to today's behaviour**: `push = true` for the high-signal types (`needs-input`, `container-failure`), `push = false` for `merge`/`ai-suggestion`; `in-app = true` for all four ([CLIENT_AND_PUSH §8]). A user who never touches the screen sees zero change.
- Stored as a **`NotificationPreference` set keyed by user** (framework-global, mirroring `PushSubscription` per [04b §11b]) — **NOT** tenant-scoped in its V1 shape, but carrying an **optional `workspaceId`** so the **Tier-2 "per-workspace push scoping"** (§3.1) lands without a migration: a multi-workspace user can later mute a noisy workspace per-device.
- Saved via the `notif-prefs-save` [control-API] op; the **test-push** sends a redacted test `Notification` through the existing fan-out and the in-app surface reports the result (or the iOS caveat).

> **Conflict check (Rule 3b):** one real delta, surfaced not silently absorbed. [18 §Data] frames the per-type channel routing as "reserved on `Notification.channels`", but the **actual `Notification` model in [04b §10] has no `channels` field** — so there is nothing to "surface". Re-stamping channels onto every per-recipient `Notification` row would also be the wrong shape (the routing is a *standing user preference*, evaluated at fan-out time, not a property of an individual notification). **I do not endorse adding `channels` to `Notification`;** I endorse a new user-keyed `NotificationPreference` (§3.1) that the fan-out worker reads to decide channels. This is a **B-lane schema add** (one model), flagged here and in §7, consistent with the "propose deltas if missing" instruction. Everything else aligns with the locked docs: redacted-push posture (D80-reversed) is untouched, no new verb, the Conductor stays the only writer.

---

## 3. Build-ready mechanics

### 3.1 Data model (`NotificationPreference`; per-workspace scoping delta; cite 04b §10)

**Proposed new model** (Lane B — the one schema add this addition needs). It sits beside `Notification`/`PushSubscription` in [04b §10] and follows `PushSubscription`'s **framework-global, user-keyed** posture ([04b §11b] — a user's standing preference, not a workspace's row):

```prisma
// PROPOSED — beside Notification / PushSubscription, [04b §10].
// Framework-global (user-keyed), like PushSubscription ([04b §11b]).
// One row per (userId, type, workspaceId?) — sparse: a row exists only when the
// user has overridden the default for that cell. Absence ⇒ the §3.1 default.
model NotificationPreference {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  userId      String   @db.ObjectId               // FRAMEWORK-GLOBAL (no workspaceId required; §11b)
  type        String                              // 'needs-input' | 'merge' | 'ai-suggestion' | 'container-failure'  (the four, [04b §10])
  push        Boolean                             // does this type reach this user via web-push
  inApp       Boolean                             // does this type render in the bell/center ([18])
  workspaceId String?  @db.ObjectId               // Tier-2 per-workspace scope: null ⇒ global default for the type; set ⇒ a per-workspace override (§3.1 delta)
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())

  @@unique([userId, type, workspaceId])           // one override per (user, type, scope)
  @@index([userId])
}
```

**Resolution order (fan-out worker, [CLIENT_AND_PUSH §5.3]).** When the Conductor (or the leased fan-out worker it drives under `lease:orchestrator` + `runInTenant`) is about to fan out a `Notification` of `type T` to `user U` in `workspace W`, it resolves each channel by **most-specific-wins**:

1. `NotificationPreference(userId=U, type=T, workspaceId=W)` — the per-workspace override (Tier-2), if present.
2. else `NotificationPreference(userId=U, type=T, workspaceId=null)` — the user's global per-type setting.
3. else the **hard-coded default** (§below) — today's behaviour ([CLIENT_AND_PUSH §8]).

A channel fires only if the resolved boolean is `true` **and** (for `push`) a `PushSubscription` exists ([CLIENT_AND_PUSH §5.3]). `in-app = false` suppresses the bell/center row + the unread badge increment ([18 §2]) for that type; `push = false` suppresses the web-push send only — the two channels are independent per cell.

**Default matrix (no row ⇒ this):**

| Type | `in-app` default | `push` default | Source |
|---|---|---|---|
| `needs-input` | `true` | **`true`** (blocking — always) | [CLIENT_AND_PUSH §8] |
| `container-failure` | `true` | **`true`** (loud) | [CLIENT_AND_PUSH §8] |
| `merge` | `true` | `false` (opt-in) | [CLIENT_AND_PUSH §8] |
| `ai-suggestion` | `true` | `false` (opt-in) | [CLIENT_AND_PUSH §8] |

- **Per-workspace scoping (Tier-2 delta, flagged):** the `workspaceId?` column is shipped **now** (so no later migration) but the **UI scope-switcher is Tier-2** — V1 ships the **global** matrix only (every cell writes `workspaceId=null`). When Tier-2 opens, the same matrix gains a workspace selector that writes `workspaceId=W` rows, letting a multi-workspace user mute one noisy workspace's `container-failure` push without touching the others. This is the concrete realization of [CLIENT_AND_PUSH §8]'s "reserved next to the [18] channel matrix" + the multi-device mute the prompt names. **No V1 UI surface for the per-workspace axis** — the column exists, the switcher does not (§5.s3).
- **`Notification.channels` reconciliation (delta vs [18 §Data]):** [18] cites a `Notification.channels` array as the routing source; [04b §10]'s `Notification` model has **no such column** (verified). This addition resolves the discrepancy by routing through `NotificationPreference` at fan-out time instead. **No field is added to `Notification`.** (Recommend [18 §Data]'s `channels` row be footnoted to point here — that edit lands in [18], not this addition; reported per "Report Without Auto-Fixing".)
- **INDEX delta:** +1 model (`NotificationPreference`), +0 fields on existing models. (Aggregation owner is [features/INDEX.md]; this addition reports the delta, it does not edit INDEX or [04b].)

### 3.2 The matrix UI (cite features/17/18; AccountSettings.tsx)

The matrix **replaces** the single `Web push` `Toggle` inside the existing **Notifications** `Card` in `_screens/AccountSettings.tsx:174–179` (Rule 27 — extend the screen, don't fork it). The push-master toggle stays as the **gate** above the matrix (it owns the SW subscribe/unsubscribe, [17 §Notifications]/[CLIENT_AND_PUSH §5.2]); the matrix governs *which types* use the channels the gate enables.

**Anatomy** (reusing the screen's existing `Card`/`Row` primitives + `_components/primitives`):

```
Notifications        [✓ Web push enabled]   ← existing gate (SW subscribe), [17]
Choose how each alert reaches you.
                                   In-app   Push
 ❓ Needs input                     [✓]      [✓]
 ⚠ Container failures               [✓]      [✓]
 🔀 Merges                          [✓]      [ ]
 🤖 AI suggestions                  [✓]      [ ]
                          [ Send me a test → ]
```

- **One row per type** — the four `Notification.type` values, each with its [18]-glyph (mirror the `NOTIF_TINT`/per-type glyph map [18 §UI] names; reuse, don't re-pick colors). Each row has **two `Toggle`s** (`_components/primitives`, the same `Toggle` the screen already imports), `in-app` then `push`.
- **`push` column is disabled (greyed, not removed) when the master `Web push` gate is off** — a cell can't route to a channel the device hasn't subscribed. On iOS-not-installed, the gate itself shows the **"Add to Home Screen to enable alerts"** pre-step ([CLIENT_AND_PUSH §7], [17 §Notifications]); until then the whole `push` column is inert.
- **`needs-input` push is sticky-on by default but still toggleable** — the doc calls it "blocking — always" ([CLIENT_AND_PUSH §8]); V1 lets the user turn it off (their choice) but shows an inline `text-muted` hint ("turning this off can let an agent stall waiting on you") rather than locking it (§5.s2).
- **i18n mandatory** (Rule 13): every type label, column header, the hint, and the test-button copy are `useTranslator` keys from `src/_functions/translator` — zero inline literals.
- **Tailwind tokens only** (Rule 14): row/cell styling reuses `text-title`/`text-common`/`text-muted`, the per-type glyph tints from [18]'s token map; no arbitrary hex. Self-closing tags, backtick `className` (JSX micro-conventions).
- **Mobile parity** ([17 §Mobile], B-37): the `Card` stacks full-width; the two toggle columns stay as a compact right cluster per row; the test button is full-width. No hover dependency.
- **Optimistic-but-merge-on-save:** toggling a cell shows the new state immediately as a *pending* affordance and dispatches the save (§3.4); it reconciles on the `ControlAck`/realtime confirm ([CONTROL_API §6.3]) — no local authoritative write (status/prefs are Conductor-written, [01 §3.3]).

### 3.3 Test-push (real redacted pipeline; cite CLIENT_AND_PUSH; report iOS limits)

The **"Send me a test →"** button drives the **real** push pipeline once, on demand — it is the only honest way to verify the iOS chain ([CLIENT_AND_PUSH §7]). It does **not** fake the SW or short-circuit the send.

**Flow:**

1. The button dispatches a `notif-test-push` [control-API] op (§3.4) → `preApiExecute` (`login:true`, own-account) → enqueue a Conductor action.
2. The **Conductor writes a real `Notification`** for the calling user — `type:'needs-input'` (the canonical high-signal class), `title` an i18n'd "Test notification", `body` a redacted-safe "If you can read this in-app, your alerts work.", `deepLink` back to the Account screen. It fans out exactly like a real one ([CLIENT_AND_PUSH §5.3]): **in-app row** in the bell/center ([18]) **plus**, if a `PushSubscription` exists and the user's resolved `push` for `needs-input` is `true`, a **redacted web-push** ([CLIENT_AND_PUSH §5.4] — title + "open to view", `redacted:true`, D80-reversed). The test is redacted like every other push (Rule 19); its body is non-secret by construction but it still rides the redacted path so the test exercises the *real* shape.
3. The **SW `push` handler renders it on the lock screen** ([CLIENT_AND_PUSH §5.5]); the `tag` dedupes; tapping deep-links back into the Account screen.
4. **Reporting back in-app:** the Account screen shows the outcome inline, derived from what it can actually observe (no new server probe — the client knows its own state):

   | Observable client state | Reported result (i18n) |
   |---|---|
   | No `PushSubscription` / gate off | "Push isn't enabled on this device — only the in-app alert was sent." |
   | iOS + not installed as PWA | "On iPhone, add this app to your Home Screen first — iOS only delivers push to an installed app." ([CLIENT_AND_PUSH §7]) |
   | Subscribed; SW received the test `push` (the SW `postMessage`s `test-push-delivered` back to the page on render) | "Delivered — check your lock screen. ✓" |
   | Subscribed; no SW `push` within ~10s | "Sent, but we didn't see it arrive in 10s. On iOS this can mean the install/permission step didn't complete; on others, check OS notification settings." |

   The in-app bell row **always** appears (the in-app channel is local), so the test **always** confirms at least the in-app path; the push column of the report is the part that surfaces the iOS limitation honestly rather than pretending success.

- **The SW already has the hook:** [CLIENT_AND_PUSH §5.5]'s `push` handler already `showNotification`s and the `notificationclick` already `postMessage`s the page. The only addition is the SW posting a lightweight `test-push-delivered` message when `data.test === true`, so the page can flip the report to "delivered" (a render-time signal, not a write).
- **No new verb, no new billing** — the test writes a `Notification` (a Conductor action) and sends a push; **no LLM session, no PTY turn, no model call** is involved, so it has **zero PTY-billing impact** (it is pure fan-out, [CLIENT_AND_PUSH §5]).
- **Rate-limited** (§3.4) so the button can't be spammed into a push-storm against the user's own device.

### 3.4 Save path (control-API op)

Two new ops join the [CONTROL_API §8] catalogue (both `method:"POST"`, `auth:{login:true}`, `preApiExecute` → enqueue → `ControlAck`, never a direct write — §7 of CONTROL_API):

| `op` | Target | RBAC ([CONTROL_API §5]) | Conductor action | Owning doc |
|---|---|---|---|---|
| `notif-prefs-save` | `{ }` (own account) | **login (own prefs)** — same tier as `mark-read` ([CONTROL_API §8]); no workspace-role needed (prefs are framework-global per-user) | upsert/delete the `NotificationPreference` rows for the changed cells (sparse — delete a row that returns to default) | [16_addition], [18] |
| `notif-test-push` | `{ }` (own account) | **login (own account)** | write a redacted test `Notification` for the caller + fan out (§3.3) | [16_addition], [CLIENT_AND_PUSH] |

- **Payload** (`notif-prefs-save`): the changed cells only — `{ changes: { type: NotificationType; channel: 'push'|'inApp'; value: boolean; workspaceId?: string }[]; clientRequestId }`. The handler validates `type ∈` the four + `channel ∈ {push,inApp}` (reject `invalid` early, [CONTROL_API §7]) and enqueues one signal; the Conductor upserts (or deletes-to-default) the sparse rows. **It writes no row inline** — enqueue-and-ack only ([CONTROL_API §7]).
- **Idempotency / ordering:** `clientRequestId` dedupes double-taps; the Conductor drains serially ([CONTROL_API §6.4]). A rapid toggle-flap collapses to the last value by `seq`.
- **`runInTenant` posture:** `notif-prefs-save` writes a **framework-global** `NotificationPreference` (no `workspaceId` in the global case), so it does **not** require a tenant client for the global rows; the **Tier-2 per-workspace rows** (when that lands) carry `workspaceId` and the upsert runs `runInTenant(workspaceId, …)` for those ([04b §11c]). `notif-test-push` writes a tenant-scoped `Notification` (it has a `workspaceId`) → `runInTenant` mandatory ([04b §11c], [CLIENT_AND_PUSH §5.3]). Flagged so the build lane wires the right client per op.
- **Rate-limit:** `notif-prefs-save` a normal single-item limit; `notif-test-push` a **tight** limit (e.g. a few per minute) so the test can't be weaponised into a self-push-flood. The auto-sweep contract-tests both ([CONTROL_API §3], [ARCHITECTURE_TESTING]).

---

## 4. Invariants honored

| Invariant | How this addition honors it |
|---|---|
| **B-23 — Conductor is the only writer** | The matrix never writes prefs locally; toggling enqueues a `notif-prefs-save` [control-API] op the **Conductor** drains and writes ([CONTROL_API §7], [01 §3.3]). The test-push writes a `Notification` as a Conductor action, never a client write. |
| **FROZEN verbs** (02 §2: 7 worker + 6 assistant, all read/propose) | **Zero new structured-channel verbs.** Both new surfaces are **[control-API] ops** (the human write path, [CONTROL_API §4]), not agent verbs. Prefs are saved via the control-API exactly as the prompt requires. |
| **`runInTenant` mandatory** ([04b §11c]) | Global pref rows are framework-global (no tenant client needed, like `PushSubscription` §11b); per-workspace (Tier-2) pref rows + the test `Notification` are tenant-scoped → `runInTenant(workspaceId, …)` (§3.4). |
| **PTY-billing** | The matrix, the save, and the test-push involve **no LLM session, no PTY turn, no model call** — pure fan-out + a control-API write. **Zero billing impact** ([CLIENT_AND_PUSH §5]). |
| **Rule 19 security — redacted push** | The test-push rides the **redacted** pipeline (title + "open to view", `redacted:true`, D80-reversed, [CLIENT_AND_PUSH §5.4]); the full (non-secret) body is fetched in-app behind auth like any other. The lock screen never carries a body, even for the test. |
| **Redacted-default posture (D80 reversed, Q-SEC-NOTIF-PUSH)** | Untouched. This addition adds a *preference* layer; it does not change the payload shape or the per-device `fullBodyOptIn` ([04b §10]). |
| **`PushSubscription` framework-global scoping ([04b §11b])** | `NotificationPreference` mirrors it — user-keyed, framework-global by default, with the optional `workspaceId` only for the Tier-2 per-workspace override. |
| **LuckyStack conventions** | i18n via `useTranslator` (Rule 13); Tailwind tokens only from `index.css` `@theme` + [18]'s token map (Rule 14); extend `AccountSettings.tsx`'s Notifications card + reuse `Card`/`Row`/`Toggle`/primitives (Rule 27); self-closing tags, backtick `className` (JSX micro-conventions). |
| **V1_SCOPE wins** | Notifications + push are explicitly **V1 IN** ([V1_SCOPE §3.6]); email + quiet-hours are deferred exactly as [18 §Out]/[CLIENT_AND_PUSH §8] keep them; the per-workspace scope axis is **Tier-2** (column shipped, UI deferred) so V1 ships only the global matrix. No [04b §18] deferred-forge surface is touched. |

---

## 5. Open sub-decisions (DEFAULTs)

| # | Sub-decision | DEFAULT (proceed unless flagged) |
|---|---|---|
| 16.s1 | **Where the channel-routing source of truth lives** — `Notification.channels` (as [18] cites) vs a new `NotificationPreference`. | **New `NotificationPreference`** (§3.1). [04b §10]'s `Notification` has no `channels` column; routing is a *standing per-user* decision evaluated at fan-out, not a per-row property. Footnote [18 §Data]'s `channels` row to point here (reported, not auto-fixed). |
| 16.s2 | **Is `needs-input` push lockable-on?** (it's "blocking — always", [CLIENT_AND_PUSH §8]). | **Toggleable, with a warning hint** — the user owns their device; show "turning this off can let an agent stall waiting on you" rather than hard-locking the cell. Revisit if missed-`needs-input` becomes a support pattern. |
| 16.s3 | **Per-workspace scope UI in V1?** | **No — Tier-2.** Ship the `workspaceId?` column now (no later migration), but V1's matrix writes only `workspaceId=null` (global). The workspace selector + per-workspace rows land when Tier-2 opens ([CLIENT_AND_PUSH §8] "reserved next to the [18] matrix"). |
| 16.s4 | **Email column.** | **OUT (deferred).** [18 §Out] keeps email as `@luckystack/email` server fan-out; the matrix is built so a third column slots in without reshaping `NotificationPreference` (add an `email Boolean?` later). |
| 16.s5 | **What `type` the test-push uses.** | **`needs-input`** — the always-on high-signal class, so the test exercises the loudest path (and validates the cell most users care about). The report still notes if the user has turned `needs-input` push off (then only in-app is sent). |
| 16.s6 | **How the test reports push delivery without a server probe.** | The **SW `postMessage`s `test-push-delivered`** to the page on render (a render signal, not a write); the page flips the report. A ~10s no-message timeout yields the honest "didn't see it arrive" iOS-aware message (§3.3). No new server endpoint. |
| 16.s7 | **Sparse vs dense pref rows.** | **Sparse** — a `NotificationPreference` row exists only for a cell the user changed from default; returning a cell to default **deletes** the row (the `@@unique` + the §3.1 resolution order make absence ⇒ default). Keeps the table tiny and the default self-healing if defaults change. |

---

## 6. Build checklist (per-lane + verification)

**Lane B (data) — the schema + fan-out resolution + control-API ops.**

- [ ] **Add the `NotificationPreference` model** (§3.1) beside `Notification`/`PushSubscription` ([04b §10]); framework-global, sparse, `@@unique([userId, type, workspaceId])`. Add the `types.ts` mirror (a UI type with `type`/`push`/`inApp`/`workspaceId?`), per the [04b §15] backfill posture.
  - *Verify:* a migration test creates a sparse override row and asserts the `@@unique` rejects a duplicate `(userId,type,workspaceId)`.
- [ ] **Resolution order in the fan-out worker** (§3.1): most-specific-wins (workspace → global → hard-coded default); a channel fires only if resolved `true` (and, for push, a `PushSubscription` exists).
  - *Verify:* a unit test — user with no rows ⇒ default matrix; a `push=false` global override on `container-failure` suppresses the push but keeps the in-app row; a Tier-2 `workspaceId` row wins over the global row for that workspace only.
- [ ] **`notif-prefs-save` [control-API] op** (§3.4): `login:true`, own-account, validate `type`/`channel`, **enqueue** (never write inline), sparse upsert/delete-to-default in the Conductor; `runInTenant` only for `workspaceId`-bearing (Tier-2) rows.
  - *Verify:* the auto-sweep contract/auth/rate-limit checks pass; a per-route test asserts a save enqueues exactly one signal and the handler writes no row directly.
- [ ] **`notif-test-push` [control-API] op** (§3.4): write a redacted test `Notification` for the caller + fan out; `runInTenant`; **tight rate-limit**.
  - *Verify:* a per-route test asserts the test `Notification` is `redacted`-shaped and rides the same fan-out as a real one; rate-limit blocks a rapid second call.

**Lane C (frontend) — the matrix UI + the test button + reporting.**

- [ ] **Replace the single `Web push` `Toggle`** in `AccountSettings.tsx:174–179`'s Notifications `Card` with: the **master push gate** (keeps SW subscribe/unsubscribe + the iOS "Add to Home Screen" pre-step, [17]/[CLIENT_AND_PUSH §7]) **above** the **4×2 matrix** (§3.2), reusing `Card`/`Row`/`Toggle`/primitives + [18]'s per-type glyph/token map.
  - *Verify:* the `push` column greys out when the gate is off / iOS-not-installed; toggles show optimistic-pending and reconcile on the `ControlAck` ([CONTROL_API §6.3]).
- [ ] **Wire toggles to `notif-prefs-save`** via the typed `apiRequest` ([CONTROL_API §3], Type-Generation contract) — no `as any`, route/version literals; debounce-batch the changed cells into one op.
  - *Verify:* flipping two cells fast sends one batched save (one `clientRequestId`); the UI reconciles to the confirmed state.
- [ ] **"Send me a test →" button** → `notif-test-push`; render the **in-app report** (§3.3 table) from observable client state + the SW `test-push-delivered` message + a ~10s timeout.
  - *Verify:* with no subscription, the report says in-app-only; on a subscribed device the bell row appears and (on a non-iOS device) the "Delivered ✓" path fires; the iOS-not-installed branch shows the Home-Screen message.
- [ ] **SW tweak** (§3.3/§5.s6): on a `push` whose `data.test === true`, `postMessage` `test-push-delivered` to the page (render signal only — no write, no new verb).
  - *Verify:* the page receives the message and flips the report; a normal (non-test) push posts nothing extra.
- [ ] **i18n keys** for every label, column header, the `needs-input` warning hint, the test-button copy, and all report strings (Rule 13); **zero inline user-facing literals.**
  - *Verify:* `npm run lint && npm run build` clean (Rule 11); a missing-key scan is clean.

**Cross-lane verification:**

- [ ] **Default-behaviour regression:** a user who never opens the screen (no `NotificationPreference` rows) gets **exactly** today's routing — `needs-input`/`container-failure` push, all four in-app ([CLIENT_AND_PUSH §8]). Assert via the §3.1 resolution-order test.
- [ ] **Redaction held:** the test-push payload is redacted-shaped (title + "open to view", `redacted:true`) even though its body is non-secret — confirm it never carries a body to the OS (Rule 19, [CLIENT_AND_PUSH §5.4]).

---

## 7. Citations

- **[features/18_NOTIFICATIONS.md]** — the four `Notification.type` values + grouping ([18 §Scope]/[18 §Data]); the **deferred "Notification preferences UI (per-type channel matrix)"** this addition builds ([18 §Deferred]); the per-type glyph/`NOTIF_TINT` map the matrix rows reuse ([18 §UI]); the bell/center + unread badge the `in-app` channel feeds ([18 §2]); the **`Notification.channels`** citation reconciled against the real [04b §10] model (delta, §3.1/§5.s1); D80-reversed redacted posture ([18 §Resolved]).
- **[CLIENT_AND_PUSH.md]** — the end-to-end VAPID→subscribe→redacted→in-app pipeline the test-push drives ([§5], esp. §5.2 subscribe, §5.3 fan-out, §5.4 redacted payload, §5.5 SW render + `postMessage`); the **iOS caveats** the test reports honestly ([§7]); the **type-gated channel defaults** the matrix defaults to ([§8] — `needs-input`/`container-failure` push, `merge`/`ai-suggestion` opt-in); the **per-(user,type) debounce** + the **reserved-next-to-the-[18]-matrix** quiet-hours/scope note ([§8/§10] `Q-CLIENT-QUIET`); the redacted-test rides the same fan-out (no new verb, [§5]).
- **[04b_DATA_MODEL_ADDENDA.md §10]** — the real `Notification` (`type`/`title`/`body`/`ticketId?`/`deepLink?`/`read` — **no `channels` column**) + `PushSubscription` (`fullBodyOptIn`, framework-global) the new `NotificationPreference` sits beside and mirrors; **§11b** framework-global scoping ([04b §11b]) the pref follows; **§11c** `runInTenant` for the tenant-scoped paths; **§15** the `types.ts` backfill posture for the new UI mirror; **§18** the deferred-forge set this addition does NOT touch.
- **[features/17_ACCOUNT_AND_AUTH.md]** — the Account screen's **Notifications card** + the single `Web push` `Toggle` ([17 §Notifications]) this addition extends; the SW subscribe-behind-the-banner + iOS Home-Screen gate; mobile parity ([17 §Mobile]).
- **[CONTROL_API.md]** — the `notif-prefs-save` + `notif-test-push` ops join the **§8 catalogue**; transport = typed `apiRequest` (§3); `preApiExecute` RBAC (§5, `mark-read`-tier own-account); **enqueue-not-write** (§7); `ControlAck` + optimistic-merge-on-`seq` (§6); the human-write-path vs frozen-verb distinction (§4).
- **[V1_SCOPE.md]** — **§3.6** "Notifications + push IN" (redacted, D80-reversed, PWA-first) that scopes this addition into V1; the email/quiet-hours/per-workspace deferrals consistent with §3.6/§4.
- **Prototype** — `_screens/AccountSettings.tsx` (the `Card`/`Row` primitives `:17–34`, the `Toggle` import `:12`, the **Notifications card** `:174–179` the matrix replaces, the local `push` state `:96`).
