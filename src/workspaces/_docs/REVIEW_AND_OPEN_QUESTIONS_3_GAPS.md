# Workspaces — Gap-audit & open vragen (ronde 3)

> Geproduceerd 2026-06-21 door een parallelle 7-agent audit over de HELE `workspaces-handoff/`-corpus (architectuur 01–08 + addenda, alle 24 feature-docs, de all-in-one laag, de 16 additions + Tier-2, de tool-module build-plans en de brainstorm-rondes).
>
> **Doel:** alle nog-niet-vastgelegde gaten uitgewerkt als beantwoordbare vragen, zodat de gebruiker ze later kan invullen om het project scherper te schetsen.
>
> **Scope-afbakening.** Dit is bewust GÉÉN herhaling van wat al is opgelost. De twee eerdere reviews (`REVIEW_AND_OPEN_QUESTIONS.md` = 68 Q's, `REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE.md` = 50 Q's, beide "accepteer-alle") en de decision-ledgers (`additions/00_DECISIONS_LEDGER.md`, `build-plans/DECISIONS.md`) zijn als dedupe-bron gebruikt. Elke `G-…` hieronder is een NIEUW gat dat dáár niet in zit. De `ui-builder/`-referentie-app is buiten scope gelaten (het is referentiecode, geen productspec).
>
> **Werkwijze om te beantwoorden:** vul de `**→ Antwoord:**`-regel per vraag in (over devices). Een leeg antwoord = nog te beslissen. Net als bij de eerdere rondes: als je een hele cluster met één lijn wilt afdoen ("accepteer de aanbeveling tenzij ik vlag"), kan dat ook.

---

## Inhoud (clusters)

1. Engine / PTY / protocol / orchestrator / container-runtime (G-ENG / G-PROTO / G-SM / G-AUTO / G-ORCH / G-CT)
2. Datamodel & contracten (G-DATA / G-CTRL / G-MT / G-MIG)
3. Build, scope & ops (G-SEQ / G-SCOPE / G-DEFER / G-DEPLOY / G-BACKUP / G-OBS / G-ENV / G-SPIKE / G-X)
4. Features 01–12 (G-01 … G-12)
5. Features 13–24 (G-13 … G-24)
6. All-in-one laag + additions (G-FORGE / G-MR / G-CI / G-GIT / G-AIQ / G-CLIENT / G-INSTALL / G-TRUST / G-ANALYTICS / G-ONBOARD / G-FORENSIC / G-SCHED / G-QUOTA / G-PRESENCE / G-NOTIF / G-TIER2)
7. Tool-modules & brainstorm (G-FW / G-INT / G-DSGN / G-MKT / G-DOC / G-IMG / module-X)

---

# 1. Engine / Protocol / Orchestrator / Container-runtime

### Engine / PTY lifecycle

**G-ENG-1** — Wat gebeurt er met de in-flight FIFO-slot en de `attempts`-teller wanneer een Stage-Agent tijdens de §B forced-reconciliation-loop (status `busy`, open templated demand) door de gebruiker op **Pause** wordt gezet, of wanneer de orchestrator crasht midden in de loop?
*Waarom dit een gat is:* 02b §B beschrijft de retry-then-escalate loop met een `attempts`-counter, maar nergens staat of `attempts` op de `AgentSession`-row gepersisteerd wordt of puur in-memory leeft. `resumeAll()` (01 §4 / 07b §9.2) hermint tokens en doet `--resume`, maar zegt niet of een onderbroken reconciliation-loop hervat of vanaf 0 begint.
*Mogelijke richtingen:* `attempts` op de AgentSession-row persisteren en in `resumeAll` herladen · loop bij crash forceren naar `needs-input` (fail-safe) · Pause bevriest de teller en de open demand.
**→ Antwoord:** _(leeg)_

**G-ENG-2** — Tellen de per-user Assistant en de optionele one-shot reasoner mee in `MAX_ACTIVE_TURNS`, en geeft hun Stop-hook identiek de slot vrij als bij een worker?
*Waarom dit een gat is:* 01 §6 + 02b §B koppelen slot-release aan de worker-Stop-hook, maar 01 §6 zegt ook "a user's chat turn waits briefly behind the cap" — wat impliceert dat Assistant-turns óók slots verbruiken. Nergens gespecificeerd of Assistant/reasoner-turns dezelfde FIFO delen.
*Mogelijke richtingen:* één gedeelde FIFO voor alle PTY-types · aparte cap voor interactieve Assistant-turns vs. worker-turns · Assistants ongelimiteerd, alleen workers gecapt.
**→ Antwoord:** _(leeg)_

**G-ENG-3** — Wat is het gedrag wanneer de Stop-hook vuurt zonder geldige `emit_carryover` bij een human-stage (`aiEnabled=false`) of een reasoning-rol (`needsWorkspace=false`) die geen `commitHash` kan produceren?
*Waarom dit een gat is:* De §B envelope-schema eist een verplichte `commitHash`. Een host-side Refine/Plan-rol heeft geen worktree (07b §2.5) en dus geen betekenisvolle commit-hash, maar 02b §B forceert reconciliation op een ontbrekende envelope. Onduidelijk of envelope-eisen per AgentRole verschillen.
*Mogelijke richtingen:* `commitHash` optioneel voor `needsWorkspace=false`-rollen via `outputSchema`-override · reasoning-rollen vrijstellen van de §B-loop · de prior-stage commit-hash doorgeven.
**→ Antwoord:** _(leeg)_

### Structured channel / verb-protocol

**G-PROTO-1** — Houdt een geblokkeerde `request_input` (blocking tot de user antwoordt) de actieve FIFO-slot vast, of geeft hij die vrij terwijl op de gebruiker wordt gewacht (mogelijk uren/dagen)?
*Waarom dit een gat is:* 02 §2 noemt `request_input` expliciet "blocking". Als die call de PTY-turn openhoudt zonder Stop-hook, blijft een `needs-input`-sessie een schaarse slot bezetten. 01 §6 + 02b §B geven geen slot-release voor de needs-input-toestand.
*Mogelijke richtingen:* slot vrijgeven zodra status `needs-input` wordt, heroveren bij `--resume` · `request_input` intern non-blocking (turn eindigt met Stop, antwoord via fresh `--resume`) · aparte "parked"-pool buiten de active-cap.
**→ Antwoord:** _(leeg)_

**G-PROTO-2** — Wat is het idempotentie-/dedup-contract van de verb-calls zelf bij netwerk-retries of een dubbel afgevuurde `emit_signal`/`emit_event`?
*Waarom dit een gat is:* 02 §2 + 07 noemen `WorkspaceSignal`/`TicketEvent` als append-only met `seq`, maar er is geen idempotency-key op de verb-payloads. Een dubbele POST bij timeout is realistisch en kan dubbele signalen/events opleveren die de serial Conductor-consumptie vervuilen.
*Mogelijke richtingen:* client-side idempotency-key per verb-call · server-side dedup op (sessionKey, payloadHash, window) · accepteren dat append-only events dubbel mogen.
**→ Antwoord:** _(leeg)_

**G-PROTO-3** — Wat is de timeout-/foutsemantiek van het synchrone `query_context`-verb wanneer de bevraagde bron (connected Assistant of reasoner) offline/traag is terwijl de worker erop blokkeert?
*Waarom dit een gat is:* 02 §2/§6 stellen dat `query_context` synchroon antwoordt "from the DB or routes to a connected Assistant (or the optional reasoner)". Het Assistant/reasoner-pad heeft geen gedefinieerde timeout, fallback of foutshape — een worker die wacht op een niet-bestaande reasoner kan vastlopen.
*Mogelijke richtingen:* harde timeout → degradeer naar DB-only + `{routed:false}` · alleen DB-synchroon, reasoner-routing async · expliciete `{ok:false, reason:'no-responder'}`.
**→ Antwoord:** _(leeg)_

### Ticket / stage state machine

**G-SM-1** — Wat gebeurt er met een lopende Stage-Agent (`busy`) wanneer een GitLab-webhook-reconcile (GitLab = SoT) de ticket-state extern wijzigt — bv. de MR wordt buiten Workspaces om gemerged of de issue gesloten?
*Waarom dit een gat is:* 02 §1 stelt dat status AI-owned/Conductor-only is, maar 07 §C stelt dat GitLab bij conflict wint. Het snijvlak — een externe merge terwijl een container nog `busy` is — is nergens gespecificeerd.
*Mogelijke richtingen:* externe merge → Conductor forceert teardown + notification · agent draait door, reconcile advisory · lease-conflict-detectie pauzeert de stage.
**→ Antwoord:** _(leeg)_

**G-SM-2** — Hoe annuleert een gebruiker een ticket permanent (vs. tijdelijk pauzeren), en wat gebeurt er met container, `DEV-####`-branch en open QuestionSets? De state-machine kent geen cancel-transitie.
*Waarom dit een gat is:* 02 §1 toont `paused → busy` (resume) maar geen afbreek-/cancel-pad. 07b's reclaim kan een gepauzeerde-maar-niet-geannuleerde container opruimen zonder dat de state-machine dat als terminale toestand kent.
*Mogelijke richtingen:* expliciete `cancelled`-terminalstatus via control-API · pause + handmatige teardown als twee aparte levers · cancel = teardown + behoud branch, QuestionSets → `superseded`.
**→ Antwoord:** _(leeg)_

**G-SM-3** — Hoe wordt een **Reject** op de promote-gate (`approve`-QuestionSet op een `done` stage) afgehandeld — welke status krijgt het ticket en hoe komt de feedback bij de agent?
*Waarom dit een gat is:* 02 §5 stelt "Approve == Promote" en `Question.kind:'approve'` is "tap Approve/Reject", maar de Reject-tak is nergens uitgewerkt in de state-machine.
*Mogelijke richtingen:* Reject → `--resume` dezelfde sessie met de reject-reason als rework-prompt, status terug naar `busy` · Reject → `needs-input` met vervolgvraag · Reject genereert een nieuwe stage-iteratie.
**→ Antwoord:** _(leeg)_

### Automation / triggers / plugins

**G-AUTO-1** — Wat is het volgorde-/concurrency-contract wanneer één event meerdere matchende `WorkspaceTrigger`-rows tegelijk laat vuren, en wat als twee `start-stage`-acties hetzelfde ticket promoten?
*Waarom dit een gat is:* 03 §1.4 toont meervoudige matching zonder volgorde-/exclusiviteitsregel. Twee `start-stage`-triggers op hetzelfde ticket kunnen een dubbele spawn veroorzaken (de "geen concurrent stages per ticket"-regel wordt hier niet als guard genoemd).
*Mogelijke richtingen:* serieel in `createdAt`-volgorde, eerste `start-stage` wint · prioriteitsveld op de trigger · ActionExecutor de-dupliceert conflicterende mutaties.
**→ Antwoord:** _(leeg)_

**G-AUTO-2** — Wat is de fout-/retry-semantiek van de `ActionExecutor` als een actie faalt, gegeven v1 expliciet "no BullMQ for actions" kiest?
*Waarom dit een gat is:* 03 §1.4 zegt BullMQ is een latere drop-in — dus v1 heeft géén retry/visibility. Een gefaalde cron-trigger of een door de CapacityManager afgewezen `invoke-workspace-ai` heeft geen gedefinieerd lot.
*Mogelijke richtingen:* fire-and-forget met error-`TicketEvent` (geen retry) · CapacityManager-afwijzing → enqueue · `lastFiredAt` alleen bij succes zetten.
**→ Antwoord:** _(leeg)_

**G-AUTO-3** — Leeft `debounceMs`/`dedupeKey`/`lastFiredAt` in Redis of in-memory, en wat met een gemiste cron-tick over een crash heen?
*Waarom dit een gat is:* De cron-tick is single-leader onder een lease met een Redis sorted-set view, maar de debounce-state voor event-driven triggers heeft geen gespecificeerde opslag. Een crash kan een debounce-venster verliezen → dubbele firing, of een gemiste tick → permanent overgeslagen vs. catch-up.
*Mogelijke richtingen:* debounce-state in Redis met TTL · `lastFiredAt` op de Prisma-row als waarheid · gemiste cron-ticks: één catch-up fire na lease-herwinning.
**→ Antwoord:** _(leeg)_

**G-AUTO-4** — Wie/wat valideert een `config-review`-`patch` vóór de Conductor hem toepast (stale patch, onbekend `field`, verkeerd type op `PipelineStageCfg`)?
*Waarom dit een gat is:* 03 §4 toont een patch `{stageId, op, field, value}` die bij Accept op de pipeline-config wordt toegepast, zonder schema-validatie/conflict-check. De §D drift-test dekt `types.ts↔DATAMODEL`, niet runtime patch-validatie.
*Mogelijke richtingen:* patch valideren tegen het `PipelineStageCfg`-schema + optimistic-concurrency op een config-versie · verwerpen bij field-mismatch · atomisch toepassen onder de lease met dry-run-diff.
**→ Antwoord:** _(leeg)_

### Orchestrator runtime mechanics

**G-ORCH-1** — Delen `reconcileQueue` (§C), `ragDeltaQueue` (§D) en de §A launch-sequence dezelfde Redis-lease serieel — en kan een lange RAG-full-index dan webhook-reconcile en ticket-launches blokkeren (head-of-line)?
*Waarom dit een gat is:* 07 §A/§C/§D wikkelen elk hun werk in `withLease('lease:orchestrator', …)` — dezelfde lease-naam. Een full RAG-index (minuten) zou elke andere writer-actie blokkeren inclusief ticket-activatie.
*Mogelijke richtingen:* aparte leases per domein (launch/index/reconcile) · index-werk buiten de write-lease, alleen de append onder lease · async snapshot-index waarbij launch niet wacht.
**→ Antwoord:** _(leeg)_

**G-ORCH-2** — Wat is de retry-/rollback-semantiek als de Caddy admin-API onbereikbaar is op het moment van `POST /routes` terwijl de container al draait?
*Waarom dit een gat is:* 07b §8.3 ("rollback the POSTed Caddy route") is tegenstrijdig met de §A-volgorde: als de route-POST faalt, is er nog geen route om terug te rollen, maar de container + worktree bestaan al.
*Mogelijke richtingen:* Caddy-POST idempotent retryen met backoff · launch faalt → volledige rollback (container + worktree) · route lazy zetten bij eerste `dev-`-request.
**→ Antwoord:** _(leeg)_

**G-ORCH-3** — Hoe wordt de RAG delta-indexer gevoed met `prevCommit` voor de diff, gegeven tickets op frozen `commitHash` zitten en `main` intussen meermaals kan zijn gemerged?
*Waarom dit een gat is:* De delta-worker leest `{projectId, commitHash, prevCommit}` maar §C's enqueue levert alleen `commitHash` — `prevCommit` wordt nergens bepaald. Bij parallelle tickets in willekeurige merge-volgorde is "de vorige commit" ambigu.
*Mogelijke richtingen:* `prevCommit` = de vorige geïndexeerde snapshot-commit op de default-branch · diff tegen de merge-base · per-merge de eerste-parent (`-m 1`).
**→ Antwoord:** _(leeg)_

### Container runtime

**G-CT-1** — Kan een container-turn falen met een verlopen token in het venster tussen host-refresh en re-projectie, en wordt zo'n auth-failure gedetecteerd/geretried?
*Waarom dit een gat is:* 07b §2.2 stelt "ONE refresh loop re-projects on refresh" met atomic write-rename, maar de timing (proactief vs reactief) is niet gespecificeerd, en er is geen detectie/retry voor een per-turn auth-fout buiten de P2-happy-path-spike.
*Mogelijke richtingen:* proactief refreshen met ruime marge · auth-failure → forceer re-projection + `--resume`-retry · health-probe op het token vóór elke turn.
**→ Antwoord:** _(leeg)_

**G-CT-2** — Telt een L2 per-project image-build mee in de CapacityManager-budget, en wat als twee tickets van hetzelfde project tegelijk activeren terwijl de L2-tag nog niet bestaat?
*Waarom dit een gat is:* 07b §1.2 bouwt bij ontbrekende tag via de Docker API, maar de CapacityManager (§8) mediteert alleen container-launches, niet image-builds. Twee gelijktijdige activaties kunnen dezelfde dure build dubbel starten (geen build-lock).
*Mogelijke richtingen:* build onder een per-(projectId,contentHash) lease · build telt als resident-budget-item · builds in een aparte serieel-gequeue'de bouwlane.
**→ Antwoord:** _(leeg)_

**G-CT-3** — Wat gebeurt er met de `git clone --single-branch` bij re-activatie van een ticket waarvan de container/volume al is gereclaimd, terwijl er ongecommitte/niet-gepushte wijzigingen op `DEV-####` waren?
*Waarom dit een gat is:* 07b §8.2 bewaart het volume "for re-clone", maar §4 doet juist een verse clone. Of mid-stage working-tree-staat verloren gaat is onduidelijk; per-stage-commit (#9) dekt mid-stage werk niet.
*Mogelijke richtingen:* reclaim forceert een WIP-commit/stash · re-activatie hergebruikt het bewaarde volume · accepteer verlies + documenteer.
**→ Antwoord:** _(leeg)_

**G-CT-4** — Hoe bereikt de stage-agent een DB-integratie (`psql`/`mongosh`/`redis-cli`, B-O8) als alle egress via de HTTP(S)-forward-proxy moet en directe routes geblokkeerd zijn — DB-wire-protocollen zijn geen HTTP?
*Waarom dit een gat is:* 07b §6.1 forceert alle egress door een HTTP-proxy en blokkeert directe routes; DB-protocollen gaan niet door een HTTP-proxy. Het netwerkpad naar de DB botst met "egress via proxy only". (Een van de scherpste interne contradicties in 07b.)
*Mogelijke richtingen:* DB-hosts als expliciete `NO_PROXY`-bestemmingen op `workspaces-net` · een TCP-aware proxy/allow-list voor DB-poorten · DB-toegang alleen via een server-side MCP-tool.
**→ Antwoord:** _(leeg)_

**G-CT-5** — Wat is het failover-/HA-verhaal voor de single-instance orchestrator-container zelf bij langdurig host-/orchestrator-falen — ticket-containers draaien dan verweesd door zonder PTY-relay?
*Waarom dit een gat is:* De orchestrator is lease-gepind op single-instance; geen tweede instance mag overnemen (host-bound state). Geen gespecificeerd gedrag of RTO voor een orchestrator die niet terugkomt.
*Mogelijke richtingen:* gedocumenteerde RTO + handmatige host-recovery · expliciet "geen HA in v1, single-host = SPOF" vastleggen · volume-backup zodat re-clone op een nieuwe host kan.
**→ Antwoord:** _(leeg)_

**G-CT-6** — Hoe is de in-container pty-agent-poort (`127.0.0.1`-published, gelezen via `docker inspect`) bereikbaar voor de orchestrator zónder host-port-publishing — een `127.0.0.1`-binding in de container is van buiten niet benaderbaar?
*Waarom dit een gat is:* 07b §9.1 zegt de pty-agent luistert op een "127.0.0.1-published port the orchestrator reads via docker inspect", terwijl §5/§7 host-port-publishing verbiedt. Intern tegenstrijdig. (De andere scherpe 07b-contradictie naast G-CT-4.)
*Mogelijke richtingen:* pty-agent bindt op de `workspaces-net`-interface en orchestrator dialt by-name · een gedeelde unix-socket via volume-mount · `docker exec`-attach i.p.v. TCP-poort.
**→ Antwoord:** _(leeg)_

---

# 2. Datamodel & contracten

### Prisma-modellen zonder body (genoemd-maar-niet-gespecificeerd)

**G-DATA-PREVIEWDEPLOYMENT** — Wat is de volledige Prisma-body van `PreviewDeployment` (velden, status-enum, relatie, uniciteit, append-only of muteerbaar)?
*Waarom dit een gat is:* `04b §11d` + `§16` + CONTROL_API §8 (`preview-up`/`preview-down`) refereren het model, maar nergens (04/04b/Q-DATA-*) staat de body. Q-DATA-DATAMODEL-SECTIONS leverde §6–§11 maar sloeg dit over.
*Mogelijke richtingen:* muteerbare row `{workspaceId, ticketId, status, port?, caddyRouteId?, commitHash, containerId?, url, …}` één per ticket · append-only event-stijl met afgeleide status.
**→ Antwoord:** _(leeg)_

**G-DATA-WORKSPACESIGNAL-BODY** — Wat is de exacte Prisma-body van `WorkspaceSignal` (de control-API enqueue-target)?
*Waarom dit een gat is:* CONTROL_API §3/§7 stelt dat élke write "append one `WorkspaceSignal`" doet en `04 §3` voegt `seq`+`processedAt` toe, maar de basisvelden (`op`, `target`, `payload`, `actor`, `clientRequestId`, `kind`, `source`) zijn nooit als body gespecificeerd. Het is de spil van het hele schrijfpad.
*Mogelijke richtingen:* één body met een `source`-discriminator (AI-signals én human-ops) · twee aparte modellen.
**→ Antwoord:** _(leeg)_

**G-DATA-RAGENTRY-INFOSOURCE** — Wat zijn de Prisma-bodies van `RagEntry` en `InfoSource` (velden, `@@unique([commitHash,filePath,chunkId])`, embedding-opslag-type, append-only)?
*Waarom dit een gat is:* `04b §11a` markeert `RagEntry` als append-only + DR-restore-priority en B-O3/B-25 geven de dedupe-key, maar geen doc geeft de body (embedding-type bij `$vectorSearch`, chunk-tekst). `04 §1` verwijst naar het bevroren `handoff/DATAMODEL`.
*Mogelijke richtingen:* `RagEntry {workspaceId, commitHash, filePath, chunkId, text, embedding Float[], indexedAt, @@unique(...)}` · embedding in een aparte Atlas-index-collectie.
**→ Antwoord:** _(leeg)_

**G-DATA-INTEGRATIONTOOL-PERSIST** — Worden `IntegrationTool`/`EnvVar`/`IntegrationField` echte Prisma-modellen, en waar leven de versleutelde secret-waarden?
*Waarom dit een gat is:* `04 §3` zegt deze "cover integrations" maar geeft geen body; `types.ts:272` heeft `EnvVar.value: string` als platte string terwijl B-07/Q-SEC-CREDLIFETIME encryptie-at-rest eisen. Q-SEC-CREDLIFETIME beschreef injectie (tmpfs), niet de opslag-modelvorm.
*Mogelijke richtingen:* `EnvVar.valueEnc` versleuteld · aparte `WorkspaceSecret`-tabel waar `EnvVar` naar verwijst.
**→ Antwoord:** _(leeg)_

**G-DATA-WORKSPACENOTE-BODY** — Wat is de Prisma-body van `WorkspaceNote` (de B-23 "schrijf notes"-output) en wie mag die bewerken/verwijderen — schrijft een AI direct (zou "alleen Conductor schrijft" schenden)?
*Waarom dit een gat is:* B-23/DH5 zeggen dat een AI-sessie notes mag schrijven als enige write-achtige output; `04 §1` noemt het model, `04b §11d` zet het in de cascade, maar er is geen body en geen append-only/muteerbaar-regel.
*Mogelijke richtingen:* Conductor-geschreven append-only note met `authorSessionKey` · muteerbare human+AI note met `pinned`.
**→ Antwoord:** _(leeg)_

### Control-API: catalogus-volledigheid & semantiek

**G-CTRL-IDEMPOTENCY-STORE** — Waar en hoe lang wordt `clientRequestId` bewaard voor de dedupe-garantie, en is de scope per-workspace of globaal?
*Waarom dit een gat is:* CONTROL_API §6.1/§6.4 belooft "drop a duplicate signal" op `clientRequestId` zonder opslag, retentievenster of scope te specificeren. Zonder dit is "drop duplicate" niet implementeerbaar.
*Mogelijke richtingen:* Redis `SETNX ws:{wsId}:ctlreq:{id}` met TTL = rate-limit-window · `@@unique([workspaceId, clientRequestId])` op `WorkspaceSignal`.
**→ Antwoord:** _(leeg)_

**G-CTRL-CRON-TRIGGER-OP** — Welke control-API op materialiseert/bewerkt een `WorkspaceTrigger`, en hoe wordt een `on:'cron'`-trigger gescheduled (incl. bij orchestrator-restart)?
*Waarom dit een gat is:* `04 §2` introduceert cron-triggers, maar de CONTROL_API §8-catalogus heeft géén `trigger-create`/`-edit`/`-toggle`-op terwijl de catalogus claimt elke `[control-API]`-citatie te dekken. Ook ontbreekt hoe cron-strings in `Workspace.timezone` (D55) gescheduled worden.
*Mogelijke richtingen:* voeg `trigger-create`/`-edit`/`-toggle`/`-delete` toe (RBAC = config) · trigger-beheer via `accept-suggestion` (type `automation`) + edit-op.
**→ Antwoord:** _(leeg)_

**G-CTRL-RETRY-DEADLETTER** — Wat gebeurt er als de Conductor een gedraind control-API-signal niet kan uitvoeren door een transiente fout (Docker down, GitLab 5xx) ná de ack — retry, dead-letter, of stil verloren?
*Waarom dit een gat is:* §6.3 dekt alleen conflict en §6.4 dedupe, niet transiente uitvoeringsfouten ná de `ControlAck{accepted:true}`. De client denkt dat het lukt; geen retry-/dead-letter-pad.
*Mogelijke richtingen:* bounded retry met backoff + na N falen error-`Notification` · dead-letter-status op `WorkspaceSignal` + TicketEvent.
**→ Antwoord:** _(leeg)_

**G-CTRL-ANSWER-QUESTIONSET** — Is het beantwoorden van een `QuestionSet` een control-API op of het `ws-ai:reply`-socketpad, en wat doet het met `QuestionSet.status`/`answeredBy`?
*Waarom dit een gat is:* Het DECISIONS_LEDGER §5/§7 vlagt dit zelf als open ("needs a one-line ruling") en de §8-catalogus bevat geen `answer-questionset`-row, terwijl `QuestionSet` de kern van de phone-loop is.
*Mogelijke richtingen:* voeg een `answer-questionset`-op toe (consistent met "alleen Conductor schrijft") · zegen het `ws-ai:reply`-socketpad formeel als uitzondering + documenteer waarom het de RBAC-seam mag overslaan.
**→ Antwoord:** _(leeg)_

### StageKind-reconciliatie: restpunten

**G-DATA-STAGEKIND-DUALREVIEW** — Hoe onderscheidt de orchestrator twee `kind:'review'`-stages (professional dual-review) als `AgentSession.stageId`/`SpendRecord.stageId`/`TicketEvent.stageId` allemaal "the StageKind key" claimen?
*Waarom dit een gat is:* `04b §12` zegt twee review-stages delen `kind:'review'` maar verschillen op `order`+`id`, terwijl §6/§7/§9 `stageId` consequent als "the StageKind key" documenteren. Dat laat per-stage cost-rollup en event-attributie botsen bij dual-review.
*Mogelijke richtingen:* `stageId` op runtime-rows = de vrije `PipelineStageCfg.id` (uniek), `kind` apart opslaan · composiet `{kind, order}` als sessiestage-key.
**→ Antwoord:** _(leeg)_

**G-DATA-STAGEKIND-CUSTOM** — Welke `StageKind` krijgt een door de gebruiker toegevoegde custom stage (bv. "deploy"/"docs") die op geen van de 6 semantische rollen mapt?
*Waarom dit een gat is:* `04b §12` maakt `StageKind` een gesloten 6-literal union én staat custom stages toe via de vrije `id`; voor een custom stage is er geen `kind`, en `roleKey` raakt ontkoppeld.
*Mogelijke richtingen:* custom stage moet een bestaande `StageKind` kiezen (rol-hergebruik) · voeg `'custom'` toe met `roleKey` als echte discriminator.
**→ Antwoord:** _(leeg)_

### Multi-tenancy / framework-global

**G-MT-AGENTSESSION-GLOBAL** — Wat gebeurt er met assistant-`AgentSession`-rows en `Notification.userId`/`WorkspaceMember` bij verwijdering van een framework-global `User` (B-39)?
*Waarom dit een gat is:* `04b §7` geeft `AgentSession.userId`, `04b §11b` zet `User` als global, `04b §11d` cascadet bij workspace-delete — maar het omgekeerde (global user-delete die tenant-rows weesmaakt) is niet gespecificeerd.
*Mogelijke richtingen:* user-delete ruimt eerst alle memberships + afgeleide tenant-rows op per workspace · soft-delete + anonimisering van tenant-referenties.
**→ Antwoord:** _(leeg)_

**G-MT-PUSHSUB-CROSSTENANT** — Hoe wordt per-workspace push-routing/mute afgedwongen als `PushSubscription` framework-global is maar `Notification` tenant-scoped en `NotificationPreference` een optionele `workspaceId` heeft?
*Waarom dit een gat is:* De push-pijplijn moet een tenant-scoped Notification matchen tegen een global device + (deels) tenant-scoped preference; het `runInTenant`-pad voor die global→tenant join is niet gedefinieerd.
*Mogelijke richtingen:* push-worker draait per-notification in diens `workspaceId`-context, leest de global `PushSubscription` buiten tenant-scope · `PushSubscription` toch tenant-scopen per lidmaatschap.
**→ Antwoord:** _(leeg)_

### Migratie / seed

**G-MIG-PRESET-SEED** — Welke concrete `StageKind`-lijst, `roleKey`s en `modelCfg`-defaults seedt elk van de drie presets (simple/advanced/professional), en is dat idempotent of create-tijd?
*Waarom dit een gat is:* `04b §12` geeft alleen de professional-7 en de 3-lijst als voorbeeld; de volledige per-preset stage-definitie (advanced=5 = welke kinds?) + per-stage rol-defaults + seed-idempotentie ontbreken.
*Mogelijke richtingen:* één seed-tabel `PRESET_DEFINITIONS[tier] → StageKind[]` + per-kind `AgentRole`-default · presets als gecommitte JSON-fixtures.
**→ Antwoord:** _(leeg)_

**G-MIG-SEED-7-TO-KIND-CONSUMERS** — Welke consumers buiten Board/Pipeline/WorkspacesContext breken bij de `StageId→StageKind`-swap, en wordt bestaande `Ticket.stageId`/`StageHistoryEntry.stage`-data hermapt?
*Waarom dit een gat is:* `04b §12/§15` noemt de drie screens "mechanical", maar `Ticket.stageId`, `StageHistoryEntry.stage`, `Terminal.stage` en `seed.ts` zijn óók consumers; of ticket-rows met oude waarden (`'impl'`, `'unrefined'`) hermapt worden is niet vastgelegd.
*Mogelijke richtingen:* een data-migratiestap die bestaande rijen hermapt · behoud de oude id-strings als de vrije stage-`id` zodat rows ongewijzigd blijven.
**→ Antwoord:** _(leeg)_

### Indexing / uniciteit

**G-DATA-QUESTIONSET-ANSWEREDBY** — Is `QuestionSet.answeredBy` een echt veld (ledger #6), en wat is het uniciteits-/statusmodel bij de presence-claim race?
*Waarom dit een gat is:* `04 §2` definieert `QuestionSet` zónder `answeredBy`, terwijl het ledger §5 dit als delta opvoert en de first-answer-wins-guard (#6) erop steunt. Of het veld in de canonieke body landt + welke `@@unique`/status-overgang de race afdekt is niet vastgelegd.
*Mogelijke richtingen:* `answeredBy String?` + atomaire conditionele update `open→answered` · idempotency-key op een aparte answer-row.
**→ Antwoord:** _(leeg)_

**G-DATA-CARRYOVER-CASCADE-CONFLICT** — Kan er meer dan één `CarryOver` per `(ticketId, fromStageId, toStageId)` bestaan (stage-re-run), en welke injecteert de volgende stage?
*Waarom dit een gat is:* `04 §2` geeft `CarryOver` met `@@index([ticketId, createdAt])` maar geen uniciteit; bij re-run ontstaat een tweede envelope. Het fenced-block "max-one per emission" regelt per-emissie, niet per-overgang.
*Mogelijke richtingen:* altijd de laatste (`createdAt`/`seq`) injecteren, oudere als audit · een `superseded`-vlag i.p.v. uniciteit.
**→ Antwoord:** _(leeg)_

---

# 3. Build, scope & ops

### Fase / lane sequencing

**G-SEQ-1** — Welk faseringsschema is bindend — BUILD_PROGRAM's seriële Fasen 0–3, BUILD_ORDER's 4 parallelle lanes (A/B/C/D)+Phase 0, of het superseded 05 P0–P5 — en hoe mappen ze op elkaar?
*Waarom dit een gat is:* Drie naast elkaar bestaande, niet-gemapte schema's. Een AI die BUILD_PROGRAM volgt bouwt serieel; een die BUILD_ORDER volgt bouwt 4-lane parallel. BUILD_PROGRAM citeert BUILD_ORDER/V1_SCOPE nergens.
*Mogelijke richtingen:* BUILD_PROGRAM bindend + expliciete mapping-tabel naar lanes · BUILD_ORDER bindend, BUILD_PROGRAM = alternatieve presentatie · één doc markeren superseded.
**→ Antwoord:** _(leeg)_

**G-SEQ-2** — Is BUILD_PROGRAM Fase 1 (RBAC/settings/board/tickets, "GEEN AI") volledig spike-onafhankelijk, en wie bezit de schema-publicatie (Phase 0.C) die Fase 1 nodig heeft?
*Waarom dit een gat is:* BUILD_PROGRAM Fase 0.2 bouwt "het volledige Prisma-schema" als één stap, maar BUILD_ORDER maakt schema-publicatie (B2) het #1 unblock-contract van lane B. BUILD_PROGRAM heeft geen frozen-contract-concept.
**→ Antwoord:** _(leeg)_

**G-SEQ-3** — Vallen de BUILD_PROGRAM Fase 3 tool-modules (Interviewer/Designer/Marketing/Document) binnen V1, of zijn ze post-V1 — V1_SCOPE noemt ze nergens?
*Waarom dit een gat is:* V1_SCOPE claimt de definitieve scope-autoriteit en somt geen tool-modules op; BUILD_PROGRAM Fase 3 + `build-plans/` bouwen ze wel. Conflict met "V1_SCOPE wint op scope".
**→ Antwoord:** _(leeg)_

### Scope IN/OUT

**G-SCOPE-1** — Als preview-deployments OUT zijn in V1, wat is dan de status van de preview-metric/alert/CapacityManager-sublimiet — code-aanwezig-maar-nul, of niet gebouwd?
*Waarom dit een gat is:* OBSERVABILITY behandelt `ws_preview_containers` + `previewConcurrencyCap` als first-class V1, maar V1_SCOPE zet previews expliciet OUT.
**→ Antwoord:** _(leeg)_

**G-SCOPE-2** — Is de AI-eval/golden-tickets-harness (AI_QUALITY_AND_EVALS) IN of OUT voor V1, en wie bezit hem (geen lane claimt het)?
*Waarom dit een gat is:* TESTING_STRATEGY §6.2 noemt golden-cadans terloops, maar de eval-harness staat niet in V1_SCOPE's IN-tabel en is niet aan een lane toegewezen.
**→ Antwoord:** _(leeg)_

**G-SCOPE-3** — Bouwt V1 de per-project image-laag (L2), of alleen L1 base + per-ticket runtime (L3)?
*Waarom dit een gat is:* REVIEW markeert L2 als "P2"; V1_SCOPE onderscheidt L1/L2/L3 niet; BUILD_ORDER lane A noemt alleen L1+"skeleton"; BUILD_PROGRAM 2.4 bouwt wél AI-Dockerfile-voorstel+build (= L2). Tegenstrijdig.
**→ Antwoord:** _(leeg)_

### Deferred items zonder eigenaar/trigger

**G-DEFER-1** — Wanneer en door wie wordt backup/DR gebouwd, en draait de eerste echte self-hosted deployment dus zonder backups?
*Waarom dit een gat is:* DR is P4-getagd, maar geen uitvoerbaar programma (BUILD_PROGRAM/BUILD_ORDER) bevat een P4. De "trusted small-group"-rechtvaardiging is een aanname, geen trigger.
**→ Antwoord:** _(leeg)_

**G-DEFER-2** — Wat is de aanvaarde max downtime-verwachting voor de eerste echte gebruiker, en welke trigger promoveert warm-standby van "gedocumenteerd" (P4) naar "gebouwd"?
*Waarom dit een gat is:* 08 §4 stelt de orchestrator-SPOF expliciet maar geeft geen promotie-trigger of downtime-SLO; DR_RUNBOOK's RTO is restore-tijd, niet gewone-crash-recovery.
**→ Antwoord:** _(leeg)_

**G-DEFER-3** — Wat is de fallback als de spike vindt dat zowel `/clear` (id-rotatie) als `/compact` de context onvoldoende verkleinen (C3 RED) — er is geen derde pad voor de self-handoff-cyclus?
*Waarom dit een gat is:* P0_CLI_SPIKE §3 geeft alleen een binaire `/clear`→`/compact`-beslisregel; de hele token-opt self-handoff (06 §2/§5) rust op kunnen resetten. Geen pad als beide falen.
**→ Antwoord:** _(leeg)_

### Deployment SPOF / scaling

**G-DEPLOY-1** — Wat zijn de concrete `LEASE_TTL_MS` + renew-cadens, en hoe gekalibreerd t.o.v. de langste plausibele GC/IO-pauze?
*Waarom dit een gat is:* 08 §2.2 geeft alleen de regel ("TTL ≫ pauze, renew ≤ TTL/3") zonder getal; de OBSERVABILITY-alert "geen leader > één TTL" hangt ervan af.
**→ Antwoord:** _(leeg)_

**G-DEPLOY-2** — Wat zijn de default `MAX_RESIDENT` en de RAM-watermark-drempel voor de referentiehost (8 vCPU/32 GB)?
*Waarom dit een gat is:* REVIEW gaf "~8 active / ~12–16 paused" als richtgetal, geen geconfigureerde defaults; de CapacityManager-reclaim en de saturation-alert hangen aan een concrete drempel.
**→ Antwoord:** _(leeg)_

**G-DEPLOY-3** — Verzendt V1 echt ≥2 web-app replicas op de ene self-hosted host (HA-theater), of is N=1 de facto V1 en is N≥2 een 08-design-horizon?
*Waarom dit een gat is:* 08 §1 stelt N≥2; V1_SCOPE §3.4 stelt alles op één host. Op één host levert N≥2 geen echte HA.
**→ Antwoord:** _(leeg)_

### Backup / restore

**G-BACKUP-1** — Waar wordt de encryptiesleutel voor de at-rest secrets (GitLab PAT, ro/rw DB-creds) geback-upt/gerestored — sleutel-verlies maakt alle encrypted secrets onleesbaar ondanks geslaagde Mongo-restore?
*Waarom dit een gat is:* DR §9 herbouwt `.env.local` handmatig; als de encryptiesleutel daarin zit en niet bewaard wordt, zijn de uit Mongo gerestorede encrypted credentials onleesbaar.
**→ Antwoord:** _(leeg)_

**G-BACKUP-2** — Worden door-de-mens gemaakte (ongecommitte) in-container VS Code-edits geback-upt, en zo niet, is dat verlies aanvaard?
*Waarom dit een gat is:* DR §7 redeneert vanuit goedkoop her-te-runnen AI-werk, maar V1_SCOPE §3.1 introduceert menselijke lokale edits die pas bij "complete" gepusht worden; voor een mens is re-run niet gratis.
**→ Antwoord:** _(leeg)_

**G-BACKUP-3** — Wat is de operator-actie als de re-restore óók een seq-reorder vertoont (corrupte dump-keten), en hoeveel backup-generaties moeten bewaard worden?
*Waarom dit een gat is:* DR §6 abort+re-restore bij reorder heeft geen escalatiepad als de vorige dump ook corrupt is; geen "hoeveel generaties terug acceptabel" t.o.v. de ≤1u RPO.
**→ Antwoord:** _(leeg)_

### Observability / alerting

**G-OBS-1** — Wat zijn de concrete numerieke drempels + tijdsvensters voor de alerts ("drift over threshold", "watchdog spike", "queued_turns sustained > 0")?
*Waarom dit een gat is:* OBSERVABILITY §4 noemt vage condities zonder getallen; een alert zonder drempel is niet implementeerbaar.
**→ Antwoord:** _(leeg)_

**G-OBS-2** — Wat is het verwachte tick-interval per leased loop (indexer, reconcile, watchdog, signal-consumer, cron) dat de §3 liveness-PEXPIRE (3× interval) nodig heeft?
*Waarom dit een gat is:* De stale-heartbeat-detectie hangt van `intervalMs(loopName)` af, maar geen doc geeft die intervallen.
**→ Antwoord:** _(leeg)_

**G-OBS-3** — Wordt `@luckystack/monitoring` in V1 daadwerkelijk gewired (env-key gezet), of draait V1 standaard stdout-only en is de §5-adapter ongebouwd?
*Waarom dit een gat is:* De transport-adapter is optioneel/peer-dep-guarded en geen lane bezit hem, terwijl OBSERVABILITY een V1-operability-doc is.
**→ Antwoord:** _(leeg)_

### Env / credentials

**G-ENV-1** — Welk auth-model is bindend voor de operator-setup — SETUP §1 instrueert nog het verworpen whole-`~/.claude`-mount i.p.v. managed-token-projection (Q-CT-AUTH)?
*Waarom dit een gat is:* SETUP is de operator-facing prerequisite-doc; als die het oude model zegt, configureert de operator verkeerd. Niemand bezit de correctie.
**→ Antwoord:** _(leeg)_

**G-ENV-2** — Welke env-flag(s) gaten de dev-terminal vs. de Assistant-PoC — `WORKSPACE_AI_ENABLED`, `WORKSPACES_TERMINAL_ENABLED`, of beide — en is het er één of twee?
*Waarom dit een gat is:* SETUP, PORT_MANIFEST en 05 noemen overlappende-maar-niet-identieke flag-namen voor de dev-terminal en/of AI-chat.
**→ Antwoord:** _(leeg)_

**G-ENV-3** — Is MongoDB Atlas Local (`$vectorSearch`) of de Float[]-fallback de V1-default, en hoe gedraagt de boot-reconcile-indexrebuild zich in fallback-modus (geen search-index)?
*Waarom dit een gat is:* De fallback heeft geen Atlas search-index, dus de DR boot-rebuild-stap is dan niet van toepassing; geen doc zegt welke modus V1 draait.
**→ Antwoord:** _(leeg)_

### P0.5 spike pass/fail

**G-SPIKE-1** — Hoeveel GREEN-WITH-WORKAROUND-rijen mag een gating-spike accumuleren voordat de gestapelde workarounds samen een de-facto-RED zijn (bv. B4+D2+C1 tegelijk)?
*Waarom dit een gat is:* §6 opent de gate per-rij zonder cumulatief workaround-budget; drie gedegradeerde load-bearing mechanismen tegelijk kunnen de engine onbetrouwbaar maken terwijl elke rij "GREEN-WITH-WORKAROUND" is.
**→ Antwoord:** _(leeg)_

**G-SPIKE-2** — Wat is de pass/fail als A3 GREEN is voor ~4 concurrent PTYs maar de subscription bij 6–8 een rate-limit/lockout geeft die de geplande `MAX_RESIDENT` (~12–16) onhaalbaar maakt?
*Waarom dit een gat is:* A3 test alleen ~4; de capaciteitsaanname (residente sessies ≫ actieve turns) wordt niet getoetst tegen een subscription-concurrencyplafond.
**→ Antwoord:** _(leeg)_

**G-SPIKE-3** — Moet de spike op het productie-OS draaien, en is een GREEN op WSL2-dev geldig voor een latere Linux-prod-host (waar de auth-projectie-paden kunnen verschillen)?
*Waarom dit een gat is:* §6 stempelt host-OS per rij en E7 is macOS-only, maar er is geen regel dat de spike op het prod-OS draait of een herhaal-trigger bij OS-wissel.
**→ Antwoord:** _(leeg)_

**G-SPIKE-4** — Wie bezit het bewaken van upstream-Claude-CLI-releases en het beslissen wanneer een gepinde versie te oud/onveilig is (forceert een bump ondanks hook-shape-drift-risico)?
*Waarom dit een gat is:* Q-CT-CLIPIN zegt "upgrades achter een semver-bump + smoke-test", maar geen doc bezit de upstream-watch; fixtures + base-image + `cliVersion`-stamp hangen aan een handmatige bump zonder trigger/eigenaar.
**→ Antwoord:** _(leeg)_

### Cross-cutting

**G-XB-1** — Wordt de one-shot reasoner in V1 gebouwd (voor de Interviewer/away-time), of niet — BUILD_PROGRAM 3.1 vereist hem, V1_SCOPE zet hem OUT?
*Waarom dit een gat is:* BUILD_PROGRAM Fase 3.1 impliceert een gebouwde reasoner voor de Interviewer; V1_SCOPE zet hem OUT als "niet-standing in V1".
**→ Antwoord:** _(leeg)_

**G-XB-2** — Is de `/usage`-machine-parseerbaarheid-spike-rij toegevoegd (ledger §5-delta), en wat is de V1-fallback als `/usage` niet betrouwbaar parseerbaar is?
*Waarom dit een gat is:* Het ledger vlagt dat P0_CLI_SPIKE een `/usage`-verificatierij moet krijgen, maar §1–§5 bevat die niet (D1–D3 testen hook-payload-usage, niet de `/usage`-probe); quota-probe/auto-pause/predictive-budget hangen eraan.
**→ Antwoord:** _(leeg)_

**G-XB-3** — Welke lane-gating is bindend — "blokkeert B/C/F" (05/P0_CLI_SPIKE/TESTING_STRATEGY) of "blokkeert A2–A9 + D3+" (BUILD_ORDER/V1_SCOPE)? De lane-taxonomieën zijn onverenigbaar.
*Waarom dit een gat is:* In het 05-schema is F=Containers; in het 4-lane-schema zitten containers in lane A. Een AI kan de verkeerde lanes blokkeren/vrijgeven.
**→ Antwoord:** _(leeg)_

**G-XB-4** — Wie commit de menselijke lokale VS Code-edits en wanneer, en hoe verhoudt dat zich tot #9 (per-stage commit + squash-on-push)?
*Waarom dit een gat is:* V1_SCOPE §3.1 zegt "de agent's commits plus de gebruiker's lokale edits, committed" zonder te zeggen wie de menselijke edits commit of of ze een eigen commit krijgen of in de squash vallen.
**→ Antwoord:** _(leeg)_

**G-XB-5** — Wat is de stopconditie van de BUILD_PROGRAM verify→refix-lus (Opus-verificatie) — een iteratie-plafond of escalatie-trigger bij een hardnekkige miss?
*Waarom dit een gat is:* Het uitvoeringsmodel zegt "herverifieer tot groen" zonder afbreekcriterium; een echte ontwerpfout (i.p.v. implementatie-miss) kan eindeloos "gerefixt" worden.
**→ Antwoord:** _(leeg)_

---

# 4. Features 01–12

### 01 — Workspace setup
**G-01-1** — Verloopt een workspace die in `building` blijft hangen, wordt iemand genotificeerd, en mag een andere Admin de mislukte bronnen hervatten of is resume gebonden aan de starter?
*Waarom dit een gat is:* `01 §Failure & resume` toont per-bron Retry + banner maar niet de levensduur, de RBAC × resume, of of dit een notificatie triggert.
*Mogelijke richtingen:* owner-only vs elke Admin+ · `building` verloopt nooit vs auto-archiveer na N dagen met notificatie.
**→ Antwoord:** _(leeg)_

**G-01-2** — Mag een workspace tijdens de eerste index (vóór **Open workspace** unlockt) al tickets aanmaken, en parkeren die dan op `idle` of worden ze geweigerd?
*Waarom dit een gat is:* `01` zegt "the board is usable while indexing" maar het snijvlak met ticket-creation/AI-start vóór RAG/code-graph er zijn is niet uitgespeld.
**→ Antwoord:** _(leeg)_

### 02 — Pipeline presets
**G-02-1** — Wat gebeurt er met `busy` tickets als een gebruiker stages toevoegt/verwijdert in een draaiende pipeline (q4 maakt presets fully editable)?
*Waarom dit een gat is:* `02 q4` maakt stages vrij bewerkbaar, maar de interactie met live board-kolommen (12 leidt kolommen af van `STAGES`) en lopende sessies bij stage-verwijdering is ongedefinieerd.
*Mogelijke richtingen:* verwijderen blokkeren als er tickets in zitten · tickets terugzetten naar vorige stage · lopende sessie killen vs laten aflopen.
**→ Antwoord:** _(leeg)_

**G-02-2** — Bij professional dual-review: wat gebeurt er bij **Reject** op Reviewer 1 — heropent dat Reviewer 1, en wat met de nog-niet-gelopen Reviewer 2?
*Waarom dit een gat is:* `02 q2` definieert alleen de happy-path carry-over; de Reject-tak in een multi-review-keten is niet uitgespeld terwijl 07/09 Reject als kernlever definiëren.
**→ Antwoord:** _(leeg)_

### 03 — Build phase
**G-03-1** — Hoe wordt een collisie/overschrijven afgehandeld als `ai:refresh-docs` over handmatig geëdite gegenereerde docs in `generatedDocsPath` heen schrijft?
*Waarom dit een gat is:* `03 q3` commit GENERATE'd docs in de repo maar geeft geen conflict-strategie bij bestaande/menselijk-geëdite bestanden.
*Mogelijke richtingen:* orchestrator-owned (altijd overschrijven) · merge/skip bij menselijke wijziging · aparte branch/MR voor doc-commits.
**→ Antwoord:** _(leeg)_

**G-03-2** — Wat ziet/kan de gebruiker tijdens de build-fase als de Assistant offline is (geen quota, gebruiker weg) — GENERATE/LINK-split én pipeline-authoring leunen op een levende Assistant-turn?
*Waarom dit een gat is:* `03` heeft deterministische fallback-defaults voor de split maar niet voor pipeline-authoring zonder Assistant.
**→ Antwoord:** _(leeg)_

### 04 — Integration tools
**G-04-1** — Is de "3 opeenvolgende fouten op dezelfde tool"-teller per-sessie/stage/ticket, en reset hij na succes, `--resume`, of stage-overgang?
*Waarom dit een gat is:* `04 q4` noemt de drempel maar niet de scope/reset-semantiek.
*Mogelijke richtingen:* per (sessie, tool) reset op succes · per (ticket, tool) doorlopend · reset bij stage-overgang.
**→ Antwoord:** _(leeg)_

**G-04-2** — Wat gebeurt er met een per-stage tool-bind als de onderliggende `IntegrationTool`/`EnvVar` daarna wordt verwijderd/hernoemd — opschoning, validatie-warning, of stille fout at-spawn?
*Waarom dit een gat is:* `04` specificeert de referentiële integriteit tussen `StageToolCfg.toolId`/`IntegrationField.envVarId` en verwijdering niet.
**→ Antwoord:** _(leeg)_

### 05 — Per-session info
**G-05-1** — Wat toont de cost/duration-chip bij een ticket dat meermaals door dezelfde stage ging (Reject heropent), en hoe wordt `projected-remaining` herberekend als een `done` stage opnieuw `busy` wordt?
*Waarom dit een gat is:* `05 §flow 3` definieert `projected-remaining` op "not-yet-done stages"; het Reject-heropent-mechanisme breekt de "done = klaar"-aanname.
**→ Antwoord:** _(leeg)_

**G-05-2** — Hoe gedraagt "Raise cap & resume" zich offline / als de workspace `stopped` is op een quota-limiet — actieve knop die niet kan resumen, of disabled?
*Waarom dit een gat is:* `05 §flow 4` beschrijft de lever bij een lokale cap, niet het samenspel met een globaal-gepauzeerde/quota-uitgeputte workspace.
**→ Antwoord:** _(leeg)_

### 06 — Voice input
**G-06-1** — Wat gebeurt er als de gedeelde seriële whisper.cpp-instance bezet is — wachtrij/positie, "transcriptie wacht", of timeout, en geldt de 2:00-cap ook bij congestie?
*Waarom dit een gat is:* `06 q3` kiest één seriële STT-instance, maar de `transcribing`-state veronderstelt directe verwerking; gelijktijdige voice-notes (contentie) is niet uitgespeld.
**→ Antwoord:** _(leeg)_

**G-06-2** — Wat gebeurt er bij "Reply to `DEV-####`'s agent" als die agent tegen verzendtijd niet meer in `needs-input` staat (al hervat/done/door anderen beantwoord)?
*Waarom dit een gat is:* `06` koppelt voice aan de eerste open `kind:'free'`-vraag, maar de stale-target-race met 09's presence/claim is niet behandeld.
**→ Antwoord:** _(leeg)_

### 07 — Code-changes review
**G-07-1** — Twee reviewers, één Approve (promote) terwijl de ander Reject indient op dezelfde gate — welke wint en wat ziet de verliezer?
*Waarom dit een gat is:* 09 q4 regelt dubbele *answer*-resolutie van één needs-input, maar de gelijktijdige tegengestelde-actie-race op de aparte `approve`-gate is niet beschreven.
**→ Antwoord:** _(leeg)_

**G-07-2** — Wat toont de changed-files-mode als een stage `done` is maar `changedFiles` leeg is (een Refine/Plan-stage zonder code-output)?
*Waarom dit een gat is:* `07` veronderstelt overal een changed-files-set; de empty-diff-state voor niet-code-stages met een approve-gate ontbreekt.
*Mogelijke richtingen:* "Files & refs" verbergen · lege state · gate valt terug op pure tekst-approve.
**→ Antwoord:** _(leeg)_

### 08 — Codebase viewer
**G-08-1** — Wat toont "Files & refs" voor whole-tree browse vóór UI-Builder landt, gegeven `FileDiffViewer` alleen changed-files read-only toont?
*Waarom dit een gat is:* 08's eigen scope (hele boom browsen) heeft géén interim-viewer; er is een functioneel gat tussen v1-launch en UI-Builder.
*Mogelijke richtingen:* whole-tree afwezig tot UI-Builder (empty/"komt later") · minimale read-only tree over `query_context` als tussenstap.
**→ Antwoord:** _(leeg)_

**G-08-2** — Wat gebeurt er met openstaande `edit`-mode dirty buffers als de live container tussentijds gekild/gepauzeerd wordt (kill/reclaim) of de RBAC-capability tijdens de sessie wordt ingetrokken?
*Waarom dit een gat is:* `08 q3` koppelt edit aan een levende container + RBAC, maar de verdwijn-tijdens-edit-flow (verlies onopgeslagen werk, save die faalt) is ongedefinieerd.
**→ Antwoord:** _(leeg)_

### 09 — Questions in tickets
**G-09-1** — Wat gebeurt er met een open `QuestionSet` (blocking) als de Stage-Agent crasht of de orchestrator herstart vóór de mens antwoordt — blijft open, verloopt, of opnieuw geserveerd na `resumeAll()`?
*Waarom dit een gat is:* `09` beschrijft de happy-path + superseded, niet de sessie-sterft-tijdens-blocking-open-edge; `--resume` veronderstelt een herstelbare sessie.
**→ Antwoord:** _(leeg)_

**G-09-2** — Gaan reeds-ingevoerde-maar-niet-gesubmitte antwoorden ("2 of 3") verloren zonder waarschuwing als de set mid-invoer superseded raakt?
*Waarom dit een gat is:* `09 q1` (submit-all-at-once) + superseded dekken het superseden van *answered* sets, niet het verlies van lokaal-ingevoerde antwoorden.
**→ Antwoord:** _(leeg)_

### 10 — Automations screen
**G-10-1** — Wat gebeurt er met `WorkspaceTrigger`-rijen die verwijzen naar een verwijderde stage of een verdwenen `run-command`-key — deactiveren, "dangling"-warning, of stille fout at-fire?
*Waarom dit een gat is:* `10` beschrijft de dependency-hint alleen voor een uitgeschakelde hook, niet voor een verdwenen `targetStageId`/`command`. Met 02 q4 (vrij verwijderen) een reëel gat.
**→ Antwoord:** _(leeg)_

**G-10-2** — Mag elk Member triggers aanmaken die `start-stage`/`run-command` uitvoeren (effectief promote/doc-refresh zonder per-actie-RBAC), of is automation-authoring Admin+?
*Waarom dit een gat is:* `10` regelt governance via `requiresApproval` maar zegt niets over wie überhaupt een trigger mag aanmaken — een Member zou de promote-RBAC kunnen omzeilen.
**→ Antwoord:** _(leeg)_

### 11 — Workspace-AI panel
**G-11-1** — Wat gebeurt er met een streamend Assistant-antwoord of een hangende proposal als de Assistant mid-turn suspended raakt (panel dicht / idle-TTL / disconnect)?
*Waarom dit een gat is:* `11 §flow 1` + q5 (control-button-timeout) dekken niet het suspenden midden in een halve turn (verlies vs hervatten).
**→ Antwoord:** _(leeg)_

**G-11-2** — Is er één Assistant per (user, workspace) gedeeld over devices, of één per verbinding — hoe synchroniseren chat-historie en de "idle"-footer bij desktop + telefoon tegelijk?
*Waarom dit een gat is:* `11` zegt "one Assistant per active user" maar de multi-device-flow (chat fan-out, dubbele attach, welke device de stream krijgt) is niet uitgespeld — kern phone-use-case.
**→ Antwoord:** _(leeg)_

### 12 — Board & Kanban
**G-12-1** — Hoe gedraagt de board-move-animatie zich als een merge-on-seq-snapshot meerdere moves tegelijk binnenbrengt na reconnect (telefoon weer online) — alles animeren of zonder animatie springen?
*Waarom dit een gat is:* `12 §flow 5` beschrijft de enkele-move-animatie via `layoutId`; de bulk-reconcile-na-offline visuele staat is niet gedefinieerd.
**→ Antwoord:** _(leeg)_

**G-12-2** — Wat toont een kolom als de `PipelineStage` `aiEnabled=false` is óf de workspace globaal `stopped`/`paused` is — verandert de `robot`-marker, worden kaarten "geparkeerd", blijven quick-add/Promote beschikbaar?
*Waarom dit een gat is:* `12` rendert de `robot`-marker per stage maar de board-brede staat bij een globaal-gepauzeerde workspace (en of acties dan mogen) ontbreekt — snijvlak met pause/kill.
**→ Antwoord:** _(leeg)_

---

# 5. Features 13–24

### 13 — Backlog & Sprints
**G-13-1** — Wat gebeurt er met een bulk control-API request (bv. "Move 30 tickets") bij een Conductor-fout/herstart halverwege — partial success, en hoe ziet de gebruiker wat wél/niet verwerkt is?
*Waarom dit een gat is:* `13 §flow 5` toont een "requested…"-state zonder partial-failure-uitkomst; de ~10s timeout is per-request, niet per-item over een batch.
*Mogelijke richtingen:* all-or-nothing transactioneel · per-item resultaat-map met badges · bar in "deels verwerkt — N van M".
**→ Antwoord:** _(leeg)_

**G-13-2** — Mag bulk Move/Status een ticket forceren terwijl dat een live `busy` AgentSession heeft — pauzeert/killt dat de sessie of conflicteert het met de AI-owned status?
*Waarom dit een gat is:* `13` zegt status is AI-owned, maar bulk Status zet expliciet een status; de interactie met een lopende sessie + feature 24 is niet belegd.
*Mogelijke richtingen:* alleen op niet-busy tickets · Conductor pauzeert eerst impliciet · verbieden op tickets met live sessie.
**→ Antwoord:** _(leeg)_

**G-13-3** — Wat gebeurt er met tickets als een sprint wordt verwijderd of vervroegd, en wat met de active-badge bij overlappende sprint-datumranges?
*Waarom dit een gat is:* `13 §flow 6` dekt naam/datum/active-edit maar niet sprint-delete, overlappende actieve sprints, of `Ticket.sprintId`-gevolgen. `active` heeft geen uniciteitsregel.
**→ Antwoord:** _(leeg)_

### 14 — Terminals
**G-14-1** — Twee gebruikers met dezelfde terminal open die tegelijk typen — gedeelde single-stream (beiden typen) of exclusief write-lock?
*Waarom dit een gat is:* `14 §flow 5` beschrijft keystrokes → PTY voor "de gebruiker", maar de multi-client laag impliceert meerdere kijkers; concurrent write is niet belegd.
*Mogelijke richtingen:* gedeelde collab-stream · soft write-lock "X is aan het sturen" · eerste attacher write, rest read-only.
**→ Antwoord:** _(leeg)_

**G-14-2** — Een gebruiker met geldige SSH-key maar zonder terminal-RBAC: wordt de attach geweigerd na de challenge, en welke state ziet die persoon?
*Waarom dit een gat is:* `14` kent maar vier states (`connecting/live/exited/locked`, waar `locked`=geen key); de RBAC-deny-na-unlock heeft geen eigen state.
**→ Antwoord:** _(leeg)_

**G-14-3** — Wat toont het terminalpaneel als de onderliggende container door de CapacityManager/TTL is gereclaimd terwijl het paneel open staat?
*Waarom dit een gat is:* `14` kent `exited` (proces-exit) en `connecting` (socket-drop), niet "container bestaat niet meer"; de ring-buffer-reattach-belofte gaat dan niet op.
**→ Antwoord:** _(leeg)_

### 15 — Sources management
**G-15-1** — Twee gelijktijdige Reindex-triggers op dezelfde workspace (concurrency:1 queue) — tweede gequeued, gededupeerd, of geweigerd, en wat ziet de tweede gebruiker?
*Waarom dit een gat is:* `15 §flow 7` beschrijft één job + live-progress, niet de samenloop; de banner is één gedeelde workspace-state.
*Mogelijke richtingen:* dedupe (tweede no-op) · enqueue achteraan · coalesce tot één delta.
**→ Antwoord:** _(leeg)_

**G-15-2** — Wordt een geüploade spec (md/txt, D74) geïndexeerd in de frozen-per-commit store, en aan welke `commitHash` hangt een upload die niet uit git komt?
*Waarom dit een gat is:* B-25 frozen-per-commit gaat over git-afgeleide content; een upload heeft geen commit, de freezing-semantiek is ongedefinieerd.
**→ Antwoord:** _(leeg)_

**G-15-3** — Blijft de live snapshot atomair op de vorige succesvolle index staan bij een halverwege gefaalde Reindex (`error`), of is hij gedeeltelijk bijgewerkt (inconsistent voor nieuw-startende stages)?
*Waarom dit een gat is:* `15` zegt "append-only / frozen-per-commit, open tickets never shift" maar definieert geen atomiciteit/rollback voor de live-snapshot bij een mislukte delta.
**→ Antwoord:** _(leeg)_

### 16 — Members & RBAC
**G-16-1** — Wordt een in-flight control-API request nog uitgevoerd en wordt een live terminal direct gekapt als een Admin midden in een sessie de rechten van een Member verlaagt/verwijdert?
*Waarom dit een gat is:* `16` zegt enforcement zit in `preApiExecute` (per-request), maar zegt niets over mid-flight intrekking of het verbreken van bestaande sessies/sockets.
*Mogelijke richtingen:* alleen at-request (lopende voltooit) · actieve sockets/sessies verbreken · grace tot reconnect.
**→ Antwoord:** _(leeg)_

**G-16-2** — Kan een Member met een custom role die "promote to Admin"/"transfer ownership" heeft (D76) zichzelf naar Owner tillen of de single-Owner-invariant omzeilen?
*Waarom dit een gat is:* D76 zegt "no rows are hard-locked" en D77 bewaakt alleen Owner-self-demotion; de combinatie (niet-Owner met transfer-capability) heeft geen gedefinieerde flow — privilege-escalation-randgeval.
**→ Antwoord:** _(leeg)_

**G-16-3** — Waar vallen members/pending-invites naartoe als een `PermRole` wordt verwijderd of hernoemd terwijl die toegewezen is?
*Waarom dit een gat is:* `16 §flow 3` dekt "Add role" maar niet delete/rename; `PermRole` heeft geen referentiële-integriteitsregel t.o.v. `WorkspaceMember.role`/`Invite.role`.
**→ Antwoord:** _(leeg)_

### 17 — Account & Auth
**G-17-1** — Worden live `/pty`-attaches per direct gekapt als een gebruiker zijn laatste/actieve SSH-key verwijdert/herroept, of pas bij de volgende per-open challenge?
*Waarom dit een gat is:* `17 §flow 3` dekt alleen de *volgende* open, niet reeds-attached live terminals.
**→ Antwoord:** _(leeg)_

**G-17-2** — Wordt een invite geconsumeerd als de invite-e-mail (B-06) niet overeenkomt met de OAuth-identiteit-e-mail (token-only consumptie negeert de geadresseerde e-mail)?
*Waarom dit een gat is:* `17 §Auth flow 3` zegt "Join consumes the Invite token" maar de match-regel tussen invite-e-mail en OAuth-e-mail ontbreekt — security/misdelivery-randgeval (rule 19).
**→ Antwoord:** _(leeg)_

**G-17-3** — Wat valt binnen de scope van "Export your data" (B-39) voor een multi-workspace gebruiker — alleen account-globale rijen, of ook workspace-tenant-data, en hoe verhoudt dat zich tot `runInTenant`-isolatie/RBAC?
*Waarom dit een gat is:* `17 §Scope` noemt "a dump of user-related rows" zonder tenant-grens/RBAC-filter; een naïeve user-scoped export kan cross-tenant lekken of te weinig bevatten.
**→ Antwoord:** _(leeg)_

### 18 — Notifications
**G-18-1** — Wordt een `needs-input`-notificatie + push bij de andere recipients teruggetrokken/als beantwoord gemarkeerd zodra gebruiker A de vraag claimt (#06), en wat als B al op de redacted push had getikt?
*Waarom dit een gat is:* `18 §flow 5` doet `read=true` puur client-optimistisch per gebruiker; geen cross-user "afgehandeld"-intrekking, geen interactie met first-answer-wins.
**→ Antwoord:** _(leeg)_

**G-18-2** — Wie zijn de "user(s) in scope" voor een `Notification`-fan-out (alle members / assignee+creator / rol-gefilterd), en respecteert de fan-out RBAC (leesrecht op het ticket)?
*Waarom dit een gat is:* `18 §flow 1` zegt "fans it out to the user(s) in scope" zonder die scope te definiëren.
**→ Antwoord:** _(leeg)_

**G-18-3** — Geldt "Mark all read" alleen voor het gefilterde type / geladen venster, of voor álle ongelezen notificaties (incl. niet-geladen oudere)?
*Waarom dit een gat is:* `18 §flow 4` plaatst de knop zonder de scope te definiëren; doc 20 gebruikt een bounded window (D83) — of dat ook hier geldt is onbelegd.
**→ Antwoord:** _(leeg)_

### 19 — Usage & Budget
**G-19-1** — Wat is de uitkomst als twee budget-caps (D81) tegelijk hun threshold raken met tegenstrijdige modes (`pauseNew` vs `pauseAll`) — strengste wint, of twee gestapelde modals?
*Waarom dit een gat is:* D81/D82 maken `WorkspaceBudget` multi-row, maar `19 §flow 5` + de modal beschrijven nog een enkelvoudige cap-reached-flow.
*Mogelijke richtingen:* strengste mode wint, één modal · per-cap modals gestapeld · caps geprioriteerd/geordend.
**→ Antwoord:** _(leeg)_

**G-19-2** — Hoe wordt `spent` gereset/herberekend voor een rollend (niet-kalender) `periodWindow` (gemodelleerd op Claude's 5-uurs quota), gegeven `SpendRecord` slechts advisory (char/hook-geschat) is?
*Waarom dit een gat is:* D82 reserveert een rollend venster maar de meter-UNIT bestaat pas bij een metered backend; aggregatie/afkapping van advisory `spent` over een rollend venster is onbelegd voor v1.
**→ Antwoord:** _(leeg)_

**G-19-3** — Worden bij een `pauseAll`-cost-cap ook preview-containers (23) en CI-jobs (gedeelde CapacityManager-budget) gepauzeerd/teruggevorderd, of alleen `claude`-stage-sessies?
*Waarom dit een gat is:* `19 §Data` zegt pause-all werkt over `AgentSession.status`; previews/CI zijn aparte container-soorten in dezelfde resource-budget.
**→ Antwoord:** _(leeg)_

### 20 — Activity & event log
**G-20-1** — Wat toont de rewind-scrubber (D64) voor een gekild ticket (container weg) of voor stages die nooit een carry-over-commit produceerden (host-side reasoning role)?
*Waarom dit een gat is:* `20 §flow 7` gaat uit van een nette reeks stage-commit-snapshots; tickets zonder worktree-commits of na teardown hebben geen `commitHash`-ankers.
**→ Antwoord:** _(leeg)_

**G-20-2** — Toont de rewind een lokale staat die later door een GitLab-wins reconcile is overschreven als een echt historisch punt, en kan een rewind-snapshot een `commitHash` tonen die niet meer matcht met de huidige (door GitLab gewonnen) projectie?
*Waarom dit een gat is:* doc 22 kan de projectie onder de events vandaan overschrijven; de consistentie tussen append-only event-log en een door-reconcile-gewijzigde projectie tijdens rewind is niet belegd.
**→ Antwoord:** _(leeg)_

### 21 — Search & command palette
**G-21-1** — Doorzoekt de palette de volledige RBAC-leesscope server-side, of alleen het al-gesyncte client-venster (bounded, D83/D84) — en wat als een oud ticket buiten het venster valt?
*Waarom dit een gat is:* `21 §Verbs` zegt v1 filtert in-memory client-side en de echte build backt op `list_tickets`, maar de corpus-dekking is onbelegd.
**→ Antwoord:** _(leeg)_

**G-21-2** — Worden palette-resultaten (tickets + Sources/docs) per-user RBAC-gefilterd vóór weergave, gegeven `query_context` doc-chunks content kunnen lekken die een rol niet hoort te zien?
*Waarom dit een gat is:* `21 §Deferred` zegt "scoped to the workspace's RBAC read scope" maar definieert geen per-resource filter binnen de workspace.
**→ Antwoord:** _(leeg)_

### 22 — GitLab board sync
**G-22-1** — Kan een outbound write-through een net-binnengekomen GitLab-wijziging overschrijven vóór de reconcile, en hoe wordt een echo-loop (eigen write triggert een webhook die opnieuw reconcilet) voorkomen?
*Waarom dit een gat is:* `22 §flow 4/5` stelt "GitLab wins" + "serial reconcile", maar de outbound-vs-inbound race + echo-loop is niet uitgewerkt.
*Mogelijke richtingen:* outbound writes taggen/onderdrukken hun echo · optimistic-lock op een GitLab-versie · outbound via dezelfde seriële queue.
**→ Antwoord:** _(leeg)_

**G-22-2** — Wat gebeurt er met een ticket waarvan de GitLab-issue wordt verwijderd (niet gesloten) of naar een ander project verplaatst — verdwijnt het ticket (hard delete), gearchiveerd, en wat met een lopende AgentSession/worktree?
*Waarom dit een gat is:* `22 §flow` dekt edit/label/close/merge maar niet issue-delete/move; "GitLab wins" impliceert verdwijning maar de cascade naar een actieve container/branch is ongedefinieerd.
**→ Antwoord:** _(leeg)_

**G-22-3** — Blijft de board-projectie vooruitlopen op GitLab als een outbound write-through faalt (token verlopen/5xx/rate-limit), en hoe wordt die divergentie getoond (de health-chip toont alleen inbound)?
*Waarom dit een gat is:* `22 §flow 4` beschrijft alleen de happy-path write-through; de outbound-failure-mode ontbreekt.
**→ Antwoord:** _(leeg)_

### 23 — Preview deployment
**G-23-1** — Waar leeft "open"-detectie voor de 30-min TTL-reset (D67) — feitelijk app-verkeer naar de preview (Caddy-route), of alleen een chip-klik in de Workspaces-UI?
*Waarom dit een gat is:* `23 §flow 3` zegt "Re-clicking … resets the 30-min TTL" wat alleen de chip-klik dekt; een actief gebruikte preview-tab verliest 'm na 30 min midden in gebruik.
*Mogelijke richtingen:* bump op Caddy-proxy-activiteit · alleen op chip-klik · keep-alive-ping vanuit de preview-pagina.
**→ Antwoord:** _(leeg)_

**G-23-2** — Wat gebeurt er met een live preview (+ TTL) als het ticket gepauzeerd/gekild wordt of een nieuwe stage-commit de `commitHash` voortbeweegt — wijst de URL dan naar verouderde/verdwenen code?
*Waarom dit een gat is:* `23 §Deferred` bevriest op de frozen `commitHash`, maar de interactie met kill/pause/teardown (24) en een commit-advance is niet belegd.
**→ Antwoord:** _(leeg)_

**G-23-3** — In welke volgorde komen gequeuede previews (D86) aan de beurt, verloopt een queue-item (TTL terwijl gequeued), en kan een gebruiker zijn eigen wachtende request annuleren?
*Waarom dit een gat is:* D86 introduceert de queue + per-preview stop maar definieert geen ordening (FIFO/prioriteit), queue-timeout, of annuleer-actie.
**→ Antwoord:** _(leeg)_

### 24 — Pause & kill controls
**G-24-1** — Wat doet/toont de **Resume**-knop nadat de container al door D87 idle-reclaim is teruggevorderd — een fout, of stilzwijgend een volledige reactivatie (nieuwe container, `--resume`)?
*Waarom dit een gat is:* `24 §flow 2` beschrijft Resume als simpel re-attach via `--resume`; D87 zegt na reclaim kan alleen full reactivation — de knop kent dat onderscheid niet.
**→ Antwoord:** _(leeg)_

**G-24-2** — Pauzeert "pause all agents" ook sessies die tijdens de seriële sweep van `needs-input` naar `busy` gaan of net starten, of alleen de set die bij aanvang `busy` was?
*Waarom dit een gat is:* `24 §flow 4` zegt "serially across every running session" zonder consistente snapshot vs live-set; een net-gestarte sessie kan ontsnappen — relevant want noodrem.
*Mogelijke richtingen:* eerst een workspace-brede "no new starts"-vlag, dan sweep · snapshot-set bij aanvang · herhaal tot stabiel.
**→ Antwoord:** _(leeg)_

**G-24-3** — Worden bij een kill (teardown container) de gekoppelde live preview (23) en andermans open terminals (14) meegenomen (preview-down, sockets gekapt), en met welke melding aan die gebruikers?
*Waarom dit een gat is:* `24 §flow 3` zegt kill teardownt de container + behoudt branch/events, maar de cascade naar gekoppelde surfaces is niet belegd.
**→ Antwoord:** _(leeg)_

---

# 6. All-in-one laag + additions

### FORGE_ABSTRACTION
**G-FORGE-1** — Wat gebeurt er met een built-in `MergeRequest` + review-threads/approvals als een workspace later van mode wisselt (built-in → GitLab) — er is geen extern doelwit voor de review-rijen?
*Waarom dit een gat is:* §6/§10 parkeren mode-switching maar definiëren niet wat met bestaande built-in-owned (niet-git) data gebeurt, terwijl de doc "adapter-to-adapter copy" claimt.
*Mogelijke richtingen:* built-in review-data blijft read-only-archief na migratie · export waar API toelaat, anders bevriezen.
**→ Antwoord:** _(leeg)_

**G-FORGE-2** — In external mode: wie wint voor de MR-status als een forge-webhook een MR-statuswijziging meldt die conflicteert met een lokaal genoteerde optimistische state (lokaal `approved`, forge `open`)?
*Waarom dit een gat is:* §4's "forge wins"-regel is alleen voor issues/labels gespecificeerd, niet voor de `MergeRequest`-cache (`externalRef`).
*Mogelijke richtingen:* forge wint ook op MR-cache · aparte reconcile-regel voor MR vs issue.
**→ Antwoord:** _(leeg)_

### BUILTIN_MR_REVIEW
**G-MR-1** — Schrijft de Conductor de lokale `ReviewThread`-rij vóór of na de forge-write (external mode), en wat bij een gefaalde forge-write nadat de lokale rij al bestaat (drift)?
*Waarom dit een gat is:* §8 federeert writes "waar de API toestaat, anders deep-link"; de transactionaliteit lokale-rij-vs-forge-write ontbreekt.
*Mogelijke richtingen:* lokale rij altijd autoritatief lokaal, deep-link bewust gescheiden (documenteer drift) · lokale rij pas na forge-ack.
**→ Antwoord:** _(leeg)_

**G-MR-2** — Wat gebeurt er met een open `MergeRequest` als het ticket gekild/teardown wordt — `closed`, blijft `open` met dode branch, of ongedefinieerd?
*Waarom dit een gat is:* De §2 state-machine heeft `mr-close` als human-op maar geen pad voor ticket-kill → MR-state; een verweesde open MR kan blijven hangen.
*Mogelijke richtingen:* kill → Conductor sluit gekoppelde open MR's + AuditEntry · MR blijft open want branch blijft.
**→ Antwoord:** _(leeg)_

**G-MR-3** — Hoe komt een MR met `minApprovals:0` (`full-auto-merge`) in state `approved` — er is nooit een `mr-approve`-event dat de transitie triggert?
*Waarom dit een gat is:* TRUST §5.1 staat `minApprovals:0` toe; §2 gaat `open → approved` "when `mr-approve` makes the rule pass". Wie flipt een 0-approval MR is niet gespecificeerd.
*Mogelijke richtingen:* Conductor evalueert de regel direct op `mr-open`/CI-groen zonder approve-event · `full-auto-merge` slaat `approved` over en merget op groen CI.
**→ Antwoord:** _(leeg)_

### BUILTIN_CI_PIPELINES
**G-CI-1** — Wat gebeurt er met een `mr.updated`-getriggerde CI-run als een nieuwe head-commit landt terwijl een vorige run nog `running` is — cancel-in-flight, beide draaien, of negeren?
*Waarom dit een gat is:* §3 voegt `mr.updated` toe en §4.2 bevriest op één `commitHash`, maar er is geen supersede/cancel-regel; snelle reject-reopen-loops stapelen runs op de gedeelde budget (botst met §7).
*Mogelijke richtingen:* nieuwe head cancelt de in-flight run · één run per MR tegelijk, nieuwe push enqueue't.
**→ Antwoord:** _(leeg)_

**G-CI-2** — Wat doet de merge-gate in forge-native mode als de CI-status-webhook vertraagd/verloren is en de gate "geen bekende run" ziet — fail-closed, fail-open, of poll-fallback?
*Waarom dit een gat is:* §6.1 + GIT_STRATEGY §5 blokkeren op `failed`/`running`, maar niet op "nooit gestart vs verloren webhook".
*Mogelijke richtingen:* gate vereist expliciet `success` (fail-closed) · poll-fallback naar de forge-API · timeout → needs-input.
**→ Antwoord:** _(leeg)_

### GIT_STRATEGY
**G-GIT-1** — Wie bepaalt de merge-volgorde bij `full-auto-merge` zonder menselijke klik, gegeven §3 stelt "ordering = de menselijke klik-volgorde"?
*Waarom dit een gat is:* `full-auto-merge` verwijdert de mens; meerdere tickets worden tegelijk groen-mergeable maar er is geen volgorde-mechanisme (raakt de conflict-cascade).
*Mogelijke richtingen:* enqueue op tijdstip-van-groen-CI, serieel · hergebruik de #11 priority-picker · oldest-MR-first.
**→ Antwoord:** _(leeg)_

**G-GIT-2** — Wat gebeurt er met een `mr-revert` + tracking-ticket als de te-reverten commit al is overschreven of de revert conflicteert — en wordt de revert-MR per ongeluk auto-merged onder `full-auto-merge`?
*Waarom dit een gat is:* §6 routeert een conflict-revert "through §4" (veronderstelt een levende stage-agent die het tracking-ticket nog niet heeft); TRUST §3.3 zegt de revert-MR gaat "through the NORMAL gate" — maar die is onder auto-merge juist auto, wat de rollback-veiligheidsklep ondermijnt.
*Mogelijke richtingen:* revert-MR's altijd uitgezonderd van auto-merge · conflict-revert escaleert direct naar needs-input.
**→ Antwoord:** _(leeg)_

### AI_QUALITY_AND_EVALS
**G-AIQ-1** — Behoudt een ticket met een sticky A/B-arm zijn arm voor latere stages nadat de `PromptABTest` is beëindigd (`endedAt`), of valt het op de nieuwe default (vervuilt de A/B-join)?
*Waarom dit een gat is:* §4.3 maakt assignment sticky per ticket, maar de levensduur over test-einde heen is een gat.
*Mogelijke richtingen:* sticky tot ticket-completion · `endedAt` bevriest nieuwe toewijzingen maar lopende tickets behouden hun arm.
**→ Antwoord:** _(leeg)_

**G-AIQ-2** — Hoe wordt de golden-ticket replay-lane (`ReplayEngineDriver`) ongeldig verklaard bij een gepinde-CLI-bump — opgenomen events kunnen achterhaald zijn en als vals-positief "groen" blijven afspelen?
*Waarom dit een gat is:* §3.2 draait op opgenomen events zonder CLI-spawn; bij een CLI-bump (Q-CT-CLIPIN) maskeert het mogelijk juist de echte gedragsverandering.
*Mogelijke richtingen:* fixtures dragen de CLI-versie en falen luid bij mismatch · een CLI-bump verplicht een live-lane re-record vóór merge.
**→ Antwoord:** _(leeg)_

### CLIENT_AND_PUSH
**G-CLIENT-1** — Toont de pre-armed Approve deep-link een stale gate als de QuestionSet al door iemand anders is beantwoord (#06) tegen de tijd dat de gebruiker de PWA vanaf lock-screen opent?
*Waarom dit een gat is:* §6 belooft pre-armed approve in-app, maar de race tussen push-deeplink-latency en de cross-client claim is ongedefinieerd.
*Mogelijke richtingen:* bij open verse state ophalen + "reeds beantwoord door X" tonen · pre-armed submit faalt idempotent met dezelfde melding.
**→ Antwoord:** _(leeg)_

**G-CLIENT-2** — Welke `Notification.channels`-default + push-routing geldt voor de NIEUWE notificatie-types uit de additions (`automation.failed` Tier-2, onboarding-approval #04), gegeven §8 alleen de vier oorspronkelijke klassen kent?
*Waarom dit een gat is:* §8 type-gate't push op de vier B-34-klassen; nieuwe notificeerbare events zijn niet geclassificeerd, en #16's per-type matrix veronderstelt een typeset die hier niet is uitgebreid.
*Mogelijke richtingen:* elke nieuwe klasse declareert expliciet een channels-default in #16 · fallback "in-app only" voor niet-geclassificeerde types.
**→ Antwoord:** _(leeg)_

### SELF_HOST_INSTALLER
**G-INSTALL-1** — Joint de VAPID-keypair de DR-backupset, of worden alle `PushSubscription`-rijen onbruikbaar bij een restore met een nieuwe/oude keypair (push-signing faalt)?
*Waarom dit een gat is:* §5.2/§5.6 minten VAPID eenmalig; §8 restored Mongo+Redis maar behandelt niet de VAPID-key-continuïteit (de key zit in de secret-store, niet Mongo) of een prune-pad voor verweesde subscriptions.
*Mogelijke richtingen:* VAPID-keypair joint de DR-backupset · post-restore stap die subscriptions invalideert bij key-mismatch.
**→ Antwoord:** _(leeg)_

**G-INSTALL-2** — Wat is het pad om ná install van minimale (external GitLab) naar volle (built-in git-server) profile te schakelen, zonder bestaande external-mode workspaces te breken?
*Waarom dit een gat is:* §4 koppelt het compose-profile aan `forgeMode` en "errors loudly on mismatch", maar geeft geen upscale-pad; "één profile per stack" botst met per-workspace `forgeMode`.
*Mogelijke richtingen:* volle profile draait altijd alle services, `forgeMode` blijft per-workspace · documenteer een profile-upgrade-runbook.
**→ Antwoord:** _(leeg)_

### TRUST_SAFETY_UX
**G-TRUST-1** — Schrijft de Conductor een `AuditEntry` voor een SYSTEM-`full-auto-merge`, met welke `action`/detail (welk autonomielevel + wie het aanzette)?
*Waarom dit een gat is:* §4.4 verkoopt audit als het antwoord op "wie keurde de merge goed die prod brak", maar bij auto-merge is er geen menselijke approver en de attributie is niet uitgewerkt.
*Mogelijke richtingen:* `AuditEntry{action:'merge', actorKind:'system', detail:{autonomyLevel, enabledBy}}` · een aparte `auto-merge` action.
**→ Antwoord:** _(leeg)_

**G-TRUST-2** — Hoe gedraagt een per-ticket `autonomyOverride` zich als de workspace-`autonomyLevel` daarna versoepeld/verstrakt wordt — overschrijft de nieuwe default de override, of blijft hij absoluut (en kan hij dan onbedoeld losser zijn)?
*Waarom dit een gat is:* §5.3 zegt de override "tightens (never loosens)" en `effectiveLevel = override ?? workspace`, maar de `??`-resolutie negeert de tighten-only-invariant na een workspace-wijziging.
*Mogelijke richtingen:* `effectiveLevel = max(strengte van override, default)` · workspace-wijziging wist niet-meer-strengere overrides.
**→ Antwoord:** _(leeg)_

### PRODUCT_ANALYTICS
**G-ANALYTICS-1** — Blijft `cost_per_ticket_type`/`cost_per_preset` correct als `Workspace.pricing`/`presetKey` midden in de meetperiode wijzigt (retroactieve herclassificatie van historische `SpendRecord`s)?
*Waarom dit een gat is:* §5 berekent cost als `tokens × huidige pricing` en groepeert op de huidige (muteerbare) preset-key; een prijs-/preset-wijziging herwaardeert alle historie.
*Mogelijke richtingen:* `SpendRecord` legt de toen-geldende prijs + preset point-in-time vast · accepteer live-herwaardering + documenteer.
**→ Antwoord:** _(leeg)_

**G-ANALYTICS-2** — Wat is de completion-anchor voor cycle-time/throughput van een via `mr-revert` ongedaan-gemaakt ticket — telt de oorspronkelijke merge nog mee, en hoe telt het revert-tracking-ticket zelf?
*Waarom dit een gat is:* §2/§9 ankeren completion op het merge-`mr`-event; een revert produceert óók zo'n event, dus een fout-merge + revert telt als TWEE completions.
*Mogelijke richtingen:* revert-merges uitsluiten van throughput + markeren als negatief-signaal · revert decrementeert de oorspronkelijke completion.
**→ Antwoord:** _(leeg)_

### Additions — kruisingen
**G-ONBOARD-1** — Botst de `onboarding`-agent's worktree-draft (uncommitted tot approve) met #09's per-stage-commit (Conductor commit elke stage-boundary)?
*Waarom dit een gat is:* 04 §3.3 schrijft drafts uncommitted; 09 §3.1 commit élke stage-boundary — of #09 op de onboarding-stage vuurt en de drafts vroegtijdig commit is een directe contradictie.
*Mogelijke richtingen:* onboarding uitgezonderd van per-stage-commit · onboarding-commit naar een aparte ref die approve overschrijft.
**→ Antwoord:** _(leeg)_

**G-FORENSIC-1** — Hoe werkt #12's `flaky-test` same-commit-detectie onder #09's reject-reopen-amend, waar de stage-`commitHash` in-place wordt herschreven (twee runs delen niet meer dezelfde hash)?
*Waarom dit een gat is:* 12 §3.3 detecteert flaky via "across reruns at the same per-stage `commitHash`"; #09's amend geeft elke reopen een nieuwe hash → het schoonste flaky-signal wordt systematisch gemist.
*Mogelijke richtingen:* flaky-detectie keyt op een stabiele logische stage-identiteit · detecteer over expliciete rerun-events los van commit.
**→ Antwoord:** _(leeg)_

**G-SCHED-1** — Hoe verzoenen #11's priority-picker en #13's quota-gate hun volgorde in dezelfde `admit()`/`onSlotFree()` — wordt een `urgent` item onder een gesloten quota-gate alsnog geadmitteerd?
*Waarom dit een gat is:* 13 §3.3 zet `quotaGateClosed()` "evaluated first"; 11 §3.2 vervangt de dequeue met een priority-sort; de gezamenlijke pseudocode is niet gepind.
*Mogelijke richtingen:* quota-gate is een filter dat #11's candidate-set verkleint · urgent krijgt een quota-uitzondering.
**→ Antwoord:** _(leeg)_

**G-QUOTA-1** — Hoe gedraagt de gedeelde fleet-quota-gauge zich als workspaces verschillende `quotaPause.threshold`s hebben (lage-threshold workspace pauzeert eerder, hoge blijft de pool opmaken — permanent over threshold)?
*Waarom dit een gat is:* 13 §3.3 zet "per-workspace-threshold over one shared fleet gauge"; met één pool is er geen fair-share (verwijst naar #11 HORIZON die geen per-tenant fair-share bouwt).
*Mogelijke richtingen:* documenteer dat lage-threshold workspaces eerder/langer pauzeren (geaccepteerd) · een fleet-brede min-threshold los van per-workspace.
**→ Antwoord:** _(leeg)_

**G-PRESENCE-1** — Is de cross-client first-answer-wins-guard feitelijk de Conductor's serial status-check (`open→answered`) en NIET `clientRequestId` (die per-client wordt gegenereerd)?
*Waarom dit een gat is:* 06 §3.2 zegt "idempotency key = `(questionSetId)` carried by `clientRequestId`", maar `clientRequestId` dedupt re-sends van dezelfde client; de doc vermengt beide mechanismen — de gestelde load-bearing guard is de verkeerde.
*Mogelijke richtingen:* verduidelijk: status-check is de cross-client guard, `clientRequestId` enkel same-client dedup · server-side idempotency-key = `questionSetId` los van `clientRequestId`.
**→ Antwoord:** _(leeg)_

**G-NOTIF-1** — Hoe schrijft de Conductor een framework-global `NotificationPreference` (geen `workspaceId`) via `notif-prefs-save` zonder `runInTenant`, gegeven CONTROL_API §7 dat op élk pad eist (`currentWorkspaceId()` throws bij omissie)?
*Waarom dit een gat is:* 16 §3.4 zegt "global pref rows do not require a tenant client", een directe afwijking van het kern-invariant die niet wordt verzoend.
*Mogelijke richtingen:* een gesanctioneerd "framework-global Conductor write"-pad (zoals `PushSubscription` al heeft) · `notif-prefs-save` draait onder een neutrale system-scope.
**→ Antwoord:** _(leeg)_

**G-TIER2-1** — Welke lane/doc "bezit" de automation-event-uitbreidingen T11/T12 (waar #12 als data-source van afhangt), gegeven het ledger alleen "with whichever lane owns the trigger engine" zegt?
*Waarom dit een gat is:* T11 (`TriggerRun`-ledger + `automation.failed`) en T12 (`editor.*`/`review.*`-events) worden door #12 vereist maar hun eigenaar is nergens vastgelegd.
*Mogelijke richtingen:* wijs de trigger-engine expliciet aan een lane (vermoedelijk A, `03_AUTOMATION_AND_PLUGINS`) · maak T11/T12 een eigen genummerde addition.
**→ Antwoord:** _(leeg)_

---

# 7. Tool-modules & brainstorm

### Gedeeld tool-raamwerk (00-framework)
**G-FW-1** — Welke fijnmazigheid heeft module-zichtbaarheid: alleen per-workspace, of ook per-rol / per-gebruiker?
*Waarom dit een gat is:* `00-framework.md` gaat per-workspace uit, maar `round2/tools-framework.md V-2` bood drie opties die niet in DECISIONS.md staan; `navEntry.requiredCapability` suggereert wél rol-filtering.
*Mogelijke richtingen:* alleen per-workspace · + optionele per-rol allow-list · + persoonlijke verberg-voorkeur.
**→ Antwoord:** _(leeg)_

**G-FW-2** — Wat gebeurt er met `ModuleArtifact`-rows, `TicketArtifactLink`s en nav-entries als een ingeschakelde module weer wordt uitgezet?
*Waarom dit een gat is:* `00-framework.md` beschrijft `module-toggle` en `artifact-delete` los van elkaar, maar niet wat een disable doet met geproduceerde artifacts, lopende sessies, of live-referencende tickets.
*Mogelijke richtingen:* disable verbergt nav + blokkeert nieuwe sessies, data/links blijven leesbaar · disable geblokkeerd zolang actieve links/sessies · soft-archive.
**→ Antwoord:** _(leeg)_

**G-FW-3** — Wat is de storage-backend + quota voor `ModuleArtifact.uri`, en hoe verhoudt dat zich tot de `@luckystack/storage`-seam die alleen Document+Marketing mogen gebruiken (DECISIONS #16)?
*Waarom dit een gat is:* Designer-screenshots en interview-results zijn óók `ModuleArtifact`s maar vallen buiten die seam; waar die blobs landen + of de soft-cap er komt is onbeslist.
*Mogelijke richtingen:* framework-store gebruikt dezelfde `StorageClient` · twee aparte stores met grens · soft-cap nu vastleggen.
**→ Antwoord:** _(leeg)_

**G-FW-4** — Krijgt elke module een aparte top-level nav-entry, en wat is de overflow-/ordening-strategie bij 5+ ingeschakelde tools?
*Waarom dit een gat is:* `00-framework.md F3.1` voegt items "na de core-entries" toe; met meerdere modules wordt de NavRail druk zonder beslissing over volgorde/groepering/mobiele overflow.
*Mogelijke richtingen:* vaste volgorde uit een registry-`order`-veld · een "Tools"-groep/submenu bij >N · gebruiker herordent.
**→ Antwoord:** _(leeg)_

**G-FW-5** — Is folder-structuur één gedeeld `ModuleFolder`-model, of deelt het namespace met de aparte `MarketingFolder`/`DesignSession.folderId`?
*Waarom dit een gat is:* `00-framework.md` definieert generiek `ModuleFolder`, maar `03-marketing.md` definieert een eigen `MarketingFolder` en Designer gebruikt `DesignSession.folderId` zonder folder-model — intern inconsistent.
*Mogelijke richtingen:* alle modules verplicht op `ModuleFolder` (schrap `MarketingFolder`) · per-module folder-modellen (schrap generiek).
**→ Antwoord:** _(leeg)_

**G-FW-6** — Eén gedeeld `ModuleArtifact`-store of parallelle module-specifieke `DesignArtifact`/`DocumentArtifact`-modellen?
*Waarom dit een gat is:* `00-framework.md` zegt "gedeeld artifact-model voor ALLE module-output", maar `02`/`04` definiëren elk eigen `*Artifact` + `*ArtifactLink` — dupliceert de live-referentie-semantiek; onduidelijk welke leidend is.
*Mogelijke richtingen:* modules schrijven naar `ModuleArtifact` met module-`metadata` (schrap eigen modellen) · eigen modellen + view/adapter naar de gedeelde picker · gedeeld voor picker, eigen voor detail.
**→ Antwoord:** _(leeg)_

### Interviewer (01)
**G-INT-1** — Mag een `type:'question'`-card ook via de answer-queue beantwoord worden of alleen via de stepper, en wat als een sessie `paused` is terwijl een card in de queue staat?
*Waarom dit een gat is:* `01-interviewer.md §4.6` zet open cards in de queue, maar DECISIONS #3 introduceert `paused`-sessies en batches; de interactie is onbelegd.
**→ Antwoord:** _(leeg)_

**G-INT-2** — Wat is het geconsolideerde `status`-vocabulaire van `InterviewSession` (datamodel `generating|open|answered|partial`, R-6 voegt `failed`, DECISIONS #3 voegt `paused`/`active`)?
*Waarom dit een gat is:* De statusset is nooit geconsolideerd — de bouwer krijgt tegenstrijdige enums.
**→ Antwoord:** _(leeg)_

**G-INT-3** — Produceert de Interviewer ooit meer dan losse cards (de in brainstorm voorgestelde Interviewer → spec/PRD → tickets-keten)?
*Waarom dit een gat is:* `round2/new-features.md V-3` schetst die keten; de make-ticket-flow stopt bij één-idee-per-ticket. Spec Studio staat niet in DECISIONS.
**→ Antwoord:** _(leeg)_

### Designer (02)
**G-DSGN-1** — Wie draait en betaalt de always-on `main` preview-server, en wat bij down/rode CI tijdens een generatie?
*Waarom dit een gat is:* DECISIONS #10 lockt opt-in + permanent slot, maar `02-designer.md` laat open wie de server draait + de capacity-inrekening; het herstart-trigger is een idee, geen beslissing.
*Mogelijke richtingen:* één gedeelde host-brede preview-server · per-workspace eigen slot · on-demand spin-up.
**→ Antwoord:** _(leeg)_

**G-DSGN-2** — Hoe wordt ongereviewde AI-React/CSS-code veilig in `/design-preview/:variantId` op de `main`-preview-server gerenderd zonder de container te compromitteren of de geprojecteerde token te exfiltreren?
*Waarom dit een gat is:* `02-designer.md` zegt "gesandboxt (CSP)" maar het injectie-mechanisme van arbitraire AI-code in een PROD-mode container is niet uitgewerkt — een security-grens zonder ADR/review-eis.
**→ Antwoord:** _(leeg)_

**G-DSGN-3** — Is de Copy/Content-studio (UI-teksten/i18n) onderdeel van Designer, een eigen module, of geschrapt?
*Waarom dit een gat is:* `round2/new-features.md V-2` bood Copy Studio aan; de Designer genereert React/Tailwind met hardcoded strings maar er is geen beslissing over i18n-strings in gegenereerde designs (botst potentieel met Rule 13).
**→ Antwoord:** _(leeg)_

**G-DSGN-4** — Hoe gaat de token-diff-flow om met dark-mode tokens, `-hover`/`-border`-varianten, en tokens die niet in de diff voorkomen?
*Waarom dit een gat is:* `02-designer.md` toont losse token-changes, maar `src/index.css` heeft per token varianten + een `.dark`-blok; samenhangende sets wijzigen (anders incoherent palet) en dark-mode-screenshot zijn onbelegd.
**→ Antwoord:** _(leeg)_

### Marketing (03)
**G-MKT-1** — Wat is de grens tussen een Marketing-skill en een Design-skill nu beide één enkelwaardig `SkillEntry.surface` + dezelfde Sources-tab delen — kan een skill twee surfaces hebben?
*Waarom dit een gat is:* Een merk-/stijl-skill is plausibel relevant voor beide; `surface` is single-value String? en `00-framework.md O3` lost alleen `null=pipeline-breed` op.
**→ Antwoord:** _(leeg)_

**G-MKT-2** — Is er een Brand Kit (gedeelde merk-bibliotheek voor Designer + Marketing), of blijft merk-info versnipperd over losse skills/uploads?
*Waarom dit een gat is:* `round2/new-features.md V-5` stelde Brand Kit voor; marketing-skills verwijzen impliciet naar merkdata die nergens centraal leeft. Geen build-plan/DECISIONS-regel.
*Mogelijke richtingen:* eigen Brand Kit-zone · een `surface:'brand'`-skill die beide lezen · geen — blijft per skill.
**→ Antwoord:** _(leeg)_

**G-MKT-3** — Hoe wordt de prijs/billing van V2-asset-generatie via de externe `MEDIA_API_KEY` afgerekend/begrensd, gegeven de rest PTY-subscription-billing is?
*Waarom dit een gat is:* `overall-strategy.md` benoemt de metered-API-vs-subscription-split als fundamentele breuk, maar of/hoe/aan wie de metered media-kosten worden doorberekend/gecapt is onbeslist.
**→ Antwoord:** _(leeg)_

**G-MKT-4** — Welke folder-nesting-limiet geldt voor Marketing, en waarom wijkt `MarketingFolder` af van de generieke `ModuleFolder` (max 5, gedeelde component, `order`-veld)?
*Waarom dit een gat is:* `03-marketing.md` zegt "geen nesting-limiet (builder kiest ≤5)" terwijl `00-framework.md` 5 hard afdwingt; de marketing-folder heeft ook geen `order`-veld voor de beloofde drag-reorder. (Concrete uiting van G-FW-5.)
**→ Antwoord:** _(leeg)_

### Document Studio (04) + integriteitsgrens
**G-DOC-1** — Hoe wordt de academische-integriteitsgrens ("geen AI-detectie-ontwijking") concreet afgedwongen/bewaakt, voorbij de prompt-instructie en UI-tekst?
*Waarom dit een gat is:* De grens is gelockt als principe maar niet operationeel; schrijfniveau "student" + toon-controls + schone output kunnen samen detectie-ontwijking benaderen.
*Mogelijke richtingen:* puur prompt + UI-disclaimer · `ai:lint`-achtige skill-content-check op verboden framing · audit-log van skill-instructies.
**→ Antwoord:** _(leeg)_

**G-DOC-2** — Wat is de concrete "ondersteunde subset" per round-trip-formaat, en wie bepaalt wanneer extractie "te complex" is (geneste tabellen, track changes, embedded objects, master slides)?
*Waarom dit een gat is:* DECISIONS #15 lockt het principe maar `04-document.md §Format-fidelity` laat de concrete lijst + faal-grens open.
**→ Antwoord:** _(leeg)_

**G-DOC-3** — Geldt de D74-binary-upload-override (sandbox-parse-pipeline) alleen voor Document Studio, of erven Marketing-uploads (brand-kit docs) en toekomstige modules diezelfde uitbreiding?
*Waarom dit een gat is:* `04-document.md` zegt de uitbreiding geldt alleen voor de Document-upload-flow, maar `03-marketing.md` verwijst naar brand-kit-doc-uploads via de bestaande flow.
**→ Antwoord:** _(leeg)_

**G-DOC-4** — Is het hallucinatie-vangnet (DECISIONS #14) blokkerend (geen `DocumentArtifact` tot opgelost) of slechts een waarschuwing achteraf?
*Waarom dit een gat is:* #14 lockt dát er een `needs-input`-check komt bij niet-verankerde bronverwijzingen, niet of dit de generatie stopt — voor "professioneel ogend doc met verzonnen inhoud" is dat onderscheid load-bearing.
**→ Antwoord:** _(leeg)_

**G-DOC-5** — Mag een Document-/Marketing-artifact aan meerdere tickets tegelijk gekoppeld worden, en wat is de versie-semantiek als het bron-artifact midden in een lopende stage een nieuwe versie krijgt?
*Waarom dit een gat is:* `00-framework.md O2`/DECISIONS #2 lockken "inject bij spawn, geen live-update" voor het framework, maar de per-module `*ArtifactLink`-modellen hebben geen `version`-pin zoals `ModuleArtifact.version`. (Koppelt aan G-FW-6.)
**→ Antwoord:** _(leeg)_

### Image-builder (05)
**G-IMG-1** — Is LAN-only de bevestigde V1-default voor de preview forward-auth, en wat is het te-documenteren pad voor internet-facing (DNS + wildcard-TLS)?
*Waarom dit een gat is:* `05-image-builder.md §Risico's` markeert dit als onbevestigde aanname; de hele wizard-UX hangt af van deze keuze. Niet in DECISIONS.
**→ Antwoord:** _(leeg)_

**G-IMG-2** — Is de Image-builder óók een `FeatureModule` met `ModuleManifest`, of een aparte Settings-flow buiten het modulesysteem — en hoe rijmt dat met de bouwvolgorde (05 in Fase 2, vóór het tool-framework van 00)?
*Waarom dit een gat is:* `INDEX.md` plaatst 05 in Fase 2 maar het deelt `propose_suggestion`/artifacts/Admin-gating met de modules; onduidelijk of het de 00-primitieven hergebruikt (bouwvolgorde-conflict: 05 zou vóór 00 klaar zijn).
**→ Antwoord:** _(leeg)_

**G-IMG-3** — Mag een non-admin een stack-template uit de catalogus bouwen (een L2-build triggeren), of is template-keuze óók Admin-gated zoals het AI-Dockerfile-pad?
*Waarom dit een gat is:* `05-image-builder.md` Admin-gate't AI-geschreven Dockerfiles, maar de 4 templates "zijn direct beschikbaar (geen AI nodig)"; of het bouwen van een template-image óók de gate passeert is niet expliciet.
**→ Antwoord:** _(leeg)_

### Cross-module / niet-omgezette brainstorm-threads
**G-MOD-1** — Welke van de 11 voorgestelde modules (Diagram, Copy, Spec/PRD, Test-plan, Brand Kit + 6 AI-voorgestelde: QA-auteur, Docs/Release-notes, Failure Forensics, Data Seeder, Secrets Vault, On-Call) worden bewust geparkeerd vs. geschrapt?
*Waarom dit een gat is:* `round2/new-features.md` + `modules/proposed-new-modules.md` bevatten 11 modules met beslissingsvragen, maar DECISIONS.md noemt er geen één; V-6 vroeg om een top-3 die nooit is vastgelegd. Scope blijft onbegrensd.
**→ Antwoord:** _(leeg)_

**G-MOD-2** — Is cross-module artifact-handoff (Marketing screenshot van een Designer-variant, Document dat een Designer-token-diff inlaadt) in scope, of expliciet V1-out?
*Waarom dit een gat is:* `modules-system.md vraag-mod-7` benoemt dit met drie opties; `00-framework "Deferred"` dekt cross-module *triggers* maar niet data-handoff (een module die een ander z'n artifact als input leest).
*Mogelijke richtingen:* gedeeld `ModuleArtifact` is leesbaar cross-module · V1-out, handmatig · alleen via ticket-carry-over.
**→ Antwoord:** _(leeg)_

**G-MOD-3** — Wat is de gedeelde sub-budget-strategie nu Designer (`designConcurrencyCap`=2), Document (`documentConcurrencyCap`=3) én pipeline-stages allemaal uit dezelfde `MAX_RESIDENT`-pool trekken — sommen de caps tot meer dan de host aankan?
*Waarom dit een gat is:* `00-framework.md R6` zegt "geen per-module reservering V1" terwijl `02`/`04` elk een eigen cap introduceren; niemand vergelijkt de som tegen het host-budget (8 vCPU/32 GB).
**→ Antwoord:** _(leeg)_

**G-MOD-4** — Wat is het concurrency-/lease-gedrag voor de niet-Interviewer modules (2 Designer + 3 Document + N marketing tegelijk), en geldt de single-instance-orchestrator-lock per module of globaal?
*Waarom dit een gat is:* `01-interviewer.md R-6` gebruikt een Redis-SETNX-lock per workspace; `02`/`04` regelen het via caps zonder lock — inconsistent beslist.
**→ Antwoord:** _(leeg)_

**G-MOD-5** — Hoe wordt de kosten-/PTY-melding consistent gemaakt over alle tools — de Interviewer toont een verplichte banner per sessie, maar Designer (N parallelle sessies = N PTY-beurten) en Document hebben geen vastgelegd meldingscontract?
*Waarom dit een gat is:* DECISIONS #6 lockt de banner voor de Interviewer; Designer toont een capaciteitsindicator (≠ kostenmelding) en Document noemt niets — N-varianten is een grotere kostenverrassing dan één interview.
**→ Antwoord:** _(leeg)_
