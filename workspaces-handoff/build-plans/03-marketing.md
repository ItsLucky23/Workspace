# Build-plan 03 — Marketing (V1 = setup only)

> Status: DRAFT · Auteur: AI architect · Datum: 2026-06-15  
> Gebaseerd op: `modules/marketing-module.md`, `round2/marketing-scope.md`, `round3/marketing-deep.md`,
> `features/14_TERMINALS.md`, `features/23_PREVIEW_DEPLOYMENT.md`,
> `features/15_SOURCES_MANAGEMENT.md`, `07b_CONTAINER_RUNTIME.md`.  
> Bouw-gereed spec voor het Marketing-setup-skelet. De builder volgt dit document van boven naar beneden;
> elke bouwstap heeft een verificatieregel.

---

## Doel & V1-scope

### Wat V1 levert

Een **standalone Marketing-pagina** in de workspace-sidebar — zelfde navigatieniveau als board, backlog, pipeline, terminals, Interviewer en Designer. De pagina heeft folders, een marketing-skill-configuratie (toon + formaat/afmetingen + stijlrichting, `surface:'marketing'`), een asset-aanvraagformulier (type, onderwerp/feature, skill, context-selectie) met een **disabled/V2-badge op de generatie-actie**, een Playwright-capture-configuratie die wijst naar een reeds-geconfigureerde pipeline-serverterminal, en één generiek media-API-integratie-key-slot in de workspace-instellingen.

V1 bewijst de structuur, niet de output. Na V1 kan een builder-AI voor V2 de generatie "inklikken" in het bestaande formulier-skelet zonder UX-redesign.

### V1 omvat

- Eigen tool-pagina (`/workspaces/[wsId]/marketing`) als `FeatureModule`, default **ON** per workspace.
- **Free folder tree** per workspace (zelfde patroon als Designer en het gedeelde tool-page framework).
- **Marketing-skill definitie** met drie velden: toon, formaat/afmetingen, stijlrichting. `surface:'marketing'` onderscheidt ze van `surface:'design'` in de bestaande `SkillEntry`-infra (`features/15_SOURCES_MANAGEMENT.md`). Skills worden geconfigureerd in de bestaande Sources / Skills-tab, gefilterd op `surface:'marketing'`.
- **Asset-aanvraagformulier** met velden: asset-type (thumbnail / poster / OG-image / social-card), onderwerp of feature, skill-picker (filtered op `surface:'marketing'`), context-selector (hergebruikt de pipeline-editor context-selectie — zie §Hergebruik).
- **Generatie-actie**: knop aanwezig, maar **disabled** met tooltip "Generatie beschikbaar in V2".
- **Playwright-capture configuratie**: een instelling per workspace die een reeds-geconfigureerde pipeline-serverterminal aanwijst als screenshot-bron (conform `round3/marketing-deep.md` V-4a en `features/14_TERMINALS.md`). V1 slaat de URL op; Playwright-aanroepen zijn V2.
- **Eén generiek media-API-integratieveld** (`key:'media-api'`) in de workspace-integraties — een lege key-slot als reserved-slot, conform het bestaande `IntegrationTool + EnvVar`-model (`03_AUTOMATION_AND_PLUGINS.md §5`).
- Alle strings via `useTranslator`; alle kleuren via `@theme`-tokens.

### Expliciet V2 (niet in V1)

| Item | Reden |
|---|---|
| Daadwerkelijke asset-generatie (Claude, SVG/HTML of externe API) | Kern van V2; V1 bouwt alleen het formulier-skelet |
| Playwright-screenshots ophalen en aanbieden als input | Vereist draaiende serverterminal + Playwright-aanroep; V1 slaat alleen de config op |
| Externe media-API integreren (DALL-E, SD, etc.) | Multi-provider seam is expliciet geparkeerd (`marketing-module.md §Risico's`); V1 reserveert slechts één key-slot |
| Video-generatie | Vereist metered-API backend, botst met PTY-billing locked decision (`marketing-module.md §Spanningen` — "cannot coexist without the multi-provider seam") |
| Artifact-koppeling aan ticket (picker + semantische search) | Pas zinvol als er artifacts zijn; ontwerpen maar niet bouwen |
| WorkspaceSuggestion + B-23 accept-flow voor gegenereerde assets | Geen assets = geen suggestions in V1 |
| Automatische WorkspaceTrigger (`ticket.merged → start marketing-stage`) | V2 als generatie werkt |
| `AgentRole{ key:'marketing' }` registratie + outputSchema | Pas nodig als de generatie-agent bestaat |
| `ArtifactViewerRegistry` voor media-artifacts | Geen artifacts om te tonen in V1 |

---

## Past op de bestaande corpus

### Nul core changes

Identiek aan de Designer: de Marketing-pagina is een **additive registration** (`03_AUTOMATION_AND_PLUGINS.md §7`). Geen wijziging aan het trigger-systeem, de verb-surface (`02 §2`, locked: 7 worker + 6 assistant verbs), of het protocol. V1 voegt alleen data en UI toe.

### Hergebruikte bouwstenen

| Bouwsteen | Hergebruik in V1 | Bron |
|---|---|---|
| `SkillEntry` + Sources / Skills-tab | Marketing-skills als `SkillEntry`-rijen met `surface:'marketing'`; zelfde kaart-UI, filter op surface | `features/15_SOURCES_MANAGEMENT.md`, `_data/types.ts` |
| `InfoDoc` + Sources / Context-tab | Uploads (brand-kit docs, referentie-afbeeldingtekst) als `InfoDoc{source:'uploaded'}` in de bestaande upload-flow | `features/15_SOURCES_MANAGEMENT.md §8` |
| Pipeline-editor context-selector | Hergebruikt 1:1 in het asset-aanvraagformulier (conform `round3/marketing-deep.md` V-3a) | `03_AUTOMATION_AND_PLUGINS.md §3.2` `defaultSourceIds` + pipeline Context & Skills tab |
| `IntegrationTool + EnvVar` model | `media-api`-key-slot als `IntegrationTool{ key:'media-api', envKey:'MEDIA_API_KEY' }` | `03_AUTOMATION_AND_PLUGINS.md §5` |
| `Terminal`-configuratie-mechanisme | Marketing legt `captureTerminalId` vast (wijst naar een `Terminal`-process in de pipeline-config); geen nieuwe terminal-spawn | `features/14_TERMINALS.md`, `_data/types.ts Terminal` |
| `FeatureModule`-toggle | `{ id:'marketing', label:'Marketing', icon:faMegaphone, core:false }` zelfde patroon als Interviewer en Designer | locked decisions tools framework |
| Folder tree + free organisatie | Zelfde free-folder-tree als het gedeelde tool-page framework; geen nieuwe infra | locked decisions tools framework |
| `WorkspaceSettings`-scherm | Media-API key-slot én Playwright-capture-config landen als nieuwe rijen in het bestaande settings-scherm | bestaande settings-UI |

### Documentcitaten: terminals-koppeling

`features/14_TERMINALS.md §Scope` beschrijft dat terminals behoren tot de `PipelineStageCfg.processes`-config en dat het terminals-scherm slechts *attach* aan bestaande live sessies. De Marketing-capture-config doet hetzelfde: hij wijst naar een terminal die al door de pipeline geconfigureerd en gestart is (`Terminal.processes[name:'server']`). Marketing start nooit zelf een terminal — dat is een developer action (Rule 8, `01_ARCHITECTURE.md §8`).

`features/23_PREVIEW_DEPLOYMENT.md §Scope` markeert "shared/persistent preview that outlives the TTL" als deferred. De Marketing-capture wijst in V1 naar een **extern geconfigureerde URL** (de pipeline-serverterminal of een staging-URL), niet naar een ephemeral preview-container. Dit omzeilt de preview-dependency die `marketing-module.md §Risico's` beschrijft.

`07b_CONTAINER_RUNTIME.md §8` toont dat de CapacityManager de shared pool bewaakt. De Marketing-pagina in V1 start **geen container** (geen generatie, geen worktree). Er is geen capacity-impact in V1.

### Spanningen met locked decisions

**Geen nieuwe verbs.** De enige schrijfactie in V1 is het opslaan van `MarketingFolder`, `MarketingAssetRequest` en `MarketingWorkspaceConfig` via control-API-ops. Geen `emit_*` verb, geen structured-channel toevoeging.

**B-23: AI proposeert, Conductor schrijft.** De generatie-knop is disabled in V1. In V2 geldt: gegenereerde assets → `WorkspaceSuggestion` → user Accept → Conductor schrijft. Het V1-formulier is al ingericht op dit flow-patroon (formulier → disabled actie → future Suggestion).

**PTY-billing / interactive PTY only.** V1 start geen LLM-sessie. Het is pure UI + config-opslag. De kosten-melding ("dit start een AI-sessie") staat in het formulier maar boven de disabled generatie-knop — als forward-reference naar V2 zonder een actieve beurt te starten.

**Multi-provider seam geparkeerd (locked).** Het generieke `media-api`-integratieveld is bewust provider-agnostisch: het past straks zowel in de pragmatische IntegrationTool-aanpak (één key-slot, `round2/marketing-scope.md` V-5a) als in een eventueel toekomstig multi-provider model. V1 verpint niks aan een specifieke dienst.

**Geen video in V1 (noch V2 zonder expliciete beslissing).** Video-generatie vereist metered-API backends (Runway/Sora/Pika), die botsen met het PTY-subscription-billing model (`marketing-module.md §Spanningen`). V1 benoemt video niet als optie in het asset-type-veld. Als V2 video wil, moet de multi-provider seam eerst gebouwd worden — dit plan noteert het maar schrijft het niet voor.

**Skill-deduplicatie met Designer.** Marketing-skills en Design-skills gebruiken **dezelfde** `SkillEntry`-infrastructuur, gefilterd op `surface`. Dit is conform `marketing-module.md §Extra ideeën §6` en `round2/marketing-scope.md §Gedeelde skill-bibliotheek`. Geen parallelle skill-implementatie.

---

## Datamodel

### Nieuwe entiteiten

#### `MarketingFolder`

```prisma
model MarketingFolder {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  name        String
  parentId    String?  @db.ObjectId   // null = root-folder
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([workspaceId, parentId])
}
```

Mirrors het folder-tree-patroon dat ook de Designer-pagina volgt. Geen nesting-limiet in V1 (builder kiest een practical default ≤5 deep).

#### `MarketingAssetRequest`

```prisma
model MarketingAssetRequest {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  folderId    String?  @db.ObjectId   // null = root
  assetType   String   // 'thumbnail' | 'poster' | 'og-image' | 'social-card'
  subject     String   // vrij tekstveld: "feature X uitlichten", "release 1.2.0"
  skillId     String?  // SkillEntry.id met surface:'marketing'; null = geen skill gekozen
  contextIds  Json     // string[] van sourceIds (zelfde selectie als pipeline-editor)
  status      String   // 'draft' | 'generating' | 'done' | 'failed'
  // V2-velden (gereserveerd, nullable in V1):
  artifactUri String?  // URI van het gegenereerde asset (V2)
  agentSessionId String? // de AgentSession.id van de generatie-agent (V2, audit)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([workspaceId, folderId])
  @@index([workspaceId, status])
}
```

In V1 is `status` altijd `'draft'` — het formulier slaat op maar triggert niets.

#### `MarketingWorkspaceConfig`

```prisma
model MarketingWorkspaceConfig {
  id                  String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId         String   @unique @db.ObjectId
  captureTerminalId   String?  // Terminal.ticketId + process naam als "{ticketId}:{processName}"
                               // wijst naar een bestaande pipeline-serverterminal (V2 gebruikt dit voor Playwright)
  captureBaseUrl      String?  // override: externe URL (staging/productie) als captureTerminalId null is
  mediaApiKeySet      Boolean  @default(false)  // derived: is de MEDIA_API_KEY IntegrationTool gevuld?
  updatedAt           DateTime @updatedAt
}
```

`captureTerminalId` volgt het `(ticketId, processName)` sessie-schema dat `features/14_TERMINALS.md §UI` beschrijft als `sessionId = ${ticketId}:${proc.name}`. Zo wijst de config naar een concreet lopend server-process.

#### Wijzigingen op bestaande modellen

| Model / veld | Delta | Motivatie |
|---|---|---|
| `SkillEntry.surface` | voeg `'marketing'` toe naast `'design'` (en `undefined` voor ongeclassificeerde skills) | filters de Marketing-skillpicker in het aanvraagformulier; geen structural change, enkel een extra waarde in de typedefinitie (`_data/types.ts`) |
| `AiSuggestion.type` | (V1: geen wijziging) V2 voegt `'marketing-asset'` toe | bewust uitgesteld tot er assets zijn om te suggereren |
| `IntegrationTool` (server-side) | voeg één rij toe voor `key:'media-api'` als `seed/migrations`-entry; de UI toont hem als lege key-slot in workspace-integraties | reserved slot; werkt via bestaand `EnvVar`-model uit `03 §5` |
| `Workspace.features` (JSON-veld of aparte table) | voeg `'marketing': true` toe als default | FeatureModule-toggle; zelfde patroon als Interviewer |

#### Control-API uitbreidingen (geen nieuwe verbs)

| `op` | Target | RBAC | Conductor action |
|---|---|---|---|
| `create-marketing-folder` | `{ workspaceId, name, parentId? }` | work-on-tickets | Persist `MarketingFolder`; broadcast update |
| `rename-marketing-folder` | `{ folderId, name }` | work-on-tickets | Rename; broadcast |
| `delete-marketing-folder` | `{ folderId }` | admin | Soft-delete + cascade requests naar root; broadcast |
| `save-marketing-request` | `{ workspaceId, folderId?, assetType, subject, skillId?, contextIds }` | work-on-tickets | Persist `MarketingAssetRequest(status:'draft')`; broadcast |
| `update-marketing-capture-config` | `{ workspaceId, captureTerminalId?, captureBaseUrl? }` | admin | Upsert `MarketingWorkspaceConfig`; broadcast |

Alle routes: `login:true`, `preApiExecute` RBAC-check → enqueue → `ControlAck`. Geen generatie-op in V1 — de "Genereer"-knop is disabled.

---

## UX & flows

### Navigatie

Marketing verschijnt als een sidebar-item naast board/backlog/pipeline/terminals/interviewer/designer. Icoon: `faBullhorn` (FontAwesome). Alleen zichtbaar als `workspace.features.marketing === true` (default ON). Route: `src/workspaces/[wsId]/marketing/page.tsx`.

### Scherm 1: Marketing-landingspagina

```
┌──────────────────────────────────────────────────────────────┐
│  📣 Marketing                          [ + Nieuwe map ]  [⚙] │
│                                                              │
│  ┌─ 📁 Campagne Q3 ────────────────────────────────────┐    │
│  │  thumbnail_feature_ai.png   [draft]  8 jun           │    │
│  │  og_image_v2.png            [draft]  7 jun           │    │
│  │  [ + Aanvraag toevoegen ]                            │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─ 📁 App Store ──────────────────────────────────────┐    │
│  │  (leeg)  [ + Aanvraag toevoegen ]                   │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  📁 Root  [ + Aanvraag toevoegen ]                           │
│                                                              │
│  [ + Nieuwe map ]                                            │
└──────────────────────────────────────────────────────────────┘
```

- Elke folder is uitklapbaar (default open); drag-drop tussen folders is V2.
- Asset-aanvragen tonen: type-badge, titel (subject), status-chip (`draft` / V2: `generating` / `done` / `failed`), datum.
- `[⚙]`-knop → Marketing-instellingen overlay (capture-config + media-API-key-status).
- `[ + Nieuwe map ]` → inline naamgeving (reuse bestaand patroon).
- `[ + Aanvraag toevoegen ]` → opent het aanvraagformulier (scherm 2).

**Mobile:** één kolom, folders collapsible met een chevron-tap, `[ + Aanvraag ]`-button sticky-bottom.

### Scherm 2: Asset-aanvraagformulier

```
┌─ Nieuwe marketing-aanvraag ──────────────────────────────[✕]─┐
│                                                              │
│  Map          [ Campagne Q3 ▼ ]                              │
│                                                              │
│  Type asset   ● Thumbnail   ○ Poster                         │
│               ○ OG-image    ○ Social card                    │
│                                                              │
│  Onderwerp    [ Feature: AI-assistent lancering         ]    │
│               e.g. "feature X uitlichten", "release 1.2.0"  │
│                                                              │
│  Skill        [ Zakelijk · 1200×628px · Minimalistisch ▼ ]  │
│               Gefilterd op marketing-skills                  │
│                                                              │
│  Context      ──────────────────────────────────────────     │
│               ☑ project-summary (generated)                  │
│               ☑ conventions (git)                            │
│               ☐ design-tokens.md (uploaded)                  │
│               (zelfde selector als de pipeline-editor)       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ⚡ Genereren start een AI-sessie (V2)              │    │
│  │  Stel nu de aanvraag samen; generatie komt in V2.   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  [ Aanvraag opslaan ]     [ Genereer · V2 — binnenkort ]    │
└──────────────────────────────────────────────────────────────┘
```

- "Aanvraag opslaan" → `save-marketing-request` → toont de aanvraag als `[draft]`-kaart in de folder.
- "Genereer" is **disabled**: `cursor-not-allowed opacity-50`, tooltip "Generatie beschikbaar in V2". De knop is al aanwezig zodat V2 alleen de `disabled` prop en de handler hoeft te wisselen.
- Context-selector: hergebruikt de `InfoDoc`-lijst en de `SkillEntry`-toggle precies zoals de pipeline-editor stage-config die toont (`03_AUTOMATION_AND_PLUGINS.md §3.2` `defaultSourceIds`). Geen nieuwe component, dezelfde `ContextSelector`-component (of de nauwkeurigste equivalent uit de bestaande pipeline-editor UI).
- Skill-picker: `<Dropdown>` gefilterd op `SkillEntry.surface === 'marketing'`. Als er nog geen marketing-skill aangemaakt is → leeg met link naar Sources-tab.

**Mobile:** volledig vertikaal gestapeld, knop sticky-bottom, zelfde velden.

### Scherm 3: Marketing-instellingen (overlay)

```
┌─ Marketing-instellingen ─────────────────────────────────[✕]─┐
│                                                              │
│  Playwright-capture                                          │
│  ─────────────────────────────────────────────────────────   │
│  Bron-terminal  [ DEV-1240 · server ▼ ]                     │
│                 Kies een actieve server-terminal             │
│  Of gebruik URL [ https://staging.mijnapp.nl          ]     │
│                 Alternatief: externe staging-URL             │
│                                                              │
│  Media-API-integratie                                        │
│  ─────────────────────────────────────────────────────────   │
│  MEDIA_API_KEY  [ ••••••••••••••••     ] [Wijzigen]         │
│                 ✓ Geconfigureerd  (of: ○ Niet ingesteld)    │
│                 Wordt gebruikt voor AI-beeldgeneratie (V2)   │
│                                                              │
│  [ Opslaan ]                                                 │
└──────────────────────────────────────────────────────────────┘
```

- Bron-terminal-dropdown: toont alle `Terminal`-entries van de workspace met `status !== 'exited'`, benoemd als `"${ticket.id} · ${process.name}"`. Selectie wordt opgeslagen als `captureTerminalId` in `MarketingWorkspaceConfig`.
- URL-veld: alternatief voor als er geen actieve terminal is; wordt `captureBaseUrl`.
- MEDIA_API_KEY: wrappert het bestaande `IntegrationTool`-edit-patroon; toont of er al een key staat (`mediaApiKeySet: true/false` uit config). Invoer stuurt naar het bestaande IntegrationTool-save-mechanisme.
- "Opslaan" → `update-marketing-capture-config`.

### Marketing-skill aanmaken (in Sources-tab)

Marketing-skills worden aangemaakt in de bestaande **Sources → Skills / MCP**-tab, niet op de Marketing-pagina zelf. De builder voegt `surface:'marketing'` toe als extra veld op `SkillEntry`; de Sources-tab toont een filter-toggle "Alle | Design | Marketing". Skill-aanmaak verloopt via hetzelfde "Upload spec"-pad (`features/15_SOURCES_MANAGEMENT.md §8`).

```
Skill-definitie (marketing):
  name: "Zakelijk · LinkedIn"
  surface: "marketing"
  // content (in het skill-doc):
  toon: "professioneel, geen emoji's, actieve zinnen"
  formaat: "1200×628 px  (LinkedIn banner)"
  stijlrichting: "wit/grijs achtergrond, primary-kleur accenten, logo rechtsonder"
```

V2 gebruikt deze definitie om de generatie-prompt samen te stellen.

---

## Bouwstappen (geordend)

### Fase 1 — Datamodel & control-API (backend)

**1.1 — Types uitbreiden**

- Voeg `surface?: 'design' | 'marketing'` toe aan `SkillEntry` in `workspaces-handoff/src/workspaces/_data/types.ts`.
- Voeg `MarketingFolder`, `MarketingAssetRequest`, `MarketingWorkspaceConfig` toe als nieuwe TypeScript-interfaces in `types.ts` (prototype-spiegel van de Prisma-modellen uit §Datamodel).
- Voeg `MarketingCaptureConfig` toe als JSON-deeltype: `{ captureTerminalId?: string; captureBaseUrl?: string; mediaApiKeySet: boolean }`.

Verificatie: `npm run build` clean; `npm run lint` zero warnings.

**1.2 — Prisma-schema uitbreiden (als het echte schema al in scope is)**

Als de bouw op de productie-codebase plaatsvindt (niet prototype-only):
- Voeg `MarketingFolder`, `MarketingAssetRequest`, `MarketingWorkspaceConfig` models toe conform §Datamodel.
- Run `prisma generate`.
- Voeg seed-entry toe voor de `media-api` IntegrationTool.

Verificatie: `prisma generate` zonder errors; seed draait zonder fouten.

**1.3 — Control-API ops**

Per op uit §Datamodel:
- `src/workspaces/_api/create_marketing_folder_v1.ts` — `rateLimit:30`, `method:'POST'`, `auth:{login:true}`, RBAC `work-on-tickets`.
- `src/workspaces/_api/rename_marketing_folder_v1.ts` — idem.
- `src/workspaces/_api/delete_marketing_folder_v1.ts` — RBAC `admin` (destructief).
- `src/workspaces/_api/save_marketing_request_v1.ts` — `rateLimit:60`, RBAC `work-on-tickets`. Slaat `status:'draft'` op; triggert NIETS (geen generatie).
- `src/workspaces/_api/update_marketing_capture_config_v1.ts` — RBAC `admin`; upsert van `MarketingWorkspaceConfig`.

Verificatie per route: `npm run scaffold:test workspaces/<route>/v1` → happy-path test geschreven; ongeautoriseerde caller krijgt `reason:'rbac'`; `npm run test` groen.

**1.4 — FeatureModule-registratie**

- Voeg `'marketing'` toe aan de FeatureModule-catalogus (zelfde patroon als `'interviewer'` in build-plan 01, fase 5.3).
- Workspace-default: `features.marketing = true` voor nieuwe workspaces.

Verificatie: de marketing-sidebar-route is bereikbaar wanneer feature enabled; 404 of redirect wanneer disabled.

### Fase 2 — Sources-tab uitbreiding (`surface`-filter)

**2.1 — `surface`-veld op `SkillEntry`**

- Voeg `surface?: 'design' | 'marketing'` toe aan de `SkillEntry`-interface (`types.ts`).
- Voeg in `Sources.tsx` een filter-segmented-control toe: `[ Alle | Design | Marketing ]`. Filtert de `SkillRow`-lijst op `SkillEntry.surface`.
- De "Upload spec"-flow (`features/15_SOURCES_MANAGEMENT.md §8`) krijgt een optioneel `surface`-dropdown in het upload-sheet (default: geen, wat overeenkomt met `undefined` / algemeen skill).

Verificatie: Een `SkillEntry` met `surface:'marketing'` verschijnt onder het "Marketing"-filter en niet onder "Design"; een entry zonder `surface` verschijnt onder "Alle".

**2.2 — Geen nieuwe skill-infrastructuur**

Marketing-skills zijn gewone `SkillEntry`-rijen. Er is geen nieuwe opslag, geen nieuwe reindex-logica, geen nieuwe Conductor-handler. De Sources-tab-uitbreiding is een read-only filter op bestaande data.

### Fase 3 — Frontend: Marketing-pagina-shell

**3.1 — Route + pagina-shell**

- `src/workspaces/[wsId]/marketing/page.tsx` met `template:'dashboard'` (sidebar-layout).
- `//? intent: Marketing-werkruimte voor het aanvragen en organiseren van marketing-assets per workspace`.
- Sidebar-item toevoegen: `faBullhorn`-icoon, alleen zichtbaar als `features.marketing === true`.

Verificatie: Route rendeert; sidebar-item zichtbaar met feature enabled; `npm run lint` clean.

**3.2 — Folder tree**

- `MarketingFolderTree`-component: recursieve weergave van `MarketingFolder[]`, root-entries eerst, uitklapbaar.
- `[ + Nieuwe map ]`-actie → inline naam-input → `create-marketing-folder`.
- Elke folder-header toont naam + `[ + Aanvraag toevoegen ]`-knop.
- Mapinhoud: lijst van `MarketingAssetRequest[]` gefilterd op `folderId`, gesorteerd op `createdAt` desc. Per kaart: type-badge, subject (eerste 60 tekens), status-chip (`draft`), datum.

Verificatie: aanmaken van een map verschijnt zonder page-reload (socket-update of optimistic); aanvraag-kaarten tonen in de juiste map; lege map toont `EmptyState`.

**3.3 — Asset-aanvraagformulier (sheet)**

- `MarketingRequestSheet`-component (via `menuHandler.open` of een rechter-`Sheet`).
- Velden: map-dropdown, type-radio-group (4 opties), subject-textfield, skill-dropdown (gefilterd op `surface:'marketing'`), context-selector (zie 3.4).
- "Aanvraag opslaan" → `apiRequest({ name:'workspaces/save_marketing_request', version:'v1', data:{...} })` → sluit sheet → update folder-tree.
- "Genereer" knop: disabled (`cursor-not-allowed opacity-50`), tooltip via `title`-attribuut: "Generatie beschikbaar in V2". Knop-label: "Genereer · V2".
- Kosten-banner boven de disabled knop: een lichte `Banner`-component, niet-blokkerend.

Verificatie: "Aanvraag opslaan" persisteert een `draft`-kaart in de juiste map; "Genereer" is niet klikbaar; skill-dropdown toont alleen `surface:'marketing'`-entries.

**3.4 — Context-selector hergebruik**

De context-selector in het formulier gebruikt dezelfde `InfoDoc[]` + `SkillEntry[]`-data die de pipeline-editor al toont. Hergebruik de bestaande selector-component (of bouw een `ContextSelector`-component dat door zowel Pipeline als Marketing geïmporteerd wordt). V1-vereiste: de selector toont dezelfde context-docs en skills die de workspace al heeft; meerdere items selecteerbaar via checkboxes.

Verificatie: Items in de context-selector komen overeen met wat zichtbaar is in Sources-tab; geselecteerde `contextIds` worden opgeslagen in de `MarketingAssetRequest`.

### Fase 4 — Frontend: Marketing-instellingen overlay

**4.1 — Capture-config**

- `MarketingSettingsOverlay`-component (via `menuHandler.open`).
- Bron-terminal-dropdown: laadt `Terminal[]` van de workspace, benoemd als `"${ticketId} · ${process.name}"`. Filtert op `TerminalProcess.status !== 'exited'`.
- URL-veld: `<input type="url">` voor `captureBaseUrl`.
- Validatie: ofwel een terminal óf een URL is vereist, niet beide. Als geen van beide → warnings maar geen hard block (V1: setup mag leeg zijn).
- "Opslaan" → `update-marketing-capture-config`.

Verificatie: opgeslagen config is terug te lezen in de overlay; een gekozen terminal-sessie-id matcht het schema `"${ticketId}:${processName}"` uit `features/14_TERMINALS.md §UI`.

**4.2 — Media-API-key-status**

- Toon `mediaApiKeySet: true/false` uit `MarketingWorkspaceConfig` als een read-only status-chip in de overlay.
- "Wijzigen"-knop navigeert naar de bestaande Workspace-instellingen → Integraties-tab (waar de `MEDIA_API_KEY` IntegrationTool-entry staat). Marketing beheert de key niet zelf — dat is de bestaande IntegrationTool-UI.

Verificatie: een geconfigureerde `MEDIA_API_KEY` geeft een groene chip ("Geconfigureerd"); niet-geconfigureerd geeft oranje ("Niet ingesteld"). De "Wijzigen"-link navigeert correct.

### Fase 5 — Kwaliteit & hardening

**5.1 — i18n pass**

- Alle user-facing strings via `useTranslator`. Dit omvat: mapnamen (UI-chrome, niet user-content), formulierlabels, status-chips, tooltips, banner-tekst.
- Geen hardcoded Nederlandse strings in JSX (tenzij via translator-keys).

**5.2 — Tailwind-tokens**

- Geen arbitrary hex-kleuren. Alle kleuren uit `src/index.css @theme`-block (`background`, `container1/2`, `primary`, etc.).
- Status-chips: `draft` → `muted`-tint; (V2 reserved: `generating` → `warning`, `done` → `correct`, `failed` → `wrong`).

**5.3 — Lint + build pass**

- `npm run lint && npm run build` zero warnings/errors.
- `npm run ai:lint` — geen `as any`, geen arbitrary kleuren.
- `npm run ai:project-index` na het toevoegen van de nieuwe route.

**5.4 — Tests**

Per control-API-route (fase 1.3): `npm run scaffold:test` → happy-path + RBAC-failure-case. Minimaal:
- `create_marketing_folder_v1`: aanmaken slaagt; ongeautoriseerde caller wordt geblokt.
- `save_marketing_request_v1`: opslaan slaagt; `status` is `'draft'`; generatie wordt NIET getriggerd (geen `AgentSession` aangemaakt, geen `WorkspaceSignal` gestuurd).
- `update_marketing_capture_config_v1`: upsert werkt; niet-admin wordt geblokt.

---

## Risico's & open punten

### R-1 — Skill-surface discriminatie: geen conflict met Designer

**Risico:** Als `SkillEntry` geen `surface`-veld heeft, zijn marketing-skills en design-skills niet te scheiden. De skill-dropdown in het aanvraagformulier toont dan design-skills (verwarrend).

**Mitigatie:** `surface?: 'design' | 'marketing'` is de minimale discriminator (bouwstap 2.1). Skills zonder `surface` verschijnen in "Alle" maar niet in gefilterde views.

**Open punt:** Moeten bestaande skills (aangemaakt vóór V1-deploy) automatisch `surface: undefined` krijgen, of vraagt de Sources-tab de user om te classificeren? Aanbeveling: `undefined` = ongeclassificeerd, verschijnt nergens in de skill-picker, maar is zichtbaar in "Alle". Backward-compatible.

### R-2 — Context-selector als gedeelde component

**Risico:** Als de pipeline-editor een eigen, nauw gekoppelde context-selector heeft (inline in de Pipeline-UI), is hergebruik niet triviaal en leidt een copy-paste tot dubbel onderhoud.

**Mitigatie:** Bouw in fase 3.4 een echte `ContextSelector`-component in `src/workspaces/_components/` die zowel door Pipeline als door Marketing geïmporteerd wordt. Kost één extra stap maar elimineert dubbel onderhoud.

**Open punt (MKT-1):** Bestaat er al een reusable `ContextSelector`-component, of zit de logica inline in de pipeline-editor? Inventariseer voor aanvang van fase 3.4.

### R-3 — Terminal-dropdown: alleen live terminals

**Risico:** Als er geen actieve server-terminal loopt op het moment dat de gebruiker de Marketing-instellingen opent, is de dropdown leeg. De user begrijpt misschien niet waarom.

**Mitigatie:** Als de dropdown leeg is → `EmptyState` met tekst: "Geen actieve server-terminals. Start een ticket met een server-process om screenshots te kunnen maken." + link naar Terminals-scherm. Alternatief: laat de user een handmatige URL invullen (capture-base-url) als fallback.

Dit is V1-intentie: Marketing wijst naar een reeds-lopende terminal, start er nooit zelf een. Dit is conform `features/14_TERMINALS.md §Scope` ("Out: Spawning/tearing down the PTY itself") en Rule 8 (server start is een developer action).

### R-4 — `media-api`-key-slot vs. multi-provider (geparkeerd)

**Risico:** Eén generiek `MEDIA_API_KEY`-veld is te weinig als V2 meerdere providers wil ondersteunen (beeld via provider A, video via provider B).

**Mitigatie:** In V1 is één slot bewust gekozen (`round3/marketing-deep.md` V-5a). Als V2 meerdere providers nodig heeft, voegt de builder extra `IntegrationTool`-rows toe. Het model is al extensible (`03_AUTOMATION_AND_PLUGINS.md §5`). De multi-provider seam zelf blijft geparkeerd.

**Open punt (MKT-2):** Geef het generieke slot een naam die geen specifieke dienst impliceert: `MEDIA_API_KEY` (generiek) is beter dan `DALLE_API_KEY`. Gebruik `MEDIA_API_KEY` als key, met een label "Media-generatie API" in de UI.

### R-5 — Preview-server dependency voor Playwright (V2)

**Risico:** De capture-config wijst in V1 naar een pipeline-serverterminal. In V2, wanneer Playwright echt aanroepen doet, moet die terminal actief zijn. Als de terminal niet loopt (ticket afgerond, container gestopt), mislukt de capture.

**Mitigatie (V2-note, niet V1-werk):** V2 moet ofwel:
a) de `captureBaseUrl`-fallback gebruiken (staging/prod URL die altijd beschikbaar is), of
b) een expliciete check bouwen die de capture-knop disablet als de gekozen terminal niet `status:'live'` heeft.

V1-taak: documenteer dit in een inline comment in `MarketingWorkspaceConfig` en in de settings-UI-tooltip: "Zorg dat de geselecteerde terminal actief is vóór je genereert."

### R-6 — Capacity impact: nul in V1, let-op in V2

`07b_CONTAINER_RUNTIME.md §8` beschrijft dat de CapacityManager alle containers deelt. V1 start geen containers → geen impact. V2 (met generatie-agent `needsWorkspace:false` per `marketing-module.md §Hergebruik`) is een lichtgewicht reasoning-sessie zonder worktree — goedkoop, maar telt wel mee als `MAX_ACTIVE_TURNS`. Als meerdere marketing-requests tegelijk worden gestart (vergelijk N-stijlen), zijn dat N PTY-sessies: zorg in V2 voor een `marketingConcurrencyCap` als sub-limit (patroon identiek aan `designConcurrencyCap` uit build-plan 02).

### R-7 — Anti-AI-detectiongrens (hard boundary, uit locked decisions)

**Dit plan ontwerpt, omvat, of impliceert geen feature waarvan het doel is om AI-gegenereerde content door AI-detectiesoftware te laten passeren.** De toon/formaat/stijlcontroles in de marketing-skill zijn in scope; een "maak ondetecteerbaar"-modus, detector-feedback-loop, of soortgelijke functie is **expliciet buiten scope** en mag niet worden toegevoegd in V1, V2, of enige toekomstige versie zonder een bewuste, gedocumenteerde beslissing van de gebruiker.

### Open punten (vlaggen voor de builder)

| id | Vraag | Default / aanbeveling |
|---|---|---|
| MKT-1 | Bestaat al een reusable `ContextSelector`-component in de pipeline-editor? | Inventariseer; zo niet → bouw hem als shared component in `_components/` |
| MKT-2 | Key-naam generiek houden: `MEDIA_API_KEY` of een andere aanduiding? | `MEDIA_API_KEY` met label "Media-generatie API" in de UI |
| MKT-3 | Mag een `MarketingAssetRequest` zonder skill worden opgeslagen (skillId null)? | Ja — skill is optioneel in V1; warning in de UI ("Selecteer een skill voor betere resultaten in V2") maar geen hard block |
| MKT-4 | Telt de disabled "Genereer"-knop in het formulier mee voor accessibility (aria-disabled vs disabled)? | Gebruik `aria-disabled="true"` + `tabIndex={-1}` conform het bestaande WsButton-pattern; tooltip via `aria-describedby` |
| MKT-5 | Worden `MarketingAssetRequest`-kaarten ook zichtbaar in de Backlog of het Board (als linked item)? | Nee in V1; koppeling aan ticket is V2-feature (artifact picker) |
| MKT-6 | Hoe worden marketing-folders geserialiseerd als er nog geen Prisma-model is (prototype)? | Dummy-data in `_data/dummy.ts`; zelfde patroon als andere entiteiten in de prototype |
