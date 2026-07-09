# Workspaces — Clarity & Bold Feature Proposals

> A design brief for making the all-in-one build-and-ship + content platform legible and delightful for a **low-knowledge, phone-first** user. Part A hardens what exists so a newcomer can *see* what's possible. Part B is ambitious — every item is a **PROPOSAL needing your approval**, not a decision.
>
> **Priority legend:** 🟢 quick-win (hours–1 day, mostly wiring) · 🟡 medium (a few days, new UI over existing backend) · 🔴 big-bet (a real design + build effort).
>
> **The one-line diagnosis:** a huge amount of this product is *built and invisible*. Backends for time-travel, a knowledge graph, service/DB provisioning, audit, scheduled publishing, analytics feedback, an AI copilot, and more are complete but have zero UI or zero AI reach. The highest-leverage work here is not building — it's **surfacing, wiring, and guiding**.

---

# Part A — Clarity & Navigability

*Goal: a newcomer, on a phone, understands what the app can do, trusts that buttons work, and is never stranded on an empty screen.*

## A1. Kill the "is this app broken?" moments first

Nothing destroys a newcomer's trust faster than a button that looks alive and does nothing. There is a **cluster of dead controls** that must be fixed before any polish, because each one teaches the user "this app lies."

| 🟢 Fix | Where | Why it matters |
|---|---|---|
| Wire board card menu **Pause/Resume agent** | `page.tsx:65` (empty onClick) | Provider already has working `pauseTicket/resumeTicket` — ~1 line each |
| Wire header **Pause all** (discards confirm result) | `page.tsx:335` | The emergency stop currently does **nothing** |
| Add **Resume all** + a global "Engine paused" banner | no caller of `ctx.resumeAll` | Today a paused workspace is **unrecoverable from the app** |
| Remove or wire **Add reference** card button | `page.tsx:63` | Dead no-op |
| Wire or disable **terminal panel menu** (restart/clear/rename/kill) | `terminals/page.tsx:63-68` | Every action is a `Fase 2` stub |
| Real **GitLab token Verify** (ping `/user`) | `workspace/page.tsx:370` + `conductor.ts:837` | Double no-op — user can't tell if their token works |
| Wire or disable Sources **Regenerate** / **Reindex** | `sources/page.tsx:111,135` | Wired to a `noop` |
| Drop the **fake "GitLab — Connected"** static badge | `settings/page.tsx:268` | Shows green regardless of real state |
| Remove the Monaco **"● N unsaved"** affordance (pass `readOnly`) | `CodeEditorPanel` | Invites edits that can never save |

**Standard:** adopt a rule — *no control ships enabled unless it's wired.* Anything pending gets a disabled state + "coming soon" tooltip, never a live-looking dead button.

## A2. First-run onboarding & the "what is this?" problem 🟡

A low-knowledge user lands in a workspace with a board, a dozen nav items, and no story. Propose:

- **Module-aware welcome checklist** (dismissible, per workspace): 3–5 concrete steps tailored to the chosen module (Dev / Content / Design). E.g. Content → "Connect an account → Set your brand voice → Make your first piece → Approve & publish." Each step deep-links to the exact screen and self-checks as done.
- **A "What can I do here?" launcher** on every page header — one button that opens the Workspace-AI pre-seeded with *this page's* capabilities as tappable starter chips (see A6).
- **Persistent progress**: store checklist state in the snapshot so it survives reload and syncs phone↔desktop.

## A3. Empty states that teach, not blank screens 🟢🟡

Empty is the newcomer's default view, yet most boards render bare columns.

- **Content board** (critical): the board opens empty with **no create button at all** — the only creation path is discovering the AI chat. Add a primary **"New content piece"** button + an empty-state card: "No content yet. Describe what you want to make →."
- **Every stage column** gets a one-line "what lands here" caption (e.g. *Script → the written outline*, *Generate → images & voice*), so the pipeline metaphor reads even when columns are empty.
- **Board / backlog / activity**: replace bare empties with a single primary action + a one-liner. Kill the stale `// Dummy data` header comments that mislead future readers (board, backlog, sources, usage all still carry them though they render live data).

## A4. Make the invisible discoverable — a home for orphaned power 🟡🔴

A large set of finished features has **no nav entry or entry point**. Group them into legible destinations rather than scattering buttons:

- **New "Infrastructure" tab per project** unifying the three orphaned backends: **Service Stacks** (compose + one-click presets), **Databases** (connections / migrations / introspect), and the **Project Image** (Dockerfile draft + build status). One place answering "what is running for my project?"
- **New "Deployments" page** (promote out of the settings junk-drawer): an environment ladder dev → staging → prod → **demo**, live status dots, stable URLs, last-deployed commit, one-tap Promote, and the build-export list.
- **New "Publish" hub**: every `PublishJob` with status chips (Scheduled/Posted/Stub/Error/Unpublished), external link, per-post metrics, retry, unpublish, and a scheduled-posts calendar — surfaces ~4 built-but-invisible features at once.
- **Admin Settings tabs**: **Audit** (renders `auditLog_v1`), **Data & export** (one-tap GDPR bundle), **API tokens** (issue/list/revoke PATs — needs a small `listPats` read route). All server paths exist.
- **Consistent "coming soon" vs "hidden"** policy so the roadmap reads the same everywhere (today Instagram/LinkedIn appear in the channel dropdown but not the connect list).

## A5. Consistent components & honest feedback 🟢

- **Confirm on every destructive action.** `env-teardown` and `trigger-delete` fire instantly with no dialog; `env-teardown` isn't even in `CONFIRM_REQUIRED`. Standardize on `menuHandler.confirm` for anything irreversible (matches invariant B-23).
- **Status pills everywhere** (one shared component): forge connection, CI checks, build image, migration, deploy, publish job. The user should never guess whether something worked — today most results are a transient toast that's gone on reload.
- **Precise failure messages.** Merge blocks collapse to a generic "merge failed" though the server distinguishes CI-red / CI-running / CI-stale / needs-approval / conflict. Surface the real reason inline on the button.
- **i18n gaps** (breaks the en+nl+de+fr contract): backfill 9 missing `de/fr` board keys; translate `scheduled.runNow`; fix German mojibake (`VerÃ¶ffentlichungs-…`); move hardcoded English editor chrome (`VsCodeEmbed`, `CodeEditorPanel`, `FileExplorer`) to `useTranslator`.

## A6. The Workspace-AI as the universal guide 🟡🔴

The single best navigability tool a low-knowledge user has is the Assistant — but today it can *propose* only ~5 of ~138 write actions (~3.6% parity) and grounds each answer invisibly. Make it a real guide:

- **"Grounded on N code chunks + M product facts" chip** on answers, so users can tell RAG-backed from guessed.
- **Page-aware starter chips**: the Assistant always offers the top actions for the screen you're on.
- **Persist chat history** (per-workspace model → snapshot) so the conversation survives reload and is phone↔desktop consistent; thread the last N turns so follow-ups ("same for DEV-42") work.
- **Deep-link answers**: when the AI explains a feature, give it a tappable link to the exact screen — no more "open the time-travel control" that points at a control which doesn't exist.

---

# Part B — Bold (all PROPOSALS, need approval)

*Ambitious redesigns and distinctive features. Several convert a finished-but-dead backend into a headline capability — unusually high ROI.*

## B1. 🔴 BIG-BET — The generated AI op-catalog: make the Assistant able to actually run the product

**The promise vs reality gap.** The product's whole pitch is "AI does it, you approve from your phone." Reality: the Assistant can propose 5 board ops. It cannot generate a script, publish, deploy, create a sprint, run a review, add a trigger, or spin up a database.

**Proposal:** derive the Assistant's proposable actions from `OP_CAPABILITY` + a per-op JSON propose-schema, so **every `read|propose`-safe op becomes a one-tap, validated, Conductor-executed proposal**. The frozen-verb rule constrains *entities*, not how many existing ops the AI may propose — so this is compatible with B-23 single-writer. Destructive/secret ops (kill, delete, OAuth, provider keys) stay excluded; prod deploy keeps its human-approval flag.

**Impact:** ~4% → ~90% UI↔AI parity in one architectural move. This is the feature that makes the phone-first vision true.

## B2. 🔴 BIG-BET — Ship the Time Machine

The time-travel engine (start-from-before-commit-X, "yesterday's version," any commit, as-of-timestamp, synthetic-revert with conflict handling) is **100% built, unit-tested, and has zero UI**. The Assistant is even scripted to tell users to "open a time-travel preview" — a control that does not exist.

**Proposal:**
- A **"Time travel" button** on every ticket → a small menu: pick a commit from history, "main minus this commit," or a **date/time slider** ("take me back to yesterday").
- Each choice launches a **labelled ephemeral preview subdomain**.
- Make it **AI-proposable** ("preview main without commit X" → Accept card carrying the resolved RefSpec).
- A **visual branch/rollback map** on the ticket: baseline → AI commits → merge, with one-click "roll this merge back" (`revertMergeCommit` already exists).

**Impact:** a genuinely distinctive, demo-able feature sitting finished on the shelf. Highest ROI in the repo.

## B3. 🔴 BIG-BET — Finish "AI drives the UI" (copilot-propose)

`copilot-propose` — the op that lets the AI navigate you to the exact screen, prefill the form, and tee up the action — is dead end-to-end (no emitter, dropped by `asSugType`, no client applier). This is the *killer* phone-first interaction: glance-and-tap.

**Proposal:** wire it end to end — emit from the chat turn, carry the directive patch through the snapshot projection, and add a client directive-applier in `SuggestionCard` that navigates + prefills + confirms. Pair with **inline proposal editing** (tweak title/stage/assignee in the bubble before Accept) and **confidence + evidence chips**.

## B4. 🔴 BIG-BET — Make the Content pipeline actually flow

The 6-stage content board is **inert**: `content-advance` is never called, so 5 of 6 columns are permanently empty and the "pipeline" is decorative.

**Proposal:**
- **Auto-advance** `stageId` as pipeline steps land (script → *script*, visuals → *generate*, assembled → *review*).
- A visible **pipeline stepper** on the piece detail with one-tap Advance / Send to review / Publish.
- **"Idea → content series"**: from one brief, propose N pieces bound to *one* channel/project (today every brief spawns a brand-new Project — sprawl by design).
- **Per-stage "Definition of Done"**: an AI brand-voice/on-style QA gate before a piece may advance to publish — the human gets a phone approval card instead of silent progression.

## B5. 🔴 BIG-BET — The publishing composer + analytics feedback loop

Two footguns and a dead goldmine: every post currently goes out **PRIVATE and title-only** (the `publishVariants` pipeline has no UI writer), scheduled publishing is code-complete but **unreachable** (no `scheduledAt` on the sync contract), and the entire **audience-analytics → ideator feedback loop** (`ingestPublishMetrics`, `topPerformers`) is written, tested, and **never called**.

**Proposal:**
- **Publish composer modal**: account picker (multi-account is fully coded server-side), caption + hashtags + privacy (default to public or force a choice), and **"Schedule for later"** date-time picker (add `scheduledAt` to the contract — backend already honors it end to end).
- **Schedule ingestPublishMetrics** on the existing leader loop; show views/CTR/likes on Insights; **feed `topPerformers` into the ideator prompt** so the AI leans toward what worked.
- **Multi-account connect** flow (pass `accountId` through the OAuth start URL; group accounts per platform; bind a channel to an account).

## B6. 🟡 MEDIUM — The live "Agents" cockpit

Replace the bare Terminals page with real mission-control: **one card per running ticket** showing stage, elapsed time, token estimate, a **capacity meter** ("3/4 turns, 2 queued" — data already computed in `capacity.ts`), and inline pause/kill/preview. **Tee the container PTY stream** (currently drained and discarded) to the existing ws-term relay so a user can **watch the agent work live** instead of only seeing the final result.

## B7. 🟡 MEDIUM — One-click service & database provisioning

The K2 **preset gallery** (Postgres/Redis/Kafka/RabbitMQ/Elastic/MinIO/Mailpit) and the whole **user-app DB layer** (connect / migrate / introspect) are built and invisible.

**Proposal:** a **card grid** — "Add a database/service" — where one tap calls the already-built `serviceProvision(preset)`. A **guided migration flow**: dry-run/preview against the introspected schema + auto-generated rollback suggestion → the implemented prod-approval gate becomes a phone "review then approve" card. Make it **AI-proposable** ("spin up a Postgres") behind confirm.

## B8. 🟡 MEDIUM — AI-authored brand kit ("Learn my brand" in 30 seconds)

Turn the blank content-settings page into a guided setup: paste a URL or drop a few posts → the Assistant **proposes** a filled `productContext` + per-channel brand voice + a starter style, one Accept. Pair with a **visual style gallery** (render `previewAssetUrl` thumbnails — M1/M4 is half-built) so styles become browsable *looks*, not opaque prompt strings. Surface the three dead portability routes (brand/style export-import, copy-from-workspace) so multi-brand agencies are first-class.

## B9. 🟡 MEDIUM — First-class AI review & quality gate

AI MR review, plan-critique, and root-cause are registered roles but only dispatchable blind via cron (no ticket/MR context → they no-op).

**Proposal:**
- An **"AI review" button** on every MR (fires `mr-review` *with* the mrId) + a **"Checks" section** rendering the latest CI run, security max-severity, and failing-log tails (CI is entirely invisible today).
- A **"Critique plan"** button on the ticket; an **"Incident → diagnose"** console on the deploy screen (symptom box → `root-cause` → ranked culprit merge → one-click confirm-revert).
- Add `invoke-agent-role` to the **event** trigger builder (not just cron) so "on ticket.merged → AI review" is wireable.
- A **"Quality gate" dashboard**: latest CI, open findings by severity, MRs awaiting review, allow-red toggle — one-glance "is it safe to ship?"

## B10. 🟡 MEDIUM — Deployments page + demo-host as a shareable feature

Beyond A4's page: the **demo-host** (persistent "main at stable DNS" with auto-redeploy or pin-to-commit) is fully built, runs a background watcher, and has **zero UI**. Expose a **"Live demo link" card** (toggle on, copy URL, "freeze at this commit"). Add a **deploy timeline + one-tap rollback-to-previous** (the promote engine already pins images, so rollback is nearly free) and a phone push when a deploy goes live or fails. Make deploy/promote/export **AI-proposable** — the entire ship-half is currently unreachable by the Assistant.

## B11. 🟡 MEDIUM — Phone-first notifications & presence, done right

For a "human only approves from their phone" product, the notification bell lives **only in the desktop header**, and a signed-off **redacted-push** security decision is silently ignored (full ticket bodies hit the lock screen).

**Proposal:**
- **Redacted push by default**: OS sees title + "Open to view"; full body revealed in-app behind auth (respect the stored `fullBodyOptIn`).
- **Bell + swipeable notification sheet in MobileChrome**; every notification **deep-links to the ticket** (both in-app tap and push `url` — today both dead-end at app root).
- **Unified Activity inbox**: a push-fed, filterable stream where AI-suggestion and needs-input events carry **inline Approve / Answer buttons**, so the man-in-the-middle clears the whole pipeline from one place.
- Ship the **dead Y1 presence engine** as a live "team radar" (per-view active counts, "Alex is answering this").

## B12. 🟡 MEDIUM — Plain-language automation builder

Replace raw event/action dropdowns with a **sentence builder** ("When a ticket is merged, notify the team"), offering **only events the engine actually fires** (5 of 8 are silent traps today). Add **last-fired / next-fire / test (dry-run)** on every row, and let the Assistant **author automations** by proposal ("every morning have the interviewer suggest improvements and ping me" → ready-to-accept cron trigger). Finish and expose **Output Templates** (9:16 TikTok + watermark, 1:1 Instagram) as render-time export presets — backend is complete, needs a manager + picker.

## B13. 🟡 MEDIUM — The Knowledge Graph (Obsidian view)

`buildKnowledgeGraph` + `knowledgeGraph_v1` are complete and unit-tested with **no renderer**. Ship an **N2 force-directed graph page** (nav entry under the work group) where a node click **deep-links** to its ticket/source/content piece and highlights similarity edges — a navigation surface, not just a picture. (Or explicitly de-scope and stop advertising it in the product docs.)

## B14. 🟡 MEDIUM — Unified "Spend & limits" + predictive budget

Merge the two disjoint budgets into one page: a real **€-media-budget** card + a reframed **token-volume** budget (the current token budget is dead-wired and mislabeled in € on a Max subscription), plus a **live capacity strip** (N running / M queued). Wire the unused `enforcement:pauseNew` field so a cap **auto-pauses new turns** and pushes "hit your daily budget — raise cap or resume?". Add a **predictive projection** ("at this rate you'll hit your cap in ~3 days") and surface the already-stored **per-user attribution** as a "who spent what" view.

## B15. 🔴 BIG-BET — The one-click "Full brand launch kit"

A distinctive Studio/Design flagship: from **a single brief**, fan out *all* Studio kinds in one approval — brand, landing, copy, ads, social, email — auto-promote the brand into the library, derive a matching **Designer theme** (round-trip: brand palette ↔ app theme ↔ the coding-agent design-system doc), and drop everything into one **shareable campaign board**. Add **persist-by-default + version history** for generated looks (themes/styles/**animations** — animations currently have no save path and are lost on reload), and make thumbnails/ads **render to real downloadable PNG/social-sized assets**.

---

## Suggested sequencing

1. **Week 1 (trust):** A1 dead-button sweep + A5 confirms/status pills + i18n gaps. Cheap, and it stops the app from feeling broken.
2. **Weeks 2–4 (reach):** B1 op-catalog + A6 AI-as-guide + B4 content flow. This is where the phone-first vision becomes real.
3. **Then (marquee):** B2 Time Machine, B3 copilot, B5 publishing — each converts a finished backend into a headline, demo-able feature.
4. **Continuous (surface):** A2–A4 onboarding, empty states, and homing the orphaned power features.

**Open question for you:** the biggest strategic call is **B1 (generated AI op-catalog)** — it reinterprets "no new verbs" as "no new *entities*, but propose any existing op." That's a conscious deviation worth an explicit decision (and an ADR) before building, per the single-writer invariants.