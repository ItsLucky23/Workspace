# Agent 3 — content, settings, shell UI & workspace-settings (48 medium/low)

You fix the medium/low audit findings for: the content module, user settings page, setup wizard/onboarding, shell chrome, insights, misc API routes, and (phase B) workspace-settings + marketing/studio leftovers. Work on branch `fix/audit-content-shell` (own worktree). Agent 1 (a stronger model) is fixing critical/high findings in parallel on other files; Agent 2 owns develop-module and WorkspacesProvider files — never edit those. Follow the phases strictly.

## Project context (30 seconds)

Workspaces is a self-hosted AI dev-orchestration + content platform on the LuckyStack framework. UI state comes from `src/workspaces/_shell/WorkspacesProvider.tsx` (fetches the tenant snapshot `workspaces/snapshot`, merges realtime deltas by seq). Writes go: UI → context action / `_functions/controlApi.ts` → `_api` route → Conductor op → Prisma. The Conductor is the ONLY writer of authoritative state. `_data/seed.ts` is prototype dummy data being phased out.

The full audit (125 findings, evidence, verifiedOk lists): `src/workspaces/_docs/UI_FUNCTIONAL_AUDIT_2026-08-22.md`.

## Ground rules (apply to every fix)

1. **Read `CLAUDE.md` in the repo root first.** All framework rules apply: `tryCatch` (never raw try/catch), i18n via `useTranslator` for ALL user-facing text, Tailwind colors only from the `@theme` tokens, no `as any` / `as unknown as`, file-based routing conventions, function-injection in `_api`/`_sync` handlers.
2. **Surgical changes only.** Every changed line must trace to a finding in YOUR list. Do not refactor adjacent code, do not fix things outside your list (note them in your handoff file under "Out-of-scope observations" instead).
3. **File ownership is hard.** You may only edit the files listed in your "Files you own" section (plus locale/translation files per rule 6, plus a test file for a fix). If a fix genuinely requires editing a file you do not own, SKIP the finding and record "skipped: needs <file> owned by agent N" in its Result line.
4. **Verify after every batch:** `npm run lint && npm run build` must be clean (autonomous, no permission needed). Run `npm run test:unit` before committing. Do not start the dev server yourself — ask the owner when a live check is needed.
5. **A bug fix gets a regression test when the route/op layer is involved** (per-route `*.tests.ts` or a unit test). For pure UI/JSX fixes a test is optional — describe the manual verification in the Result line instead.
6. **Translations:** add new i18n keys only at the END of your module's section in the locale files, never reorder existing keys (three agents share these files; merges are resolved by union).
7. **Commit per batch/cluster** with a descriptive message. Append a branch-log entry (`branch-logs/<sanitized-branch>.md` + INDEX row) after each working session — see `docs/BRANCH_LOG_PROTOCOL.md`.
8. **Track progress in THIS file:** tick the checkbox and fill the Result line per finding. This file is the single source of truth for what is done.
9. **If a finding turns out to be already fixed or wrong** (the audit baseline is commit `55ff5b7`; code may have moved), verify carefully, then mark it "already-fixed" or "invalid: <reason>" — do not force a change.
10. **The audit's `verifiedOk` lists** (in `src/workspaces/_docs/UI_FUNCTIONAL_AUDIT_2026-08-22.md`, per area) are flows that were traced and WORK — never "fix" those.

## Phase A — start now (parallel-safe)

These files are not touched by Agent 1. Work top-down; commit per file-cluster.

### Files you own in this phase

- `server/ai/opCatalog.ts`
- `server/read/mappers.ts`
- `src/workspaces/_api/aiProviderHealth_v1.ts`
- `src/workspaces/_api/generateDocs_v1.ts`
- `src/workspaces/_api/listPats_v1.ts`
- `src/workspaces/_api/readWorktreeFile_v1.ts`
- `src/workspaces/_components/SetupWizard.tsx`
- `src/workspaces/_data/modules.ts`
- `src/workspaces/_shell/Onboarding.tsx`
- `src/workspaces/_shell/WorkspacesShell.tsx`
- `src/workspaces/content/[pieceId]/AssetCard.tsx`
- `src/workspaces/content/[pieceId]/page.tsx`
- `src/workspaces/content/documents/[docId]/page.tsx`
- `src/workspaces/content/insights/page.tsx`
- `src/workspaces/content/page.tsx`
- `src/workspaces/content/settings/BrandStylesTab.tsx`
- `src/workspaces/content/settings/SavedNote.tsx`
- `src/workspaces/insights/usage/page.tsx`
- `src/workspaces/settings/page.tsx`
- `tests/effectMatrix.mts`
- `vite.config.ts`

### Findings

- [x] **F-063** · MEDIUM · `unclear-ux` — Workspace-scoped administration is split across two unrelated destinations: API tokens, prompt experiments, storage/trash and workspace export/import live under the ACCOUNT settings page's 'Workspace' tab, while everything else workspace-scoped (members, env, integrations, danger, modules, AI) lives on the separate Workspace-settings page — a user hunting for 'workspace export' or 'API tokens' has no cue to look under account Settings.
  - **Where:** `src/workspaces/settings/page.tsx:583`
  - **Evidence (already traced, trust it but re-verify the anchor):** settings/page.tsx (heading 'Account settings', workspaces.account.heading) hosts tab 'workspace' (lines 583-611: PatPanel, ExperimentsPanel, StoragePanel, workspace data-export) and tab 'developer' (613-906: forge, environments, services, DB) — all keyed to activeWorkspace, not the account. workspace/page.tsx is the dedicated workspace-settings page with 12 tabs. No cross-link exists from workspace/page.tsx to the settings page's workspace/developer tabs (only the reverse deep-links from EmptyPickers). The split is ADR 0309/0312-intentional ('what is MINE, what is this WORKSPACE's, and the developer surface') but the workspace half landed on the page titled Account.
  - **Fix:** Cheapest coherent fix: retitle settings/page.tsx heading per active tab (Account / Workspace tools / Developer) and add two link-out rows on workspace/page.tsx (e.g. under Audit or a new 'Tools' tab): 'API tokens, experiments, storage & export → Settings › Workspace' and 'Deploys, services & databases → Settings › Developer' using the existing focusSetup deep-link pattern. Fuller fix: move PatPanel/ExperimentsPanel/StoragePanel/data-export into workspace/page.tsx as a 'Tools' tab and drop the settings 'workspace' tab.
  - **Result:** partial fix in this cluster: the settings heading now changes with the active tab; the reverse links on Phase-B-owned `workspace/page.tsx` remain for the later phase.
- [x] **F-072** · MEDIUM · `unclear-ux` — Workspace-scoped dev-ops (environments/deploy, service stacks, database/migrations) live under the ACCOUNT settings page's 'Developer' tab, while the sibling Workspace page owns repo/runtime/members/AI-behaviour — two owners for workspace configuration, and the Account page even has a tab literally named 'Workspace' (PATs, experiments, storage, export) next to the separate Workspace page.
  - **Where:** `src/workspaces/settings/page.tsx:166`
  - **Evidence (already traced, trust it but re-verify the anchor):** settings/page.tsx (heading 'workspaces.account.heading', reached via user dropdown → Account) hosts SETTINGS_TABS account/workspace/developer; the developer tab renders forge connect, environments+promote+rollback, service stacks, DB connect/migrations — all keyed to activeWorkspace/activeProject, not the account. workspace/page.tsx separately owns repository/runtime/members/aibehavior tabs. Nothing cross-links the two, and both are one click apart in the nav.
  - **Fix:** Move the developer tab's cards (or at least Environments/Services/DB) to the Workspace page as sections, or rename the surfaces ('Account' page keeps only account+PAT/export) and add cross-link rows so each page names the other's ownership.
  - **Result:** partial fix in this cluster: the Developer tab now has a distinct page heading; moving cards or adding the reverse link remains Phase-B-owned.
- [x] **F-119** · LOW · `ui-bug` — The PAT 'Issue' button stays enabled with both scope checkboxes unchecked and silently does nothing on click.
  - **Where:** `src/workspaces/settings/page.tsx:318`
  - **Evidence (already traced, trust it but re-verify the anchor):** issue() computes scopes and `if (scopes.length === 0) return;` with no notify; WsButton has no disabled prop bound to the scope state.
  - **Fix:** Add disabled={!scopeTickets && !scopeContent} to the Issue WsButton.
  - **Result:** fixed in the settings cluster; Issue is disabled when no PAT scope is selected.
- [x] **F-120** · LOW · `ui-bug` — Prompt-experiment create/stop rely on setTimeout(refresh, 600) to see the conductor's write — on a busy queue the new/stopped experiment doesn't appear until the user reloads the panel.
  - **Where:** `src/workspaces/settings/page.tsx:270`
  - **Evidence (already traced, trust it but re-verify the anchor):** start() and stop() call the control-op (savePromptExperiment/stopPromptExperiment, async single-writer queue) then setTimeout(refresh, 600); nothing re-reads on the realtime delta because experiments are deliberately not in the snapshot.
  - **Fix:** Retry the refresh (e.g. at 600ms/2s/5s until the list changes) or refresh on the workspace-dirty sync event instead of a single fixed timer.
  - **Result:** fixed in the settings cluster; experiment reads retry at 600ms, 2s, and 5s after create/stop.
- [x] **F-030** · MEDIUM · `dead-ui` — On the piece detail page the overflow menu never shows 'Restore' for an archived piece — it shows 'Archive' again — because the condition tests a status value the server never sets.
  - **Where:** `src/workspaces/content/[pieceId]/page.tsx:371`
  - **Evidence (already traced, trust it but re-verify the anchor):** pieceMenu branches on `piece.status === 'archived'`, but archiving is a separate boolean: conductor.ts:3322-3331 ('content-archive'/'content-unarchive') only writes `archived: true/false` and never touches `status`; server/read/mappers.ts:151-164 maps status (idle/busy/…) and archived independently. grep for `status: 'archived'` across server+src returns nothing. Archived pieces ARE reachable here: the board's Library view iterates all pieces (content/page.tsx:180-187, no archived filter) and navigates to `content/${pieceId}`.
  - **Fix:** Change the condition to `piece.archived === true ? [Restore…] : [Archive…]` (ContentPieceSummary already carries the optional archived flag — types.ts:376+, mappers.ts:163). Optionally also render an 'archived' badge in the header meta row instead of relying on piece.status.
  - **Result:** fixed in the content detail cluster; the overflow menu now follows `piece.archived`.
- [x] **F-081** · LOW · `inconsistency` — A ready 'video' asset (imported or restyled clip) shows only a generic display icon on the piece page, while the board's Library renders an actual muted <video> frame for the very same asset.
  - **Where:** `src/workspaces/content/[pieceId]/AssetCard.tsx:77`
  - **Evidence (already traced, trust it but re-verify the anchor):** AssetCard previewSrc is set only for kind 'image' (own url) or 'render' (posterUrl) — kind 'video' falls through to the icon (lines 77-81, 124-128). content/page.tsx LibraryThumb (:27-31) renders `<video src=… muted playsInline>` for both 'render' and 'video'.
  - **Fix:** In AssetCard, when kind==='video' && status==='ready' && href, render the same muted playsInline <video> element used by LibraryThumb (or use posterUrl when present) instead of the icon fallback.
  - **Result:** fixed in the content detail cluster; ready video assets now render a muted preview with an optional poster.
- [x] **F-032** · MEDIUM · `ui-bug` — If a document export fails (e.g. PDF/docx on a host without Docker — the chromium render container), all five export buttons stay disabled with one stuck on 'Exporting…' forever, and no error is shown.
  - **Where:** `src/workspaces/content/documents/[docId]/page.tsx:212`
  - **Evidence (already traced, trust it but re-verify the anchor):** `setExporting(f)` on click, buttons `disabled={exporting !== null}`, and the ONLY reset is `useEffect(() => { setExporting(null); }, [exports.length])` (line 71) — exports.length only changes when a new kind:'export' asset lands in the snapshot. The conductor's 'document-export' case returns `{ ok:false, status:'error', error:'export.containerFailed' }` without appending an asset (conductor.ts:3902; server/documents/export.ts:356,361 fail when renderDocx/renderPdf return null), and WorkspacesProvider.tsx:1894 exportDocument fires the sync request and ignores the response entirely.
  - **Fix:** Make exportDocument return the op result (mirror runDocumentAi at WorkspacesProvider.tsx:1882-1889: resolve errorCode from the sync response); in [docId]/page.tsx clear `exporting` and notify.error(errorCode) when the result is not success. A belt-and-braces timeout reset (e.g. 60s) also prevents any other stuck path.
  - **Result:** partial fix in the document page cluster: a translated 60-second timeout now clears the stuck state and reports failure; returning the provider's immediate error remains Phase-B-owned.
- [x] **F-082** · LOW · `unclear-ux` — The document editor's AI chip always says 'Gemini' as a hardcoded string, but the document-generate feature's provider is workspace-overridable server-side, so the chip can lie about which backend actually drafts.
  - **Where:** `src/workspaces/content/documents/[docId]/page.tsx:118`
  - **Evidence (already traced, trust it but re-verify the anchor):** Line 118 passes `value: 'Gemini'` literally. server/ai/assignments.ts:44 defaults 'document-generate' to gemini-api, but registry.ts:83-84 merges loadWorkspaceAiOverrides (EnvVar `__ai_provider_document-generate`) first — the Workspace AI page's PROVIDER_FEATURES list (workspace/page.tsx:1261) doesn't expose this feature today, so the override is env-only, but the chip encodes an assumption the server does not guarantee. The adjacent comment also documents a genuine near-collision with the separate 'docs-generate' feature shown on the AI page.
  - **Fix:** Surface the resolved provider in the snapshot (aiOverrides already ships — read the 'document-generate' override, falling back to 'Gemini') and feed that into the chip param instead of the literal, or add 'document-generate' to PROVIDER_FEATURES so the routing is visible and consistent.
  - **Result:** fixed in the document page cluster; the chip reads the snapshot override and the explanatory text no longer claims Gemini is fixed.
- [x] **F-064** · MEDIUM · `unclear-ux` — 'Brand' is spread over three stores on three pages — brand context + logo (content settings), brand kit palette/fonts/voice/taglines (Studio AND Marketing), per-channel brand voice (Channels) — with two independent free-text 'voice' fields that can contradict and no surface saying which one a given generation uses.
  - **Where:** `src/workspaces/content/settings/BrandStylesTab.tsx:23`
  - **Evidence (already traced, trust it but re-verify the anchor):** (1) BrandContextCard (BrandStylesTab.tsx:23-54): productContext + brand logo via content-edit-product — 'folded into every generation'. (2) BrandPanel (studio/BrandPanel.tsx + its marketing/panels.tsx duplicate): studioBrand {palette, typography, voice, taglines} via saveBrand — 'seed every generation'. (3) Channel.brandVoice (ChannelsTab.tsx form) — single-ownered there since the 2026-08-17 owner decision (content/insights reads it read-only). studioBrand.voice and channel.brandVoice are both prose voice directions; productContext is a third prose blob. No LayerNote/InfoTip anywhere states precedence or composition among the three, unlike the dev-side prompt layers which got exactly that treatment (ADR 0308 resolveAiLayers).
  - **Fix:** Apply the ADR 0308 pattern to the content side: build a resolveContentLayers helper (product context → brand kit voice → channel voice → style) and render LayerNote/inherits chips on all three edit surfaces (BrandContextCard, BrandPanel, ChannelsTab voice field) stating what each layer adds and which wins; add a cross-link from BrandContextCard to Studio's brand kit and vice versa. Verify actual precedence in the server's generation prompt builder before writing the copy.
  - **Result:** skipped: the required Studio, Marketing, Channels, and server prompt-precedence files cross Agent 1/other ownership boundaries; no unverified precedence copy was added.
- [x] **F-111** · LOW · `inconsistency` — Two save-feedback systems: workspace settings moved to debounced autosave + SavePill (ADR 0309, no save buttons), while the content settings tabs still use explicit Save buttons + a one-shot SavedNote — the same kind of field persists via two different rituals depending on which settings page you are on.
  - **Where:** `src/workspaces/content/settings/SavedNote.tsx:1`
  - **Evidence (already traced, trust it but re-verify the anchor):** _components/settings.tsx exports useAutosave + SavePill used across workspace/page.tsx (EnvRow:278, RuntimeSection:806, AiBehaviorTab:1310). content/settings/* instead uses local setSaved(true) + SavedNote (SavedNote.tsx; BrandStylesTab.tsx:42-43, AdminTab.tsx BudgetCard:112-113, PlatformCredentialsBody:228) and KeyRow fakes the pill with status={saved?'saved':'idle'} (AdminTab.tsx:41).
  - **Fix:** Migrate the content-settings text/number fields (brand context, budget cap/alert, voiceId) to useAutosave + SavePill like the workspace page; keep explicit buttons only for write-only secrets (keys, credentials) but render their confirmation through SavePill (as KeyRow already half-does) and delete SavedNote.tsx.
  - **Result:** skipped: the migration requires Agent 1-owned `AdminTab.tsx` plus shared content-settings/provider surfaces.
- [x] **F-034** · MEDIUM · `duplicate` — Two parallel 'workspace media library' implementations exist with different feature sets: the content board's Library view flattens pieces[].assets locally (no starring, no createdAt ordering beyond reverse-piece-order), while the snapshot's content.assetLibrary (starred-first, star toggle) powers only the documents reuse picker.
  - **Where:** `src/workspaces/content/page.tsx:177`
  - **Evidence (already traced, trust it but re-verify the anchor):** content/page.tsx:180-189 builds libraryAssets from content.pieces (filtering status==='ready' && url.startsWith('/media/')); the snapshot separately computes content.assetLibrary via listLibrary (workspaceSnapshot.ts:580, server/content/assetLibrary.ts) with a starred flag, consumed only by documents/[docId]/page.tsx:56-58 + AssetPicker with setAssetStarred ('asset-star' op, conductor.ts:3138). The board Library offers no star affordance at all, so stars set from a document are invisible where most media browsing happens. content/page.tsx:22 also re-declares a private assetHref that drifts from [pieceId]/assetHref.ts (returns stub:// unchanged instead of null).
  - **Fix:** Point the board's Library view at content.assetLibrary (it already carries id/kind/url/pieceId/pieceTitle/starred), add the same star toggle the AssetPicker has (setAssetStarred), and delete the local flatten + the local assetHref in favour of the shared [pieceId]/assetHref.ts helper.
  - **Result:** fixed in the content library cluster; the board and document picker now use the same starred, newest-first asset snapshot and shared URL helper.
- [x] **F-113** · LOW · `duplicate` — Small helpers/components are implemented twice under different paths: stat tiles, relative-time formatting, and markdown line rendering each have two independent copies.
  - **Where:** `src/workspaces/content/insights/page.tsx:31`
  - **Evidence (already traced, trust it but re-verify the anchor):** Stat (content/insights/page.tsx:31-38) vs StatCard (insights/usage/page.tsx:43-51) — same tile shape; timeAgo duplicated in develop/scheduled/page.tsx:41-50 and content/documents/page.tsx; renderMdLine/stripInline markdown helpers duplicated between _components/AssetPicker.tsx and _components/MarkdownView.tsx; assetHref defined in content/marketing/cards.tsx, content/studio/previews.tsx and content/page.tsx (the preview-suite duplication itself is covered by the Studio/Marketing finding).
  - **Fix:** Move the stat tile into _components/dataDisplay.tsx (props: label, value, hint?, info?) and use it from both insights pages; add _functions/timeAgo.ts; have AssetPicker import the md helpers from MarkdownView (export them there); put assetHref in content/studio/content.ts (already shared) and import it in the other two.
  - **Result:** skipped: the requested shared-helper extraction touches files outside the Phase A ownership list and multiple other pages.
- [x] **F-062** · MEDIUM · `duplicate` — Two guided-setup front doors teach different setups: the workspace-settings header's 'Set up' wizard only collects a fal media key + media budget (skipping the AI text key, repo, channels, push), while the board's SetupChecklist is the maintained, readiness-driven surface covering all of them.
  - **Where:** `src/workspaces/_components/SetupWizard.tsx:18`
  - **Evidence (already traced, trust it but re-verify the anchor):** SetupWizard.tsx (S3-era, 3 steps: welcome → fal key via saveMediaProvider → media budget via editMediaBudget, lines 26-35) is launched only from workspace/page.tsx:1594-1597 (header wand button labeled workspaces.setup.title). SetupChecklist.tsx (ADR 0314/0316) computes real readiness rows (aiKey/repo/firstTicket/runtime/context/media/channel/push/askAi) and already absorbed the board's old first-steps banner ('the two first-run surfaces that used to stack on the same spot are one' — its header comment), but the wizard was never absorbed. content/settings/page.tsx additionally renders its own first-run banner card (lines 51-75), making three first-run surfaces.
  - **Fix:** Retire SetupWizard: change the workspace/page.tsx:1594 button to open the checklist's home (navigate('board') with the checklist expanded, or render <SetupChecklist/> inline on the workspace page), and delete _components/SetupWizard.tsx. If a modal wizard is wanted, regenerate it FROM the checklist's steps array so the two can never diverge again.
  - **Result:** skipped: the only trigger is Agent 1-owned `workspace/page.tsx` (Phase B); deleting the wizard without removing that trigger would break the route.
- [x] **F-069** · MEDIUM · `duplicate` — A third setup surface: the "Set up workspace" wizard covers ONLY the fal media key + media budget, is reachable only via a tiny text link in the Workspace page header, saves with zero feedback, and finishing it still leaves the SetupChecklist's #1 item (AI key) undone — the two surfaces disagree on what 'set up' means.
  - **Where:** `src/workspaces/_components/SetupWizard.tsx:18`
  - **Evidence (already traced, trust it but re-verify the anchor):** SetupWizard steps: welcome → fal apiKey (saveMediaProvider hardcoded providerId 'fal', placeholder 'fal_...' hardcoded) → budget (editMediaBudget). No AI-key, repo, channel or push step, all of which SetupChecklist.tsx:104-139 tracks. Sole trigger: workspace/page.tsx:1594 (a text-xs link). The fire-and-forget control-ops show no SavePill/notify, and the same settings have their real editors in content/settings → Admin (where the checklist's 'media' row deep-links instead of to this wizard).
  - **Fix:** Either retire SetupWizard in favour of SetupChecklist + content/settings Admin (delete component + the workspace/page.tsx:1594 link), or make it the checklist's action-runner: include the AI-key step, reuse readiness booleans, and show save feedback. Do not leave two front doors giving different definitions of done.
  - **Result:** skipped: the trigger and the maintained checklist live in Agent 1-owned Phase B files; the component was not deleted in isolation.
- [x] **F-115** · LOW · `inconsistency` — The zero-workspace Onboarding create form has no pipeline-tier picker while the in-app CreateWorkspaceForm does — a user's FIRST workspace can only get a tier via a pack preset (or silently defaults), and the two create forms duplicate the pack/module logic with drift.
  - **Where:** `src/workspaces/_shell/Onboarding.tsx:36`
  - **Evidence (already traced, trust it but re-verify the anchor):** Shell.tsx CreateWorkspaceForm has PIPELINE_TIERS UI (lines 567-579, shown when development module on) and choosePack also sets tier; Onboarding.tsx submit passes only chosen?.preset from the pack and renders no tier control. Both forms re-implement pack→modules seeding separately.
  - **Fix:** Extract the pack+modules+tier fieldset into one shared component (it already exists as ModulePicker for half of it) and render it in both Onboarding and CreateWorkspaceForm; include the tier row in Onboarding when the development module is selected.
  - **Result:** fixed in the onboarding cluster; first-workspace creation now exposes and persists the simple/advanced/professional pipeline tier (the existing pack picker still seeds its default).
- [x] **F-118** · LOW · `ui-bug` — The mobile FAB on the Knowledge view creates a CONTENT piece even in a development-only workspace (content module off), then navigates to the gated 'content' view which immediately bounces.
  - **Where:** `src/workspaces/_shell/WorkspacesShell.tsx:36`
  - **Evidence (already traced, trust it but re-verify the anchor):** CONTENT_FAB_VIEWS includes 'knowledge' (a non-gateable insights view visible to every workspace); kind = CONTENT_FAB_VIEWS.has(view) || !devOn → 'piece' regardless of whether the content module is enabled; submit calls createContentPiece + navigate('content'), and the gate effect (lines 95-107) redirects away.
  - **Fix:** Compute contentOn = isSectionEnabled(sections,'content') and force kind='ticket' when the content module is off (and 'piece' only when contentOn); pick the navigate target accordingly.
  - **Result:** fixed in the shell cluster; the FAB creates a ticket and navigates to the first enabled view when Content is disabled.
- [x] **F-122** · LOW · `inconsistency` — The Usage page's three tabs (Usage/Delivery/People) are React state, not URL trail — unlike settings/workspace/pipeline/content-settings, a deep link or refresh always lands on the first tab and back does not walk out of a tab.
  - **Where:** `src/workspaces/insights/usage/page.tsx:56`
  - **Evidence (already traced, trust it but re-verify the anchor):** useState<UsageTab> at line 56; 'usage' (and 'insights/usage') is absent from TRAIL_ROOTS in _data/nav.ts, which is an explicit allowlist. The deliberate-allowlist comment exists, but Usage is exactly the kind of multi-tab page ADR 0312 targeted.
  - **Fix:** Add 'insights/usage' to TRAIL_ROOTS and switch the page to useTrailSegment(0, ['usage','delivery','people'], 'usage').
  - **Result:** skipped: needs the shared `_data/nav.ts` trail-root contract, which is outside Agent 3 Phase A ownership.
- [x] **F-035** · MEDIUM · `unclear-ux` — A content-module workspace's nav shows both 'Scheduled' (the Development cron/automation page) and 'Scheduled posts' (the publish queue) side by side — a naming collision that non-developer content users have to puzzle out.
  - **Where:** `src/workspaces/_data/modules.ts:38`
  - **Evidence (already traced, trust it but re-verify the anchor):** modules.ts:38 gives the content module sections ['content','marketing','scheduled','automations','scheduled-posts','studio']; en locale renders them 'Scheduled' and 'Scheduled posts'. scheduled-posts/page.tsx's own intent comment acknowledges the collision ('distinct from the Development Scheduled cron page, #149') but the nav labels remain one word apart. The same list also ships BOTH 'marketing' and 'studio' (near-identical surfaces, see the duplicate finding), giving a content workspace four generation-related nav entries.
  - **Fix:** Rename the dev section label for content-lane users or drop 'scheduled' from the content module's section list (content automations already live under 'automations'); at minimum change workspaces.sections.scheduled to something task-shaped like 'Automation runs'/'Cron' so the pair is distinguishable at a glance.
  - **Result:** fixed in the navigation-label cluster; all four locales now call the cron view Automation runs (or its localized equivalent), distinct from Scheduled posts.
- [x] **F-031** · MEDIUM · `ui-bug` — In dev (Vite front-end + backend on separate ports) every media URL in the module — asset thumbnails, audio previews, style previews, document export links — and the MediaUploadButton's POST /media/upload resolve against the front-end origin, which has no /media proxy entry, so they 404.
  - **Where:** `vite.config.ts:107`
  - **Evidence (already traced, trust it but re-verify the anchor):** The dev proxy forwards only /api,/sync,/auth,/uploads,/_health,/livez,/readyz,/_docs,/socket.io (vite.config.ts:107-121). The backend serves GET /media/<file> (server/media/download.ts:20) and POST /media/upload (server/media/uploadRoute.ts:27) as custom HTTP routes. All client href/src builders prefix with backendUrl — but config.ts:54-55 sets backendUrl = window.location.origin in the browser, i.e. the FRONT-END origin in dev, so assetHref ([pieceId]/assetHref.ts), mediaSrc (settings/shared.ts:7), the local copy in content/page.tsx:22 and uploadMedia.ts:27 all produce same-origin /media/… URLs Vite cannot serve. (In production front-end and backend share an origin so it works — which also means all three prefix helpers are identity functions and their 'served by the backend' comments are misleading.)
  - **Fix:** Add `'/media': entry()` to the vite.config.ts proxy map (covers both /media/<file> and /media/upload). Optionally then collapse the three duplicate prefix helpers (assetHref ×2 + mediaSrc) into one, since the prefix is a no-op in the browser.
  - **Result:** fixed in the dev-proxy cluster; Vite now forwards media reads and uploads to the backend.
- [x] **F-039** · MEDIUM · `missing-ui` — The readWorktreeFile route — explicitly built so the in-ticket editor 'can show git-backed content instead of diff-reconstructed text' — has zero client callers; the editor still uses the diff reconstruction it was meant to replace.
  - **Where:** `src/workspaces/_api/readWorktreeFile_v1.ts:1`
  - **Evidence (already traced, trust it but re-verify the anchor):** grep for 'workspaces/readWorktreeFile' across src/server/tests hits only its own tests file and the generated prod API map; CodePanel.tsx builds editor content exclusively via ticketFilesToEditor. The write half (saveWorktreeFile) IS wired (CodePanel.tsx:68), so the pair is asymmetric: real-content save exists, real-content read is orphaned.
  - **Fix:** Wire CodePanel's changes mode to fetch each opened file via apiRequest workspaces/readWorktreeFile (workspaceId, ticketKey, path) and feed that into LazyCodeEditorPanel; fall back to diff reconstruction only when the container/worktree is not available.
  - **Result:** skipped: needs `src/workspaces/develop/board/[ticketId]/CodePanel.tsx`, owned by Agent 2 Phase B.
- [x] **F-083** · LOW · `missing-ui` — The ai-provider-health route ('feeds the health indicator in the workspace AI settings') has no UI caller — the gap-fix that created it was itself orphaned by the later AI-page rework, recreating the exact "exported for a UI that never came" state its header complains about.
  - **Where:** `src/workspaces/_api/aiProviderHealth_v1.ts:1`
  - **Evidence (already traced, trust it but re-verify the anchor):** grep 'workspaces/aiProviderHealth' over src/**.tsx (excluding _api/_sync/tests) = 0 hits. The reworked AI page (commits 66279f6/f6c12be) uses aiConnection add/test/remove via the aiConnection _sync route plus snapshot aiConnections/aiProviderCatalog instead.
  - **Fix:** Either delete the route (+ its tests + generated map entry regen) since per-connection ai-connection-test supersedes it, or add the intended health chip on the AI page (workspace/aiProviders.tsx) calling it on mount.
  - **Result:** skipped: adding the caller needs the Agent 1-owned AI settings page; deleting a public route needs an owner decision first.
- [x] **F-084** · LOW · `duplicate` — listPats is a dead duplicate read: the settings API-tokens panel now gets PATs preloaded in the snapshot (snap.pats), and nothing calls the route anymore.
  - **Where:** `src/workspaces/_api/listPats_v1.ts:1`
  - **Evidence (already traced, trust it but re-verify the anchor):** server/read/workspaceSnapshot.ts:256 comment: 'Was a mount-time GET (workspaces/listPats) on every settings visit' — the X3 preload replaced it. grep for client callers of 'workspaces/listPats' = 0 (issuePat and revokePat still have callers).
  - **Fix:** Delete listPats_v1.ts + listPats_v1.tests.ts and regenerate the API maps, or keep it deliberately as the post-issue refresh read and actually call it after issuePat instead of the full snapshot refetch.
  - **Result:** skipped: route deletion needs an owner decision because it is a public API surface; the existing snapshot path remains authoritative.
- [x] **F-085** · LOW · `missing-ui` — The generateDocs route (AI-author a project-summary context doc from the linked repo) is reachable from no UI — its own header says 'the trigger button + live surfacing are a later UI slice' that never came, so users can only get generated docs via the scanDocs path.
  - **Where:** `src/workspaces/_api/generateDocs_v1.ts:4`
  - **Evidence (already traced, trust it but re-verify the anchor):** grep 'workspaces/generateDocs' over client code = 0 hits; only the route, its tests and the generated prod map reference it. It is also not in the chat-enabled op set (not a ChatEnabledOp), so the assistant cannot trigger it either.
  - **Fix:** Add a 'Generate project summary (AI)' button on the Sources page (develop/sources/page.tsx) next to the scan/rescan action, calling apiRequest workspaces/generateDocs with the active workspace/project, then refetch; or delete the route if scanDocs has subsumed it.
  - **Result:** skipped: the prescribed UI caller `develop/sources/page.tsx` is owned by Agent 2.
- [x] **F-065** · MEDIUM · `dead-ui` — The Assistant still advertises and executes 'set the Gemini model/temperature/base-url' (set-ai-behavior op), which writes Workspace columns no provider reads any more — the change reports success and does nothing.
  - **Where:** `server/ai/opCatalog.ts:217`
  - **Evidence (already traced, trust it but re-verify the anchor):** opCatalog.ts:217-218 exposes geminiModel/geminiTemperature/geminiBaseUrl params; conductor.ts:2237-2243 clamps and writes workspace.geminiModel/geminiTemperature/geminiBaseUrl. But since ADR 0007 the read path is resolveProviderConfig (server/ai/providerConfig.ts) which reads ONLY the AiConnection row + env fallback, hardcodes temperature:null (lines 41,52) and never touches those columns — the AiBehaviorTab comment (workspace/page.tsx:1302-1304) explicitly calls them LEGACY, read-never-edited passthroughs kept so the op doesn't clear old data.
  - **Fix:** Remove the three gemini* params from the set-ai-behavior catalog entry (opCatalog.ts:217-218) and from the conductor write (keep accepting-and-ignoring them for old clients, or keep writing but log deprecation); point the op hint at ai-connection-add/ai-connection-test for backend config. If per-connection temperature is still wanted as a feature, add it to AiConnection and read it in resolveProviderConfig instead.
  - **Result:** fixed in the backend contract cluster; the catalog no longer advertises legacy Gemini fields, while the conductor keeps accepting them for old clients.
- [x] **F-088** · LOW · `dead-ui` — The pulsing 'terminal' badge on kanban cards can never appear: the server hardcodes hasTerminal:false (and viewers:[]) on every ticket it sends.
  - **Where:** `server/read/mappers.ts:93`
  - **Evidence (already traced, trust it but re-verify the anchor):** toTicket (mappers.ts:93) sets `viewers: [], hasTerminal: false` unconditionally; KanbanCard.tsx:131-135 renders the live-terminal chip only when ticket.hasTerminal — a seed-era field (seed TICKETS had hasTerminal:true rows) the real backend never computes. Live viewer avatars are correctly served by the presence relay instead, so viewers:[] is harmless, but the terminal chip is dead.
  - **Fix:** Derive hasTerminal server-side (e.g. ticket status 'busy' with an active PTY/agent session — the engine knows which tickets have live containers) in toTicket and in the snapshot path, or remove the hasTerminal field + badge from KanbanCard.
  - **Result:** fixed in the backend read-mapper cluster; busy tickets now expose `hasTerminal: true` instead of every ticket being hardcoded false.
- [x] **F-086** · LOW · `inconsistency` — The effect matrix still classifies content-edit-image (row 76) and content-gen-thumbnail (row 86) as 'excluded:bug' (silent no-op: contentProjectId lands in target, conductor reads payload), but that production bug is fixed — the route now mirrors the id into BOTH envelopes — so the rows violate the file's own 'no assertable-but-untested op' rule.
  - **Where:** `tests/effectMatrix.mts:76`
  - **Evidence (already traced, trust it but re-verify the anchor):** src/workspaces/_sync/contentControl_server_v1.ts:88-94 now sends `...(contentProjectId ? { target: { contentProjectId } } : {})` AND `payload: { ...payload, ...(contentProjectId ? { contentProjectId } : {}) }` with the comment 'Preserve it in BOTH canonical envelopes'; conductor.ts:3047 (content-gen-thumbnail) and :3232 (content-edit-image) read str(payload,'contentProjectId') and now receive it. The matrix reasons still describe the pre-fix behavior and cite the tests-file header as documentation.
  - **Fix:** Write the two real-effect tests (thumbnail: a composed image ContentAsset appears; edit-image: a new edited asset chained via parentId) mirroring tests/integration/imageCritiqueOp.test.mts, flip both rows to status 'covered' with refs, and drop the stale bug note from contentControl_server_v1.tests.ts's header.
  - **Result:** fixed in the content-control test cluster; the shared regression case covers both edited-image lineage and thumbnail persistence, with the thumbnail assertion skipped only when Docker is unavailable.

## Phase B — ONLY after Agent 1 is merged into main and you rebased

These files are rewritten by Agent 1 (workspace/page.tsx, Shell.tsx, MobileChrome, SearchPalette, marketing/studio, AdminTab). After rebasing, RE-VERIFY each finding against the new code first — Agent 1's batches (esp. the Marketing↔Studio merge and the workspace-settings fixes) may have fixed, moved or deleted the code in question; mark those "already-fixed" or "invalid".

### Files you own in this phase

- `src/workspaces/_components/SearchPalette.tsx`
- `src/workspaces/_shell/MobileChrome.tsx`
- `src/workspaces/_shell/Shell.tsx`
- `src/workspaces/content/marketing/page.tsx`
- `src/workspaces/content/settings/AdminTab.tsx`
- `src/workspaces/content/studio/page.tsx`
- `src/workspaces/workspace/page.tsx`

### Findings

- [ ] **F-074** · MEDIUM · `unclear-ux` — Repository tab and Git tab both show an identical 'Access token' field (same translation key, same placeholder) that mean different things — the clone credential for the repo URL vs the forge REST-API token — inviting users to paste the wrong one or assume one save covers both.
  - **Where:** `src/workspaces/workspace/page.tsx:1089`
  - **Evidence (already traced, trust it but re-verify the anchor):** page.tsx:1089 (RepositoryTab) and page.tsx:606 (GitLabTab) both use translate key 'workspaces.workspaceSettings.accessToken' (en.json:1468 'Access token') and 'tokenPlaceholder'. RepositoryTab's goes into linkRepo (per-project clone auth); GitLabTab's goes into gitlabSettings (workspace forge API auth, encrypted to Workspace.gitlabTokenEnc).
  - **Fix:** Give each its own label + help line: Repository → 'Repository clone token (used for git clone/fetch of this project)'; Git → 'Forge API token (used to read issues, open MRs, receive webhooks)'. Two new translation keys; no logic change.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-076** · MEDIUM · `inconsistency` — The 'Git' tab still presents itself as GitLab-only: its description says 'GitLab is the source of truth for issues' even with GitHub selected, and switching the forge dropdown GitHub→GitLab does not restore the GitLab base URL (the field keeps https://api.github.com).
  - **Where:** `src/workspaces/workspace/page.tsx:596`
  - **Evidence (already traced, trust it but re-verify the anchor):** Tab label en.json:1349 tabGitlab='Git'; FormSection title uses the same key but desc uses gitlabDescription (en.json:1463, GitLab-specific text) regardless of the selected forge. The dropdown onChange (page.tsx:599) only handles the github branch: `if (it.id === 'github') setBaseUrl('https://api.github.com')` — picking gitlab afterwards leaves the GitHub API URL in the field, which Save then persists as the GitLab base URL (compounding the base-URL overwrite finding).
  - **Fix:** In the onChange at page.tsx:599 add the symmetric branch (else setBaseUrl('https://gitlab.com')), and make the description forge-aware (two keys, picked on `forge`), or neutral ('The connected forge is the source of truth for issues...').
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-077** · MEDIUM · `ui-bug` — While editing a non-secret env value, the snapshot echo of an earlier autosave can reset the input mid-typing, reverting characters typed after the save fired.
  - **Where:** `src/workspaces/workspace/page.tsx:277`
  - **Evidence (already traced, trust it but re-verify the anchor):** EnvRow line 277: useEffect(() => { setVal(v.value); }, [v.value]) reseeds on EVERY server value change. useAutosave fires 700ms after a pause (page.tsx:278); the save-env delta then broadcasts and the snapshot rebuilds envVars, so if the user resumed typing during the round-trip, v.value changes to the earlier saved value and setVal stomps the newer keystrokes. RuntimeSection (page.tsx:775-797) documents and fixes exactly this class ('re-seeding from the server threw away whatever was being typed') by seeding only on project change; EnvRow was not given the same treatment. Secrets are safe only by accident (their snapshot value is always '').
  - **Fix:** Apply the RuntimeSection pattern to EnvRow: seed val once per v.id (useEffect deps [v.id]) and let the local draft win while mounted, or skip the reseed while the input has focus.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-112** · LOW · `duplicate` — The standard input style string (fieldCls/inputCls) is independently re-declared in ~20 files with drifting variants (h-9 vs h-10, bg-container2/50 vs /40, differing focus rings), so inputs subtly differ per page and every style fix must be repeated.
  - **Where:** `src/workspaces/workspace/page.tsx:43`
  - **Evidence (already traced, trust it but re-verify the anchor):** grep 'const fieldCls = |const inputCls = ' across src/workspaces hits 22 declarations in 20 files: workspace/page.tsx:43, aiProviders.tsx:32, skillsEditor.tsx:29, runProcesses.tsx, settings/page.tsx (dbInputCls:401 + inputCls:90), scheduled/page.tsx:31, stageTabs.tsx:31-32, SetupWizard.tsx:16 (h-10, border-container1), content/settings/shared.ts, studio/content.ts, marketing/panels.tsx:3 (bg-container2/40), backlog/forms.tsx, designer/*, documents/*, content/page.tsx, TimeTravelForm.tsx.
  - **Fix:** Export INPUT_CLS (and AREA_CLS / a mono variant) from _components/primitives.tsx next to FOCUS_RING, replace the local consts file-by-file (pure class-string swap, no behavior change), and let content/settings/shared.ts re-export it during the transition.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-123** · LOW · `inconsistency` — A pending invite created with a custom role displays as 'Member' in the invites table.
  - **Where:** `src/workspaces/workspace/page.tsx:225`
  - **Evidence (already traced, trust it but re-verify the anchor):** InvitesTab line 225 renders ROLE_DISPLAY[i.role]; snapshot invite projection (workspaceSnapshot.ts:797) sets role: asRole(inv.roleKey), which flattens any custom roleKey to 'member'. The invite stores the correct roleKey server-side (acceptInvite will apply it) — only the display lies.
  - **Fix:** Send the raw roleKey (plus resolved label) in the invite projection and render the role's label, falling back to ROLE_DISPLAY for the built-ins.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-124** · LOW · `other` — Several user-facing strings bypass the mandatory useTranslator: the '— none —' option/label in the integrations form, the 'Auto' output-language label, and the eight RBAC capability row labels render raw English.
  - **Where:** `src/workspaces/workspace/page.tsx:403`
  - **Evidence (already traced, trust it but re-verify the anchor):** page.tsx:403 envItems item: '— none —' (hardcoded); page.tsx:520 envName returns '— none —'; page.tsx:1254 OUTPUT_LANGUAGES label 'Auto' (the native language names are arguably fine, 'Auto' is not); PermissionsTab renders RBAC_CAPABILITIES strings (seed.ts:406-415, English) directly as table rows (page.tsx:142,191). Project rule 13 mandates useTranslator for user-facing text.
  - **Fix:** Add translation keys: workspaceSettings.noneOption for the two '— none —' spots, workspaceSettings.languageAuto for 'Auto', and a capability→key map (capabilities are stable identifiers; render translate({key:`workspaces.rbac.cap${i}`}) while keeping the array as identity).
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-125** · LOW · `ui-bug` — Switching the active project while editing the Dockerfile draft silently discards unsaved editor changes (the effect reloads the other project's draft over them).
  - **Where:** `src/workspaces/workspace/page.tsx:949`
  - **Evidence (already traced, trust it but re-verify the anchor):** DockerfileReview's load effect (page.tsx:949-955) depends on [workspaceId, projectId] and unconditionally setDraft(...) on success; the component is keyed only by workspace (line 1113), so a project switch re-runs the effect over an edited local draft with no dirty-check or confirm.
  - **Fix:** Track a dirty flag (draft !== lastLoaded) and either key the component by projectId too or guard the reload with a menuHandler.confirm when dirty.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-066** · MEDIUM · `inconsistency` — Every sidebar and mobile-nav label is hardcoded English ('Board', 'Backlog', 'Scheduled posts', 'Workspace-AI', ...) while the rest of the app is fully translated — on a non-English locale the chrome and the pages speak different languages.
  - **Where:** `src/workspaces/_shell/Shell.tsx:93`
  - **Evidence (already traced, trust it but re-verify the anchor):** NAV_ITEMS (Shell.tsx:93-124) and NAV_BOTTOM (126-128) carry literal label strings rendered directly at line 173 ({it.label}) and used as title tooltips (line 165); MobileChrome bottom bar items 'Board'/'Terminals'/'Activity'/'AI' (Shell.tsx:1102-1105, rendered 1117); aria-label="Close tab" (line 500) and aria-label="New" (line 1112) likewise bypass useTranslator. Project rule 13 mandates useTranslator for user-facing text; every page body in src/workspaces already complies.
  - **Fix:** Add workspaces.nav.<id> keys for each NavDef id (+ workspaces.nav.closeTab / workspaces.nav.new), drop the label field from NavDef (or keep as fallback), and translate at render time in renderItem/MobileNav: translate({key:`workspaces.nav.${it.id}`}). Mirror for the two aria-labels.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-067** · MEDIUM · `ui-bug` — All nav item labels (Board, Answers, Backlog, Pipeline, … Workspace-AI, Settings) render hardcoded English in the rail, the mobile drawer and the bottom bar, while the group headers around them do translate — a Dutch/German/French UI shows a half-translated nav.
  - **Where:** `src/workspaces/_shell/Shell.tsx:93`
  - **Evidence (already traced, trust it but re-verify the anchor):** NAV_ITEMS/NAV_BOTTOM carry literal `label: 'Board'` strings; renderItem (Shell.tsx:173) renders {it.label} raw and uses it as the collapsed-rail tooltip (line 165); MobileChrome.tsx:113 and 122 render {it.label} raw; MobileBottomBar (Shell.tsx:1101-1105, 1117) hardcodes 'Board'/'Terminals'/'Activity'/'AI'. Group headers use translate({key:`workspaces.nav.${g}`}) which exists in en.json/nl.json (verified). The project mandates useTranslator for user-facing text; _docs/COMPLETION_PROGRAM.md item RS-C3 already flags this and it is still unfixed in current code.
  - **Fix:** Add workspaces.nav.<viewId> keys to all locales, replace `label` strings with labelKey (or translate it.label via key `workspaces.nav.${it.id}`) at the three render sites: Shell.tsx renderItem + collapsed tooltip, MobileChrome drawer rows, MobileBottomBar items.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-071** · MEDIUM · `inconsistency` — On a content-only workspace the mobile bottom bar collapses to just the AI toggle + FAB: its four items are hardcoded dev views (board/terminals/activity) that all gate away, and no content-lane item (Content, Documents, Scheduled posts) ever takes their place.
  - **Where:** `src/workspaces/_shell/Shell.tsx:1101`
  - **Evidence (already traced, trust it but re-verify the anchor):** MobileBottomBar items[] is a fixed list of board/terminals/activity/ai filtered by isSectionEnabled; 'board', 'terminals' and 'activity' are all in the development module's section list (modules.ts), so with the content/design/documents modules only, filter leaves ['ai']. The drawer still works, but the primary phone nav surface is empty for the entire content lane.
  - **Fix:** Derive the bottom-bar items from the first enabled item of each nav group (GROUP_ORDER × NAV_ITEMS × isSectionEnabled), keeping 'ai' last, so every workspace type gets 3-4 meaningful tabs.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-073** · MEDIUM · `ui-bug` — Open-ticket tabs in the TabBar are clickable <div>s — no keyboard access, no role, no focus ring — inconsistent with the FOCUS_RING/a11y programme applied to every other custom control in the shared layer.
  - **Where:** `src/workspaces/_shell/Shell.tsx:496`
  - **Evidence (already traced, trust it but re-verify the anchor):** TabBar renders `<div key={id} onClick={() => { navigate(id); }} …>` with no tabIndex/role/onKeyDown; the nested close button is reachable but the tab itself is not. Contrast ClickableCard (primitives.tsx:517) which hand-implements the keyboard contract for exactly this pattern, and Tabs (primitives.tsx:182) which got real tablist semantics.
  - **Fix:** Give the tab div role="button" (or tab), tabIndex 0, Enter/Space onKeyDown → navigate(id), and the FOCUS_RING class — or wrap the label half in a real <button> beside the close button.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-114** · LOW · `ui-bug` — A handful of hardcoded English accessibility strings: aria-label="Close tab" (TabBar), aria-label="New" (mobile FAB, Shell.tsx:1112), PopMenu's fallback aria-label 'menu' (primitives.tsx:438), and the TopBar role chip renders the raw role string (Shell.tsx:131-133).
  - **Where:** `src/workspaces/_shell/Shell.tsx:500`
  - **Evidence (already traced, trust it but re-verify the anchor):** Each is a literal string in JSX/props while the surrounding code uses translate(); screen-reader users in nl/de/fr hear English names.
  - **Fix:** Replace with translate() keys (workspaces.shell.closeTab, workspaces.shell.fabNew, workspaces.common.menu, workspaces.roles.<role>).
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-121** · LOW · `dead-ui` — Dead exports in the shared layer: GROUP_LABELS (Shell.tsx:88) is exported but consumed nowhere (the rail translates workspaces.nav.* keys instead), and Backdrop (motion.tsx:106) has no consumer.
  - **Where:** `src/workspaces/_shell/Shell.tsx:88`
  - **Evidence (already traced, trust it but re-verify the anchor):** grep across src: GROUP_LABELS appears only in its definition + docs; Backdrop only in motion.tsx. Also listPats_v1 _api route has no client caller (PatPanel preloads from the snapshot's `pats`).
  - **Fix:** Delete GROUP_LABELS and Backdrop (or wire Backdrop into the two hand-rolled motion.div backdrops in MobileChrome). Flag listPats_v1 to the owner before removal since PATs may have external API consumers.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-070** · MEDIUM · `missing-ui` — Mobile chrome has no sign-out, theme toggle or language switcher — those live only in the desktop rail's user dropdown; a phone user must find Settings → Account → 'Open full settings' (/settings) to log out.
  - **Where:** `src/workspaces/_shell/MobileChrome.tsx:20`
  - **Evidence (already traced, trust it but re-verify the anchor):** NavRail's user dropdown (Shell.tsx:256-308: Account, theme toggle + settings/updateUser persist, 4-language picker, Sign out) is inside the `hidden md:flex` nav. MobileChrome's header AvatarBubble (line 60) has no onClick and the drawer's only bottom section is the workspace switcher. settings/page.tsx account tab shows theme/language read-only (ADR 0309) with a link out to /settings.
  - **Fix:** Add a compact user section to the drawer footer (avatar + name, theme toggle, language row, sign out) reusing the exact handlers from Shell.tsx NavRail's dropdown, or make the header AvatarBubble open that menu as a bottom sheet.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-116** · LOW · `duplicate` — The notifications panel is implemented twice (desktop popover in Shell.tsx TopBar, bottom sheet in MobileChrome) and has drifted: the mobile sheet drops the per-type icon and the unread dot, and caps the badge at 9+ while desktop shows the raw count; openNotification deep-link logic is copy-pasted in both files.
  - **Where:** `src/workspaces/_shell/MobileChrome.tsx:63`
  - **Evidence (already traced, trust it but re-verify the anchor):** Shell.tsx:322-328/393-425 vs MobileChrome.tsx:29-35/63-86 — same data, two renderings, two copies of the deepLink handler.
  - **Fix:** Extract a shared NotificationList (rows + openNotification) component consumed by both the popover and the sheet; unify the badge formatting.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-068** · MEDIUM · `seed-data` — The ⌘K quick actions are a stale, dev-only subset (Board, Backlog, Terminals, Pipeline, Sources, Usage) — no Content, Documents, Marketing, Designer, Answers etc., and they ignore module gating, so a content-only workspace gets actions that bounce off the module-gate redirect.
  - **Where:** `src/workspaces/_components/SearchPalette.tsx:88`
  - **Evidence (already traced, trust it but re-verify the anchor):** actions[] is a hardcoded list of 8 entries (lines 88-97) predating the module IA; it is not derived from NAV_ITEMS/isSectionEnabled. The gate effect in WorkspacesShell.tsx:95-107 bounces disabled views, so 'Go to board' on a content-only workspace navigates then redirects away. _docs/COMPLETION_PROGRAM.md RS-C9 flags exactly this; still unfixed.
  - **Fix:** Build actions from NAV_ITEMS filtered by isSectionEnabled(activeWorkspace.enabledSections, it.id), using the same translated labels as the nav; keep the New-ticket and AI-toggle actions.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-117** · LOW · `unclear-ux` — In the palette, Enter only ever opens the first TICKET match — when the query matches only documents or sources, Enter does nothing; there is no arrow-key result navigation at all.
  - **Where:** `src/workspaces/_components/SearchPalette.tsx:113`
  - **Evidence (already traced, trust it but re-verify the anchor):** onKeyDown: `if (e.key === 'Enter' && tickets[0]) openTicket(tickets[0].id)`; no other key handling, no roving focus over the result buttons.
  - **Fix:** Fall back to the first document (go(`content/documents/${id}`)) then first source on Enter, and add ArrowUp/Down roving selection across the flattened result list.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-029** · MEDIUM · `broken-flow` — An AI-drives-UI copilot directive that navigates to /marketing with a brief prefill silently does nothing — and the un-consumed prefill later auto-opens a pre-filled form on whichever of /content or /studio the user happens to visit next.
  - **Where:** `src/workspaces/content/marketing/page.tsx:34`
  - **Evidence (already traced, trust it but re-verify the anchor):** WorkspacesProvider.tsx:1539 applyCopilot sets copilotPrefill and navigates to any view (including 'marketing'). Only content/page.tsx (useEffect at :153) and studio/page.tsx (:99-108, whose comment explicitly claims 'or to the marketing variant, which embeds this same surface') consume it. marketing/page.tsx never reads copilotPrefill/consumeCopilotPrefill — the embed claim went stale when marketing was forked off StudioSurface. Both consumers fire on ANY leftover prefill (content on title/brief keys, studio on brief-shaped keys), so the stale value leaks across pages.
  - **Fix:** In marketing/page.tsx add the same useEffect studio/page.tsx:99-108 has: read copilotPrefill, map via briefDraftFromPrefill (export it from studio/page.tsx), open the BriefForm view pre-filled with it, then consumeCopilotPrefill(). Also update the stale comment in studio/page.tsx:95-98.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-078** · LOW · `inconsistency` — After a generation, /marketing clears the shared refine instruction box while /studio keeps it — the same feature behaves differently on the two sibling surfaces a user switches between.
  - **Where:** `src/workspaces/content/marketing/page.tsx:66`
  - **Evidence (already traced, trust it but re-verify the anchor):** marketing/page.tsx runGenerate ends with setRefine('') (line 66, commented 'Consume the refine text on use'), and marketing's regenerate InfoTip documents it (workspaces.tips.studio.regenerateRefineCleared). studio/page.tsx runGenerate (:120-128) never clears refine and its regenerate InfoTip (:325-331) omits that point. Both feed the identical generateArtifact op and both persist artifact.refine.
  - **Fix:** Pick one behaviour (the marketing clear-on-use semantics match the stated I4 bug-fix rationale) and apply it in studio/page.tsx runGenerate too, adding the regenerateRefineCleared point to studio's InfoTip.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-038** · MEDIUM · `duplicate` — The same eight marketer artifact kinds (copy, strategy, email, ads, social, names, thumbnail, videoScript) are generateable from BOTH /workspaces/content/studio and /workspaces/content/marketing, over the same briefs/artifacts, with two forked layouts and two parallel BrandPanel/brief-form implementations.
  - **Where:** `src/workspaces/content/studio/page.tsx:33`
  - **Evidence (already traced, trust it but re-verify the anchor):** studio/page.tsx KINDS (lines 29-40) still contains all marketer-role kinds and renders a grid per role (line 296 KINDS.filter((k) => k.role === role)); marketing/page.tsx's own intent header says the surfaces were split 'marketer focus here, the designer kinds live on /studio' — but studio never dropped its marketer half. Duplicated components: content/marketing/panels.tsx BrandPanel/BriefForm vs content/studio/BrandPanel.tsx (identical brandImport/brandExport apiRequest wiring, same notify keys), plus marketing/cards.tsx vs studio/previews.tsx rendering the same artifacts. Both views are routed (nav.ts lines 44/46, category 'content').
  - **Fix:** Honor the documented split: remove the marketer-role kinds from studio/page.tsx KINDS (keep landing/component/brand) and link 'marketing assets' from Studio to /content/marketing; extract the shared BrandPanel into one component (e.g. content/_shared/BrandPanel.tsx) imported by both pages.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-079** · LOW · `dead-ui` — StudioSurface's variant='marketing' machinery (roles narrowing, the marketing empty-state copy, the Brand-tab suppression) is dead code — nothing ever instantiates the surface with that variant since /marketing was forked into its own implementation.
  - **Where:** `src/workspaces/content/studio/page.tsx:68`
  - **Evidence (already traced, trust it but re-verify the anchor):** grep for StudioSurface across src returns only its definition and the variant='studio' call at studio/page.tsx:42; marketing/page.tsx renders its own fork. The `roles` ternary (:85), `variant === 'marketing'` empty-brief body (:337) and the exported variant prop type exist solely for the unused path.
  - **Fix:** Either delete the variant prop and its branches (fold to the studio behaviour), or actually re-use StudioSurface variant='marketing' from marketing/page.tsx and delete the fork — coordinate with the duplicate-surface finding.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_
- [ ] **F-080** · LOW · `ui-bug` — Setting the media-budget alert threshold to 0% silently saves as 80%.
  - **Where:** `src/workspaces/content/settings/AdminTab.tsx:92`
  - **Evidence (already traced, trust it but re-verify the anchor):** BudgetCard save(): `alertPct: Math.min(100, Math.max(0, Math.round(Number(alertPct)))) || 80` — a valid 0 is falsy so `|| 80` rewrites it; the field allows min=0. Same pattern makes an explicit cap of €0 legitimate (`|| 0` is harmless there).
  - **Fix:** Replace `|| 80` with a Number.isFinite check: `const p = Math.round(Number(alertPct)); alertPct: Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 80`.
  - **Result:** _(fill in: fixed <commit> / skipped: <reason> / already-fixed)_

## Out-of-scope observations

- Phase B was not started: no Phase-B-owned source file was edited, and all Phase B checkboxes remain untouched.
- `F-039`, `F-083`, `F-084`, `F-085`, `F-111`, `F-113`, and `F-122` remain pending because their prescribed caller/removal/shared-contract changes are outside Agent 3 Phase A ownership.
- `F-062`/`F-069` remain pending until Agent 1's `workspace/page.tsx` is merged; the standalone `SetupWizard` was intentionally not deleted.
- `F-063`/`F-072` have the safe Phase A heading clarification only; the reverse cross-links/card relocation belong to the later workspace-settings integration.
- `F-032` has a client-side timeout/error fallback; immediate sync error propagation still belongs in `WorkspacesProvider.tsx`.
- The user-requested `AGENT_3_DEVELOP.md` filename is absent; this branch's README and branch name identify `AGENT_3_CONTENT_SHELL.md` as the intended Agent 3 handoff.
