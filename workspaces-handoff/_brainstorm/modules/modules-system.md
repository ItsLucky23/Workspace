# Module-systeem — analyse & open vragen

> Geschreven door: architect-agent, 2026-06-14  
> Scope: wat is een "module" in Workspaces, hoe verhoudt dat zich tot het bestaande AgentRole/plugin + stage-model, hoe ziet de registry eruit, hoe surfacen modules UI + eigen routes, en hoe hergebruiken ze de Conductor/structured-channel?

---

## Mijn mening

Het idee is sterk en logisch: de pipeline-flow is nu een monolithisch concept, maar gebruikers willen Designer Studio, Interviewer, Marketing enzovoort als los te schakelen functionaliteit. De kern is gezond.

**Waar het sterk is:**
Het bestaande AgentRole-model (`registerAgentRole`, `registerArtifactViewer`, `registerOrchestratorCommand` — `03_AUTOMATION_AND_PLUGINS.md §3`) is al een registration-DI-systeem. Een "module" is in wezen een *bundel* van bestaande primitieven (één of meerdere rollen, skill-bundels, viewers, commando's, triggers, een nav-entry, een settings-scherm) die samen als één installeerbare eenheid worden behandeld. De sprong van "rol registreren" naar "module registreren" is eerder een groeperings-abstractie dan een fundamentele uitbreiding.

**Waar het zwak/onderschat is:**

1. **Per-module AI-provider-selectie vecht tegen een gelockte beslissing.** `MULTI_PROVIDER_SEAM.md §4` verbiedt expliciet het toevoegen van `providerKey`/`modelKey` velden in `types.ts` voor v1. Het idee "voor de design-tool API-key X, voor de pipeline Claude CLI" vereist de *parked* multi-provider build. Dat is niet een kleine stap — het vereist een echte `EngineDriver` interface, een per-adapter secret-injectie, en een billing-mode split (advisory vs. hard-gate). Dit is de meest complexe open kwestie in de hele module-visie.

2. **"Pipeline-flow als module" is conceptueel rommelig.** De pipeline IS momenteel de kern van het product — het is geen module naast andere modules, het is de container *waarín* stages draaien. Als je de pipeline een module noemt, moet je beslissen: is de pipeline een module die altijd aan staat (de "core module"), of kan je hem uitzetten? Ik raad aan om de pipeline als de **runtime-kern** te behandelen die altijd draait, en alleen de hogere features (Designer Studio, Interviewer, Marketing) als echte modules. Dit scheelt een hoop architecturele verwarring.

3. **UI-surface van modules is het minst ontworpen stuk.** Er is een bestaand navbar-model (`features/12-16`, `SCREEN_INVENTORY.md` App shell) maar geen "module panel slot" in de shell. Designer Studio en Marketing zijn grote, rijke schermen — die vragen eigen navigatie-entries, eigen routes, eigen settings-schermen. Dat is meer werk dan een rol registreren.

4. **Inter-module data-flow ontbreekt volledig.** Als Marketing wil screenshotten wat Designer Studio heeft gegenereerd, is er geen gedefinieerd artifact-handoff-pad. De bestaande artifact-model (`BUILTIN_CI_PIPELINES.md §8`) is per-PipelineRun, niet cross-module.

**Wat het excellent zou maken:**
- Een scherp onderscheid tussen `CoreModule` (altijd aan, de pipeline) en `FeatureModule` (installeerbaar, per-workspace aan/uit).
- Een `ModuleManifest` die alle bestaande primitieven bundelt (rollen, viewers, commando's, triggers, routes, nav-entries, settings-schermen) + metadata (naam, beschrijving, vereiste providers, billing-mode).
- Per-module activation als puur data (`WorkspaceModule` tabel: `workspaceId`, `moduleKey`, `enabled`, `config`).
- De module-registry als code-fixture (zelfde patroon als `AgentRoleRegistry`) — installeren = een NPM-package die bij boot registreert.

---

## Past op bestaande design

### Wat al werkt als fundament

Het bestaande AgentRole-model (`03_AUTOMATION_AND_PLUGINS.md §3`) is de directe voorloper:
```ts
registerAgentRole({ key:'design', needsWorkspace:false, systemPromptTemplate:'...', ... })
registerArtifactViewer('design', lazy(() => import('./DesignViewer')))
registerOrchestratorCommand('ai:refresh-docs', { run })
```
Een module-registry doet hetzelfde maar groepeert deze drie registraties (plus nav-entry, settings-scherm, route-mount, skill-bundels) in één manifest-object.

De `WorkspaceTrigger`-engine (`03 §1`) is al volledig provider-agnostisch en events-based. Modules kunnen bestaande TriggerEventKinds hergebruiken (`stage.on_complete`, `cron`, etc.) en nieuwe TriggerActionKinds toevoegen (of bestaande `run-command` + `OrchestratorCommandRegistry` gebruiken — dat is de aanbevolen veilige route).

De `ArtifactViewerRegistry` (`03 §3.3`) is al het extensie-punt voor eigen viewers. Designer Studio en Marketing hoeven alleen `registerArtifactViewer('design-variant', ...)` en `registerArtifactViewer('media-frame', ...)` te registreren — TicketDetail dispatcht al op `artifactKind`.

De `WorkspaceSuggestion` met `propose_suggestion` (`02_PROTOCOL_AND_FLOW.md §6`) is al de surface waardoorheen een module ideeën/output kan pushen zonder nieuwe verbs.

### Spanningen met gelockte beslissingen

| Spanning | Gelocked in | Impact |
|---|---|---|
| Geen `providerKey` in `types.ts` v1 | `MULTI_PROVIDER_SEAM.md §4` | Per-module provider-selectie is NIET v1. Sequencing: module-systeem eerst bouwen zonder multi-provider; provider-selectie later als de parked build klaar is. |
| Geen nieuwe verbs | `02_PROTOCOL_AND_FLOW.md §2`, `03 §3.4` | Modules mogen geen nieuwe structured-channel verbs toevoegen. Alle module-output gaat via bestaande `emit_output`/`emit_carryover`/`propose_suggestion`. |
| B-23: AI schrijft nooit | `01 §3.3` | Module-output (design variants, interview vragen, media frames) gaat altijd via Conductor-write, nooit direct. Modules zijn proposers, geen writers. |
| Geen save-as-template in v1 | `02_PIPELINE_PRESETS.md §Deferred` | Module-specifieke presets kunnen als built-in code-fixtures (`WorkspacePreset`), maar geen user-editable preset marketplace in v1. |
| Single-instance orchestrator | `01_ARCHITECTURE.md §2` | Modules draaien allemaal binnen dezelfde orchestrator-process — geen aparte module-services. |

---

## Risico's

- **Scope-creep per module**: als elke module zijn eigen routes, nav-entries, settings-schermen, skill-bundels, viewers én providers moet specificeren, is de module-boundary te breed. Begin klein: een module mag minimaal zijn (één rol + één viewer = een geldige module).
- **De "pipeline als module" framing verwarrt**: als je de kern-pipeline uitzet, werkt niets. Noem het `CoreRuntime` en laat het altijd aan.
- **Per-module AI-provider verwachting vs. v1-realiteit**: de gebruiker verwacht dit nu, maar de parked multi-provider build is weken werk. Communiceer dit duidelijk als post-v1.
- **Inter-module artifact-handoff**: Designer Studio produceert iets wat Marketing wil consumeren. Zonder een expliciet artifact-store-model (URI, kind, createdByModuleKey) is dit copy-paste hacking.
- **Module-upgrade-veiligheid**: als een module een `WorkspaceModule.config`-schema heeft en de module-code verandert, kan deserialisatie breken. Versioneer module-configs.
- **CapacityManager-budget**: modules die containers spawnen (Marketing met Playwright, Designer Studio met preview-containers) trekken uit hetzelfde `MAX_RESIDENT` budget (`07b_CONTAINER_RUNTIME.md §8`). Zonder per-module budgetcap kan één zware module de pipeline verstikken.
- **Dev-experience van module-authoring**: als een module drie afzonderlijke `register*`-calls vereist op drie verschillende plekken, maken developers fouten. Eén `registerModule(manifest)` call op één plek is betrouwbaarder.

---

## Extra ideeën

### 1. `ModuleManifest` als bundel-object
In plaats van losse `registerAgentRole` + `registerArtifactViewer` + `registerOrchestratorCommand` calls per module, één object:
```ts
interface ModuleManifest {
  key: string;                          // 'designer-studio' | 'interviewer' | 'marketing'
  label: string;
  description: string;
  version: string;
  navEntry?: { icon: IconDefinition; label: string; route: string; };
  agentRoles?: AgentRole[];
  artifactViewers?: { kind: string; component: string }[];
  orchestratorCommands?: { key: string; run: () => Promise<void> }[];
  defaultTriggers?: WorkspaceTrigger[]; // suggesties, niet verplicht
  settingsComponent?: string;           // lazy-loaded per-module settings screen
  requiredProviders?: ('claude-pty' | 'metered-api')[];  // forward-compat hint
  billingMode?: 'subscription' | 'metered';              // parked, ignored in v1
}
```
`registerModule(manifest)` roept intern alle sub-registraties aan. Modules registreren zichzelf bij server-boot (plugin-patroon, identiek aan hoe LuckyStack zelf `registerPrismaClient` gebruikt).

### 2. `WorkspaceModule` data-tabel voor per-workspace activatie
Puur data, nul migraties voor nieuwe modules:
```ts
// Prisma
model WorkspaceModule {
  id           String @id
  workspaceId  String
  moduleKey    String   // must exist in ModuleRegistry
  enabled      Boolean  @default(true)
  config       Json     @default("{}")  // module-specific settings
  enabledAt    DateTime
  enabledBy    String   // userId
  @@unique([workspaceId, moduleKey])
}
```
Module-activation = insert a row (Admin-gated). De UI toont een module-browser (kaarten, aan/uit-toggle per workspace). Geen code-change nodig voor een module per workspace aan of uit te zetten.

### 3. Module-artifact-store voor cross-module data-flow
Elke module die artifacts produceert schrijft naar een gedeelde `ModuleArtifact`-tabel:
```ts
model ModuleArtifact {
  id            String
  workspaceId   String
  sourceModuleKey String
  kind          String   // 'design-variant' | 'media-frame' | 'interview-result'
  uri           String   // storage path
  ticketId      String?  // optioneel gekoppeld aan ticket
  metadata      Json
  createdAt     DateTime
}
```
Marketing-module kan `ModuleArtifact` bevragen op `sourceModuleKey='designer-studio'` om design-varianten te screenshotten. Geen directe module-koppeling — losse koppeling via het artifact-store.

### 4. "Core Module" als expliciete nul-case
De pipeline-flow is de `CoreModule` met `key: 'pipeline'`, altijd geactiveerd, niet uitschakelbaar. Dit maakt het model duidelijk: er is één core + N optionele features. Documenteer dit expliciet in de `ModuleManifest` met een `core: true` vlag.

### 5. Module-capability gates in de UI
Als een module `requiredProviders: ['metered-api']` declareert maar de workspace heeft alleen Claude PTY, toon een duidelijke "niet beschikbaar — vereist metered API provider" state in de module-browser. Dit geeft de juiste verwachting zonder de parked build nu te triggeren.

---

## Vragen

### vraag-mod-1: Wat is de definitie van een "module" vs. een "stage type"?

**Samenvatting:** Moet een module altijd een volledig eigen scherm/navigatie-entry hebben, of is het gewoon een bundel van stage-types die in de pipeline draait?

**Gedetailleerde uitleg:** Vandaag bestaat er al het concept van een "stage type" (roleKey: 'code', 'design', etc.) dat bepaalt wat een AI-agent doet in één stap van de pipeline. Een module zou dat kunnen zijn — gewoon een nieuw type stap — maar de gebruiker lijkt te bedoelen dat een module ook eigen schermen heeft (een Designer Studio-scherm buiten de pipeline, een Interviewer-scherm, een Marketing-scherm). Dat is een groter concept: een module is dan een heel feature-gebied met eigen navigatie, eigen instellingen, en misschien eigen AI-sessies die losstaan van de pipeline. De keuze bepaalt hoeveel werk een module bouwen is en hoe modules de bestaande pipeline-infrastructuur hergebruiken.

**Opties:**

a. **Stage-type bundel** — een module is alleen een set stage-types + skill-bundels die in de bestaande pipeline passen. Geen eigen nav-entry, geen eigen scherm. Lichtst te bouwen; geen nieuwe UI-shell nodig. Designer Studio is dan gewoon een "design" stage in de pipeline. *Aanbevolen als startpunt voor v1.*

b. **Feature-module met eigen scherm** — een module kan een eigen top-level scherm/navigatie-entry hebben naast de pipeline. Rijker eindproduct maar vereist een module-panel-slot in de app-shell die nu niet bestaat. Dit is het eindplaatje voor Designer Studio, Interviewer, Marketing.

c. **Hybride: stage-type + optioneel eigen scherm** — een module declareert of hij een nav-entry wil (`navEntry?: ...` in het manifest). Minimale modules (alleen pipeline-stages) hebben er geen; rijke modules (Designer Studio) wel. Dit geeft maximale flexibiliteit.

---

### vraag-mod-2: Is de pipeline een module of de kern?

**Samenvatting:** Moet de pipeline-flow zichzelf beschouwen als één module naast Designer Studio, Interviewer, etc., of is het de onveranderlijke runtime-kern waarop alle modules bouwen?

**Gedetailleerde uitleg:** De gebruiker zei "de pipeline-flow wordt een module" — maar de pipeline is vandaag de fundamentele machine die tickets verwerkt, containers start, stages beheert, en de Conductor aanstuurt. Als je dat een module maakt die je kunt uitzetten, heb je niets meer. Aan de andere kant: als alle modules dezelfde soort "een reeks stappen uitvoeren"-logica hebben, heeft het conceptueel zin om ze allemaal als modules te behandelen, waarbij de pipeline de eerste en verplichte module is. Dit is meer een terminologie-keuze dan een technische keuze, maar het beïnvloedt hoe je het systeem aan gebruikers uitlegt en hoe de module-browser eruitziet.

**Opties:**

a. **Pipeline = CoreRuntime, altijd aan, niet uitschakelbaar** — modules zijn alleen optionele toevoegingen. De pipeline is de runtime, geen module. Duidelijkste mentaal model; minste verwarring. *Aanbevolen.*

b. **Pipeline = `CoreModule`, altijd enabled, wel zichtbaar in module-browser** — technisch een module, maar gemarkeerd als `core: true` en niet uitschakelbaar. Consistenter model (alles is een module) maar vraagt om uitlegde staat "verplicht" in de UI.

c. **Pipeline als gewone module** — pipeline kan in theorie worden uitgeschakeld. Alleen interessant als alternatieve "modes" (bv. een workspace die alleen Interviewer gebruikt zonder pipeline) een concreet use-case zijn.

---

### vraag-mod-3: Hoe installeer je modules — npm-packages of in-repo-registratie?

**Samenvatting:** Zijn modules npm-packages die je installeert (`npm i @workspaces/module-designer-studio`), of code-fixtures in de repo die bij server-boot auto-registreren?

**Gedetailleerde uitleg:** Het bestaande AgentRole-systeem werkt met code-fixtures die bij server-boot registreren — geen package-manager nodig. Dat werkt goed voor interne modules. Maar als je wilt dat externe ontwikkelaars hun eigen modules bouwen en delen, heb je een echte package-gebaseerde plugin-architectuur nodig (met versioning, compatibiliteitscontroles, etc.). Dat is aanzienlijk meer werk. Voor nu (de drie modules die de gebruiker noemde) zijn code-fixtures waarschijnlijk voldoende; de vraag is of het systeem ooit open moet zijn voor derden.

**Opties:**

a. **Code-fixtures, intern — `registerModule()` call bij server-boot** — eenvoudigst, geen package-manager integratie, alle modules zitten in de repo. *Aanbevolen voor v1.*

b. **NPM-packages — `@workspaces/module-designer-studio`** — modules zijn losse packages die de orchestrator bij boot laadt. Vereist een module-loader, versie-pinning, compatibiliteitscontroles. Schaalbaar voor een marketplace; overengineering voor drie interne modules.

c. **Hybride: interne code-fixtures nu, npm-packages later** — bouw het manifest-patroon zo dat het later npm-compatible is, maar registreer nu alles als code-fixtures. Goedkoopste pad naar toekomstbestendig design.

---

### vraag-mod-4: Per-module AI-provider selectie — nu of later?

**Samenvatting:** Het idee om per module een andere AI-provider/API-key te kiezen is aantrekkelijk, maar vecht rechtstreeks tegen een gelockte architectuurbeslissing. Wanneer pak je dit op?

**Gedetailleerde uitleg:** De architectuurdocs (`MULTI_PROVIDER_SEAM.md §4`) stellen expliciet: geen `providerKey`-veld in `types.ts` voor v1, geen driver-interface, geen capability-registry. De reden is goed: er is nog geen tweede provider om een abstractie tegen te valideren, dus het bouwen ervan nu is speculatief. Maar de gebruiker wil nu al kunnen kiezen "voor de design-tool API-key X, voor de pipeline Claude CLI". In de praktijk betekent dit: het module-systeem kan je nu bouwen (fase 1), en je kunt later per-module provider-selectie toevoegen als de multi-provider seam gebouwd wordt (fase 2). De vraag is of je de module-manifest al zo ontwerpt dat het later een `providerKey`-veld kan opnemen, of dat je dat ook uitstelt.

**Opties:**

a. **Volledig uitstellen** — module-systeem bouwen zonder enige provider-selectie. In v1 draaien alle modules op Claude PTY. Simpelste pad, maximale focus. *Aanbevolen voor v1.*

b. **Forward-compat placeholder nu** — voeg een optioneel `requiredProviders?: string[]` veld toe aan het `ModuleManifest` (puur documentatie, geen runtime-effect in v1). De module-browser toont een "vereist metered API (binnenkort)" badge als een module dit declareert. Minimale code, maximale informatiewaarde.

c. **Per-module API-key nu bouwen** — multi-provider seam nu al implementeren zodat modules verschillende providers kunnen gebruiken. Dit is weken extra werk en breekt de "parked" beslissing expliciet. Alleen aanbevolen als er al een concrete tweede provider is.

---

### vraag-mod-5: Welke drie modules bouw je als eerste, en in welke volgorde?

**Samenvatting:** Designer Studio, Interviewer, en Marketing zijn drie compleet verschillende modules qua technische complexiteit. Welke prioriteer je?

**Gedetailleerde uitleg:** De drie modules zijn niet gelijkwaardig qua bouwcomplexiteit. De Interviewer-module kan waarschijnlijk het meest leunen op bestaande infrastructuur (QuestionSet model, AIPanel, WorkspaceSuggestion) — de vraag/antwoord-mechanics zijn al ontworpen. Designer Studio vereist een nieuwe viewer en een skill-vergelijkings-UI die nu nergens bestaat. Marketing vereist Playwright MCP-integratie, media-artifact-types, en een video/afbeelding-pipeline die volledig nieuw is. Bouwen in verkeerde volgorde betekent dat je de moeilijkste module als eerste aanpakt terwijl het module-systeem zelf nog niet stabiel is.

**Opties:**

a. **Volgorde: Interviewer → Designer Studio → Marketing** — Interviewer hergebruikt het meeste (QuestionSet, AIPanel, WorkspaceSuggestion), dus het module-systeem zelf wordt bewezen op de eenvoudigste case. Designer Studio daarna als de eerste module met een echte eigen UI. Marketing als laatste, meest complex. *Aanbevolen.*

b. **Volgorde: Designer Studio → Interviewer → Marketing** — Designer Studio is het meest visueel indrukwekkend als demo-case en kan helpen early feedback te krijgen over de module-shell UI. Risico: complexer om mee te starten.

c. **Parallel bouwen** — alle drie tegelijk via aparte AI-agent-teams. Risico: het module-systeem zelf is nog niet stabiel als interface terwijl de drie modules erop bouwen. Kan werken met een goed afgebakend module-manifest-contract als shared interface.

---

### vraag-mod-6: Hoe surft een module zijn eigen schermen — eigen routes of ingebedde panels?

**Samenvatting:** Heeft een module zijn eigen top-level URL-route (`/designer-studio`) of leeft het als een panel/tab binnen bestaande schermen?

**Gedetailleerde uitleg:** De bestaande app-shell heeft vaste navigatie-entries (Board, Backlog, Terminals, Activity, Sources, Pipeline, Usage, Workspace-AI). Als een module een eigen scherm wil (zoals de Designer Studio met zijn skill-vergelijkings-canvas), heeft het twee opties: het wordt een nieuwe top-level navigatie-entry met eigen URL, of het leeft als een tab of panel binnen een bestaand scherm (bv. als extra tab in de Pipeline-editor of als Workspace-AI panel). Eigen routes zijn rijker maar vereisen wijzigingen aan de app-shell die nu niet modulair is. Panels zijn eenvoudiger maar beperkter qua layout-vrijheid.

**Opties:**

a. **Optionele nav-entry in het manifest** — de `ModuleManifest` heeft een optioneel `navEntry`-veld. Modules die een eigen scherm willen declareren dit; de NavRail voegt het item dynamisch toe op basis van geactiveerde modules per workspace. *Aanbevolen — flexibel, legt niks op.*

b. **Altijd embedded panels** — modules leven als tabs of panels in bestaande schermen. Eenvoudiger, maar betekent dat Designer Studio en Marketing hun complexe UI moeten passen in de bestaande shell-structuur.

c. **Eigen micro-frontend per module** — elke module is een volledig losgekoppelde SPA die in een iframe of shadow-DOM leeft. Maximale isolatie maar enorme bouwcomplexiteit en strijdt met het principe van één design-systeem (LuckyStack tokens + componenten voor alles).

---

### vraag-mod-7: Hoe deel je artifacts tussen modules?

**Samenvatting:** Als Designer Studio een UI-variant genereert en Marketing die wil screenshotten, hoe communiceren ze zonder directe koppeling?

**Gedetailleerde uitleg:** In de huidige architectuur zijn artifacts gebonden aan een ticket en een PipelineRun. Maar als twee modules allebei hun output willen opslaan en de andere module die output wil consumeren, is er geen gedeeld artifact-model. Dit is nu een gap (bevestigd in de corpus-analyse). Je kunt dit oplossen met een gedeeld artifact-store (alle modules schrijven ernaar, alle modules lezen ervan), of je kunt besluiten dat inter-module data-flow in v1 out-of-scope is en dat de gebruiker dat handmatig regelt.

**Opties:**

a. **Gedeeld `ModuleArtifact`-model** — een centrale tabel waar modules artifacts schrijven en lezen, adresseerbaar op `sourceModuleKey` + `kind`. Modules zijn los gekoppeld: Marketing vraagt "geef me alle `design-variant` artifacts van de laatste week" zonder te weten welke Designer Studio-sessie ze maakte.

b. **Artifact-sharing uitstellen** — in v1 zijn artifacts per-module geïsoleerd. Handmatige export/import als tussenoplossing. Eenvoudiger om nu te bouwen; defer de cross-module flow.

c. **Ticket als gedeelde context** — alle module-artifacts zijn gekoppeld aan een ticket. Als een ticket zowel een Designer Studio-stage als een Marketing-stage heeft, delen ze via het ticket-carry-over-envelop. Elegant maar werkt alleen voor modules die in dezelfde pipeline zitten.
