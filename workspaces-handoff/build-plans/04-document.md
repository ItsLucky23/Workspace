# Build-plan 04 — Document Studio

> Gegenereerd: 2026-06-15. Onderdeel van de Workspaces build-plans reeks.
> Gebaseerd op: `modules/document-studio.md`, `round2/document-scope.md`, `round3/document-deep.md`,
> `workspaces-handoff/src/workspaces/_docs/07b_CONTAINER_RUNTIME.md` (§1, §6–§9),
> `workspaces-handoff/src/workspaces/_docs/07_ORCHESTRATOR.md` (§D RAG),
> `workspaces-handoff/src/workspaces/_docs/03_AUTOMATION_AND_PLUGINS.md` (§3.2–§3.3),
> `workspaces-handoff/src/workspaces/_docs/04_DATA_MODEL.md` (§1–§3),
> `workspaces-handoff/src/workspaces/_docs/features/15_SOURCES_MANAGEMENT.md`.

---

## Harde grens — AI-detectie-ontwijking

**Deze module bevat GEEN feature waarvan het doel is AI-detectie te omzeilen voor academisch werk dat als eigen werk wordt ingeleverd.** Geen "make undetectable"-toggle, geen detector-gerichte tuning, geen feedback-loop op AI-detectoren, geen marketingclaim in die richting. De legitieme controls in scope zijn: schrijfniveau, toon, en schone natuurlijke output (geen AI-boilerplate/placeholder-taal) — dezelfde soort kwaliteitscontroles die ook voor een offerte of technisch rapport wenselijk zijn. Dit geldt ook voor V2/V3 uitbreidingen. De grens is functioneel: het gaat om het doel, niet om de techniek.

---

## Doel & V1-scope

### Wat dit levert

Een eigen sidebar-pagina ("Documenten") die per workspace aan/uit gezet wordt in de workspace-settings. De gebruiker maakt een folder aan, uploadt bronmateriaal (per upload kiezend: projectkennis/RAG of losse bijlage), selecteert een document-skill (sjabloon + toon + optioneel referentiedocument), geeft een opdracht en schrijfniveau/toon-instellingen, en de Document Studio genereert een echt `.pdf`, `.docx`, `.xlsx` of `.pptx` bestand. De AI schrijft de **inhoud en structuur** (in een tussenformaat: Markdown/JSON); een deterministische generator in de bestaande sandbox-container (pandoc + LibreOffice + ffmpeg baked in L1, `07b §1.1`) rendert het eindbestand. Gegenereerde bestanden worden als artifact opgeslagen in folders. De gebruiker kan het artifact koppelen aan een ticket (live reference); de Stage-Agent die het ticket uitvoert krijgt het artifact als context/referentie mee.

Round-trip: de gebruiker kan een bestaand `.docx` uploaden, de AI past het aan ("vul hoofdstuk 3 aan", "zet dit om naar een samenvatting-spreadsheet") en exporteert terug in hetzelfde formaat. V1 ondersteunt round-trip voor Word en Excel; PDF en PowerPoint zijn V1 genereer-only.

Grounding: de AI baseert zich op geüploade bronnen/RAG-index; optionele citaties verschijnen als voetnoten/bronverwijzingen in het eindbestand. Dit is het integere alternatief voor "verbergen dat het AI is": traceerbare, gefundeerde output.

Uploaden van untrusted bestanden (pdf/docx/xlsx/pptx) gebeurt **altijd in de sandbox-container** (`07b §6.1/§7`), nooit in het orchestrator-proces.

### V1-scope

| Onderdeel | V1 | Deferred |
|---|---|---|
| Document Studio als eigen sidebar-pagina (FeatureModule) | ✓ | — |
| Skills met `surface:'document'` — sjabloon + toon + optioneel referentiedocument | ✓ | A/B-test + feedback-loop per skill (V2) |
| Vier uitvoerformaten: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx) | ✓ | extra sjabloon-bibliotheken per type (V2) |
| AI schrijft inhoud/structuur → deterministische generator rendert eindbestand | ✓ | — |
| Round-trip: upload .docx/.xlsx → bewerk → export in zelfde formaat | ✓ (Word + Excel) | Round-trip PDF/PPTX (V2) |
| Per-upload keuze: projectkennis (RAG) of losse bijlage | ✓ | — |
| Grounding op bronnen + optionele citaties/voetnoten | ✓ | — |
| Schrijfniveau-control (student / professioneel / technisch) | ✓ | — |
| Toon-control (formeel / zakelijk / beknopt / etc.) | ✓ | — |
| Schone output: geen AI-boilerplate, geen placeholder-tekst | ✓ (prompt-engineering in skill-template) | — |
| Untrusted upload parsing in sandbox-container (size-caps, geen netwerk) | ✓ | — |
| Opslag via `@luckystack/storage`-abstractie (lokaal + S3-compatible) | ✓ (seam aanleggen; v1 = lokale opslag) | S3/MinIO (V2) |
| Artifact koppelen aan ticket via manual picker + semantische search | ✓ | — |
| Free folder tree per workspace | ✓ | — |
| `documentConcurrencyCap` als workspace-instelling (sub-budget CapacityManager) | ✓ | — |
| Fidelity/editability export-keuze (PDF = afgewerkt / docx = bewerkbaar) | ✓ | — |
| Marketing-type vrije document-generatie buiten project-context | ✓ (bewuste verbreding scope; locked decision gebruiker) | — |
| Multi-provider per document-type (ander model voor generatie) | ✗ deferred | botst met V1 single-provider lock |
| Inline document-editor in de browser | ✗ deferred | V3 |
| Batch-export (meerdere documenten tegelijk) | ✗ deferred | V2 |
| Anti-AI-detectie-modus | ✗ NOOIT | Harde grens (zie boven) |

---

## Past op de bestaande corpus

### Nul core changes

Net als de Designer Studio (`build-plans/02-designer.md §Past op`) is Document Studio een **additive registration** op de plugin-walkthrough in `03_AUTOMATION_AND_PLUGINS.md §3.2–§3.3`: `registerAgentRole({ key:'document', needsWorkspace:false, ... })`. Het document-generatie-pad vereist **geen** worktree (de agent schrijft inhoud, geen code die gecompileerd/getest moet worden), dus `needsWorkspace:false` — een lightweight reasoning-container, dezelfde RO-auth-mount als Refine/Plan-rollen (`07b §2.5`). Dit spaart een volledige L3-clone per generatie-sessie.

**Uitzondering: upload-parsing en generator-render** lopen als kortstondige jobs in de sandbox-container (expliciet los van de agent-sessie), via `OrchestratorCommandRegistry.run(...)` — allow-listed, nooit raw shell (`03 §1.5`).

### Hergebruikte bouwstenen (met bron)

| Bouwsteen | Hergebruik | Bron |
|---|---|---|
| `AgentRole` plugin model | `registerAgentRole({ key:'document', needsWorkspace:false, artifactKind:'document', outputSchema:{...} })` | `03_AUTOMATION_AND_PLUGINS.md §3.2` |
| `ArtifactViewerRegistry` | `registerArtifactViewer('document', lazy(…))` → `DocumentViewer` naast bestaande `FileDiffViewer` + `DesignViewer` | `03_AUTOMATION_AND_PLUGINS.md §3.3` |
| `SkillEntry` met `surface:'document'` | Gedeeld skill-model (zelfde als design/marketing); gefilterd op `surface:'document'` in Sources-tab | `features/15_SOURCES_MANAGEMENT.md`, `round2/tools-framework.md V-4a` |
| Upload-spec sheet in Sources | Uitbreiden van de bestaande drag-drop flow naar binary formats (zie D74 beperking: md/txt nu; uitbreiden) | `features/15_SOURCES_MANAGEMENT.md §Upload-spec sheet` |
| RAG delta-indexer (`07 §D`) | Geüploade docs (pdf/docx/xlsx → tekst na extractie in sandbox) landen als `RagEntry` entries — append-only, frozen-per-commit | `07_ORCHESTRATOR.md §D`, `features/15_SOURCES_MANAGEMENT.md §Extends` |
| `InfoDoc{source:'uploaded'}` | Upload als `uploaded`-tint in Sources-tab; RAG-keuze bepaalt of het ook in `RagEntry` terechtkomt | `features/15_SOURCES_MANAGEMENT.md §Data` |
| Sandbox-container (`07b §1/§6/§7`) | Upload-parsing (pandoc/LibreOffice extract) + generator-render (pandoc/LibreOffice/exceljs) in bestaande isolatie-laag: cap-drop ALL, geen netwerk, size-caps | `07b_CONTAINER_RUNTIME.md §6.1, §7` |
| `CapacityManager` | `documentConcurrencyCap` als sub-limit binnen `MAX_RESIDENT` (zelfde patroon als `designConcurrencyCap`) | `07b_CONTAINER_RUNTIME.md §8.1–§8.2` |
| `WorkspaceSuggestion` + B-23 | Gegenereerd document staat als Suggestion klaar; Conductor schrijft alleen na Accept (voor gekoppeld-aan-ticket writes) | `03_AUTOMATION_AND_PLUGINS.md §1.5`, `02_PROTOCOL_AND_FLOW.md §6` |
| `OrchestratorCommandRegistry` | `document:parse-upload` en `document:render` als allow-listed commands voor de sandbox-jobs | `03_AUTOMATION_AND_PLUGINS.md §1.5` |
| `WorkspaceTrigger` | Optioneel: `{ on:'stage.on_complete', action:'run-command', command:'document:export-release-notes' }` koppelt document-generatie aan pipeline-events | `03_AUTOMATION_AND_PLUGINS.md §1.2` |
| `FeatureModule` registratie | `{ id:'document', label:'Documenten', icon:faFileText, core:false }` — zelfde patroon als Designer en Marketing | Locked decisions tools framework |
| Folder tree + artifact store | Zelfde generieke `free folder tree + skills + artifact store` als het gedeelde tool-page framework | Locked decisions tools framework |
| `@luckystack/storage` seam | Storage-abstractie (lokaal v1; S3-compatible v2); deelt met Marketing-media | `modules/document-studio.md §V-7a` |

### Spanningen met locked decisions (bewuste keuzes)

**`needsWorkspace:false` voor de document-agent.** De agent schrijft *inhoud* (Markdown/JSON-structuur), niet code die een worktree vereist. Het renderen naar het eindbestand is een deterministische sandbox-job buiten de PTY-sessie. Dit vermijdt een L3-clone per generatie-run — bewuste efficiëntiekeuze, niet een verplichting. Consequentie: de agent heeft geen directe toegang tot de repo-worktree; hij leest codebase-context via de bestaande `defaultSourceIds` (InfoDocs: `AI_PROJECT_INDEX`, `AI_CAPABILITIES`), plus de geüploade bronnen als `InfoDoc{source:'uploaded'}` of als RAG-context.

**Geen nieuwe verbs.** De document-agent emits via `emit_output` met een document-specifiek `outputSchema` (`{ contentUri, format, structure, citations?, roundTripSourceUri? }`). De render-job is een allow-listed `OrchestratorCommandRegistry`-command (`document:render`), nooit een nieuw verb (`02_PROTOCOL_AND_FLOW.md §2`). Geen `emit_render_document` of vergelijkbare toevoeging.

**B-23: Conductor schrijft, AI proposeert.** Bestanden die direct in de repo terecht moeten komen (e.g. een release-notes PDF die in de artifact-folder van het project hoort) gaan via een `WorkspaceSuggestion` met appliable patch. De Document Studio-pagina schrijft nooit zelf naar de repo; artifacts leven in de artifact-store.

**Upload-formats uitbreiding (D74-override).** `features/15_SOURCES_MANAGEMENT.md` §Resolved besluit D74 beperkt uploads tot `md/txt/plain text only in v1`. Document Studio vereist binaire formats (pdf/docx/xlsx/pptx) als uploadbare bronnen én als round-trip-input. Dit is een bewuste D74-override, gemotiveerd door de locked decisions (round-trip V1). De override is veilig mits parsing in de sandbox-container plaatsvindt (zie §Bouwstappen Fase 1). De D74-grens blijft van kracht voor de **bestaande Sources-tab** — alleen de Document Studio-upload-flow breidt de formats uit.

**`@luckystack/storage` seam afdwingen.** Binaire blobs (gegenereerde bestanden + uploads) horen niet in MongoDB. In V1 wordt een minimale storage-abstractie aangelegd (lokaal pad, configurable prefix) waarachter V2 S3/MinIO kan komen. Dit deelt de seam met de Marketing-module (media-blobs). Geen directe `fs.writeFile` in app-code — altijd via de abstractie.

---

## Datamodel

Nieuwe Prisma-entiteiten en -velden, aansluitend op de bestaande `types.ts` in de prototype.

### `DocumentSession` (nieuw)

```prisma
model DocumentSession {
  id            String   @id @default(cuid())
  workspaceId   String
  folderId      String?              // null = root
  prompt        String               // de gebruikersopdracht
  outputFormat  String               // 'pdf' | 'docx' | 'xlsx' | 'pptx'
  exportMode    String               // 'fidelity' (PDF, niet bewerkbaar) | 'editable' (docx/xlsx)
  writingLevel  String               // 'student' | 'professional' | 'technical'
  tone          String               // 'formal' | 'business' | 'concise' | 'narrative'
  includeCitations Boolean @default(false)
  skillKey      String?              // SkillEntry.id, surface:'document'
  roundTripSourceUri String?         // storage URI van het geüploade bronbestand (round-trip pad)
  status        String               // 'running' | 'generating' | 'rendering' | 'done' | 'failed'
  commitHash    String               // frozen codebase-versie (voor codebase-bewuste docs)
  createdBy     String               // userId
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  attachments   DocumentAttachment[]
  artifacts     DocumentArtifact[]
  workspace     Workspace @relation(fields:[workspaceId], references:[id])
}
```

### `DocumentAttachment` (nieuw) — losse bijlage voor één sessie

```prisma
model DocumentAttachment {
  id          String   @id @default(cuid())
  sessionId   String
  name        String
  storageUri  String               // storage-abstractie URI
  mimeType    String
  sizeBytes   Int
  parsed      Boolean  @default(false)
  parsedText  String?              // geëxtraheerde platte tekst na sandbox-parsing
  uploadedAt  DateTime @default(now())

  session     DocumentSession @relation(fields:[sessionId], references:[id])
}
```

(Een `uploaded`-tint `InfoDoc` die als RAG-bron is gemarkeerd, wordt opgeslagen in het bestaande `InfoDoc`-model en `RagEntry`, niet hier.)

### `DocumentArtifact` (nieuw) — het opgeslagen eindproduct

```prisma
model DocumentArtifact {
  id              String   @id @default(cuid())
  workspaceId     String
  folderId        String?
  sessionId       String?              // FK naar de generatie-sessie
  title           String
  outputFormat    String               // 'pdf' | 'docx' | 'xlsx' | 'pptx'
  storageUri      String               // storage-abstractie URI van het eindbestand
  contentUri      String               // storage URI van het AI-tussenformaat (Markdown/JSON)
  skillKey        String?
  promptUsed      String
  writingLevel    String
  tone            String
  commitHash      String               // codebase-versie ten tijde van generatie
  hasCitations    Boolean @default(false)
  createdBy       String
  createdAt       DateTime @default(now())

  ticketLinks     DocumentArtifactLink[]
  workspace       Workspace @relation(fields:[workspaceId], references:[id])
}

model DocumentArtifactLink {
  artifactId  String
  ticketId    String
  linkedBy    String
  linkedAt    DateTime @default(now())
  artifact    DocumentArtifact @relation(fields:[artifactId], references:[id])

  @@id([artifactId, ticketId])
}
```

### Uitbreidingen op bestaande modellen

```prisma
// Workspace — sub-budget voor document-agents
model Workspace {
  // ...bestaande velden...
  documentConcurrencyCap  Int  @default(3)  // max gelijktijdige document-agent sessies
}

// SkillEntry — surface-filter (al geïntroduceerd in 02-designer, hier document-variant)
// surface: 'design' | 'marketing' | 'document' | undefined (= generiek)
// Prisma: String? — null = generiek skill
// Nieuw veld voor document-skills:
// referenceDocUri: String?  (storage URI van een referentiedocument dat stijl/structuur aanlevert)
```

### `TicketArtifact` uitbreiding (bestaand)

De bestaande `TicketArtifact` (via `AgentRole.ingest`) krijgt `kind:'document'` en verwijst naar een `DocumentArtifact.id` als `sourceUri`. `TicketDetail` rendert dit via `ArtifactViewerRegistry` met `DocumentViewer` (preview + download-knop; voor PDF inline preview via `<iframe>`/`<object>`, voor xlsx een tabel-render).

### `InfoDoc` uitbreiding (bestaand)

Geen nieuw veld nodig. Een upload die als RAG-bron is aangemerkt, leeft in het bestaande `InfoDoc{source:'uploaded'}` + bijbehorende `RagEntry`. De `DocumentAttachment` is specifiek voor losse-bijlage-uploads die niet in de globale kennisindex moeten.

---

## UX & flows

### Globale navigatie

Documenten verschijnt als extra sidebar-item onder de optionele FeatureModules, toggle-baar in Workspace Settings → Features. Volgorde in de nav: Board / Backlog / Pipeline / Terminals / Studio / **Documenten** / Sources / AI-panel. Op mobiel: extra item in het bottom tab-overflow sheet.

### Scherm 1 — Documenten-overzicht

```
┌ Documenten                              [ + Nieuw document ] ┐
│ ┌ 📁 release-notes (4) ┐  ┌ 📁 technische rapporten (2) ┐   │
│ │ Laatste: "v0.2.0"    │  │ Laatste: "API-spec"         │   │
│ └───────────────────── ┘  └──────────────────────────── ┘   │
│                                                               │
│ ┌ 📄 recent: release-notes v0.2.0 · skill: formeel · 1u ┐   │
│ │  [PDF]  [Download]  [Koppel aan ticket]                │   │
│ └─────────────────────────────────────────────────────── ┘   │
└───────────────────────────────────────────────────────────────┘
```

Desktop: folders als grid (md:grid-cols-2 lg:grid-cols-3), recente artifacts als lijst. Mobiel: single column.

### Scherm 2 — Nieuw document (bottom-sheet / slide-in sheet)

Stap-voor-stap in één sheet (zelfde patroon als Designer Studio, gedeeld tool-framework):

**Stap 1 — Format & exportmodus**
Segmented control: `PDF` / `Word` / `Excel` / `PowerPoint`.
Onder het format-select: radiogroup "Exportmodus" — `Afgewerkt (PDF, niet bewerkbaar)` / `Bewerkbaar (docx/xlsx, verder te bewerken)`. PDF is altijd afgewerkt; docx/xlsx kunnen beide; pptx altijd afgewerkt V1.

**Stap 2 — Opdracht & instellingen**
- Tekstarea voor de opdracht (max 1200 tekens).
- "Schrijfniveau": `Dropdown` — student / professioneel / technisch (met korte beschrijving per optie).
- "Toon": `Dropdown` — formeel / zakelijk / beknopt / narratief.
- "Citaties opnemen": toggle (default: uit). Zichtbaar als er bronnen zijn geselecteerd in stap 3.

**Stap 3 — Bronnen**
Twee sub-secties:

*Projectkennis (RAG)*: multi-select van bestaande `InfoDoc`-rijen (gegenereerd/git/uploaded-als-kennis), plus een "Voeg upload toe → als projectkennis"-knop die direct naar de upload-sheet gaat.

*Losse bijlagen* (alleen voor deze opdracht): upload-dropzone. Per geüpload bestand: naam + "Kennis vs Bijlage"-radioswitch. Bijlagen (attachment) gaan niet in de RAG-index; kennis (RAG) gaat als `InfoDoc{source:'uploaded'}` plus indexering.

Subtiele notice (niet-blokkerend, inline in de sectie): "Toevoeging van bronnen start een achtergrond-indexering voor nieuwe kennisbestanden." (Analogie met de Interviewer-notice — `round3/interviewer-deep.md`.)

**Stap 4 — Skill & referentiedocument**
`Dropdown` van beschikbare document-skills (`surface:'document'`), met frozen/live badge per skill.
Als de gekozen skill een `referenceDocUri` heeft: kleine preview van het referentiedocument (bestandsnaam + icon). Optioneel: override met een nieuwe upload ("gebruik dit als referentiedocument voor stijl").

**Stap 5 — Round-trip (conditioneel)**
Alleen zichtbaar als format = Word of Excel. Toggle: "Bewerk een bestaand document". Als aan: upload-dropzone voor het bronbestand (`.docx` / `.xlsx`). De opdracht in stap 2 fungeert dan als bewerkingsinstructie ("vul hoofdstuk 3 aan", "maak hiervan een samenvatting-spreadsheet").

**Stap 6 — Folder & genereer**
- Folder kiezen of `+ Nieuwe folder` inline.
- "Genereer document" — knop. Sheet sluit; voortgangs-card verschijnt op de Documenten-pagina.

**Mobiel:** bottom-sheet, dezelfde stappen. "Genereer"-knop sticky onderaan. Stap 3 upload-dropzone vervangt door file-picker button op mobiel.

### Scherm 3 — Generatie-voortgang (op de Documenten-pagina)

```
┌ Documenten › release-notes › "v0.2.0 changelog"          ┐
│  ◐ Inhoud schrijven…                    [Annuleer]         │
│                                                            │
│  Stap 1: Inhoud schrijven  ●                               │
│  Stap 2: Bestand renderen  ○                               │
│  Stap 3: Opslaan           ○                               │
│                                                            │
│  [streamed inhoud preview, zodra beschikbaar]              │
└────────────────────────────────────────────────────────────┘
```

- De voortgangsindicator toont twee stappen: AI-generatie (PTY-sessie) + deterministische render (sandbox-job).
- Streamed inhoud-preview: zodra de agent `emit_output` emits met het tussenformaat (Markdown), toont de UI alvast de platte tekst — voor de gebruiker een bevestiging dat er iets gebeurt.
- Annuleer stopt de sessie (control-API Conductor-actie, B-23).

### Scherm 4 — Artifact-view

```
┌ Documenten › release-notes › v0.2.0.pdf          [↓ Download] ┐
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  [PDF inline preview via <iframe> / <object>]            │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Skill: formeel · Schrijfniveau: professioneel · 12 jun 2026   │
│  Bronnen: project-summary, conventions (2 bestanden)           │
│  [Koppel aan ticket]  [Opnieuw genereren]                      │
└─────────────────────────────────────────────────────────────────┘
```

- PDF: `<iframe>`/`<object>` voor inline preview; fallback: download-link.
- Word/Excel: download-link met "Open in browser" fallback (LibreOffice-rendered preview als extra, V2).
- Citaties (als aanwezig): collapsible lijst van bronverwijzingen onder de preview.
- "Opnieuw genereren": opent dezelfde generatie-sheet opnieuw, prefilled met de vorige instellingen.

### Flow — Upload + sandbox-parsing

1. Gebruiker selecteert bestanden in de upload-dropzone (stap 3 van de generatie-sheet, of via de bestaande "Upload spec"-knop in de Sources-tab voor RAG-kennis).
2. Orchestrator: ontvang het bestand, check mime-type + grootte (cap: 50 MB V1; afwijzing buiten cap met foutmelding).
3. Start een **sandbox-job** (`document:parse-upload`): isolatie-container (`07b §7`, cap-drop ALL, geen netwerk, pids-limit, memory-limit), pandoc/LibreOffice extraheer platte tekst + structuurinformatie.
4. Bij succes: `DocumentAttachment` aanmaken (bijlage) of `InfoDoc{source:'uploaded'}` + `RagEntry` indexering starten via `ragDeltaQueue` (07 §D, concurrency:1, leased).
5. Bij parsing-error (corrupt bestand, onbekend formaat, timeout): foutmelding terug naar de gebruiker; upload wordt verworpen. Geen gedeeltelijk geparsed bestand in de index.

### Flow — AI-generatie

1. `DocumentSession` aanmaken met `status:'running'`.
2. `AgentSession` aanmaken met `kind:'document'`, `needsWorkspace:false` (lightweight reasoning-container).
3. Systemp prompt gebouwd uit: skill-template + opdracht + schrijfniveau + toon + citatie-instructie + geüploade bronnen-context (als RAG: `$vectorSearch` via `07 §D`; als bijlage: parsed tekst ingeladen als context).
4. PTY-sessie start in de reasoning-container (RO-auth-mount, `07b §2.5`; egress: Anthropic-only allow-list, `07b §6`).
5. Agent emits via `emit_output`: `{ contentUri (Markdown/JSON-structuur), format, citations?: [{claim, source, page?}] }`. Het tussenformaat wordt opgeslagen in de artifact-store als `contentUri`.
6. Orchestrator leest `emit_output`, start sandbox-job `document:render`.

### Flow — Deterministische render

`OrchestratorCommandRegistry.register('document:render', { run: ({ contentUri, format, skillKey, exportMode, hasCitations }) => ... })`

Inside de sandbox-job (`07b §7` — dezelfde isolatie-laag als upload-parsing, nu ook met de generator-toolchain baked in L1):

- **Markdown → PDF**: pandoc (via XeLaTeX of WeasyPrint, afhankelijk van skill-template) → `.pdf`.
- **Markdown → Word (.docx)**: pandoc + skill-gebaseerd reference.docx (de `referenceDocUri` van de skill, als aanwezig) → `.docx`.
- **JSON-structuur → Excel (.xlsx)**: exceljs (Node library, baked in L1) → `.xlsx`. Tabellen, formules (alleen safe subset: SUM/AVERAGE/COUNT), opmaak.
- **Markdown → PowerPoint (.pptx)**: `python-pptx` of `pptx-gen-js` (baked in L1) → `.pptx`. Slides gegenereerd uit Markdown-koppen (`# → titel`, `## → slide-titel`, bullets → content).

Round-trip Word/Excel:
- Download het bronbestand (`.docx`/`.xlsx`) uit `DocumentSession.roundTripSourceUri`.
- Pandoc (docx → Markdown + stijl-extractie) / exceljs (xlsx → JSON-structuur).
- AI-instructie toepassen op de geëxtraheerde structuur.
- Re-render met behoud van de originele opmaakstijl (reference.docx = het originele geüploade bestand zelf).

Output wordt via storage-abstractie opgeslagen als `DocumentArtifact.storageUri`. Job emit progress via socket room `workspace-<wsId>`.

Bij render-failure: `DocumentSession.status = 'failed'` + foutmelding terug aan de gebruiker (bevat geen raw pandoc-stderr in productie; wel een geclassificeerde reden).

### Flow — Artifact koppelen aan ticket

Zelfde patroon als Designer Studio:
- **Op de Documenten-pagina:** "Koppel aan ticket" → ticket-picker sheet.
- **Bij ticket-aanmaak:** artifact-picker met tabs "Recente documenten" + "Zoek" (semantische search op `title + promptUsed`). Gekozen artifact = live reference (`DocumentArtifactLink`). `TicketDetail` toont het artifact via `DocumentViewer` (inline preview + download).
- De Stage-Agent die het ticket uitvoert krijgt de artifact-URI mee als context in zijn systemp prompt (via `defaultSourceIds` op de role of via carry-over), niet als directe bestand-injectie.

### Mobiele parity

- Overzicht: single-column folder-lijst, tap op folder → artifact-lijst.
- Nieuw document: bottom-sheet, zelfde stappen; upload via file-picker button.
- Voortgang: full-width progress-card.
- Artifact-view: `<iframe>` PDF-preview op desktop; download-knop op mobiel (inline preview te klein); Excel/Word altijd download.
- Alle overlays: bottom-sheets via bestaand `MenuHandler`.

---

## Bouwstappen (geordend)

### Fase 0 — Prerequisiten (blocker vóór alles)

- [ ] **P0.5 CLI spike passed** (`07b §2.6`) — managed token projection werkt. Vereist voor reasoning-container auth.
- [ ] **`FeatureModule` registratie-mechanisme** bestaat (tools-framework; al in Fase 0 van Designer Studio aangelegd).
- [ ] **Shared skill-model** (`SkillEntry.surface` veld) bestaat (Designer Studio Fase 1 legt dit aan). Voeg `referenceDocUri: String?` toe als extra veld op `SkillEntry` voor document-skills.
- [ ] **Storage-abstractie seam** aangelegd: een minimale `StorageClient` interface met `put(key, buffer)` / `get(key)` / `delete(key)` / `signedUrl(key)`. V1-implementatie = lokaal pad (`STORAGE_ROOT` env var). Geen directe `fs.*` calls in app-code voor document-blobs.
- [ ] **Generator-toolchain in L1 base-image**: pandoc, LibreOffice (headless), exceljs (Node), python-pptx of pptx-gen-js, ffmpeg (aanwezig per locked decisions). Controleer of de L1 Dockerfile deze toolchain al bevat; zo niet: toevoegen vóór Fase 2-werk.

### Fase 1 — Upload-parsing + sandbox-job (security-first)

- [ ] `OrchestratorCommandRegistry.register('document:parse-upload', { run: ... })` — geïsoleerde sandbox-job: mime-type check (allowlist: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `.xlsx`, `.pptx`, `text/plain`, `text/markdown`), grootte-check (cap 50 MB), uitvoering in isolatie-container (`07b §7`), pandoc/LibreOffice extract platte tekst + structuur.
- [ ] Upload-endpoint (`_api/workspaces/documents/upload_v1.ts`): ontvang bestand, sla raw op in storage (`documents/uploads/<sessionId>/<filename>`), start parse-job, retourneer `documentAttachmentId`.
- [ ] `DocumentAttachment` aanmaken bij upload; `parsed` vlag zetten na sandbox-succes.
- [ ] RAG-kennis-pad: als de gebruiker "als projectkennis" kiest, aanmaken van `InfoDoc{source:'uploaded'}` + push naar `ragDeltaQueue` (07 §D).
- [ ] Foutafhandeling: corrupt/te groot/onbekend formaat → gebruikersvriendelijke foutmelding zonder raw stacktrace; upload verworpen.

### Fase 2 — Datamodel + schil

- [ ] Prisma-migratie: `DocumentSession`, `DocumentAttachment`, `DocumentArtifact`, `DocumentArtifactLink` aanmaken; `Workspace.documentConcurrencyCap` toevoegen; `SkillEntry.referenceDocUri` toevoegen.
- [ ] Documenten-sidebar item registreren via `registerFeatureModule({ id:'document', label:'Documenten', icon:faFileText, core:false })`.
- [ ] `Workspace Settings → Features` toggle voor Document Studio.
- [ ] Skills-tab: document-skills filteren op `surface:'document'` in `SkillRow`-lijst (zelfde patroon als `surface:'design'`).

### Fase 3 — AI-generatie-engine

- [ ] `registerAgentRole({ key:'document', needsWorkspace:false, artifactKind:'document', outputSchema:{ contentUri:string, format:string, citations?:[{claim,source,page?}] }, systemPromptTemplate:'...', defaultSkillKeys:[], defaultSourceIds:['AI_PROJECT_INDEX','AI_CAPABILITIES'], ... })`.
- [ ] System-prompt-template schrijven: instructies voor clean output (geen AI-boilerplate, geen placeholders zoals "voeg hier een voorbeeld in"), schrijfniveau/toon-variabelen, citatie-instructies (per claim een `[[source:N]]` markering), format-specifieke structuurinstructies (Markdown voor pdf/docx/pptx; JSON-schema voor xlsx).
- [ ] `documentConcurrencyCap` enforcement in `CapacityManager` (sub-limit check naast `MAX_RESIDENT`, `07b §8.2`).
- [ ] `DocumentSession` aanmaken + `AgentSession` (reasoning-container) bij "Genereer".
- [ ] PTY-sessie start in de reasoning-container; bronnen worden aan de context toegevoegd (bijlagen als platte tekst; RAG via `$vectorSearch` op `commitHash`).
- [ ] Orchestrator leest `emit_output` van de agent; slaat tussenformaat op via storage-abstractie; update `DocumentSession.status = 'rendering'`.
- [ ] Voortgang naar socket room `workspace-<wsId>` (event: `document:session:update`).

### Fase 4 — Deterministische render-pipeline

- [ ] `OrchestratorCommandRegistry.register('document:render', { run: ({ contentUri, format, skillKey, referenceDocUri?, exportMode, hasCitations }) => ... })`.
- [ ] PDF-render: pandoc Markdown → PDF (XeLaTeX backend; skill-template bepaalt `--template`-arg); citaties als voetnoten via pandoc `[@source]`-syntaxis.
- [ ] Word-render: pandoc Markdown → `.docx` met `--reference-doc=<referenceDocUri>` (skill-referentiedocument of default). Round-trip: download origineel → pandoc-extract → AI-instructie → re-render met origineel als reference-doc.
- [ ] Excel-render: JSON-structuur → exceljs; ondersteunde cel-types: string, number, formula (safe subset: SUM/AVERAGE/COUNT/IF), datum. Round-trip: exceljs parse → JSON → AI-instructie → exceljs render.
- [ ] PowerPoint-render: pptx-gen-js/python-pptx; Markdown-koppen als slide-structuur; bullets als content. V1 = genereer-only (geen round-trip pptx).
- [ ] Render-output opgeslagen via storage-abstractie; `DocumentArtifact` aangemaakt; `DocumentSession.status = 'done'`.
- [ ] Render-failure: `status = 'failed'` + geclassificeerde foutmelding (geen raw pandoc-stderr in productie).

### Fase 5 — UI (Documenten-pagina)

- [ ] `Documents.tsx` — overzichtspagina: folder-grid, recente artifacts, "Nieuw document"-knop.
- [ ] `NewDocumentSheet.tsx` — de bottom/slide-in sheet met de 6 stappen. Reuse: `Dropdown`, `MultiSelectDropdown`, `Sheet`, `MenuHandler`, upload-dropzone (uitbreiden van bestaande Sources upload-component).
- [ ] `DocumentSessionCard.tsx` — voortgangs-card met twee-staps-indicator (genereren / renderen), streamed tekst-preview, annuleer-knop.
- [ ] `DocumentArtifactView.tsx` — artifact-view: PDF inline preview (`<iframe>`), download-knop, skill/instellingen-metadata, citaties-sectie, koppel-knop, opnieuw-genereer-knop.
- [ ] `DocumentViewer.tsx` — geregistreerd via `registerArtifactViewer('document', ...)`. Toont: inline preview (PDF) of download-link (docx/xlsx/pptx) + metadata. Wordt gebruikt in `TicketDetail`.
- [ ] Websocket-subscribe in `Documents.tsx` op `workspace-<wsId>` voor `document:session:update` events.

### Fase 6 — Artifact-store + koppeling

- [ ] "Koppel aan ticket"-flow: ticket-picker sheet (reuse `MenuHandler`); `DocumentArtifactLink` aanmaken.
- [ ] Artifact-picker in ticket-create modal (tabs: recente documenten + semantische search via RAG op `title + promptUsed`).
- [ ] `TicketDetail` toont linked document-artifacts via `DocumentViewer`.
- [ ] Stage-Agent carry-over: `DocumentArtifact.storageUri` opnemen als `defaultSourceIds` op de `document`-role config wanneer een artifact aan een ticket is gekoppeld.

### Fase 7 — Skill-bibliotheek

- [ ] Minstens 4 starter document-skills opleveren: `technisch-rapport` (formeel, professioneel niveau, secties: inleiding/methode/resultaten/conclusie), `release-notes` (beknopt, zakelijk, bullet-georiënteerd), `data-export` (Excel, tabel-gericht, formules-ondersteund), `presentatie-deck` (PowerPoint, slide-per-hoofdpunt, bullets). Elk als `SkillEntry` met `surface:'document'`, `kind:'frozen'`, system-prompt-template.
- [ ] Skill-authoring via Sources-tab: Admins/Owners kunnen skill toevoegen (naam, beschrijving, sjabloon-instructie, toon-overrides, optioneel referentiedocument uploaden).
- [ ] `referenceDocUri` upload in skill-create-flow: zelfde sandbox-parsing als Fase 1, opgeslagen in storage.

### Fase 8 — Round-trip verificatie

- [ ] Integration test voor Word round-trip: upload een `.docx`, AI past hoofdstuk 3 aan, export downloaden, opmaak behouden verificatie (niet volledig maar baseline: bestand open-baar + tekst aanwezig).
- [ ] Integration test voor Excel round-trip: upload een `.xlsx`, AI vult kolom aan, export downloaden, cel-waarden verifiëren.
- [ ] Error-paden: corrupt upload, render-timeout, te groot bestand — allemaal gestuurd naar gebruikersvriendelijke foutmelding.

---

## Risico's & open punten

### Capaciteitsrisico (kritisch)

Document-agent-sessies zijn `needsWorkspace:false` (lightweight reasoning-containers, `07b §2.5`) en zijn daarmee goedkoper dan een volledige L3-worktree-container. Maar de render-job (pandoc/LibreOffice) draait in een aparte sandbox-container die wél zware resources vraagt (LibreOffice headless kan 500 MB+ RAM trekken per render). De `documentConcurrencyCap` (default 3) begrenst het aantal gelijktijdige sessies, maar moet ook de render-jobs meerekenen. **Open punt:** bepaal de werkelijke resource-kosten van een LibreOffice-headless render op de referentiehost (8 vCPU / 32 GB, `07b §8.1`) vóórdat de cap definitief wordt ingesteld. Een PowerPoint-render met afbeeldingen kan zwaarder zijn dan een tekst-PDF.

### Upload-veiligheid (kritisch; security-first)

Geüploade office-bestanden (met name `.docx` als zip-container en `.xlsx`) zijn een klassiek aanvalsoppervlak: XXE in XML-parsing, zip-bombs, macro's, externe OLE-verwijzingen. Alle parsing in de sandbox-container (`07b §7`, cap-drop ALL, geen netwerk, pids-limit 512, memory 3g) mitigeert dit, maar:
- LibreOffice headless heeft een ruim aanvalsoppervlak. Overweeg `--headless --norestore --nofirststartwizard` vlaggen en een extra seccomp-profile.
- Macro's in `.docx`/`.xlsx` moeten worden uitgeschakeld bij parsing (pandoc en LibreOffice doen dit standaard bij headless; expliciiet verifiëren).
- Zip-bombs: grootte-cap vóór extractie (op compressed én uncompressed grootte, `07b §7` disk-quota).
- **Open punt:** laat een security-review lopen op de parse-job sandbox-configuratie vóór productie. D74 in `features/15_SOURCES_MANAGEMENT.md` stelde binary-upload bewust uit — dit plan override dat bewust; de extra mitigaties moeten gedocumenteerd worden in een ADR.

### Format-fidelity bij round-trip

Word-documenten met complexe opmaak (tabellen in tabellen, track changes, embedded objecten) overleven een pandoc round-trip niet integraal. PowerPoint met master slides, animaties of embedded media is niet ondersteund in V1. **Open punt:** definieer een heldere "ondersteunde subset" per round-trip formaat (communicated in de UI als "Opmaak wordt behouden voor standaard stijlen; complexe opmaak kan vereenvoudigd worden") en fail graceful als de geëxtraheerde structuur leeg is.

### Grounding vs hallucinatie

Een professioneel opgemaakt document met verzonnen inhoud is gevaarlijker dan zichtbaar-ruwe output. De grounding-instructie in de skill-template dwingt de agent om claims te baseren op de geladen bronnen. Maar bij `includeCitations:false` of wanneer de bronnen schaars zijn, is hallucinatie-risico hoger. **Open punt:** overweeg een post-processing check (na `emit_output`) die detecteert of de agent bronverwijzingen heeft gegenereerd die niet in de gelaadde context voorkomen — en zo ja, een `needs-input` signal emit ("kon niet alle beweringen verankeren; wil je citaties inschakelen of meer bronnen toevoegen?").

### Storage-abstractie scope-creep

De storage-abstractie is aangelegd voor Document Studio + Marketing (blobs). Maar zodra de seam bestaat, zullen andere onderdelen geneigd zijn er ook gebruik van te maken (log-exports, screenshot-artifacts van Designer Studio). **Open punt:** definieer nu al welke modules de storage-abstractie mogen aanroepen (Document, Marketing) en welke dat buiten scope is voor V1 — anders groeit de seam onbeheerd.

### Skill-kwaliteit en referentiedocumenten

Een `referenceDocUri` in een document-skill is een stijl-anker dat de AI probeert te imiteren. Als het referentiedocument slecht gestructureerd is of een formaat heeft dat pandoc slecht extraheert, verslechtert de kwaliteit stil. **Open punt:** voeg een validatie-stap toe bij skill-opslaan: parse het referentiedocument in de sandbox en rapporteer als de tekst-extractie leeg of te kort is.

### D74-override juridisch/organisatorisch

`features/15_SOURCES_MANAGEMENT.md §Resolved D74` beperkte uploads bewust tot `md/txt`. Deze override (binary formats in Document Studio) is gemotiveerd maar breekt een locked beslissing. **Actie:** schrijf een ADR (bijv. `docs/decisions/0005-document-upload-binary-formats.md`) met de context (D74 was voor de generale Sources-tab; Document Studio heeft zijn eigen parse-pipeline in de sandbox) en de consequenties. Zet dit als eerste bouwstap in Fase 1 vóór implementatie.

### Academische integriteit (harde grens — zie begin van dit document)

Geen open punt; de grens is hard. Documenteer deze grens ook in de skill-template-instructies en in de workspace-settings beschrijving van de feature ("Document Studio genereert professionele, goed opgemaakte documenten. Het bevat geen modus om AI-detectie te omzeilen.").
