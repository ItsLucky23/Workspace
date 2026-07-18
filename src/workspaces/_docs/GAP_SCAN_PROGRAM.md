# GAP_SCAN PROGRAM — phased build plan for the remaining findings

> A `/goal`-runnable plan covering everything still OPEN from `GAP_SCAN_2026-07-17.md` (95 findings, 13
> dimensions). The design- + document-slice was already delivered by `DESIGN_DOCS_PROGRAM.md` (see its status
> table); this program is the REST. Created 2026-07-18.
>
> **Already closed by DESIGN_DOCS_PROGRAM (not repeated here):** #9 designer full-look extraction + web
> discovery · #20 documents authoring (templates / diagrams / version-restore) · the documents polish list
> (upload→AI round trip, diff-before-apply, `kind`+templates, wireframes, revision restore) · designer polish
> (full-look, mobile viewport) · coupling C21 (design-library grounds generation) + C20 partially (lossless
> ticket→agent artifact handoff).
>
> **Scale, honestly:** ~37 items across 7 phases (3 descoped by the owner — see the end), several M/L. This is multi-week engineering, not a single
> sitting. Phases are ordered so the highest-leverage, lowest-risk work lands first, and EACH phase is gated
> (typecheck · lint · ai:lint · build · tests) and committed on its own before the next starts.
>
> **Standing invariants (unchanged):** B-23 single-writer (AI proposes → user approves → Conductor writes) ·
> every user write is a `[control-API]` op, no new frozen verbs · `runInTenant` on every orchestrator/worker
> path · provider-pluggable AI (ADR 0007) · phone-first + simple UI · surgical changes.
>
> Effort: **S** ≈ days · **M** ≈ 1–2 weeks · **L** ≈ multi-week.

---

## Phase A — Autopilot flagship (unblocks "10 channels on cron")

The scan's #1, #3 and the publishing-reliability cluster. Today the autopilot chain exists but is
**unreachable and silent** — this phase makes it usable and trustworthy.

| # | Item | Effort | Verifiable goal |
|---|---|---|---|
| A1 | **Multi-channel targeting on a scheduled task** (decision 2) — the create form writes a `channelIds[]` set; publishing fans out per channel with INDEPENDENT per-channel status, so one piece reaches 3+ channels and one failure never blocks the rest | M | A task targeting 3 channels publishes to all three; forcing one to fail leaves the other two succeeded and only that one in `error` |
| A2 | **Publish-failure visibility** — `runScheduledPublish` creates a notification + web-push on error; the queue view shows error rows (drop the `status !== 'scheduled'` filter) | S | A forced failure produces a notification, a visible error row, and a deep-link that opens the piece |
| A3 | **Retry** — `PublishJob.attempts` + bounded 429-aware backoff + a one-click manual retry | M | A transient failure retries automatically and succeeds; a permanent one stops after N and stays visible |
| A4 | **Dead-OAuth detection + reconnect CTA** — `getValidConnection` marks a connection unhealthy instead of silently returning a stale token | M | A revoked account surfaces "reconnect" in the UI instead of a generic failure |
| A5 | **Per-channel publish health** — an at-a-glance "are all N channels still posting?" panel | M | The insights/settings view shows per-channel last-success + failure count |
| A6 | **Burst/quota staggering** — spread posts that fire in one cron tick | S | Many same-tick posts are spaced; no platform-quota rejections in a burst test |
| A7 | **Platform app-credentials in-app** (decision 4) — move `YOUTUBE_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET` out of `.env` into per-workspace encrypted settings (the `save-media-provider` pattern: secretBox at rest, RBAC `workspaceSettings`, write-only in the UI — never echoed back), with `.env` kept as a fallback so existing installs keep working. **No auto-migration** — the owner re-enters them by hand | M | A self-hoster pastes YouTube credentials in the UI, connects an account and publishes — with `.env` empty; the secret never leaves the server in plaintext |

**Exit:** configure a channel on a cron timer from the UI → it publishes → a failure is visible, retried, and
notified.

---

## Phase B — Phone-first loop integrity

The approve/answer loop is the product's core model; today it is silently lossy on a phone.

| # | Item | Effort | Verifiable goal |
|---|---|---|---|
| B1 | **Approve/answer ack + offline banner** — `.catch`/ack on the answer-input `syncRequest` + a visible offline/reconnecting state | M | Approving while the socket is down surfaces a retry state instead of silently vanishing |
| B2 | **Create a 2nd/3rd workspace from a phone** — the switcher+create currently lives in a `hidden md:flex` header | S | A phone-width viewport can create and switch workspaces |
| B3 | **Notification deep-links** — populate `deepLink`/push `url?view=` for the non-ticket roles (interviewer findings, publish failures) | S | Tapping a notification lands on the right page, not app root |
| B4 | **iOS PWA install + push fallback** — `beforeinstallprompt`-only today; `togglePush` snaps back with no error | S | iOS Safari shows an install path + an honest push-unsupported message |
| B5 | **Touch targets + input zoom** — sub-16px inputs trigger iOS auto-zoom; several controls are under 44px | S | Key flows pass a 44px/16px audit at phone width |

**Exit:** the notify → open → approve loop is reliable and comfortable on a real phone.

---

## Phase C — Cheap coupling bridges (all S, high value/effort ratio)

Everything here is "the data already exists, the call is just never made".

| # | Item | Effort | Verifiable goal |
|---|---|---|---|
| C1 | **Institutional-memory RAG → chat + interviewer** — both should call `retrieveMemory` (only plan-critique does) | S | Asking chat "why is X like this" returns indexed past decisions/gotchas |
| C2 | **Documents reuse existing assets** — `generateDocumentImage` offers approved `DesignArtifact`/`StudioArtifact`/`ContentAsset` before generating | S | Inserting an image offers existing assets; no needless regeneration spend |
| C3 | **Skill ops in the chat catalog** — promote `ai-skill-toggle/save/delete/reset` from LATER to ENABLED | S | "Turn on the SEO skill" works from the Assistant |
| C4 | **Filter the op-catalog by enabled modules** — a content-only workspace shouldn't be offered dev ops | S | The chat system prompt only lists ops the workspace can actually run |
| C5 | **Root-cause on diff + RAG** — `buildRootCausePrompt` should use `branchDiff` + `retrieve` like its mr-review sibling | S | A revert suggestion cites the actual diff, not just merge titles |
| C6 | **Comment sentiment → ideator** — feed comment themes into the channel-aware `recentWinnersLine()` | S | The next idea reflects real audience reactions |
| C7 | **Documents archive/restore + ⌘K indexing** — the `archived` field exists with no op; the palette doesn't index docs | S | Archive/restore works; ⌘K finds documents by title |
| C8 | **Designer autofill own-URL from Deploy** — compare should read the Environment's live route | S | "Compare our page" pre-fills the deployed URL |

**Exit:** eight orphaned edges connected; each provable by a focused test.

---

## Phase D — Reliability & observability fundament

| # | Item | Effort | Verifiable goal |
|---|---|---|---|
| D1 | **AI job queue** — a concurrency cap (semaphore) + circuit breaker around `runAiCompletion` (no limiter today; N cron triggers spawn N PTYs) | M | A burst of N triggers runs at most K in parallel; a known-broken provider fails fast instead of eating the full timeout ×2 |
| D2 | **Persisted per-tool-call turn audit trail** — the spec'd PostToolUse → `/hooks/ticket-event` path was never built; live PTY output is unpersisted | M | After a turn you can inspect which files/commands it touched, in order |
| D3 | **Deploy history + rollback** — a DeployHistory log + a rollback op (gated on fixing E1 first) | M | You can roll a bad prod deploy back to the previous image |
| D4 | **Durable audit sink** — `AuditLog` is deleted by the very workspace-deletion it should record (ADR 0167 open follow-up) | M | Deleting a workspace leaves its governance trail intact outside the tenant |

---

## Phase E — Security / ops track (from the scan's completeness note)

These were code-verified but deliberately kept out of the feature sections.

> **Report-first (working agreement).** E2 and E3 change what is ALLOWED at runtime and can break flows that
> quietly work today. Each ships in **warn/report mode** first — the guard runs and logs every violation it
> WOULD have blocked — and is only flipped to loud-fail after that report is reviewed. E1/E4 are plain fixes
> and go straight in.

| # | Item | Effort | Verifiable goal |
|---|---|---|---|
| E1 | **Redeploy serves stale code** — the DB says the new build shipped, the container keeps the old one | M | A redeploy demonstrably serves the new commit (regression test) |
| E2 | **`runInTenant` gaps** — enforced at the Conductor's outer wrap, but cron / GitLab-sync / RAG-write paths bypass it | M | Every background writer runs tenant-scoped; a cross-tenant attempt loud-fails |
| E3 | **Worker egress closed by default** — currently unrestricted unless opted in | M | A worker container can only reach the allowlist |
| E4 | **Constant-time webhook auth** | S | The HMAC compare is constant-time (unit-proven) |

---

## Phase F — Content capability depth

| # | Item | Effort | Verifiable goal |
|---|---|---|---|
| F1 | **Raster thumbnail studio** (decision 3) — a template composite (background/frame + bold headline + logo) with an OPTIONAL AI-generated background, attached to the piece and uploaded via `thumbnails.set` / TikTok cover; + A/B against view-through-rate | M | A published video shows OUR thumbnail (both a plain-template and an AI-background variant render + upload) |
| F2 | **Captions styling + dubbing/localization** — `force_style`, word-by-word reveal, subtitle export, a second-language voice pass | L | A short renders with styled captions; a dubbed second language is produced |
| F3 | **SEO layer** — title/description/tag optimizer fed by the already-ingested publish metrics | S | Titles/tags get scored suggestions grounded in real performance |
| F4 | **Analytics over time** — snapshot `PublishJob.metrics` instead of overwriting; per-channel/piece trends | S | A trend chart shows growth over time, not just current totals |
| F5 | **Community action layer** — reply / AI-suggested reply + sentiment aggregation (inbox is read-only today) | M | You can reply from the inbox; sentiment feeds the ideator (C6) |
| ~~F6~~ | ~~**Publish-platform expansion** (Instagram/LinkedIn/X)~~ — **OUT OF SCOPE** (owner, 2026-07-18: "geen andere publicatie platformen voor nu"). YouTube + TikTok stay the supported set | — | — |

---

## Phase G — New modules

| # | Item | Effort | Verifiable goal |
|---|---|---|---|
| ~~G1~~ | ~~**Newsletter / email delivery**~~ — **OUT OF SCOPE** (owner, 2026-07-18: "ik hoef geen newsletter module"). Studio may still WRITE campaign copy; there is simply no send/list layer | — | — |
| G2 | **Workspace cloning** — documented as D9, zero implementation; deep-duplicate skills/sources/tools/env/channels/triggers | M | A new workspace starts from an existing one, no re-onboarding |
| G3 | **Ship-it-live for Studio/Designer artifacts** — reuse `ensureEnvironment` (project/service-scoped today) | M | A generated landing page goes live on a subdomain in one click |
| G4 | **Workspace-wide asset library** — assets are siloed per content piece | M | A brand mascot/logo/voice is reusable across pieces + channels (pairs with C2) |
| G5 | **Pipeline presets** — `presetKey` (simple/advanced/professional) is dead data; every workspace gets the heavy 7-stage pipeline | M | Creation offers a tier; a content-only workspace isn't given a dev pipeline |
| ~~G6~~ | ~~**Podcast / audio-only distribution**~~ — **OUT OF SCOPE** (owner, 2026-07-18 — read as covered by "geen andere publicatie platformen voor nu", since an RSS/audio feed is another publish target. Say so if you want this one kept) | — | — |
| G7 | **Prompt-quality eval / PromptVersion A-B** — only the deterministic replay scorer exists | L | A prompt change is measured, not vibed |
| G8 | **Competitor / site monitoring over time** — the scraper fetches once, no snapshots/diff | S | A watched site reports what changed since last run |

---

## Sequencing notes

- **A → B → C first.** A unblocks the flagship promise, B makes the core loop trustworthy on the device the
  product targets, C is eight cheap wins. Together they are the best value-per-risk in the whole plan.
- **E1 gates D3** (rollback is meaningless while a redeploy can serve stale code).
- **C2 and G4** are the same asset-index seen from two sides — build the index once in C2, surface it in G4.
- **C6 depends on F5's sentiment** for the full loop; C6 can ship first against raw comment text.
- Every item lists a *verifiable goal* (Rule 1a); a phase is done only when its exit check passes, is tested,
  and is committed.

## Resolved decisions (2026-07-18)

1. **A3 retry policy** — **auto 3× with exponential backoff, 429-aware**, then park as `error` with a manual
   retry button. (Chosen over manual-only / infinite-retry.)
2. **A1 scope — MULTI-channel fan-out, channels managed in-app.** One scheduled task may target **N channels**
   ("as many as you want"), and one piece of content can be pushed to 3+ channels at once. Channels/accounts
   are added **inside the app**, not through env keys. Per-channel failure handling must therefore be
   independent (one channel failing must not block the others) — this widens A1 from "a picker" to a
   **channel-set** on the task + a per-channel publish fan-out with per-channel status. See the note below.
3. **F1 thumbnails** — **both**: a template composite (frame/background + bold headline + logo) as the base,
   with an optional **AI-generated background**.
4. **Platform APP credentials move OUT of `.env` and into the app** (see A7). A self-hoster pastes their
   YouTube/TikTok app credentials in the UI instead of editing `.env`; stored encrypted per workspace, exactly
   like the media-provider keys. `.env` stays a fallback so existing installs keep working.

## Working agreements (2026-07-18)

- **Branch:** this program commits to **`feat/design-docs-program`** (the same branch the parallel hardening
  work uses) — one shared history, no separate merge.
- **Phase A verification = stub + integration tests.** Fan-out, retry/backoff, error rows and notifications
  are proven against the stub provider + real Mongo. **No real uploads** — nothing costs money or lands on a
  real channel. The owner does the live publish check separately if/when they want.
- **A7 = no auto-migration.** Build the UI + encrypted storage only; the owner re-enters the credentials by
  hand. Do NOT copy existing `.env` values into the store on boot.
- **Phase E = report first, enforce second.** Every security guard (tenant scoping, egress) ships in
  warn/report mode with logging, so we can see exactly what WOULD break, and is only flipped to loud-fail
  after that report is reviewed.

### Note on A1 — what "channels in-app, not env keys" means in this codebase

Worth splitting, because two different things are env-based today:

- **Channels + connected accounts are ALREADY in-app** (the `Channel` model + per-account encrypted OAuth
  tokens + `channel-create/edit/delete` ops). Nothing to move here — A1 is about *targeting* them from a
  scheduled task and fanning out.
- **The platform APP credentials are env-based** (`YOUTUBE_CLIENT_ID/SECRET`, `TIKTOK_*`). These are the
  once-per-app registrations each platform requires. **DECIDED (decision 4): they move in-app** — see A7.
  Security bar for that item: encrypted at rest (`WORKSPACES_ENC_KEY`), RBAC-gated to `workspaceSettings`,
  write-only in the UI (the snapshot returns "configured ✓", never the secret), and `.env` stays a fallback.

## Descoped by the owner (2026-07-18)

- **F6 — more publish platforms** (Instagram / LinkedIn / X): not now. YouTube + TikTok remain the set.
- **G6 — podcast / audio-only distribution**: not now (same reason — another publish target).
- **G1 — newsletter module**: not wanted in this product at all.

No product questions are outstanding; the plan is fully specified.
