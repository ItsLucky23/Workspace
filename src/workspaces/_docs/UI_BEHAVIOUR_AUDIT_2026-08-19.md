# UI behaviour audit — 2026-08-19

> Produced by a 31-agent behavioural audit (`ui-behaviour-inventory`): 6 parallel finders, then one
> adversarial refuter per finding whose job was to prove the claim WRONG. 24 raw → 22 survived → 19 after collapsing duplicates reported from two angles.

The owner's report was that recently-added UI "is allemaal niet echt goed". This is the honest
answer. Every previous check on this code verified COPY and TYPES; none ever clicked a control. That
is the whole reason this list exists and why it is this long.

**`broken`** = does nothing, or goes somewhere that cannot do what was promised.
**`misleading`** = works, but tells the user something untrue about what it did.

## Status — all 19 fixed (2026-08-19)

Wave 1 (commit `85bd374`) took the seven navigation defects; wave 2 took the remaining twelve. Each
wave shipped with a click-test rather than a copy check, because copy checks are what let all of this
through. New specs: `tests/e2e/layerTip.spec.ts`, `tests/e2e/deepLinks.spec.ts`,
`tests/e2e/onboardingSteps.spec.ts` — together under 60 seconds.

The single highest-impact one was not on any screen the report started from: `/workspaces/content/settings`
derives the gateable view `content`, so the module guard bounced every visitor whose workspace lacks
that section — and that page holds the workspace-wide AI and media provider keys. On a Development-only
workspace the setup checklist's FIRST row, plus five other "fix this" buttons, all pointed at a page
the user was immediately redirected away from.

| # | Severity | Where | What breaks |
|---|---|---|---|
| 1 | broken | `src/_locales/en.json:1261` | Setup-checklist row promises an AI agent picks up the ticket it creates; the ticket it creates is parked and never picked up |
| 2 | broken | `src/workspaces/_components/SetupChecklist.tsx:118` | Setup-checklist "Turn on notifications" ticks itself done from a host env var, not the user's subscription |
| 3 | broken | `src/workspaces/_shell/Shell.tsx:988` | Assistant-panel "no AI provider" fix button is bounced back by the module guard on any workspace without the content section |
| 4 | broken | `src/workspaces/_shell/WorkspacesProvider.tsx:166` | Every tab on the Content settings page navigates the user OFF the page to the Content overview |
| 5 | broken | `src/workspaces/content/documents/[docId]/page.tsx:267` | "Go to Content" in the document image-reuse picker bounces on a Documents-only workspace |
| 6 | broken | `src/workspaces/content/studio/page.tsx:173` | Studio's missing-AI-provider fix bounces on a Design-only workspace |
| 7 | broken | `src/workspaces/develop/designer/page.tsx:374` | Designer's missing-media-key fix bounces on a Design-only workspace |
| 8 | broken | `src/workspaces/develop/pipeline/page.tsx:117` | "Add stage → <kind>" creates the stage but selects the PREVIOUS one — two competing navigations in one handler |
| 9 | broken | `src/workspaces/develop/scheduled/page.tsx:305` | "Add a channel" on the Schedules page bounces on a Development-only workspace |
| 10 | broken | `src/workspaces/develop/sources/page.tsx:274` | Stage chips on Sources deep-link with stage NAMES into a slot that only accepts stage KEYS, so they always open the first stage |
| 11 | broken | `src/workspaces/workspace/page.tsx:823` | "Manage services" deep-links to the Settings tab that contains no services |
| 12 | broken | `src/workspaces/workspace/page.tsx:146` | Permission-matrix cells for Admin/Member are clickable but every click is rejected server-side with no feedback |
| 13 | broken | `src/workspaces/workspace/page.tsx:1121` | Modules tab keeps the previous workspace's toggles after a workspace switch, and Save writes them onto the new workspace |
| 14 | misleading | `src/_locales/en.json:2451` | Terminals empty state claims you can start a container from the Pipeline page, and its only button navigates there — the Pipeline page has no such control |
| 15 | misleading | `src/workspaces/_components/EffectivePromptPreview.tsx:82` | AI-layer tip's "Edit on the Carry-over tab" computes the carryover tab then discards it, landing on the pipeline's General tab |
| 16 | misleading | `src/workspaces/_components/SetupChecklist.tsx:88` | Setup checklist's module filter uses the loose `isModuleEnabled`, so a content-only workspace IS told to link a git repository — the exact thing its header comment promises never happens |
| 17 | misleading | `src/workspaces/develop/board/[ticketId]/page.tsx:220` | Ticket preview tip's "Set start command" link drops the tab and lands on the Members tab, which has no start-command field |
| 18 | misleading | `src/workspaces/develop/pipeline/page.tsx:135` | "Validate with AI" always reports "has AI on but no skills enabled — it'll work blind" for a condition no UI can resolve |
| 19 | misleading | `src/workspaces/develop/pipeline/presets.tsx:105` | Preset menu "Fill N empty fields from the defaults" counts fields that have no default; the count can never reach 0 and on a default pipeline the action writes nothing |

## Detail

### 1. Setup-checklist row promises an AI agent picks up the ticket it creates; the ticket it creates is parked and never picked up

- **Severity** — broken
- **Where** — `src/_locales/en.json:1261`
- **Impact** — A first-time user taps "Create one" on the onboarding checklist, is told an AI agent will pick the ticket up from the board, and then waits indefinitely — the ticket sits in Unrefined with AI off. Nothing on the checklist mentions the "Start with AI right away" option that would actually be required.
- **Evidence** — en.json:1261 `"firstTicketDesc": "An AI agent picks it up from the board."` — the row's handler is `SetupChecklist.tsx:99` `action: () => { quickAdd({ title: translate({ key: 'workspaces.checklist.firstTicketTitle' }) }); }`, which passes NO `startWithAi`. `WorkspacesProvider.tsx:983` only forwards it `...(input.startWithAi === true ? { startWithAi: true } : {})`, and `conductor.ts:1680-1683` creates the row as `stageId: 'unrefined', status: 'idle'`; the activation branch is gated on `if (payload.startWithAi === true)` (conductor.ts:1695). The app's own tooltip states the opposite: `workspaces.tips.board.newTicketStartTitle` = "Creating a ticket starts nothing" and `workspaces.tips.board.quickAddParkedBody` = "the ticket stays in Unrefined and no agent will ever pick it up".

### 2. Setup-checklist "Turn on notifications" ticks itself done from a host env var, not the user's subscription

- **Severity** — broken
- **Where** — `src/workspaces/_components/SetupChecklist.tsx:118`
- **Impact** — On any host with VAPID keys configured (the normal deployment), the row renders struck-through with a green check and counts toward "X of Y done" for every user, including one who has never subscribed and will receive zero notifications. Because the row is `done`, its fix button is not rendered (`{!step.done && (allowed ? <button .../>)}`), so the checklist actively hides the only route to the setting it claims is finished. A real per-user signal exists and is used one screen away: `settings/page.tsx:406` -> `useEffect(() => { void hasPushSubscription().then(setPush); }, [])`.
- **Evidence** — { id: 'push', icon: 'bell', done: readiness.push, cap: 'workTickets', target: { view: 'settings', tab: 'account' } },  // server/read/readiness.ts:28 -> push: (process.env.WS_VAPID_PUBLIC ?? '').trim().length > 0 && (process.env.WS_VAPID_PRIVATE ?? '').trim().length > 0

### 3. Assistant-panel "no AI provider" fix button is bounced back by the module guard on any workspace without the content section

- **Severity** — broken
- **Where** — `src/workspaces/_shell/Shell.tsx:988`
- **Impact** — This SetupNotice renders in the global assistant chat panel on EVERY workspace when `!readiness.aiText`. focusSetup navigates to /workspaces/content/settings; WorkspacesProvider.tsx:186-190 `viewFromPath` returns `'content'` for that path (segs[1]='settings' is not in VIEW_CATEGORY, so it falls through to `: 'content'`). 'content' is a GATEABLE section (modules.ts:39 content module sections include 'content'), so WorkspacesShell.tsx:90-92 fires: `if (!GATEABLE_SECTIONS.includes(view) || isSectionEnabled(...)) return; ... navigate(firstEnabled.id)`. A Development-only workspace (Onboarding.tsx:40 persists `sectionsForModules(['development'])`, which has no 'content') is redirected straight back to the Board. The user clicks "set up AI", the page flashes and returns them where they started, with the same notice still shown and no way to reach the provider keys.
- **Evidence** — fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'admin', cta: translate({ key: 'workspaces.setup.ai.cta' }) }}

### 4. Every tab on the Content settings page navigates the user OFF the page to the Content overview

- **Severity** — broken
- **Where** — `src/workspaces/_shell/WorkspacesProvider.tsx:166`
- **Impact** — Clicking "Brand & styles", "Channels & publishing" or "Admin" on /workspaces/content/settings does not switch tab — it leaves the settings page entirely and lands on the Content overview board. The page's own tab bar is unusable; the only way to reach a tab is a deep link (focusSetup passes the literal view string 'content/settings', which resolves differently and works). This is the page every SetupNotice/checklist "add your AI key" fix sends a new user to.
- **Evidence** — pathForTrail: `const base = pathForView(view); if (!TRAIL_ROOTS.includes(relativePath(base))) return base;` — on /workspaces/content/settings the provider's derived view is `content` (viewFromPath line 190 returns 'content' because VIEW_CATEGORY['settings'] is undefined), so `pathForView('content')` returns `/workspaces/content`, whose relative path 'content' is NOT in `TRAIL_ROOTS = ['workspace', 'settings', 'develop/pipeline', 'content/settings']` (src/workspaces/_data/nav.ts:27). The trail is dropped and the returned URL is the Content overview. The write path runs on every tab click: src/workspaces/content/settings/page.tsx:27 `const [active, setTab] = useTrailSegment(0, visibleTabIds, 'brand');` → page.tsx:77 `<Tabs tabs={tabs} active={active} onChange={setTab} />` → sections.tsx:50 `setTrail([...head, id])` → WorkspacesProvider.tsx:1453 `setTrail: (t) => { void navigate(pathForTrail(view, t)); }`.

### 5. "Go to Content" in the document image-reuse picker bounces on a Documents-only workspace

- **Severity** — broken
- **Where** — `src/workspaces/content/documents/[docId]/page.tsx:267`
- **Impact** — The 'documents' module unlocks exactly one section — `{ id: 'documents', ... sections: ['documents'] }` (modules.ts:44) — so a Documents-only workspace has no 'content' section. The empty-library row says "No images to reuse yet — images you create under Content show up here" with a "Go to Content" button; focusSetup navigates to view 'content', which is gateable and disabled, so WorkspacesShell.tsx:91-92 immediately navigates back to Documents. The button returns the user to the page they were already on.
- **Evidence** — fix={{ cap: 'workTickets', view: 'content', cta: translate({ key: 'workspaces.tips.documents.reuseEmptyCta' }) }}

### 6. Studio's missing-AI-provider fix bounces on a Design-only workspace

- **Severity** — broken
- **Where** — `src/workspaces/content/studio/page.tsx:173`
- **Impact** — 'studio' is unlocked by BOTH the content and the design module (modules.ts:41 lists 'studio' in the design module's sections), but 'content' is only in the content module. A Design-only workspace can therefore open Studio, see the `!readiness.aiText` notice, and click the fix — focusSetup goes to /workspaces/content/settings, viewFromPath yields the gateable view 'content', and WorkspacesShell.tsx:91-92 navigates away to the first enabled section. The provider keys are unreachable from the page that says they are missing.
- **Evidence** — fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'admin', cta: translate({ key: 'workspaces.setup.ai.cta' }) }}

### 7. Designer's missing-media-key fix bounces on a Design-only workspace

- **Severity** — broken
- **Where** — `src/workspaces/develop/designer/page.tsx:374`
- **Impact** — The Designer page is unlocked by the 'design' module, whose sections are `['designer','components','interviewer','marketing','scheduled','automations','studio']` (modules.ts:41) — 'content' is NOT among them. The fix targets view 'content/settings', which viewFromPath resolves to the gateable view 'content', so WorkspacesShell.tsx:90-92 redirects to the first enabled nav item. On a Design-only workspace the "add a media key" button returns the user to the Designer/first section; the fal key can never be reached from this notice, and the stub-preview warning stays forever.
- **Evidence** — fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'admin', cta: translate({ key: 'workspaces.setup.media.cta' }) }}

### 8. "Add stage → <kind>" creates the stage but selects the PREVIOUS one — two competing navigations in one handler

- **Severity** — broken
- **Where** — `src/workspaces/develop/pipeline/page.tsx:117`
- **Impact** — After picking a kind from the Add-stage menu the new stage appears at the end of the flow strip but the editor below still shows the stage that was already selected. Everything the user then types (name, system prompt, instructions) goes through `update()` which patches `st.id === selectedId` — i.e. it edits and, on "Save stage", overwrites the OLD stage's configuration. The freshly created stage is left with the seeded blueprint and no visible sign it was ever selected.
- **Evidence** — addStage(): `setSelectedId(key);` then `setTab('general');` — with `const [tab, setTab] = useTrailSegment(1, STAGE_TAB_IDS, 'general', [selectedId]);` (line 77). In useTrailSegment `set()` builds `const head = Array.from({ length: depth }, (_, i) => prefix[i] ?? trail[i] ?? ''); setTrail([...head, id]);` — so setTab writes `[selectedId, 'general']` using the OLD render's `selectedId`, and `setTrail` is `(t) => { void navigate(pathForTrail(view, t)); }` (WorkspacesProvider.tsx:1453). The second navigate overwrites the first: URL ends at `/develop/pipeline/<oldStageId>/general`, not `/<key>`.

### 9. "Add a channel" on the Schedules page bounces on a Development-only workspace

- **Severity** — broken
- **Where** — `src/workspaces/develop/scheduled/page.tsx:305`
- **Impact** — 'scheduled' is in the development module's section list (modules.ts:38), so this page is reachable on a workspace that has no 'content' section. The EmptyPicker ("No channels yet") offers "Add a channel", which focusSetup routes to /workspaces/content/settings/channels → view 'content' → blocked by the WorkspacesShell.tsx:90-92 gate → navigate(firstEnabled.id). The user is thrown back to the Board instead of the Channels tab, and the scheduled-task channel field stays empty.
- **Evidence** — fix={{ cap: 'workTickets', view: 'content/settings', tab: 'channels', cta: translate({ key: 'workspaces.tips.backlog.noChannelsCta' }) }}

### 10. Stage chips on Sources deep-link with stage NAMES into a slot that only accepts stage KEYS, so they always open the first stage

- **Severity** — broken
- **Where** — `src/workspaces/develop/sources/page.tsx:274`
- **Impact** — Tapping a stage chip ("Refined", "Plan", "Implementatie") on a context document or skill lands on /workspaces/develop/pipeline/Refined, which silently falls back to the FIRST stage. The user is shown the wrong stage's config with no indication anything was dropped — the exact opposite of the comment two lines above it ("tapping it should get you to that stage's config, not leave you to memorize the name").
- **Evidence** — `const onOpenStage = (stage: string) => { menuHandler.close(); focusSetup({ view: 'pipeline', tab: stage }); };` fed from `usedByStages`, documented in src/workspaces/_data/types.ts:708 as `usedByStages?: string[];   // stage names that load this doc` and seeded as `usedByStages: ['Refined', 'Plan', 'Implementatie']` (src/workspaces/_data/seed.ts:330). The pipeline validates that segment against stage IDs: src/workspaces/develop/pipeline/page.tsx:73 `const [selectedId, setSelectedId] = useTrailSegment(0, stages.map((st) => st.id), stageConfigs[0]?.id ?? '');`, and `id` is the slug key — server/read/workspaceSnapshot.ts:105 `id: s.key,` with keys `{ key: 'unrefined', ... name: 'Unrefined' }` / `{ key: 'impl', ... name: 'Implementation' }` (server/bootstrap/defaultPipeline.ts:45,61). sections.tsx:41 `const current = ids.find((id) => id === raw) ?? fallback;` is an exact match, so 'Refined' never resolves.

### 11. "Manage services" deep-links to the Settings tab that contains no services

- **Severity** — broken
- **Where** — `src/workspaces/workspace/page.tsx:823`
- **Impact** — The monorepo hint ("This repository holds {{n}} packages. Declare a service per unit to run and deploy them separately.") offers a "Manage services" button. It resolves to /workspaces/settings/workspace, and src/workspaces/settings/page.tsx:583-610 shows that tab renders only PatPanel (API tokens), ExperimentsPanel, StoragePanel and the JSON data-export FormSection — no service UI at all. Per-service rows live in the OTHER tab (`{showDevOps && tab === 'developer'` at line 613, projectServices at 736-760), and services are actually CREATED from the top-bar project menu (Shell.tsx:733 `onClick={openAddService}`) — which is exactly what the app's own copy says: `tips.settings.noServices` = "...once you add them under 'Add service' in the project menu at the top." The button lands the user on API tokens/storage/export and there is no way to manage a service from there.
- **Evidence** — fix={{ cap: 'workspaceSettings', view: 'settings', tab: 'workspace', cta: translate({ key: 'workspaces.repoScan.manageServices' }) }}

### 12. Permission-matrix cells for Admin/Member are clickable but every click is rejected server-side with no feedback

- **Severity** — broken
- **Where** — `src/workspaces/workspace/page.tsx:146`
- **Impact** — Admin and Member are seeded with `builtIn: true` (server/bootstrap/seedWorkspace.ts:58-60), so the conductor refuses every permission change to them — but the snapshot only marks Owner `locked`, so all Admin and Member cells render with `cursor-pointer`, hover states and an enabled button. Clicking one fires `togglePerm` -> `syncRequest('workspaces/roleUpdate')` whose result is discarded (`void syncRequest(...)`, WorkspacesProvider.tsx:1725). The cell does not change, no error appears, nothing at all happens. Two thirds of the visible permission matrix is a dead control; the code comment at workspace/page.tsx:161-165 admits it ("still look clickable and silently fail") and answers it with an InfoTip instead of a `locked` flag.
- **Evidence** — <PermCell on={r.perms[ci] ?? false} locked={r.locked} onToggle={() => { togglePerm(ri, ci); }} ariaLabel={...} />  // locked comes from server/read/workspaceSnapshot.ts:675 -> roles: roleRows.map((r) => ({ ..., locked: r.key === 'owner', ... }))  // rejected by server/orchestrator/conductor.ts:1939 -> if (existingRole.builtIn) return { ok: false, error: 'role.builtInImmutable' };

### 13. Modules tab keeps the previous workspace's toggles after a workspace switch, and Save writes them onto the new workspace

- **Severity** — broken
- **Where** — `src/workspaces/workspace/page.tsx:1121`
- **Impact** — `setActiveWorkspace` (WorkspacesProvider.tsx:1534-1547) only swaps the snapshot — it never navigates — so switching workspace from the top bar or the mobile drawer leaves this component mounted with stale state. The toggle grid then shows workspace A's enabled modules while the page header shows workspace B's name, and `save()` dispatches `saveSections(GATEABLE_SECTIONS.filter((s) => enabled.has(s)))`, which the provider posts to `snap.activeWorkspaceId` (line 1823-1826) — i.e. it overwrites workspace B's module set with workspace A's. Every sibling tab that holds workspace-derived state carries `key={activeWorkspace.id}` for exactly this reason; this one does not.
- **Evidence** — const [enabled, setEnabled] = useState<Set<string>>(() => new Set(!stored || stored.length === 0 ? GATEABLE_SECTIONS : stored));  // lazy initializer only, no re-seed effect; rendered as `{activeTab === 'modules' && <SectionsTab />}` (line 1601) with no key, unlike its siblings `<GitLabTab key={activeWorkspace.id} />` (1608) and `<WorkflowTab key={activeWorkspace.id} />` (1609)

### 14. Terminals empty state claims you can start a container from the Pipeline page, and its only button navigates there — the Pipeline page has no such control

- **Severity** — misleading
- **Where** — `src/_locales/en.json:2451`
- **Impact** — The user follows the empty state's only call-to-action to the Pipeline page expecting to start a container and get a terminal, and finds a stage-config editor with nothing to start. The terminal list stays empty and the suggested route is a dead end.
- **Evidence** — en.json:2451 `"emptyBody": "...activate a ticket's stage (or start a container from the Pipeline page) and its terminal appears here automatically within a few seconds."`, rendered at `terminals/page.tsx:120` with the single action `onClick={() => { navigate('pipeline'); }}` labelled `workspaces.terminals.emptyHint` ("Open the Pipeline page"). The pipeline destination contains no container-start affordance: `grep -n "activateWorktree|provision|startPreview|containerStart|stage-activate|activate" src/workspaces/develop/pipeline/*.tsx` returns nothing; `page.tsx` only offers `validate`, `PresetMenu`, `addStage(kind)` and stage-config tabs, and `stageTabs.tsx` destructures only `{ activeWorkspace, aiSkills }` / `{ docs, skills, focusSetup }`.

### 15. AI-layer tip's "Edit on the Carry-over tab" computes the carryover tab then discards it, landing on the pipeline's General tab

- **Severity** — misleading
- **Where** — `src/workspaces/_components/EffectivePromptPreview.tsx:82`
- **Impact** — On Workspace settings → AI behaviour, the "?" beside the workspace instruction offers "Edit on the Carry-over tab". Clicking it goes to /workspaces/develop/pipeline with an empty trail, so the pipeline opens on the first stage's General tab (develop/pipeline/page.tsx:77 `useTrailSegment(1, STAGE_TAB_IDS, 'general', [selectedId])`). The promised Carry-over tab is not even in the tab bar — it is an advanced tab, only shown when already active (page.tsx:176-177 `activeAdvanced ... visibleTabs`) or via the Advanced menu — so the user sees the persona/instructions fields instead of the carry-over template and has no visible cue where to go next.
- **Evidence** — const tab = target.id === 'carryOver' ? 'carryover' : 'general';\n    return () => { navigate('pipeline', stageId === undefined ? [] : [stageId, tab]); };  // `tab` is unused when stageId is undefined. Reached from src/workspaces/workspace/page.tsx:1321 `const workspaceTip = useLayerTip(layers, 'workspace');` (NO stageId argument), rendered at :1351 `infoPoints={workspaceTip.points}`. The carryOver point is always in that list: layersInChannel(layers,'system') = ['workspace','stageSystemPrompt','carryOver'] per _functions/aiLayers.ts:36 `system: ['workspace', 'stageSystemPrompt', 'carryOver']`. Its goLabel is `workspaces.aiLayers.goto_carryOver` = "Edit on the Carry-over tab".

### 16. Setup checklist's module filter uses the loose `isModuleEnabled`, so a content-only workspace IS told to link a git repository — the exact thing its header comment promises never happens

- **Severity** — misleading
- **Where** — `src/workspaces/_components/SetupChecklist.tsx:88`
- **Impact** — `sectionsForModules(['content'])` yields ['content','marketing','scheduled','automations','scheduled-posts','studio']; 'scheduled' and 'automations' are members of the development module too, so `isModuleEnabled(..., 'development')` returns true for a content-only workspace. It is therefore shown the repo row, the context-doc row and (once linked) the runtime row — none of which its modules can act on. The reverse holds too: a development-only workspace is shown the fal-media-key and publishing-channel rows. The file's own doc comment (lines 15-17) claims "every row is filtered by the workspace's enabled MODULES, so a content-only workspace is never told to link a git repository". The codebase already documents this trap and ships the correct strict alternative: server/ai/opCatalog.ts:920-925 — "`isModuleEnabled` is deliberately loose (any section counts) because the modules share sections — 'scheduled' belongs to development, content AND design — so a content-only workspace would read as 'development on'" — and keys op-gating on MODULE_SECTION instead.
- **Evidence** — const devEnabled = isModuleEnabled(activeWorkspace.enabledSections, 'development');  // modules.ts:76 -> return mod ? mod.sections.some((s) => enabledSections.includes(s)) : false;  // content sections include 'automations' and 'scheduled' (modules.ts:39), which are ALSO development sections (modules.ts:35)

### 17. Ticket preview tip's "Set start command" link drops the tab and lands on the Members tab, which has no start-command field

- **Severity** — misleading
- **Where** — `src/workspaces/develop/board/[ticketId]/page.tsx:220`
- **Impact** — Clicking "Set start command" navigates to /workspaces/workspace, where `useTrailSegment(0, tabs.map((t) => t.id), 'members')` (workspace/page.tsx:1555) resolves the empty trail to the Members tab. The user is shown the member list — no start-command field anywhere on screen — and must find Repository → Runtime themselves. The correct, already-routable target is focusSetup({ view: 'workspace', tab: 'repository', section: 'runtime' }).
- **Evidence** — onGo: () => { ctx.focusSetup({ view: 'workspace' }); },  // goLabel = translate({ key: 'workspaces.tips.ticket.previewCmdGo' }) = "Set start command". Justified by the comment above it: "the router registers exact page paths only, so the deeper address renders the error page" — falsified by src/main.tsx:129 `TRAIL_ROOTS.includes(finalPath.replace(/^\/workspaces\//, '')) ? [finalPath, `${finalPath}/*`] : [finalPath]` plus src/workspaces/_data/nav.ts:27 `TRAIL_ROOTS = ['workspace', 'settings', 'develop/pipeline', 'content/settings']`, so /workspaces/workspace/repository/runtime IS a registered route. The start command is edited only in RuntimeSection (workspace/page.tsx:729 `apiRequest({ name: 'workspaces/saveDevCommand' ... devCommand: previewCmd ...})`), mounted at workspace/page.tsx:1024 as the `runtime` section INSIDE the `repository` tab.

### 18. "Validate with AI" always reports "has AI on but no skills enabled — it'll work blind" for a condition no UI can resolve

- **Severity** — misleading
- **Where** — `src/workspaces/develop/pipeline/page.tsx:135`
- **Impact** — In any workspace created normally, pressing Validate lists one "<stage> has AI on but no skills enabled — it'll work blind" finding for every middle AI stage (5 of 7 on the default pipeline), every time, and there is no control anywhere in the product that can clear them — the Context tab's Skills picker is permanently empty by design. Two of the five rules the tooltip promises (`warnNetworkOff` and `warnRagMismatch`) are gated on the same `skillKeys` and can therefore never fire at all, so the check reports noise the user cannot act on while silently never running two of its rules.
- **Evidence** — `if (st.aiEnabled && st.skillKeys.length === 0 && st.order !== 0 && st.order !== stages.length - 1)` → warnBlind. `skillKeys` is only ever written by ContextTab's `update({ skillKeys: toggleKey(s.skillKeys, sk.id) })` over `skills`, and `skills` is `aiSkillRows.filter((skill) => skill.skillType === 'capability' ...)` (server/read/workspaceSnapshot.ts:597); `skillType: 'capability'` rows are created in exactly two places in the repo — server/bootstrap/seedWorkspace.ts:273 (demo seed) and server/db/schemaVersion.ts:112 (legacy migration). The app's own copy states it: "Nothing in the app creates one yet, and indexing the repository will not fill this list either."

### 19. Preset menu "Fill N empty fields from the defaults" counts fields that have no default; the count can never reach 0 and on a default pipeline the action writes nothing

- **Severity** — misleading
- **Where** — `src/workspaces/develop/pipeline/presets.tsx:105`
- **Impact** — Every project — including a fully configured one — permanently shows "Fill 8 empty fields from the defaults" (2 blank-by-design stages × 4 fields). The confirm dialog repeats the number ("writes ... into the 8 fields that are still empty"), the user confirms, a control-op round-trips, and zero fields change. `disabled: blanks === 0` is unreachable, so the item is never greyed out and the count never drops to 0 no matter how much the user fills in.
- **Evidence** — `const blanks = stages.reduce((n, s) => n + emptyPromptFields(s), 0);` where `emptyPromptFields` counts every empty one of the four prompt fields, with no check that a blueprint exists. The menu item is `{ label: translate({ key: 'workspaces.pipeline.presetFill', params: [{ key: 'count', value: String(blanks) }] }), ..., disabled: blanks === 0 }`. But `unrefined` and `final` are `...BLANK` in server/bootstrap/defaultPipeline.ts:45/81, and both keys are in EVERY preset (PRESET_STAGES, line 96-100), and the conductor only writes where the blueprint is non-empty: `if (st.systemPrompt.trim().length === 0 && bp.systemPrompt.length > 0) data.systemPrompt = bp.systemPrompt;` (conductor.ts:3993-3996).

