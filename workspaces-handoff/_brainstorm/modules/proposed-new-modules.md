# Voorgestelde nieuwe modules — AI-voorstel (14-06-2026)

> Dit document bevat 6 door de AI voorgestelde modules die de gebruiker **niet** zelf heeft geopperd, maar die qua architectuur goed passen en een eigen "module-slot" rechtvaardigen. Per module: mening, hoe het aansluit op het bestaande ontwerp, risico's en de beslissingsvragen.

---

## Mijn mening (kandig en direct)

De zes voorgestelde modules hieronder zijn gekozen vanuit één filter: **cross-cutting waarde** — ze vullen een gat dat anders door meerdere projecten opnieuw wordt uitgevonden, en ze bouwen netjes op het bestaande AgentRole/Trigger/WorkspaceSuggestion/QuestionSet fundament. Ze vechten geen enkele locked decision aan.

De sterkste drie zijn **QA/Test-Auteur**, **Docs & Release-Notes** en **Failure Forensics** — ze zijn stuk voor stuk bijna volledig deriveerbaar uit de bestaande `TicketEvent`-stroom + de `AgentRole`-plugin zonder nieuwe verbs of schrijvers. De zwakste (maar nog steeds verdedigbaar) is de **Secrets/Credentials Vault**-module: die heeft de meeste raakpunten met bestaand ontwerp (het `IntegrationTool`-model) en de minste eigenheid als _module_. Overweeg of die beter past als een uitbreiding van de bestaande Integrations-tab dan als een volwaardige module.

**Wat de set gemeenschappelijk heeft en sterk maakt:** geen enkele module hier voegt een nieuw structured-channel verb toe, geen enkele schrijft direct — alles loopt via Conductor. Alle output past in het `emit_carryover`/`emit_output` + `propose_suggestion` schema. Ze gebruiken `WorkspaceTrigger` voor automatisering en `OrchestratorCommandRegistry` voor veilige commando-registratie.

**Wat ik zou bewaken:** de verleiding om "module" gelijk te stellen aan "eigen AI-sessie". Alleen modules die echt langlopende, parallelle agent-taken doen (QA, Docs, Failure Forensics) rechtvaardigen een eigen `AgentRole` met `needsWorkspace:true`. Lichtere modules (Secrets Vault, Data Seeder) zijn triggers + commands, geen eigen PTY-sessies.

---

## Past op bestaande design

Elk van de zes modules landt op een of meer van de volgende bestaande primitieven (geciteerd):

| Module | Primaire aanhaakpunten |
|---|---|
| QA / Test-Auteur | `AgentRole` (`needsWorkspace:true`), `WorkspaceTrigger` (`stage.on_complete`), `ArtifactViewerRegistry`, `TicketEvent`, `BUILTIN_CI_PIPELINES §5` PipelineRunner |
| Docs & Release-Notes | `AgentRole` (`needsWorkspace:false` — geen worktree nodig, alleen RAG + Git-log), `WorkspaceTrigger` (`ticket.merged`), `WorkspaceSuggestion`, `CarryOver`-envelope |
| Failure Forensics | Bestaand addition #12 (`additions/12_failure_forensics.md`) is al HORIZON-gedesigned — dit is de module-schil eromheen. `TicketEvent`-aggregatie, `WorkspaceSuggestion`, deterministische Conductor-regels. |
| Data Seeder & Migrations | `OrchestratorCommandRegistry`, `PipelineRunner` (builtin-container job), `WorkspaceTrigger`, `IntegrationTool` (DB-credential tier B-O8) |
| Secrets / Credentials Vault | `IntegrationTool` (features/04), `WorkspacePreset`-tier config, per-workspace `runInTenant`-scoping, `@luckystack/secrets` (P4 in PACKAGE_OVERVIEW maar al geciteerd in `07b §6.3`) |
| On-Call / Incident Responder | `WorkspaceTrigger` (`cron`, `stage.on_signal`), `WorkspaceSuggestion`, `Notification` (B-34), `OBSERVABILITY.md §4` alert-tabel, `OrchestratorCommandRegistry` |

Spanning met locked decisions:
- **PTY-billing**: alleen QA en Docs hebben een AI-sessie (PTY). Data Seeder, Failure Forensics (deterministisch), Secrets Vault en On-Call zijn command/trigger-only — geen subscription turns. Goed.
- **No new verbs**: geen van de zes modules voegt een verb toe. Ze emitteren via bestaande worker/assistant verbs + WorkspaceTrigger-actions.
- **B-23**: alle AI-gegenereerde output (testrapporten, release-notes, migration-scripts) gaat via `propose_suggestion` → menselijke accept → Conductor.

---

## Risico's

- **Module system bestaat nog niet** — alle zes modules veronderstellen een module-registry-laag die nog ontworpen moet worden. Ze kunnen als losse AgentRole-registraties beginnen, maar de install/uninstall UX en per-module nav-entry ontbreekt. Verwijzing: gap "MODULE SYSTEM" in de corpus-samenvattingen.
- **Per-module AI provider/API-key** is geparkeerd in v1 (MULTI_PROVIDER_SEAM.md §4). Modules die een andere provider willen (bv. een goedkopere LLM voor Docs-generatie) moeten wachten tot de per-stage-provider opt-in gebouwd is.
- **Capacity budget is gedeeld** (CapacityManager, `07b §8`). Een QA-module die veel containers spawnt trekt van hetzelfde budget als de pipeline-stages. Prioritering (CI jobs zijn preferred reclaim victims) is al gebakken in, maar bij een drukke setup kan dit knellen.
- **Failure Forensics is al HORIZON** (addition #12) — de module-schil is nieuw, de onderliggende data-aggregatie is nog niet gebouwd. Dit module voegt UI + actiepad toe bovenop iets wat in de HORIZON-wachtrij staat.
- **Secrets Vault overlapt sterk met bestaand IntegrationTool-model** — het gevaar is dat je hetzelfde twee keer ontwerpt. De meerwaarde zit in de "module"-framing (eigen UI, lifecycle-management) maar de datastores en credential-delivery zijn identiek aan het bestaande model.

---

## Extra ideeën

1. **AI Code Review Assistant als lichte module** — na push-on-approval (V1 §3.1) een lichte async AI-review op de diff (stijl, security, dubbel werk) als `WorkspaceSuggestion` in de Assistant-chat. Geen eigen container nodig, geen extra verb, laagste complexity van alle modules.

2. **Sprint Retrospective Module** — na elke sprint: automatische aggregatie van `TicketEvent`-patronen (stuck-frequentie, gemiddelde doorlooptijd per stageKind, budget vs verwacht) als interactief rapport in het Interviewer-formaat. Puur deterministisch + RAG, geen eigen AI-sessie vereist.

3. **Lokalisatie/i18n Module** — voor multilingual projecten: een AI die door de codebase gaat, ontbrekende vertaalsleutels detecteert, drafts maakt en ze als PR-ready patch voorstelt via `propose_suggestion`. Ideaal voor teams die op meerdere markten bouwen.

4. **Dependency Update Module** — wekelijkse cron-trigger die `npm outdated` / `pip list --outdated` / `go list -m -u all` uitvoert in een lichtgewicht container, de resultaten clustert (patch/minor/major, security-relevant), en een gestructureerd overzicht geeft met per-update risico-inschatting (via RAG op CHANGELOG). Nauwkeurig genoeg voor niet-technische teamleden om te beslissen welke updates ze willen.

---

## Module 1 — QA / Test-Auteur

**Wat het doet:** na elke code-stage schrijft een gespecialiseerde AI-agent automatisch ontbrekende tests voor de gewijzigde files, dient ze in als `propose_suggestion`, en runt ze als CI-job.

**Beslissingsvragen:**

### vraag-qa-1
**Titel:** Wanneer triggert de QA-agent?
**Samenvatting:** Automatisch na elke stage, of alleen op verzoek?
**Gedetailleerde uitleg:** De QA-module kan zichzelf automatisch starten zodra een code-stage klaar is — dan hoef je er nooit aan te denken, maar je verbruikt altijd een AI-sessie. Of je zegt handmatig "start QA" en je hebt volledige controle over wanneer en waarvoor. Het verschil is vergelijkbaar met automatisch opslaan vs. bewust opslaan in een tekstverwerker: automatisch is gemakkelijker, maar kan verrassend zijn en kost altijd iets.
**Type:** keuze
**Opties:**
- a. Automatisch na elke `stage.on_complete` (makkelijkst, lichtste gebruikerslast, verbruikt altijd een AI-sessie)
- b. Optioneel per stage instellen in de pipeline-config (aanbevolen — balans tussen automatisering en controle)
- c. Alleen op handmatig verzoek via de Assistant of het command-palette

### vraag-qa-2
**Titel:** Hoe gaan de test-voorstellen de repo in?
**Samenvatting:** Direct commit, of via propose_suggestion → menselijke review?
**Gedetailleerde uitleg:** De AI schrijft tests en kan ze op twee manieren aanbieden: als concept dat jij beoordeelt en goedkeurt (dan pas in de code), of direct als commit op de branch (sneller, maar je ziet de tests pas bij de MR-review). Gegeven het B-23-principe (AI stelt voor, mens beslist) is de propose-variant de veilige standaard, maar sommige teams willen snelheid.
**Type:** keuze
**Opties:**
- a. Via `propose_suggestion` → jij keurt goed → Conductor commit (aanbevolen, consistent met B-23)
- b. Automatisch als commit, zichtbaar in de changes-page (sneller, maar geen expliciete tussenstapmens)

---

## Module 2 — Docs & Release-Notes Auteur

**Wat het doet:** na een merge genereert een lichte AI-sessie (geen container, `needsWorkspace:false`) een concept changelog-entry, bijgewerkte API-docs en een release-notes-blok op basis van de carry-over-envelop en de git-log.

**Beslissingsvragen:**

### vraag-docs-1
**Titel:** Output als WorkspaceSuggestion of als directe PR?
**Samenvatting:** Docs-concepten tonen als suggestie in de app, of direct als PR op GitLab aanmaken?
**Gedetailleerde uitleg:** De module kan de gegenereerde docs op twee manieren aanbieden: (1) als zichtbaar concept in de Workspace-AI-panel dat je accepteert, waarna de Conductor de commit doet — alles blijft in jouw tool. Of (2) direct een pull request openen op GitLab, zodat het docs-team hun gewone review-flow kan gebruiken. Het eerste is eenvoudiger als het hele team al in Workspaces werkt; het tweede is beter als de docs-beheerder liever op GitLab werkt.
**Type:** keuze
**Opties:**
- a. `WorkspaceSuggestion` in de app → accept → Conductor commit (aanbevolen voor all-in-Workspaces teams)
- b. Automatische GitLab PR aanmaken (beter als docs-beheerder buiten Workspaces leeft)
- c. Beide: sugggestie in-app + optioneel "open als PR"-knop

### vraag-docs-2
**Titel:** Welke docs-formaten ondersteunen?
**Samenvatting:** Alleen Markdown/Changelog, of ook OpenAPI/JSDoc/README auto-sync?
**Gedetailleerde uitleg:** Een minimale versie genereert alleen een changelog-entry in Markdown — simpel, universeel. Een uitgebreidere versie kan ook OpenAPI-specs bijwerken (als je een REST-API hebt), JSDoc-comments aanvullen, of de README syncen. Hoe meer formaten, hoe nuttiger — maar ook hoe groter de kans dat de AI iets fout "aanvult" in bestaande gestructureerde docs. Begin je smal of breed?
**Type:** keuze
**Opties:**
- a. Alleen Markdown CHANGELOG + release-notes (aanbevolen voor v1 van de module)
- b. Markdown + OpenAPI-spec update
- c. Volledig: alles bovenstaande + JSDoc + README-sync

---

## Module 3 — Failure Forensics Module

**Wat het doet:** analyseert historische `TicketEvent`-patronen (welke stageKind blijft vastlopen, welke vragen keren terug, welke files veroorzaken altijd conflicten) en presenteert bevindingen als gerangschikte `WorkspaceSuggestion`-kaarten — deterministisch, geen extra AI-sessie.

**Beslissingsvragen:**

### vraag-ff-1
**Titel:** Hoe vaak draait de analyse?
**Samenvatting:** Wekelijkse cron, per sprint, of on-demand?
**Gedetailleerde uitleg:** De Failure Forensics module kijkt terug op afgeronde tickets. Je kunt hem automatisch wekelijks laten draaien (dan heb je altijd een actueel beeld), aan het einde van een sprint (dan past het in je retrospective), of alleen wanneer je er zelf om vraagt. De analyse is puur rekenwerk (geen AI-sessie), dus kosten zijn laag in alle gevallen — het gaat meer over wanneer je de resultaten wilt zien.
**Type:** keuze
**Opties:**
- a. Wekelijks via cron (automatisch, weinig overhead)
- b. Aan het einde van een sprint via trigger (aanbevolen — past in retrospective-flow)
- c. On-demand via de Assistant of het command-palette

### vraag-ff-2
**Titel:** Op welk niveau worden patronen zichtbaar?
**Samenvatting:** Per workspace, per project, of per stagetype?
**Gedetailleerde uitleg:** De forensics-analyse kan patronen tonen op verschillende niveaus: over alle projecten in de workspace (breed beeld), per individueel project (meer relevant voor dat team), of per stageKind (bv. "de 'test'-stage loopt altijd vast bij Python-projecten"). Een breder beeld geeft meer context maar is ook moeilijker te verteren. Smal per project is concreter maar mist cross-project learnings.
**Type:** keuze
**Opties:**
- a. Per project (concreet, makkelijk te verteren — aanbevolen)
- b. Per workspace (breed, goed voor grotere teams)
- c. Per stageKind (technisch detail, beter voor platform-maintainers)

---

## Module 4 — Data Seeder & Migrations

**Wat het doet:** een module die database-migraties en seed-scripts beheert als CI-achtige jobs (via `PipelineRunner`), met AI-assistentie voor het genereren van seed-data op basis van Prisma-schema of ORM-models.

**Beslissingsvragen:**

### vraag-ds-1
**Titel:** Welke databases ondersteunen in v1 van de module?
**Samenvatting:** Alleen de databases die LuckyStack al kent, of stack-agnostisch vanaf dag 1?
**Gedetailleerde uitleg:** LuckyStack heeft al Prisma-integraties voor MongoDB, MySQL, PostgreSQL en SQLite. De module kan starten met alleen Prisma-projecten (dan werkt het meteen voor alle LuckyStack-gebruikers) of direct stack-agnostisch zijn (ook raw SQL, Django ORM, Entity Framework). Breder van het begin af aan klinkt goed, maar het betekent ook dat de module meer varianten moet ondersteunen — en dat kost meer bouw- en onderhoudstijd.
**Type:** keuze
**Opties:**
- a. Alleen Prisma (snel te bouwen, dekt alle native LuckyStack-projecten — aanbevolen voor v1)
- b. Prisma + raw SQL scripts
- c. Stack-agnostisch (Prisma, Django, EF, alles)

### vraag-ds-2
**Titel:** Mag de AI automatisch migratiecommando's uitvoeren?
**Samenvatting:** Migrations draaien na human approval, of mag de module ze zelf uitvoeren als de CI-job groen is?
**Gedetailleerde uitleg:** Een database-migratie is destructief als ze fout gaat (je kunt data kwijtraken). De veilige optie: de module genereert het migratiecommando als voorstel, en pas na jouw goedkeuring wordt het uitgevoerd. De snelle optie: als de CI-job slaagt (tests groen), runt de module de migratie automatisch. Automatisch is gemakkelijker maar veel risicovoller — je wilt dit niet per ongeluk op een productiedatabase.
**Type:** keuze
**Opties:**
- a. Altijd via `propose_suggestion` → menselijke goedkeuring (aanbevolen, veiligste)
- b. Automatisch na groene CI-gate, maar alleen op test/staging omgevingen
- c. Configureerbaar per omgeving (test=auto, prod=always-manual)

---

## Module 5 — Secrets / Credentials Vault

**Wat het doet:** een module-laag bovenop het bestaande `IntegrationTool`-model die per-module en per-workspace API-keys, tokens en geheimen beheert met secret-rotation, audit-log en per-stage ro/rw-tiers.

**Beslissingsvragen:**

### vraag-sv-1
**Titel:** Aparte module of uitbreiding van de bestaande Integrations-tab?
**Samenvatting:** Bouw een volwaardige Vault-module, of breid de bestaande Integrations-tab uit?
**Gedetailleerde uitleg:** De Workspaces-app heeft al een Integrations-tab (feature 04) waar je env-vars en API-keys per workspace kunt instellen. Een Vault-module voegt hieraan toe: geheimen per module scheiden, rotation bijhouden, audit-log tonen, en fijnmaziger controle. Maar als het bestaande model al 80% dekt, is een volwaardige aparte module misschien over-engineering. De vraag is of je de extra complexiteit van een apart module-concept (eigen nav-entry, eigen lifecycle) wilt betalen.
**Type:** keuze
**Opties:**
- a. Uitbreiding van de bestaande Integrations-tab (minder complex, sneller — aanbevolen als eerste stap)
- b. Aparte Vault-module met eigen UI, audit-log en rotation-support (meer capaciteit maar meer werk)
- c. Begin met (a), plan (b) zodra per-module API-keys nodig zijn door de multi-provider build

### vraag-sv-2
**Titel:** Secret rotation: automatisch of handmatig?
**Samenvatting:** Laat de module secrets zelf roteren, of alleen melden dat ze bijna verlopen zijn?
**Gedetailleerde uitleg:** Secret rotation betekent dat de module automatisch een nieuw geheim aanmaakt (bv. een nieuwe API-key bij een provider) en het oude invalideert — handig voor security, maar het vereist dat de provider dit ondersteunt en dat de module die API-aanroep mag doen. Een eenvoudiger alternatief: de module signaleert alleen "deze key verloopt over 14 dagen" via een notification, en jij regelt de rotation zelf. Automatische rotation is sterker maar veel meer werk om correct te bouwen.
**Type:** keuze
**Opties:**
- a. Alleen melden dat een secret bijna verloopt (notification), rotation is menselijk (aanbevolen voor v1)
- b. Automatische rotation voor ondersteunde providers
- c. Geen lifecycle-management in v1, alleen opslaan/ophalen

---

## Module 6 — On-Call / Incident Responder

**Wat het doet:** koppelt aan de OBSERVABILITY-laag en de WorkspaceTrigger-engine om bij een alert (container-boot failure, lease-loss, RAG-drift) automatisch een gestructureerde `WorkspaceSuggestion` te genereren met diagnose-stappen en een herstel-actie — een on-call runbook in de app.

**Beslissingsvragen:**

### vraag-oc-1
**Titel:** Diagnose automatisch of alleen tonen wat er mis is?
**Samenvatting:** Laat de module automatisch root-cause analyseren, of gewoon de alert met context tonen?
**Gedetailleerde uitleg:** De module kan twee niveaus van hulp bieden. Niveau 1: bij een alert toon je de alert-details + een link naar het relevante runbook-stuk — dit is puur informationeel en kost geen AI-sessie. Niveau 2: de module start een lichte AI-sessie die de logs analyseert, een root-cause schat, en een herstel-actie als `WorkspaceSuggestion` voorstelt. Niveau 2 is krachtiger maar verbruikt een subscriptie-beurt per incident.
**Type:** keuze
**Opties:**
- a. Alleen alert + runbook-link (geen AI, deterministisch — aanbevolen voor v1)
- b. Alert + deterministische diagnose (patroonherkenning op de `phase`-labels uit OBSERVABILITY) zonder AI-sessie
- c. Alert + AI root-cause + `WorkspaceSuggestion` herstel-actie (krachtigst, kost een AI-sessie per incident)

### vraag-oc-2
**Titel:** Moet de module ook buiten kantoortijd notificaties sturen?
**Samenvatting:** Push-notificaties bij critical alerts, ook 's nachts?
**Gedetailleerde uitleg:** De OBSERVABILITY-laag definieert al "critical alerts" (orchestrator down, lease-loss, container-boot failure). De vraag is of de On-Call module die als push-notificatie naar de beheerder stuurt — ook als die slaapt. Voor een zelfgehoste server die productie-kritisch is wil je dit misschien wel; voor een development-tool is het misschien overkill. De PWA-push-infrastructuur is al gebouwd (B-34), het is meer een beleidsv vraag.
**Type:** keuze
**Opties:**
- a. Alle critical alerts pushen, altijd (aanbevolen voor productie-gebruik)
- b. Alleen tijdens geconfigureerde "on-call uren"
- c. Geen push, alleen in-app notificaties (voor dev-only setups)

---

*Gegenereerd door Claude Sonnet 4.6 op 2026-06-14. Dit bestand is bedoeld als input voor de brainstorm-ronde over nieuwe modules; het legt geen locked decisions vast.*
