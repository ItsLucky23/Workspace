# Build plan 00 — Shared tool-page framework

> Auteur: architect-agent, 2026-06-15
> Scope: het herbruikbare fundament waarop Designer, Interviewer, Marketing en Document pluggen.
> Afhankelijkheden van andere build-plans: alle vier verwijzen naar dit plan. Bouw dit eerst.

---

## Doel & V1-scope

### Wat dit oplevert

1. **`ModuleManifest` + `registerModule()`** — één registratie-aanroep per module bundelt alle sub-registraties (`registerAgentRole`, `registerArtifactViewer`, `registerOrchestratorCommand`, nav-entry, settings-scherm). Modules registreren zichzelf bij server-boot, identiek aan het bestaande `registerPrismaClient`/`registerSocketMiddleware`-patroon.

2. **`WorkspaceModule`-tabel (Prisma)** — per-workspace aan/uit-data voor elke geregistreerde module. Geen code-change nodig om een module per workspace in of uit te schakelen.

3. **Module-browser UI** — een nieuw settings-tab ("Modules") met een kaarten-grid: naam, beschrijving, status-badge (enabled/disabled), één toggle. Admin-gated.

4. **Dynamische nav-entries** — de bestaande NavRail (Navbar van LuckyStack) krijgt een dynamisch slot: geactiveerde modules met een `navEntry` in hun manifest worden als extra items zichtbaar naast de core-entries (Board, Backlog, Pipeline, Terminals, Sources, …). Core-runtime items zijn altijd zichtbaar; module-items verschijnen alleen als de module enabled is voor de actieve workspace.

5. **Shared skill-model met `surface`-veld** — de bestaande `SkillEntry`/`InfoSource`-model (doc 15, `Sources.tsx`) krijgt een optioneel `surface?: 'design' | 'marketing' | 'document' | null`-veld. Skills zonder `surface` zijn pipeline-breed; skills met een `surface` worden gefilterd in de Sources Skills-tab (tab per surface + "all"). Eén tabel, één Skills-tab, gefilterd per tooltype.

6. **`ModuleArtifact`-store** — gedeeld artifact-model voor alle module-output (design-varianten, interview-resultaten, document-bestanden, media-frames). Modules schrijven hier naar; de ticket-create flow leest hier uit.

7. **Artifact → ticket-link** — bij het aanmaken van een ticket: een artifact-picker (gefilterd op type + workspace + folder) + semantic-search op `ModuleArtifact.metadata`. Geselecteerde artifacts worden opgeslagen als live-referentie (`TicketArtifactLink`): het ticket toont altijd de actuele versie van het artifact, niet een snapshot. De Stage-Agent krijgt het gekoppelde artifact als context bij het opstarten.

8. **Vrije folder-boom** — `ModuleFolder`-tabel: een simpele geneste folder-structuur per workspace per module. Modules gebruiken dezelfde UI-component (`ArtifactFolderTree`) om hun artifacts te organiseren.

### Wat V1 expliciet uitstelt (deferred)

- Per-module AI-provider-selectie (vecht tegen `MULTI_PROVIDER_SEAM.md §4`; forward-compat hint `requiredProviders?` in het manifest is docs-only, geen runtime-effect).
- NPM-package-gebaseerde plugin-installatie; V1 zijn code-fixtures, registratie bij boot.
- Module-marketplace of user-editable module-presets (identiek aan de `WorkspacePreset`-beperking in `02_PIPELINE_PRESETS.md`).
- Per-module container-budgetcap (het `CapacityManager`-budget is gedeeld; per-module reservering is post-V1).
- Cross-module triggers (bv. "als Designer klaar is, start Marketing automatisch"); dat loopt in V1 via handmatige picker.
- Module-upgrade-veiligheid met schema-versioning voor `WorkspaceModule.config` (V1: config is simpel genoeg; versioning bij eerste breaking change).

---

## Past op de bestaande corpus

### Wat al werkt als direct fundament

**AgentRole-registratiesysteem (`03_AUTOMATION_AND_PLUGINS.md §3`)** is de directe voorloper. De bestaande primitieven:

```ts
registerAgentRole({ key:'design', ... })
registerArtifactViewer('design', lazy(() => import('./DesignViewer')))
registerOrchestratorCommand('ai:refresh-docs', { run })
```

`registerModule(manifest)` is een groeperings-wrapper die intern alle drie (plus nav-entry, settings-scherm, skill-bundels) in één aanroep bundelt. Geen nieuw concept — alleen een manifest dat de drie sub-registraties coördineert.

**`WorkspaceTrigger`-engine (`03 §1`)** is volledig provider-agnostisch en events-based. Module-automatie hergebruikt bestaande `TriggerEventKind`s en voegt via `run-command` toe aan de allow-listed `OrchestratorCommandRegistry` — geen nieuwe verbs.

**`ArtifactViewerRegistry` (`03 §3.3`)** is al het extensie-punt. `TicketDetail` dispatcht al op `artifactKind`; modules registreren alleen een nieuwe viewer.

**`WorkspaceSuggestion` + `propose_suggestion` (`04b §8`, `02_PROTOCOL_AND_FLOW.md §6`)** is de bestaande surface waardoorheen modules ideeën/output pushen zonder nieuwe verbs. B-23 (AI stelt voor, Conductor schrijft) blijft ongebroken: module-output → `propose_suggestion` → menselijke accept → Conductor materialiseert.

**`[control-API]` (`CONTROL_API.md`)** — alle module-activatie-writes (toggle on/off, artifact linken, folder aanmaken) zijn `[control-API]`-requests op de `src/workspaces/_api/`-familie. De handler enqueued alleen een `WorkspaceSignal`; de Conductor schrijft. Geen inline mutaties.

**`runInTenant` (`04b §11c`)** — alle module-achtergrondpaden (artifact-indexing, folder-queries) lopen verplicht onder `runInTenant(workspaceId, …)`.

**Bestaande `Sources.tsx`-scherm (`15_SOURCES_MANAGEMENT.md`)** — de Skills/MCP-tab is het bestaande beheer-oppervlak voor skills. Het `surface`-veld voegt een filter toe zonder de bestaande tab te vervangen; de `SkillRow`-component krijgt één extra badge.

**Bestaande `WorkspaceSettings.tsx`-scherm (`16_MEMBERS_AND_RBAC.md`)** — de Modules-tab wordt als nieuw tab toegevoegd aan de bestaande `Tabs`-strip (`members | permissions | env | integrations | invites | gitlab | danger | **modules**`). Geen nieuw scherm nodig.

**NavRail/`Navbar.tsx`** — het LuckyStack `Navbar`-component accepteert al een `items: NavbarItem[]`-prop. De module-browser vult een extra sectie in de zijbalk met module-items. Geen fork van de Navbar-component.

### Spanningen met gelockte beslissingen

| Spanning | Besloten in | Aanpak |
|---|---|---|
| Geen nieuwe structured-channel verbs | `02 §2`, `03 §3.4` | Module-output loopt via bestaande `emit_carryover`/`propose_suggestion`. Geen nieuwe verbs. |
| B-23: AI schrijft nooit direct | `01 §3.3` | Module-artifacts worden gesaved door de Conductor na een `propose_suggestion`-accept, of zijn deterministisch (document-converter-container). |
| Geen `providerKey` in `types.ts` V1 | `MULTI_PROVIDER_SEAM.md §4` | `requiredProviders?` in het manifest is een forward-compat commentaar-veld, niet een runtime-route. Alle modules draaien op Claude PTY in V1. |
| Single-instance orchestrator | `01_ARCHITECTURE.md §2` | Modules draaien in hetzelfde orchestrator-process. `registerModule()` is een boot-time registratie, geen aparte service. |
| Pipeline = CoreRuntime, altijd aan | `modules-system.md §vraag-mod-2` | `core: true` op het pipeline-manifest; niet toonbaar als uitschakelbaar in de Modules-browser. Feature modules zijn optioneel. |
| Geen save-as-template | `02_PIPELINE_PRESETS.md §Deferred` | Module-configs zijn `WorkspaceModule.config` JSON; geen user-editable preset-marketplace in V1. |

---

## Datamodel

Alle nieuwe modellen zijn MongoDB/Prisma, tenant-scoped op `workspaceId`. Zie `04b_DATA_MODEL_ADDENDA.md` voor de staande conventies (append-only regels, `runInTenant`-eis, cascade op workspace-delete).

### `WorkspaceModule` — per-workspace module-activatie

```prisma
model WorkspaceModule {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  moduleKey   String   // must exist in ModuleRegistry at boot (bijv. 'designer' | 'interviewer' | 'marketing' | 'document')
  enabled     Boolean  @default(true)
  config      Json     @default("{}")    // module-specific settings; schema versioned per module-key in code
  enabledAt   DateTime @default(now())
  enabledBy   String   @db.ObjectId     // userId

  @@unique([workspaceId, moduleKey])
  @@index([workspaceId, enabled])
}
```

Activatie = één row inserteren (Admin-gated, `[control-API]` op `module-toggle`). Geen migration nodig voor nieuwe modules — de registry-key moet wel bestaan bij boot (anders: fout in de toggle-handler, niet een crash).

### `ModuleArtifact` — gedeeld artifact-store voor alle module-output

```prisma
model ModuleArtifact {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId     String   @db.ObjectId
  moduleKey       String   // 'designer' | 'interviewer' | 'marketing' | 'document'
  kind            String   // 'design-variant' | 'interview-result' | 'document-draft' | 'media-frame'
  folderId        String?  @db.ObjectId   // optioneel: in welke ModuleFolder
  title           String
  uri             String   // storage path (lokale FS of object-storage; opaque string)
  contentHash     String?  // voor dedup + change-detection
  version         Int      @default(1)   // increment bij update (voor live-referentie semantiek)
  metadata        Json     @default("{}") // module-specifiek: skills, prompt-hash, codebase-version, dimensions, etc.
  createdBy       String   @db.ObjectId  // userId
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([workspaceId, moduleKey, kind])
  @@index([workspaceId, folderId])
  @@index([workspaceId, updatedAt])        // voor recente-artifacts query in de picker
}
```

Toelichting:
- `version` + `updatedAt` realiseren de live-referentie-semantiek: een `TicketArtifactLink` verwijst naar de `ModuleArtifact.id`; het ticket toont altijd de actuele `version`, nooit een snapshot.
- `metadata` draagt module-specifieke provenance (welke skills, welke codebase-commit, afmetingen voor media). Niet typesafe in de DB maar getypeerd in module-specifieke TypeScript-interfaces.
- Dit model is NIET append-only (artifacts worden geupdated bij een nieuwe versie). Wél zijn artifacts nooit verwijderd vanuit een AI-sessie (B-23); verwijderen loopt via `[control-API]` `artifact-delete` (Admin of creator).

### `TicketArtifactLink` — live-referentie van ticket naar artifact

```prisma
model TicketArtifactLink {
  id             String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId    String   @db.ObjectId
  ticketId       String   @db.ObjectId
  artifactId     String   @db.ObjectId  // → ModuleArtifact.id
  linkedAt       DateTime @default(now())
  linkedBy       String   @db.ObjectId  // userId

  @@unique([ticketId, artifactId])
  @@index([workspaceId, ticketId])
}
```

Bij stage-spawn leest de Conductor alle `TicketArtifactLink`s voor het ticket op, haalt de actuele `ModuleArtifact`-rows op (inclusief `uri` en `metadata`), en injecteert ze als context in het stage-systeem-prompt (via de carry-over-envelope of als extra `defaultSourceIds` in de `AgentRole`). Dit is een Conductor-actie, geen nieuw verb.

### `ModuleFolder` — vrije folder-boom per module per workspace

```prisma
model ModuleFolder {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  moduleKey   String
  parentId    String?  @db.ObjectId  // null = root
  name        String
  order       Int      @default(0)   // volgorde binnen de parent
  createdAt   DateTime @default(now())

  @@index([workspaceId, moduleKey, parentId])
}
```

Maximale nesting-diepte: 5 levels (afgedwongen in de `folder-create`-handler). Geen rename-cascade nodig (folders zijn refs, artifacts verwijzen naar `folderId`).

### Uitbreiding op bestaand `InfoSource`/`SkillEntry`-model (`15_SOURCES_MANAGEMENT.md`)

Eén extra veld op de bestaande `InfoSource` Prisma-model (of equivalent — doc 15 spreekt van `SkillEntry` als UI-type dat `InfoSource{mode:'skill'}` spiegelt):

```prisma
// Addendum op bestaand model — één veld toevoegen:
// InfoSource.surface String?   // null = pipeline-breed; 'design'|'marketing'|'document' = module-specifiek
```

Dit veld is optioneel en heeft geen effect op de bestaande pipeline-logica. De Sources-tab filtert skills op `surface` als een module-tab actief is.

### `ModuleManifest` — TypeScript-interface (code-only, niet Prisma)

```ts
interface ModuleManifest {
  key: string;                   // 'designer' | 'interviewer' | 'marketing' | 'document'
  label: string;
  description: string;
  version: string;               // semver, voor logging; geen runtime-compat-check in V1
  core?: boolean;                // true = altijd enabled, niet uitschakelbaar (pipeline: core:true)
  navEntry?: {
    icon: IconDefinition;        // FontAwesome IconDefinition (zie Navbar.tsx)
    label: string;
    route: string;               // bijv. '/workspaces/:wsId/designer'
    requiredCapability?: string; // RBAC_CAPABILITIES-key; default = 'work-on-tickets'
  };
  agentRoles?: AgentRole[];      // 03 §3.2 — worden intern doorgestuurd naar registerAgentRole()
  artifactViewers?: Array<{
    kind: string;
    component: string;           // lazy-load key voor ArtifactViewerRegistry
  }>;
  orchestratorCommands?: Array<{
    key: string;
    run: () => Promise<void>;
  }>;
  defaultTriggers?: WorkspaceTrigger[];  // suggesties, worden als seed aangeboden bij enable
  settingsRoute?: string;        // relatief pad naar module-settings-scherm (bijv. '?tab=designer-settings')
  requiredProviders?: string[];  // forward-compat hint (geen runtime-effect V1); bijv. ['metered-api']
}
```

`registerModule(manifest)` roept intern aan:
- `manifest.agentRoles?.forEach(r => registerAgentRole(r))`
- `manifest.artifactViewers?.forEach(v => registerArtifactViewer(v.kind, lazy(() => import(v.component))))`
- `manifest.orchestratorCommands?.forEach(c => registerOrchestratorCommand(c.key, c))`
- Slaat `manifest.navEntry` op in een `NavEntryRegistry` die de NavRail-component leest.
- Slaat het manifest zelf op in een `ModuleRegistry` (een in-memory `Map<string, ModuleManifest>`) voor de Modules-browser.

---

## UX & flows

### Modules-browser (WorkspaceSettings → tab "Modules")

**Desktop:**

```
Workspace Settings
[ Members ] [ Permissions ] [ Env ] [ Integrations ] [ Invites ] [ GitLab ] [ Danger ] [ Modules ]

Modules                                                                  (Admin+ only)

Core
┌──────────────────────────────────────────────────────┐
│ 🔧 Pipeline           altijd ingeschakeld            │
│   De core AI-orchestratie engine. Kan niet worden    │
│   uitgeschakeld.                                     │
└──────────────────────────────────────────────────────┘

Optionele tools
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ ✏️ Interviewer    │ │ 🎨 Designer       │ │ 📄 Document       │ │ 📣 Marketing      │
│ Verken ideeën    │ │ Genereer UI-ont- │ │ Schrijf docs,    │ │ V2 — setup only  │
│ met AI-gestuurde │ │ werpen vanuit de │ │ rapporten en     │ │                  │
│ vragenronde.     │ │ echte codebase.  │ │ presentaties.    │ │                  │
│                  │ │                  │ │                  │ │                  │
│ [● Ingeschakeld] │ │ [○ Uitgeschak.]  │ │ [● Ingeschakeld] │ │ [V2]             │
└──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘
```

- Kaarten tonen `label`, `description`, en de enabled/disabled `Toggle` (LuckyStack `Toggle`-component).
- Core-modules (pipeline) krijgen een `locked`-badge; geen toggle.
- Modules met `requiredProviders` die niet beschikbaar zijn tonen een subtiele badge "Vereist metered API" — disabled, niet verborgen.
- Marketing V1 = UI-only `V2`-badge, toggle disabled.
- Toggle is een `[control-API]` `module-toggle`-request (RBAC: Admin+). Optimistische pending-state; bevestiging via realtime merge-on-seq.

**Mobile:** kaarten stapelen verticaal. Toggle blijft zichtbaar; description truncated na 2 regels met "toon meer".

**Na het inschakelen van een module:**
1. Realtime update: nav-entry verschijnt in de zijbalk (subscribe-first → merge-on-seq).
2. Als het manifest `defaultTriggers` heeft: de Conductor maakt een `WorkspaceSuggestion{type:'automation'}` aan met de trigger-drafts als `patch`. De gebruiker ziet een "Suggestie: stel automatisering in?" banner in het module-scherm.
3. De module-pagina is direct bereikbaar via de nieuwe nav-entry.

### Module tool-pagina (generiek shell)

Elke module-pagina heeft dezelfde shell:

```
[ Workspace-naam ]  >  [ Module-naam ]

┌─ Zijpaneel (folder-boom) ──────┐  ┌─ Hoofd-inhoud ──────────────────────────────┐
│ + Nieuwe map                   │  │  [ leeg ] of [ artifact-grid / sessie-lijst ] │
│ 📁 Campagne Q3                 │  │                                               │
│   📁 Social media              │  │                                               │
│ 📁 Brand refresh               │  │                                               │
│                                │  │                                               │
└────────────────────────────────┘  └───────────────────────────────────────────────┘

[ + Nieuwe sessie / genereer ]   ← module-specifieke actieknop (rechtsonder of header)
```

De folder-boom (`ArtifactFolderTree`-component, nieuw, gedeeld door alle modules) rendert `ModuleFolder`-rows. Drag-to-reorder binnen dezelfde parent is V1 (simpele `order`-update via `[control-API]` `folder-reorder`). Nesting tot 5 levels.

**Lege state:** "Nog geen [artifacts]. Klik op '+ Nieuwe sessie' om te beginnen." — elke module vult de specifieke label in.

**Mobile:** folder-boom collaps achter een "Mappen ▾"-dropdown boven de inhoud.

### Artifact → ticket-link flow (bij ticket-aanmaken)

Ticket-create-sheet (`Quick-add` + `+ more options`): een nieuw veld "Gekoppelde artifacts":

```
+ Artifact koppelen   [ Zoek of blader… ]
```

1. Klikken opent een `menuHandler`-modal (centered, niet sidebar).
2. Modal toont: een zoekbalk (semantische search op `ModuleArtifact.title` + `metadata`-tekst) + een filter op module-type (Designer / Interviewer / Document) + een folder-browse.
3. Resultaten: `ArtifactPickerCard` — thumbnail (indien beschikbaar) + titel + module-badge + datum.
4. Selecteren voegt het artifact toe als live-referentie. Meerdere artifacts selecteerbaar.
5. In de ticket-create-sheet verschijnen de geselecteerde artifacts als chips ("Design: Login Variant B · 12 jun").

Bij ticket-submit: de Conductor slaat de `TicketArtifactLink`s op. Bij stage-spawn leest de Conductor de gelinkte artifacts en injecteert de content/URI als context in de `AgentRole`-promptTemplate (als extra `defaultSourceIds`-entries of als een fenced block in de carry-over-envelope).

**Semantic search:** de `ModuleArtifact.metadata`-tekst (titel, beschrijving, tags uit het metadata-JSON) wordt geindexeerd in de bestaande RAG-store (doc 07 §D). Query gaat via `$vectorSearch`; de picker toont top-10 resultaten.

### Skills-tab in Sources — gefilterd per module-surface

De bestaande `Sources.tsx` Skills/MCP-tab krijgt een extra filter-strip boven de skills-lijst:

```
[ Alle skills ] [ Pipeline ] [ Designer ] [ Marketing ] [ Document ]
```

Filter-tabs verschijnen alleen als de corresponderende module enabled is én skills heeft met dat `surface`-veld. Klikken filtert `SkillEntry`-rows op `surface`. "Alle skills" toont alles (huidig gedrag, onveranderd).

---

## Bouwstappen (geordend)

### Fase 1 — Datamodel + registratie (geen UI)

**Doel:** het skelet klopt; modules kunnen registreren; de data bestaat.

- [ ] **F1.1** Prisma-migratie: voeg `WorkspaceModule`, `ModuleArtifact`, `TicketArtifactLink`, `ModuleFolder` toe. Voeg `InfoSource.surface String?` toe als optioneel veld.
- [ ] **F1.2** `types.ts`-backfill: voeg `WorkspaceModule`, `ModuleArtifact`, `TicketArtifactLink`, `ModuleFolder`, `ModuleManifest`-interfaces toe (volg `04b §15`-patroon).
- [ ] **F1.3** `ModuleRegistry` (server-boot): een in-memory `Map<string, ModuleManifest>` + `registerModule(manifest: ModuleManifest): void`. Roept intern `registerAgentRole`/`registerArtifactViewer`/`registerOrchestratorCommand` aan.
- [ ] **F1.4** `NavEntryRegistry` (client): een gesorteerde lijst van `navEntry`-items van enabled modules, per workspace opgehaald via een bestaand socket-event of als onderdeel van de workspace-snapshot.
- [ ] **F1.5** Pipeline-`CoreModule` registreren: `registerModule({ key:'pipeline', core:true, label:'Pipeline', ... })` — puur documentatie, geen functionele verandering.
- [ ] **F1.6** `[control-API]`-routes toevoegen aan `CONTROL_API.md`-catalogue:
  - `module-toggle` (target: `{ workspaceId, moduleKey, enabled }`, RBAC: Admin+)
  - `artifact-create` / `artifact-update` / `artifact-delete` (RBAC: work-on-tickets / creator+Admin)
  - `folder-create` / `folder-rename` / `folder-reorder` / `folder-delete` (RBAC: work-on-tickets)
  - `ticket-artifact-link` / `ticket-artifact-unlink` (RBAC: work-on-tickets)
- [ ] **F1.7** Verifieer: `npm run lint && npm run build` — zero errors. Geen UI-changes in deze fase.

### Fase 2 — Module-browser UI (WorkspaceSettings-tab)

**Doel:** Admin kan modules aan/uitzetten.

- [ ] **F2.1** Voeg `modules`-tab toe aan `WorkspaceSettings.tsx`-tabstrip.
- [ ] **F2.2** Bouw `ModuleBrowserTab`-component:
  - Core-sectie: kaart per `core:true` module, locked badge, geen toggle.
  - Feature-sectie: kaart per feature-module (uit `ModuleRegistry`), `Toggle` (LuckyStack), `enabled`-state uit `WorkspaceModule`-rows.
  - `requiredProviders`-badge (als forward-compat hint, geen blocker).
  - V2-badge voor Marketing (disabled toggle).
- [ ] **F2.3** Wire `module-toggle` control-API call. Optimistisch pending-state; bevestiging via realtime merge-on-seq.
- [ ] **F2.4** Na enable: realtime nav-entry-update via workspace-room socket broadcast. Client-side: voeg de nav-entry toe aan `NavEntryRegistry`; NavRail re-rendert.
- [ ] **F2.5** Verifieer: toggle aan/uit werkt; nav-entry verschijnt/verdwijnt live.

### Fase 3 — Dynamische NavRail-entries

**Doel:** modules die een `navEntry` declareren verschijnen in de zijbalk.

- [ ] **F3.1** Voeg een `moduleItems`-sectie toe aan de `Navbar`-itemslijst (na de core-entries, voor de workspace-settings-entry). Items komen uit `NavEntryRegistry`.
- [ ] **F3.2** RBAC-gate: als `navEntry.requiredCapability` opgegeven is, toon de entry alleen als de actieve user die capability heeft.
- [ ] **F3.3** Lege state per module-pagina: een placeholder-scherm met de module-naam + "Schakel in via Instellingen → Modules" als de module disabled is maar de route direct bezocht wordt.

### Fase 4 — Gedeeld tool-pagina shell + folder-boom

**Doel:** de herbruikbare shell die alle vier modules invullen.

- [ ] **F4.1** `ModulePageShell`-component: zijpaneel (folder-boom) + hoofd-inhoud-slot + header met actieknop-slot.
- [ ] **F4.2** `ArtifactFolderTree`-component: rendert `ModuleFolder`-boom, create/rename/delete-folder-acties (via control-API), drag-to-reorder binnen dezelfde parent.
- [ ] **F4.3** `ArtifactGrid`-component: grid van `ModuleArtifact`-cards voor het geselecteerde folder (of alles). Kaart toont: titel, kind-badge, datum, module-badge, thumbnail (indien `uri` een afbeelding is).
- [ ] **F4.4** Wire folder-CRUD control-API calls. Verifieer realtime sync via workspace-room.

### Fase 5 — Skill-surface filter in Sources

**Doel:** skills zijn gefilterd per module in de bestaande Skills-tab.

- [ ] **F5.1** Voeg `surface`-filterbalk toe aan de Skills/MCP-sectie van `Sources.tsx`.
- [ ] **F5.2** Filter-tabs verschijnen alleen als de module enabled is én skills met dat `surface`-veld bestaan.
- [ ] **F5.3** Verifieer: "Alle skills" toont alles (bestaand gedrag); filter-tab toont only skills met dat surface.

### Fase 6 — Artifact → ticket-link

**Doel:** bij ticket-aanmaken kan een artifact worden gekoppeld; de Stage-Agent ontvangt het als context.

- [ ] **F6.1** `ArtifactPickerModal`-component: zoekbalk (semantische search via bestaande RAG-endpoint) + module-type-filter + folder-browse + multi-select.
- [ ] **F6.2** Voeg "Gekoppelde artifacts"-veld toe aan de Quick-add-sheet en de uitgebreide ticket-create-sheet.
- [ ] **F6.3** Wire `ticket-artifact-link` control-API call bij ticket-submit. Conductor slaat `TicketArtifactLink`s op.
- [ ] **F6.4** Conductor-aanpassing: bij stage-spawn leest de Conductor `TicketArtifactLink`s voor het ticket op; injecteert artifact-URIs + metadata als context in de stage-promptTemplate.
- [ ] **F6.5** `TicketDetail`-widget: toon gelinkte artifacts als chips (klikbaar → artifact-detail overlay). Update live bij nieuwe versie van het artifact (via `ModuleArtifact.version`-increment).
- [ ] **F6.6** Semantic indexing: zorg dat `ModuleArtifact.title` + relevante `metadata`-tekst meegenomen wordt in de RAG-delta-indexer (doc 07 §D). Dit is een addendum op de indexer, niet een nieuwe queue.

### Fase 7 — Integratie-smoke-test

**Doel:** het framework draagt de eerste echte module (Interviewer, build-plan 01).

- [ ] **F7.1** Registreer de Interviewer als eerste echte `FeatureModule` via `registerModule()`. Verifieer dat zijn nav-entry verschijnt, zijn pagina laadt, en zijn artifacts in de picker beschikbaar zijn.
- [ ] **F7.2** End-to-end: schakel Interviewer in → maak een interview-sessie → sla een interview-result op als `ModuleArtifact` → maak een ticket → koppel het interview-result → verifieer dat de Stage-Agent het ontvangt in zijn context.
- [ ] **F7.3** `npm run lint && npm run build && npm run test` — zero errors.

---

## Risico's & open punten

### Risico's

**R1 — Scope-creep per module (hoog)**
Als elke module zijn eigen routes, viewers, skill-bundels én settings-schermen declareert in één manifest, groeit de `registerModule()`-aanroep snel. Mitigatie: houd het manifest minimaal (V1: een module MAG een nav-entry + één viewer hebben, meer is optioneel). De eerste module (Interviewer) is de eenvoudigste case; als die het framework bewijst, pas daarna uitbreiden.

**R2 — `WorkspaceModule.config` schema-drift (medium)**
Als een module zijn config-schema verandert, kan bestaande JSON in `WorkspaceModule.config` niet meer deserializeren. V1 heeft eenvoudige config-schemas (alleen aan/uit + een handvol instellingen); voeg schema-versioning toe bij de eerste breaking change. Mitigatie: documenteer nu al een `configVersion`-veld als conventie, ook al valideer je het nog niet.

**R3 — ModuleArtifact-storage-backend (medium)**
`ModuleArtifact.uri` is een opaque string; de vraag is wat er achter zit (lokale FS, object-storage). V1 is self-hosted, dus lokale FS (hetzelfde pad als de bestaande container-volumes) is acceptabel. Risico: als meerdere modules tegelijk grote binaries genereren (video van Marketing, design-exports van Designer), kan de FS-ruimte vol raken. Mitigatie: voeg een simpele `max_artifact_storage_mb`-workspace-instelling toe als safety-net (soft cap, geen hard blocker).

**R4 — NavRail dynamisch slot introduceert race-condition (laag)**
Als de workspace-snapshot nog niet geladen is maar de module-entry al navigeerbaar is, ziet de user een lege pagina. Mitigatie: de lege-state (Fase 3.3) vangt dit op. De nav-entry is pas zichtbaar na de eerste workspace-snapshot-merge (bestaande B-22 subscribe-first-contract).

**R5 — Semantic search op `ModuleArtifact` vereist RAG-indexing (medium)**
De artifact-picker-search werkt via de bestaande `$vectorSearch`. Dit betekent dat nieuwe artifacts pas doorzoekbaar zijn nadat de delta-indexer loopt. V1 accepteert dit als gedrag ("net aangemaakt artifact kan nog niet gevonden worden via search; blader via folder of gebruik de recente-lijst"). Voeg een tooltip toe in de picker die dit uitlegt.

**R6 — CapacityManager-budget gedeeld met modules (laag-medium)**
Designer en Document spawnen containers (screenshot-preview, LibreOffice/pandoc). Deze trekken uit hetzelfde `MAX_RESIDENT`-budget als de pipeline-stages (`07b_CONTAINER_RUNTIME.md §8`). V1: geen per-module reservering; vertrouw op de bestaande preferred-reclaim-volgorde (CI-jobs zijn preferred reclaim victims). Escaleer naar een per-module budgetcap als dit in de praktijk knelt.

**R7 — RBAC-grens voor artifact-verwijdering (laag)**
`artifact-delete` is gated op "creator of Admin". Als een module-artifact gelinkt is aan een open ticket, is verwijdering destructief (de link wordt een dode referentie). Mitigatie: de `artifact-delete`-handler controleert actieve `TicketArtifactLink`s; als er links zijn, weigert de handler met een foutmelding ("artifact is gekoppeld aan N tickets — ontkoppel eerst").

### Open punten

**O1 — Folder-boom vs. flat lijst voor simpele modules**
Interviewer heeft in V1 mogelijk weinig artifacts; een folder-boom is overkill. De `ModulePageShell` moet ook goed werken zonder folders (lege `parentId = null` = alle artifacts in de root, flat list). Dit is een UX-keuze per module, niet een infrastructuur-keuze.

**O2 — Artifact-update-semantiek bij live-referentie**
Als een Designer een artifact update terwijl een Stage-Agent al bezig is met een gekoppeld ticket, ontvangt die agent de oude versie. De Conductor injecteert artifacts alleen bij stage-spawn; tussentijdse updates bereiken de lopende sessie niet. V1 accepteert dit (inject bij spawn is het contract). Documenteer dit expliciet in de Conductor-code.

**O3 — Welk `surface`-veld standaard voor skills die zowel pipeline als een module dienen?**
Een RAG-skill is pipeline-breed. Een "design-system-tokens"-skill is relevant voor Designer maar ook voor pipeline-stages. Oplossing: `surface: null` = pipeline-breed (altijd zichtbaar); `surface: 'design'` = extra zichtbaar in het Designer-filter maar ook zichtbaar in "Alle skills". Geen exclusiviteit — het is een filter-tag, niet een eigenaarschap-claim.

**O4 — Module-default-triggers: seed bij enable of toon als suggestion?**
Het manifest heeft `defaultTriggers?`. Twee opties: (a) automatisch seeden als `WorkspaceTrigger`-rows bij enable, of (b) als `WorkspaceSuggestion{type:'automation'}` aanbieden zodat de user kiest. B-23 stuurt naar (b); V1 implementeert (b) — Conductor maakt een suggestion aan, user accepteert. Dit staat niet vast in de data en kan per module worden overschreven.
