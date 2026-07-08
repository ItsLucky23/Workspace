# ADOPTION PROGRAM — van premium naar no-brainer (het volgende grote /goal-bouwplan)

> Doel: elke reden wegnemen waarom iemand deze tool **niet** zou kiezen — voor "bouw een nieuw softwareproduct op eender welke stack met eender welke third-party service" én voor "run een YouTube/TikTok-kanaal A-tot-Z" én voor "een team van 10 devs vertrouwt dit dagelijks". Gebaseerd op **4 verse read-only audits (2026-07-08)**: product-surface, dev-orchestratie-diepte, content-pijplijn-diepte, team/ops-readiness — plus de 5 user-wensen (2026-07-08). Draai met `/goal` over dit bestand, fase-voor-fase, waterfall (elke fase getest+gecommit vóór de volgende). Auteur-commits: `ItsLucky23`, niet gepusht. Alle bestaande invarianten blijven gelden (single-writer/B-23, frozen structured-channel-verbs, `runInTenant`, PTY-billing, geen `as any`, tryCatch, i18n×4, theme-tokens, per-item test+ADR+branch-log+commit, gates tsc+lint+ai:lint+build). Premium-UX-DoD = FREEDOM_PROGRAM §0b voor élk UI-item.

## Relatie met de lopende IDEA_TO_OUTCOME-run (niet dupliceren!)

Een andere agent draait `IDEA_TO_OUTCOME_PROGRAM.md`. Daar resteren: **P-B** (structured approvals), **D3** (demo-host main-op-DNS), **D4** (prod-build-export), **G1/G2** (greenfield repo-init + wizard) + de browser-verify-pass. Dit programma bouwt **bovenop** die items:
- **W1/W2** (vragen) bouwen voort op P-B — pas starten als P-B geland is.
- **T2** (main-zonder-commit-X) hergebruikt D3's pinned-commit/demo-env-machinerie.
- **S2** (stack-starter-templates) bouwt op G1's bare-repo-init.
Een item hier NIET herbouwen als de andere run het al leverde — eerst `git log`/branch-log checken.

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
| — | ⬜ | | |

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

## FASE Y — Ultrasync: live presence (user-punt 5)

- **Y1 — Live cursors/selectie.** Ephemeral relay (patroon `presence_server_v1` — geen persist, userId uit de sessie): cursor/selectie op het board + ticket-detail (+ editors waar zinnig), gethrottled (~10Hz), kleur per user. **Verify:** relay-shape + throttle getest; browser-verify.
- **Y2 — Team-activity ("wat doet iedereen nú").** Live per user: huidige view/ticket/actie (uit presence + de control-op-stroom) in een team-panel + avatars op de plek zelf. **Verify:** presence-aggregatie getest (meerdere users, tenant-scoped).
- **Y3 — Follow-mode + screen-preview vanaf RBAC-level.** Fase 1 = **follow-mode**: volg iemands in-app state live (zelfde view/ticket meebewegen) — goedkoop en privacy-arm (alleen app-state, geen pixels). Fase 2 = echte screen/tab-share (WebRTC) — **OV-1**: privacy-gevoelig én zwaar; alléén met expliciete opt-in van de bekeken user + RBAC-gate, en pas na user-akkoord. **Verify (fase 1):** follow-mode volgt view-changes (relay-test); RBAC-gate getest.

## FASE S — Any-stack (dev-audit gap #3/#1)

- **S1 — `Project.stack` + per-stack base-images.** Elke image wordt nu geforceerd `FROM workspaces/base` (Node 22; guard ×3: `imageBuild.ts:24-27`, `dockerfileGen.ts:26-29`, `dockerfileDraft.ts:24-27`) — Python/Go/Rust kan alleen als apt-laag bovenop Node. Bouw: `Project.stack`-veld + een base-image-catalog (node/python/go/rust/java) met eigen L1-Dockerfiles; versoepel de guard naar een catalog-allowlist; de pty-agent (Node) blijft een aparte layer/mount zodat de coding-agent overal draait. **Verify:** python-project bouwt `FROM workspaces/base-python` + agent-layer (fixture op de dockerfile-compositie); guard accepteert catalog, weigert een wildvreemde base.
- **S2 — Stack-starter-templates (bovenop G1).** G1 (andere run) levert de bare-repo-init; dit item levert per stack échte starter-code + Dockerfile + `ci.yml` + **eerste commit**, uitbreidbare template-catalog. Greenfield eindigt dan in een draaibare, committbare codebase i.p.v. een lege shell (`conductor.ts:1662-1681` maakt nu alleen een DB-rij + docs). **Verify:** greenfield python → repo met files + eerste commit + buildbare image (git-fixture, geen externe forge).
- **S3 — Stack-agnostische defaults.** `devCommand`-default per stack (uvicorn / `go run` / `cargo run` / `npm run dev`), preview-poort configureerbaar (nu 5173-aanname in `previewSession.ts:38`), healthcheck per stack. **Verify:** per-stack defaults resolven (test); preview-args kloppen per stack.

## FASE K — Services/sidecars: "any third-party service" (dev-audit gap #2/#6)

- **K1 — Service-catalog + provisioner.** Er is vandaag **geen enkele** manier om Kafka/Postgres/Redis/Elasticsearch aan een workspace te hangen (repo-breed: alleen docs/seed; de "catalog" in `seed.ts:514-524` provisiont niets). Bouw: catalog (postgres/redis/kafka/rabbitmq/elasticsearch/minio/mailpit) → `docker run`-sidecar per workspace/project op een **per-workspace docker-network** (tenant-grens; nu één globale bridge), health-probe, lifecycle (start/stop/status) in de UI, volumes. **Verify:** provision-op genereert de juiste container+netwerk-args (docker-stub fixture); status/lifecycle-ops getest.
- **K2 — Env-injectie in agent- én preview-containers.** Ontworpen in `07b §6.3`, 0 implementatie-hits: connection-strings (K1-services + BYO `DbConnection`/`EnvVar`) worden nu **niet** in de containers geïnjecteerd — zelfs de BYO-workaround is e2e kapot. **Verify:** container-env bevat de creds (runtime-args fixture), tenant-scoped, secrets encrypted-at-rest blijven.
- **K3 — Integratie-MCP-scripts echt maken.** `seed.ts` verwijst naar `/pty-agent/mcp/postgres.js` e.a. die **niet bestaan** (`docker/pty-agent/` heeft alleen `agent.mjs`) — een integratie enablen exec't een missend bestand. Schrijf de MCP-servers of herroute naar bestaande npm-MCP-packages. **Verify:** enabled integratie → bestaand command in de gegenereerde `.mcp.json` (test).
- **K4 — `services.yml`-import.** Detecteer `.workspaces/services.yml` (of `docker-compose.yml`) in de repo → map naar K1-catalog-services, zodat een bestaand project z'n services declaratief meeneemt. **Verify:** parse+map getest (fixtures incl. onbekende service → nette fout).

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
- **H3 — 2FA (TOTP) + SSO (OIDC).** Alleen e-mail+wachtwoord+OAuth vandaag; geen MFA/SSO — voor veel orgs een harde no-go voor een tool die code schrijft en secrets bewaart. TOTP eerst (klein), daarna generieke OIDC (**OV-2**). **Verify:** TOTP-flow getest (enroll/verify/recovery); OIDC-login tegen een mock-issuer (fixture).
- **H4 — Workspace-export (data-portabiliteit).** Geen self-service export — alleen brand/style-JSON en build-artifacts; een team kan zijn tickets/events/pieces/media niet meenemen (lock-in-angst = adoptie-blocker). Full-workspace-export (JSONL + media-manifest, zip; media optioneel). **Verify:** export bevat alle entiteiten tenant-scoped (test); import = out-of-scope, geflagd.
- **H5 — Concurrency-fairness per workspace.** De admission-cap + FIFO zijn host-globaal (`capacity.ts`, default **4**) — één druk workspace verhongert de rest; 4 is krap voor 10 devs. Per-workspace fair-share/cap + instelbare limieten. **Verify:** 2 workspaces, ongelijke druk → fair-share gehonoreerd (stub-slots-test).
- **H6 — Dag-1 onboarding + upgrade-ledger.** Diepe operator-docs bestaan, maar geen "nieuwe teamdev, dag 1"-gids; Mongo heeft geen migrations-ledger (upgrade leunt op tolerant reads). Schrijf beide (docs-item). **Verify:** gids verwijst naar echte flows; ledger-format + huidige versie vastgelegd.

---

## Volgorde-advies (waterfall)

1. **Fase F** — stille breuk eerst (klein, direct vertrouwen in wat er al is).
2. **Fase W + T** — user-punt 1 en 2; de dagelijkse loop wordt merkbaar beter. *W1/W2 pas ná P-B van de lopende run; T2 ná D3.*
3. **Fase S + K + R** — de "any stack + any service"-ontgrendeling (grootste nieuwe doelgroep). *S2 ná G1.*
4. **Fase U + N + Y** — de premium-differentiators (user-punt 3, 4, 5).
5. **Fase C** — kanaal-autopilot (content A-tot-Z afmaken).
6. **Fase H** — team/enterprise-trust (de "10 devs zeggen ja"-laag).

Elke fase: gebouwd → gegate → getest → ge-ADR'd → gecommit vóór de volgende. Browser-heavy UI (U2-compare, N2-graph, Y1/Y3, C1-calendar) verifiëren met de dev-server (suggest→approve) — bundelen met de nog openstaande browser-verify-pass van de IDEA_TO_OUTCOME-run.

## OPEN VRAGEN (defaults als de user er niet is — log de keuze in de branch-log)

- **OV-1 (Y3 screen-preview):** echte WebRTC screen-share is privacy-gevoelig + zwaar. **Default:** alleen fase 1 (follow-mode + live-cursors); echte screen-share pas na expliciete user-keuze (opt-in van de bekeken user + RBAC-gate zijn dan verplicht).
- **OV-2 (H3 SSO):** **Default:** generieke OIDC (openid-client); SAML alleen op expliciete vraag.
- **OV-3 (S1 basis-strategie):** **Default:** multi-base catalog (schone per-stack images + agent-layer); niet nóg meer lagen op de Node-base.
- **OV-4 (K1 provisioner):** **Default:** eigen catalog-provisioner (`docker run` + per-workspace netwerk); compose-import (K4) is de brug, geen volwaardige compose-engine bouwen.
- **OV-5 (T2-semantiek):** "main zonder commit X" = **synthetic revert-ref** (default) én "pinned oudere commit/timestamp" (deels D3). Beide landen in T1/T2; bevestig of revert-semantiek de bedoeling was.
- **OV-6 (C3 keys):** analytics-ingest heeft extra OAuth-scopes/keys nodig → live-verificatie user-triggered (zoals eerdere publish-e2e); fixtures dekken de parser/flow.

## Grounding

De 4 read-only audits van 2026-07-08 (product-surface, dev-diepte, content-diepte, team/ops — file:line-evidence in de audit-rapporten zelf), bovenop `IDEA_TO_OUTCOME_PROGRAM.md` (VOORTGANG-tabel) en `FREEDOM_PROGRAM.md` (44 items, ADRs 0110–0143). In-repo specs om te honoreren: `07b_CONTAINER_RUNTIME.md` (K2 env-injectie §6.3), `FORGE_ABSTRACTION.md` (S2/R3), `features/23_PREVIEW_DEPLOYMENT.md` (T1 heft de "Deferred" op), `TRUST_SAFETY_UX.md` (W/H), `CLIENT_AND_PUSH.md` (F4), `BUILTIN_CI_PIPELINES.md` (R2), `AI_QUALITY_AND_EVALS.md` (U/C-AI-features). Codes resolven via `REFERENCE_CODES.md`.
