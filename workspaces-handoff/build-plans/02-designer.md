# Build-plan 02 — Designer Studio

> Gegenereerd: 2026-06-15. Onderdeel van de Workspaces build-plans reeks.
> Gebaseerd op: `modules/designer-studio.md`, `round2/designer-scope.md`, `round3/designer-deep.md`,
> `workspaces-handoff/src/workspaces/_docs/03_AUTOMATION_AND_PLUGINS.md` (§3, §7),
> `design-reference/CLAUDE_DESIGN_FEATURE_COMPLETION.md`, `design-reference/DESIGN_TOKENS.md`,
> `features/23_PREVIEW_DEPLOYMENT.md`, `07b_CONTAINER_RUNTIME.md` (§8), `features/15_SOURCES_MANAGEMENT.md`.

---

## Doel & V1-scope

### Wat dit levert

Een eigen sidebar-pagina ("Studio") die per workspace aan/uit gezet wordt in de workspace-settings. De gebruiker selecteert één of meerdere design-skills, geeft een opdracht ("maak een settings-pagina"), en de studio start N parallelle design-agent-sessies — één per geselecteerde skill. Elke agent schrijft React/Tailwind-code **en** produceert een screenshot-preview via de always-on main preview server. Resultaten verschijnen één voor één zodra ze af zijn (streaming cards). De gebruiker vergelijkt de varianten op de Designer-pagina, slaat favorieten op als artifact (preview + code + ingrediënten), en koppelt een artifact later aan een ticket via de manual picker of semantische search.

Het design-systeem-luik levert een **token-diff** als primary artifact: welke `@theme`-variabelen in `src/index.css` veranderen t.o.v. de huidige waarden. Een live screenshot naast de diff geeft de visuele context.

De agent schrijft **nooit direct naar de repo** (artifacts only). De gekozen variant wordt pas in de repo gezet nadat de gebruiker Accept drukt op de WorkspaceSuggestion die aan het ticket is gekoppeld — B-23 Conductor is de enige schrijver.

### V1-scope (uitgewerkt)

| Onderdeel | V1 | Deferred |
|---|---|---|
| Designer als eigen sidebar-pagina | ✓ | — |
| Skills met `surface:'design'` — prompt + tokens + componentconventies | ✓ | referentie-afbeeldingen per skill (V2) |
| N varianten, één per skill, parallel (sub-budget) | ✓ | N varianten per skill (V2) |
| Streaming resultaten (cards verschijnen zodra klaar) | ✓ | — |
| Screenshot-preview via always-on main preview server | ✓ | live-preview per variant op eigen URL (V3) |
| Generatie tegen echte componenten + tokens (codebase-bewust) | ✓ | — |
| Refine-lus per geselecteerde variant (iteratief bijsturen) | ✓ | live component-level klik-en-edit (V3) |
| Design-systeem output = token-diff op `src/index.css` @theme-block | ✓ | standalone volledig nieuw kleurvoorstel (V2) |
| Artifact opgeslagen met ingrediënten (skill, prompt, commitHash) | ✓ | — |
| Artifact koppelen aan ticket via picker + semantische search | ✓ | — |
| Free folder tree per workspace | ✓ | — |
| Vergelijk + favoriet markeren op de Designer-pagina | ✓ | — |
| Definitieve koppeling bij ticket-aanmaak | ✓ | — |
| Skill-ownership: Owner/Admin schrijft skills; Members gebruiken ze | ✓ | voorstel-en-goedkeur flow (V2) |
| designConcurrencyCap als workspace-instelling (sub-budget) | ✓ | aparte machine/resource-pool (buiten scope) |
| Live-edit lus (klik op component, geef instructie, zie update) | ✗ deferred | V3 — vereist infra buiten het PTY-model |
| Multi-provider per design-stage (ander model/key) | ✗ deferred | botst met V1 single-provider lock |

---

## Past op de bestaande corpus

### Nul core changes

De plugin-walkthrough in `03_AUTOMATION_AND_PLUGINS.md §7` beschrijft dit scenario letterlijk: `registerAgentRole({ key:'design', ... })` voegt een design-stage toe zonder core-changes aan het trigger-systeem, het protocol of de verb-surface. De Designer Studio is een **additive registration**, niet een uitbreiding van het core-protocol.

### Hergebruikte bouwstenen (met bron)

| Bouwsteen | Hergebruik | Bron |
|---|---|---|
| `AgentRole` plugin model | `registerAgentRole({ key:'design', needsWorkspace:true, artifactKind:'design', ... })` | `03 §3.2` |
| `ArtifactViewerRegistry` | `registerArtifactViewer('design', lazy(…))` → `DesignViewer` naast bestaande `FileDiffViewer` | `03 §3.3` |
| `Skills / MCP`-tab in Sources | Design-skills als `SkillEntry`-rijen met `surface:'design'`, frozen/live badge, toggle per stage, detail-popover | `15_SOURCES_MANAGEMENT.md` |
| `WorkspaceSuggestion` met appliable patch | Gekozen variant → B-23 flow: Conductor schrijft pas na Accept | `03 §4`, `02 §6` |
| `PreviewDeployment` infra | Screenshot via always-on main preview container (PROD single-port, B-13) | `23_PREVIEW_DEPLOYMENT.md` |
| `WorkspaceTrigger` | `{ on:'stage.on_approval', action:'start-stage' }` wikkelt design-stage in pipeline zonder core changes | `03 §1` |
| Design-tokens set | Token-diff werkt direct op de bestaande token-namen (`background`, `primary`, `container1/2`, etc.) | `DESIGN_TOKENS.md` |
| `CapacityManager` | designConcurrencyCap is een sub-limit binnen dezelfde shared resident pool, niet een aparte allocation | `07b §8.1–8.2` |
| `FeatureModule` registratie | `{ id:'designer', label:'Studio', icon:faPaintBrush, core:false }` zelfde patroon als de andere optional tools | (tools framework, locked decisions) |
| Folder tree + artifact store | Zelfde `free folder tree + skills + artifact store` als het gedeelde tool-page framework | (locked decisions tools framework) |
| Codebase-context inject | `defaultSourceIds` van de role verwijst naar de bestaande `generated`-docs (AI_PROJECT_INDEX, AI_CAPABILITIES) + `DESIGN_TOKENS.md` | `15_SOURCES_MANAGEMENT.md`, `03 §3.2` |

### Spanningen met locked decisions (bewuste keuzes)

**needsWorkspace:true voor de design-agent.** De agent schrijft werkende React/Tailwind-code **en** een token-diff. Dat vereist een worktree zodat hij de echte componenten en `src/index.css` kan lezen. `needsWorkspace:false` (reasoning-only) is afgewezen omdat "preview + code" de kern van de locked scope is (`round2/designer-scope.md` V-1a, `round3/designer-deep.md` V-3a). Dit betekent L3-container met een clone van `main` bij `commitHash` — dezelfde infra als een gewone ticket-container (`07b §3–4`).

**designConcurrencyCap als sub-limit.** N parallelle design-agents trekken uit dezelfde `MAX_RESIDENT`-pool als worker-tickets (`07b §8.1`). Een `designConcurrencyCap` (workspace-instelling, default 2, max gelijk aan `MAX_RESIDENT / 2`) reserveert headroom voor lopende tickets. Dit is de bewuste keuze b) uit `modules/designer-studio.md` Vraag 2.

**Geen nieuwe verbs.** De design-agent communiceert via de bestaande `emit_output` met een design-specifieke `outputSchema`  (`artifacts:[{kind:'screenshot'|'token-diff'|'code', uri, title}]`). De variant-selectie loopt via de bestaande `WorkspaceSuggestion + accept`-flow — geen `emit_design_variant` of vergelijkbare toevoeging (`03 §3.4`, locked: no new verbs in `02 §2`).

**B-23: Conductor schrijft, AI proposeert.** De gekozen variant in de WorkspaceSuggestion levert een `appliable patch` (token-diff → `src/index.css`, of code-bestanden). De gebruiker klikt Accept; de Conductor voert de patch uit. De Designer-pagina zelf schrijft nooit naar de repo.

---

## Datamodel

Nieuwe Prisma-entiteiten en -velden, aansluitend op de bestaande `types.ts` in de prototype.

### `DesignSession` (nieuw)

```prisma
model DesignSession {
  id          String   @id @default(cuid())
  workspaceId String
  folderId    String?               // null = root
  prompt      String
  scope       String                // 'page' | 'component' | 'design-system'
  targetPath  String?               // bv. "src/workspaces/settings/page.tsx"
  commitHash  String                // frozen codebase-versie waarop gegenereerd werd
  status      String                // 'running' | 'partial' | 'done' | 'failed'
  createdBy   String                // userId
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  variants    DesignVariant[]
  workspace   Workspace @relation(fields:[workspaceId], references:[id])
}
```

### `DesignVariant` (nieuw)

```prisma
model DesignVariant {
  id              String   @id @default(cuid())
  sessionId       String
  skillKey        String                    // de gebruikte SkillEntry.id/key
  status          String                    // 'generating' | 'done' | 'failed'
  screenshotUri   String?                   // artifact-store URI van de screenshot
  codeArtifactUri String?                   // artifact-store URI van de code bundle
  tokenDiffUri    String?                   // artifact-store URI van de token-diff JSON
  agentSessionId  String?                   // FK naar AgentSession (de PTY-sessie)
  isFavorite      Boolean  @default(false)
  savedAsArtifact Boolean  @default(false)
  promptUsed      String                    // effectieve prompt (inclusief skill-instructies)
  createdAt       DateTime @default(now())

  session         DesignSession @relation(fields:[sessionId], references:[id])
}
```

### `DesignArtifact` (nieuw) — de opgeslagen versie

```prisma
model DesignArtifact {
  id            String   @id @default(cuid())
  workspaceId   String
  folderId      String?
  title         String
  scope         String                // 'page' | 'component' | 'design-system'
  screenshotUri String
  codeUri       String?
  tokenDiffUri  String?
  skillKey      String                // welke skill
  promptUsed    String
  commitHash    String                // codebase-versie
  createdBy     String
  createdAt     DateTime @default(now())

  // Koppeling naar tickets (live reference)
  ticketLinks   DesignArtifactLink[]
  workspace     Workspace @relation(fields:[workspaceId], references:[id])
}

model DesignArtifactLink {
  artifactId  String
  ticketId    String
  linkedBy    String
  linkedAt    DateTime @default(now())
  artifact    DesignArtifact @relation(fields:[artifactId], references:[id])

  @@id([artifactId, ticketId])
}
```

### Uitbreidingen op bestaande modellen

```prisma
// Workspace — sub-budget voor design-agents
model Workspace {
  // ...bestaande velden...
  designConcurrencyCap  Int  @default(2)   // max gelijktijdige design-agent PTY-sessies
}

// SkillEntry — surface-filter
// Bestaand in types.ts; voeg toe:
// surface: 'design' | 'marketing' | 'document' | undefined (= alle)
// In Prisma: String? — null = generiek
```

### `TicketArtifact` uitbreiding (bestaand model)

De bestaande `TicketArtifact` (via `AgentRole.ingest`) krijgt `kind:'design'` en verwijst naar een `DesignArtifact.id` als `sourceUri`. `TicketDetail` rendert dit via `ArtifactViewerRegistry` met `DesignViewer`.

---

## UX & flows

### Globale navigatie

De Studio verschijnt als extra sidebar-item onder de optionele FeatureModules, toggle-baar in Workspace Settings → Features. Volgorde in de nav: Board / Backlog / Pipeline / Terminals / **Studio** / Sources / AI-panel. Op mobiel: extra item in het bottom tab-overflow sheet.

### Scherm 1 — Studio-overzicht

```
┌ Studio                                          [ + Nieuwe generatie ] ┐
│ ┌ 📁 settings-pagina (3) ┐  ┌ 📁 dashboard-redesign (7) ┐            │
│ │ Laatste: "compact layout"│  │ Laatste: "dark mode tokens" │           │
│ └──────────────────────── ┘  └──────────────────────────── ┘           │
│                                                                         │
│ ┌ 📄 recent: settings-pagina · skills: modern, compact · 2u geleden ┐  │
│ │  [screenshot]  [★ favoriet]  [Opslaan als artifact]  [Koppel …]   │  │
│ └──────────────────────────────────────────────────────────────────── ┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

Desktop: folders als grid (md:grid-cols-2 lg:grid-cols-3), recente artifacts als horizontale row. Mobiel: single column, folders als lijst; bottom-sheet voor acties.

### Scherm 2 — Nieuwe generatie (slide-in sheet, desktop / bottom-sheet mobiel)

Stap-voor-stap in één sheet:

1. **Scope picker** — `page | component | design-system` (segmented control). Bij "page": optioneel een doelbestand kiezen (bestandsboom of free text). Bij "component": naam van het component. Bij "design-system": altijd token-diff output.
2. **Opdracht** — tekstarea ("Maak een compacte settings-pagina met inline editing"). Max 800 tekens.
3. **Skills selecteren** — `MultiSelectDropdown` van beschikbare design-skills (gefilterd op `surface:'design'`), met frozen/live badge per skill. Teller: "3 varianten = 3 AI-sessies" met capaciteitsindicator (X slots beschikbaar nu).
4. **Folder kiezen** — bestaande folder of "+ Nieuwe folder" inline.
5. **Genereer** — knop activeert de generatie; sheet sluit; variant-cards verschijnen op de Studio-pagina.

### Scherm 3 — Generatie-sessie (live, op de Studio-pagina)

```
┌ Studio › settings-pagina › "compacte settings…"  ●●○ 2/3 klaar  ┐
│                                                                    │
│ ┌──────────────┐  ┌──────────────┐  ┌────────────────┐           │
│ │[screenshot]  │  │[screenshot]  │  │  ◐ generating… │           │
│ │ skill:modern │  │ skill:compact│  │  skill:minima  │           │
│ │ ★  Opslaan   │  │ ★  Opslaan   │  │                │           │
│ └──────────────┘  └──────────────┘  └────────────────┘           │
│                                                                    │
│ [Geselecteerd: modern]  [Verfijn ▸]  [Vergelijk ▸]               │
└────────────────────────────────────────────────────────────────────┘
```

- Cards verschijnen één voor één zodra de variant klaar is (streaming via socket room `workspace-<wsId>`).
- `◐ generating…` pulse-animatie (zelfde patroon als `busy` StatusPill).
- Screenshot laadt in de card zodra de preview server hem terug geeft.
- `★` markeert een favoriet (client-side, wordt `isFavorite` op `DesignVariant`).
- **Mobiel:** single-column vertical scroll; swipe-horizontaal voor meerdere varianten.

### Flow — Screenshot maken

De always-on main preview server (`dev-main.<domain>` — een PROD-mode container die `main` draait, zie §23 locked decisions) wordt door de design-agent als render-target gebruikt. De agent:

1. Schrijft de gegenereerde code naar een tijdelijk pad **binnen de artifact-store** (niet in de worktree van `main`).
2. Stuur via `invoke-workspace-ai` een Playwright-screenshot-command: render tijdelijk de gegenereerde CSS/component in de preview-server (als een separate route `/design-preview/:variantId` die de preview-server aanbiedt), maak screenshot, sla op als artifact.
3. URI van het screenshot-artifact wordt opgeslagen in `DesignVariant.screenshotUri`.

**Beveiliging:** De preview-server-route `/design-preview/:variantId` accepteert alleen input van de orchestrator (intern op `workspaces-net`, niet extern). De gegenereerde CSS/HTML wordt gesandboxt gerenderd (geen scripts van buiten, Content-Security-Policy beperkt). Het screenshot-command is een allow-listed `OrchestratorCommandRegistry`-entry, nooit raw shell (`03 §1.5`).

### Flow — Verfijn-lus

Na het selecteren van een variant: "Verfijn ▸" opent een chat-achtig sheet (rechts, desktop; bottom-sheet, mobiel). De gebruiker geeft een instructie ("maak de knoppen ronder, meer witruimte"). De design-agent hervat in **dezelfde AgentSession** (`claude --resume <claudeSessionId>`, `07b §9`) met de bestaande context en genereert een nieuwe screenshot + code-update. De vorige versie blijft zichtbaar (versie-rij in de card: "v1 → v2 → v3").

Maximaal 5 verfijn-iteraties per variant per sessie (werkbudget-bescherming). Daarna "Start nieuwe generatie" als je verder wilt.

### Flow — Opslaan als artifact

"Opslaan ▸" (op een variant-card of in het vergelijk-overzicht) opent een kleine modal:

- Naam (prefill: `[skill] [scope] [datum]`).
- Folder kiezen (of nieuw).
- "Opslaan" → `DesignArtifact` aangemaakt, variant gemarkeerd `savedAsArtifact:true`.

### Flow — Koppelen aan ticket

**Op de Designer-pagina:** Koppel-knop op een artifact → ticket-picker sheet (zoek op DEV-id of naam).

**Bij ticket-aanmaak:** "Link design-artifact" knop in de create-ticket modal → artifact-picker sheet met tabs "Recente artifacts" + "Zoek" (semantische search op naam/prompt/skill). Gekozen artifact = live reference: `DesignArtifactLink` aangemaakt. Op het ticket-detail toont `DesignViewer` de screenshot + token-diff + code, linked naar de artifact (altijd de meest recente versie).

### Flow — Design-systeem (token-diff)

Scope = `design-system`: de agent leest `src/index.css` `@theme`-block uit de codebase-context (via de `generated`-InfoDoc die de tokens documenteert). Output is een `token-diff` JSON:

```json
{
  "changes": [
    { "token": "--primary", "from": "#3B82F6", "to": "#6366F1" },
    { "token": "--container1", "from": "#FFFFFF", "to": "#F8F8FC" }
  ],
  "rationale": "Shift naar een paarsere toon die beter past bij de 'modern' skill-stijl."
}
```

De `DesignViewer` toont dit als een diff-tabel naast de screenshot (de screenshot is gemaakt met de nieuwe tokenwaarden toegepast via CSS-overrides). Bij Accept via `WorkspaceSuggestion` schrijft de Conductor de waarden naar `src/index.css`.

### Mobiele parity

- Studio-overzicht: single-column folder-lijst, tap op folder → artifact-lijst.
- Nieuwe generatie: bottom-sheet, dezelfde stappen.
- Generatie-sessie: vertical scroll van cards, horizontale swipe voor varianten in een sessie.
- Verfijn-lus: bottom-sheet-chat.
- Alle overlays: bottom-sheets (bestaand `MenuHandler`-model).

---

## Bouwstappen (geordend)

### Fase 0 — Prerequisiten (blocker, gaat vóór alles)

- [ ] **P0.5 CLI spike passed** (authenticatie met `CLAUDE_CONFIG_DIR`, `07b §2.6`). Zonder dit geen container-werk.
- [ ] **Always-on main preview server** is operationeel: `dev-main.<domain>` draait de `main`-branch in PROD-mode, bereikbaar op `workspaces-net`. Caddy heeft een statische route voor dit subdomain (`23_PREVIEW_DEPLOYMENT.md §5.3`). Dit is de render-target voor screenshots.
- [ ] **`FeatureModule` registratie-mechanisme** bestaat (tools-framework). Designer registreert zich via `registerFeatureModule({ id:'designer', ... })`.

### Fase 1 — Datamodel + schil

- [ ] Prisma-migratie: `DesignSession`, `DesignVariant`, `DesignArtifact`, `DesignArtifactLink` aanmaken; `Workspace.designConcurrencyCap` toevoegen.
- [ ] `SkillEntry` uitbreiden met `surface` veld (of bestaand model aanpassen); migratie voor bestaande skill-rijen.
- [ ] Sources-tab: design-skills filteren op `surface:'design'` in `SkillRow`-lijst.
- [ ] Studio-sidebar item registreren (disabled als `FeatureModule` uit is in workspace-settings).
- [ ] `Workspace Settings → Features` toggle voor de Designer Studio.

### Fase 2 — Generatie-engine

- [ ] `registerAgentRole({ key:'design', needsWorkspace:true, artifactKind:'design', outputSchema:{ artifacts:[...], tokenDiff?:{...} }, systemPromptTemplate:'...', defaultSkillKeys:['design-system','component-catalog'], defaultSourceIds:['AI_PROJECT_INDEX','AI_CAPABILITIES','DESIGN_TOKENS'], ... })`.
- [ ] Design-agent systemPromptTemplate schrijven: verplicht gebruik van bestaande componenten + tokens (`defaultSourceIds` geladen); output-schema afdwingen via `emit_output`.
- [ ] `designConcurrencyCap` enforcement in `CapacityManager`: bij `residentCount >= cap` queuen (zelfde queue/reclaim logica als `07b §8.2`, maar met het sub-budget als aanvullende check). Gebruiker ziet "X slots beschikbaar" in de generatie-sheet.
- [ ] `DesignSession` aanmaken + N `DesignVariant`-rijen met `status:'generating'` bij "Genereer".
- [ ] Per variant: container starten (L3, clone van `main` op `commitHash`), AgentSession aanmaken, PTY starten met de gerenderde `.claude/settings.json`.

### Fase 3 — Screenshot-pipeline

- [ ] `OrchestratorCommandRegistry.register('design:screenshot', { run: (variantId, cssOverrides) => ... })` — neemt de gegenereerde CSS/component, stuurt naar de always-on preview server `/design-preview/:variantId`, maakt Playwright-screenshot, slaat op als artifact-store blob, geeft URI terug.
- [ ] Preview-server endpoint `/design-preview/:variantId` (orchestrator-intern, niet publiek): accepteert CSS-overrides + component-HTML, rendert in een sandboxte iframe (CSP: geen externe scripts), serveert aan de screenshot-command.
- [ ] `DesignVariant.screenshotUri` vullen zodra screenshot klaar is; broadcast via socket room `workspace-<wsId>` zodat de UI de card live bijwerkt.

### Fase 4 — UI (Studio-pagina)

- [ ] `Studio.tsx` — overzichtspagina: folder-grid, recente artifacts, "Nieuwe generatie"-knop.
- [ ] `NewGenerationSheet.tsx` — de slide-in sheet met de 5 stappen. Reuse: `Dropdown`, `MultiSelectDropdown`, bestaand `Sheet`-component, `MenuHandler`.
- [ ] `VariantCard.tsx` — card met screenshot, skill-label, status-indicator (generating/done/failed), favoriet-ster, opslaan-knop. StatusPill reuse voor generating-pulse.
- [ ] `DesignSessionView.tsx` — de actieve generatie-sessie: grid van `VariantCard`, progress-indicator, "Verfijn"/"Vergelijk"-acties.
- [ ] `DesignViewer.tsx` — artifact-viewer, geregistreerd via `registerArtifactViewer('design', ...)`. Toont: screenshot, token-diff tabel (als aanwezig), code (collapsible). Reuse `FileDiffViewer` voor code-diff.
- [ ] Websocket-subscribe in `Studio.tsx` op `workspace-<wsId>` voor `design:variant:update` events.

### Fase 5 — Artifact-store + koppeling

- [ ] `SaveArtifactModal.tsx` — naam + folder kiezen; schrijft `DesignArtifact`.
- [ ] Artifact-picker sheet (reuse `MenuHandler`) in ticket-create modal + op `DesignArtifact`-rijen: semantische search via bestaand RAG-endpoint (query = `DesignArtifact.promptUsed + title`).
- [ ] `DesignArtifactLink` aanmaken bij koppeling; `TicketDetail` toont linked artifacts via `DesignViewer`.
- [ ] `WorkspaceSuggestion` aanmaken bij "Toepassen als voorstel" — `type:'config-review'`, body = token-diff of code-patch, `appliable patch` voor Conductor.

### Fase 6 — Verfijn-lus

- [ ] `RefineSheet.tsx` — chat-input per variant; stuurt instructie naar de design-agent via `claude --resume <claudeSessionId>` in de bestaande container.
- [ ] Versie-rij in `VariantCard`: "v1 → v2" history, klikbaar om vorige versie te vergelijken.
- [ ] Maximaal 5 iteraties enforcement (serverside: `DesignVariant.refineCount` teller, reject na 5).

### Fase 7 — Design-systeem (token-diff)

- [ ] Token-diff parsing: agent emits `tokenDiff` object in `outputSchema`; orchestrator valideert token-namen tegen de bestaande `@theme`-tokens.
- [ ] `TokenDiffViewer.tsx` — diff-tabel: token naam, van, naar, kleurvlak visualisatie. Geïntegreerd in `DesignViewer`.
- [ ] Screenshot met CSS-overrides: de screenshot-command past de token-diff toe als inline CSS-overrides op de preview-server voor de render.
- [ ] `appliable patch` voor `WorkspaceSuggestion`: token-wijzigingen als CSS-variable assignments in `src/index.css`.

### Fase 8 — Skill-bibliotheek

- [ ] Minstens 3 starter design-skills opleveren: `modern` (clean, primaire kleur, ruim witruimte), `compact` (denser layout, kleinere font-scale), `minimal` (muted palette, maximale witruimte). Elk als `SkillEntry` met `surface:'design'`, `kind:'frozen'`, systemPrompt-template, en token-set in de prompt.
- [ ] Skill-authoring via Sources-tab: Admins/Owners kunnen skill toevoegen via een "Nieuwe design-skill"-sheet (naam, beschrijving, prompt-template, eventueel token-overrides).
- [ ] "Freeze skill op commitHash" — bij opslaan van een design-artifact wordt de skill-versie geregistreerd in `DesignArtifact.skillKey` + `commitHash`.

---

## Risico's & open punten

### Capaciteitsrisico (kritisch)

N parallelle design-agents eten N slots uit de `MAX_RESIDENT`-pool (`07b §8.1`). Op de referentiehost (8 vCPU / 32 GB, MAX_ACTIVE_TURNS ~4–8) betekent 4 design-varianten potentieel 4 actieve PTY-slots tegelijk — de helft van de totale capaciteit. De `designConcurrencyCap` (default 2) mitigeert dit, maar de gebruiker moet dit zien vóórdat hij op "5 skills aanvinken" klikt. De capaciteitsindicator in de generatie-sheet (Fase 2) is niet optioneel — het is een vereiste user-communication, anders leidt dit tot stille wachtrijen of verdrongen ticketwerk.

**Open punt:** wat is de exacte kostprijs van een design-agent-sessie t.o.v. een gewone ticket-worker? Een design-agent die alleen een pagina schrijft (geen dependency-installs, geen test-runs) is waarschijnlijk goedkoper dan een implementatie-ticket. Meten in Fase 2 voordat de cap definitief wordt ingesteld.

### Screenshot-server als single point of failure

De always-on main preview server (`dev-main.<domain>`) is een gedeelde afhankelijkheid voor alle screenshot-requests. Als die container crasht of de `main`-branch breekt (rode CI), kunnen geen screenshots worden gemaakt. Mitigaties:

- Health-check in de screenshot-command: als de preview-server niet reageert, retourneer een `failed`-variant met expliciete reden ("preview server tijdelijk niet beschikbaar").
- De preview-server moet een `WorkspaceTrigger` hebben die hem automatisch herstart na een crash (via `run-command: preview-down → preview-up`).
- **Open punt:** wie draait de `main` preview server? Dit is een permanente container naast de ticket-containers. Kost een permanente slot in de `MAX_RESIDENT`-pool. Dit moet expliciet worden ingecalculeerd in het capacity-budget vóór livegang.

### Code-kwaliteit van de gegenereerde designs

De design-agent schrijft werkende React/Tailwind-code, maar kwaliteit is niet gegarandeerd. Risico's: verkeerde component-import-paden, tokens die niet bestaan, TypeScript-errors. Mitigatie: de agent kan in de container `npm run build` aanroepen (allow-listed in `defaultCommands`) om te verifiëren dat de output compileerbaar is. Als de build faalt, stuur een `failed`-variant met de build-error als reden. Dit voegt wel bouw-tijd toe (1–3 minuten extra per variant).

**Open punt:** willen we het build-check afdwingen in V1, of optioneel maken per workspace?

### Token-diff veiligheid

De Conductor past een `appliable patch` toe op `src/index.css` na Accept. Als de agent een ongeldig token-formaat emits (bijv. een token-naam die niet in `@theme` staat), kan de patch de CSS breken. Mitigatie: serverside validatie van het `tokenDiff` object tegen de bestaande token-namen vóórdat het in de `WorkspaceSuggestion` terechtkomt. Ongeldige tokens worden als waarschuwing gemarkeerd, niet als appliable patch.

### Skill-kwaliteit en -vervuiling

Als iedereen (of alleen Admins/Owners in V1) skills kan toevoegen, kan de bibliotheek snel groeien met half-uitgewerkte of overlappende skills. In V1 is dit risico klein (alleen 3 starter-skills + admin-gated authoring), maar een archivering/deprecation-status op `SkillEntry` moet vóór de skill-bibliotheek open gaat (ook al is dat V2).

### Live-edit lus (bewust deferred)

Een klik-op-component-en-geef-instructie interface vereist een component-level selectie-mechanisme dat buiten het PTY-agent-model valt (de agent werkt niet op een live DOM maar op code). De verfijn-lus in Fase 6 (tekstuele instructie via `--resume`) is het maximaal haalbare in V1 zonder nieuwe infra. Live component-edit is V3.

### Multi-provider (bewust deferred)

Als design-generatie een ander model vraagt (bijv. een multimodaal model voor referentie-afbeeldingen), botst dat met de V1 single-provider lock (`modules/designer-studio.md` §Spanning). In V1 werkt de design-agent op dezelfde `StageModelCfg` als de andere rollen — `Sonnet` als default, opwaarts schaalbaar naar `Opus` via de bestaande model-dropdown in de pipeline-editor. Referentie-afbeeldingen als skill-ingredient (optie C uit Vraag 1, `modules/designer-studio.md`) zijn deferred tot multi-provider beschikbaar is.

### Academische detectie (hard boundary)

De clean-output controls (writing level, tone) en de token-diff zijn legitieme scope. De Designer Studio bevat geen functie waarvan het doel is om AI-detectie te omzeilen voor academisch werk dat als eigen werk wordt ingeleverd: geen "make undetectable"-toggle, geen detector-gerichte tuning, geen detector-feedback loop. Dit geldt ook voor eventuele V2/V3 uitbreidingen.
