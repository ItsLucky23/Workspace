# DEPTH PROGRAM — the `/goal` build spec (real depth + hardening)

> **Status:** LOCKED & EXECUTION-READY (2026-07-07). Source of truth for the autonomous `/goal` run that
> turns the hollow content skeleton into a REAL, usable product + hardens the platform. Grounding: `GAP_ANALYSIS.md`.
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
