# FREEDOM PROGRAM — the `/goal` build spec (premium customization + creative freedom + editors)

> **Status:** 📋 PLANNED (2026-07-07). The runnable spec for turning Workspaces from a "generate + download"
> pipeline into a **premium, freely-customizable AI product**. Grounding: the two gap-analysis waves
> (2026-07-07) — 10 read-only audits across AI-steering, provider/model choice, pipeline/custom-tasks,
> iteration/upload, context/knowledge, output/export/publish, approval/notification, templates/reuse,
> integrations/API, and preview/cost/localization; plus the media-editor assessment (image/video/audio).
> **Precedence:** this doc → `V1_SCOPE.md` (locked scope wins) → `CLAUDE.md` → the nine Workspaces
> invariants. A real conflict with no resolution here = a flag to the user, never a silent pick.

## 0. The core intent (read first)

The audits found one recurring truth: **the customization seams are already MODELLED in the backend but
not surfaced, or left dead.** `estimateMediaCostCents` is computed and hidden; `PushSubscription`,
`handoffInstruction`, `gateForApproval`, `IntegrationTool.type`/`.mcp`, `save-style`, `retrieveChannelBrand`,
the media per-feature override, `RenderJob.composition`, `format` — all exist and are unused or UI-less. So
a large share of this program is **"wire the existing seam to a premium UI"**, not greenfield. The genuinely
new builds are called out (push/PWA e2e, public API, the image/video/audio editors, user-defined AI tasks).

The goal is a **premium product**: everything the user asked for is possible, and every surface has good UX
(§0b). "The prompts are the product" stays true — but the product now *hands the knobs to the user* instead
of baking them in code.

## 0a. How this run works (per-item waterfall)
- **Waterfall per item:** schema → generate artifacts → engine → client → verify (test) → gates → ADR →
  branch-log → memory → commit. Fully green + committed before the next item.
- **Gates per item, all green before commit:** `npm run prisma:db:push` when the schema changed (backend
  DOWN first — kill node procs vs EPERM) → `npm run generateArtifacts` → `npm run typecheck` (tsc 0) →
  `npm run lint` → `npm run build` → `npm run ai:lint` → the test (`node scripts/runWsTests.mjs <filter>`).
- **Commit per item:** author `ItsLucky23`, NO Claude co-author, do NOT push, on `main`. `git status` before;
  stage ONLY your files. Another AI may be active — NEVER touch `scripts/prismaWithSecrets.ts`,
  `caddyRoutes.ts`, `editor*/page.tsx`. Do NOT stage `.env`, `.env.local`, `.claude/settings.json`. `.env.local`
  may be read.
- **Per item:** an ADR (`docs/decisions/NNNN`, then `npm run ai:decisions`), a `branch-logs/main.md` entry +
  `INDEX.md` row, and refresh the `workspaces-modules-and-queue` memory (or a new theme memory).
- **Testing policy (no new keys assumed):** hardening + wiring gets REAL integration tests (Mongo/git/
  fixtures, no keys). Real gen/render/publish/push gets **fixture/structure** tests (mock the HTTP / assert
  the request + command shape / the OAuth+VAPID flow), NOT live calls; the stub-fallback keeps the pipeline
  e2e green without keys. **Full LIVE e2e stays user-triggered** once keys/budget are in place. Never block on
  a key. (Live-AI opt-in tests are named `*.live.mts` so `runWsTests` never runs them.)
- **All framework rules + the nine invariants apply:** file-based routing; function-injection; strict typing —
  NO `as any` / `as unknown as T` (fix the generator, don't cast); `tryCatch` not raw try/catch; **i18n ×4
  (en/nl/de/fr)** for every user-facing string; Tailwind theme tokens only; surgical changes; **B-23
  single-writer** (AI proposes → Conductor executes, the only writer); `runInTenant` on every orchestrator
  path; **no new structured-channel verbs** (re-express via the frozen 7+6 + `WorkspaceTrigger` + run-command
  + MCP); the **PTY-billing invariant** (coding agent = interactive `claude` in a node-pty; OTHER providers OK
  for non-coding tasks). **Reply in Dutch.**
- **Minimize human-input:** don't stop to ask; an ambiguous fork with no answer here → sensible default, log an
  `OPEN VRAAG` in the branch-log, continue. A billing/PTY/tenant-leak RED escalates to the user.

## 0b. Premium-UX definition of done (applies to EVERY UI item)
Every screen this program adds or touches must clear this bar (not just "it renders"):
1. **Clarity for first-timers** — a helpful empty-state, one-line purpose, and tooltips on non-obvious knobs;
   never dump raw config on a non-technical user.
2. **Motion + tactility** — use the shell `PageTransition` + `Reveal` primitives + `active:scale` on controls
   (motion/react, reduced-motion-safe). No jank.
3. **Live + synced** — every write is a `[control-API]` op (Conductor is the only writer); the result syncs to
   the whole room via a delta or the content-dirty nudge (never caller-only). Optimistic where it helps.
4. **Cost + consequence honesty** — any paid/irreversible action shows the estimate/impact BEFORE the confirm.
5. **Phone-first where it's an approval/answer surface** — genuinely usable + reachable on mobile, not just
   responsive-by-accident.
6. **Consistent** — reuse `src/_components` + `src/workspaces/_components` primitives (Dropdown, Toggle, Tabs,
   WsButton, menuHandler, ModulePicker…); no parallel implementations. Theme tokens only.
7. **Accessible** — keyboard nav, visible focus, labels; wide content scrolls in its own container.

## 1. Execution order + dependencies
```
Fase Q (quick wins)  →  Fase K (bring-your-own material; K1 upload unblocks editors)  →
Fase P (provider/model)  →  Fase I (iteration)  →  Fase A (approval/notification CORE)  →
Fase O (output/export/publish)  →  Fase R (reuse/templates)  →  Fase X (extensibility)  →
Fase E (editors + custom AI tasks)  →  Fase S (safety + premium-UX polish, cross-cutting last)
```
**Hard dependencies:** E1–E4 (editors) require **K1** (file upload) + the queue-aware media lifecycle
(already shipped). O2/O3 (publish variants/scheduling) build on the existing publish/OAuth flow. R1/R2
(templates/clone) should come after the things worth templatizing exist. A1 (push) unblocks A2/A5.

---

## 2. The items

### Fase Q — Quick wins: surface the dead seams (cheap, high-impact)

- **Q1 — Cost estimate + per-piece spend in the UI.** Import `estimateMediaCostCents` (server `media/registry.ts`,
  today used only by budget guards) into the piece UI: the generation confirm shows **"≈ €X"** for THIS action
  (not the number-free warning), and each piece shows its own spend from the per-piece `MediaSpend` rows (data
  already recorded per `contentProjectId`/feature). **Seam:** `estimateMediaCostCents` + `MediaSpend`.
  **Verify:** the confirm renders the per-feature € estimate; a per-piece cost total shows; i18n ×4; build.
- **Q2 — Brand + product-context grounding (wire the dead retrieval).** Call the already-built
  `retrieveChannelBrand` (`server/content/brandMemory.ts`, currently referenced only in tests) at the content
  gen call sites (`script.ts`, `referenceImage.ts`, designer, studio), and add a per-workspace **product
  context** ("what we do / audience / always-mention") folded into every creative prompt. **Seam:** brand-RAG +
  a new `Workspace`/`ContentProject` context field. **Verify:** a fixture test asserts the brand/product text
  reaches the composed prompt; stub pipeline green.
- **Q3 — Custom style manager UI (the `save-style` op has no UI).** Build a style manager: create / name / edit
  / delete per-workspace styles (system-prompt + optional `params`), and replace the magic-string style box with
  a **picker + "＋ new style"**. **Seam:** `save-style` conductor op + `StylePreset` (+ `params`). **Verify:** a
  style created in the UI drives a generation; persists via the control-op; i18n ×4.
- **Q4 — Workspace AI-instruction (revive the dead `handoffInstruction`).** Add a settings field "How should the
  AI work in this workspace?" and actually inject it into every prompt builder (script/designer/marketer/
  interviewer/chat…). **Seam:** `Workspace.handoffInstruction` (exists, read nowhere). **Verify:** fixture test —
  the instruction appears in the composed system prompt across features.
- **Q5 — Media provider-per-feature picker + fix the Gemini dead-key.** The settings key form must also send
  `feature` so the `__media_provider_<feature>` override branch (already in the Conductor) is reachable — a
  per-feature provider dropdown. Fix the **dead-key bug**: either wire the text Gemini provider to the
  per-workspace key store, or remove the misleading Gemini media row; surface which keys are actually consumed.
  **Seam:** `save-media-provider` op + `workspaceKeys`. **Verify:** a per-feature provider override persists +
  drives dispatch (fixture); no key is stored-but-unused.
- **Q6 — Stage persona in the pipeline UI.** Expose `systemPrompt` (the stage's persona/`--append-system-prompt`)
  + `definitionOfDone` as editable fields in the pipeline stage editor (the `update-stage` op already accepts
  them; the UI only edits `customInstructions`/`promptTemplate`). **Seam:** `PipelineStage` + `save-stage-config`.
  **Verify:** editing the persona persists + renders into the stage prompt; build.

### Fase K — Bring your own material (K1 unblocks the editors)

- **K1 — Real file upload (dropzone → `/media` URL).** Implement the streaming-upload seam
  (`ARCHITECTURE_HTTP` origin-exempt path) + a reusable **dropzone** component. Two uses: (a) upload a reference
  image/video for reference-conditioned gen (replace the URL-only text box), (b) a new **`content-import-asset`**
  op to bring your OWN image/video into a piece as a first-class `ContentAsset` (no AI required). **Seam:**
  streaming-upload + `MEDIA_DIR` + a new import control-op. **Verify:** an uploaded file lands under `/media`,
  is usable as `referenceUrl`, and imports as a ContentAsset; size/type guarded; tenant-scoped.
- **K2 — Document upload → InfoSource (kill the `noop`).** Wire the Sources page "Upload spec" no-op to a real
  op: upload md/txt/pdf → `InfoSource(source:'uploaded', mode:'context-doc')`; parse pdf→text. **Seam:**
  `InfoSource` model (exists) + K1 upload. **Verify:** an uploaded doc becomes a queryable InfoSource; appears
  in the Sources list; i18n ×4.
- **K3 — Creative RAG grounding + per-generation source attach.** Let the creative features `retrieve()` (today
  dev-only): script/designer/marketer ground on uploaded docs + brand + product context. Add a per-generation
  **"attach reference docs/examples"** picker (`sourceIds` on the content op) → "write it like this example."
  **Seam:** `server/rag/retrieve` + `InfoSource` + content op payload. **Verify:** attached sources reach the
  prompt (fixture); retrieval is tenant + source-scoped.
- **K4 — Output language choice.** Add a `language` field to `MediaGenerationRequest` + the content-gen payload +
  a per-workspace default; thread it into script prompt composition and TTS voice-language selection. **Seam:**
  request shape + prompt composer + voice provider. **Verify:** a chosen locale produces target-language script/
  voice (fixture asserts the language reaches the prompt/voice params); default falls back sanely.

### Fase P — Provider & model freedom

- **P1 — Text provider-per-feature picker (feed the inert override seam).** Persist a per-workspace
  `AiFeature → provider` override and pass it as the 3rd arg to `runAiCompletion` (the `overrides` param is
  never fed today) at all 13 call sites; a settings UI to choose "Gemini for scripts, Claude for X". **Seam:**
  `resolveAssignment(overrides)` + a new per-workspace override store + `currentAssignments()`/
  `availableProviders()` (already exported for a UI that was never built). **Verify:** an override changes the
  resolved provider (fixture); UI persists it.
- **P2 — Model + generation-param tuning.** A per-workspace/per-feature **param registry** (model version,
  temperature, max-tokens, reasoning effort) consumed by the providers (Gemini reads only `GEMINI_MODEL` env
  today, no temperature; Claude-CLI has no model concept — expose what it CAN, note what it can't per the PTY
  invariant). Per-workspace Gemini key + model. **Verify:** a set temperature/model flows into the Gemini
  request (fixture); a sane clamp; UI persists.
- **P3 — Per-request media model choice ("low-poly / fast vs quality").** `falModelFor` must consult
  `req.params.model` / a per-workspace model map (today env-`FAL_MODEL_*`-only, `req.params` ignored for model
  selection) + a curated **model catalog per feature** (e.g. a fast/cheap video model, a low-poly 3d model)
  surfaced as a dropdown with cost/speed hints. **Seam:** `fal.ts falModelFor` + a model-catalog + the media
  request. **Verify:** choosing a model changes the fal model id in the request (fixture); catalog is per-feature.

### Fase I — Iteration & refinement (creative loop)

- **I1 — Regenerate + variations on a content asset.** A per-asset **regenerate** (re-run the same `MediaJob`
  input) and **"N variations"** + a free-text "make it more X" tweak, all through the queue-aware lifecycle
  (already shipped) so the timer/queue UX is consistent. **Seam:** `runQueuedMediaAsset` + a new
  `content-regenerate`/`content-vary` op carrying the source asset id + tweak. **Verify:** regenerate produces a
  new asset from the stored input + tweak; variations fan out; B-23 gate holds (confirm before spend).
- **I2 — Output versioning (keep, compare, revert).** Link a regeneration to its parent (`ContentAsset.parentId`)
  → a version strip on the asset card + compare + "revert to this". **Seam:** `ContentAsset` + the delta
  broadcast (already live). **Verify:** versions chain; revert sets the active asset; syncs to the room.
- **I3 — Content-aware Assistant (refine by chat).** Extend the workspace Assistant (today board-only:
  `bulk-move|assign|add-comment`) to SEE content pieces/assets and **propose** content ops (regenerate/vary/
  edit-brief) — strictly within the frozen verbs + single-writer (it proposes, the human accepts, the Conductor
  writes). **Seam:** `workspaceChat` context + the content op family (no new verbs). **Verify:** the Assistant
  proposes a valid content op from NL; it never writes directly; scope-guarded.
- **I4 — Studio artifact tweak-regenerate.** `studioGenerate` accepts a free-text tweak instruction (today a
  blind re-roll from the unchanged brief) so "make the landing bolder" works without editing the whole brief.
  **Seam:** `studioGenerate_v1` + `generate.ts buildPrompt`. **Verify:** the tweak reaches the prompt; a new
  artifact version is produced.

### Fase A — Approval / notification / man-in-the-middle (CORE — the product's heart)

- **A1 — Web-push + PWA end-to-end (genuinely new build).** Ship the missing pieces: a service worker
  (`sw.js`) + `manifest.webmanifest` (installable PWA) + server-side VAPID push-send + wire the existing
  `PushSubscription` model (written by nothing today) + a subscribe flow. **Seam:** `PushSubscription` (exists) +
  `CLIENT_AND_PUSH.md` spec. **Verify:** a subscription persists; a fixture asserts the VAPID send payload for a
  test event; the PWA installs + the SW registers (build + a headless check). Escalate any billing/secret snag.
- **A2 — Route the AI's questions + key events to bell + push.** Fan out `needs-input` (the AI asking a
  question — today it reaches ONLY the ticket banner, not even the bell), plus `merge` and `container-failure`,
  to the notification pipeline + push. **Seam:** `turnResult` questions + the notification create path +
  A1. **Verify:** a needs-input creates a notification + a push payload (fixture); the bell shows it.
- **A3 — Notification preferences (channel matrix + quiet hours + digest + per-workspace mute).** A new
  `NotificationPreference` model + a real settings matrix (per event-type × channel: in-app / push / email),
  quiet hours, batching/digest, per-workspace mute — honoured by the fan-out worker (today hard-coded). **Seam:**
  new model + `User.preferences` pattern. **Verify:** a muted type doesn't fan out; quiet hours defer; per-ws
  scope respected (test).
- **A4 — Autonomy dials / auto-approve ("ask me less").** Surface the existing `gateForApproval` (per-stage, no
  UI today) + a per-workspace **autonomy level** (gate-every / gate-key-stages / full-auto) so the human is
  asked only where they want. Destructive/irreversible always confirm (B-23). **Seam:** `gateForApproval` +
  `stageRunner` gate + a new autonomy setting. **Verify:** full-auto skips non-destructive gates; gate-every
  asks; irreversible still confirms (test).
- **A5 — Structured approvals + routing + reminders.** Replace the bare answer text-box with structured
  approve/reject/choice affordances where the AI offers options; route a question to the assignee + re-ping/
  escalate via the watchdog (today it parks forever, first opener answers). **Seam:** `request-input`/
  `answer-input` flow + `watchdog`. **Verify:** a routed question notifies the assignee; a stale question
  re-pings; structured choices post the right op.

### Fase O — Output / export / publishing freedom

- **O1 — Export formats + captions.** Parametrize the render ffmpeg plan (`render.ts`, today a fixed
  1280×720/30fps H.264): aspect/res/fps presets incl. **9:16 vertical** (for TikTok/Shorts/Reels) + 1:1 + 16:9;
  emit **.srt/.vtt** captions from the `captions` metadata that already exists; export a **gif/png** still. A
  format picker on export. **Seam:** `render.ts buildFfmpegPlan` + `shortForm` captions metadata. **Verify:** a
  9:16 render + an .srt are produced from dummy assets (or a typed degrade); format picker drives it.
- **O2 — Per-platform publish variants.** Extend the publish payload (today title-only) with per-platform
  caption / hashtags / privacy / thumbnail / aspect; a **compose-post** UI per connected platform. **Seam:**
  `publishAsset`/`publishOAuth` + `PublishJob` + a per-platform variant store. **Verify:** each platform posts
  its own caption/privacy (fixture asserts the upload payload per platform); B-23 gate holds.
- **O3 — Post scheduling.** Add `scheduledAt` to `PublishJob` + a leader-loop that fires due posts (reuse the
  cron/leader engine) + a **content calendar** UI to schedule/reschedule. **Seam:** `PublishJob` + the scheduled
  engine. **Verify:** a scheduled post fires at its time on the leader (test with an injected clock); reschedule
  works.
- **O4 — Branding: intro/outro + logo watermark.** Add overlay/`drawtext`/concat to the ffmpeg plan for a
  logo watermark + optional intro/outro clip, fed from the brand kit. **Seam:** `render.ts filter_complex` +
  brand-asset fields (+ K1 upload for the logo). **Verify:** a watermarked render (or typed degrade); brand
  assets drive it.
- **O5 — Output templates / format specs.** User-definable, reusable output specs (a repeatable video format /
  post structure) beyond the fixed `format` enum + single `faceless` composition. **Seam:** `RenderJob.composition`
  + a template store (feeds Fase R). **Verify:** a saved format spec drives a render; reusable across pieces.

### Fase R — Reuse & sharing (customization must not be trapped)

- **R1 — Save-as-template + apply.** A template store + `save-as-template`/`apply-template` ops for: a pipeline,
  a style-set, a brand kit, an automation set, and a content-piece structure. Extend `project-from-template`
  (today only a code scaffold) to also capture/apply pipeline + styles + brand. **Seam:** `project-from-template`
  + new template model + ops. **Verify:** a template captures a real pipeline/style/brand and re-creates it in a
  new project/workspace (test).
- **R2 — Clone workspace + cross-workspace/project copy.** "Create workspace from existing" + copy-a-pipeline/
  style/brand/automation to another workspace or project (today all `workspaceId`-locked, re-derived from
  defaults). **Seam:** `createBlankWorkspace` + copy ops. **Verify:** a cloned workspace reproduces pipeline +
  styles + brand; a pipeline copies project→project.
- **R3 — Personal defaults + brand-kit portability.** Extend `UserPreferences` (today 3 booleans) with default
  style/brand/language that follow the user across workspaces; export/import a brand kit as portable JSON.
  **Seam:** `UserPreferences` + `updatePreferences_v1` allow-list + brand model. **Verify:** a personal default
  seeds a new workspace's first piece; brand JSON round-trips.

### Fase X — Extensibility (plug the AI into the user's world)

- **X1 — Make the MCP command real + free integration types.** Wire `IntegrationTool.mcp.command` into the
  container `.mcp.json` builder (today `renderStage` builds it ONLY from skill keys — the user's MCP command is
  inert) with credential injection + `ro/rw` tier enforcement; allow a **free-text integration type** (the model
  already permits "custom"; the UI dropdown doesn't). **Seam:** `renderStage` `.mcp.json` + `IntegrationTool`.
  **Verify:** an enabled integration tool mounts an MCP server the agent can call (fixture asserts the generated
  `.mcp.json`); tier enforced.
- **X2 — Webhooks in + out.** An **outbound** HTTP-POST automation action (`ActionExecutor` today has only
  notify/emit-signal/start-stage/invoke-agent-role) + a **user-configurable inbound** generic webhook (beyond
  the operator-secret forge-issue path) → fires a `WorkspaceTrigger`. **Seam:** `ActionExecutor` +
  `WorkspaceTrigger` + the HTTP webhook seam. **Verify:** an event POSTs to a user URL (fixture); an inbound
  webhook fires a trigger (signed, tenant-scoped).
- **X3 — Public API + personal access tokens.** A token-gated REST surface over the control-API so a user can
  drive the workspace externally (create ticket/piece, trigger a generation, read status). Scoped PATs, per
  workspace, revocable. **Seam:** the control-API + a new token model + a thin REST adapter (respects RBAC +
  single-writer). **Verify:** a PAT drives a create-op end-to-end (test); scope + revocation enforced.
- **X4 — Custom providers/endpoints (bring-your-own model / destination).** A base-URL/endpoint field per
  provider (own model endpoint) + a publish-destination registry (own destination) — today AI providers are a
  closed union, media a fixed 4, publish a fixed 2. Respect the PTY invariant (coding agent stays `claude`).
  **Seam:** provider config + `workspaceKeys` + a destination registry. **Verify:** a custom endpoint is used for
  a non-coding provider (fixture); a custom publish destination records/posts.

### Fase E — The editors + user-defined AI tasks (the big creative surface)

- **E1 — Image region-edit (the headline: circle a spot → "change the colour / make it bigger").** A **canvas
  editor** (Konva or a plain `<canvas>` mask layer — pick per the CODE_EDITOR pattern of a framework-native
  component) to draw/circle a region → produce a mask; a new **`inpaint` MediaFeature** with a `maskUrl` field →
  fal flux-inpaint model, instruction + masked region → a new asset version (Fase I2 chaining). **Seam:** new
  MediaFeature + mask plumbing in `MediaGenerationRequest`/`fal.ts` + K1 upload + the canvas component.
  **Verify:** a mask + instruction produces a region-edited asset (fixture asserts mask + prompt reach the
  provider); the canvas exports a valid mask.
- **E2 — Image editor essentials.** Around E1: crop, resize/scale, simple adjustments (brightness/contrast),
  and in-canvas variation compare. Non-destructive (versions via I2). **Seam:** the canvas component + a
  light server-side transform (sharp/ffmpeg) or client canvas export. **Verify:** a crop/resize yields a new
  version; original preserved.
- **E3 — Video timeline editor.** Real timeline UI: scene **tracks**, drag-reorder, **trim in/out**, per-scene
  duration, transitions, and per-scene regenerate; back it with new `Beat` fields (`trimInMs`/`trimOutMs`/
  `transition`, + a per-beat **video-clip** asset, today beats are stills) and a richer ffmpeg plan
  (`filter_complex`/`xfade`/**`amix`** to mix voice+music+sfx, today only one voice track). Stitch scenes into
  longer videos. **Seam:** `Beat` schema + `assembly.ts`/`render.ts` + a timeline component (mirror the
  container-heavy editor pattern where needed). **Verify:** a reordered/trimmed timeline renders the expected
  ffmpeg plan (fixture); music+voice mix present; a multi-scene stitch works on dummy assets.
- **E4 — Audio editor.** A **waveform** view + trim + a simple mix (voice + music + sfx with ducking), emitting a
  mixed track the render consumes. **Seam:** a waveform component (Web Audio) + an `amix`/`afade` ffmpeg path.
  **Verify:** a trimmed + mixed track is produced (fixture); the render uses it.
- **E5 — User-defined custom AI tasks (break the "can't invent a task" ceiling — within the invariants).** A
  generic **`custom-generate`** feature: the user authors a named, re-runnable prompt-template (with variables)
  that runs through the existing provider abstraction and stays *propose/generate* (never a new write verb, never
  a direct writer — respects single-writer + frozen-verbs). Surfaced as a "My AI tasks" library + a run button +
  schedulable via the existing trigger engine. **Seam:** one new generic `AiFeature` + a task-template store +
  the trigger engine. **Verify:** a user-authored task runs + produces output; it cannot write authoritative
  state directly; re-runnable + schedulable.

### Fase S — Safety net + premium-UX polish (cross-cutting, last)

- **S1 — Dry-run / cheap preview.** A user-facing "preview (fast, low-cost)" toggle mapping to a per-request
  cheap mode (today `WS_MEDIA_CHEAP` is an operator env only), so a user can rehearse a generation cheaply before
  the full-quality run. **Seam:** per-request cheap flag → `fal.ts` cheap params. **Verify:** preview uses the
  cheap model/params + a lower cost; full run unaffected.
- **S2 — Undo / unpublish.** An `unpublish` op + soft-undo on archive + a global "undo" toast for reversible
  ops (publish is one-way today; spend is monotonic — refunds out of scope, flag it). **Seam:** publish flow +
  content ops. **Verify:** unpublish removes/retracts the post (fixture); archive undo restores.
- **S3 — Guided / natural-language setup.** A first-run wizard + let the Assistant configure providers/budget/
  styles/brand from NL (today config is forms-only; chat is board-only). Stays propose→accept→Conductor.
  **Verify:** the wizard connects a key + budget; the Assistant proposes a valid settings op.
- **S4 — Premium-UX pass across every new surface.** A dedicated sweep applying §0b to all Fase Q–E screens:
  motion (`PageTransition`/`Reveal`/tactile press), empty-states + tooltips, **phone-first** for the approval/
  answer/notification surfaces, a11y (keyboard/focus/labels), consistency (shared primitives + theme tokens),
  and reduced-motion safety. **Verify:** each new screen clears the §0b checklist; `ai:lint` (untranslated JSX /
  arbitrary colors) green; a mobile pass on the approval surfaces.

---

## 3. Open questions (decide before / during the run — sensible defaults noted)
- **OV-1 (canvas lib):** Konva vs plain `<canvas>` for E1/E2. *Default:* start with a plain `<canvas>` mask
  layer (no new heavy dep, matches the "framework-native component" half of the editor pattern); adopt Konva
  only if layer/transform needs demand it. Flag before adding a dependency.
- **OV-2 (inpaint model):** which fal inpaint endpoint for E1. *Default:* the current flux family's inpaint
  variant via an env-overridable `FAL_MODEL_INPAINT`; confirm the exact id when wiring (needs the fal docs page).
- **OV-3 (video-per-beat clips, E3):** turning beats from stills into real sub-clips is a large lift. *Default:*
  phase E3 as (a) reorder/trim/transition/mix on the existing stills-slideshow first, then (b) per-beat video
  clips as a follow-up item — keep each shippable.
- **OV-4 (public API surface, X3):** REST vs a thin RPC over the existing socket control-plane. *Default:* a
  minimal token-gated REST adapter that reuses the control-API ops + RBAC (no new write path); scope tight.
- **OV-5 (push infra, A1):** self-hosted VAPID keys via env (`WS_VAPID_*`). *Default:* env-provisioned VAPID
  keypair; the installer/setup guide documents generating them. A RED here escalates to the user.
- **OV-6 (live e2e):** as prior rounds — full live media/push/publish e2e stays **user-triggered** with keys;
  this run proves each item with fixtures + stub-green.

## 4. Grounding
The two 2026-07-07 gap-analysis waves (10 audits) + the media-editor assessment. Related in-repo specs to honour
while building: `CLIENT_AND_PUSH.md` (A1–A3), `TRUST_SAFETY_UX.md` (A4–A5 autonomy), `MULTI_PROVIDER_SEAM.md`
(P1–P2), `03_AUTOMATION_AND_PLUGINS.md` (X1–X2), `ARCHITECTURE_HTTP` (K1 upload + X2 webhooks), `CODE_EDITOR.md`
(the editor-integration pattern E1–E4). Codes resolve via `REFERENCE_CODES.md`.
