# AI-management — per-module provider / API-key selectie

> Gegenereerd: 2026-06-14. Onderdeel van de Workspaces modules-brainstorm.

---

## Mijn mening

Dit is het meest gelaagde — en gevaarlijkste — van de voorgestelde modules, want het raakt direct aan twee LOCKED beslissingen die de economische basis van het hele systeem vormen.

**Wat er sterk aan is:** het idee klopt intuïtief. Je wilt voor creatief/design werk misschien een goedkope beeldgeneratie-API gebruiken, terwijl de codeer-pipeline op de Max-subscription loopt. Dat is een volledig legitiem gebruik. De infrastructuur om dit netjes te bouwen is ook al in de startblokken gezet: `MULTI_PROVIDER_SEAM.md` documenteert exact hoe de toekomstige seam eruit ziet, en de `launchEngineSession()` single-spawn wrapper is het insurancemove dat één callsite maakt van het refactoren.

**Wat er zwak aan is:** de spanning met de LOCKED PTY-billing constraint is echt, niet theoretisch. Elke Claude-sessie moet een interactieve PTY zijn met een schone omgeving — geen `ANTHROPIC_API_KEY` zichtbaar, geen headless. Zodra je een "per-module provider key" introduceert, kun je twee werelden krijgen die je niet in één boekhoudingmodel kunt stoppen: abonnement-PTY (advisory budget, quota is het echte plafond) en metered-API (hard pre-flight gate per call). `MULTI_PROVIDER_SEAM.md §3 split B` noemt dit letterlijk "cannot be unified". Dat is de kern van het probleem.

**Mijn eerlijke oordeel:** dit is een HORIZON-feature voor zover het Claude-sessies betreft. Voor de codeer-pipeline, de Interviewer, en alles wat op de Max-subscription draait: geen nieuwe provider-configuratie nodig in V1. Maar voor modules die helemaal NIET op de Claude-subscription draaien — een Designer Studio die een third-party image-generatie API aanroept, of een Marketing module die een video-API gebruikt — hoef je helemaal niet de multi-provider seam open te gooien. Dat zijn gewoon IntegrationTool-rijen met een API key in de secret store, precies zoals een database-credential werkt (B-O8 tier). Dát stuk kun je nu al bouwen.

De slimste aanpak: splits het concept in tweeën. (1) Third-party API keys voor non-AI-tooling of niet-subscription-AI (image API, video API, etc.) → nu bouwen als uitbreiding van de bestaande IntegrationTool + secrets-tier. (2) Per-module Claude-provider selectie (welk model/tier per stage) → nu al gedeeltelijk te doen via `StageModelTier` per stage, geen extra werk. (3) Écht een andere AI-provider dan Claude per module → wachten op de parked multi-provider build.

---

## Past op bestaande design

### Wat er al is

- **IntegrationTool + EnvVar tier model** (`03_AUTOMATION_AND_PLUGINS.md §5`): third-party API keys voor modules passen hier al in. Een `OPENAI_API_KEY` voor een Design module of `RUNWAY_API_KEY` voor Marketing is gewoon een `IntegrationTool` met `ro`-tier en een env-var injectie in de container. De per-stage toewijzing (`rw`/`ro` select, B-O8) werkt identiek.

- **`launchEngineSession()` single-spawn wrapper** (`MULTI_PROVIDER_SEAM.md §4`): de enige V1-actie op dit vlak. Eén callsite, één Claude-implementatie, geen EngineDriver-interface. Dit is de verzekering voor de toekomstige refactor.

- **`StageModelTier` en `StageEffort`** (`MULTI_PROVIDER_SEAM.md §2.3`): per-stage model-tier selectie (haiku/sonnet/opus) en effort-niveau zijn al schema-velden op `PipelineStageCfg`. "Welk Claude-model per module-stage" is al opgelost — dat is de enige form van per-module provider-selectie die je in V1 mag bouwen.

- **Advisory budget + SpendRecord** (`features/19_USAGE_AND_BUDGET.md`, `MULTI_PROVIDER_SEAM.md §8`): het huidige budget is bewust advisory (abonnement-PTY). Een metered-API module zou een hard pre-flight gate nodig hebben (`blockTurn` voor elke call). Die twee modellen zijn incompatibel in één `WorkspaceBudget`-schema — bevestigd in `MULTI_PROVIDER_SEAM.md §3 split B`.

- **AgentRole.needsWorkspace** (`03_AUTOMATION_AND_PLUGINS.md §3.2`): rollen met `needsWorkspace:false` (reasoning, design, plan) draaien als lightweight host-side sessies, niet in een container met worktree. Een module die een third-party API aanroept in plaats van een Claude PTY te spawnen kan dat doen via een `needsWorkspace:false` rol met een `run-command` OrchestratorCommandRegistry-actie — geen nieuwe verbsurface.

- **Twee hard forward-compat constraints** (`MULTI_PROVIDER_SEAM.md §7`): (A) elke toekomstige adapter exposeert alleen read/propose verbs als model tools; (B) de Claude-spawn heeft een schone env — ANTHROPIC_API_KEY mag nooit aanwezig zijn. Dit zijn de wachten-op het-moment-dat-je-écht-een-tweede-provider-hebt constraints die nu al in de seam zijn ingebakken.

### Spanning met LOCKED beslissingen

| Beslissing | Spanning |
|---|---|
| **Interactive PTY on Max subscription — de enige Claude-engine (01_ARCHITECTURE.md §1, MULTI_PROVIDER_SEAM.md §0)** | Per-module Claude-provider is in conflict met het "één provider per workspace" default. Niet bouw-klaar in V1. |
| **Advisory budget alleen (features/19, MULTI_PROVIDER_SEAM.md §3 split B)** | Metered-API modules vereisen een hard pre-flight gate, niet een advisory cap. Die twee zijn in V1 niet te verenigen. |
| **Geen `providerKey` in types.ts in V1 (MULTI_PROVIDER_SEAM.md §4/§6)** | Per-module provider-selectie vereist een `providerKey`-veld op `PipelineStageCfg` of `Workspace`. Dat is explicitly verboden in V1. |
| **Per-workspace single-provider is de decided default (MULTI_PROVIDER_SEAM.md §9)** | Per-module provider-selectie is de "per-stage advanced opt-in" variant die als risico wordt benoemd (carry-over quality, model-ladder incomparability). |

---

## Risico's

- **Billing-mode collision:** als je een abonnement-PTY-module en een metered-API-module in dezelfde workspace hebt, kunnen ze niet één `WorkspaceBudget` model delen. Je hebt twee verschillende handhavingsregimes nodig. Dit is niet iets wat je achteraf kunt oplossen met een vlag.

- **Schone env-regel per ongeluk breken:** als de per-module credential-injectie niet strikt per-adapter wordt gegate, kan een `ANTHROPIC_API_KEY` in de omgeving van een Claude-PTY terechtkomen. Dat schakelt stille metering in (`01_ARCHITECTURE.md §1` caveat). Dit is de concrete veiligheidsregel die `MULTI_PROVIDER_SEAM.md §7 Constraint B` omschrijft.

- **Carry-over kwaliteitsdegradatie bij gemengde providers:** als een Design-module op provider X draait en de volgende pipeline-stage op Claude, is de carry-over envelope quality onbekend. `MULTI_PROVIDER_SEAM.md §9` benoemt dit als een geaccepteerd risico van per-stage selectie — maar geen enkel validatie-mechanisme is ontworpen.

- **Secret management voor module-level third-party keys:** `@luckystack/secrets` is P4. V1 gebruikt app-owned encryption + stack secret store. Een module die zijn eigen API-key nodig heeft (bv. een video-generatie API) heeft geen ontworpen key-management voorbij het generieke B-O8 DB-credential tier model.

- **`StageModelTier` is Claude-vocabulaire:** haiku/sonnet/opus is een Claude-ladder die niet naar andere providers mapt. Als je meerdere providers introduceert, moet je `StageModelTier` vervangen door een provider-agnostische capability registry — dat is de expliciete deferred build in `MULTI_PROVIDER_SEAM.md §6 Q-MP-CAPREG`.

- **Gebruikersverwarring over twee soorten "AI provider":** de gebruiker wil "voor de design-tool API-key van X". Maar Claude CLI instanties voor de pipeline zijn geen API keys — dat is een OAuth-login op een Max-subscriptie. Als de UI dit niet scherp onderscheidt, verwacht je dat gebruikers een Claude API key invoeren voor iets wat helemaal niet via API-key werkt.

---

## Extra ideeën

### 1. "Non-AI third-party tool"-tier als eerste stap

Introduceer een apart tier in de IntegrationTool-configuratie: onderscheid `ai-provider` (Claude, toekomstige API providers) van `external-service` (image API, video API, search API). De `external-service` keys worden injected als gewone env vars in de container van de relevante AgentRole. Dit is nu al mogelijk via het B-O8 tier model en vereist geen multi-provider seam.

### 2. Provider-capabilities display (alleen lezen, geen keuze)

Toon in de workspace-instellingen welk Claude model-tier elke stage gebruikt (`StageModelTier`), met een advisory note over de abonnementslimiet en een link naar de huidige quota-probe status (Addition 13). Dit geeft gebruikers inzicht zonder dat je een provider-switchmechanisme bouwt.

### 3. Per-module spend-attribuering

Uitbreiding op het bestaande SpendRecord-model: voeg een `moduleKey`-veld toe aan SpendRecord zodat de Usage-screen kosten per module kan tonen (codeer-pipeline vs. design-module vs. marketing). Dit vereist alleen een extra veld op een bestaand model, geen nieuwe billing-logica.

### 4. API-key vault als standalone module

In plaats van per-module API-key configuratie te verstrengelen met de provider-seam, bouw een dedicated "Secrets Vault" module (die `@luckystack/secrets` vervangt als het die P4-status haalt). Deze module beheert alle third-party API keys — AI of niet — met per-workspace scoping, audit logging, en een eenvoudige "koppel aan deze AgentRole" interface.

### 5. Provider-health dashboard

Een eenvoudig dashboard dat per geconfigureerde provider (Claude quota, third-party API rate limits) de actuele status toont — gebaseerd op de quota-probe (Addition 13) voor Claude en polling van health endpoints voor externe services. Goedkoop te bouwen boven op bestaande infrastructure.

---

## Vragen

### Vraag 1 — Scope van "per-module provider"

**Samenvatting:** wat bedoel je precies met "per-module een andere provider"?

**Uitgebreide uitleg:** Er zijn twee heel verschillende dingen die je bedoelt kunt hebben. Optie 1: je wilt voor elke module een andere *externe dienst* kunnen aanroepen — zoals een afbeelding-generatie-API voor de Design module of een video-API voor Marketing. Dat is al bijna mogelijk met het bestaande systeem (credentials als omgevingsvariabelen). Optie 2: je wilt dat de Design module gebruik maakt van een ander *AI-bedrijf* dan Anthropic, bijvoorbeeld OpenAI, en dat de pipeline-module gebruik blijft maken van Claude. Dat tweede vereist een fundamentele architectuurwijziging die nog niet gebouwd is en ook bewust geparkeerd is. De vraag is: welk van de twee — of allebei?

**Opties:**
- **a. Alleen externe diensten (niet-AI of metered-AI-APIs) per module configureerbaar** — nu te bouwen, geen architectuurwijziging. Aanbevolen voor V1.
- **b. Andere AI-provider per module (bijv. OpenAI voor Design)** — vereist de parked multi-provider build. Maanden werk, echte risico's.
- **c. Allebei, maar gefaseerd** — externe diensten nu, AI-providers later als de seam er is.

---

### Vraag 2 — Wat doe je met het budget-model als je metered-API modules hebt?

**Samenvatting:** abonnements-budget en metered-API-budget kunnen niet in één model leven — kies je aanpak.

**Uitgebreide uitleg:** De huidige budgetbalk in Workspaces is "advisorisch" — het is een schatting, want bij een Max-abonnement is de echte limiet je abonnementsquota, niet een eurobedrag. Maar als je een module toevoegt die per API-call betaalt (een image-API, een video-API), dan heb je *exacte* kosten per aanroep. Die twee modellen zijn fundamenteel anders: het ene is een soft-limit op basis van quota, het andere is een hard-gate op basis van kosten. Je kunt ze niet in één budgetscherm samensmelten zonder verwarring. Hoe wil je dit oplossen?

**Opties:**
- **a. Aparte budgetweergave per billing-type** — één balk voor abonnements-AI, een aparte balk per externe dienst. Complexer UI, maar eerlijk.
- **b. Externe diensten buiten het Workspaces-budgetsysteem houden** — de gebruiker configureert limieten direct bij de externe dienst. Eenvoudigste oplossing.
- **c. Unified spend-view, aparte enforcement** — alles tonen in één Usage-scherm, maar handhaving per billing-type anders. Meeste werk.

---

### Vraag 3 — Wie mag API-keys configureren?

**Samenvatting:** welke RBAC-rol heeft toegang tot het instellen van third-party API keys?

**Uitgebreide uitleg:** In het huidige systeem zijn er drie rollen: Owner, Admin, en Member. Workspace-instellingen (budget, integraties) zijn Owner/Admin-gated. Maar als elke module zijn eigen API-keys kan hebben, ontstaat de vraag: mag een Admin de Design-module een API-key geven zonder dat de Owner het goedkeurt? En mag een Member zien welke keys geconfigureerd zijn (zonder de waarden te zien)? Dit is puur een zakelijke/organisatorische beslissing, geen technische.

**Opties:**
- **a. Owner only** — enkel de workspace-eigenaar kan module-API-keys instellen. Veiligst, minst flexibel.
- **b. Owner + Admin** — Admin mag ook keys instellen. Consistent met de huidige budget-RBAC (B-28). Aanbevolen.
- **c. Per-module configureerbaar** — de Owner stelt in wie per module keys mag instellen. Meest flexibel, meeste complexiteit.

---

### Vraag 4 — Wil je Claude model-tier keuze per module (nu al mogelijk)?

**Samenvatting:** per module een ander Claude-model (haiku vs. sonnet vs. opus) instellen kan nu al — is dat voldoende als eerste stap?

**Uitgebreide uitleg:** Het systeem heeft al een `StageModelTier`-veld per pipeline-stage: je kunt nu al zeggen "de Refine-stage gebruikt haiku (goedkoop) en de Code-stage gebruikt opus (krachtig)". Als je een Interviewer-module als aparte AgentRole registreert, kan je die ook een eigen `StageModelTier` geven. Dat is geen andere provider, maar het is wél een kosten/kwaliteit-keuze per module. De vraag is: is dit al voldoende voor wat je nu wil, of heb je echt een andere provider nodig?

**Opties:**
- **a. Ja, model-tier per stage is voldoende voor nu** — slim startpunt, nul extra bouwwerk. Aanbevolen als tussenoplossing.
- **b. Nee, ik wil ook een andere API-key (maar nog steeds Claude)** — bv. een andere Claude-account per module. Vraagt om extra credential-isolatie die nu niet ontworpen is.
- **c. Nee, ik wil een volledig andere provider** — zie vraag 1b/2 hierboven.

---

### Vraag 5 — Moet de gebruiker de provider-configuratie zien in de module-UI, of in workspace-settings?

**Samenvatting:** waar hoort de "welke AI gebruik ik voor deze module" instelling thuis in de UI?

**Uitgebreide uitleg:** Je hebt twee keuzes: elke module heeft zijn eigen instellingenpagina met een provider-configuratie ("Designer Studio > Instellingen > AI provider"). Of alles zit op één plek in de workspace-instellingen ("Settings > AI providers > koppel aan module"). Het eerste is intuïtiever voor de eindgebruiker ("ik ga naar mijn module"), het tweede is veiliger en consistenter voor beheerders die alles op één plek willen controleren. Hoe meer modules je hebt, hoe groter dit architectonische keuze-effect.

**Opties:**
- **a. Per-module instellingenpagina** — elke module heeft zijn eigen settings-tab. Intuïtief voor gebruikers, versnipperd voor admins.
- **b. Gecentraliseerd in workspace settings** — alle provider/key configuratie op één plek. Beter voor security-review, minder context-switching.
- **c. Beide** — module-settings toont de actieve configuratie, workspace-settings is de authoritative bron. Meeste consistentie, meeste bouwwerk.

---

### Vraag 6 — Hoe transparant wil je zijn over kosten van externe (niet-Claude) AI-aanroepen?

**Samenvatting:** wil je dat Workspaces bij houdt wat externe API-aanroepen kosten, of laat je dat aan de externe dienst over?

**Uitgebreide uitleg:** Als de Designer Studio een image-generatie API aanroept per design-skill-run, kost dat geld buiten je Claude-abonnement. Je kunt er voor kiezen om die kosten te tonen in het Usage-scherm van Workspaces (vereist dat de module zijn kosten rapporteert), of je laat de gebruiker gewoon de factuur van de externe dienst bekijken. Het eerste geeft een completer beeld ("deze ticket kostte €12 Claude + €3 Runway"), het tweede is veel eenvoudiger te bouwen.

**Opties:**
- **a. Externe kosten tonen in het Usage-scherm** — via een `moduleKey` + `externalCost`-veld op SpendRecord. Volledig plaatje, meer bouwwerk.
- **b. Externe kosten buiten Workspaces houden** — de gebruiker bekijkt externe facturen zelf. Eenvoudigst, minder overzicht.
- **c. Alleen tonen als de externe dienst een usage-API heeft** — optioneel, module-specifiek. Flexibel maar inconsistent.

---

### Vraag 7 — Wat is de fallback als een module-provider niet beschikbaar is?

**Samenvatting:** wat moet er gebeuren als een externe API down is of de quota overschreden is?

**Uitgebreide uitleg:** Als de Designer Studio een image-API aanroept en die dienst is even down, of de API-quota voor die maand is op — wat moet Workspaces doen? Automatisch terugvallen op een alternatieve provider? De module pauzeren en de gebruiker notificeren? Of de taak gewoon laten falen en in de ticket-log zetten? Dit is een productbeslissing die bepaalt hoe robuust en hoe complex je het systeem wil maken.

**Opties:**
- **a. Fail-fast met notificatie** — de stage mislukt met een duidelijke foutmelding, de gebruiker krijgt een notificatie. Eenvoudig, eerlijk.
- **b. Automatische fallback naar een alternatieve provider** — als geconfigureerd, wissel je van provider. Complex, maar robuust.
- **c. Module-specifiek configureerbaar** — elke module definieert zijn eigen fallback-gedrag. Meest flexibel, meeste overhead.

---

### Vraag 8 — Wil je een centrale "AI-management" navigatieoptie, of per-module ingebakken?

**Samenvatting:** is AI-management een eigen scherm in de navigatie, of is het onderdeel van elk module-instellingenscherm?

**Uitgebreide uitleg:** Je hebt twee architectonische keuzes voor hoe de AI-provider-configuratie in de sidebar leeft. Optie 1: er is een apart "AI management"-scherm in de workspace-sidebar (naast Board, Pipeline, Sources, etc.) waar je alle providers en API-keys beheert. Optie 2: de instellingen leven verborgen in de module-instellingen of workspace-settings, zonder eigen navigationspunt. Het eerste maakt AI-beheer een "first-class" feature van het product, het tweede is subtieler maar ook moeilijker te vinden.

**Opties:**
- **a. Apart "AI management"-navigatiepunt** — zichtbaar in de sidebar, hoge prominentie. Past bij de ambitie van het product.
- **b. Onderdeel van workspace-settings** — zit verstopt in een tab, maar consistent met andere admin-instellingen. Aanbevolen voor V1.
- **c. Per-module ingebakken** — elke module toont zijn eigen AI-config in zijn eigen settings. Gedistribueerd, maar intuïtief.
