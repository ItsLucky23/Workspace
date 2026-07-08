# ADOPTION PROGRAM — van premium naar no-brainer (het volgende grote /goal-bouwplan)

> Doel: elke reden wegnemen waarom iemand deze tool **niet** zou kiezen — voor "bouw een nieuw softwareproduct op eender welke stack met eender welke third-party service" én voor "run een YouTube/TikTok-kanaal A-tot-Z" én voor "een team van 10 devs vertrouwt dit dagelijks". Gebaseerd op **4 verse read-only audits (2026-07-08)**: product-surface, dev-orchestratie-diepte, content-pijplijn-diepte, team/ops-readiness — plus de 5 user-wensen (2026-07-08). Draai met `/goal` over dit bestand, fase-voor-fase, waterfall (elke fase getest+gecommit vóór de volgende). Auteur-commits: `ItsLucky23`, niet gepusht. Alle bestaande invarianten blijven gelden (single-writer/B-23, frozen structured-channel-verbs, `runInTenant`, PTY-billing, geen `as any`, tryCatch, i18n×4, theme-tokens, per-item test+ADR+branch-log+commit, gates tsc+lint+ai:lint+build). Premium-UX-DoD = FREEDOM_PROGRAM §0b voor élk UI-item.

## Relatie met IDEA_TO_OUTCOME (GELAND — 2026-07-08)

`IDEA_TO_OUTCOME_PROGRAM.md` is COMPLEET (ADR 0155–0160): P-B, D3, D4, G1/G2 zijn geland. Geen wacht-afspraken meer — dit programma bouwt bovenop die fundamenten:
- **W1/W2** (vragen) bouwen voort op P-B's structured-approval-kaarten.
- **T2** (main-zonder-commit-X) hergebruikt D3's demo-env/pinned-commit-machinerie.
- **S2** (stack-starter-templates) bouwt op G1's repo-init.
Een item hier NIET herbouwen als het al bestaat — eerst `git log`/branch-log checken.

## Kern-visie (user, 2026-07-08)

1. **Non-blocking vragen in de pipeline** — de AI kan vragen stellen maar wél doorwerken aan de rest (vooral code-gericht).
2. **"Start een server vanaf main maar zonder commit X"** — via de Workspace-AI een oudere/aangepaste versie draaien waar dingen nog werkten.
3. **"Unfuck the UI"** — UI(-screenshots) uploaden → meerdere redesigns laten genereren + checkboxen aanvinken van wat er mis is (onoverzichtelijk, te veel op één pagina, niet responsive, inconsistentie tussen buttons/dropdowns/invoervelden/pagina's).
4. **RAG/Obsidian-view** — de kennis van de workspace als interactieve graph.
5. **Ultrasync** — cursor-bewegingen e.d. live streamen zodat je precies ziet wat iemand doet; eventueel screen-preview per user vanaf een bepaald RBAC-level.

## Wat de audits bevestigen (context, geen werk)

De engine is écht (123 conductor-ops, echte PTY/Docker/ffmpeg/fal/ElevenLabs/YouTube-byte-upload, honest degrade — geen nep-successen meer sinds ADR 0144). De gaps zitten aan de **randen**: greenfield/any-stack/services (dev), autopilot/analytics/token-refresh (content), audit-trail/SSO/spend/fairness (team), en live-e2e-bewijs op de geld-paden. `docs/GAP_ANALYSIS.md` (2026-07-07) is **verouderd** — niet meer als bron gebruiken.
**Doc-divergentie (invariant 8, flag):** `02_PROTOCOL_AND_FLOW.md:47` + `09_QUESTIONS_IN_TICKETS.md` beschrijven een blocking `request_input`-verb die niet in code bestaat (code = park-and-resume via Stop-hook); geen ERRATA-rij. W1/W2 hieronder maken de code-realiteit canoniek — werk de docs bij als onderdeel van W1.

---

## VOORTGANG (levend — bijgewerkt per gecommit increment)

| Item | Status | ADR | Test |
|---|---|---|---|
| F1 OAuth token-refresh (publish) | ✅ | — (hardening) | publishOAuth-unit 27/27 · publishReal-integratie (+refresh) |
| F2 audio-mix + captions + ffprobe-timing wiren | ✅ | — (completion) | renderFormats-unit 46/46 · audioMix 15/15 · assemblyCaptionsMix-integratie 7/7 · musicSfx-regressie 6/6 |
| F3 invite-token hardening (random+expiry+email-bind) | ✅ | — (hardening) | inviteToken-integratie 11/11 |
| F4 PWA-manifest-icons (192/512/maskable/apple) | ✅ | — (asset/config) | pwaManifest-headless 19/19 |
| **FASE F COMPLEET** | ✅ | | F1–F4 gecommit |
| W1 multi-question sets (dood schema → denormalized JSON) | ✅ | 0162 | questionSet-unit 23/23 · multiQuestion-integratie 11/11 |
| W2 non-blocking (advisory) vragen + divergence→revisie | ✅ | 0163 | questionSet-unit 37/37 · turnResultStructured 15/15 · advisoryQuestion-integratie 8/8 |
| W3 idle-worker-container-reaper (stop, resume-safe) | ✅ | — (reaper) | workerReaper-unit 10/10 |
| **FASE W COMPLEET** | ✅ | | W1–W3 gecommit |
| T1 preview op willekeurige git-ref (ephemere ref-container) | ✅ | 0164 | refPreview-unit 15/15 |
| T2 synthetic revert-ref ("main zonder X") + commit-as-of | ✅ | (0164) | timeTravel-integratie 9/9 (echte git) |
| T3 time-travel-preview-op + assistant-awareness (ref-spec) | ✅ | (0164) | timeTravel-integratie 14/14 (+resolveRefSpec) |
| **FASE T COMPLEET** | ✅ | | T1–T3 gecommit |
| S1 any-stack multi-base catalog + relaxed guard + Project.stack | ✅ | 0165 | baseImages-unit 20/20 |

---

## FASE F — Stille-breuk-fixes (klein, hoogste vertrouwens-ROI, eerst)

- **F1 — OAuth token-refresh (publish).** `refreshToken`/`expiresAt` worden opgeslagen (`publishOAuth.ts:75`) maar **nooit gebruikt** — `getConnection` levert het verlopen token, dus elke post >1u na connect (incl. álle geplande posts) faalt stil. Bouw de refresh-grant (Google token-endpoint / TikTok refresh) + expiry-check in `getConnection` + re-encrypt persist. **Verify:** fixture met verlopen token → refresh-request-shape klopt + nieuw token persisted + upload gebruikt het verse token.
- **F2 — Audio-mix + captions + echte narration-timing wiren.** `buildAudioMixPlan` (voice+geduckte muziek+sfx, `render.ts:154`) en `buildSrt`/`buildVtt` (`render.ts:181`) bestaan + zijn getest maar worden **nergens** in het render-pad aangeroepen; beat-duur = woorden×400ms (`voice.ts:23`) i.p.v. echte audio-duur. Wire `amix` in `renderTimeline`/`renderScenes`, meet audio-duur via ffprobe voor beat/caption-timing, emit `.srt`/`.vtt` bij export. **Verify:** fixture assert amix in het ffmpeg-plan + captions-bestand + duur uit ffprobe-stub; "video mét muziek" kan nu echt.
- **F3 — Invite-token hardening.** Token = `` `inv-${clientRequestId}` `` (client-supplied → te raden/replayen, `conductor.ts:736`) en `Invite` heeft geen `expiresAt` (`schema.prisma:219`). Crypto-random token + expiry + expired-sweep. **Verify:** token niet afleidbaar; verlopen invite geweigerd (test).
- **F4 — PWA-manifest-icons.** Manifest heeft 1 favicon-icon — geen 192/512 PNG's → slechte installability terwijl de push-backend echt is. Voeg icons + naam/theme toe. **Verify:** manifest valide (headless check), installable.

## FASE W — Vragen: multi-question + non-blocking (user-punt 1)

- **W1 — Multi-question sets (het dode schema reviven).** `QuestionSet`/`Question` bestaan in schema (`schema.prisma:818-830`) maar zijn dead code: `stageRunner.ts:325` bewaart alleen `questions[0]` en **dropt de rest stil**. Persist álle vragen met per-vraag status/antwoord; resume-prompt bevat alle antwoorden; phone-first "beantwoord N vragen"-stepper (bouwt op P-B-kaarten). Update ook de divergente docs (zie boven). **Verify:** agent stelt 3 vragen → 3 persisted → 3 beantwoord → resume-prompt bevat alle 3 (test, stub-PTY).
- **W2 — Non-blocking vragen ("ga door met de rest").** Vandaag parkeert needs-input het héle ticket tot antwoord (`watchdog.ts:151`; andere tickets lopen wel door). Nieuw: de agent markeert een vraag als **non-blocking mét default-aanname** → het ticket werkt dóór op de aanname; wijkt het latere antwoord af, dan plant de Conductor automatisch een revisie-turn met de aanname+antwoord+diff als context. Geen nieuw structured-channel-verb — re-express via de bestaande needs-input-payload (extra velden) + `answer-input`. **Verify:** non-blocking vraag → stage rent door (test); afwijkend antwoord → revisie-turn enqueued; gelijk antwoord → geen extra turn.
- **W3 — Idle-worker-container-reaper.** Een geparkeerd ticket houdt zijn Docker-container **onbeperkt idle** vast (editor-reaper bestaat, worker-reaper niet). Reaper stopt containers van needs-input/idle tickets na TTL; answer/resume reprovisiont via het bestaande pad. **Verify:** geparkeerd ticket → container gestopt na TTL → answer → reprovision (injected clock + docker-stub).

## FASE T — Time-travel previews (user-punt 2)

- **T1 — Preview op een willekeurige ref.** Er is **geen** ref/commit-parameter in welk run/preview/deploy-pad dan ook (`openPreview_v1` = `{workspaceId,ticketKey}`; clone = `--branch --single-branch` op de tip, `runtime.ts:122`; expliciet "Deferred" in `features/23_PREVIEW_DEPLOYMENT.md:23`). Bouw: `ref`-param op openPreview → full-history clone (of fetch-on-demand) → `git checkout <sha>` → ref-scoped route-key/subdomain zodat 2 refs van één branch naast elkaar kunnen. **Verify:** 2 previews van dezelfde branch op verschillende SHA's tegelijk (test op route-key + checkout-args, docker-stub).
- **T2 — "Main zonder commit X" (synthetic ref) + "main op timestamp T".** Bouw een synthetic-ref-op: `git revert --no-commit <X>` (of range) op een tijdelijke ref → T1-preview draait "main minus X"; idem "main zoals op tijdstip T" (commit-vóór-T). Revert-conflict → nette getypeerde fout + AI-hulp ("deze commits hangen samen met X"). Hergebruik D3's demo-env-machinerie; sluit aan op de AI-rollback-wens ("X werkt niet meer" → AI zoekt de verdachte commit → biedt preview-zonder aan). **Verify:** synthetic-ref-bouw getest op een git-fixture (clean revert + conflictpad); preview-args wijzen naar de tijdelijke ref.
- **T3 — Via de Workspace-AI (phone-first).** Assistent-vocabulaire uitbreiden zodat "start een server vanaf main zonder commit X" / "draai de versie van gisteren 14:00" een **propose→accept→Conductor**-voorstel wordt (frozen verbs: re-express via de bestaande preview/run-ops met ref-spec). **Verify:** NL-zin → geldig voorstel met ref-spec → accept start de preview (stub-runtime, test); assistent kan niets direct schrijven.

## FASE U — UI-doctor: "unfuck the UI" (user-punt 3)

- **U1 — UI-review-intake (upload + probleem-checkboxen).** Nieuw `UiReviewRequest`: screenshots uploaden (K1-upload bestaat) en/of pagina-screenshots uit de preview-container; checkbox-taxonomie van wat er mis is — *onoverzichtelijk · te veel op één pagina · niet responsive · inconsistente controls (buttons/dropdowns/invoervelden) tussen pagina's · spacing/uitlijning · kleurgebruik · visuele hiërarchie* — + vrije tekst. **Verify:** intake persisteert screenshots + aangevinkte problemen tenant-scoped (test).
- **U2 — N redesigns genereren + kiezen → implementatie.** Per request N redesign-varianten via de bestaande seams (vision-analyse + image-gen mockups en/of HTML-design-artifact via de Studio/Designer-route) → side-by-side compare → keuze → wordt een **ticket met het gekozen design-artifact + de aangevinkte problemen als stage-instructies** voor de code-agent. **Verify:** request → N varianten (stub-providers) → keuze → ticket met gekoppeld artifact + instructies (test); B-23-gate vóór spend.
- **U3 — Consistency-scan over pagina's.** Cross-page scan (meerdere screenshots of de component-inventaris uit de repo) → inconsistentie-rapport ("deze 3 buttons/dropdowns/velden wijken af") → één-klik fix-ticket per bevinding. **Verify:** fixture met 2 bewust inconsistente screenshots → rapport + tickets (stub-vision, test).

## FASE N — Kennisgraph / Obsidian-view (user-punt 4)

- **N1 — Graph-data-op.** Eén tenant-scoped read-op die de workspace-kennis als graph levert: nodes = InfoSources/context-docs, tickets, beslissingen, content-pieces (optioneel: repo-files/routes uit de index); edges = expliciete verwijzingen (ticket↔MR↔piece↔source) + RAG-similarity (top-k per node). **Verify:** graph-op levert nodes+edges, tenant-scoped, similarity-edges uit de bestaande retrieve (test).
- **N2 — Interactieve graph-UI (Obsidian-gevoel).** Canvas/force-layout: zoom/pan, klik → open de bron, filter per node-type, zoeken, hover-preview. Lazy-loaded (nooit in een non-graph chunk). **Verify:** browser-verified; de data-op eronder is getest.
- **N3 — RAG-schaal + index-hygiëne.** App-side cosine-scan schaalt niet (bewuste v1); swap-pad naar Mongo `$vectorSearch` (of lokale HNSW) **achter dezelfde retrieve-API**, + index-status op de Sources-pagina (wat is geïndexeerd, coverage, staleness — "RAG moet altijd scherp zijn"). **Verify:** retrieve-API ongewijzigd (bestaande tests groen); status-op getest; grote-corpus fixture kiest het snelle pad.

## FASE Y — Ultrasync: activity-presence + DOM-meekijken (user-punt 5, herzien 2026-07-08)

Twee gebruiksdoelen op één engine: (a) **Google-Docs-achtige activity-info** (wie-doet-wat), (b) **meekijken via DOM-streaming** — zowel verborgen admin-toezicht (RBAC, zonder waarschuwing) als gewone peer-to-peer "kijk bij mij mee". Beslist: GEEN echte pixel-capture (`getDisplayMedia` kan niet stil + toont een browser-balk → botst met verborgen admin-tooling); GEEN live cursor-streaming in v1 (per-input/textbox-live = expliciet v2, vergt per-page reasoning). De **cross-origin openvscode-editor** is de enige bekende blinde vlek (DOM noch pixels bereikbaar in een cross-origin iframe) → toon daar alleen "editor actief, inhoud niet zichtbaar".

**Zichtbaarheids-model (user-beslissing):** een **workspace-instelling** moet de hele Ultrasync-laag AAN hebben → dan wordt binnen die workspace alles gedeeld (je eigen activity + je meekijk-stream). Een **user-toggle** is puur VISUEEL (of jij de overlay/anderen ziet); je eigen data wordt altijd gedeeld zolang de workspace het aan heeft — je kunt jezelf niet onzichtbaar maken. Deelname aan een workspace-met-Ultrasync-aan is de consent-grens (geen aparte login-prompt). De verborgen admin-kijkrol kijkt zonder enige waarschuwing **en zonder audit-log-rij** (user-beslissing 2026-07-08: volledig spoorloos — géén record dat admin X bij user Y keek); peer-to-peer meekijken toont wél een "X kijkt mee"-badge.

- **Y1 — Activity-presence-kern (de "get it working"-deliverable).** Page-level wie-is-waar: navbar/NavRail toont per view hoeveel users er zitten (avatars/kleuren); op de pagina zelf per user passief-kijkend vs **actief-bewerkend** (bv. "bewerkt ticket #12" — uit presence + de control-op/edit-stroom; patroon `presence_server_v1`, ephemeral, userId uit de sessie, tenant-scoped). Statusdrempels (instelbaar): **actief** <60s · **idle** daarna · **weg** bij disconnect/heartbeat >5min. Workspace-aan-toggle + user-visuele-toggle. **Scope: kern + werkend op de pipeline-pagina + navbar** (bewijs dat het staat). **Verify:** presence-aggregatie + statusdrempels getest (injected clock, tenant-scoped); workspace/user-toggle-gedrag getest; navbar + pipeline-pagina browser-verified.
- **Y2 — DOM-streaming meekijk-engine (generieke basis, alle pagina's).** rrweb-stijl: één volledige DOM-snapshot bij open + daarna alleen mutaties (scroll/cursor/inputs) over websockets — de ÉCHTE gerenderde DOM van de bekeken user (dus incl. hun session-data + client-side filters), niet onze eigen re-render. Admin-kant rendert in een sandbox-iframe. Twee consumers, dezelfde engine: **(a) verborgen admin-watch** (nieuwe RBAC-permissie `ultrasync.watch` → kijkt zonder waarschuwing én zonder audit-record), **(b) peer-share** (gewone user deelt → "X kijkt mee"-badge). Auto-tier: lichte pagina's ~10-15Hz flush, zware ~2fps; **dynamische downgrade** bij CPU/bandbreedte-piek; **fps/mode-label** in de admin-preview ("board · 12Hz DOM" / "editor · 2fps"). **Scope: kern + werkend op de pipeline-pagina.** **Verify:** snapshot+mutatie-relay getest (fixture); RBAC-gate `ultrasync.watch` getest (verborgen = geen badge, geen audit-rij; peer = badge); auto-tier/downgrade-logica getest; pipeline-pagina meekijken browser-verified.
- **Y3 — Semantische adapters voor zware tools (optioneel-incrementeel, licht + trouw).** Waar generieke DOM-diffing zwaar/imperfect is, stream het TOOL-MODEL naar een admin-kant-instantie die de tool één keer laadde: **Fabric image-editor** → `canvas.toJSON` (objecten+filters+transforms) + bron-image één keer; **video-editor** → admin laadt DEZELFDE media-URL rechtstreeks, wij syncen alleen playback-state (currentTime/paused/selectie/edits — nul video-bytes per frame); **in-page Monaco** → tekst-buffer + cursor/selectie/scroll naar een gecachte admin-Monaco. Deze tools worden zo juist licht (events i.p.v. frames). **Verify:** per adapter: model-relay reconstrueert trouw op de admin-kant (fixture); video-sync stuurt geen bytes; Fabric-filters komen mee.
- **Y4 — Grote TODO: per-page uitrol (follow-up-epic).** De kern (Y1/Y2) staat werkend op pipeline+navbar; dit item rolt presence + meekijken BETEKENISVOL uit per pagina (board, ticket-detail, backlog, content-pieces+editors, studio/designer, settings, terminals…) — per pagina bepalen wat "actief bewerkt" betekent + welke tier + of een Y3-adapter loont. Bewust apart gehouden zodat de kern eerst landt. **Verify:** per uitgerolde pagina een presence/tier-smoke + browser-verify; de lijst afgevinkt in de branch-log.

## FASE S — Any-stack (dev-audit gap #3/#1)

- **S1 — `Project.stack` + per-stack base-images.** Elke image wordt nu geforceerd `FROM workspaces/base` (Node 22; guard ×3: `imageBuild.ts:24-27`, `dockerfileGen.ts:26-29`, `dockerfileDraft.ts:24-27`) — Python/Go/Rust kan alleen als apt-laag bovenop Node. Bouw: `Project.stack`-veld + een base-image-catalog (node/python/go/rust/java) met eigen L1-Dockerfiles; versoepel de guard naar een catalog-allowlist; de pty-agent (Node) blijft een aparte layer/mount zodat de coding-agent overal draait. **Verify:** python-project bouwt `FROM workspaces/base-python` + agent-layer (fixture op de dockerfile-compositie); guard accepteert catalog, weigert een wildvreemde base.
- **S2 — Stack-starter-templates (bovenop G1).** G1 (andere run) levert de bare-repo-init; dit item levert per stack échte starter-code + Dockerfile + `ci.yml` + **eerste commit**, uitbreidbare template-catalog. Greenfield eindigt dan in een draaibare, committbare codebase i.p.v. een lege shell (`conductor.ts:1662-1681` maakt nu alleen een DB-rij + docs). **Verify:** greenfield python → repo met files + eerste commit + buildbare image (git-fixture, geen externe forge).
- **S3 — Stack-agnostische defaults.** `devCommand`-default per stack (uvicorn / `go run` / `cargo run` / `npm run dev`), preview-poort configureerbaar (nu 5173-aanname in `previewSession.ts:38`), healthcheck per stack. **Verify:** per-stack defaults resolven (test); preview-args kloppen per stack.

## FASE K — Services via compose-engine (user-beslissing 2026-07-08)

User koos de **compose-engine**: elk docker-compose-bestand moet kunnen ("alle tools die er maar zijn"), niet alleen een vaste catalog. De user heeft gelijk dat het rúnnen gelijkstaat aan lokaal `docker compose up`; de extra randen zitten niet in het runnen maar in **multi-tenancy** (twee workspaces met elk een Kafka mogen niet botsen op poorten/namen/volumes/netwerk) en **security** (een compose-bestand kan host-mounts/`privileged`/docker.sock vragen = host-overname). Die dekt K1. Vandaag bestaat er niets (geen provisioner; de "catalog" in `seed.ts:514-524` provisiont niets).

- **K1 — Compose-engine per workspace (met sanitizer).** Input: een docker-compose.yml (upload of `.workspaces/compose.yml` in de repo) → **valideer/sanitize** tegen een policy (verboden: `privileged`, host-mounts buiten het workspace-volume, `network_mode: host`, docker.sock-mounts; vaste host-port-publishes herschreven naar toegewezen poorten) → **namespace** per workspace (`docker compose -p ws-<id>`, eigen per-workspace netwerk i.p.v. de globale bridge, volume-prefix) → run + health/lifecycle (start/stop/status/logs) in de UI. **Verify:** sanitizer-fixtures (kwaadaardige compose → geweigerd/herschreven); namespacing-args getest; lifecycle-ops getest (docker-stub).
- **K2 — Service-presets (catalog = curated compose-snippets).** Eén-klik Kafka/Postgres/Redis/RabbitMQ/Elasticsearch/MinIO/Mailpit als voorgebakken compose-snippets bovenop K1 (goede defaults + healthchecks) — de makkelijke weg voor wie geen compose schrijft. **Verify:** preset → geldige gesanitizede compose → creds beschikbaar (fixture).
- **K3 — Env-injectie in agent- én preview-containers.** Connection-strings (K1/K2-services + BYO `DbConnection`/`EnvVar`) auto-injecteren in de agent- en preview-containers, die mee op het per-workspace netwerk gaan (`07b §6.3` — ontworpen, 0 impl-hits; zelfs de BYO-workaround is vandaag e2e kapot). **Verify:** container-env bevat de creds + container zit op het ws-netwerk (runtime-args fixture); secrets blijven encrypted-at-rest.
- **K4 — Integratie-MCP-scripts echt maken.** `seed.ts` verwijst naar `/pty-agent/mcp/postgres.js` e.a. die **niet bestaan** (`docker/pty-agent/` heeft alleen `agent.mjs`) — een integratie enablen exec't een missend bestand. Schrijf de MCP-servers of herroute naar bestaande npm-MCP-packages. **Verify:** enabled integratie → bestaand command in de gegenereerde `.mcp.json` (test).

## FASE R — Pipeline-vrijheid + multi-repo + test-gate (dev-audit #7/#8/#9)

- **R1 — Stages add/remove/reorder persistent.** De pipeline-editor muteert nu alleen React-state (`pipeline/page.tsx:601-626`) — een refresh gooit structurele edits weg; er bestaat alleen `save-stage-config`. Nieuwe control-ops `stage-create`/`stage-delete`/`stage-reorder` (Conductor-patroon, RBAC) + volgorde-validatie op `kind`. **Verify:** reorder/add/delete persisteert + overleeft refresh (conductor-op-test).
- **R2 — Deterministische test-gate.** De AI-test-stage levert alleen vrije tekst; de echte CI-gate vergt een handgeschreven `ci.yml` + handmatige trigger. Wire: test-stage vuurt de built-in CI automatisch (ci.yml aanwezig → run + pass/fail op het ticket; afwezig → de stage stelt eerst een `ci.yml` voor). **Verify:** test-stage met ci.yml → CI-run + gate-status op het ticket (docker-stub test); zonder ci.yml → voorstel-pad.
- **R3 — Multi-repo echt.** De bare clone is gekeyed op `workspaceId` (`repoStore.ts:31`) — een tweede project **overschrijft** de eerste; webhook-ingest hangt élk issue aan project #1 (`webhookIngest.ts:77`). Re-key per project + webhook-routing naar het juiste project. (Bekend open punt uit de expansion-run.) **Verify:** 2 projecten → 2 clones; webhook landt bij het juiste project (test).

## FASE C — Content-autopilot: kanaal A-tot-Z (content-audit #1/#2/#3)

- **C1 — Scheduling bruikbaar maken (threading + calendar).** De scheduled-publish-engine is gebouwd + geboot (`runScheduledPublish`, ADR 0122) maar **niets zet `scheduledAt`** — de publish-accept post direct (`conductor.ts:1572`). Thread `scheduledAt` door suggestie/accept + een content-calendar-UI (plannen/verslepen). **Verify:** accept met `scheduledAt` → job `scheduled` → leader-loop vuurt op tijd (injected clock); reschedule werkt.
- **C2 — Channel-autopilot ("dagelijkse short om 9:00").** Niets ketent cron→produce→publish (de enige schedulbare rol is de ideator die een tekst-idee voorstelt). Bouw: recurring channel-automation = cron → ideator → `runContentPipeline` → (approval-gates via de autonomie-dial) → C1-schedule/publish; series-/format-templates per kanaal (O5-seam). **Verify:** autopilot-run stub-e2e: idee→piece→scheduled publish-job, gates gerespecteerd (test).
- **C3 — Audience-analytics + feedback-loop.** Er is nul views/CTR/watch-time — `contentAnalytics.ts` telt alleen productie + kosten. Bouw: YouTube Analytics / TikTok metrics-ingest per published asset → insights-pagina + feed de performance-context terug naar de ideator ("dit werkte"). Live met keys (user-triggered), fixture-getest. **Verify:** ingest-parser-fixture; metrics zichtbaar; ideator-prompt bevat performance-context (test).
- **C4 — Per-platform varianten genereren + voice-picker.** `PublishVariant` (caption/hashtags/privacy) wordt geconsumeerd maar niets **genereert** het; voice is hardcoded default (Rachel, `elevenlabs.ts:27`). AI genereert per platform titel/caption/hashtags (+ compose-UI, O2-follow-up) + een ElevenLabs voice-picker (lijst + preview). **Verify:** variant-gen fixture per platform; voice-lijst-op getest; gekozen voice bereikt de TTS-call.
- **C5 — Thumbnail-templates + A/B + visuele brand-kit.** Brand is nu tekst-only; text-overlay is vast wit/zwart. Visuele brand-kit (logo/font/palette via upload) + thumbnail-templates (compositie: achtergrond+tekst+logo) + A/B-varianten per piece. **Verify:** template→render-fixture; A/B-varianten gekoppeld; brand-assets drijven de compositie.

## FASE H — Team-trust & governance (team-audit top-blockers)

- **H1 — AuditLog voor admin/security-ops.** `change-role`, `save-env`/`remove-env`, `remove-member`, `transfer-ownership`, `delete-workspace`, `role-update`, `invite` muteren **zonder enig spoor** (`conductor.ts:520-736`; er is géén AuditLog-model — alleen ticket-events zijn auditbaar). Nieuw append-only `AuditLog` + record op elke governance-op + audit-view (filter op actor/type/periode; AI vs mens zoals in `TicketEvent.actor`). **Verify:** elke governance-op schrijft een row (test per op); view tenant-scoped.
- **H2 — Per-user spend + afdwingbaar AI-budget.** `SpendRecord` heeft geen `userId` (`schema.prisma:1064`) → geen per-dev attributie; `WorkspaceBudget.pauseNew/pauseAll` is "visibility only, never a hard stop" (`spend/record.ts:29`) — alleen media-budget dwingt af. Voeg `userId` toe + per-dev usage-view + dwing budget-breach echt af op nieuwe AI-turns (zoals media al doet). **Verify:** breach → nieuwe turn geweigerd/gepauzeerd (test); spend per user zichtbaar.
- **H3 — 2FA/SSO: GESCHRAPT voor deze run (user-beslissing 2026-07-08).** De user wil dit later mogelijk op **framework-niveau** oplossen (`@luckystack/login` uitbreiden met TOTP/OIDC) i.p.v. in de consumer-app. Niet bouwen; deze notitie blijft staan als toekomst-anker. (De audit-bevinding blijft waar: voor externe orgs is dit een adoptie-blocker.)
- **H4 — Workspace-export (data-portabiliteit).** Geen self-service export — alleen brand/style-JSON en build-artifacts; een team kan zijn tickets/events/pieces/media niet meenemen (lock-in-angst = adoptie-blocker). Full-workspace-export (JSONL + media-manifest, zip; media optioneel). **Verify:** export bevat alle entiteiten tenant-scoped (test); import = out-of-scope, geflagd.
- **H5 — Concurrency-fairness per workspace.** De admission-cap + FIFO zijn host-globaal (`capacity.ts`, default **4**) — één druk workspace verhongert de rest; 4 is krap voor 10 devs. Per-workspace fair-share/cap + instelbare limieten. **Verify:** 2 workspaces, ongelijke druk → fair-share gehonoreerd (stub-slots-test).
- **H6 — Dag-1 onboarding + upgrade-ledger.** Diepe operator-docs bestaan, maar geen "nieuwe teamdev, dag 1"-gids; Mongo heeft geen migrations-ledger (upgrade leunt op tolerant reads). Schrijf beide (docs-item). **Verify:** gids verwijst naar echte flows; ledger-format + huidige versie vastgelegd.

---

## Volgorde-advies (waterfall)

1. **Fase F** — stille breuk eerst (klein, direct vertrouwen in wat er al is).
2. **Fase W + T** — user-punt 1 en 2; de dagelijkse loop wordt merkbaar beter (P-B en D3 zijn geland — bouw erop voort).
3. **Fase S + K + R** — de "any stack + any service"-ontgrendeling (grootste nieuwe doelgroep; G1 is geland — S2 bouwt erop).
4. **Fase U + N + Y** — de premium-differentiators (user-punt 3, 4, 5).
5. **Fase C** — kanaal-autopilot (content A-tot-Z afmaken).
6. **Fase H** — team/enterprise-trust (de "10 devs zeggen ja"-laag).

Elke fase: gebouwd → gegate → getest → ge-ADR'd → gecommit vóór de volgende. Browser-heavy UI (U2-compare, N2-graph, Y1/Y2/Y4, C1-calendar) verifiëren met de dev-server (de user autoriseerde de dev-server + alle commands + browser-tools autonoom) — bundelen met de nog openstaande browser-verify-pass van de IDEA_TO_OUTCOME-run.

## OPEN VRAGEN — RESOLVED (user-beslist 2026-07-08; de run stopt nergens om te vragen)

- **OV-1 (Ultrasync) → BESLIST: DOM-streaming, 2 doelen, workspace+user-zichtbaarheid.** Activity-presence (Google-Docs-stijl, GEEN live cursors; per-input = v2) + DOM-streaming meekijken via één engine met twee consumers (verborgen admin-watch zonder waarschuwing én zonder audit-record via RBAC `ultrasync.watch` + peer-share met badge); generieke DOM-basis op alle pagina's + semantische adapters (Fabric/video/Monaco) + auto-tier/fps-label/downgrade. GEEN pixel-capture (kan niet stil). Workspace-aan + user-visuele-toggle (eigen data altijd gedeeld). Openvscode cross-origin = blinde vlek. Kern op pipeline+navbar, per-page uitrol = Y4-epic. Fase Y herschreven (nu 4 items).
- **OV-2 (SSO/2FA) → BESLIST: geschrapt** — mogelijk later op framework-niveau (zie H3-notitie).
- **OV-3 (any-stack) → BESLIST: multi-base catalog.**
- **OV-4 (services) → BESLIST: compose-engine** — elk compose-bestand, met sanitizer + per-workspace namespacing; catalog = presets erbovenop. Fase K is hierop herschreven.
- **OV-5 (main-zonder-X) → BESLIST: beide** — pinned oudere commit/timestamp én synthetic revert-ref ("main minus X").
- **OV-6 (C3 analytics-keys) → BESLIST: fixtures nu, live later** (user-triggered met keys, zoals de publish-e2e).
- **Run-modus (user, 2026-07-08):** alles in **ÉÉN autonome /goal-run**, volgorde = het volgorde-advies, minimale touchpoints (user is een dag weg) — ambiguïteit → sensible default + `OPEN VRAAG` in de branch-log, nooit stoppen om te vragen. Kleine npm-deps die een item nodig heeft (bv. een force-layout-lib voor N2, een WebRTC-helper voor Y3) mogen geïnstalleerd worden, mits lazy-loaded buiten de core-chunks — zelfde afspraak als de FREEDOM-run (fabric/web-push).

## Grounding

De 4 read-only audits van 2026-07-08 (product-surface, dev-diepte, content-diepte, team/ops — file:line-evidence in de audit-rapporten zelf), bovenop `IDEA_TO_OUTCOME_PROGRAM.md` (VOORTGANG-tabel) en `FREEDOM_PROGRAM.md` (44 items, ADRs 0110–0143). In-repo specs om te honoreren: `07b_CONTAINER_RUNTIME.md` (K2 env-injectie §6.3), `FORGE_ABSTRACTION.md` (S2/R3), `features/23_PREVIEW_DEPLOYMENT.md` (T1 heft de "Deferred" op), `TRUST_SAFETY_UX.md` (W/H), `CLIENT_AND_PUSH.md` (F4), `BUILTIN_CI_PIPELINES.md` (R2), `AI_QUALITY_AND_EVALS.md` (U/C-AI-features). Codes resolven via `REFERENCE_CODES.md`.
