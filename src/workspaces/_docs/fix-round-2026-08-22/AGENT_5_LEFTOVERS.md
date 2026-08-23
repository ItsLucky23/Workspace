# Agent 5 — leftovers: the 13 findings skipped on ownership boundaries

Rounds 1-2 of the fix-round fixed 112 of the 125 audit findings (plus the provider package). These 13 were SKIPPED by the cheap agents only because the fix needed files owned by another agent at the time. That boundary is gone: **you own the whole repo** — there are no other agents running. Work on branch `fix/audit-leftovers` (own worktree).

## Project context (30 seconds)

Workspaces is a self-hosted AI dev-orchestration + content platform on the LuckyStack framework. UI state comes from `src/workspaces/_shell/WorkspacesProvider.tsx` (snapshot `workspaces/snapshot` + realtime deltas by seq). Writes go: UI → context action → `_sync`/`_api` route → Conductor op (`server/orchestrator/conductor.ts`, the ONLY writer) → Prisma. Read `CLAUDE.md` in the repo root first: `tryCatch` only, i18n via `useTranslator`, Tailwind theme tokens, no `as any`, single-writer, every new op gets a `tests/effectMatrix.mts` row, after any new/removed route run `npm run generateArtifacts`.

## Ground rules

1. **Surgical changes** — every changed line traces to an item below. Dedup items (F-051/053/112/113) are refactors: behaviour must stay identical; no "improvements" on the way.
2. **Verify after every item:** `npm run lint && npm run build` clean, AND `npx tsc --noEmit -p tsconfig.json` with 0 errors (the build does NOT typecheck client code — lesson 0029), then `npm run test:unit`. Do not start the dev server.
3. **Bug fixes that touch a route/op get a regression test** (per-route `*.tests.ts` or unit). Refactors: existing tests must stay green.
4. **Translations:** new keys at the END of the module's section in all four locale files; never reorder.
5. **Track progress in THIS file** (tick + Result line). Commit per item. Branch-log entry (`branch-logs/fix-audit-leftovers.md` + INDEX row) at the end.
6. If an item is already fixed or invalid on the current code, say so with evidence — do not force a change.

## Items (suggested order: verifications first, then dedups, then the server-side ones)

- [x] **F-045** · MEDIUM · `not-persisted` — The Interviewer conversation vanishes on every navigation/reload even though the server durably records every turn — and those recorded turns instead resurface inside the shell AI-panel's chat, interleaving interviewer Q&A into the assistant conversation.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/develop/interviewer/page.tsx:56`
  - **Evidence:** messages is plain useState (page.tsx:56), never hydrated. aiChat_v1.ts:45-55 enqueues op 'chat-turn-record' for every turn ('#111 — persist the turn so the chat survives reload / is cross-device'). The only reader of that log is the shell chat: WorkspacesProvider.tsx:1247-1251 hydrates setChat from snap.chat. So interviewer turns are write-only for this page and leak into the AI panel's history (both surfaces share one per-workspace chat log).
  - **Original fix hint:** Either hydrate the Interviewer's messages from the same persisted snap.chat the provider exposes (filtering or tagging interviewer turns, e.g. a source field on chat-turn-record), or stop persisting interviewer turns into the shared assistant log; pick one owner for the persisted chat log.
  - **Now:** Needs API/Conductor/snapshot files — you own them now. Agent 1 already added conversation history to the chat call; this item is about PERSISTING the interviewer conversation server-side so it survives navigation/reload.
  - **Result:** fixed — `aiChat` now tags interviewer turns in the existing persisted table, the snapshot exposes that source, the provider separates Assistant and Interviewer histories, and the Interviewer hydrates from its persisted turns without leaking them into the shell AI panel.

- [x] **F-037** · MEDIUM · `not-persisted` — Dismissing an AI suggestion (the 'Dismiss' button in the Shell AI panel and on the usage page's root-cause card) only hides it in this browser session — it reappears after every reload and stays visible for every other member.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/_shell/WorkspacesProvider.tsx:1506`
  - **Evidence:** dismissSuggestion (WorkspacesProvider.tsx:1506) only does setLocalSuggestionsDismissed; no syncRequest/apiRequest. activeSuggestions (line 1446) filters snap.suggestions by that local array, which is lost on unmount/reload. Server-side there is NO dismiss op: ControlOp has only 'accept-suggestion' (controlApi.ts:90), conductor.ts has ui-review-dismiss and finding-dismiss but no suggestion-dismiss, and server/ai/opCatalog.ts:881 marks accept-suggestion as EXCLUDED plumbing. WorkspaceSuggestion rows therefore stay 'open' in the DB forever after a dismiss. Callers: Shell.tsx:1024, insights/usage/page.tsx:498.
  - **Original fix hint:** Add a 'dismiss-suggestion' op next to accept-suggestion: a small _sync route (or extend acceptSuggestion_server_v1 with an action:'dismiss' field) that flips WorkspaceSuggestion.status to 'dismissed' via the Conductor, plus a delta/refetch; keep the optimistic local hide. Classify the new op in tests/effectMatrix.mts.
  - **Now:** Reuses the frozen `accept-suggestion` op with an explicit `action: 'dismiss'` payload (no new verb), persists the status through the Conductor, broadcasts the same delta, and keeps the optimistic local hide.
  - **Result:** fixed — dismissals now persist as `WorkspaceSuggestion.status = 'dismissed'`, disappear for every member, and stay gone after reload.

- [x] **F-123** · LOW · `inconsistency` — A pending invite created with a custom role displays as 'Member' in the invites table.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/workspace/page.tsx:225`
  - **Evidence:** InvitesTab line 225 renders ROLE_DISPLAY[i.role]; snapshot invite projection (workspaceSnapshot.ts:797) sets role: asRole(inv.roleKey), which flattens any custom roleKey to 'member'. The invite stores the correct roleKey server-side (acceptInvite will apply it) — only the display lies.
  - **Original fix hint:** Send the raw roleKey (plus resolved label) in the invite projection and render the role's label, falling back to ROLE_DISPLAY for the built-ins.
  - **Now:** Needs `InviteEntry` type + snapshot projection (server/read/workspaceSnapshot.ts) + provider typing to carry the raw roleKey/label for invites, mirroring what Agent 1 did for members (F-024).
  - **Result:** fixed — invite snapshots and realtime deltas carry the raw `roleKey` plus custom-role label; the table renders that label and retains locale-aware built-in fallbacks.

- [x] **F-122** · LOW · `inconsistency` — The Usage page's three tabs (Usage/Delivery/People) are React state, not URL trail — unlike settings/workspace/pipeline/content-settings, a deep link or refresh always lands on the first tab and back does not walk out of a tab.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/insights/usage/page.tsx:56`
  - **Evidence:** useState<UsageTab> at line 56; 'usage' (and 'insights/usage') is absent from TRAIL_ROOTS in _data/nav.ts, which is an explicit allowlist. The deliberate-allowlist comment exists, but Usage is exactly the kind of multi-tab page ADR 0312 targeted.
  - **Original fix hint:** Add 'insights/usage' to TRAIL_ROOTS and switch the page to useTrailSegment(0, ['usage','delivery','people'], 'usage').
  - **Now:** Needs the `_data/nav.ts` trail-root contract: register the Usage page as a trail root and switch its tabs to `useTrailSegment` like the other sub-navigated pages.
  - **Result:** fixed — registered `insights/usage` in `TRAIL_ROOTS` and switched the page to `useTrailSegment(0, ['usage', 'delivery', 'people'], 'usage')`; tab deep links and browser Back now use the shared URL trail.

- [x] **F-051** · MEDIUM · `duplicate` — Two components both named TerminalPanel duplicate the drag-resize machinery verbatim and present two conflicting models of the same ticket container; 'Open in Terminals' from the ticket tab lands on a page where the process tabs the user was viewing do not exist.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/develop/board/[ticketId]/TerminalPanel.tsx:28`
  - **Evidence:** board/[ticketId]/TerminalPanel.tsx:24-62 and terminals/TerminalPanel.tsx:24-84 carry identical module-level remembered-height + clamp + pointer-capture drag code (each with its own remembered value). The board panel's tabs are project runProcesses + stage processes (real per-process PTY sessions `${ws}:${ticket}:${procName}`, board TerminalPanel.tsx:32-34,98), while the Terminals page hardcodes a single 'shell' process per container (terminals/page.tsx:52). Clicking 'Open in Terminals' (board TerminalPanel.tsx:87) therefore drops the frontend/backend process terminals and shows only 'shell' + ad-hoc tabs.
  - **Original fix hint:** Extract the shared drag-resize into a hook (useRememberedPanelHeight) and have the Terminals page seed each container's process list from the same runProcesses+stageProcesses derivation the board tab uses (ctx.activeProject.runProcesses + stageConfigs), so both surfaces show the same sessions.
  - **Now:** Dedup the drag-resize/panel machinery shared by `develop/terminals/TerminalPanel.tsx` and `develop/board/[ticketId]/TerminalPanel.tsx` into one shared piece (a hook or component under `_components/`). Both files are yours now. Keep behaviour identical.
  - **Result:** fixed — extracted `useRememberedPanelHeight` in `src/workspaces/_components/useRememberedPanelHeight.ts` and both TerminalPanel consumers now share it, retaining their independent 460px/320px defaults and clamp behavior.

- [x] **F-053** · MEDIUM · `duplicate` — Two different components named TerminalPanel serve the same concept (a ticket-container terminal) with copy-pasted resize plumbing and divergent capabilities — the ticket-tab one lacks restart/clear/copy-buffer/kill and the '+' ad-hoc shell that the terminals-page one has.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/develop/terminals/TerminalPanel.tsx:28`
  - **Evidence:** develop/terminals/TerminalPanel.tsx and develop/board/[ticketId]/TerminalPanel.tsx both implement identical module-level remembered-height + MIN/MAX + pointer-capture drag handlers (terminals: lines 24-26/73-84; ticket: lines 24-26/51-62 — the ticket one even says 'mirrors TerminalPanel'). Data sources diverge: terminals page synthesizes `processes:[{name:'shell',status:'idle',cwd:'/work',...}]` per polled container, so its per-process status dots/termStatus() and the '· <stage>' label (always literally 'container') are cosmetic; the ticket panel derives tabs from project/stage config. Session actions (restartSession/clearSession/copySessionBuffer/killSession from XtermTerminal) are only wired in the terminals variant (lines 89-100).
  - **Original fix hint:** Extract one shared TerminalPanel (or a shared useTerminalResize hook + a shared session-actions PopMenu) parameterized by process list; give the ticket-tab variant the same restart/clear/copy/kill menu and '+' shell affordance, and rename one component so two exports don't share the name TerminalPanel.
  - **Now:** Same pair of files as F-051 — resolve together: one named component/hook, the other a thin consumer. Tick both.
  - **Result:** fixed — the resize state is shared by `useRememberedPanelHeight`; the ticket consumer is now explicitly named `TicketTerminalPanel`, leaving only the process-rich `TerminalPanel` for the Terminals page.

- [x] **F-112** · LOW · `duplicate` — The standard input style string (fieldCls/inputCls) is independently re-declared in ~20 files with drifting variants (h-9 vs h-10, bg-container2/50 vs /40, differing focus rings), so inputs subtly differ per page and every style fix must be repeated.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/workspace/page.tsx:43`
  - **Evidence:** grep 'const fieldCls = |const inputCls = ' across src/workspaces hits 22 declarations in 20 files: workspace/page.tsx:43, aiProviders.tsx:32, skillsEditor.tsx:29, runProcesses.tsx, settings/page.tsx (dbInputCls:401 + inputCls:90), scheduled/page.tsx:31, stageTabs.tsx:31-32, SetupWizard.tsx:16 (h-10, border-container1), content/settings/shared.ts, studio/content.ts, marketing/panels.tsx:3 (bg-container2/40), backlog/forms.tsx, designer/*, documents/*, content/page.tsx, TimeTravelForm.tsx.
  - **Original fix hint:** Export INPUT_CLS (and AREA_CLS / a mono variant) from _components/primitives.tsx next to FOCUS_RING, replace the local consts file-by-file (pure class-string swap, no behavior change), and let content/settings/shared.ts re-export it during the transition.
  - **Now:** The `fieldCls`/`inputCls` string re-declared in ~20 files: export ONE from `src/workspaces/_components/settings.tsx` (or `primitives.tsx`) and replace the copies. Mechanical; verify with grep that no local copy remains.
  - **Result:** fixed — `INPUT_CLS` plus derived full-width/monospace variants now live in `src/workspaces/_components/settings.tsx`; all local `fieldCls`/`inputCls`/`dbInputCls` declarations were removed (the declaration grep is empty), and existing width/mono call-site semantics are retained via the derived aliases.

- [x] **F-113** · LOW · `duplicate` — Small helpers/components are implemented twice under different paths: stat tiles, relative-time formatting, and markdown line rendering each have two independent copies.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/content/insights/page.tsx:31`
  - **Evidence:** Stat (content/insights/page.tsx:31-38) vs StatCard (insights/usage/page.tsx:43-51) — same tile shape; timeAgo duplicated in develop/scheduled/page.tsx:41-50 and content/documents/page.tsx; renderMdLine/stripInline markdown helpers duplicated between _components/AssetPicker.tsx and _components/MarkdownView.tsx; assetHref defined in content/marketing/cards.tsx, content/studio/previews.tsx and content/page.tsx (the preview-suite duplication itself is covered by the Studio/Marketing finding).
  - **Original fix hint:** Move the stat tile into _components/dataDisplay.tsx (props: label, value, hint?, info?) and use it from both insights pages; add _functions/timeAgo.ts; have AssetPicker import the md helpers from MarkdownView (export them there); put assetHref in content/studio/content.ts (already shared) and import it in the other two.
  - **Now:** Shared small helpers (stat tiles, relative-time, etc.) implemented twice: extract to `_components/` / `_functions/` and point both call sites at it. Keep the exact rendering.
  - **Result:** fixed — `StatCard` is shared from `src/workspaces/_components/dataDisplay.tsx`; `timeAgo` from `_functions/timeAgo.ts`; Markdown `stripInline` is shared from `MarkdownView`; and `assetHref` is canonical in `content/studio/content.ts` with the old route path re-exporting it and `AssetPicker` consuming it.

- [ ] **F-064** · MEDIUM · `unclear-ux` — 'Brand' is spread over three stores on three pages — brand context + logo (content settings), brand kit palette/fonts/voice/taglines (Studio AND Marketing), per-channel brand voice (Channels) — with two independent free-text 'voice' fields that can contradict and no surface saying which one a given generation uses.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/content/settings/BrandStylesTab.tsx:23`
  - **Evidence:** (1) BrandContextCard (BrandStylesTab.tsx:23-54): productContext + brand logo via content-edit-product — 'folded into every generation'. (2) BrandPanel (studio/BrandPanel.tsx + its marketing/panels.tsx duplicate): studioBrand {palette, typography, voice, taglines} via saveBrand — 'seed every generation'. (3) Channel.brandVoice (ChannelsTab.tsx form) — single-ownered there since the 2026-08-17 owner decision (content/insights reads it read-only). studioBrand.voice and channel.brandVoice are both prose voice directions; productContext is a third prose blob. No LayerNote/InfoTip anywhere states precedence or composition among the three, unlike the dev-side prompt layers which got exactly that treatment (ADR 0308 resolveAiLayers).
  - **Original fix hint:** Apply the ADR 0308 pattern to the content side: build a resolveContentLayers helper (product context → brand kit voice → channel voice → style) and render LayerNote/inherits chips on all three edit surfaces (BrandContextCard, BrandPanel, ChannelsTab voice field) stating what each layer adds and which wins; add a cross-link from BrandContextCard to Studio's brand kit and vice versa. Verify actual precedence in the server's generation prompt builder before writing the copy.
  - **Now:** Brand over three stores/pages: do NOT add a fourth copy. Implement the fixHint's single-owner direction; if it needs a server prompt-precedence change, do it (you own server/ too) but keep it minimal and tested.
  - **Result:** _(fill in: fixed <commit> / already-fixed / invalid: <reason>)_

- [x] **F-084** · LOW · `duplicate` — listPats is a dead duplicate read: the settings API-tokens panel now gets PATs preloaded in the snapshot (snap.pats), and nothing calls the route anymore.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/_api/listPats_v1.ts:1`
  - **Evidence:** server/read/workspaceSnapshot.ts:256 comment: 'Was a mount-time GET (workspaces/listPats) on every settings visit' — the X3 preload replaced it. grep for client callers of 'workspaces/listPats' = 0 (issuePat and revokePat still have callers).
  - **Original fix hint:** Delete listPats_v1.ts + listPats_v1.tests.ts and regenerate the API maps, or keep it deliberately as the post-issue refresh read and actually call it after issuePat instead of the full snapshot refetch.
  - **Now:** OWNER DECISION TAKEN: delete the dead `listPats` route + its test + any client caller remnants (the snapshot path is authoritative). Run `npm run generateArtifacts` after removing the route.
  - **Result:** fixed — deleted the unused route and per-route test; regenerated API artifacts; the snapshot preload remains the sole PAT read path.

- [x] **F-085** · LOW · `missing-ui` — The generateDocs route (AI-author a project-summary context doc from the linked repo) is reachable from no UI — its own header says 'the trigger button + live surfacing are a later UI slice' that never came, so users can only get generated docs via the scanDocs path.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/_api/generateDocs_v1.ts:4`
  - **Evidence:** grep 'workspaces/generateDocs' over client code = 0 hits; only the route, its tests and the generated prod map reference it. It is also not in the chat-enabled op set (not a ChatEnabledOp), so the assistant cannot trigger it either.
  - **Original fix hint:** Add a 'Generate project summary (AI)' button on the Sources page (develop/sources/page.tsx) next to the scan/rescan action, calling apiRequest workspaces/generateDocs with the active workspace/project, then refetch; or delete the route if scanDocs has subsumed it.
  - **Now:** OWNER DECISION TAKEN: give `generateDocs` a UI — a "Generate context doc from repo" action on `develop/sources/page.tsx` (where the context docs live), with the usual SavePill/notify feedback and a disabled state when no repo is linked.
  - **Result:** fixed — Sources now exposes the typed `generateDocs` action beside maintenance controls, with SavePill/notification feedback, refetch on success, and disabled state without a linked repository.

- [x] **F-083** · LOW · `missing-ui` — The ai-provider-health route ('feeds the health indicator in the workspace AI settings') has no UI caller — the gap-fix that created it was itself orphaned by the later AI-page rework, recreating the exact "exported for a UI that never came" state its header complains about.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/_api/aiProviderHealth_v1.ts:1`
  - **Evidence:** grep 'workspaces/aiProviderHealth' over src/**.tsx (excluding _api/_sync/tests) = 0 hits. The reworked AI page (commits 66279f6/f6c12be) uses aiConnection add/test/remove via the aiConnection _sync route plus snapshot aiConnections/aiProviderCatalog instead.
  - **Original fix hint:** Either delete the route (+ its tests + generated map entry regen) since per-connection ai-connection-test supersedes it, or add the intended health chip on the AI page (workspace/aiProviders.tsx) calling it on mount.
  - **Now:** VERIFY FIRST: Agent 4 (P4-7) now calls `aiProviderHealth_v1` from the AiBehaviorTab routing picker. If that is the caller this finding asked for, mark "already-fixed" with the file:line of the call and do nothing else.
  - **Result:** already-fixed — `src/workspaces/workspace/page.tsx:1374` calls `apiRequest({ name: 'workspaces/aiProviderHealth', version: 'v1', ... })`; the result feeds the routing-picker availability at lines 1407–1421.

- [x] **F-121** · LOW · `dead-ui` — Dead exports in the shared layer: GROUP_LABELS (Shell.tsx:88) is exported but consumed nowhere (the rail translates workspaces.nav.* keys instead), and Backdrop (motion.tsx:106) has no consumer.
  - **Where (audit baseline 55ff5b7 — code has moved, re-locate):** `src/workspaces/_shell/Shell.tsx:88`
  - **Evidence:** grep across src: GROUP_LABELS appears only in its definition + docs; Backdrop only in motion.tsx. Also listPats_v1 _api route has no client caller (PatPanel preloads from the snapshot's `pats`).
  - **Original fix hint:** Delete GROUP_LABELS and Backdrop (or wire Backdrop into the two hand-rolled motion.div backdrops in MobileChrome). Flag listPats_v1 to the owner before removal since PATs may have external API consumers.
  - **Now:** VERIFY FIRST: `GROUP_LABELS` is consumed by the navStructure contract test, so it is NOT dead — leave it. Only remove `Backdrop` in `_components/motion.tsx` if grep proves it has zero consumers; otherwise mark "invalid" with the evidence.
  - **Result:** fixed — `Backdrop` had zero code/test consumers (`rg -n "Backdrop" src tests --glob '!**/_docs/**'`); removed it from `src/workspaces/_components/motion.tsx`. `GROUP_LABELS` remains because `tests/unit/navStructure.test.mts` imports and asserts it.

## Out-of-scope observations

_(note anything you saw but did not fix)_
