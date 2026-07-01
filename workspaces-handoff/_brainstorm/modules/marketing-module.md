# Marketing-module — analyse

> Gegenereerd: 2026-06-14. Onderdeel van de Workspaces modules-brainstorm.

---

## Mijn mening

De marketing-module is het meest ambitieuze van de drie voorgestelde modules, en dat is zowel zijn kracht als zijn grootste risico. Mijn candide oordeel: **het statische gedeelte (posters, thumbnails, sociale media-afbeeldingen) is haalbaar en waardevol; de videocomponent is HORIZON-scope voor V1 — niet omdat het onmogelijk is, maar omdat het een heel andere technische laag vereist die haaks staat op hoe het bestaande systeem werkt.**

**Waar het sterk is:**
De kern-gedachte — "genereer marketingmateriaal met context over je eigen codebase/product" — is echt onderscheidend. Je hebt al een RAG-laag, al een skill-systeem, al een artifact-viewer-registry. Een "brand-kit" skill die de RAG-index van je project als input neemt en posters/thumbnails genereert, past structureel goed in het `AgentRole` plugin-model (`03_AUTOMATION_AND_PLUGINS.md §7`).

**Waar het zwak is:**
Video genereren is een fundamenteel ander probleem dan tekstgeneratie via een PTY. De huidige architectuur draait op een interactieve `claude` CLI in een node-pty sessie, gefactureerd op het Max-abonnement (`01_ARCHITECTURE.md §1`, LOCKED). Videogeneratie-API's (Runway, Sora, Pika, etc.) zijn **metered-API backends** — exact de categorie die in `MULTI_PROVIDER_SEAM.md §3 split B` "can not coexist as one accounting model" wordt genoemd. Je kunt dat niet oplossen zonder de multi-provider seam te bouwen, die expliciet geparkeerd staat (`MULTI_PROVIDER_SEAM.md §4`). Dat is een bewuste keuze om te overschrijven — niet onmogelijk, maar je gaat de parked build moeten trekken, en je moet dat weten voor je begint.

**Playwright frame-capture idee:**
Slim en concreet bruikbaar voor statische assets. De bestaande Playwright MCP-integratie (`docs/AI_BROWSER_TESTING.md`) is al ontworpen voor screenshot-gebruik. Het Playwright-frame-als-input-voor-design-bewerking is een elegante bridge: geen video nodig, maar een set van schermafbeeldingen van je eigen app die je vervolgens met AI bewerkt tot een thumbnail of poster. Dit is het sterkste deel van het voorstel.

**Edit-skills / stijl-bibliotheek:**
Dit idee overlapt sterk met de Designer Studio's design-skill-bibliotheek. Als je beide modules bouwt, wil je één gedeeld skill-model, niet twee parallelle implementaties. De Marketing-module zou de skill-bibliotheek van de Designer Studio moeten *hergebruiken*, niet opnieuw uitvinden.

**Conclusie:** Scope V1 van de Marketing-module naar **statische assets (afbeeldingen/posters/thumbnails) via Claude + Playwright-screenshots** — dat past in het bestaande systeem. Video is HORIZON. Als je video wilt in V1, moet je expliciet beslissen de multi-provider seam nu te bouwen, met alle gevolgen van dien.

---

## Past op bestaande design

De Marketing-module is niet helemaal blanco, maar is verder van het bestaande corpus dan de Designer Studio of de Interviewer.

**Wat er al is en direct herbruikt wordt:**

- **AgentRole plugin model** (`03_AUTOMATION_AND_PLUGINS.md §3`): `registerAgentRole({ key:'marketing', needsWorkspace:false, artifactKind:'media', ... })` volgt exact hetzelfde patroon als de 'design'-walkthrough in §7. De Marketing-agent heeft (voor statische assets) geen worktree nodig — `needsWorkspace:false`.
- **ArtifactViewerRegistry** (`03_AUTOMATION_AND_PLUGINS.md §3.3`): `registerArtifactViewer('media', lazy(() => import('./MediaViewer')))` geeft de MediaViewer zijn plek. De TicketDetail dispatcht al op `artifactKind`, de FileDiffViewer is de fallback.
- **Skills/MCP tab in Sources** (`features/15_SOURCES_MANAGEMENT.md`): brand-kit skills en edit-style skills landen als `SkillEntry`-rijen, net als design-skills. Geen nieuwe infrastructuur.
- **IntegrationTool + Env vars** (`03_AUTOMATION_AND_PLUGINS.md §5`): als je een externe image-generation API (DALL-E, Stable Diffusion API, etc.) wilt, past de API-key in het bestaande IntegrationTool-model per workspace. Per-stage `ro/rw` tier, audit-logged — exact de ontworpen weg voor derde-partij credentials.
- **Playwright MCP** (al beschreven in `docs/AI_BROWSER_TESTING.md`): al geïntegreerd voor browser-verificatie. Frame-capture voor marketing is een uitbreiding van een bestaand gebruik, niet een nieuw MCP-oppervlak.
- **WorkspaceSuggestion + accept-flow** (`03_AUTOMATION_AND_PLUGINS.md §4`): gegenereerde assets worden als suggestion gepresenteerd; gebruiker accepteert → Conductor schrijft. B-23 is gerespecteerd.
- **Carry-over envelope** (`02_PROTOCOL_AND_FLOW.md §4`): de marketing-agent emits via `emit_output` met een media-specifieke `outputSchema` (`artifacts:[{kind:'image'|'video', uri, title, thumbnailUri}]`). De carry-over is artifact-kind-agnostisch — de volgende stage kan de URI's ontvangen.
- **RAG-laag / codebase-context** (`07_ORCHESTRATOR.md §D`): de marketing-agent kan via `query_context` (bestaande assistant-verb) de RAG-index van het project bevragen voor productomschrijving, features-lijst, etc. Dit is het "codebase-context" deel van de module — volledig gratis uit bestaande infra.
- **WorkspaceTrigger** (`03_AUTOMATION_AND_PLUGINS.md §1`): `{ on:'ticket.merged', action:'start-stage', params.targetStageId:'marketing' }` — op een merge kick je de marketing-pipeline automatisch. Geen core-change.
- **CapacityManager** (`07b_CONTAINER_RUNTIME.md §8`): de marketing-agent deelt hetzelfde budget als worker-tickets en preview-containers. Statische-asset-generatie (needsWorkspace:false) is een lichtgewicht reasoning-sessie — minder belastend dan een volledige code-stage.

**Spanningen met locked decisions:**

- **Video-generatie = metered-API backend** (`MULTI_PROVIDER_SEAM.md §3 split B`, LOCKED): Runway / Sora / Pika zijn metered APIs. Het huidige systeem draait op PTY-subscription billing. De twee accounting-modellen "cannot coexist" zonder de multi-provider seam. Dit is de zwaarste spanning, en die is LOCKED als parked in V1.
- **providerKey bestaat niet in types.ts** (`MULTI_PROVIDER_SEAM.md §4`, LOCKED): je kunt in V1 geen "gebruik API-key X voor de marketing-module" implementeren via het normale schema. Workaround: de API-key via het `IntegrationTool`/`EnvVar`-model injecteren als werkruimte-env-var — dan kan de marketing-agent die van zijn container-env lezen. Dit is niet de elegante per-module-provider-selectie die de gebruiker beschrijft, maar het is conform de bestaande architectuur.
- **Geen nieuwe verbs** (`02_PROTOCOL_AND_FLOW.md §2`, LOCKED): geen `emit_media_asset` of `capture_frame`. De marketing-agent emit via `emit_output` + `artifacts[]` in de outputSchema. Frame-capture via Playwright is een Bash-tool-call of MCP-tool-call door de agent, niet een nieuw verb.
- **B-23: AI proposeert, Conductor schrijft** (LOCKED): gegenereerde assets worden niet direct ge-publish. Ze worden als artifact gepresenteerd voor menselijke goedkeuring. Dit past goed bij een marketingworkflow — je wilt altijd een oogje houden op wat er naar buiten gaat.
- **Interactieve PTY only** (`V1_SCOPE.md §2`, LOCKED): Claude-sessies zijn interactieve PTY's. Als de marketing-agent API-calls wil doen naar een image-generation endpoint, doet hij dat via shell-tools in de PTY (curl / een kleine helper CLI in de container), niet via een nieuwe SDK-integratie.

---

## Risico's

- **Video-generatie haaks op de PTY-billing-architectuur.** Dit is het grootste risico. Video-generatie API's zijn metered per seconde of per frame, niet per PTY-sessie. De twee billing-modellen kunnen niet worden gecombineerd zonder de multi-provider seam te bouwen — die expliciet geparkeerd staat. Als je video in V1 wilt, moet je die beslissing bewust nemen.

- **Playwright frame-capture vereist een draaiende app.** Om frames van je eigen app te capturen, moet de app draaien in een preview-container (`features/23_PREVIEW_DEPLOYMENT.md`). Preview deployments zijn HORIZON in de huidige V1 scope (`V1_SCOPE.md §2`). Dit betekent dat de frame-capture-flow de preview-deployment feature als afhankelijkheid heeft — of dat je werkt met schermafbeeldingen van een externe (niet-self-hosted) staging-omgeving.

- **Asset-opslag is niet ontworpen.** De carry-over envelope kan URI's doorgeven, maar *waar* de gegenereerde media-files worden opgeslagen is niet gespecificeerd. Blob-storage (S3-compatibel) is de voor de hand liggende keuze, maar die is nergens in het corpus ontworpen. Tijdelijke opslag in de worktree-volume werkt voor een sessie, maar assets moeten langer leven dan een ticket.

- **Edit-skill overlap met Designer Studio.** Als je zowel de Designer Studio als de Marketing-module bouwt, heb je twee skill-bibliotheken die overlappen: design-skills (voor UI-generatie) en edit-styles (voor media-bewerking). Als die niet hetzelfde systeem delen, creëer je dubbel onderhoud. De Marketing-module *moet* de skill-infrastructuur van de Designer Studio hergebruiken — niet parallel opbouwen.

- **Kwaliteitsborging van gegenereerde media is handmatig.** De golden-ticket harness (`AI_QUALITY_AND_EVALS.md §3`) werkt op tekst/code-output. Visuele kwaliteit (is dit thumbnail professioneel genoeg?) is niet automatisch scoreerbaar. Menselijke review is sowieso verplicht bij marketingmateriaal, dus dit is minder een architectuurprobleem dan een workflowontwerp-keuze.

- **Beeldrechten bij AI-gegenereerde content.** Afhankelijk van welke generatiemodellen je gebruikt en welke trainingsdata ze hebben, kunnen er licentie-kwesties spelen. Dit is geen architectuurprobleem maar een businessrisico dat de gebruiker bewust moet accepteren.

- **CapacityManager shared budget bij parallelle asset-generatie.** Vergelijk-N-stijlen tegelijk = N PTY-sessies tegelijk (als je het via de AgentRole-aanpak doet). Op een referentiemachine (8 vCPU / 32 GB, MAX_ACTIVE_TURNS ~4-8, `07b_CONTAINER_RUNTIME.md §8`) is dat snel een bottleneck, vooral als worker-tickets al lopen.

---

## Extra ideeën

### 1. "App-story generator" als eerste use-case
In plaats van te beginnen met video of algemene marketing, maak de eerste use-case hyperspecifiek: genereer een **App Store- of Product Hunt-beschrijving** inclusief screenshots. Input: RAG-context van het project + Playwright-screenshots van de running app. Output: een markdown-bestand met beschrijvingstekst + geoptimaliseerde screenshots. Dit is volledig realiseerbaar met de huidige architectuur (needsWorkspace:false, Playwright MCP, emit_output), klinkt niet als "te groot", en is direct nuttig voor iedereen die een product lanceert.

### 2. Brand-kit als gedeeld workspace-artifact
Maak een "brand-kit" een eerste-klas workspace-entity naast IntegrationTool en Sources. Een brand-kit bevat: logo-URL, primaire/secondaire kleur, font-family, tone-of-voice beschrijving. De marketing-agent én de designer-agent gebruiken dezelfde brand-kit. Dit geeft consistentie over beide modules zonder dat elk een eigen "stijl-configuratie" nodig heeft. Opgeslagen als een Workspace-level doc in Sources (source: 'uploaded', tint: 'brand'), injectable via de carry-over.

### 3. Social-media-formaat-presets als skill-bundels
In plaats van een vrije canvas, definieer vaste output-formaten als skills: `linkedin-post`, `twitter-card`, `product-hunt-thumbnail`, `og-image`. Elke skill specificeert de exact vereiste afmetingen, de copy-lengte, en het visuele template. De gebruiker kiest een formaat-skill; de agent genereert precies dat. Dit maakt de output-kwaliteit consistent en de vergelijk-N-stijlen-workflow werkt direct: "genereer een OG-image in 3 stijlen".

### 4. Changelog → release notes → social post pipeline
Koppel de Marketing-module aan het ticket-lifecycle: na een `ticket.merged` event triggert een WorkspaceTrigger de marketing-agent met de changelog van de gemerged tickets. Output: een conceptuele release-note + een social media post. Dit is een volledig automatiseerbare, waardevolle flow die niets vereist buiten het bestaande trigger/agent/suggest-systeem.

### 5. "Marketing health check" als onderdeel van de Workspace-AI
Voeg een `maintenance`-type WorkspaceSuggestion toe die periodiek (cron trigger) controleert: "je hebt 3 nieuwe features gemerged maar geen marketing-asset gegenereerd in 30 dagen." Dit gebruikt exact het bestaande WorkspaceSuggestion-mechanisme en kost bijna niets te bouwen — maar is een krachtige nudge voor solo-ontwikkelaars die marketing vergeten.

### 6. Gedeelde skill-bibliotheek met de Designer Studio
Ontwerp het skill-systeem van de Marketing-module als een extensie van de Designer Studio's skill-bibliotheek, niet als aparte implementatie. Een skill heeft een `category: 'design' | 'marketing' | 'shared'` en een `outputKind: 'html' | 'image' | 'copy' | 'video'`. Beide modules filteren op hun categorie, maar de registratie-infrastructuur, de Sources-tab weergave, en de versioning zijn identiek. Dit is zowel een architectuurkeuze als een werkdruk-besparing.

---

## Vragen

> Elke vraag heeft een title, summary, en een detailed summary die begrijpelijk is voor iemand die het project alleen op hoofdlijnen kent.

---

### V1. Scope van V1: statisch of ook video?

**Summary:** Wat valt in de eerste versie van de module — alleen statische afbeeldingen (thumbnails, posters, OG-images), of ook video's?

**Detailed summary:** De twee soorten output vereisen fundamenteel verschillende technologie. Statische afbeeldingen kunnen worden gegenereerd door de AI die al in het systeem zit (Claude), eventueel aangevuld met een externe afbeeldings-API. Video-generatie vereist een externe videogeneratie-dienst (zoals Runway of Sora), die per seconde of per frame rekent in plaats van per gesprek. Het systeem is momenteel gebouwd voor het eerste model (gesprekken per abonnement), niet het tweede. Om video te ondersteunen moet een fundamenteel onderdeel van de architectuur eerder worden gebouwd dan gepland. Dat is haalbaar, maar het is extra werk en brengt risico's mee.

**Opties:**
- **a) Alleen statisch in V1, video later (aanbevolen):** Focus op thumbnails, posters en OG-images in V1. Video is een aparte, latere fase zodra de multi-provider architectuur is gebouwd.
- **b) Video als V1-priority:** Video direct in V1. Dit vereist het eerder bouwen van de multi-provider koppeling. Zwaar, maar mogelijk als dit het onderscheidende kenmerk is.
- **c) Video via workaround in V1:** Gebruik de AI om een video-script + storyboard te genereren, en laat de gebruiker zelf de video maken (of een extern tool gebruiken). De module levert de bouwstenen, niet de eindvideo.

---

### V2. Welke externe image-generatie API gebruik je?

**Summary:** Als je afbeeldingen genereert via een externe API, welke dienst gebruik je — en hoe ga je daarmee om?

**Detailed summary:** Er zijn meerdere diensten die AI-afbeeldingen kunnen genereren (DALL-E van OpenAI, Stable Diffusion, Adobe Firefly, etc.). Ze verschillen in prijs, kwaliteit, en licentievoorwaarden voor commercieel gebruik. Je kunt ook kiezen voor *geen* externe API: Claude zelf kan SVG-code of HTML/CSS-based posters schrijven, die dan kunnen worden gerenderd zonder een externe dienst. Dit laatste past beter in de bestaande architectuur (geen extra API-keys, geen extra kosten buiten het abonnement), maar de uitkomst ziet er anders uit dan een fotorealistische afbeelding.

**Opties:**
- **a) Geen externe API — Claude genereert SVG/HTML (aanbevolen voor V1):** Claude schrijft code (SVG, HTML+CSS) die visuele assets beschrijft. Kan worden omgezet naar een afbeelding via een headless browser (Playwright). Geen extra API-key nodig.
- **b) DALL-E 3 of soortgelijk via OpenAI API:** Fotorealistische afbeeldingen mogelijk. Vereist een OpenAI API-key en per-generatie kosten. Past in het bestaande IntegrationTool/EnvVar-model.
- **c) Pluggable (gebruiker kiest zelf):** De module is provider-agnostisch; de gebruiker configureert zijn eigen image API-key. Meer flexibiliteit, maar meer complexiteit in de setup.
- **d) Alleen Playwright-screenshots bewerken:** Geen generatieve AI voor afbeeldingen — alleen bestaande screenshots van de eigen app worden bewerkt (bijsnijden, tekst toevoegen, kleur-overlays via canvas). Meest conservatief, maar ook het meest authentiek.

---

### V3. Hoe verhoudt de Marketing-module zich tot de Designer Studio qua skills?

**Summary:** Bouwen de twee modules een gedeeld skill-systeem, of hebben ze elk hun eigen losse implementatie?

**Detailed summary:** De Designer Studio heeft "design skills" (promptvarianten voor UI-generatie); de Marketing-module heeft "edit-styles" (stijlen voor het bewerken van afbeeldingen). Deze twee dingen lijken op elkaar — beide zijn herbruikbare stijlprofielen die je kunt toepassen op een AI-generatie. Als je ze apart bouwt, heb je twee lijsten in de interface en twee stukken technische infrastructuur die hetzelfde doen. Als je ze combineert, heb je één skill-bibliotheek die door beide modules wordt gebruikt, maar dan moet je een categorie-systeem ontwerpen. Welke aanpak past beter bij hoe jij de twee modules ziet: als echt onafhankelijke tools, of als variaties op hetzelfde thema?

**Opties:**
- **a) Gedeelde skill-bibliotheek met categorieën (aanbevolen):** Eén infrastructuur, twee categorieën (`design` en `marketing`). Elke module filtert op zijn eigen categorie. Minder dubbel werk, consistentere UX.
- **b) Volledig aparte skill-systemen:** De twee modules zijn volledig onafhankelijk. Meer flexibiliteit per module, maar dubbele implementatie en mogelijke UI-verwarring ("waar staat mijn stijl ook alweer?").
- **c) Marketing is een sub-set van Designer Studio:** De Marketing-module is eigenlijk een gespecialiseerde modus van de Designer Studio, geen aparte module. Ze delen alles; marketing is alleen een andere rol-configuratie.

---

### V4. Playwright frame-capture: afhankelijkheid van preview-deployment?

**Summary:** De frame-capture-flow vereist een draaiende versie van je app. Wil je dat de Marketing-module wacht op preview deployments (HORIZON), of werkt hij met een externe URL?

**Detailed summary:** Het idee om frames van je eigen app te capturen via Playwright (een browser-automatiseringstool) is aantrekkelijk — je thumbnail toont letterlijk hoe je app eruitziet. Maar om frames van je eigen app te capturen moet die app ergens draaien. Het systeem heeft per-ticket preview-deployments ontworpen (een tijdelijke versie van je app die live draait voor elk ticket), maar die zijn uitgesteld naar een latere versie. Je kunt dit oplossen door een externe URL (je bestaande staging- of productieomgeving) te accepteren in plaats van de interne preview, maar dan verlies je de koppeling met de specifieke versie die bij het ticket hoort.

**Opties:**
- **a) Externe URL als input (aanbevolen voor V1):** De gebruiker geeft een URL op (staging, productie, of een handmatig gestarte lokale versie). Geen afhankelijkheid van preview-deployments. Eenvoudiger maar minder geautomatiseerd.
- **b) Wachten op preview-deployment feature:** De Marketing-module wacht met frame-capture tot preview-deployments beschikbaar zijn. Correcte koppeling met het specifieke ticket, maar later beschikbaar.
- **c) Frame-capture volledig uitstellen:** In V1 geen automatische frame-capture. De gebruiker uploadt handmatig screenshots die de marketing-agent als input gebruikt. Minste technische risico, maar minder "wow"-effect.

---

### V5. Approval flow: wie keurt marketingmateriaal goed?

**Summary:** Hoe ziet de review- en goedkeuringsflow voor gegenereerde marketingassets eruit, en wie heeft daarvoor rechten?

**Detailed summary:** Marketingmateriaal dat extern gaat (social media, website, App Store) vereist menselijke goedkeuring — dat is al ingebakken in het systeem (B-23: AI proposeert, mens keurt goed). Maar er zijn nuances: wie mag goedkeuren? Alleen de workspace-eigenaar? Elk teamlid? En wil je een "staging"-stap — eerst intern reviewen, dan pas publiceren? En wil je dat de Marketing-module de assets ook direct *publiceert* (naar een sociale media account of CDN), of alleen *genereert*? Dat laatste (publiceren) vereist nieuwe integraties en meer rechten-beheer.

**Opties:**
- **a) Generate-only, handmatige publicatie (aanbevolen voor V1):** De module genereert assets als bestanden/artifacts. De gebruiker downloadt ze en publiceert ze zelf. Geen externe publicatie-integraties nodig.
- **b) Generate + optionele directe publicatie naar één kanaal:** De module kan op verzoek direct publiceren naar een geconfigureerd kanaal (bijv. een webhook naar Buffer of een S3-bucket). Vereist een extra integratieconfiguratie per kanaal.
- **c) Volledig geautomatiseerde publicatie-pipeline:** Na goedkeuring worden assets automatisch gepubliceerd. Krachtig maar risicovol voor marketingcontent.

---

### V6. Asset-opslag: waar leven gegenereerde media-bestanden?

**Summary:** Gegenereerde afbeeldingen en video's moeten ergens worden opgeslagen. Waar komen die terecht?

**Detailed summary:** De huidige architectuur slaat code-output op in git (de worktree), maar afbeeldingen en video's horen niet thuis in git — ze zijn groot en binair. Je hebt een aparte opslageplaats nodig. De voor de hand liggende keuze is een S3-compatibele object-opslag (AWS S3, MinIO voor self-hosting, Cloudflare R2). Maar het corpus heeft dit nergens ontworpen. Self-hosten betekent ook dat je een extra service moet draaien (MinIO), of dat de gebruiker een externe S3-bucket configureert. Dit is een niche maar kritieke infrastructuurkeuze — niet iets wat je per ongeluk kunt parken.

**Opties:**
- **a) S3-compatibele object-opslag, door gebruiker geconfigureerd (aanbevolen):** De Marketing-module vereist een geconfigureerde S3-bucket (of MinIO). Assets worden daarheen geüpload; de URI's worden in de carry-over envelope en de WorkspaceSuggestion opgeslagen.
- **b) Opgeslagen als bestanden in de worktree (tijdelijk):** Assets leven als bestanden in de ticket-worktree (bijv. `marketing/thumbnail.png`). Na het mergen eindigen ze in de repo. Eenvoudig, maar onhandig voor grote binaries en niet schaalbaar.
- **c) Ingebouwde file-server als extra container:** Een kleine file-server container (bijv. MinIO) wordt onderdeel van de self-hosted installatie via docker compose. Gebruiker configureert niets extra's. Meer setup-werk voor de makers, maar naadlozer voor de gebruiker.

---

### V7. Wat is de kern-waardepropositie die je in V1 wilt bewijzen?

**Summary:** Welk concreet resultaat wil je dat een gebruiker na V1 van de Marketing-module heeft bereikt?

**Detailed summary:** Een module bouwen die "marketing met AI doet" is breed. Om te beginnen is het waardevoller om één ding goed te doen dan veel dingen half. Je kunt kiezen: wil je bewijzen dat de module *bruikbare marketingteksten* genereert (copy voor Product Hunt, release notes, etc.)? Of wil je bewijzen dat de module *visuele assets* genereert (thumbnails, posters)? Of wil je bewijzen dat de *codebase-context* echt verschil maakt (de AI weet wat je app doet en schrijft daardoor betere copy dan een generieke prompt)? Het antwoord bepaalt welke technische onderdelen je prioriteit geeft in V1. Dit is een smaak- en strategiebeslissing die alleen jij kunt maken.

**Type:** open vraag

**Mogelijke richtingen om over na te denken:**
- Marketingtekst + release notes (volledig via Claude, geen externe API, laagste technische drempel)
- Thumbnails/OG-images via SVG/HTML generatie + Playwright screenshot (visueel, maar zonder externe API)
- App Store-beschrijving + screenshots (gecombineerd, direct bruikbaar)
- Social media post-generator (meest direct herkenbaar als "marketing tool")
