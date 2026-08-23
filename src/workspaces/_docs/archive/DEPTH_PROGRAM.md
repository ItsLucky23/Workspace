# DEPTH PROGRAM — the `/goal` build spec (real depth + hardening)

> **Status:** ✅ COMPLETE (2026-07-06). All 16 items H1→D1 built, tested, committed on `main` (not pushed),
> ADRs 0073–0088. Per-item summary at the bottom. The content platform now has a real live-code path behind
> every `available()` gate (stub = pure no-key fallback) + a reachable, rich UI + a key-setup guide; adding
> keys + budget makes it produce + post real content. The complete LIVE e2e is the user-triggered post-keys
> acceptance step. Grounding: `GAP_ANALYSIS.md`.
> Precedence: this doc → `GAP_ANALYSIS.md` → `CLAUDE.md` → the nine Workspaces invariants. A real conflict
> with no resolution = a flag to the user, never a silent pick.

## 0. How this run works (read first)
- **Waterfall per item:** schema → engine → client → verify (test) → ADR → branch-log → commit. Fully green + committed before the next.
- **The core intent (user-clarified):** write the REAL live code behind each `available()` gate. The stub is
  now PURELY the no-key fallback (so the pipeline still runs on dummy data + tests pass without keys). "Adding
  the keys later must make it ACTUALLY work" — no `notImplemented` left in a live path.
- **Testing WITHOUT keys (still no keys this round):** hardening + code-side fixes get REAL integration tests
  (Mongo/git/fixtures — no keys). Real gen/render/publish code is tested with **fixtures/structure** (mock the
  HTTP response / assert the request + command shape / the OAuth flow), NOT live calls; the stub-fallback keeps
  the pipeline e2e green on dummy data. **The complete LIVE e2e is DEFERRED — user-triggered once keys + budget
  are in place (NOT in this run).** Never block on a key.
- **Gates per item, all green before commit:** `npm run prisma:db:push` (backend DOWN first — kill node procs
  vs EPERM), `npm run generateArtifacts`, `npm run lint`, `npm run build`, `npm run ai:lint`, then the test
  (`node scripts/runWsTests.mjs <filter>`).
- **Commit per item:** author `ItsLucky23`, NO Claude co-author, do NOT push, on `main`. `git status` before;
  stage ONLY your files. Another AI may be active — NEVER touch `scripts/prismaWithSecrets.ts`, `caddyRoutes.ts`,
  `editor*/page.tsx`. `.env.local` may be read.
- **Per item:** an ADR (`docs/decisions/NNNN`, then `ai:decisions`), a `branch-logs/main.md` entry + `INDEX.md`
  row, refresh the `workspaces-content-platform-pivot` memory.
- **All framework rules + the nine invariants apply** (file routing, function-injection, NO `as any`/`as unknown as T`,
  `tryCatch`, i18n ×4 en/nl/de/fr, Tailwind theme tokens only, surgical, B-23 single-writer, `runInTenant`,
  no new verbs — reuse the frozen surface, media = non-coding so other providers OK). **Reply in Dutch.**
- **Minimize human-input:** don't stop to ask; an ambiguous fork with no answer here → sensible default, log an
  `OPEN VRAAG`, continue.

## 1. Execution order
H1 → H2 → C1 → C2 → C3 → C4 → M1 → M2 → M3 → M4 → M5 → U1 → U2 → U3 → U4 → D1.

## 2. The items

### Fase H — Platform hardening (FIRST — fundament)
- **H1 — Tenant isolation can never leak.** Fold every `workspaceId` model (all content models + Service/
  Forge/Environment/CI/Deploy) into the `tenantDb` loud-fail guarantee (add to `TENANT_MODELS`), OR add an
  `ai:lint` rule that forbids a plain-`prisma` read/write on a `workspaceId` model. Fix the unscoped
  `environment.findMany({status:'live'})` (scope it, or make it an explicit cross-tenant boot-sweep). **Verify:**
  a query missing the `workspaceId` filter throws / can't cross tenants (test); the content-model reads still work.
- **H2 — Hard-force `WORKSPACES_ENC_KEY`.** Remove the `plain:<base64>` fail-OPEN fallback in `secretBox`; boot
  fails loudly (or the encrypt/decrypt throws) when the key is unset. **Verify:** `secretBox` throws without the
  key; never emits `plain:`; a set key round-trips.

### Fase C — Code-side edge fixes
- **C1 — MR merge/rollback push to origin.** Call `pushBranch` after `mergeBranches`/`revertMergeCommit` so the
  forge ref actually receives the result; add push retry/backoff. **Verify:** real-git test the pushed ref advances.
- **C2 — Readiness, not fire-and-forget.** Wire `health.waitForContainerReady` into the preview/editor/deploy
  serve-command paths; return only after the port is bound (or a typed timeout). **Verify.**
- **C3 — Retry/backoff + pagination.** Add bounded retry/backoff to git push + forge API calls; paginate forge
  issue sync (no silent >100 drop). **Verify** (fixtures).
- **C4 — Real CI YAML + PTY readiness.** Replace the mini-subset YAML parser with a real parse (a dep-free fuller
  parser or a vetted lib) so a real `.gitlab-ci.yml` is honoured; replace hardcoded PTY `wait()`s with prompt-ready
  detection. **Verify** (YAML fixtures + a PTY-ready unit).

### Fase M — Content: REAL generation code (behind `available()`; stub = no-key fallback)
- **M1 — Real image/video/3d gen.** Write the live `generate()` for the Fal (and/or Replicate) gateway —
  image-gen/video-gen/model-3d/reference-image: real HTTP request (auth, model, style+extra → asset url +
  real cost). Keep `available()` gating the stub. **Verify:** fixture test (mock the HTTP → a real ContentAsset;
  request carries prompt/style/reference); stub-fallback pipeline still green.
- **M2 — Real voice/sfx/music gen.** Live ElevenLabs `generate()` (tts/sfx) + a real music provider (Suno).
  **Verify:** fixture test.
- **M3 — Real LLM parsing.** Make `script.parseLiveScript` structured (real beats from a live response) +
  `referenceVideo` parse a real blueprint from the live model (not the canned stub). **Verify:** fixture test.
- **M4 — Real render pipeline (ffmpeg, via Docker).** Assemble beats+images+voice into a REAL `.mp4` via ffmpeg
  (prefer a Docker `ffmpeg` container, consistent with the Docker-dependency decision); the RenderJob produces a
  real file + a real streaming download route. **Verify:** with dummy assets, a real ffmpeg run yields a real file
  (or a typed "ffmpeg-unavailable" degrade); the download route streams it.
- **M5 — Real publishing (OAuth).** Real YouTube + TikTok posting behind `available()`: OAuth (connect flow +
  token storage, encrypted), real upload on accept of the publish suggestion. IG/LinkedIn stay future-ready.
  **Verify:** fixture test (OAuth flow + upload request shape); the B-23 gate still holds (no post before accept).

### Fase U — Content UI (RICH but CLEAR, non-technical-friendly, good setup flows)
- **U1 — Reach + board.** Add a `content` `WsView` + a nav item (in the grouped rail) + a real `content/page.tsx`
  route; a content board/pipeline reading `snapshot.content` (pieces by stage/format, status). **Verify:** build +
  i18n ×4 + theme tokens; the page renders the snapshot content.
- **U2 — Create + assets.** A content-piece detail + asset viewer (image/video/voice preview) + the generation
  controls: pick a feature + a **style-picker** + free-form extra instructions + a reference upload, budget-aware,
  each firing its control-op behind confirm. Clear empty-states + tooltips for first-time non-technical users.
  **Verify:** build; a control-op fires from the UI.
- **U3 — Settings + setup flow.** A provider/key settings FORM (per-workspace provider override + the encrypted
  API keys) + a media **€-budget** UI (cap/alert/spend, from `snapshot.content.mediaBudget`) + a first-run
  **setup flow** that walks a non-technical user through connecting keys (links the KEY_SETUP_GUIDE). **Verify:** build;
  settings persist a provider override + (encrypted) key via a control-op.
- **U4 — Insights + brand.** Surface the content-analytics fold (a per-channel dashboard) + a brand editor (the
  per-channel brand snippets that feed brand-RAG) + expose the style library. **Verify:** build; renders the folds.

### Fase D — Docs + the gated e2e
- **D1 — `docs/KEY_SETUP_GUIDE.md`.** A plain-language guide: how to get each key (Fal/Replicate, ElevenLabs,
  Gemini, YouTube OAuth, TikTok), exactly where to put it (`.env.local` / the settings UI / the secret-manager),
  and **cost expectations + a "careful, this costs real money — set a €-cap first" warning** per provider.
  **Verify:** the guide is complete + linked from the settings setup flow (U3).
- **DEFERRED (user-triggered, NOT this run):** the complete LIVE e2e — boot the server + a real container + a real
  AI/media turn + a real render + a real (sandbox) post — once the user has added keys + budget. Document it as the
  post-keys acceptance step; do NOT run it here.

## 3. Definition of done
Every item committed, lint+build+ai:lint green, each with a passing test (real for H/C; fixture/structure for M;
build for U) + an ADR + a branch-log entry. `DEPTH_PROGRAM.md` marked COMPLETE with a per-item summary in
`INDEX.md`. The content platform is REACHABLE + USABLE from the app (nav → create → generate(stub) → assemble →
download → publish behind the gate), with a real live code path behind every `available()` gate and a key-setup
guide, so adding keys + budget makes it actually produce + post real content. The live e2e is the user-triggered
post-keys acceptance step.

## 4. Completion log (per item — ADRs 0073–0088)
- **H1** (0073) — `tenant-scope` ai:lint guard: unscoped plain-`prisma` on a `workspaceId` model is a finding; `environment.findMany` sweep marked. selftest 22/22.
- **H2** (0074) — fail-closed encryption: `secretBox` throws without `WORKSPACES_ENC_KEY` (no `plain:`), boot-assert; legacy decrypt kept. secretBox 14/14.
- **C1** (0075) — merge/rollback push to origin: `pushRef` (bare-repo push, retry) + `pushMergedTarget`; local-only=skip. mergePush 6/6, retry 8/8.
- **C2** (0076) — readiness probes: `waitForContainerReady` parametrised; preview/editor wait (no fire-and-forget). containerReady 6/6.
- **C3** (0077) — forge pagination + retry: `accumulatePages` (no silent >100 drop) + transient-only retry + `pushBranch` retry. forgePagination 14/14.
- **C4** (0078) — real CI YAML (`parseYamlSubset`, block-seq/top-level jobs) + PTY prompt-ready detection. ciParse 16/16, ptyReady 8/8.
- **M1** (0079) — real Fal.ai gen (image/video/3d/reference): queue submit→poll→fetch, injectable transport. falProvider 19/19.
- **M2** (0080) — real ElevenLabs (voice/sfx→media-store) + Suno music provider; shared `prompt.ts`/`store.ts`. audioProviders 19/19.
- **M3** (0081) — real structured LLM parsing: `jsonParse` + `parseLiveScript`/`parseBlueprint` JSON-first. contentParse 17/17.
- **M4** (0082) — real ffmpeg render (Docker) `buildFfmpegPlan`+`renderTimeline` + `/media` stream route. render 18/18.
- **M5** (0083) — real YouTube+TikTok OAuth + upload (pure builders, encrypted token in EnvVar), B-23. publishOAuth 17/17, publishReal 12/12.
- **U1** (0084) — content nav + `content/page.tsx` board reading `snapshot.content`; i18n×4.
- **U2** (0085) — piece detail + generation controls firing `contentControl` ops behind confirm.
- **U3** (0086) — settings: `save-media-provider` (encrypted key) + €-budget form + setup flow. contentSettings 8/8.
- **U4** (0087) — insights dashboard + style library + brand editor (`content-edit-brand` + snapshot folds). contentInsights 10/10.
- **D1** (0088) — `docs/KEY_SETUP_GUIDE.md` + program close-out.

**Deferred (user-triggered):** the complete LIVE e2e once keys + budget are in place (boot with keys → real container + real AI/media turn → real render → real sandbox post).
