# Overall Strategy — Mijn mening, samenhang & volgorde

> Module-key: `overall-strategy` | Geschreven: 2026-06-14

---

## Mijn mening

**Sterkte van het concept**

De kern is sterk: een zelf-gehoste Jira-achtige dev-orchestratie-tool met AI vibe-coding, modulair uitbreidbaar, stack-agnostisch, draaiend op Max-subscription zonder metered API-kosten. Dat onderscheidt het duidelijk van GitHub Copilot Workspace / Devin / Cursor: de gebruiker beheert alles zelf, betaalt geen per-token rekening, en heeft volledige controle over de agent-configuratie per project.

Het bestaande ontwerp is ook solid: de container-runtime (07b), het Conductor-as-single-writer model (B-23), de frozen verb-surface, de QuestionSet/QuestionCard primitieven en de AgentRole plugin-API zijn stuk voor stuk goed doordachte bouwstenen. Ze zijn al gebouwd voor uitbreiding — `registerAgentRole()` + `registerArtifactViewer()` + `registerOrchestratorCommand()` zijn precies de plug-punten die de Designer Studio, Interviewer en Marketing module nodig hebben.

**Waar het wringt**

De vier modules die je noemt staan op heel verschillende afstand van wat al ontworpen is:

| Module | Afstand tot V1 | Kleur |
|---|---|---|
| **Interviewer** | Heel dichtbij — QuestionSet/draft_questionset/AIPanel zijn er bijna | Groen |
| **Designer Studio** | Middel — AgentRole-plugin bestaat; de skill-library en de vergelijkings-UI ontbreken | Oranje |
| **AI-management / multi-provider** | Ver — multi-provider is expliciet geparkeerd; schema-veld ontbreekt bewust | Rood |
| **Marketing** | Verst — geen media-artifacts, geen video-pipeline, geen Playwright-frame-pipeline | Rood |
| **Stack-agnostische Docker-image builder** | Middel — runtime bestaat, maar de AI-authoring-flow en image-registry ontbreken | Oranje |

De meest serieuze dreiging is **scope-explosie**: je noemt vijf conceptueel verschillende producten in één sentence. Als je die allemaal tegelijk probeert te bouwen voor V1, schip je niets. De gekste vergissing die je hier kunt maken is de multi-provider/API-key keuze per module als blocker opvoeren voor de Interviewer of Designer Studio — die modules werken prima met de bestaande Claude PTY.

**Wat ik zou aanbevelen**

Behandel "modules" als drie golven:

1. **Golf 1 (V1-extensie):** Interviewer module — past op bestaand QuestionSet + AIPanel, weinig nieuw infra
2. **Golf 2 (V1.5):** Designer Studio — nieuwe AgentRole + DesignViewer, nieuw skill-library scherm
3. **Golf 3 (V2):** Marketing module + multi-provider AI-management — fundamenteel nieuw mediatype, metered-API billing-split, Playwright MCP-integratie

De stack-agnostische Docker-image builder (de "zeg me wat stack, AI bouwt het") is een killer feature maar hoort bij Golf 2: de runtime is er al, je hebt alleen de AI-authored-Dockerfile-flow nodig met een propose→Admin-accept gate (al gelocked als verplicht in 07b_CONTAINER_RUNTIME.md §1.2).

**Waar ik een 'nee' zeg**

- **Multi-provider per module** in Golf 1 of Golf 2 inbouwen: dat vereist het toevoegen van `providerKey` aan `types.ts`, wat MULTI_PROVIDER_SEAM.md §4 expliciet verbiedt. Het metered-API vs subscription-PTY billing-split (split B in §3) is een fundamentele architecturele breuk die weken kost, niet een vinkje in de config-UI. Doe dit alleen als je écht een second backend hebt om de abstraction tegen te valideren.
- **Marketing module in V1**: video/thumbnail-generatie vereist een media artifact-type, een video viewer, Playwright MCP als production-tool (niet alleen als test-tool), en waarschijnlijk een metered image-generation API — dat is een compleet nieuwe productdimensie.
- **Module-installatie als "marketplace"** in V1: AgentRole-registratie is code-fixture-based (geen DB-migratie), wat juist goed is. Maar een install/uninstall UI voor modules is extra scope bovenop de modules zelf.

---

## Past op bestaande design

**Wat al bestaat en direct bruikbaar is:**

- `registerAgentRole()` in `03_AUTOMATION_AND_PLUGINS.md §3` is exact het plug-punt voor Designer Studio en Interviewer als nieuwe stage-types.
- `QuestionSet` + `QuestionCard` + `draft_questionset` verb (`02_PROTOCOL_AND_FLOW.md §5`, `features/09_QUESTIONS_IN_TICKETS.md`) zijn de bouwstenen voor de Interviewer Q&A UI. De one-question-per-screen mobile stepper is al volledig ontworpen.
- `WorkspaceSuggestion` met `propose_suggestion` verb (`03 §4`) kan de output van een Interviewer-sessie dragen als `type:'ai-suggestion'` items.
- `ArtifactViewerRegistry` (`03 §3.3`) laat elke nieuwe rol een eigen viewer registreren — de Designer Studio's `DesignViewer` en de Marketing module's `MediaViewer` passen hier zonder core-aanpassing.
- `IntegrationTool` entries + env-vars per workspace (`03 §5`) zijn het bestaande mechanisme voor derde-partij API-keys — een module die een externe API nodig heeft (bv. een image-generation provider) past hier in, zonder dat je een nieuw secret-management systeem nodig hebt.
- `WorkspaceTrigger` (`03 §1`) met `invoke-workspace-ai` action is al het mechanisme om een Interviewer-sessie te starten vanuit een event.
- `CapacityManager` (`07b_CONTAINER_RUNTIME.md §8`) deelt de budget al tussen alle containers — nieuwe modules die container-jobs draaien, erven dit gratis.

**Spanningen met gelocked beslissingen:**

- **Geen nieuwe verbs** (B-23 + frozen 7+6 surface): de Interviewer's "proactief vragen genereren" moet door bestaande verbs (`propose_suggestion` + `draft_questionset`) — dat is haalbaar maar vraagt creatief gebruik van de bestaande primitieven.
- **PTY-only billing** (V1_SCOPE §1): de Designer Studio en Marketing module die een metered image-API willen gebruiken (DALL-E, Runway, etc.) botsen hiermee. Die modules moeten of Claude PTY gebruiken of wachten op de multi-provider build.
- **Geen staande coordinator** (02_PROTOCOL_AND_FLOW.md §2): de Interviewer's proactieve projectscan kan niet een persisted LLM-sessie zijn; het moet een one-shot reasoner zijn (ephemeral, via `invoke-workspace-ai` action) die via `propose_suggestion` output wegschrijft.
- **No-new-verbs ook voor modules**: een "start interview" action moet als WorkspaceTrigger `run-command` met een OrchestratorCommandRegistry-key worden uitgedrukt, niet als een nieuw verb.
- **V1_SCOPE §4 expliciet deferred**: multi-provider, built-in CI, preview-deployments zijn bewust buiten V1. Marketing module leunt zwaar op zaken die V1 niet bouwt.

---

## Risico's

- **Scope-explosie**: vijf modules parallel starten is de veiligste manier om niets te shippen. Prioritering is niet optioneel.
- **Multi-provider als blocker opgevoerd**: als je besluit "de Interviewer mag pas gebouwd worden als we per-module provider-keuze hebben", blokkeer je maanden op een parked feature voor iets dat prima werkt met Claude PTY.
- **Billing-mode split onderschat**: het metered-API vs subscription-PTY split is geen config-toggle maar een architecturele breuk (MULTI_PROVIDER_SEAM.md §3 split B). Wie dit onderschat, bouwt een systeem dat de Max-subscription silent omzeilt — met billing-gevolgen.
- **"Module"-begrip wordt vaag**: als "module" soms een AgentRole is (Designer Studio als stage-type), soms een standalone screen (Interviewer panel), soms een provider-config-knop (AI management), en soms een media-pipeline (Marketing), is er geen coherent module-systeem maar vijf losse features met een gemeenschappelijk label.
- **Playwright MCP als production-tool**: de bestaande docs gebruiken Playwright voor development/testing (AI_BROWSER_TESTING.md). Het in de Marketing module gebruiken als production frame-capture tool is een fundamenteel ander use-case en heeft gevolgen voor sandboxing, egress-allow-list, en de CapacityManager (Playwright browser containers zijn zwaar).
- **Reverse proxy live-ticket visibility**: dit is volledig onontworpen als user-facing feature. De Caddy `@id`-routing bestaat voor per-ticket subdomains, maar de cross-device toegang met auth, RBAC op preview-URLs en mobile-reconnect zijn nergens gespecificeerd.

---

## Extra ideeën

### 1. "Module" als bundle van bestaande primitieven (niet een apart systeem)
In plaats van een apart module-registry systeem te bouwen, definieer een module als een gegroepeerde registratie: één `registerModule({role, viewer, command, triggerPresets, navEntry, settingsSchema})` die intern de bestaande registries aanroept. Dit geeft de installeerbare-module UX zonder nieuwe architectuur.

### 2. Proactieve projectscan als WorkspaceTrigger cron
De Interviewer module's "ga over mijn project en kom met ideeën" past perfect als een `WorkspaceTrigger` met `on:'cron'` + `action:'invoke-workspace-ai'`. De output van de one-shot reasoner wordt `WorkspaceSuggestion` items met `type:'ai-suggestion'`. Geen nieuw verb nodig, geen staande coordinator.

### 3. Designer Studio als "design preset tier"
In plaats van een volledig standalone Studio, voeg een 4e pipeline-tier toe naast simple/advanced/professional: `design`. De Design-tier heeft een `claude-design` AgentRole als eerste stage, gevolgd door code-stages. De vergelijking van design-skills wordt een multi-ticket-feature: maak drie tickets elk met een andere design-skill-bundle, bekijk ze naast elkaar op het board.

### 4. "Stack wizard" als Interviewer-flow
De "ik wil een C#/MySQL project" stack-authoring-flow is eigenlijk een Interviewer-sessie die een Dockerfile + StageProcess-commands + egress-allow-list genereert als `WorkspaceSuggestion` met een patch. De Admin accepteert, de Conductor voert uit. Geen nieuwe infra; de trust-gate (Admin-gated per 07b §1.2) is al gelocked.

### 5. Cross-module artifact handoff via PipelineRun artifact model
Als de Designer Studio een React-component genereert en de Marketing module die wil screenshotten, gebruik dan het bestaande artifact-model uit `BUILTIN_CI_PIPELINES.md §8` (artifact paths per PipelineRun). De modules hoeven niet te praten; ze lezen elkaars artifacts via de gedeelde storage.

### 6. Module-level spend chip
Het bestaande SpendRecord + budget-bar systeem (features/19_USAGE_AND_BUDGET.md) is per-ticket. Voeg een per-module spend-aggregatie toe als een gefilterde view over SpendRecord — geen nieuw data-model, alleen een nieuwe query + een module-chip in de Usage screen.

---

## Vragen

### V1 — Sequentieel vs simultaan
**Bouw je de modules één voor één of parallel?**

Je hebt vier modules bedacht. De vraag is of je ze één voor één zorgvuldig bouwt en ships (met echte gebruikers/feedback per module), of je ze tegelijk aanpakt. Tegelijk bouwen gaat sneller op papier maar leidt bijna altijd tot dat alles half af is en niets echt werkt.

*Opties:*
- **a) Serieel, één module tegelijk** (aanbevolen): Interviewer eerst, dan Designer Studio, dan pas Marketing/AI-management. Je ship vaker iets werkends.
- **b) Parallel met aparte AI-agents per module**: werkt als de modules echt onafhankelijk zijn (disjoint directories + frozen contracts), maar vereist strakke ownership en integration checkpoints.
- **c) Alleen de Interviewer voor V1, de rest is V2**: de kleinste correct shippende slice.

---

### V2 — Multi-provider: nu of later?
**Moet per-module provider-keuze een V1-feature zijn, of wacht je tot er écht een tweede provider is?**

Het bestaande ontwerp parkeert multi-provider bewust: er is nog geen tweede AI-backend om de abstractie tegen te valideren, en het toevoegen ervan nu is speculatieve complexiteit (MULTI_PROVIDER_SEAM.md §4). Maar jij wil per module een andere API-key kunnen kiezen.

De vraag is: welke module heeft nu écht een andere provider nodig die de Claude PTY *niet* kan bieden?

*Opties:*
- **a) Wacht op een echte tweede provider** (aanbevolen): bouw alle modules met Claude PTY. Pas als je een concrete metered API nodig hebt (bv. Runway voor video), open dan de multi-provider build.
- **b) Bouw multi-provider nu, gericht op één use-case**: bv. alleen voor de Marketing module + een image-generation API. Scope beperkt maar vereist wél het `providerKey`-veld in types.ts en de billing-split.
- **c) Gebruik IntegrationTool env-vars als workaround**: een module die een externe API nodig heeft, krijgt de API-key als workspace env-var (het bestaande mechanisme). Geen provider-abstractie, maar werkt voor enkelvoudige third-party calls.

---

### V3 — Wat is een "module" precies?
**Is een module een stage-type, een standalone scherm, of iets anders?**

Op dit moment ontbreekt er een definitie van wat een "module" is in dit systeem. De Interviewer is een standalone scherm buiten ticket-context. De Designer Studio is misschien een pipeline-stage-type. De Marketing module is een volledige media-productie-pipeline. Als je dit niet definieert, bouw je vijf losse features die allemaal "module" heten.

*Opties:*
- **a) Module = bundel van bestaande primitieven** (aanbevolen): een module is een `registerModule()` call die een AgentRole + viewer + nav-entry + settingsSchema groepeert. Geen nieuw systeem, alleen een naamgevings-conventie.
- **b) Module = installeerbaar pakket**: modules zijn npm-packages die je installeert (zoals `@luckystack/*`). Krachtig maar vereist een module-registry + install-flow die zelf ook scope is.
- **c) Module = gewoon een feature-flag per workspace**: een boolean per workspace die bepaalt of een scherm/tab zichtbaar is. Simpelst, maar geeft je geen herbruikbare module-structuur voor toekomstige modules.

---

### V4 — Interviewer: reactief of proactief?
**Vraagt de Interviewer module vragen als reactie op iets, of gaat hij zelf proactief over het project nadenken?**

Het bestaande QuestionSet-mechanisme is reactief: de AI is geblokkeerd op een taak en stelt vragen om door te kunnen gaan. De Interviewer die jij beschrijft is anders: de gebruiker zegt "ga over mijn project en kom met ideeën" en de AI genereert een hele set vragen/ideeën proactief — niet geblokkeerd, niet ticketgebonden.

Dit zijn twee verschillende interactiemodellen met andere implementaties.

*Opties:*
- **a) Proactief als one-shot reasoner** (aanbevolen): een `invoke-workspace-ai` trigger start een ephemeral AI-sessie die de codebase scant en een batch `WorkspaceSuggestion`-items genereert met title/summary/detailed-summary. De gebruiker bladert er doorheen als een inbox.
- **b) Proactief als async interview-sessie**: de AI stelt vragen asynchroon, de gebruiker beantwoordt in zijn eigen tempo over meerdere dagen. Vereist een nieuw "interview session" lifecycle naast de bestaande QuestionSet (die een blokkerende agent-hold is).
- **c) Reactief uitbreiden**: de bestaande QuestionSet uitbreiden met rijkere itemtypen (title/summary/detailed-summary, a/b/c/d opties). Geen nieuw lifecycle, wel een schema-uitbreiding.

---

### V5 — Designer Studio: stage-type of standalone product?
**Is de Designer Studio een fase in een bestaande pipeline, of een apart product naast de pipeline?**

De Designer Studio zou als stage-type (via `registerAgentRole()`) in een bestaande pipeline passen: Refine → **Design** → Implement. Maar je beschrijft ook een rijke UI met template-bibliotheek, skill-vergelijking en een eigen workflow — dat klinkt meer als een standalone applicatie.

*Opties:*
- **a) Stage-type in de pipeline** (aanbevolen voor V1): de Design stage genereert UI-varianten als artifacts, de gebruiker kiest, de volgende stage implementeert. Geen aparte UI, past op bestaand framework.
- **b) Standalone studio naast de pipeline**: een eigen scherm in de navigatie met een design-canvas, template-bibliotheek en vergelijkingsmode. Meer UX-werk, maar rijkere ervaring.
- **c) Hybride**: standaard als stage-type gebouwd, met een eigen "Studio" view als je een design-artifact opent. De stage en de viewer zijn het product.

---

### V6 — Stack-agnostische Docker-image builder: V1 of later?
**Is de "zeg je gewenste stack, AI bouwt het Docker-image" een V1-feature of V2?**

De container-runtime ondersteunt al willekeurige Docker-images. Wat ontbreekt is de flow waarbij een AI een Dockerfile genereert, de Admin die accepteert, en de orchestrator hem bouwt. Dit is technisch haalbaar op de bestaande infra, maar vereist een propose→review→build→deploy UX die nu niet ontworpen is.

*Opties:*
- **a) V1: alleen de propose-flow** (aanbevolen): de AI genereert een Dockerfile als `WorkspaceSuggestion` met patch. De Admin accepteert, kopieert het naar `.workspaces/Dockerfile`, en de bestaande build-flow pakt het op. Minimal new design.
- **b) V1.5: geïntegreerde wizard**: een "Maak een nieuw project" wizard vraagt naar stack, genereert Dockerfile + StageProcess-config + egress-allow-list als één samenhangende proposal. Meer scope maar betere UX.
- **c) V2: pas als image-registry gebouwd is**: wacht tot er een self-hosted container registry is (Harbor, etc.) zodat gegenereerde images versiebeheerd worden. Meest compleet maar langst.

---

### V7 — Marketing module: in scope of bewust buiten scope?
**Wil je de Marketing module (video/thumbnails/posters) écht als een module van dit product, of is het een apart idee voor later?**

De Marketing module vereist fundamenteel andere technologie dan de rest: video-generatie APIs (metered, niet PTY), Playwright als production frame-capture tool (niet alleen testing), media-artifact types, video-viewer. Het past niet op de bestaande V1 of V1.5 infra zonder significante uitbreiding.

*Opties:*
- **a) Bewust buiten scope, noteer als V3** (aanbevolen): documenteer het idee, maar start er pas aan als de Interviewer en Designer Studio draaien en de multi-provider seam gebouwd is.
- **b) Alleen de "codebase-context naar marketing-copy" variant**: een lichtere versie waarbij Claude PTY marketing-tekst, social posts, en beschrijvingen genereert op basis van codebase-context — geen video, geen Playwright. Past op V1 als AgentRole.
- **c) Full scope, parallel met andere modules**: hoog risico op scope-explosie, maar als je de resources hebt voor een aparte agent-team, mogelijk.

---

### V8 — Live-ticket visibility across devices: hoe urgent?
**Hoe hoog prioriteer je dat live tickets van andere apparaten direct zichtbaar zijn via de reverse proxy?**

De Caddy `@id`-routing bestaat al voor per-ticket subdomains. Maar de cross-device toegang — iemand op zijn telefoon die de live terminal van een ticket op zijn laptop kan zien — vereist authenticatie op het subdomain-niveau, RBAC op preview-URLs, en de juiste TLS/DNS-configuratie voor externe toegang. Dit is nu onontworpen als user-facing feature.

*Opties:*
- **a) V1 basis: alleen via de main app** (aanbevolen): de realtime sync (Socket.io rooms + subscribe-first) zorgt al dat alle browsers die ingelogd zijn live updates zien. Geen subdomain-toegang voor externe devices nodig voor V1.
- **b) V1 uitbreiden: Caddy + RBAC op preview-subdomains**: de term-subdomain + vscode-subdomain zijn per-ticket en auth-gated. Documenteer de self-host DNS/TLS stappen expliciet zodat externe devices er bij kunnen.
- **c) V2: tunnel/VPN aanbeveling**: documenteer een aanbevolen self-host setup (Tailscale, Cloudflare Tunnel) zodat externe devices via een beveiligde tunnel bij de Workspaces-instantie kunnen.

---

### V9 — Modules system: opt-in per workspace of globaal aan/uit?
**Kunnen gebruikers modules per workspace in- of uitschakelen, of zijn modules globaal voor de hele instantie?**

Als de Interviewer module aan staat, wil elke workspace er dan gebruik van maken? Of moet een Admin per workspace kiezen welke modules actief zijn? Dit heeft gevolgen voor hoe je module-configuratie opslaat en hoe de navigatie werkt.

*Opties:*
- **a) Globaal aan/uit per installatie** (aanbevolen voor V1): een module is aan of uit voor de hele Workspaces-instantie. Simpelste implementatie, past op de code-fixture WorkspacePreset.
- **b) Per workspace opt-in**: elke workspace heeft een eigen lijst van actieve modules. Flexibeler maar vereist een `WorkspaceModule` DB-row + een enable/disable control-API op.
- **c) Per workspace met defaults**: globale defaults op instantie-niveau, overschrijfbaar per workspace. Meest flexibel, meest complex.

---

### V10 — Mijn aanbevolen volgorde: ben je het ermee eens?
**Klopt de sequentie Interviewer → Designer Studio → AI-management → Marketing voor jou?**

Op basis van de analyse hierboven is dit de volgorde die het minste bestaande locked decisions breekt, het snelste iets shippables oplevert, en het best op bestaande infra past. Maar misschien heeft de Designer Studio voor jou hogere prioriteit, of wil je marketing juist eerder.

*Opties:*
- **a) Interviewer → Designer Studio → Marketing → AI-management**: progressief in complexiteit; AI-management wordt pas gebouwd als er een echte tweede provider is.
- **b) Designer Studio → Interviewer → AI-management → Marketing**: als visuele UI-generatie meer waarde heeft dan de Q&A flow.
- **c) Interviewer → AI-management → Designer Studio → Marketing**: als het zelf kiezen van providers een vroege enabler is voor andere modules.
- **d) Alleen Interviewer voor V1, rest is open**: minimale scope, maximale kans op ship.
