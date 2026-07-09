Reading complete. The ADOPTION_PROGRAM.md format is clear (VOORTGANG table + phased items, each with Verify). I'll produce the completion program covering every confirmed gap, grouped by dependency, with per-item Files/Verify/TAG.

# COMPLETION PROGRAM — elke gebouwde-maar-onbereikbare feature ontsluiten (het volgende grote /goal-bouwplan)

> Doel: de kloof dichten tussen **wat de engine kan** en **wat de gebruiker kan bereiken**. De 18 audit-clusters (2026-07-09) bevestigen één patroon: de backend is grotendeels echt (conductor-ops, PTY/Docker/ffmpeg/fal/ElevenLabs/YouTube, RBAC, RAG, CI, MR-review, compose-engine, deploy-ladder) maar honderden control-ops, _api-routes en agent-roles hebben **nul UI/AI-trigger** — plus een reeks scherpe security-gaten (privilege-escalation, owner-protection, push-body-lek, SSRF, prod-deploy-bypass). Draai met `/goal` over dit bestand, fase-voor-fase, **waterfall** (elke fase getest+gecommit vóór de volgende). Auteur-commits: `ItsLucky23`, niet gepusht. Alle bestaande invarianten blijven gelden (single-writer/B-23, frozen 7+6 structured-channel-verbs, `runInTenant`, PTY-billing, geen `as any`, tryCatch, i18n×4 en/nl/de/fr, theme-tokens, per-item test+ADR+branch-log+commit, gates tsc+lint+ai:lint+build). Premium-UX-DoD (FREEDOM_PROGRAM §0b) voor élk UI-item.

## Leidend principe (de rode draad door alle clusters)

De frozen-verb-regel (invariant 2) beperkt **entiteiten/verbs**, niet **hoevéél bestaande ops de AI mag voorstellen** of **hoeveel UI een bestaande op ontsluit**. Bijna elke `.ai`-gap ("AI kan X niet") en `.ui`-gap ("geen knop voor X") is dus geen nieuw-verb-werk maar **wiring** van iets dat al bestaat. Daarom bouwen we eerst de generieke ontsluit-mechanismen (FASE X) en registreren daarna per feature-fase de ops. Elke write blijft `[control-API] → preApiExecute RBAC → enqueue → Conductor` (single-writer intact); destructieve ops houden hun confirm-gate.

## TAG-legenda

- **`now`** — code + UI + AI + **fixture/stub-test** haalbaar deze run. Volledig af te ronden zonder echte keys/live-Docker/deploy.
- **`final-live`** — kern-code + **e2e-scaffold (gestubde provider) NU**, maar de échte proof vergt live keys/tokens/Docker/deploy/echt device/mens → verplaatst naar **FASE Z (FINAL-LIVE)** aan het eind. Nooit een nep-succes; honest-degrade blijft.

---

## VOORTGANG (levend — bijgewerkt per gecommit increment)

| Item | Status | ADR | Test | TAG |
|---|---|---|---|---|
| X1 op-catalog: propose-safe op-catalog vervangt 5-op-enum | ⬜ | | | now |
| X2 copilot-propose e2e (emitter→snapshot-patch→accept→directive-applier) | ⬜ | | | now |
| X3 chat-persistentie + multi-turn-threading | ⬜ | | | now |
| **FASE X COMPLEET** | ⬜ | | | |
| SEC1 change-role privilege-ceiling + owner-protection + promoteAdmin | ⬜ | | | now |
| SEC2 role-create/update cap-ceiling + built-in-immutability + admin-gate | ⬜ | | | now |
| SEC3 remove-member owner-protection | ⬜ | | | now |
| SEC4 push-body-redactie (fullBodyOptIn) | ⬜ | | | now |
| SEC5 single-notification mark-read userId-scoping | ⬜ | | | now |
| SEC6 webhook SSRF-hardening | ⬜ | | | now |
| SEC7 prod env-deploy gate (promote-ladder-bypass dichten) | ⬜ | | | now |
| SEC8 env-teardown confirm (B-23) | ⬜ | | | now |
| SEC9 repoStore token via credential-helper (uit argv) | ⬜ | | | now |
| **FASE SEC COMPLEET** | ⬜ | | | |
| A1 pause-all-confirm + resume-all-banner + mobiel + paused-badge | ⬜ | | | now |
| A2 terminal panel-menu-acties (kill/clear/restart/rename/copy) | ⬜ | | | now |
| A3 ws-term prod-gate-split (container-exec altijd, host-shell achter flag) | ⬜ | | | now |
| A4 advisory-questions render + advisoryIndex threaden | ⬜ | | | now |
| A5 preview-up/down beslissen (cases of uit union) | ⬜ | | | now |
| A6 capacity/queue-meter (snapshot + header) | ⬜ | | | now |
| A7 live-agent-transcript tee (ws-term:out per ticket) | ⬜ | | | now |
| **FASE A COMPLEET** | ⬜ | | | |
| B1 sprint-edit e2e (sync-route+provider+backlog-menu+conductor-dates+snapshot) | ⬜ | | | now |
| B2 board-card ⋯: pause/resume + stage-dropdown + add-reference | ⬜ | | | now |
| B3 board-i18n de/fr backfill (9 keys) | ⬜ | | | now |
| B4 edit-ticket AI-actie | ⬜ | | | now |
| B5 stale-comments board/backlog | ⬜ | | | now |
| **FASE B COMPLEET** | ⬜ | | | |
| G1 time-travel-launcher (commit/main-minus-X/as-of) op ticket-detail | ⬜ | | | now |
| G2 time-travel AI-actie (RefSpec-propose) | ⬜ | | | now |
| G3 forge-token Verify (echte ping) | ⬜ | | | now |
| G4 'sync issues now' (gitlab-resync) + open-ref-preview-UI | ⬜ | | | now |
| G5 Connections-badge uit echte forge-state | ⬜ | | | now |
| G6 webhook-URL + secret-UI + last-event-indicator | ⬜ | | | now |
| G7 gitlab-baseUrl-default uit stored/blank | ⬜ | | | now |
| G8 AI propose save-git-config + gitlab-resync | ⬜ | | | now |
| **FASE G COMPLEET** | ⬜ | | | |
| E1 Monaco-Changes readOnly-diff (of echte worktree+save-scaffold) | ⬜ | | | now |
| E2 editor-chrome i18n (VsCodeEmbed/CodeEditorPanel/FileExplorer) | ⬜ | | | now |
| E3 in-app preview-iframe + Start/Stop/Reload (closePreview-UI) | ⬜ | | | now |
| E4 dev-command-failure actionable card | ⬜ | | | now |
| **FASE E COMPLEET** | ⬜ | | | |
| K1 Services-panel (ServiceStack-lijst+compose+teardown) + snapshot | ⬜ | | | now |
| K2 preset-galerij (_api listServicePresets + cards) | ⬜ | | | now |
| K3 Database-panel (connect/migrate/apply-gated/introspect) + snapshot | ⬜ | | | now |
| K4 AI propose infra-ops (preset-provision/db-connect/migrate-create) | ⬜ | | | now |
| K5 Dockerfile/build scope naar active-project | ⬜ | | | now |
| K6 ProjectSummary baseImageRef + build-status in snapshot | ⬜ | | | now |
| K7 migrate base-image default → WS_BASE_IMAGE (0.1.0) | ⬜ | | | now |
| **FASE K COMPLEET** | ⬜ | | | |
| I1 MR-panel: AI-review-knop + Run-CI + Checks-sectie + ci-reason-branches | ⬜ | | | now |
| I2 PipelineRun + security-findings in snapshot + promote-scherm | ⬜ | | | now |
| I3 plan-critique ticket-scoped trigger-knop | ⬜ | | | now |
| I4 root-cause symptom-input (focus→symptom of incident-box) | ⬜ | | | now |
| I5 AutomationPanel invoke-agent-role event-actie (role-picker) | ⬜ | | | now |
| I6 ci-allow-red admin-toggle | ⬜ | | | now |
| I7 CI-event tint/label ('ci'-case) | ⬜ | | | now |
| I8 AI propose review-mr/rollback | ⬜ | | | now |
| **FASE I COMPLEET** | ⬜ | | | |
| D1 demo-host-card (deploy+autoRedeploy+pinnedCommit) | ⬜ | | | now |
| D2 bundle-vs-image export-keuze | ⬜ | | | now |
| D3 per-service environments sub-lijst | ⬜ | | | now |
| D4 deploy-hook settings-veld + result-surface | ⬜ | | | now |
| D5 AI propose deploy/promote/build-export | ⬜ | | | now |
| **FASE D COMPLEET** | ⬜ | | | |
| R1 knowledge-graph-pagina (N2-renderer, force-layout, nav) | ⬜ | | | now |
| R2 Sources dead-buttons (Regenerate/Reindex) impl of disable | ⬜ | | | now |
| R3 Sources stale-header-comment | ⬜ | | | now |
| **FASE R COMPLEET** | ⬜ | | | |
| S1 Audit-tab (admin-gated, workspaces/auditLog) | ⬜ | | | now |
| S2 workspace-data-export-knop (workspaceExport) | ⬜ | | | now |
| S3 PAT-beheer (issue/list/revoke) + listPats_v1 | ⬜ | | | now |
| S4 account profile name/avatar edit (wire of hide) | ⬜ | | | now |
| S5 SSH-keys persistent per account (seed-map weg) | ⬜ | | | now |
| S6 pending-invites echte sent/expiry + resend + copy-link | ⬜ | | | now |
| S7 audit-completeness (rename/role-create/delete-out-of-tenant) | ⬜ | | | now |
| S8 geminiTemperature numeric-clamp 0–2 | ⬜ | | | now |
| S9 provider-feature-rows i18n-labels | ⬜ | | | now |
| **FASE S COMPLEET** | ⬜ | | | |
| T1 5 dode trigger-events emitten (of uit UI-lijst) | ⬜ | | | now |
| T2 Output-Templates-manager + wire in render/export | ⬜ | | | now |
| T3 webhook in TRIGGER_ACTIONS-narrowing | ⬜ | | | now |
| T4 AI propose trigger-save/custom-task | ⬜ | | | now |
| T5 automations-nav voor content/design-modules | ⬜ | | | now |
| T6 run-command + invoke-workspace-ai executors (of uit union) | ⬜ | | | now |
| T7 trigger-match-facets-UI (stages/status/project/debounce/dedupe) | ⬜ | | | now |
| T8 custom-task {{var}}-prompt vóór run | ⬜ | | | now |
| T9 trigger-delete-confirm (beide surfaces) | ⬜ | | | now |
| T10 Run-now op AutomationPanel-rijen | ⬜ | | | now |
| T11 emit-signal 'signal kind'-veld + help | ⬜ | | | now |
| T12 scheduled.runNow de/fr-vertaling | ⬜ | | | now |
| **FASE T COMPLEET** | ⬜ | | | |
| P1 token-budget product-truth-beslissing (drop of token-volume + enforce) | ⬜ | | | now |
| P2 per-user spend-attributie in snapshot + Usage 'by person' | ⬜ | | | now |
| P3 budget-card op Usage (edit-budget/resume-spend) of ops-weg | ⬜ | | | now |
| P4 AI propose pause-all/resume-all/raise-cap | ⬜ | | | now |
| P5 multi-cap impl of schema-trim | ⬜ | | | now |
| P6 media-budget reconcile met echte provider-cost | ⬜ | | | now |
| P7 capacity-surface (active/queued in snapshot + indicator) | ⬜ | | | now |
| P8 token-budget currency-label (€ weg / token-unit) | ⬜ | | | now |
| P9 usage stale-comment | ⬜ | | | now |
| P10 media-budget buiten Content-module (confirm/expose) | ⬜ | | | now |
| **FASE P COMPLEET** | ⬜ | | | |
| N1 mobiele notificatie-bel + sheet (MobileChrome) | ⬜ | | | now |
| N2 presence-AvatarStack echt (of drop) | ⬜ | | | now |
| N3 presence-engine wired (aggregatePresence + per-view-counts) of drop | ⬜ | | | now |
| N4 notificatie-klik → deepLink-navigatie | ⬜ | | | now |
| N5 push-url deep-path (/?ticket=<key>) + sw.js-landing | ⬜ | | | now |
| N6 settings push-toggle reconcile met getSubscription | ⬜ | | | now |
| N7 install-app-affordance (beforeinstallprompt) | ⬜ | | | now |
| **FASE N COMPLEET** | ⬜ | | | |
| CC1 content stage auto-advance + manuele 'Advance stage' | ⬜ | | | now |
| CC2 'New content piece'-knop (brief → content-from-brief) | ⬜ | | | now |
| CC3 active content-Project hergebruiken (content-create in-project) | ⬜ | | | now |
| CC4 piece-detail lifecycle-controls (advance/archive/unarchive) | ⬜ | | | now |
| CC5 Archived-view + restore | ⬜ | | | now |
| CC6 AI chain create-content→run-pipeline | ⬜ | | | now |
| CC7 unpublish-knop + per-platform-delete-adapter (of 'retracted') | ⬜ | | | now |
| CC8 contentControl-allowlist-drift wegwerken | ⬜ | | | now |
| **FASE CC COMPLEET** | ⬜ | | | |
| CG1 3D needs-ref chain (image→triposr) | ⬜ | | | now |
| CG2 AI content-gen-ops reachable | ⬜ | | | now |
| CG3 avatar-generatie-UI + actAvatar-keys | ⬜ | | | now |
| CG4 reference-video-analyse-UI | ⬜ | | | now |
| CG5 short-form hook/captions via 'script'-AiFeature | ⬜ | | | now |
| **FASE CG COMPLEET** | ⬜ | | | |
| CP1 scheduledAt e2e (clientInput + date-picker + posts-calendar) | ⬜ | | | now |
| CP2 publish-composer (caption/hashtags/privacy → publishVariants) | ⬜ | | | now |
| CP3 multi-account-routing (accountId + accounts[] + picker + parse-fix) | ⬜ | | | now |
| CP4 audience-analytics ingest-loop + insights + ideator-feedback | ⬜ | | | now |
| CP5 AI propose publish/schedule | ⬜ | | | now |
| CP6 publishJobs[] in snapshot + status-chips + external-link | ⬜ | | | now |
| CP7 content-unpublish-knop (retract-label) | ⬜ | | | now |
| CP8 channel-edit-form (rename/platform/handle/defaultStyleId) | ⬜ | | | now |
| CP9 disconnect per-account (accountId) | ⬜ | | | now |
| CP10 IG/LinkedIn roadmap-consistentie (hide of coming-soon) | ⬜ | | | now |
| CP11 de.json mojibake publishTitle | ⬜ | | | now |
| CP12 Scheduled-posts-tab voor content-workspaces | ⬜ | | | now |
| **FASE CP COMPLEET** | ⬜ | | | |
| CB1 AI propose content-config-ops (reference/brand/style/channel) | ⬜ | | | now |
| CB2 brand-kit export/import-UI + keys | ⬜ | | | now |
| CB3 style-set export/import-UI + keys | ⬜ | | | now |
| CB4 channel-edit + defaultStyleId in snapshot-fold | ⬜ | | | now |
| CB5 copy-from-workspace-UI (copyWorkspaceAssets) | ⬜ | | | now |
| CB6 style preview-asset upload + thumbnail-gallery (M4) | ⬜ | | | now |
| CB7 retrieveChannelBrand wired of indexChannelBrand-drop | ⬜ | | | now |
| CB8 style-edit (pencil pre-fill) | ⬜ | | | now |
| CB9 brand-voice-edit in settings channel-rij | ⬜ | | | now |
| CB10 media-key stale-comment | ⬜ | | | now |
| **FASE CB COMPLEET** | ⬜ | | | |
| DS1 Designer-animations save/persist (useInProject 'animation') | ⬜ | | | now |
| DS2 AI propose studio/designer/interviewer-generatie | ⬜ | | | now |
| DS3 thumbnail/videoScript in agent-role KINDS_FOR (of doc-exclusie) | ⬜ | | | now |
| DS4 brandExport/Import-knoppen in BrandPanel | ⬜ | | | now |
| DS5 module-taxonomie: studio/brand+landing onder Design-module | ⬜ | | | now |
| DS6 decoupled 'save to library' (los van activate) | ⬜ | | | now |
| DS7 interviewer 'Generate ideas now'-knop | ⬜ | | | now |
| DS8 studio async-generatie-job (generating→ready/error) | ⬜ | | | now |
| DS9 studioSaveBrief projectId persist | ⬜ | | | now |
| DS10 studio thumbnail render-to-PNG export | ⬜ | | | now |
| **FASE DS COMPLEET** | ⬜ | | | |
| **FASE Z — FINAL-LIVE (alle deferred proofs)** | ⬜ | | | final-live |

---

## FASE X — Cross-cutting ontsluit-mechanismen (eerst; ontgrendelt ~30 `.ai`/`.ui`-gaps)

- **X1 — Generieke propose-safe op-catalog.** Vervang de hardgecodeerde 5-op-enum (`server/ai/workspaceChat.ts:48`, `validateChatAction:83-125`) door een **gegenereerde catalog** uit `OP_CAPABILITY` (`server/control/rbac.ts:46-185`) + een per-op propose-schema: elke `read|propose`-veilige op wordt voorstelbaar, nog steeds gevalideerd + RBAC-gated + Conductor-uitgevoerd. Destructieve ops (`kill`, `pause-all`, `delete-workspace`, `env-teardown`, `remove-member`) blijven expliciet uitgesloten of vereisen de confirm-flag. Dit is de root-fix achter de "AI kan slechts ~3.6% van de writes" bevinding. **Files:** `server/ai/workspaceChat.ts`, `server/control/rbac.ts`, nieuwe `server/ai/opCatalog.ts`. **Verify:** fixture — AI stelt een eerder-onbereikbare veilige op voor (bv. `sprint-edit`) → gevalideerd + gated + geen directe write; destructieve op geweigerd zonder confirm. **TAG: now.**
- **X2 — copilot-propose end-to-end.** De hele "AI-drives-UI"-keten is dood: geen emitter, `asSugType` dropt `'copilot'→'maintenance'`, projectie laat `patch` weg, accept flipt alleen status, geen client-directive-applier. Wire: chat emit `copilot-propose`; voeg `'copilot'` toe aan `asSugType`; draag `patch` in de suggestion-projectie; copilot-accept-branch; client-applier (navigate → prefill target-form → confirm de embedded op). **Files:** `server/ai/workspaceChat.ts`, `server/read/workspaceSnapshot.ts:64,492`, `server/orchestrator/conductor.ts:1657,1762-1790`, `src/workspaces/_shell/Shell.tsx:706-725`. **Verify:** fixture chat → `copilot-propose` → suggestion draagt `patch` → accept navigeert+prefilt+confirmt de op. **TAG: now.**
- **X3 — Chat-persistentie + multi-turn.** Chat is ephemeral client-state (`WorkspacesProvider.tsx:795`), verloren bij reload, en `interpretChat` is stateless (`workspaceChat.ts:141`, `aiChat_v1.ts:19`). Voeg `WorkspaceChatMessage`-model + snapshot-read; thread de laatste N turns in `interpretChat` + prompt. **Files:** `schema.prisma`, `workspaceSnapshot.ts`, `workspaceChat.ts:141`, `aiChat_v1.ts:19`, `WorkspacesProvider.tsx:795`. **Verify:** turns overleven reload (phone/desktop-consistent); follow-up "doe dat ook voor het andere ticket" resolveert met historie. **TAG: now.**

## FASE SEC — Security-critical hardening (Rule 19; vroeg, vóór feature-werk)

- **SEC1 — change-role privilege-ceiling + owner-protection.** `change-role` is enkel op `manageMembers` gegated; `CAP.promoteAdmin` (index 5) wordt door **geen enkele op** gebruikt. Vergelijk bron- vs doel-rol-privilege, vereis `promoteAdmin`/`demoteAdmin` vóór `roleKey`, wire de dode capability, en weiger `change-role` als `target === ownerId`. **Files:** `rbac.ts:62`, `conductor.ts:536-542`. **Verify:** `manageMembers`-only-houder kan niemand naar een `ownerActions`-rol tillen; owner-role-change geweigerd. **TAG: now.**
- **SEC2 — role-create/update cap-ceiling + built-in-immutability.** `role-create/update` gegated op `editPipeline` (mid-tier) en schrijven perms zónder ceiling/immutability (`locked` is client-only). Server-side cap-ceiling (actor kan geen perm geven die hij mist), block built-in-role-edit, gate op admin-cap, + `recordAudit` op create. **Files:** `conductor.ts:738-754`, `rbac.ts:67-68`. **Verify:** pipeline-editor kan geen perm geven die hij mist; built-in-role-edit geblokkeerd; role-create schrijft audit-rij. **TAG: now.**
- **SEC3 — remove-member owner-protection.** Een crafted sync-request kan de owner-membership verwijderen → dangling `ownerId`. Weiger `remove-member` als `memberId === ownerId` server-side. **Files:** `conductor.ts:714-720`. **Verify:** owner-removal geweigerd. **TAG: now.**
- **SEC4 — push-body-redactie (fullBodyOptIn).** Getekende beslissing (Q-SEC-NOTIF-PUSH): `fullBodyOptIn` wordt opgeslagen+getypeerd maar **nergens gelezen** — de volledige `Notification.body` gaat altijd naar het lock-scherm. In `sendWebPush` per subscription `fullBodyOptIn` opzoeken; bij `false` alleen `{title,tag,url}` + generieke "Open to view". **Files:** `server/hooks/webPush.ts:67`, `public/sw.js:14`. **Verify:** sub met `fullBodyOptIn=false` → payload zonder body. **TAG: now** (fixture); echt device = FASE Z.
- **SEC5 — single-notification mark-read userId-scoping.** De single-branch mist `userId` in de `where` → een member kan andermans notificatie read-marken. Voeg `userId` toe. **Files:** `conductor.ts:2088`. **Verify:** member B kan notificatie van A niet markeren. **TAG: now.**
- **SEC6 — webhook SSRF-hardening.** De `webhook`-actie POST naar een willekeurige user-URL zonder blok op internal/loopback/link-local/metadata (self-hosted multi-tenant-risico). Blokkeer private targets of vereis allowlist. **Files:** `executor.ts:64-74`. **Verify:** private/loopback/link-local/metadata geweigerd. **TAG: now.**
- **SEC7 — prod env-deploy gate (promote-bypass dichten).** De prod-Deploy-knop roept `deployEnv({kind:'prod'})` **direct** aan en omzeilt de approval/CI/security-gates die `promoteEnvironment` afdwingt. Gate `env-deploy` bij `kind='prod'` achter dezelfde check, óf verberg de directe Deploy-knop op de prod-rij. **Files:** `conductor.ts:1907-1918`, `settings/page.tsx:293`. **Verify:** directe prod-deploy geweigerd/verborgen; prod alleen via gated promote. **TAG: now** (gate-logica); echte promote = FASE Z.
- **SEC8 — env-teardown confirm (B-23).** `env-teardown` is destructief (kill container + route weg) maar ontbreekt in `CONFIRM_REQUIRED` en de knop vuurt direct. Voeg toe aan `CONFIRM_REQUIRED` + wrap in `menuHandler.confirm` (model = prod-promote-knop). **Files:** `controlApi.ts:138-140`, `settings/page.tsx:294`. **Verify:** teardown vraagt confirm. **TAG: now.**
- **SEC9 — repoStore token via credential-helper.** Clone-token wordt via argv/URL doorgegeven i.p.v. een git credential-helper/askpass. Verplaats token-injectie zodat het nooit `process.argv` raakt. **Files:** `server/git/repoStore.ts:8-10`. **Verify:** token niet in argv; credential-helper gebruikt (unit). **TAG: now** (unit); live clone = FASE Z.

## FASE A — Agent-runtime & live-control (noodstop, terminals, advisory)

- **A1 — Noodstop compleet (pause-all + resume-all + mobiel + indicator).** `pause-all` discardt de confirm-boolean → `ctx.pauseAll()` wordt nooit geroepen; `resume-all` heeft **nul** callers; er is geen paused-indicator; de knop zit achter `!isMobile`. Fix: `menuHandler.confirm(...).then(ok => ok && ctx.pauseAll())`; persistente "Engine paused — Resume all"-banner gegated op `ctx.workspacePaused` (`WorkspacesProvider.tsx:623-625`) met knop → `ctx.resumeAll()` (`:1086`); header-badge; mobiel bereikbaar. **Files:** `page.tsx:334-336`, `_shell/*`, `MobileChrome.tsx`, `board/[ticketId]/page.tsx:202`. **Verify:** confirm→pauseAll geroepen; banner + resume werkt; zichtbaar+bereikbaar op mobiel. **TAG: now.**
- **A2 — Terminal panel-menu-acties.** `restart/clear/rename/copyBuffer` zijn lege `/* Fase 2 */`-stubs; `kill` opent confirm zonder `.then`. Wire `kill`→`ws-term:kill`-emit (relay = `workspacesTerminal.ts:91-94`), `clear/restart`→xterm-reset+PTY-respawn; anders items verwijderen. **Files:** `terminals/page.tsx:63-68`. **Verify:** kill emit; clear/restart reset+respawn (fixture). **TAG: now** (fixture); live-PTY = FASE Z.
- **A3 — ws-term prod-gate-split.** De hele ws-term-middleware returnt early tenzij non-prod of `WORKSPACES_TERMINAL_ENABLED=1` → op prod attachen panels nooit. Splits de host-shell-RCE-gate van het container-PTY-pad: registreer de container-exec-relay altijd (valideert al `isWorkspacesContainer`), houd alleen de bare host-shell achter de flag. **Files:** `workspacesTerminal.ts:35-36`. **Verify:** container-relay geregistreerd bij `NODE_ENV=production`; host-shell nog gegated. **TAG: now.**
- **A4 — Advisory-questions render + advisoryIndex.** Advisory-vragen worden gegenereerd+opgeslagen+resolvbaar maar nooit gerenderd; `answerInput`-sync forwardt alleen `answer`, nooit `advisoryIndex` → conductor-resolve-pad (`940-953`) onbereikbaar. Render advisory-lijst op het ticket; thread `advisoryIndex` door de payload. **Files:** `answerInput_server_v1.ts:15`, `board/[ticketId]/page.tsx`, `conductor.ts:940-953`. **Verify:** advisory rendert; `advisoryIndex` bereikt conductor. **TAG: now.**
- **A5 — preview-up/preview-down beslissen.** Beide zitten in de op-union + RBAC maar hebben geen conductor-case (default no-op) en geen caller; preview loopt via `openPreview/closePreview`-_api. Óf conductor-cases die `openPreviewForTicket/closePreviewForTicket` roepen, óf uit union + `OP_CAPABILITY` verwijderen; documenteer als ADR. **Files:** `controlApi.ts:74`, `conductor.ts:2092-2096`, `rbac.ts:182-183`. **Verify:** echte cases óf verwijderd; ADR legt keuze vast. **TAG: now.**
- **A6 — Capacity/queue-meter.** `activeCount()/queueLength()` worden berekend maar nooit getoond. Voeg toe aan de snapshot + kleine "N running / M queued"-indicator in shell/Terminals-header. **Files:** `capacity.ts`, `workspaceSnapshot.ts`. **Verify:** snapshot exposeert active/queued; meter rendert. **TAG: now.** (gedeeld met P7.)
- **A7 — Live-agent-transcript tee.** De container-turn-PTY-output wordt gedraind+weggegooid (laatste ~8KB voor handshake). Tee de gebufferde stream naar een `ws-term:out`-kanaal gekeyed op ticket zodat een "Live agent"-view kan tailen. **Files:** `stageRunner.ts:116`. **Verify:** fixture — stream ge-tee'd naar kanaal. **TAG: now** (fixture); live tail = FASE Z.

## FASE B — Board, tickets & sprints

- **B1 — Sprint-edit end-to-end.** De conductor-case (`707-712`) + RBAC (`rbac.ts:57`) + op (`controlApi.ts:29`) bestaan maar er is **geen** `sprintEdit_server`-sync-route, geen provider-methode, geen UI; de case schrijft bovendien alleen `name+active`, niet `start/end`. Voeg `sprintEdit_server_v1.ts` (mirror `sprintCreate`), `provider.editSprint(id,{name?,active?,start?,end?})`, per-sprint-menu (activate/rename/dates) in backlog; breid de case uit met `start/end`; source `start/end` uit echte sprint-rows in de snapshot (nu hardcoded `null`). **Files:** `conductor.ts:707-712`, `WorkspacesProvider.tsx:734`, `workspaceSnapshot.ts:491`, `backlog/page.tsx`. **Verify:** create→activate→rename→dates persisteert; 'Active'-badge + datum-ranges vullen. **TAG: now.**
- **B2 — Board-card ⋯-wiring.** `Pause/Resume agent` is dood (terwijl `pauseTicket/resumeTicket` live werken op ticket-detail); `Add reference` is een dode knop; geen board-stage-move. Wire pause/resume→`ctx.pauseTicket/resumeTicket(ticket.id)`; voeg per-card stage-dropdown (hergebruik `bulkMove`); wire `Add reference` naar de artifact-link-flow óf verwijder. **Files:** `page.tsx:58-78,63,65`. **Verify:** pause/resume roepen ctx; stage-dropdown verplaatst; add-reference wired of weg. **TAG: now.**
- **B3 — Board-i18n de/fr backfill.** 9 `workspaces.board.*`-keys ontbreken in `de.json`+`fr.json` (`newTicketTitle`, `newTicketTitlePlaceholder`, `newTicketStage`, `allSprints`, `allStatuses`, `allAssignees`, `filterStatus`, `filterAssignee`, `clearFilters`). Backfill. **Files:** `de.json`, `fr.json`. **Verify:** per-locale parse — 9 keys in alle 4 locales. **TAG: now.**
- **B4 — Edit-ticket AI-actie.** Voeg (via X1) een `edit-ticket`-voorstelbare actie (title/desc/priority/labels) gevalideerd tegen bestaande ticket-keys, geroute naar `workspaces/ticketEdit` (Conductor-uitgevoerd). **Files:** `workspaceChat.ts`. **Verify:** "rename DEV-3 / bump priority" → `edit-ticket`-voorstel. **TAG: now.**
- **B5 — Stale-comments.** Header-comments beweren 'dummy data' terwijl board/backlog live snapshot-rows renderen. Corrigeer. **Files:** `page.tsx:8`, `backlog/page.tsx:5`. **Verify:** comments weerspiegelen live snapshot. **TAG: now** (doc-only).

## FASE G — Git / forge / time-travel / preview

- **G1 — Time-travel-launcher.** De volledig gebouwde+unit-geteste `timeTravelPreview_v1` / `openRefPreview_v1` hebben **nul** callers. Voeg op ticket-detail (naast `openPreview`) een launcher: commit-picker / "main minus commit X" / date-picker → `timeTravelPreview` → surface de ref-preview-URL + conflict/AI-help-state. **Files:** `board/[ticketId]/page.tsx:193-198`, `timeTravelPreview_v1.ts`, `openRefPreview_v1.ts`. **Verify:** launcher roept route → preview-URL opent; conflict-state getoond (stub-runtime). **TAG: now**; live ref-container = FASE Z.
- **G2 — Time-travel AI-actie.** De AI is nu geïnstrueerd om time-travel **niet** te triggeren (`action=null`, verwijst naar een niet-bestaande control). Zodra G1 er is: laat de AI (via X1) een time-travel-RefSpec-actie voorstellen. **Files:** `workspaceChat.ts:57`. **Verify:** "toon de versie van gisteren" → RefSpec-voorstel accept-to-run. **TAG: now.**
- **G3 — Forge-token Verify (echte ping).** UI-`onClick` is leeg en de conductor `gitlab-verify`-case is een no-op. Implementeer een echte forge-ping (`GET /api/v4/user` GitLab / `/user` GitHub via `resolveForge`), ok/fail-toast. **Files:** `workspace/page.tsx:370`, `conductor.ts:837-839`. **Verify:** verify hit /user-endpoint (fixture) + toast. **TAG: now** (fixture); echt token = FASE Z.
- **G4 — 'Sync issues now' + open-ref-preview-UI.** `gitlab-resync` (conductor `841-848`) + `openRefPreview` hebben geen caller. Voeg een "Sync issues now"-knop (board/backlog/GitLab-tab) die `gitlab-resync` dispatcht + een raw-ref-veld dat `openRefPreview` opent. **Files:** `conductor.ts:841-848`, `openRefPreview_v1.ts`. **Verify:** knop dispatcht resync; raw-ref opent preview. **TAG: now.**
- **G5 — Connections-badge uit echte state.** Settings toont een **hardcoded** groene "GitLab — Connected"-badge. Drijf de badge uit de echte forge-config / een verify-resultaat. **Files:** `settings/page.tsx:266-269`. **Verify:** badge weerspiegelt config/verify. **TAG: now.**
- **G6 — Webhook-URL + secret-UI.** Geen in-app manier om de per-workspace webhook-URL te ontdekken of het secret te zetten (`WS_WEBHOOK_SECRET` = env-only). Toon op de forge-tab de copyable `/webhooks/forge/<workspaceId>`-URL + gegenereerd/roteerbaar secret + paste-instructies + "last event received"-indicator. **Files:** forge-settings-tab, webhook-route. **Verify:** URL+secret+last-event getoond (fixture). **TAG: now** (UI+fixture); echt inbound event = FASE Z.
- **G7 — gitlab-baseUrl-default.** Default is hardcoded op de slug (`youcomm-core`→`gitlab.youcomm.nl`). Default uit de opgeslagen `gitlabUrl` of leeg met placeholder. **Files:** `workspace/page.tsx:349`. **Verify:** default sourcet stored value. **TAG: now.**
- **G8 — AI propose git-config/resync.** Voeg (via X1) `save-git-config` + `gitlab-resync` toe aan de voorstelbare set als accept-to-run-kaarten. **Files:** `workspaceChat.ts`. **Verify:** branch-strategy-wijziging/resync voorstelbaar. **TAG: now.**

## FASE E — Code-editor & preview

- **E1 — Monaco-Changes readOnly (of echte save).** De Changes-tab reconstrueert content uit diff-lines (geen echte worktree, geen save-pad) maar toont een "● N unsaved"-indicator die edits uitnodigt die nooit persisten. Óf wire naar echte worktree-content + save-op, óf zet `readOnly` en label als read-only diff-viewer (unsaved-affordance weg). Default nu: `readOnly` + scaffold voor de save-op. **Files:** `board/[ticketId]/page.tsx:110-121`, `CodeEditorPanel.tsx:165,194`. **Verify:** `readOnly` (geen unsaved-affordance) óf `onSave` gewired. **TAG: now** (readOnly); echte worktree-save = FASE Z.
- **E2 — Editor-chrome i18n.** `VsCodeEmbed`/`CodeEditorPanel`/`FileExplorer` disablen `jsx-no-literals` en hardcoden Engelse labels. Verplaats naar `useTranslator` + keys in 4 locales. **Files:** `VsCodeEmbed.tsx:8`, `CodeEditorPanel.tsx:12`, `FileExplorer.tsx:10`. **Verify:** labels via translator; keys in en/nl/de/fr. **TAG: now.**
- **E3 — In-app preview-iframe + Start/Stop/Reload.** Preview opent in een nieuw tab (`globalThis.open`) en er is geen in-app close (`closePreview` heeft nul UI-trigger). Bied een inline responsive preview-iframe (hergebruik de VsCodeEmbed-shell) met Start/Stop/Reload gewired aan `openPreview/closePreview`. **Files:** `board/[ticketId]/page.tsx:196`, `WorkspacesProvider.tsx:1094`. **Verify:** inline iframe; Stop roept `ctx.closePreview`. **TAG: now** (UI); live preview = FASE Z.
- **E4 — Dev-command-failure actionable card.** `DevCommandCard` rendert alleen bij `repo.linked` en zit begraven in settings; een `preview.notReady/notActivated`-failure geeft geen pointer. Op preview-failure een inline card die linkt naar de dev-command-setting (+ AI-aanbod om `devCommand` te zetten). **Files:** `workspace/page.tsx:651`. **Verify:** failure surfacet actionable card. **TAG: now.**

## FASE K — Docker, services & databases

- **K1 — Services-panel.** De compose-engine (`service-provision/service-teardown`) heeft **nul** client-entry en zit niet in de snapshot. Voeg een Services-panel: `ServiceStack`-lijst met status, compose-textarea → `serviceProvision`, teardown-knop (confirm); surface `ServiceStack` in de snapshot. **Files:** `WorkspacesProvider.tsx` (op-set), `workspaceSnapshot.ts:416`. **Verify:** provision/teardown bereikbaar; `ServiceStack` in snapshot (fixture). **TAG: now**; live `compose up` = FASE Z.
- **K2 — Preset-galerij.** `listServicePresets` (`servicePresets.ts:112`) heeft nul callers. Voeg `_api listServicePresets`-read + preset-picker-cards (Postgres/Redis/Kafka/RabbitMQ/Elastic/MinIO/Mailpit) die `serviceProvision({name,preset})` roepen. **Files:** `servicePresets.ts:112`, nieuwe `_api`-route. **Verify:** preset-read + cards provisionen. **TAG: now.**
- **K3 — Database-panel.** De user-app-DB-laag (`db-connect`/`db-migrate-create`/`db-migrate-apply`/`db-introspect`, ADR 0043) heeft geen UI en zit niet in de snapshot. Voeg een DB-panel (connections + add-form → `projectAdmin db-connect`; migratie-editor; apply met `CONFIRM_REQUIRED` + `prodNeedsApproval/prodNeedsRollbackPlan`; introspect-tabel-lijst) + surface rows in de snapshot. **Files:** `workspaceSnapshot.ts`, DB-panel. **Verify:** connections/migratie/introspect bereikbaar; prod-apply gegated. **TAG: now** (fixture); live DB = FASE Z.
- **K4 — AI propose infra-ops.** Geen Docker/service/DB-op is voorstelbaar. Expose (via X1) een whitelisted propose-then-confirm-pad voor de veilige niet-destructieve ops (`service-provision` preset-only, `db-connect`, `db-migrate-create`). **Files:** `workspaceChat.ts`. **Verify:** "spin up a Postgres" → preset-provision-voorstel. **TAG: now.**
- **K5 — Dockerfile/build scope naar active-project.** `dockerfileGen`+`imageBuild` targeten de **eerste** project (`findFirst orderBy createdAt asc`), niet de actieve — verkeerde Dockerfile/image in multi-project-workspaces. Thread `activeProjectId` uit de snapshot door generate/save/build. **Files:** `dockerfileGen.ts:54`, `imageBuild.ts:29`, `workspace/page.tsx:535,561`. **Verify:** juiste project's Dockerfile/image. **TAG: now.**
- **K6 — Build-status in ProjectSummary.** `ProjectSummary` exposeert alleen id/name/gitUrl → na reload weet de user niet welk image gebouwd is (transient toast). Voeg `baseImageRef` + last-build-status toe + render in de Dockerfile-card. **Files:** `workspaceSnapshot.ts:416`. **Verify:** image-tag/status overleven reload. **TAG: now.**
- **K7 — Migrate base-image default.** `migrate.ts:13` defaultt naar `workspaces/base:latest` terwijl de rest `0.1.0` gebruikt; `latest` kan ontbreken. Default naar dezelfde `WS_BASE_IMAGE`. **Files:** `migrate.ts:13`. **Verify:** default = `0.1.0`. **TAG: now.**

## FASE I — CI & merge-request-review

- **I1 — MR-panel: AI-review + Run-CI + Checks.** `mrAction('review')` wordt nooit geroepen; er is geen "Run CI"-knop; de laatste `PipelineRun`/jobs komen niet in de snapshot en er is geen Checks-sectie. Voeg een "AI review"-knop (dispatch `invoke-agent-role {role:'mr-review', mrId}`), een "Run CI"-knop (`projectAdmin ci-run` met ticketId) en een Checks-sectie (status/maxSeverity/findings uit de snapshot); map ci-reasons (`ci-red`/`ci-running`/`ci-stale`) naar eigen i18n. **Files:** `MrReviewPanel.tsx`, `reviewRole.ts:88-94`, `service.ts:116`, `workspaceSnapshot.ts`. **Verify:** AI-review-dispatch met mrId; Run-CI-dispatch; checks renderen; ci-reason-berichten. **TAG: now** (fixture); live CI = FASE Z.
- **I2 — PipelineRun + security-findings in snapshot.** Security-scan-findings (leaked secrets, vuln deps) gaten prod-promote maar zijn onzichtbaar. Expose de laatste `PipelineRun` + jobs + findings in de snapshot; render severity+title in de MR-Checks-sectie én op het deploy/promote-scherm met block-reden. **Files:** `runner.ts`, `security.ts`, `workspaceSnapshot.ts`. **Verify:** findings renderen in MR + promote met block-reden. **TAG: now.**
- **I3 — Plan-critique ticket-scoped trigger.** Alleen cron-pad (geen ticketKey) → rol geeft "No ticket to critique". Voeg een "Critique plan"-knop op het ticket die `projectAdmin plan-critique` (of `invoke-agent-role` met ticketKey) dispatcht. **Files:** `planCritiqueRole.ts:46`. **Verify:** dispatch met ticketId. **TAG: now.**
- **I4 — Root-cause symptom-input.** Het Scheduled-form verzamelt `params.focus`, de rol leest `params.symptom` → altijd generieke default. Voeg een "Incident → diagnose"-box (env/deploy-scherm) met `{symptom}`, of map `focus→symptom` voor de root-cause-rol. **Files:** `scheduled/page.tsx:110`, `rootCauseRole.ts:45`. **Verify:** symptom bereikt de rol. **TAG: now.**
- **I5 — AutomationPanel invoke-agent-role event-actie.** De ACTIONS-lijst mist `invoke-agent-role` → geen event-driven rol ("on ticket.merged → mr-review"). Voeg toe met role-picker (`agentRoles/listAgentRoles`). Dit is ook de fix voor cluster-Triggers T6. **Files:** `AutomationPanel.tsx:19`. **Verify:** event→rol-automation bereikbaar (B-4). **TAG: now.**
- **I6 — ci-allow-red admin-toggle.** `allowMergeOnRedCI` heeft geen toggle → een vastgelopen CI-runner blokkeert alle merges permanent. Admin-only toggle → `ci-allow-red {enabled}`. **Files:** `projectAdmin_server_v1.ts:14`, `service.ts:115`. **Verify:** toggle dispatcht ci-allow-red. **TAG: now.**
- **I7 — CI-event tint/label.** CI-`TicketEvents` (`type:'ci'`) worden als 'ai-message' (blauw) gelabeld (geen 'ci'-case). Voeg 'ci' toe aan de `ActivityEvent`-union, `asEvType`, beide `EVENT_TINT`-maps + `EVENT_LABEL` met pass/fail-tint. **Files:** `workspaceSnapshot.ts:65`, `types.ts:454,467`, `board/[ticketId]/page.tsx:609`, `activity/page.tsx:17`. **Verify:** ci-events getint pass/fail. **TAG: now.**
- **I8 — AI propose review-mr/rollback.** Voeg (via X1) `review-mr`/`rollback`-acties die op accept naar het mr-review/root-cause-pad mappen. **Files:** `workspaceChat.ts`. **Verify:** chat stelt mr-review/root-cause voor. **TAG: now.**

## FASE D — Deploy & environments (grotendeels FINAL-LIVE-proof)

- **D1 — Demo-host-card.** De demo-host-feature (D3: persistente 'main at stable DNS' + autoRedeploy/pinnedCommit) heeft geen UI; de settings-card mapt alleen `['dev','staging','prod']`. Voeg een Demo-row/card (deploy-toggle + auto-redeploy-switch + optionele pin-to-commit) → `deployEnv({kind:'demo', autoRedeploy, pinnedCommit})` (payload al gehandeld op `conductor.ts:1911-1915`). **Files:** `settings/page.tsx:279`. **Verify:** demo env create/toggle/pin dispatcht. **TAG: now** (UI+fixture); live redeploy = FASE Z.
- **D2 — Bundle-vs-image export-keuze.** De 'bundle'-export (echte prod-build → dist-tarball) heeft geen UI; de knop hardcodet `exportBuild('image')`. Bied beide kinds (twee knoppen/Dropdown), forward `payload.kind` (`conductor.ts:1961`). **Files:** `settings/page.tsx:301`. **Verify:** beide kinds selecteerbaar. **TAG: now.**
- **D3 — Per-service environments.** De UI leest alleen envs met `serviceId===undefined`. Render bij services een per-service environments-sub-lijst die `serviceId` doorgeeft (`deployEnvApi` accepteert het al). **Files:** `settings/page.tsx:280`, `WorkspacesProvider.tsx:698`. **Verify:** serviceId doorgethreaded per service. **TAG: now.**
- **D4 — Deploy-hook settings + result.** Deploy-hook is env-only (`WS_DEPLOY_WEBHOOK_URL/TOKEN`), geen UI, geen feedback of de hook vuurde. Voeg een deploy-hook-veld (save-env-stijl) + surface `deployHook.fired/ok/status` op de build-artifact-rij. **Files:** `buildExport.ts:112-114`, `settings/page.tsx`. **Verify:** hook settable; result getoond (fixture). **TAG: now** (UI); echt vuren = FASE Z.
- **D5 — AI propose deploy/promote/export.** De hele ship-helft is AI-onbereikbaar. Voeg (via X1) `env-deploy`/`env-promote`/`build-export`-voorstellen; accept → bestaande control-ops; prod houdt de human-approval-flag. **Files:** `workspaceChat.ts`, `executor.ts`. **Verify:** deploy-voorstellen accept→op; prod gegated. **TAG: now.**

## FASE R — RAG, sources & knowledge-graph

- **R1 — Knowledge-graph-pagina (N2-renderer).** `knowledgeGraph_v1` + `server/rag/graph.ts` zijn compleet+unit-getest maar er is geen consumer, nav-entry of pagina. Bouw een graph-route + nav-item (work-group) die `apiRequest name:'knowledgeGraph' v1` roept en nodes/edges als force-directed/Obsidian-view rendert (lazy-loaded lib, buiten core-chunks). **Files:** `knowledgeGraph_v1.ts`, `Shell.tsx` nav. **Verify:** graph rendert nodes/edges; nav-entry. **TAG: now** (lazy lib); browser-verify = FASE Z.
- **R2 — Sources dead-buttons.** 'Regenerate' (doc-cards) + 'Reindex' (frozen skills) wiren naar een noop-stub maar ogen actionable. Implementeer de regenerate/skill-reindex-ops (control-API, re-express via bestaande verbs) óf disable met tooltip tot Fase 2. **Files:** `sources/page.tsx:20,111,135`. **Verify:** knoppen acteren of disabled-met-tooltip. **TAG: now.**
- **R3 — Sources stale-comment.** Header-comment beweert 'Dummy data; desktop-first' terwijl docs/skills DB-backed zijn via de snapshot. Corrigeer. **Files:** `sources/page.tsx:5`. **Verify:** comment weerspiegelt `InfoSource`-bron. **TAG: now.**

## FASE S — Settings, RBAC, members, audit & export (completeness; SEC-items in FASE SEC)

- **S1 — Audit-tab.** De audit-trail is volledig onzichtbaar (geen tab, nul callers van `workspaces/auditLog`). Voeg een admin-gated 'Audit'-tab die `auditLog` roept + de `AuditEntry[]`-feed rendert (filter actor/type/periode). **Files:** `workspace/page.tsx:882-896`, `auditLog_v1.ts`. **Verify:** audit-feed rendert tenant-scoped. **TAG: now.**
- **S2 — Workspace-data-export-knop.** GDPR/backup-export (`workspaceExport`) heeft nul callers. Voeg een "Download workspace data"-knop in een Data/Danger-sectie. **Files:** `workspaceExport_v1.ts`, `settings/page.tsx`. **Verify:** bundle downloadt. **TAG: now.**
- **S3 — PAT-beheer.** `issuePat_v1`/`revokePat_v1` hebben geen callers en er is geen `listPats`-route. Voeg een 'API tokens'-sectie (issue met scopes, toon raw token één keer, lijst per prefix, revoke) + een `listPats_v1`-read-route. **Files:** `issuePat_v1.ts`, `revokePat_v1.ts`, nieuwe `listPats_v1.ts`. **Verify:** issue/list/revoke werken. **TAG: now.**
- **S4 — Account profile-edit.** Name/avatar-'Edit' is een `Fase 2`-stub. Wire een `updateUser`-pad of verberg de knop. **Files:** `settings/page.tsx:249-250`. **Verify:** edit werkt of verborgen. **TAG: now.**
- **S5 — SSH-keys persistent.** Keys worden tegen een hardgecodeerde seed-map (`SSH_KEY_TO_USER`) geresolvd, alleen in local context. Persist per account server-side; drop de seed-map. **Files:** `settings/page.tsx:17,58-63,109`. **Verify:** keys persisted server-side. **TAG: now.**
- **S6 — Pending-invites echte sent/expiry.** Invites tonen letterlijk 'pending' en geen 7-dagen-expiry. Map `inv.createdAt/expiresAt` naar `InviteEntry`; toon echte sent-tijd + "expires in Nd" (+ resend + copyable link bij ongeconfigureerde SMTP). **Files:** `workspaceSnapshot.ts:495`, `workspace/page.tsx` invites-tab. **Verify:** echte sent+expiry getoond. **TAG: now.**
- **S7 — Audit-completeness.** `rename-workspace` en `role-create` schrijven geen audit; `delete-workspace`-audit landt in de tenant die meteen cascade-verwijderd wordt. Voeg `recordAudit` op rename + role-create; schrijf de delete-audit naar een global/out-of-tenant-sink. **Files:** `conductor.ts:568-573,738-742,731-736`. **Verify:** elke op schrijft een rij; delete-audit overleeft. **TAG: now.**
- **S8 — geminiTemperature clamp.** Opgeslagen via `str()` zonder validatie. Valideer/clamp naar numeriek 0.0–2.0 in de conductor + number-input. **Files:** `workspace/page.tsx`, `conductor.ts:884-893`. **Verify:** geclamped nummer persisted. **TAG: now.**
- **S9 — Provider-feature-labels.** `save-ai-provider`-rijen tonen ruwe slugs (`docs-generate`, `studio-marketer`, `plan-critique`). Map elke `PROVIDER_FEATURES`-id naar een i18n-label + one-liner. **Files:** `workspace/page.tsx:~856-864`. **Verify:** slugs → vertaalde labels+desc. **TAG: now.**

## FASE T — Triggers, automation & custom-tasks

- **T1 — Dode trigger-events emitten.** 5 van 8 event-kinds vuren nooit (`stage.on_complete`, `stage.on_signal`, `stage.on_approval`, `ticket.merged`, `suggestion.accepted`); 3 zijn wél selecteerbaar → users bouwen stille triggers. Emit `fireEvent` uit de MR-merge-, stage-completion-, signal-append- en accept-suggestion-paden; tot gewired de niet-vurende kinds uit de EVENTS-lijst. **Files:** `conductor.ts:312,602,668,2064`, `AutomationPanel.tsx:18`, `triggers.ts:34-77`. **Verify:** elk event triggert de matcher; UI toont alleen vurende kinds. **TAG: now.**
- **T2 — Output-Templates-manager.** Output-templates zijn backend→sync→conductor→snapshot→provider compleet maar hebben **nul** frontend-consumer; `format/watermarkPosition` worden nergens geconsumeerd. Bouw een Output-Templates-manager (workspace/content-settings) + wire het gekozen template in het media-render/export-pad. **Files:** `conductor.ts:1505,1532`, `WorkspacesProvider.tsx:1057-1059`. **Verify:** create/list/pick/apply; format/watermark bij export (fixture). **TAG: now**; live render = FASE Z.
- **T3 — webhook in TRIGGER_ACTIONS.** `'webhook'` ontbreekt in de narrowing-array → elke opgeslagen webhook-trigger leest terug als 'notify'. Voeg toe. **Files:** `workspaceSnapshot.ts:56`. **Verify:** webhook-trigger leest terug als webhook. **TAG: now.**
- **T4 — AI propose trigger/custom-task.** Voeg (via X1) een gevalideerde trigger-save/custom-task-voorstel-shape. **Files:** `workspaceChat.ts`. **Verify:** "elke ochtend..." → cron-trigger-voorstel. **TAG: now.**
- **T5 — Automations-nav voor content/design.** Triggers+Scheduled zijn Dev-only-gated → content/design-workspaces bereiken automation niet, ondanks scraper/ideator/studio-rollen. Voeg een 'Automations'-sectie aan de content/design-module-presets. **Files:** `modules.ts:29`. **Verify:** content/design bereiken automations. **TAG: now.**
- **T6 — run-command + invoke-workspace-ai executors.** Beide declared trigger-acties hebben geen executor-case (default noop) maar staan in de snapshot-narrowing. Implementeer operator-gated executors óf drop uit union + snapshot-lijst. **Files:** `executor.ts:51-107`, `workspaceSnapshot.ts:56`, `types.ts:849,851`. **Verify:** geïmplementeerd of verwijderd. **TAG: now.**
- **T7 — Trigger-match-facets-UI.** Geen UI voor `stageIds/statusKeys/projectIds/debounceMs/dedupeKey` → elke UI-trigger matcht **elk** event. Voeg optionele "only for stages X / status Y" + debounce-velden. **Files:** `AutomationPanel.tsx:53-62`, `triggers.ts:34-49`. **Verify:** facet-velden scopen de trigger. **TAG: now.**
- **T8 — Custom-task {{var}}-prompt.** Templates ondersteunen `{{var}}` + de run-op accepteert een vars-map, maar de UI runt zonder vars → lege placeholders. Prompt voor de template-variabelen vóór run. **Files:** `workspace/page.tsx:834`, `customTask.ts:12`, `conductor.ts:1498`. **Verify:** vars verzameld + doorgegeven. **TAG: now.**
- **T9 — Trigger-delete-confirm.** Delete heeft geen confirm op beide surfaces. Wrap in `menuHandler.confirm`. **Files:** `AutomationPanel.tsx:97`, `scheduled/page.tsx:78`. **Verify:** delete vraagt confirm. **TAG: now.**
- **T10 — Run-now op AutomationPanel.** Run-now zit alleen op Scheduled. Voeg een "Run now"-actie aan AutomationPanel-rijen. **Files:** `AutomationPanel.tsx`. **Verify:** event-trigger test-fireable. **TAG: now.**
- **T11 — emit-signal 'kind'-veld.** `emit-signal` hergebruikt de notify-'title'-input als signal-'kind' zonder label. Voeg een gelabeld 'signal kind'-veld + one-liner. **Files:** `AutomationPanel.tsx:57`. **Verify:** dedicated label+help. **TAG: now.**
- **T12 — scheduled.runNow de/fr.** Untranslated in de/fr. Vertaal. **Files:** `de.json:1394`, `fr.json:1394`. **Verify:** vertaald. **TAG: now.**

## FASE P — Spend, budgets & capacity

- **P1 — Token-budget product-truth.** Het token-budget is dead-wired: `enforcement` wordt alleen bij seed geschreven en nooit gelezen; `spent` incrementeert nooit (prijs leeg op Max-subscription); `resume-spend` reset een altijd-0. Beslis (ADR): óf drop het token-`WorkspaceBudget`+`raise-cap`/`edit-budget`/`resume-spend`, óf reframe als **token-volume-cap** (increment `spent` met `tokensIn+tokensOut` ongeacht prijs) + lees `enforcement` echt in het capacity/provision-pad om pause-new bij overschrijding. **Files:** `record.ts:42`, `seedWorkspace.ts:73`, capacity-pad. **Verify:** ADR legt keuze vast; indien behouden: spent incrementeert + enforcement pauzeert. **TAG: now.**
- **P2 — Per-user spend-attributie.** `aggregateByUser/userBudgetExceeded` zijn dead code (alleen tests). Vouw `aggregateByUser` in de snapshot als `usage.byUser` + render in de Usage 'by person'-card; wire `userBudgetExceeded` als per-member soft-warning. **Files:** `record.ts:61-76`. **Verify:** usage.byUser gerenderd. **TAG: now.**
- **P3 — Budget-card op Usage.** Niets rendert `snap.budget`. Indien P1 het budget behoudt (token-volume): voeg een budget-card toe gewired aan `edit-budget/resume-spend`; anders verwijder de ops van de surface. **Files:** `usage/page.tsx:1-4`. **Verify:** budget-card gewired of ops verwijderd. **TAG: now.**
- **P4 — AI propose pause-all/resume-all/raise-cap.** Voeg (via X1) deze als voorstelbare ops (accept-gated → single-writer intact). **Files:** `workspaceChat.ts`. **Verify:** "stop all work" → pause-all-voorstel. **TAG: now.**
- **P5 — Multi-cap.** `label/periodWindow/enforcement` (D81/D82) is schema-only; `edit-budget` schrijft één row, snapshot leest alleen `budgetRows[0]`. Implementeer de multi-cap-editor+lijst óf trim het schema naar de single cap. **Files:** `conductor.ts:1103-1108`. **Verify:** editor+lijst óf schema getrimd. **TAG: now.**
- **P6 — Media-budget reconcile.** Pre-check + recorded-spend gebruiken beide `estimateMediaCostCents` → drift bij afwijkende provider-charge. Als een provider echte cost teruggeeft: record de echte `costCents` + reconcile `spentCents`. **Files:** `media/budget.ts:19`. **Verify:** recorded=provider-cost (fixture). **TAG: now** (fixture); echte cost = FASE Z.
- **P7 — Capacity-surface.** `activeCount/queueLength` niet in snapshot, cap env-only. Voeg toe aan de snapshot + kleine busy/queued-indicator; expose optioneel `WS_MAX_CONCURRENT_TURNS` als admin-setting. **Files:** `capacity.ts:148-160`. **Verify:** N running/M queued getoond (gedeeld met A6). **TAG: now.**
- **P8 — Currency-label.** Snapshot labelt het token-budget als '€' terwijl het token/subscription-based is (cost altijd 0). Drop '€' of switch naar token-volume-unit. **Files:** `workspaceSnapshot.ts:334`. **Verify:** unit gecorrigeerd. **TAG: now.**
- **P9 — Usage stale-comment.** Header-comment beweert 'Dummy data' terwijl echte `aggregateUsage` rendert. Corrigeer. **Files:** `usage/page.tsx:4`. **Verify:** weerspiegelt `SpendRecord`-aggregate. **TAG: now.**
- **P10 — Media-budget buiten Content-module.** Media-budget-UI is module-gated. Bevestig dat media-gen onmogelijk is buiten de Content-module; indien wél mogelijk, expose het €-budget in een gedeelde settings-locatie. **Files:** `content/settings/page.tsx`. **Verify:** bevestigd óf gedeeld gesurfaced. **TAG: now.**

## FASE N — Notifications, realtime, presence & PWA-push (SEC4/SEC5 in FASE SEC)

- **N1 — Mobiele notificatie-bel.** De bel/lijst bestaat alleen in de desktop-only Shell-TopBar (`hidden md:flex`); MobileChrome heeft geen notif-surface. Voeg een bel + swipeable notification-sheet (of route) aan MobileChrome, hergebruik `notifications/markNotificationRead`. **Files:** `MobileChrome.tsx:23-38`, `Shell.tsx:204,244`. **Verify:** mobiele notif-surface leest de context. **TAG: now.**
- **N2 — Presence-AvatarStack echt.** De header-'who's viewing'-stack is FAKE (`members.slice(0,3)`), gelabeld als presence. Voed uit de echte presence-context (presence-userIds → members) óf drop de header-stack. **Files:** `Shell.tsx:200,243`. **Verify:** uit presence-context. **TAG: now.**
- **N3 — Presence-engine wired.** `resolvePresenceStatus/aggregatePresence/ViewPresence` zijn geschreven+unit-getest maar hebben nul product-callers/relay/UI. Wire `aggregatePresence` in de presence-relay + render per-view `activeCount`-badges in de nav, óf verwijder de module + doc-claim. **Files:** `ultrasync/presence.ts`. **Verify:** per-view-badges óf module verwijderd. **TAG: now.**
- **N4 — Notificatie-klik → deepLink.** Klik markeert alleen read, navigeert nooit naar `deepLink`. In `onClick`: bij `n.deepLink` → `navigate/openTicket(n.deepLink.ticketId)` dan markeer read. **Files:** `Shell.tsx:265`. **Verify:** klik navigeert naar ticket. **TAG: now.**
- **N5 — Push-url deep-path.** Elke producer hardcodet de OS-push-url op '/' ondanks `tag:ticket-<key>`. Zet url op `/?ticket=<key>` zodat `sw.js notificationclick` op het ticket landt. **Files:** `conductor.ts:351`, `executor.ts:61,101`, `watchdog.ts:163`, `public/sw.js`. **Verify:** url deep-linked; sw handelt. **TAG: now.**
- **N6 — Push-toggle reconcile.** De settings-push-Toggle init altijd `false`, nooit gereconcilieerd met `pushManager.getSubscription()`. Lees op mount `serviceWorker.ready → getSubscription()` en `setPush(!!sub)`. **Files:** `settings/page.tsx:159`. **Verify:** toggle weerspiegelt bestaande sub. **TAG: now.**
- **N7 — Install-app-affordance.** Geen in-app 'Add to home screen'/`beforeinstallprompt`-handling. Capture `beforeinstallprompt` + surface een "Install Workspaces"-knop (settings/MobileChrome). **Files:** `main.tsx`. **Verify:** Install-knop gesurfaced. **TAG: now.**

## FASE CC — Content-pipeline-kern

- **CC1 — Stage auto-advance + manuele advance.** De 6-stage-content-board is inert: niets roept ooit `content-advance` en `runPipeline` schrijft nooit `stageId` → script/generate/assemble/review/publish blijven leeg. Auto-advance `stageId` naarmate stappen landen (script→'script', visuals→'generate', assembled→'review') binnen `runContentPipeline`; voeg een manuele 'Advance stage'-control (`content-advance`). **Files:** `runPipeline.ts:30-77`, `conductor.ts:1453-1463`, `content/page.tsx:103-121`. **Verify:** stappen schrijven `stageId`; manuele advance werkt (fixture). **TAG: now**; live pipeline = FASE Z.
- **CC2 — 'New content piece'-knop.** Geen create-affordance op de board (enige pad = AI `create-content`). Voeg een primaire "New content piece"-knop → brief-form → `content-from-brief`. **Files:** `content/page.tsx:69-96`. **Verify:** create-affordance → piece. **TAG: now.**
- **CC3 — Active content-Project hergebruiken.** Elke `content-from-brief` maakt een **nieuw** Project → project-sprawl, geen gedeeld board. Hergebruik het actieve content-Project (of accepteer `projectId`); surface `content-create` als in-project 'add piece'. **Files:** `conductor.ts:1671-1678`. **Verify:** tweede piece deelt project. **TAG: now.**
- **CC4 — Piece-detail lifecycle-controls.** Piece-detail toont stage/status maar biedt geen advance/review→publish/archive. Voeg een stage-progress-header met "Advance to <next>" (`content-advance`) + overflow-menu met Archive (`content-archive`, confirm). **Files:** `content/[pieceId]/page.tsx:259-279`, `conductor.ts:1464-1468`. **Verify:** advance+archive+restore bereikbaar. **TAG: now.**
- **CC5 — Archived-view + restore.** Archived pieces worden uit de snapshot gefilterd → geen restore-pad. Voeg een 'Archived'-filter/tab die archived pieces leest + een Restore-knop (`content-unarchive`). **Files:** `workspaceSnapshot.ts:339`. **Verify:** archived-filter + unarchive. **TAG: now.**
- **CC6 — AI chain create-content→run-pipeline.** Laat de AI (via X1/copilot) `create-content` → `content-run-pipeline` ketenen als plan-stap. **Files:** `workspaceChat.ts`, `conductor.ts:1657`. **Verify:** AI stelt pipeline-run voor achter accept. **TAG: now.**
- **CC7 — Unpublish + delete-adapter.** Geen UI-retract; `content-unpublish` flipt alleen de DB-row (geen per-platform-delete-adapter). Voeg een Unpublish-knop (`content-unpublish`) + implementeer per-platform-delete-adapters óf label duidelijk 'mark as retracted'. **Files:** `conductor.ts:1538-1547`. **Verify:** unpublish dispatch; label eerlijk. **TAG: now** (label); echte delete-adapter = FASE Z.
- **CC8 — Allowlist-drift.** De `contentControl`-allowlist accepteert `content-create/advance/archive/unarchive/unpublish` maar geen client stuurt ze. Wire de missende lifecycle-ops aan UI-controls zodat de allowlist matcht. **Files:** `contentControl_server_v1.ts:18-24`. **Verify:** allowlist = bereikbare UI. **TAG: now.**

## FASE CG — Content-generatie (script/voice/image/video/3d/audio)

- **CG1 — 3D needs-ref chain.** `content-gen-3d` stuurt alleen een prompt maar fal-triposr vereist `image_url` → live altijd error. Voeg `needsRef` toe (of 'pick an existing image asset'), thread `referenceUrl` door de conductor-case naar `generateMediaAsset`, óf auto-chain image-gen→model-3d vóór triposr. **Files:** `conductor.ts:1621-1633`, `fal.ts:82-84`, `content/[pieceId]/page.tsx:53`. **Verify:** 3D vereist source-image; referenceUrl gethreaded (stub). **TAG: now**; live triposr = FASE Z.
- **CG2 — AI content-gen-ops reachable.** Geen content-gen-op is AI-bereikbaar. Wire (via X1/copilot) zodat de Assistent `content-run-pipeline`/`content-gen-*` kan voorstellen achter de B-23-accept. **Files:** `workspaceChat.ts:83-125`, `conductor.ts:1657`. **Verify:** "make me a video about X" → run-pipeline/gen-voorstel. **TAG: now.**
- **CG3 — Avatar-generatie-UI.** De op + fal-pad zijn compleet maar er is geen knop en geen `actAvatar`-key. Voeg een `content-gen-avatar`-entry aan GEN_ACTIONS (needsPrompt/needsRef) + `actAvatar`-keys (en/nl/de/fr). **Files:** `content/[pieceId]/page.tsx` GEN_ACTIONS, `en.json`. **Verify:** avatar-knop + keys. **TAG: now** (UI); live gen = FASE Z.
- **CG4 — Reference-video-analyse-UI.** `analyzeReferenceVideo` + `content-analyze-reference-video` zijn server-wired maar hebben geen UI-entry. Voeg een affordance (paste/upload reference-video-URL + 'new story'-veld) die de op emit, óf verwijder indien out-of-scope. **Files:** `referenceVideo.ts:58`, `conductor.ts:1609`. **Verify:** URL-input emit de op. **TAG: now.**
- **CG5 — Short-form hook/captions via AI.** Hook+captions worden altijd door een naïeve word-slice-stub afgeleid, ook met keys. Genereer hook/captions via de 'script'-`AiFeature` wanneer een provider beschikbaar is, val terug op `stubHook` bij falen. **Files:** `shortForm.ts:22-27,37`. **Verify:** AI-gen bij provider, stub-fallback (fixture). **TAG: now** (fixture); live = FASE Z.

## FASE CP — Publishing, scheduling & channels/accounts

- **CP1 — scheduledAt end-to-end.** De scheduled-publish-engine is server-compleet maar 100% onbereikbaar: geen `scheduledAt` in de clientInput, geen picker, geen scheduled-posts-lijst. Voeg `scheduledAt` aan het `contentControl`-clientInput-contract + een "Schedule for later"-date-time-picker + een scheduled-posts-lijst/calendar. **Files:** `contentControl_server_v1.ts:29-52`, `content/[pieceId]/page.tsx:242-247`, `conductor.ts:1646-1652,1784-1788`. **Verify:** schedule zet `scheduledAt` → job `scheduled` → leader-loop vuurt (injected clock). **TAG: now**; live vuren = FASE Z.
- **CP2 — Publish-composer.** Elke publish gaat PRIVATE + title-only omdat `publishVariants` (caption/hashtags/privacy) geen UI-writer heeft. Voeg een publish-composer die `project.publishVariants` schrijft; default privacy 'public' of forceer een expliciete keuze. **Files:** `publishOAuth.ts:112`, `publish.ts:71`. **Verify:** variants geschreven + geconsumeerd; geen stille private. **TAG: now.**
- **CP3 — Multi-account-routing.** Server-side compleet maar dood: de OAuth-start-URL draagt alleen `ws` (geen `accountId`), geen account-lijst/picker, en de snapshot mis-parset per-account-keys (`__publish_youtube_<id>`→`youtube_<id>`). Pass `accountId` door de OAuth-start-URL, surface `accounts[]` in de snapshot (per platform), + account-picker bij publish (of bind account aan channel). **Files:** `workspaceSnapshot.ts:356-357`, `content/settings/page.tsx:305-306`. **Verify:** per-account-connect registreert; picker bij publish (fixture). **TAG: now**; live OAuth = FASE Z.
- **CP4 — Audience-analytics-loop.** `ingestPublishMetrics/topPerformers` zijn compleet+unit-getest maar hebben nul callers → `PublishJob.metrics` nooit gevuld, geen views/CTR. Schedule `ingestPublishMetrics` op de leader-loop; surface metrics in insights; inject `topPerformers` in de ideator-prompt. **Files:** `publishMetrics.ts:50,66`. **Verify:** ingest scheduled; metrics in insights; topPerformers in prompt (fixture). **TAG: now**; echte platform-metrics = FASE Z.
- **CP5 — AI propose publish/schedule.** Voeg (via X1/copilot) een publish/schedule-voorstel-pad. **Files:** `workspaceChat.ts`, `conductor.ts:1657`. **Verify:** "publish this"/"schedule the 3 videos"-voorstellen. **TAG: now.**
- **CP6 — publishJobs[] in snapshot.** De per-job-status (done/stub/error/scheduled/unpublished) wordt alleen tot counts gereduceerd. Voeg `publishJobs[]` aan de snapshot + render status-chips + external-link per asset. **Files:** `workspaceSnapshot.ts:344,388`. **Verify:** per-job-status gerenderd. **TAG: now.**
- **CP7 — content-unpublish-knop.** Zie CC7 (retract-label); voeg de knop op de publish-jobs-lijst. **Files:** `conductor.ts:1538-1546`. **Verify:** unpublish bereikbaar. **TAG: now.**
- **CP8 — channel-edit-form.** Zie CB4 (gedeeld). De conductor ondersteunt rename/platform/handle/defaultStyleId maar geen client emit `channel-edit`. Inline edit-form. **Files:** `conductor.ts:1213-1226`, `content/settings/page.tsx:245-292`. **Verify:** edit dispatcht channel-edit. **TAG: now.**
- **CP9 — Disconnect per-account.** Disconnect stuurt alleen `{platform}` → per-account-tokens kunnen nooit disconnecten. Na CP3: pass `accountId` per rij. **Files:** `content/settings/page.tsx:298-300`. **Verify:** per-account-disconnect. **TAG: now** (na CP3).
- **CP10 — IG/LinkedIn-consistentie.** IG/LinkedIn zijn afwezig in de connect-lijst maar aanwezig in de channel-create-dropdown. Verberg IG/LinkedIn consistent óf toon een disabled 'coming soon'-rij. **Files:** `publish.ts:34-35,88-91`, `content/settings/page.tsx:23-26,244`. **Verify:** consistente roadmap-signaal. **TAG: now.**
- **CP11 — de.json mojibake.** `VerÃ¶ffentlichungs-Verbindungen`. Re-encode naar UTF-8. **Files:** `de.json:835`. **Verify:** 'Veröffentlichungs-Verbindungen'. **TAG: now.**
- **CP12 — Scheduled-posts-tab.** Naming-collision: de 'Scheduled'-nav is cron-automation, niet scheduled-publishing. Voeg (met CP1) een 'Scheduled posts'-tab voor content-workspaces. **Files:** `scheduled/page.tsx`, `modules.ts`. **Verify:** content-scheduler los van cron. **TAG: now.**

## FASE CB — Content-settings, brand & style-libraries

- **CB1 — AI propose content-config-ops.** Voeg (via X1) niet-secret/niet-destructieve config-ops (`reference-add`, `content-edit-brand`, `save-style`, `channel-create`) als confirmbare voorstellen; hou `save-media-provider/edit-media-budget/account-disconnect` uitgesloten. **Files:** `workspaceChat.ts:83-124`, `executor.ts:36`. **Verify:** "remember this ad as reference"/"set brand voice" → voorstellen. **TAG: now.**
- **CB2 — Brand-kit export/import-UI.** `brandExport_v1`/`brandImport_v1` zijn compleet+gevalideerd maar hebben geen knop/keys. Voeg Export/Import-controls in de settings-brand-sectie (copy JSON / paste) + en/nl/de/fr-keys. **Files:** `brandExport_v1.ts`, `brandImport_v1.ts`. **Verify:** export/import werkt; 4 locales. **TAG: now.** (plaatsing gedeeld met DS4.)
- **CB3 — Style-set export/import-UI.** `styleExport_v1`/`styleImport_v1` idem onbereikbaar. Voeg controls aan de StyleManagerSection. **Files:** `styleExport_v1.ts`, `styleImport_v1.ts`. **Verify:** export/import in StyleManagerSection. **TAG: now.**
- **CB4 — channel-edit + defaultStyleId in snapshot-fold.** Naast CP8: de channels-snapshot-fold laat `defaultStyleId` volledig weg. Voeg een edit-knop per channel-rij (`channel-edit`, incl. style-Dropdown) + `defaultStyleId` in de fold. **Files:** `content/settings/page.tsx:245-292`, `workspaceSnapshot.ts:392`. **Verify:** edit dispatcht + `defaultStyleId` round-trips. **TAG: now.**
- **CB5 — Copy-from-workspace-UI.** `copyWorkspaceAssets` (conductor `1519` + sync-route) heeft geen UI-trigger. Voeg een "Copy from workspace"-actie met source-workspace-Dropdown. **Files:** `copyWorkspaceAssets_server_v1.ts`. **Verify:** copy-actie met dropdown. **TAG: now.**
- **CB6 — Style preview-asset + thumbnail-gallery.** `previewAssetUrl` gaat door schema/snapshot/export maar heeft geen UI om het te attachen en geen thumbnail-render (M4 onaf). Voeg een `MediaUploadButton` aan het create-style-form (`previewAssetUrl/previewKind`) + render thumbnails in de style-rijen + insights-grid. **Files:** `content/settings/page.tsx:96-143`. **Verify:** preview-upload + thumbnails renderen. **TAG: now.**
- **CB7 — retrieveChannelBrand wired of drop.** `indexChannelBrand` schrijft per-channel brand-RAG-rijen maar `retrieveChannelBrand` heeft nul callers → verspilde write (output ongewijzigd want brandVoice reikt direct via `buildBrandContext`). Wire `retrieveChannelBrand` in de generation-grounding (script/image) voor lange brand-corpora, óf drop de `indexChannelBrand`-call. **Files:** `brandMemory.ts:16-29`. **Verify:** beslissing — retrieval gebruikt óf index verwijderd. **TAG: now.**
- **CB8 — Style-edit (pencil).** Geen dedicated edit-affordance (je moet key+prompt overtypen). Voeg een edit-knop per niet-builtin-rij die het create-form pre-fillt. **Files:** `content/settings/page.tsx:120-130`. **Verify:** edit pre-fillt create-form. **TAG: now.**
- **CB9 — Brand-voice-edit in settings.** Brand-voice is bewerkbaar op insights maar niet in de settings-ChannelManagerSection → split over 2 pagina's. Surface brand-voice-edit in dezelfde channel-rij (of cross-link). **Files:** `insights/page.tsx:126-141`, `settings/page.tsx:245-292`. **Verify:** brand-voice bereikbaar uit settings. **TAG: now.**
- **CB10 — Media-key stale-comment.** Comment beweert dat per-workspace media-key-consumptie een follow-up is terwijl `registry.ts` het al consumeert. Corrigeer de comment. **Files:** `conductor.ts:1153-1156`. **Verify:** comment weerspiegelt `registry.ts:78-84`. **TAG: now.**

## FASE DS — Design, Studio, Designer & marketing

- **DS1 — Designer-animations save/persist.** `useInProject` handelt alleen `'theme'|'style'`; de persist-bar rendert alleen daarvoor; `Animations.tsx` heeft geen save → gegenereerde/bewerkte animaties verloren bij reload (terwijl `designerLibrary`/`artifactToAnim`/snapshot-merge kind 'animation' al steunen). Breid `useInProject` uit met `'animation'` + render de persist-bar op de Animations-sectie. **Files:** `designer/state.tsx:79,174-190`, `designer/page.tsx:129`, `Animations.tsx`. **Verify:** animation-save overleeft reload. **TAG: now.**
- **DS2 — AI propose studio/designer/interviewer-generatie.** Voeg (via X1) propose-only `studio-generate`/`designer-generate-theme`/`run-interviewer`-acties (Conductor-uitgevoerd). **Files:** `workspaceChat.ts:48,111-123`. **Verify:** "make me a brand + landing" → voorstellen. **TAG: now.**
- **DS3 — thumbnail/videoScript in KINDS_FOR.** Beide zijn weggelaten uit de agent-role KINDS_FOR-map → geen AI/automation-pad. Voeg toe aan `KINDS_FOR.marketer` óf documenteer de exclusie. **Files:** `studio/roles.ts:11-14`. **Verify:** role-map bijgewerkt of gedocumenteerd. **TAG: now.**
- **DS4 — brandExport/Import in BrandPanel.** Gedeeld met CB2 (zelfde routes) — plaats Export/Import-knoppen ook in de Studio-BrandPanel. **Files:** `studio/page.tsx:452-489`. **Verify:** knoppen roepen de routes. **TAG: now.**
- **DS5 — Module-taxonomie.** Studio (landing/component/brand-kit) zit alleen onder Marketing (CONTENT-module-gated); Designer/themes onder DESIGN. Een Design-only-workspace heeft geen brand-kit/landing-generator. Reconcilieer zodat alle visuele/brand-generatie bereikbaar is uit de Design-module (of expose een 'studio'/'marketing'-sectie onder design). **Files:** `modules.ts:30-31`. **Verify:** Design-only bereikt brand-kit+landing. **TAG: now.**
- **DS6 — Decoupled 'save to library'.** Niet-seed themes/styles persisten alleen bij Use-in-project, wat óók activeert → je kunt niet meerdere generated themes bewaren zonder één te activeren. Voeg een decoupled 'save to library' (`designerLibrary` save) los van `setActive`/use-in-project. **Files:** `designer/state.tsx:134-190`. **Verify:** save zonder activatie. **TAG: now.**
- **DS7 — Interviewer 'Generate ideas now'.** De interviewer-pagina toont een findings-panel maar biedt geen manier om findings te genereren (alleen via de aparte Scheduled-rol). Voeg een "Generate ideas now"-knop die de interviewer-agent-role runt + findings refresht. **Files:** `interviewer/page.tsx:84-96,51-69`. **Verify:** runt rol + refresht findings. **TAG: now.**
- **DS8 — Studio async-generatie-job.** `generateArtifact` runt synchroon in de HTTP-request (240s-timeout), geen 'generating'-status-row → een trage PTY-gen kan de request-timeout raken. Enqueue een async job die `generating` → `ready/error` schrijft, gesurfaced via de snapshot. **Files:** `generate.ts:193-205`. **Verify:** async status-row (geen request-timeout, fixture). **TAG: now**; live PTY-gen = FASE Z.
- **DS9 — studioSaveBrief projectId.** `studioSaveBrief` accepteert een optionele `projectId` maar de handler zet het nooit. Persist `projectId` op de brief. **Files:** `studioSaveBrief_v1.ts`. **Verify:** `projectId` opgeslagen. **TAG: now.**
- **DS10 — Studio thumbnail render-to-PNG.** De 'thumbnail' is een HTML-iframe-card, geen exporteerbare raster-image. Bied render-to-PNG-export (of route via een echte image-provider). **Files:** `studio/page.tsx:227,238-254`. **Verify:** PNG/social-sized export. **TAG: now** (render-to-PNG); image-provider-route = FASE Z.

---

## FASE Z — FINAL-LIVE (alle deferred proofs; laatste week, echte keys/tokens/live-Docker/deploy/mens)

Elk item hieronder heeft zijn **kern-code + e2e-scaffold (gestubde provider) NU** in de bijbehorende fase; hier wordt alleen de **echte proof** gedraaid. Volgorde: eerst de infra-proofs (Docker/CI), dan de geld-paden (media/publish), dan deploy, dan device/browser, dan billing-at-scale.

- **Z1 — Live Docker/compose.** K1/K2 echte `docker compose -p ws-<id> up` (services healthy, namespacing, sanitizer op echte compose); K3 echte DB-migrate/introspect tegen een live container; A2/A7 echte PTY (kill/clear/restart + live-transcript-tail); CC1 echte content-pipeline-run; G1/E3 echte ref-preview-container + in-app iframe. **Proof:** live containers draaien + teardown schoon (geen port/volume-botsing tussen 2 workspaces).
- **Z2 — Echte media-generatie (keys).** CG1 fal-triposr 3D (image→model), CG3 avatar, CG5 short-form-hook, T2/DS10 media-render met output-template/PNG, DS8 studio-PTY-gen, P6 media-budget-reconcile met echte provider-cost. **Proof:** echte fal/ElevenLabs/ffmpeg-output + budget-reconcile klopt.
- **Z3 — Echte publish/OAuth/analytics.** CP1 scheduled-job vuurt live op tijd; CP2 post is echt public + caption/hashtags zichtbaar; CP3 multi-account-OAuth-connect+publish per account; CP4 echte YouTube-Analytics/TikTok-metrics-ingest → insights + ideator-feedback; CP7/CC7 echte per-platform-retract-adapter. **Proof:** echte post op YouTube+TikTok (test-accounts) + terug-gelezen metrics.
- **Z4 — Echte forge/token/ingest.** G3 echte forge-token-ping (GitLab+GitHub); G6 echt inbound `/webhooks/forge/<id>`-event → last-event-indicator; SEC9 live clone via credential-helper (token niet in argv); R3 GitLab-issue-ingest naar het juiste project. **Proof:** echt PAT verifieert + echte webhook levert een issue.
- **Z5 — Echte deploy/promote.** D1 live demo-host-redeploy + pinnedCommit-freeze; D4 echte deploy-hook-fire (status terug); SEC7 echte gated prod-promote (approval+green-CI+security). **Proof:** live route op stable DNS + gated prod-promote geblokkeerd zonder groene gates.
- **Z6 — Live CI + security-scan.** I1/I2 echte `ci-run` + security-scanner-findings (leaked secret/vuln dep) die prod-promote blokkeren. **Proof:** echte CI-run rood→groen + findings zichtbaar in MR-Checks.
- **Z7 — Echt device / push.** SEC4 push-body-redactie op een echt lock-scherm (opt-in vs generiek); N1/N4/N5/N6/N7 mobiele bel/deep-link/install-prompt op een echt toestel. **Proof:** echte push landt op het ticket met correcte body-redactie.
- **Z8 — RAG-grounding + browser-verify-pass.** R1 knowledge-graph browser-verified op een geïndexeerde workspace; `workspaceChat` retrieve/retrieveProductKnowledge levert echte grounding op een scan-geïndexeerde repo; + de gebundelde **browser-verify-pass** over álle nieuwe UI-tegels van FASE A–DS via de dev-server (de user autoriseerde dev-server + commands + browser-tools). **Proof:** graph rendert echte nodes; AI-antwoorden citeren echte repo/product-chunks.
- **Z9 — PTY-billing-at-scale (invariant 6/7).** Bevestig dat de interactieve `claude`-PTY-billing op de Max-subscription houdt onder N gelijktijdige turns (H5-fairness + capacity-cap), zonder in de metered SDK/`-p`-pool te lekken. Een billing/PTY-RED **escaleert naar de user — nooit route-around naar headless**. **Proof:** concurrent-turn-run + billing-inspectie groen.

## Volgorde-advies (waterfall)

1. **FASE X** — ontsluit-mechanismen eerst (de op-catalog + copilot-propose + chat-persist ontgrendelen ~30 latere items met één-regel-registratie i.p.v. herbouw).
2. **FASE SEC** — security-critical vóór feature-werk (Rule 19; privilege-escalation, owner-protection, push-lek, SSRF, prod-bypass).
3. **FASE A + B** — dagelijkse noodstop/board-loop merkbaar heel.
4. **FASE G + E + K + I + D** — de dev-orchestratie-helft (time-travel, editor/preview, services/DB, CI/MR, deploy).
5. **FASE R + S + T + P + N** — knowledge-graph, governance/audit/PAT/export, automation, spend, notifications/presence/PWA.
6. **FASE CC + CG + CP + CB + DS** — de content/design-helft A-tot-Z (pipeline-flow, generatie, publishing/scheduling, brand/style, studio/designer).
7. **FASE Z** — alle live-proofs gebundeld in de laatste week (dev-server + echte keys/tokens/Docker/deploy/device).

Elke fase: gebouwd → gegate (tsc+lint+ai:lint+build) → getest (fixture) → ge-ADR'd (bij een durable keuze, bv. P1 token-budget, A5 preview-ops, CB7 brand-retrieve) → branch-log → gecommit vóór de volgende. Ambiguïteit → sensible default + `OPEN VRAAG` in de branch-log, nooit stoppen om te vragen (user is weg).
---

## Addendum-fase RS — gaps uit de 3 her-gescande clusters (pipeline-editor · secrets · nav/i18n)

> Coverage nu 21/21. Deze items komen uit de her-scan; tag `now` tenzij anders vermeld. Elk item: bouw → Verify.

### RS-A · Pipeline-editor structurele ops bedraden (de R1-follow-up)
- **RS-A1** [high][ui] `stageCreate` in WorkspacesContext/Provider (`syncRequest workspaces/stageCreate {key,name,kind}`) + client delta-upsert; `addStage` roept het aan (create-then-edit). Verify: nieuwe stage overleeft refresh; `Save stage` erop werkt. `now`
- **RS-A2** [high][ui] `stageDelete` in de Provider (`syncRequest workspaces/stageDelete {stageId}`) + refetch; aanroepen ná de confirm. Verify: verwijderde stage komt niet terug na refresh. `now`
- **RS-A3** [high][ui] `stageReorder` in de Provider (`{order: stageKeys}`) + refetch, vanuit `move()`; + echte drag-and-drop (dnd-kit). Verify: herordening overleeft refresh. `now`
- **RS-A4** [medium][ux] Hernoem/vervang "Validate with AI" (nu een lokale heuristiek, geen AI) → "Check pipeline" OF route door een echte AI-critique-op (hergebruik `plan-critique`). Verify: label ⟷ gedrag kloppen. `now`
- **RS-A5** [ux] "Unsaved structural changes"-banner tot de ops bedraad zijn. Verify: banner verschijnt bij add/remove/reorder. `now`

### RS-B · Secrets/snapshot-lek dichten (SECURITY)
- **RS-B1** [high][security] Filter interne `__`-rijen uit de snapshot (`server/read/workspaceSnapshot.ts:276,493`), spiegel `serviceEnv.ts:30`. Verify: `__provider_key_*`/`__publish_*` verschijnen niet meer in de Env-tab/snapshot. `now`
- **RS-B2** [medium][security] Mask secret-waarden in de snapshot (`value:''` als `secret`) + een on-demand `reveal-env` read-op gated op `CAP.workspaceSettings`, gelogd in de audit-log. Verify: een workTickets-only lid krijgt geen plaintext secrets; reveal vereist settings-cap + logt. `now`
- **RS-B3** [low][ux] Confirm op `remove-env`/`remove-integration` (in `CONFIRM_REQUIRED` of via `menuHandler.confirm`). Verify: verwijderen vraagt bevestiging. `now`
- **RS-B4** [low][ui] Verberg de settings-tabs voor rollen zonder `workspaceSettings` + surface de sync-error. Verify: non-settings-lid ziet de tab niet / krijgt een foutmelding. `now`
- **RS-B5** [low][security] `rateLimit` op de 4 env/integration `_sync`-routes. `now`

### RS-C · Navigatie, i18n & mobiel (de "leek kan navigeren"-doel)
- **RS-C1** [critical][i18n] Repareer `de.json` als correcte UTF-8 (~416 Ã¼/Ã¶/Ã¤→ü/ö/ä). Verify: geen mojibake meer; byte-check groen. `now`
- **RS-C2** [high][i18n] Repareer `nl.json`-mojibake (~23: Ã©→é, Ã¯→ï, â→—, incl. create-workspace-subtitel :741). `now`
- **RS-C3** [high][i18n] Voeg `workspaces.nav.<id>` + `workspaces.navGroup.<g>` toe aan alle 4 locales; vertaal `it.label`/`GROUP_LABELS` bij render (Shell.tsx:56-75,104,136,751; MobileChrome.tsx:50-53). Verify: nav is vertaald in nl/de/fr. `now`
- **RS-C4** [high][i18n] Voeg de 9 ontbrekende board-keys toe aan de/fr (newTicket*/filter*/all*/clearFilters). `now`
- **RS-C5** [medium][i18n] Vertaal `workspaces.designer.*` + `workspaces.scheduled.*` voor de/fr. `now`
- **RS-C6** [medium][ui] Mobiele bottom-bar module-aware seeden uit enabled sections + de dode FAB implementeren of verwijderen (Shell.tsx:735-740). `now`
- **RS-C7** [medium][ui] Mobiele workspace-knop bedraden (switcher-sheet) + workspace-settings in de drawer (MobileChrome.tsx:31-34,50). `now`
- **RS-C8** [medium][ux] Mobiele drawer module-gaten filteren (`isSectionEnabled`, zoals Shell.tsx:131). `now`
- **RS-C9** [medium][ux] ⌘K-palette uit de enabled `NAV_ITEMS` bouwen (module-aware, vertaald). `now`
- **RS-C10** [low] Studio/brand bereikbaar onder de Design-module. `now`
- **RS-C11** [ux] Locale-lint CI-gate (missing-key + mojibake + identical-to-en-ratio) in `ai:lint`. Verify: de check vangt een geïntroduceerde mojibake/missing-key. `now`
