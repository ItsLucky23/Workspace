# Scan-rapport: Workspaces als universele dev + media tool — 2026-07-09

> **Methode:** 7 parallelle read-only scan-agents over de actuele codebase (niets gewijzigd), elk met file:line-bewijs, gecheckt tegen de verwachting uit de user-prompt: *"iedere codebase kunnen ontwikkelen, zo goed als alle edge/use cases dekken (tijdelijk Kafka testen, snelle publish van commit X op DNS Y), media-scenario's (uploads laten samensmelten, foto-feedback, style→nieuw verhaal→hele video, software-walkthrough-video, video-restyle), alles grondig via UI editen, AI-tweaks zonder dure API-calls"* — plus de advertentie-hoek eromheen.
>
> **Statuslegenda:** ✅ WERKT ECHT · 🔌 GEBOUWD-NIET-ONTSLOTEN (backend af, geen UI/assistant-ingang) · 🟡 DEELS · 🧪 FIXTURE (echt codepad, live onbewezen) · ❌ ONTBREEKT

---

## 0. Managementsamenvatting

De codebase is **backend-rijk en eerlijk, maar ingang-arm**. De grote verrassing van deze scan is niet dat er features missen — het is dat een fors deel van wat de user vraagt **al gebouwd is en nergens aan een knop of aan de assistant hangt**:

1. **Geen stille nep-successen meer.** De eerlijkheids-schuld (ADR 0144-era) is echt afbetaald: publish/render/media/claude-cli rapporteren nu allemaal eerlijk `stub`/`error` i.p.v. nep-`done`. Oudere memory-claims ("YouTube-upload kapot", "greenfield maakt alleen een DB-rij") zijn **achterhaald** — beide zijn nu echt gebouwd.
2. **Het dual-mandaat "alles via UI én via de workspace-AI" wordt zwaar gemist.** Van de **138 control-ops** heeft ~72% (99) een UI-ingang, maar de assistant kan er maar **5 (~3,6%)** voorstellen (`bulk-move`, `assign`, `add-comment`, `create-ticket`, `create-content`). **~38 ops zijn door níemand bereikbaar** — waaronder complete ADR-feature-families (CI, DB/migraties, services, stages, budget, mr-review, root-cause).
3. **Drie fundamenten ontbreken echt** (geen wiring-kwestie): **multi-repo git-storage** (R3-b: 2e repo overschrijft de 1e), **custom DNS per deploy** (alles hangt aan één wildcard-basedomein), en **video-to-video / vision** (geen restyle van bestaand beeldmateriaal, geen AI die pixels ziet).

**De drie snelste grote winsten** (backend staat er al):
- **Assistant-verb-whitelist verruimen** — het propose→accept→Conductor-mechanisme (B-23) is generiek; de whitelist van 5 is de enige bottleneck voor "alles tegen de AI kunnen zeggen".
- **Services + demo-env/time-travel + stage-ops aan de UI hangen** — Kafka provisionen, "commit X op een URL", pipeline hervormen: alles werkt server-side en heeft nul frontend.
- **Upload→VideoScene-wiring** — geüploade video's als timeline-scenes maakt "laat deze video's op elkaar inwerken" én de demo-video-fallback in één klap mogelijk; `content-save-scenes` accepteert het `videoAssetId` al.

---

## 1. Score per user-scenario

| # | Scenario (uit de prompt) | Status | Kern |
|---|---|---|---|
| 1 | Iedere codebase kunnen ontwikkelen | 🟡 | node/python/go/rust/java ✅; PHP/.NET/Ruby/C++ ❌ (base-image-guard); multi-repo kapot ❌ |
| 2 | Tijdelijk Kafka (o.a.) toepassen en testen | 🔌 | Complete compose-engine + Kafka-preset + netwerk/env-injectie; **geen UI, geen assistant-pad, geen connection-strings** |
| 3 | Snelle publish van commit X op DNS Y | 🔌/❌ | `demo`-env + `pinnedCommit` + time-travel previews bestaan server-side (🔌); **eigen domein kan nergens** (❌); envs serveren dev-server, geen prod-build (❌) |
| 4 | Random video's uploaden → "laat ze op elkaar inwerken" | ❌ | Upload werkt, stitch-engine werkt, maar upload wordt nooit een scene (dead-end); audio van uploads gaat verloren |
| 5 | Foto uploaden + aangeven wat anders moet | 🟡 | Mask-inpaint ✅, lokale filters/crop/tekst ✅; instruct-edit zonder mask ❌; AI-foto-critique ❌ (geen vision) |
| 6 | Style/theme → AI verzint verhaal → hele video | ✅/🟡 | `content-run-pipeline` echt end-to-end vanuit de UI-knop; assistant kan hem níet triggeren; continuïteit tussen clips zwak; 9:16/1:1 bereikt de render niet |
| 7 | AI doorloopt eigen software → demo-video | ❌ | Geen browser/recorder in enige runtime-container, geen walkthrough-driver; alleen de render+voiceover-staart bestaat |
| 8 | Video uploaden → AI maakt betere/cinematic versie | ❌ | Video-to-video ontbreekt; "styles" zijn prompt-tekst op *generatie*, raken bestaande pixels nooit |
| 9 | Alles grondig via UI editen | 🟡 | Image-editor ✅ (browser-geverifieerd); video-timeline + inpaint gebouwd maar **pending browser-verify**; geen timeline-preview vóór render; geen losse audio-editor |
| 10 | AI-tweaks zonder dure API-calls | 🟡 | Edits zijn al lokaal/gratis (ffmpeg/Fabric) ✅; maar 3 editor-knoppen vuren stil betaalde generaties af, cheap-preview-seam heeft geen UI, en chat kan géén edit-ops aansturen (I3 deferred) |
| 11 | Advertenties (toegevoegd door deze scan) | ❌/🧪 | Organisch publiceren grotendeels echt maar live onbewezen; **paid ads volledig afwezen** — wel scherpe seams om op te bouwen |

---

## 2. Dev-kant

### 2.1 Services ("even Kafka erbij") — 🔌 backend compleet, nul ingang
- ✅ Sanitizer fail-closed (`server/container/composeSanitize.ts:24-85`: blokkeert privileged/docker.sock/host-mounts/host-network, herschrijft host-ports), compose-engine met per-workspace namespacing + netwerk (`server/container/composeEngine.ts:56`), 7 presets incl. Kafka-KRaft, Postgres, Redis, RabbitMQ, ES, MinIO, Mailpit (`servicePresets.ts`).
- ✅ De coding-agent-container **bereikt** de service echt: `docker network connect` + env-injectie bij launch (`server/container/runtime.ts:102,157`, `serviceEnv.ts`).
- 🔌 **Geen enkele `.tsx` roept `serviceProvision`/`serviceTeardown` aan**; assistant kan het niet voorstellen (verb-whitelist, `src/workspaces/_data/types.ts:648`). "Spin up Kafka" kan vandaag alleen via een handgemaakte `syncRequest`.
- ❌ Presets registreren **geen connection-strings** (`serviceEnv.ts:24` injecteert alleen user-EnvVars) — de agent weet niet dat `kafka:9092` bestaat tenzij de user handmatig een EnvVar toevoegt.
- ⚠️ `ServiceStack` is workspace-scoped (`schema.prisma:304`) — twee projecten kunnen geen eigen instantie van dezelfde stack hebben.

### 2.2 Any-stack — 🟡
- ✅ Catalogus: node|python|go|rust|java met eigen base-image + dev-command (`server/container/baseImages.ts:11,48`).
- ❌ Daarbuiten (PHP, .NET, Ruby, C++): de `extendsAllowedBase`-guard (`baseImages.ts:56`, afgedwongen in `imageBuild.ts:34`) eist `FROM workspaces/base*` — `FROM php:8.3` is onmogelijk; toolchain moet handmatig ge-apt-get worden bovenop de Node/Debian-base. Bewuste keuze (PTY-agent/editor in-image), maar het plafond voor "iedere codebase".
- ✅ Greenfield is nu echt: `project-from-template` → echte file-tree + eerste commit + bare-clone (`conductor.ts:1878`, `repoStore.ts:222`); 4 templates (node-api, react-vite, python-fastapi, go-api) met `.workspaces/Dockerfile` + `ci.yml`; UI via ProjectSwitcher-wizard (live E2E-geverifieerd).

### 2.3 Multi-repo — ❌ R3-b bevestigd, nog steeds kapot
- Metadata-laag ✅ (N projecten, switcher-UI, webhook-routing per repo via `resolveProjectByRepo`, `webhookIngest.ts:82`).
- Storage-laag ❌: alles gekeyed op alleen workspaceId (`repoStore.ts:31`); `cloneRepo` **verwijdert de bestaande bare repo** bij het linken van een 2e (`repoStore.ts:209`); 2e greenfield-project krijgt géén repo (no-op `:224`); worktrees en image-builds pakken altijd de (oudste) gedeelde repo (`imageBuild.ts:29` `findFirst`). **Eén workspace = feitelijk één werkende repo.**

### 2.4 Deploy & publish ("commit X op DNS Y") — 🔌 motor af, ingang en domein missen
- 🔌 **Time-travel previews compleet**: ephemere ref-container (`refPreview.ts:21`), "main-minus-commit-X"/"as-of-timestamp" synthetic refs (`timeTravel.ts:35,47`), `timeTravelPreview_v1`-op. **Nul frontend-callers**; de assistant is letterlijk geïnstrueerd het alleen te *beschrijven* (`workspaceChat.ts:57`) en verwijst naar een preview-control die niet bestaat.
- 🔌 **`demo`-env + `pinnedCommit` = precies "commit X op een stabiele URL"** incl. auto-redeploy-watch (`environment.ts:38-42`, `demoWatch.ts`) — maar de settings-UI rendert alleen `['dev','staging','prod']` (`settings/page.tsx:279`); geen demo-kind, geen pin-veld.
- ❌ **DNS Y onmogelijk**: host is altijd `<kind>-<slug>.<WS_BASE_DOMAIN>` (`server/proxy/index.ts:62-68`); `Environment` heeft geen custom-domain-veld; TLS is wildcard-only. "preview.mijndomein.nl" is nergens uitdrukbaar.
- ❌ **Alle envs draaien `npm run dev`** (`environment.ts:75,91`) — ook "prod". De enige echte prod-build is de download-export (`buildExport.ts:67` — echt, incl. `docker save`), die nooit *geserveerd* wordt.
- ✅ Ladder + gating echt: dev→staging→prod, prod gated op approval + groene CI + security (`promote.ts:13-30`); geen auto-deploy-on-merge.
- ✅ Rollback echt in twee smaken: MR-revert-knop én AI-root-cause → rollback-suggestion + tracking-ticket (`conductor.ts:1773-1775,1990`).
- ✅ CI-gates echt (merge/promote/test-stage, `ci/gate.ts`), maar `ci-run`/`ci-allow-red` hebben geen UI-knop.

### 2.5 Pipeline-flexibiliteit
- ✅ Test-stage → auto-CI, rood blokkeert advancement (`ci/gate.ts:49`, `stageRunner.ts:317`).
- 🔌 **Stage add/remove/reorder persist niet**: ops bestaan (`conductor.ts:1729/1748/1756`), maar de pipeline-pagina muteert alleen React-state en saved via `save-stage-config` (updateMany op bestáánde stage) — een toegevoegde stage verdwijnt bij refresh (`pipeline/page.tsx:599,601,614,621`).

### 2.6 Dev-edge-cases die (nog) niet kunnen
- Preview is **single-port** (`WS_PREVIEW_PORT`, default 5173) — multi-port apps / aparte WS-poort niet previewbaar.
- Background workers/cron in de user-app: alleen uitdrukbaar als compose-service → achter de missende services-UI.
- DB/migraties: ops gebouwd (`db-connect`/`db-migrate-*`/`db-introspect`, ADR 0043) — **geen UI, feature onbereikbaar**.
- Secrets voor de user-app ✅ via EnvVar (decrypt bij launch).

---

## 3. Media-kant

### 3.1 Uploads combineren — ❌ (dead-end na import)
- Upload (`POST /media/upload`, mp4/webm/mov, 64MB) + `content-import-asset` ✅; stitch-engine met echte xfade/trim/offset-math ✅ (`render.ts:125-205`).
- ❌ Maar scenes ontstaan op precies één plek: uit AI-gegenereerde clips (`sceneDecompose.ts:65-72`). De timeline-editor heeft **geen "voeg geüpload asset toe als scene"**; video-AssetCards tonen alleen open/download (edit-gates op `kind==='image'`, `page.tsx:157`). De bedrading bestaat al: `content-save-scenes` accepteert een willekeurig `videoAssetId` (`conductor.ts:1361`) — **puur een UI-gat**.
- ❌ **Audio van geüploade clips gaat verloren**: de stitch mapt alleen videostreams; audio komt uitsluitend uit aparte voice/music/sfx-inputs (`render.ts:192-202`) — een stitch van uploads is stil.
- ⚠️ Verdere edge-cases: verticale uploads worden geletterboxed naar 16:9 (`render.ts:129`); geen codec-normalisatie vóór concat/xfade (mixed-codec kan falen, degradeert eerlijk); trim-window kan bronclip-lengte overschrijden.

### 3.2 Foto-feedback/edit — 🟡
- ✅ Mask-inpaint end-to-end (`ImageRegionEditor` → `content-inpaint` → flux-inpaint met image+mask+prompt, `fal.ts:87-88`); lokale filters/crop/resize/tekst gratis via Fabric.
- 🟡 Reference-conditioned regen (image-to-image, `fal.ts:92`) bestaat — genereert een níeuw beeld op basis van de foto, geen gerichte edit.
- ❌ Whole-image instruct-edit (flux-kontext-stijl "verander de lucht") ontbreekt.
- ❌ AI-critique ontbreekt fundamenteel: het enige "analyze"-pad geeft de media-**URL als tekst** aan het LLM (`referenceVideo.ts:58-64`) — geen model ziet ooit pixels. Er is geen vision-capability in de hele keten.

### 3.3 Style → verhaal → hele video — ✅ vanuit UI, 🟡 vanuit AI
- ✅ `runContentPipeline` ketent script→voice→decompose→assemble (`runPipeline.ts:30-77`), gedreven door de marquee-knop met style/duur-pickers. Eerlijke degradatie zonder keys.
- 🟡 Assistant kan alleen `create-content` (piece aanmaken) — **niet de pipeline draaien**; user moet alsnog klikken.
- 🟡 Continuïteit tussen clips = alleen vorige beat-*tekst* in de volgende prompt (`sceneDecompose.ts:18-26`); geen last-frame→next-clip conditioning — visuele flow is hoop, geen garantie.
- ❌ **Formats bereiken de render niet**: 9:16/1:1-presets bestaan en zijn getest (`render.ts:26-33`), maar `assembleContent` geeft nooit een format door (`assembly.ts:104-106`) → altijd 16:9. Verticale video (het shorts/reels-formaat!) is feitelijk onbereikbaar.
- 🟡 Captions: echte getimede .srt/.vtt verankerd aan voice-duur ✅, maar sidecar-only — niet ingebrand/gemuxed.
- ✅ Audio-mix wordt nu echt aangeroepen (muziek geduckt 0.25 + sfx + voice-gains, `render.ts:83,198,214`).
- ❌ Render-thumbnails/posters bestaan niet.
- ✅ Queue-aware lifecycle (ADR 0098) intact; ✅ stub-honesty overal op orde.

### 3.4 Demo-video van eigen software — ❌, met een realistische fallback
- ❌ Geen chromium/playwright/recorder in orchestrator of containers (`docker/base.Dockerfile:7-62`); ffmpeg heeft geen screen-input; "screenshots" in ui-review zijn user-uploads (`uiReview.ts:31-35`).
- ✅ Wat er wél al ligt: pointbare preview-URL per ticket/ref + de volledige render+voiceover-staart.
- **Fallback dichtbij**: user uploadt screen-recording → zelfde upload→scene-wiring als §3.1 → montage/captions/muziek via de bestaande renderer. Een échte pixel-restyle (cinematic grade) vergt een nieuwe video-to-video-provider die er niet is.

---

## 4. Editors & kosten ("niet alle kleine tweaks dure API-calls")

**De architectuur is hier al goed**: render/assembly = 100% lokale ffmpeg (costCents:0); Fabric-edits client-side; alle generatieve ops via de betaalde registry met budgetguard en "≈ €X"-chips + confirm op de generatie-knoppen (`page.tsx:210-221`).

**De gaten:**
1. **3 editor-knoppen vuren stil betaalde generaties af zonder €/confirm**: Refine-range (`VideoTimelineEditor.tsx:124` → fal video-gen ~€0,40/scene), Decompose (`:222` → N× video-gen; 10 beats ≈ €4, één klik), Inpaint (`ImageRegionEditor.tsx:94`). Regenerate ×N toont "kost geld" maar niet bedrag × aantal. **Laagst hangende fix: dezelfde costLabel/confirm-flow hergebruiken die de generatie-chips al hebben — de cost-table bestaat al.**
2. **Cheap-preview-seam (ADR 0129) heeft geen UI** — getest, maar alleen activeerbaar via deployment-brede env `WS_MEDIA_CHEAP`. Geen "goedkope preview"-knop per request.
3. **Geen timeline-preview-playback vóór render** — resultaat pas zichtbaar na (gratis maar trage) render.
4. **Chat kan géén edit-op aansturen** (I3 bewust deferred): "maak scene 2 korter/donkerder" bereikt `content-save-scenes`/`refine-range` niet — het valt terug op tekst óf wordt richting `create-content` geduwd = juist een dúre nieuwe generatie. De edit-verbs bestaan al op Conductor/RBAC; alleen de chat-whitelist en de content-context in `interpretChat` ontbreken.
5. Geen losse audio-editor (waveform+mix leeft alleen ín de timeline); losse audio-assets trimmen kan niet.
6. Status: image-editors browser-geverifieerd ✅; **VideoTimelineEditor nog pending browser-verify**.
7. Inherente grens (geen bug): gesproken tekst/clip-inhoud wijzigen kan ffmpeg niet → dat blijft terecht betaalde regeneratie.

---

## 5. Advertenties & marketing

**Organisch (grotendeels echt, live onbewezen):**
- ✅ Studio genereert 11 artifact-soorten incl. `ads` (2-3 varianten per platform) en `thumbnail`-creatives (`studio/generate.ts:23-38,95-117`) — maar het blijven statische artifacts, niets wordt naar een platform gepusht.
- ✅ Channels + multi-account-model (tokenKey per platform+account) + echte OAuth-code voor Google/TikTok incl. token-refresh; ✅ echte YouTube 3-leg byte-upload + TikTok PULL_FROM_URL + status-poll (`publishOAuth.ts:204-258`). 🧪 Live onbewezen: geen OAuth-apps geregistreerd, alles E2E met fixture-transports.
- ❌ Instagram/LinkedIn: `platform.notBuilt` (`publish.ts:34-35`) — maar de channels-UI biedt ze wél aan (verwarrend).
- 🔌 Scheduling-backend (leader-loop, `scheduledAt`) af; **UI stuurt alleen `{assetId, platform}`** — geen account-picker, geen schedule-picker, geen kalender.
- 🔌 `publishVariants` wordt geconsumeerd bij publish maar **door niets geschreven** — per-platform captions/hashtags vallen altijd stil terug op de titel.
- ❌ Analytics-feedback-loop: metrics-parsers echt maar zonder production-caller; `topPerformers` → ideator zijn twee helften die elkaar nooit raken (`ideatorRole.ts:15-20`).

**Paid ads — volledig afwezig, maar goed voorbereid:**
- ❌ Geen ad-platform-API's, geen Campaign/AdSet/AdCreative/AdSpend-modellen, geen A/B-meting, geen UTM/shortlink/klik-tracking, geen ad-budget (SpendRecord = AI-token-spend).
- **Seams voor een minimale ads-laag** (goed afgebakende build, geen open einde): ad-OAuth klonen van `publishRoute.ts`-flow; delivery-connector als sibling van het injectable `PublishUploadTransport`; Studio-`ads`/`thumbnail`-output als creative-bron; metrics-ingest-patroon + cron-`WorkspaceTrigger` voor de feedback-loop; alle writes via het bestaande B-23 propose→confirm (ad-spend = irreversibel → expliciete confirm). Net-new: alleen de schema-modellen + afdwingbare ad-budget-caps.

---

## 6. UX voor de niet-technische gebruiker

**Verdict: structureel capabel, novice-vijandig.** Scherpste punten:
1. First-run eindigt op een "board wordt geladen…"-scherm zonder call-to-action (`board/page.tsx:388-393`).
2. De **SetupWizard bestaat maar is onvindbaar** — alleen een klein "Quick setup"-linkje diep in settings (`workspace/page.tsx:928`); onboarding ketent er nooit in; de beloofde NL-assistant-setup is niet geïmplementeerd (eigen header-comment).
3. Onboarding-scherm 1 lekt al jargon ("containers & pipeline… repo + Dockerfile"); verspreid door de UI onverklaard: MR, RAG, PTY, PAT, egress, orchestrator, WIP-limit, cron, SHA. `InfoDot`-tooltips bestaan maar op slechts 2 van ~13 pagina's; de enige docs-pointer is een dode, niet-klikbare `<div>` naar een repo-bestandspad.
4. Lege staten mis-geframed als mislukte zoekopdrachten ("No tickets match — try a different filter" op een gloednieuw board).
5. **Nav-chrome is hardcoded Engels** in alle 4 talen (`_shell/Shell.tsx:57-74,736-739`) + pipeline-labels + designer-showcase — i18n-regel wordt op de zichtbaarste plek gebroken.
6. **~12 stille no-op-knoppen** die live ogen (Terminals restart/clear/rename, board add-reference/pause-resume, ticket open-in-GitLab, Sources regenerate/reindex, snooze…) — voor een leek onvindbaar verschil tussen "kapot" en "nog niet gebouwd".
7. Mobiel: AI-sheet werkt echt ✅; xterm-terminal en de Usage-tabel (geen `overflow-x-auto`, `usage/page.tsx:140`) zijn probleem-pagina's.
8. `<title>Test</title>` staat nog in `index.html:9`.
9. Notificaties: 3 push-categorieën ✅; quiet-hours/DND gespecced maar niet gebouwd; multi-question-stepper (W1-kaart) ontbreekt (needs-input = één string); chat-proposals zijn accept-only (geen reject).
10. Best-practice om te kopiëren: de Interviewer-pagina (intro + 4 klikbare starter-prompts) — nergens anders toegepast.

### De dekkingsmatrix (kern van het dual-mandaat)
- **138 control-ops totaal** · **99 met UI** · **5 via assistant** · **~38 via geen van beide.**
- Door niemand bereikbaar o.a.: `ci-run`/`ci-allow-red`, `db-connect`/`db-migrate-*`/`db-introspect`, `stage-create/delete/reorder`, `service-provision/teardown`, `raise-cap`/`edit-budget`/`resume-spend`, `gitlab-verify/resync`, `mr-review`, `root-cause`, `plan-critique`, `index-memory`, `ui-review-create`, output-templates, `copy-workspace-assets`, en een rits content-ops (advance/archive/unarchive/unpublish/gen-avatar/analyze-reference-video/reorder-beats/channel-edit). Ook dead: `pause-all` (confirm-dialog roept de op nooit aan, `board/page.tsx:335`).
- De automation-escape-hatch is deels theoretisch: executor ondersteunt notify/webhook/emit-signal/start-stage/invoke-agent-role; `run-command` wordt om veiligheidsredenen geskipt, `invoke-workspace-ai` is unwired.

---

## 7. Eerlijkheids-status (stub-sweep)

- **(a) Stille nep-successen: geen gevonden.** Publish/render/media/claudeCli allemaal eerlijk (o.a. `publish.ts:100-112`, `assembly.ts:107-119`, `registry.ts:49-90`, `claudeCli.ts:101-105`). Alle `.catch(()=>null)`-sites zijn benigne best-effort.
- **(b) Eerlijke stubs**: `stub://`-assets bij ontbrekende keys, netjes gebadged en publish-geblokkeerd.
- **(c) Gebouwd-maar-unwired** = het echte completeness-gat (zie §6-matrix + budget-editing, DB-panel, content-lifecycle, publishVariants-writer, multi-account-doorgifte, metrics-loop, MR-review-knop, PAT-UI).
- **(d) Nooit browser-geverifieerd**: VideoTimelineEditor, ImageEditor-B-fasen, ImageRegionEditor, P-B-kaarten. **Nooit gebóuwd** (backend-only, geparkeerde "browser-gen-ronde"): N2-graph-UI, Y2-ultrasync, U2/U3, content-calendar, admin-tegels (audit-log/spend/export).
- **(e) Notables**: stale comment in `promote.ts:5` (zegt TODO, code is echt); Sources-per-doc-knoppen zijn Fase-2-noops; product-knowledge-RAG hangt alleen aan de chat, niet aan de script-generator (`script.ts:80`); `Workspace.handoffInstruction` dood veld.

---

## 8. Geprioriteerde actielijst

### P0 — fundamenten + de "alles-was-al-af"-ontsluiting
| # | Actie | Waarom | Zwaarte |
|---|---|---|---|
| 1 | **Assistant-verbs verruimen** (whitelist 5 → gecureerde set over de 138 ops; content-context in `interpretChat`; I3) | Dé multiplier: dekt "alles tegen de AI zeggen", incl. edits, pipeline-run, deploys, services. Mechanisme (propose→accept, B-23) bestaat al — geen nieuwe verbs nodig | M |
| 2 | **R3-b: repoStore/imageBuild/draft.Dockerfile per-project re-keyen** | Multi-repo is nu stilletjes destructief (2e repo wist de 1e) | L (cross-cutting, Docker-verify) |
| 3 | **Upload→VideoScene-wiring + audio van uploads behouden** | Ontgrendelt scenario 4 (uploads combineren) + de demo-video-fallback; backend accepteert het al | S/M |
| 4 | **Services-UI + assistant-pad + preset-connection-strings** | Kafka-scenario; engine + security staan er volledig | S/M |
| 5 | **Demo-env/pinnedCommit + time-travel previews in UI + custom-domain-veld op Environment (+ per-domain TLS)** | "Commit X op DNS Y"; motor af, alleen ingang + domein-concept missen | M |
| 6 | **Kosten-confirm op refine/decompose/inpaint/regenerate + cheap-preview-toggle** | Directe geld-lekkage-preventie; cost-table + confirm-flow bestaan al | S |
| 7 | **Stage-editor knoppen → R1-ops wiren** | Add/reorder/delete verdwijnen nu stil bij refresh | S |

### P1 — media-kwaliteit + publish-keten afmaken
- Format doorgeven aan render (9:16/1:1 — shorts/reels!), captions optioneel muxen/inbranden, render-thumbnails.
- Instruct-edit (flux-kontext-achtig) + vision-critique (echte image-input naar een multimodaal model) — provider-abstractie bestaat al.
- Video-to-video-seam (restyle "cinematic") — nieuwe MediaFeature naast video-gen.
- Scene-continuïteit: last-frame-extractie → image-conditioning van de volgende clip.
- Timeline-preview-playback vóór render; browser-verify-ronde van timeline/inpaint/P-B.
- PublishVariants-writer (AI-compose per platform) + account/schedule-picker + kalender-UI; metrics-ingest production-caller + topPerformers→ideator; prod-build serveren i.p.v. dev-server; budget/DB/CI/MR-review/PAT-UI's.

### P2 — nieuwe lagen
- **Ads-laag**: Campaign/AdSet/AdCreative/AdSpend-modellen + ad-OAuth + delivery-connector + UTM/shortlinks + A/B-meting, op de in §5 genoemde seams; ad-spend altijd achter expliciete confirm (B-23).
- **Demo-video-recorder**: chromium+recorder in een capture-container gericht op de preview-URL + AI-walkthrough-driver + glue naar de bestaande render.
- **UX-ronde**: onboarding→wizard-keten, empty-states met CTA's, jargon-tooltips/glossarium, nav-i18n, no-op-knoppen wiren of verbergen, quiet-hours, IG/LinkedIn-adapters (of ze uit de channels-picker halen), `<title>` fixen.

---

## 9. Correcties op eerdere aannames (memory/docs)
- "YouTube-upload doet alleen stap 1" → **achterhaald**: 3-leg byte-upload is echt (D1/ADR 0150).
- "Greenfield maakt alleen een DB-rij" → **achterhaald**: echte repo + files + commit (G1/G2).
- "OAuth = fixtures" → **genuanceerd**: de code is echt (connect/refresh/upload), alleen *live* onbewezen zonder geregistreerde OAuth-apps.
- `docs/GAP_ANALYSIS.md` blijft verouderd; `promote.ts:5`-comment is stale (gate bestaat).
- `controlApi.ts`-header ("one `_api/<op>_v1.ts` per op") is stale — dispatch loopt via `_sync`-handlers.
