# Designer Studio — module analyse

> Gegenereerd: 2026-06-14. Onderdeel van de Workspaces modules-brainstorm.

---

## Mijn mening

De Designer Studio is het sterkste van de drie voorgestelde modules, omdat het een concreet, afgebakend probleem oplost: een AI die UI-code genereert produceert *iets* — maar je weet niet of het bij je designsysteem past, of of de uitkomst er beter uitziet dan een alternatief. De vergelijk-N-varianten-flow is het echte onderscheidende idee. Dat is origineel en praktisch.

Waar het zwak is: "design skill" is vooralsnog een vaag begrip. Als dat alleen een promptvariant is, is de studio niets meer dan een A/B-test over prompts — slim, maar niet echt een "studio". De kracht zit hem in het koppelen van drie dingen: een promptvariant, een concrete design-token set (kleurvariabelen, typografie, ruimte), en optioneel referentie-afbeeldingen of componentconventies. Alleen de combinatie van die drie maakt een skill herkenbaar als een echte designstijl.

Het risico dat ik zie: de "vergelijk N varianten in parallel" flow botst met het CapacityManager-budget (07b_CONTAINER_RUNTIME.md §8). N parallelle Stage-Agent PTY-sessies trekken uit dezelfde pot als worker-tickets. Dit is geen showstopper, maar je moet bewust kiezen hoeveel varianten tegelijk je toestaat — of een preview-cap instellen die lager ligt dan de werkbudget-cap.

De live-edit loop die ik verwacht bij zo'n studio (klik op een component, zeg "maak de knop ronder") ontbreekt volledig in de huidige docs en zou verreweg het meeste bouwwerk vereisen. Ik zou dat buiten de V1-scope van de module houden.

Alles bij elkaar: dit is een goede module als je de scope scherp houdt. Zet de vergelijk-N-flow en de skill-bibliotheek centraal. Houd de live-edit loop buiten V1. Definieer "design skill" concreet (zie vraag 1).

---

## Past op bestaande design

De Designer Studio past verrassend goed in het bestaande corpus. De bouwstenen zijn er bijna allemaal al; het ontbreekt aan de Designer-Studio-specifieke invulling ervan.

**Wat er al is en direct herbruikt wordt:**

- **AgentRole plugin model** (`03_AUTOMATION_AND_PLUGINS.md §3`): `registerAgentRole({ key:'design', needsWorkspace:false, artifactKind:'design', ... })` is letterlijk uitgewerkt als walkthrough in §7. Nul core changes nodig.
- **ArtifactViewerRegistry** (`03_AUTOMATION_AND_PLUGINS.md §3.3`): `registerArtifactViewer('design', lazy(...))` geeft de DesignViewer zijn plek in TicketDetail. FileDiffViewer is de fallback; dat blijft intact.
- **Skills/MCP tab in Sources** (`features/15_SOURCES_MANAGEMENT.md`): design-skills landen hier als SkillEntry-rijen met frozen/live badge, toggle per stage, en detail-popover. Geen nieuwe infrastructuur.
- **Prompt versioning + A/B** (`AI_QUALITY_AND_EVALS.md §4–§5`): elke design skill is een PromptVersion. De A/B-split + feedback-loop (PromptFeedback → few-shot bank) werkt per workspace identiek voor design als voor code.
- **WorkspaceSuggestion** (`03_AUTOMATION_AND_PLUGINS.md §4`, CONTROL_API §8): gekozen design-variant kan als suggestion worden gepresenteerd met een appliable patch — de infra is er.
- **Preview deployment** (`features/23_PREVIEW_DEPLOYMENT.md`): per-ticket `dev-<ticketId>.<domain>` subdomain. De vergelijk-N-flow kan varianten tonen als preview-links per variant naast de diff-viewer.
- **WorkspaceTrigger** (`03_AUTOMATION_AND_PLUGINS.md §1`): `{ on:'stage.on_approval', action:'start-stage' }` wikkelt de design-stage in de pipeline zonder core changes.
- **Design tokens** (`design-reference/DESIGN_TOKENS.md`, `design-reference/CLAUDE_DESIGN_FEATURE_COMPLETION.md §Foundations`): de token set is het toepassen van een design skill — de skill omschrijft welke tokens, in welke waarden, met welke naamconventies.

**Spanningen met locked decisions:**

- **CapacityManager shared budget** (07b_CONTAINER_RUNTIME.md §8, LOCKED): N parallelle design-agents trekken uit dezelfde pot als worker-tickets. previewConcurrencyCap is al een sub-limiet, maar die gaat over preview-containers, niet over design-agent-sessies. Je hebt een expliciete `designConcurrencyCap` nodig, of je accepteert dat een vergelijk-4-varianten-run 4 slots eet en je production agents verdringt. Dit moet een bewuste keuze zijn.
- **Per-module AI provider** (MULTI_PROVIDER_SEAM.md §4, LOCKED): `providerKey` bestaat niet in types.ts in V1. Als de Designer Studio een eigen API-key of provider wil (bv. een ander model voor visuele generatie), botst dat met de V1-beslissing. Je kunt er wel omheen: kies een andere `StageModelTier` per design-stage, binnen het enkele Claude-account. Volledig andere provider = parked.
- **Geen nieuwe verbs** (`02_PROTOCOL_AND_FLOW.md §2`, LOCKED): de design-agent emit via `emit_output` met een design-specifieke outputSchema. Geen `emit_design_variant` of vergelijkbare toevoeging. Dit dwingt je om de variant-selectie via de bestaande WorkspaceSuggestion + accept-flow te routeren — wat eigenlijk prima werkt.
- **B-23: AI proposeert, Conductor schrijft** (LOCKED): de gekozen variant wordt pas in de repo gezet nadat de gebruiker accept heeft gedrukt. Dat past zelfs goed bij een studio-workflow.
- **needsWorkspace:false voor reasoning-rollen** (LOCKED): een design-agent die *alleen* prompts + token-definities schrijft heeft geen worktree nodig. Maar als de design-agent ook component-code schrijft (React + Tailwind), dan `needsWorkspace:true`. Dit is de scherpste scopevraag voor de module.

---

## Risico's

- **"Design skill" blijft vaag** als je het niet concreet definieert. Prompts only = promptvariant. Prompts + tokens + componentconventies = een echte skill. Het verschil bepaalt hoe nuttig de vergelijk-N-flow is.
- **Parallelle variant-generatie verbruikt budget snel.** 4 varianten = 4 PTY-sessies tegelijk. Op een referentiemachine (8 vCPU / 32 GB) met MAX_ACTIVE_TURNS ~4-8 (07b §8) is dat realistisch de helft van je beschikbare capaciteit. Gebruikers moeten dit zien voordat ze op "vergelijk 6 varianten" klikken.
- **Kwaliteitsbeoordeling is subjectief.** De golden-ticket harness (`AI_QUALITY_AND_EVALS.md §3`) scoort op structurele en assertie-checks. "Ziet dit er goed uit?" is geen automatisch scoreerbare eigenschap. Je hebt per definitie menselijke feedback nodig, wat de feedback-loop trager maakt dan bij code.
- **Live-edit loop (klik + refine per component) vereist veel extra werk.** De preview-deployment infra is er, maar een interactieve design-lus met component-level selectie is niet ontworpen en past slecht in het "agent in een PTY" model.
- **Skill-bibliotheek kan snel vervuilen.** Als gebruikers eigen skills toevoegen zonder kwaliteitscontrole, krijg je een graveyard van half-uitgewerkte stijlen. Versiebeheer en archivering zijn nodig.
- **needsWorkspace grens is tricky.** Een design-agent die alleen designs `propose` is `needsWorkspace:false`. Maar zodra hij ook code schrijft, heb je een worktree nodig. Beide modi in één studio-UX samensmolten geeft verwarring.

---

## Extra ideeën

### 1. "Design token diff" als primary artifact
In plaats van een volledige pagina-render als vergelijk-artifact, genereer de design-agent een *token diff* — welke CSS-variabelen (`--color-primary`, `--spacing-base`, etc.) veranderen ten opzichte van de huidige waarden. Dit is klein, reviewbaar, en direct toepasbaar via de bestaande accept-flow. Een volledige pagina-render als visuele preview per variant kan er naast staan (via preview deployment), maar de "wat verandert er eigenlijk" view is de token diff.

### 2. Skill-competitie als cron-trigger
Via de bestaande WorkspaceTrigger (`on:'cron'`) kan een workspace wekelijks automatisch N design skills uitvoeren op een standaard testpagina en de resultaten opslaan als artifacts. Zo bouw je over tijd een historische vergelijking op: "hoe heeft skill X het er bij release 0.3 uitlaten zien vs nu." Kost weinig extra infrastructuur.

### 3. "Freeze this skill at this commit" per design-artifact
Net als RAG-snapshots (07b_CONTAINER_RUNTIME.md §8 / 15_SOURCES_MANAGEMENT.md) kan een gekozen design-artifact worden bevroren op een commitHash. Als je een geaccepteerde variant hebt, freeze je de skill+tokens+commitHash zodat een toekomstige agent altijd die versie als referentie kan laden.

### 4. Design-skill authoring via de studio zelf
Laat de design-agent een *nieuwe* skill voorstellen op basis van de gecombineerde feedback over bestaande skills ("gebruikers kiezen altijd de meer compacte variant — maak een 'compact-first' skill"). Dit is een `invoke-workspace-ai` trigger die de PromptFeedback-data analyseert en een `config-review` WorkspaceSuggestion produceert met een nieuwe skill-definitie. Geen nieuwe infrastructuur nodig.

### 5. Skill-bundle als npm-package (post-V1)
Design skills kunnen, net als `@luckystack/*` packages, als gepubliceerde npm-packages worden gedistribueerd. De Sources-tab ontdekt ze al via `npm run ai:capabilities`. Dit opent een community-marketplace voor design-skills zonder dat de kern van Workspaces hoeft te veranderen.

---

## Vragen

### Vraag 1 — Wat is een "design skill" precies?

**Samenvatting:** De kern van de module hangt af van hoe je een "design skill" definieert.

**Gedetailleerde samenvatting:** Een design skill is de stijlgids die de AI gebruikt om een pagina te ontwerpen. Maar hoe gedetailleerd is zo'n stijlgids? Optie A zegt: alleen een andere prompt ("ontwerp minimalistisch"). Optie B zegt: een prompt plus een set kleurwaarden en lettertypegrootten die van de huidige afwijken. Optie C zegt: een prompt plus token-waarden plus afbeeldingen van voorbeeldcomponenten als referentie. Hoe meer een skill bevat, hoe rijker het eindresultaat — maar ook hoe meer werk het is om een skill te schrijven. Dit bepaalt ook hoe nuttig de vergelijk-N-flow is: als alle skills alleen een andere promptzin zijn, zie je nauwelijks verschil.

**Type:** choice

**Opties:**
- **a) Prompt-only** — een skill is een tekstvariatie op de systeem-prompt. Makkelijkst te bouwen; minste visueel verschil tussen varianten.
- **b) Prompt + design-tokens** — een skill bevat ook expliciete kleur/spatie/typografieparameters die afwijken van de huidige projecttokens. Geeft echte visuele afwijking; de AI past de tokens toe in de gegenereerde code. Aanbevolen startpunt.
- **c) Prompt + tokens + referentieafbeeldingen** — een skill bevat ook voorbeeldschermafbeeldingen die als visueel anker dienen. Rijkste resultaat; vereist dat de AI een multimodale input verwerkt (Claude Sonnet/Opus ondersteunt dit).
- **d) Prompt + tokens + componentbibliotheek-conventies** — een skill definieert ook welke bestaande componenten de AI *moet* hergebruiken of juist moet vermijden. Meest robuust voor projectconsistentie, maar het zwaarst om te specificeren.

---

### Vraag 2 — Hoeveel varianten in parallel en uit welk budget?

**Samenvatting:** N varianten tegelijk genereren kost N AI-sessies tegelijk; dat verdringt lopende ticketwerk.

**Gedetailleerde samenvatting:** De Workspaces-infrastructuur heeft een gedeeld plafond voor hoeveel AI-sessies tegelijk actief mogen zijn. Op een standaard server zijn dat er 4 tot 8. Als je 4 design-varianten wil vergelijken, blokkeer je mogelijk alle resterende ruimte voor lopende tickets. Je moet kiezen: zet designer-sessies in dezelfde wachtrij als tickets (eerlijk, maar de gebruiker wacht langer op een vergelijking), of geef de Designer Studio een eigen kleiner sub-budget zodat tickets altijd voorrang hebben.

**Type:** choice

**Opties:**
- **a) Dezelfde wachtrij, geen speciale behandeling** — design-variant-sessies concurreren gewoon met ticketwerk. Simpelst, maar kan lopende tickets vertragen als je veel varianten aanvraagt.
- **b) Sub-budget binnen de gedeelde pool** — design-varianten mogen maximaal X slots tegelijk gebruiken (bv. max 2 van de 6 beschikbare). Tickets krijgen de rest. Aanbevolen.
- **c) Sequentieel, niet parallel** — varianten worden één voor één gegenereerd. Geen capaciteitsrisico, maar je wacht langer op het resultaat.
- **d) Aparte machine/resource-pool voor design** — design-sessies draaien op een dedicated server. Duurste optie; zinvol pas als de studio intensief gebruikt wordt.

---

### Vraag 3 — Schrijft de design-agent ook code, of alleen design-specificaties?

**Samenvatting:** Of de agent ook daadwerkelijk React/Tailwind-code schrijft bepaalt de hele technische opzet van de module.

**Gedetailleerde samenvatting:** Er zijn twee smaken: de design-agent schrijft een *beschrijving* van hoe de pagina eruit moet zien (tokens, layout-keuzes, componentgebruik) — en dan kopieert een menselijke ontwikkelaar of een tweede AI-agent dat naar echte code. Of de design-agent schrijft *direct code*: React-componenten, CSS-variabelen, Tailwind-klassen. De eerste smaak is lichter, sneller, en vereist geen volledige ontwikkelomgeving (worktree) in de container. De tweede smaak geeft een directere workflow maar is complexer en duurder.

**Type:** choice

**Opties:**
- **a) Alleen design-spec (geen code)** — de agent produceert een document: welke tokens, welke layout, welke componenten. Een afzonderlijk codeer-ticket zet dit om naar implementatie. Lichtste optie; `needsWorkspace:false`.
- **b) Code én spec** — de agent schrijft werkende React/Tailwind-code én documenteert de keuzes. Output is direct reviewbaar als MR. Zwaarste optie; `needsWorkspace:true`, containerkosten. Aanbevolen als de studio een centrale rol speelt in de workflow.
- **c) Configureerbaar per stage** — de gebruiker kiest per design-stage in de pipeline-editor of de agent spec of code produceert. Flexibel maar complexer te bouwen.

---

### Vraag 4 — Hoe presenteer je de vergelijking aan de gebruiker?

**Samenvatting:** De "kies je variant"-UX is het hart van de studio; er zijn wezenlijk verschillende opties.

**Gedetailleerde samenvatting:** Als je 4 varianten hebt gegenereerd, hoe vergelijk je die? Je kunt ze naast elkaar tonen als schermafbeeldingen (als de preview-container screenshots kan maken), als token-diffs ("variant A verandert de primaire kleur naar #blauw; variant B vergroot de basisspatie"), of als live klikbare previews elk op een eigen URL. De schermafbeeldingen-optie geeft de rijkste visuele vergelijking maar vereist dat je screenshots genereert (bv. via Playwright). De token-diff is compact en technisch maar niet visueel. De live-preview-optie is het meest interactief maar vraagt per variant een draaiende container.

**Type:** choice

**Opties:**
- **a) Token-diff naast elkaar** — een tabel: welke CSS-waarden wijzigen per variant vs de huidige stijl. Compact, altijd beschikbaar, geen extra infrastructuur.
- **b) Gegenereerde schermafbeeldingen** — de studio maakt een screenshot van een testpagina na het toepassen van elke variant (via Playwright MCP, Admin-goedgekeurd). Rijkste visuele vergelijking; vereist een draaiende app per variant.
- **c) Live preview-links per variant** — elke variant draait op `dev-<ticketId>-<variantIndex>.<domain>` en is klikbaar. Meest interactief; hoogste infrastructuurkosten (N preview-containers tegelijk). Aanbevolen voor grotere teams.
- **d) Zijdelingse diff van de gegenereerde code** — toont de diff van de React/Tailwind-code per variant naast elkaar. Nuttig voor ontwikkelaars; minder nuttig voor niet-technische stakeholders.

---

### Vraag 5 — Hoe stroomt een gekozen variant terug naar de codebase?

**Samenvatting:** Na "ik kies variant B" — wat gebeurt er dan concreet?

**Gedetailleerde samenvatting:** Zodra een gebruiker een variant kiest, moet die keuze ergens landen. In de bestaande opzet is de AI nooit de schrijver — de gebruiker accepteert een voorstel en de Conductor voert de wijziging uit. Maar wat *is* de wijziging? Het kan een MR zijn die de design-tokens aanpast in `src/index.css`. Het kan een reeks componentbestanden zijn die de agent heeft geschreven. Of het kan een WorkspaceSuggestion zijn die een menselijke ontwikkelaar oppakt en handmatig implementeert. De keuze hier bepaalt hoe "hands-off" de studio is.

**Type:** choice

**Opties:**
- **a) WorkspaceSuggestion met appliable patch** — de gekozen variant wordt een voorstel met een automatisch toepasbaar diff. Gebruiker klikt Accept; de Conductor schrijft de wijziging. Aanbevolen startpunt; past naadloos in B-23.
- **b) Automatisch een nieuwe ticket aanmaken** — de studio maakt een "implementeer design variant B" ticket aan in de backlog. Een ontwikkelaar of een volgende AI-stage pakt het op. Iets trager, maar expliciet en controleerbaar.
- **c) Directe MR (als de agent ook code heeft geschreven)** — de gekozen variant wordt direct als branch + MR aangemaakt via de bestaande MR-infrastructuur. Snelste pad naar de codebase; vereist dat de agent code heeft geproduceerd (optie b/c van vraag 3).

---

### Vraag 6 — Wie mag design skills schrijven en toevoegen?

**Samenvatting:** Toegangsbeheer op de skill-bibliotheek: wie mag nieuwe skills maken?

**Gedetailleerde samenvatting:** Design skills zijn herbruikbare stijlgidsen. Als iedereen zomaar skills kan toevoegen, raakt de bibliotheek snel vol met overlappende of halfafgewerkte stijlen. Als alleen admins skills mogen toevoegen, is de drempel hoog en groeit de bibliotheek langzaam. Je kunt ook een middenweg kiezen: iedereen mag skills *voorstellen*, maar een admin keurt ze goed voordat ze voor het hele workspace beschikbaar zijn.

**Type:** choice

**Opties:**
- **a) Alleen Owner/Admin** — strakke bibliotheek, maar weinig community-bijdragen. Goed voor kleine teams.
- **b) Iedereen mag skills toevoegen, zonder goedkeuring** — maximale flexibiliteit, risico op vervuiling.
- **c) Voorstel-en-goedkeur flow** — leden stellen een skill voor (WorkspaceSuggestion), Admin keurt goed. Aanbevolen voor middelgrote teams.
- **d) Skills zijn altijd per-workspace-privé** — geen gedeelde bibliotheek; elke workspace heeft zijn eigen skills, nooit uitwisselbaar met andere workspaces. Simpelste RBAC, minste waarde op termijn.

---

### Vraag 7 — Krijgt de Designer Studio een eigen navigatie-item?

**Samenvatting:** Staat de studio als top-level scherm in de sidebar of is het een pipeline-stage?

**Gedetailleerde samenvatting:** De Designer Studio kan op twee manieren in de navigatie leven. Als *pipeline-stage* verschijnt hij alleen als een stap in een bestaand ticket-workflow (je voegt een "Design"-stage toe aan je pipeline). Als *eigen scherm* heeft de studio een eigen item in de linkernav, naast Board, Backlog, Sources, etc. — met een eigen overzicht van alle designsessies en de skill-bibliotheek. De eerste optie is makkelijker te bouwen en past naadloos in het bestaande ontwerp. De tweede optie geeft een rijkere ervaring maar vereist een nieuw scherm en navigatiepunt.

**Type:** choice

**Opties:**
- **a) Uitsluitend als pipeline-stage** — de studio is een `roleKey:'design'` stage in een ticket. Makkelijkst; nul UI-scherm-werk; past in de bestaande AgentRole-walkthrough van §7. Aanbevolen voor V1 van de module.
- **b) Eigen navigatiescherm + pipeline-stage** — een "Studio"-item in de nav geeft een overzicht van alle designsessies, de skill-bibliotheek, en recente artifacts. Rijker maar meer bouwwerk.
- **c) Eigen scherm, geen pipeline-integratie** — de studio staat los van het ticket-systeem. Minste overlap met bestaand werk, maar ook minste integratie met git/review-flow.

---

### Vraag 8 — Hoe ga je om met visuele feedback op gegenereerde ontwerpen van niet-technische stakeholders?

**Samenvatting:** Kunnen niet-technische teamleden (designer, product owner) ook input geven op een design-variant?

**Gedetailleerde samenvatting:** In het huidige Workspaces-systeem kunnen alle teamleden vragen beantwoorden (QuestionSet) en suggesties accepteren of verwerpen. Maar als een designer een visuele variant wil *annoteren* ("de knop moet groter", "het lettertype klopt niet"), heb je een annotatie-interface nodig — iets wat nu helemaal niet bestaat. Je kunt dit oplossen door die feedback via een vrije tekstvraag te vragen, of je kunt besluiten dat visuele annotatie buiten scope is en de feedback altijd via tekst loopt.

**Type:** choice

**Opties:**
- **a) Tekstuele feedback via QuestionSet (bestaande infra)** — een "vragen"-ronde na elke vergelijking: "welke variant kies je en waarom?" als QuestionCard. Geen nieuwe UI. Aanbevolen.
- **b) Structured keuze + optionele toelichting** — de gebruiker kiest variant A/B/C/D (zoals een keuze-QuestionCard) plus een optioneel commentaarveld. Past in de bestaande QuestionCard-structuur; minieme aanpassing.
- **c) Visuele annotatie op screenshots** — gebruikers kunnen klikken en tekenen op een variant-screenshot. Rijkste feedback; vereist een compleet nieuw annotatie-component buiten de huidige UI-kit.

---
