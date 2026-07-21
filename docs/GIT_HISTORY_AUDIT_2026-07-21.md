# Git-history- en integratie-audit — 2026-07-21

## 1. Samenvatting

Deze audit beoordeelt de recente ontwikkeling van Workspaces op regressies, achtergebleven bugs, multi-userconvergentie, slecht gekoppelde features, dode AI/UI-functionaliteit en semantische duplicatie.

**Auditbasis**

- Stabiele baseline: `main` op `6acbb67` (`chore: annotate tenant-safe recovery sweeps`).
- Rolling venster van veertien dagen: **375 commits**; kalenderperiode 8–21 juli: **360 commits**, circa **129.786 toevoegingen** en **23.036 verwijderingen**.
- Hoogste churn: `server/orchestrator/conductor.ts` (74 commits), `WorkspacesProvider.tsx` (67), `WorkspacesContext.tsx` (54), `workspaceSnapshot.ts` (45) en `prisma/schema.prisma` (39).
- De worktree had bij aanvang **76 niet-gecommitte statusregels** van parallel werk. Die wijzigingen zijn alleen ter vergelijking gelezen en niet als reeds geleverd beschouwd.
- Dit was een statische audit. Er is geen browser of server gestart. Claims die echte sockets, Redis-adapterfan-out, meerdere processen of Docker vereisen staan daarom als **needs-live**.

### Hoofdconclusie

De onderliggende single-writer-architectuur is sterk verbeterd, maar enkele zichtbare productoppervlakken lopen daar nog omheen of presenteren observability als realtime terwijl de bijbehorende delta ontbreekt. De grootste open problemen zijn:

1. **Handmatig een ticket naar een andere Kanbanfase verplaatsen is alleen lokale React-state.** De wijziging verdwijnt na refresh en kan een echte move van een andere gebruiker blijvend maskeren.
2. **De workspace-Activity-pagina is niet werkelijk live voor de belangrijkste ticketwrites.** `TicketEvent` wordt wel opgeslagen, maar niet naar clients gedistribueerd.
3. **De centrale AI-activityfeed is proces-lokaal.** Runs verdwijnen bij restart en verschillen per app-instance.
4. **De suggestion-lifecycle is deels cosmetisch.** Dismiss is lokaal, Snooze is een zichtbare no-op en meerdere suggestiontypes hebben geen uitvoerbaar accepteffect.
5. **Ticket↔ticket-relaties zijn end-to-end niet af.** Er is een model en blocks-gate, maar geen werkende create-/readprojectie en de zichtbare linkknoppen doen niets.
6. **Workflow-“skills” zijn niet alleen dubbel gemodelleerd, maar ook runtime-dood.** De lopende ADR 0295 consolideert opslag, maar `renderStage` start nog steeds een niet-bestaand `ws-skill`-commando en de ids van UI, stageconfig en runtime zijn niet canoniek gelijk.

De expliciete vraag **“skills versus designthemes”** heeft dus twee antwoorden:

- De twee skillstores waren een echte semantische duplicatie; consolidatie is terecht, maar nog in uitvoering en nog niet voldoende om de runtime te laten werken.
- Design themes, design styles en premade looks zijn **geen duplicaten**: respectievelijk palette, componentgedrag en een samengestelde preset. Ze moeten niet in één model worden samengevoegd. De term “design skills” in comments/copy is wel verwarrend en moet verdwijnen.

---

## 2. Legenda en prioriteit

| Label | Betekenis |
|---|---|
| **Bevestigd** | Het defect volgt rechtstreeks uit de huidige codeflow. |
| **Risico** | De huidige architectuur voorkomt het normale pad, maar een contract of harde invariant ontbreekt. |
| **Stale** | Test, comment of document beschrijft niet langer de code. |
| **In uitvoering** | De stabiele baseline heeft het probleem; de bewegende worktree bevat een nog niet geleverde oplossing. |
| **Bewust verschillend** | Gelijksoortige namen, maar aantoonbaar andere lifecycle/semantiek. |
| **Needs-live** | Statische code ziet er plausibel uit, maar de geclaimde multi-client/multi-instance-eigenschap is niet werkelijk bewezen. |

Prioriteiten:

- **P0:** dataverlies/security/autoriteitsbreuk.
- **P1:** kernflow liegt, divergeert tussen gebruikers of is functioneel dood.
- **P2:** belangrijke UX-/testbetrouwbaarheid of latent correctness-risico.
- **P3:** stale documentatie/naamgeving zonder directe runtime-impact.

---

## 3. Bevindingenoverzicht

| ID | Prio | Status | Bevinding |
|---|---:|---|---|
| A-01 | P1 | Bevestigd | Handmatige Kanbanmove is lokaal en kan serverstate van een andere gebruiker maskeren. |
| A-02 | P1 | Bevestigd | Ticket-Activity is snapshot-only ondanks de zichtbare “Live”-claim. |
| A-03 | P1 | Bevestigd | AI-activityfeed is proces-lokaal en daardoor niet multi-instance- of restartconvergent. |
| A-04 | P1 | Bevestigd | Suggestion Dismiss/Snooze en accept-receipts zijn niet duurzaam/betrouwbaar. |
| A-05 | P1 | Bevestigd | Ticketrelaties en `link-tickets` zijn een onafgemaakte end-to-end feature. |
| A-06 | P1 | Bevestigd + in uitvoering | Workflow-capabilities hebben dubbele opslag én een ontbrekende runtime; ADR 0295 lost alleen het eerste deel op. |
| A-07 | P2 | Bevestigd | “Add reference” in het Code-paneel is dood terwijl dezelfde capability elders werkt. |
| A-08 | P2 | Stale | Effectmatrix noemt twee al gerepareerde contentops nog productiebugs. |
| A-09 | P2 | Needs-live | Realtime-convergencetest bewijst broncodepatronen, geen twee clients of twee instances. |
| A-10 | P2 | Risico | `TicketEvent.seq`-contract zegt Redis-INCR, maar gebruikt read-max-plus-één zonder unieke DB-guard. |
| A-11 | P3 | Stale | Activity-comment zegt nog “dummy data”, terwijl echte `TicketEvent`-rows worden gelezen. |
| A-12 | P2 | In uitvoering | Parallelle worktree heeft twee ADR’s met id `0294`; dit moet vóór commit worden opgelost. |

---

## 4. Gedetailleerde bevindingen

### A-01 — Handmatige Kanbanmove is een lokale illusie

**Prioriteit/status:** P1 · **Bevestigd**

**Bewijs**

- `src/workspaces/develop/board/KanbanCard.tsx` → `StageMovePicker` roept `ctx.moveTicket(ticket.id, stageId)` aan.
- `src/workspaces/_shell/WorkspacesProvider.tsx` implementeert `moveTicket` uitsluitend als:
  `setStageOverrides(prev => ({ ...prev, [id]: stage }))`.
- `src/workspaces/develop/board/page.tsx` bouwt de kolommen uit `stageOverrides`; er volgt geen `syncRequest`, Control-API-op of Conductor-write.
- De reconcile-effect verwijdert een override alleen als de server al **dezelfde** stage bevat. Als gebruiker B het ticket naar een andere stage verplaatst, blijft gebruiker A’s lokale override dus staan en maskeert die echte servermove.
- Het lokale mechanisme bestond al sinds 1 juli, maar commit `ae7b217` van 19 juli maakte het via de nieuwe kaartactie zichtbaar en productmatig geloofwaardig.

**Impact**

- Refresh of nieuw device verliest de move.
- Andere leden zien de move niet.
- Een latere echte move van een andere gebruiker kan lokaal blijvend verborgen blijven.
- De UI omzeilt de B-23-belofte dat writes via Control API → Conductor lopen.

**Aanbevolen oplossing**

- Hergebruik de bestaande `bulk-move`-write met één ticket; voeg geen nieuwe verb toe.
- Maak `moveTicket` een echte async write met `clientRequestId` en foutreceipt.
- Houd hooguit een optimistic override vast tot ACK/delta, en verwijder hem bij **iedere nieuwere authoritative ticketversie**, niet alleen bij een gelijk stage-id.
- Toon een fout en herstel de serverkolom als de write faalt.

**Verificatie**

1. Client A verplaatst DEV-1; client B ziet dezelfde kolom zonder refresh.
2. Client B verplaatst DEV-1 opnieuw; client A convergeert naar B’s nieuwere move.
3. Refresh op beide clients behoudt de laatste move.
4. Geforceerde serverfout verwijdert de optimistic override en toont een zichtbare fout.

---

### A-02 — De Ticket-Activity-pagina is niet werkelijk live

**Prioriteit/status:** P1 · **Bevestigd**

**Bewijs**

- `server/orchestrator/conductor.ts::recordTicketEvent` schrijft echte `TicketEvent`-rows voor quick-add, edit, comment, archive, bulk-move, status, assign, sprint en antwoorden.
- `server/read/workspaceSnapshot.ts` leest de nieuwste vijftig events en projecteert die naar `snap.events`.
- `src/workspaces/insights/activity/page.tsx` rendert alleen `activityEvents: snap.events` en toont een prominente **Live**-badge.
- `server/orchestrator/conductor.ts::WORKSPACE_DIRTY_SKIP` slaat juist de hete ticketops over, omdat zij al een ticketdelta uitsturen.
- `server/read/broadcast.ts::broadcastTicketDelta` verstuurt alleen tickets, niet de nieuwe `TicketEvent`.
- In `WorkspacesProvider.tsx` bestaat geen event-delta-callback die `snap.events` upsert.

**Impact**

De boardkaart convergeert, maar de Activity-pagina van zowel initiator als andere leden blijft achter totdat een toevallige full refetch, een andere cold write of een reload plaatsvindt. Dit is precies een multi-user-integratiebreuk: verschillende slices van dezelfde write hebben een andere realtimegarantie.

**Aanbevolen oplossing**

- Laat de appendfunctie de complete nieuwe eventprojectie teruggeven.
- Broadcast een read-only `ticketEventDelta` met minimaal `id`, `ticketId`, `seq`, `createdAt`, `type`, `actor` en `text`; client upsert op `id` en sorteert workspacebreed op `createdAt`.
- Alternatief: voeg het event aan de bestaande ticketdelta toe. Een gerichte eventdelta verdient de voorkeur boven full refetches op iedere boardwrite.
- Projecteer geen reeds geformatteerde `HH:MM` als identiteit; de huidige samengestelde React-key kan botsen.

**Verificatie**

- Twee clients staan op Activity; één derde client doet achtereenvolgens quick-add, edit, comment en move. Elk event verschijnt één keer en in dezelfde volgorde zonder refetch.
- Herlevering van dezelfde socketdelta blijft idempotent.
- Snapshot-na-subscribe levert geen dubbel event op.

---

### A-03 — Centrale AI-activityfeed is proces-lokaal

**Prioriteit/status:** P1 · **Bevestigd**

**Bewijs**

- `server/ai/activity.ts` gebruikt moduleglobals `RING`, `MAX` en `seq`.
- `listAiRuns(workspaceId)` leest alleen de ring van het huidige Node-proces.
- `server/read/workspaceSnapshot.ts` presenteert dit als `aiRuns` van de workspace.
- De ring is globaal op 80 runs begrensd: drukte in workspace A verdringt dus ook historie van workspace B.
- Commit `bea1c6b` introduceerde dit bewust als “in-memory live activity” op 5 juli; de huidige multi-instance-invariant en de centrale UI-belofte zijn inmiddels breder geworden.

**Impact**

- Een restart wist de feed.
- Twee app-instances tonen verschillende activity.
- Snapshotrequests die via een andere replica lopen, missen runs.
- De ids `air-1`, `air-2`, … botsen na restart en tussen replicas.
- Een drukke tenant verkort de zichtbare window van andere tenants, ook al worden rows bij uitlezen wel gefilterd.

**Aanbevolen oplossing**

- Maak een tenant-scoped duurzame `WorkspaceAiRun`-factstream, of een gelijkwaardige bestaande workspace-eventlaag als de payload-/retentie-eisen passen.
- Schrijf completionrecords via een getypeerde interne Conductor-completion; AI-providerwerk blijft buiten de lease, alleen de korte append zit binnen de writergrens.
- Gebruik een deterministisch run-id/request-id voor retries.
- Definieer retentie per workspace en redacteer gevoelige promptdelen vóór persistence.
- Broadcast een delta voor directe zichtbaarheid; snapshot is de catch-up.

**Verificatie**

- Run op instance A is direct zichtbaar via instance B.
- Restart behoudt de bounded feed.
- Tachtig runs in workspace A verwijderen geen run uit workspace B.
- Retry van dezelfde completion maakt geen duplicaat.

---

### A-04 — Suggestion-lifecycle is deels cosmetisch

**Prioriteit/status:** P1 · **Bevestigd**

**Bewijs**

- `WorkspacesProvider.tsx::dismissSuggestion` voegt alleen een id aan `localSuggestionsDismissed` toe; de DB-status blijft `open`.
- Na refresh of op een ander device verschijnt dezelfde suggestion opnieuw.
- `Shell.tsx::onSnoozeSuggestion` is een lege functie, maar de klokknop is zichtbaar en klikbaar.
- `acceptSuggestion` verbergt de kaart lokaal direct nadat een fire-and-forget request is gestart. Een serverfout heeft geen receipt in deze UI-flow.
- `accept-suggestion` heeft uitvoereffecten voor `automation`, `mr-review`, `rollback` en `publish`; andere types worden alleen `accepted` gemarkeerd.
- `asSugType` en de clientunions kennen niet alle werkelijk opgeslagen types (`mr-review`, `rollback`, `publish`, `plan-critique`), waardoor die naar `maintenance` worden afgevlakt.
- De per-route-test voor acceptatie controleert alleen de statusflip, niet het type-specifieke business-effect.

**Impact**

De mens denkt een voorstel te hebben afgehandeld, terwijl het terugkomt, niets uitvoert of bij een mislukte acceptatie uit beeld verdwijnt. Dat beschadigt precies de phone-first human-in-the-middle-loop.

**Aanbevolen oplossing**

- Maak de bestaande suggestion-actionwrite duurzaam voor `accept`, `dismiss` en eventueel `snoozeUntil`; houd de frozen structured-channelverbset ongewijzigd.
- Verberg Snooze totdat er een echte serversemantiek is, of implementeer die onder dezelfde bestaande actionroute.
- Wacht op ACK/receipt voordat de kaart definitief verdwijnt; laat fouten zichtbaar en retrybaar.
- Voeg een expliciete server-side effectclassificatie toe: `acknowledge` versus `apply`. Toon geen “Accept” alsof er een mutatie volgt als het alleen erkenning betekent.
- Maak de suggestiontype-union gelijk aan de persistente werkelijkheid.

**Verificatie**

- Dismiss en snooze convergeren over twee clients en over reload.
- Elke appliable suggestiontest controleert de echte postconditie, niet alleen `status='accepted'`.
- Een geforceerde acceptatiefout laat de kaart staan met retry.

---

### A-05 — Ticket↔ticket-relaties zijn end-to-end onaf

**Prioriteit/status:** P1 · **Bevestigd**

**Bewijs**

- `prisma/schema.prisma::TicketLink` bestaat en `openBlockersFor` in de Conductor gebruikt `rel='blocks'` daadwerkelijk als gate.
- Er is geen `ticketLink.create`-pad in de Conductor.
- Acceptatie van `link-tickets` maakt geen link; zij markeert alleen de suggestion accepted.
- Buiten testfixtures wordt in servercode geen `link-tickets`-suggestion geproduceerd. De ontworpen collision radar is dus niet actief.
- `workspaceSnapshot.ts` vraagt geen `TicketLink`-rows op en `toTicket` vult `Ticket.links` niet.
- `ActivityPanel.tsx` toont twee zichtbare “Link ticket”-knoppen met lege handlers.
- De bestaande acceptSuggestion-test seedt een `link-tickets`-suggestion met `ticketIds: []` en bewijst alleen de statusflip. Daardoor ziet de suite een niet-uitgevoerde link ten onrechte als geslaagde acceptatie.

**Impact**

- De links-tab is in echte workspaces structureel leeg.
- “Link ticket” doet niets.
- AI-acceptatie kan succes suggereren zonder relatie.
- De blocks-gate is alleen bruikbaar voor handmatig/extern ingevoerde DB-data.
- Collision-/dedupefunctionaliteit uit het ontwerpcorpus is niet aangesloten.

**Aanbevolen oplossing**

1. Definieer eerst de richting van `blocks` ondubbelzinnig en pin die met tests.
2. Laat `accept-suggestion(type='link-tickets')` atomisch de link(s) materialiseren vóór de statusflip; bij fout blijft de suggestion open.
3. Voeg TicketLink-rows aan de snapshot/ticketprojectie toe en broadcast een ticketdelta na link/unlink.
4. Hergebruik dit pad voor de collision-radarproducer.
5. Voor handmatige links: routeer de gebruikerswrite via een bestaande generieke ticketmutatie of een bewust goedgekeurde Control-API-op; voeg geen LLM-verb toe.
6. Verwijder de knoppen totdat het pad echt werkt.

**Verificatie**

- Acceptatie met twee geldige ticketids maakt exact één idempotente relatie.
- Beide betrokken ticketviews zien de relatie live.
- Een `blocks`-relatie verhindert de afhankelijke start tot de blocker done is.
- Ongeldige/cross-workspace ids maken geen rows en accepteren de suggestion niet.

---

### A-06 — Skills versus capabilities: opslag wordt geconsolideerd, runtime nog niet

**Prioriteit/status:** P1 · **Bevestigd** op baseline, opslagfix **in uitvoering**

#### Wat werkelijk dubbel is

Op `HEAD` zijn er twee stores die in de UI allebei “skill” heten:

1. `Skill`: prompt-instructies zoals Humanizer/Tone of voice, met apply-points.
2. `InfoSource(mode='skill')`: workflow-capabilities zoals RAG, graphify, symbol-index en test-runner.

`server/ai/skills.ts::skillPromptBlock` bewijst dat categorie 1 echt werkt: instructies gaan via de centrale AI-registry en de PTY-stage-runner. ADR 0295 in de huidige worktree verplaatst categorie 2 terecht naar `Skill(skillType='capability')`.

#### Wat ook na die migratie kapot blijft

- `server/orchestrator/renderStage.ts` genereert voor iedere `skillKey`:
  `command: 'ws-skill', args: [key]`.
- In de repository bestaat geen `ws-skill`-binary of commandcatalogus; de comment noemt dit zelf een deferred placeholder.
- Seed-stageconfigs gebruiken stabiele keys zoals `rag`, `graphify` en `symbol`.
- De Sources/pipeline-UI werkt met DB-row-ids; de migratie maakt bovendien slugs als `capability-<legacyObjectId>`.
- Er is dus geen bewezen canonieke identiteit tussen cataloguskey, DB-row, stageconfig en runtimecommando.
- De lopende migratietest controleert toggling van een capabilityrow, niet dat een bestaande stage na migratie dezelfde capability kan starten.

**Impact**

De UI kan een workflow-skill als enabled en aan een stage gekoppeld tonen terwijl Claude bij MCP-start een ontbrekend commando krijgt. Dat is functioneel dode AI-capability, geen cosmetische onvolkomenheid.

**Aanbevolen oplossing**

- Houd één `Skill`-store zoals ADR 0295, maar noem `skillType='capability'` in de UI consequent **Capability / Tool**.
- Voeg een stabiele `runtimeKey` toe (`rag`, `graph`, `symbols`, …), uniek binnen de relevante scope. Gebruik nooit ObjectIds als CLI-adapternaam.
- Definieer een server-owned capabilitycatalogus die runtimeKey → executable/args/tools/readiness mappt.
- Migreer alle `PipelineStage.skillKeys` naar die runtimeKeys en valideer onbekende keys hard bij save/render.
- Implementeer echte adapters, bij voorkeur via het bestaande `@luckystack/mcp` waar de capability al bestaat; verberg of disable niet-geïnstalleerde capabilities.
- Voeg een container-E2E toe die de gegenereerde `.mcp.json` start en minimaal één readtool per capability aanroept.

**Migratiegate voor ADR 0295**

Vóór commit moet een fixture met legacy `InfoSource(mode='skill')` + stageconfig worden geüpgraded en moet worden bewezen dat:

- metadata en enabled-state behouden blijven;
- stage-assignment naar dezelfde runtimeKey blijft wijzen;
- een rerun idempotent is;
- instruction skills nooit als runtime-MCP worden gerenderd;
- capabilityrows nooit als promptinstructie worden geïnjecteerd.

---

### A-07 — “Add reference” in CodePanel is een zichtbare no-op

**Prioriteit/status:** P2 · **Bevestigd**

**Bewijs**

- `src/workspaces/develop/board/[ticketId]/CodePanel.tsx` toont “Add reference” met een lege handler.
- `KanbanCard.tsx::ArtifactLinkPicker` implementeert dezelfde bedoeling wel echt via `ctx.linkArtifact` → `ticketArtifact` sync → Conductor.
- Beide oppervlakken zijn door de KISS-redesign van 19 juli naast elkaar komen te bestaan.

**Impact**

Dezelfde actie werkt op de kaart, maar niet in het inhoudelijk meest logische Code-paneel. De ghost-stijl verandert niet dat een klikbare knop functionaliteit belooft.

**Aanbevolen oplossing**

Extraheer de bestaande `ArtifactLinkPicker` naar een gedeeld ticketcomponent en gebruik hem vanuit beide plekken. Verwijder de CodePanel-knop als die flow daar niet gewenst is.

**Verificatie**

Klik vanuit CodePanel → kies artifact → `TicketArtifactLink` bestaat → linked-artifactkaart en agentcontext tonen het na refresh.

---

### A-08 — Effectmatrix bevat stale productiebugs

**Prioriteit/status:** P2 · **Stale**

**Bewijs**

- `tests/effectMatrix.mts` markeert zowel `content-edit-image` als `content-gen-thumbnail` als `excluded:bug`, met als reden dat `contentProjectId` alleen in `target` terechtkomt.
- Commit `c669096` wijzigde `contentControl_server_v1.ts` zodat de id naar zowel `target` als `payload` gaat.
- De actuele routecomment en regressietests beschrijven die voormalige split als gerepareerd.

**Impact**

De effectcoverage-guard is groen, maar rapporteert twee niet-meer-bestaande productiebugs. Daardoor kan de matrix niet als betrouwbare actuele risicolijst worden gebruikt en ontbreken juist de exacte postconditietests voor image-edit/thumbnail.

**Aanbevolen oplossing**

- Voeg per op een echte postconditietest toe.
- Classificeer daarna als `covered`, met verwijzing naar die test.
- Laat `excluded:bug` alleen toe met een reproduceerbare rode fixture of een actief issue-id; een vrije tekst die na een fix niet wordt herbeoordeeld is te makkelijk stale.

---

### A-09 — Realtimeconvergentie is structureel, niet gedragsmatig getest

**Prioriteit/status:** P2 · **Needs-live**

**Bewijs**

`tests/integration/realtimeConvergence.test.mts`:

- leest bestanden als tekst;
- controleert aanwezigheid van imports, routekeys, skipsetstrings en een debouncefragment;
- roept `broadcastWorkspaceDirty` alleen aan zonder IO-instance en bewijst daarmee uitsluitend “gooit niet”.

De test opent geen twee sockets, joint geen echte room, simuleert geen andere instance en controleert geen ordering. Hij kon A-01 en A-02 daarom niet vinden, hoewel zijn comment claimt dat “every small write” voor ieder lid live is.

**Aanbevolen oplossing**

Bouw een gelaagde realtime-suite:

1. **Twee clients, één instance:** A schrijft, B ontvangt iedere slice.
2. **Reconnect/catch-up:** subscribe-first → snapshot → merge zonder duplicaten.
3. **Workspacewissel:** geen oude-roomdelta’s en presence pas na bevestigde join.
4. **Twee app-instances + Redis adapter:** writer op instance A, client op B ontvangt dezelfde delta.
5. **Conflicterende moves:** nieuwere authoritative versie wint op beide clients.

De huidige broncode-asserties mogen als snelle contracttest blijven, maar niet als bewijs van convergentie.

---

### A-10 — `TicketEvent.seq` heeft contractdrift en geen harde databaseguard

**Prioriteit/status:** P2 · **Risico**, geen bevestigde normale race

**Bewijs**

- Het Prisma-commentaar zegt: monotone per-ticketsequence via Redis `INCR`.
- `recordTicketEvent`, `appendDeterministicCiEvent` en stagewriter-events doen ieder `findFirst(orderBy seq desc)` gevolgd door `seq + 1`.
- Het schema heeft alleen `@@index([workspaceId, ticketId, seq])`, geen unieke constraint.
- De huidige Conductor serialiseert workspacewrites via `wsChains` plus een cross-instance lease. Daardoor is de gewone codeflow op dit moment grotendeels beschermd; de eerdere hypothese “iedere parallelle producer racet direct” is te sterk.
- De architectuur erkent echter residuals bij leaseverlies/in-flight writes. Zonder unieke guard kan een invariantbreuk stil in dubbele sequences eindigen.

**Impact**

`seq` is gedocumenteerd als merge-/dedupekey. Een duplicate kan events overschrijven of ondeterministisch ordenen zodra clients die sequence werkelijk als delta-identiteit gebruiken.

**Aanbevolen oplossing**

- Centraliseer alle appends in één helper binnen de writercontext.
- Kies één werkelijk geïmplementeerde allocator: atomische per-ticketcounter of Redis-INCR met een duurzame idempotencystrategie.
- Voeg `@@unique([workspaceId, ticketId, seq])` toe als laatste verdedigingslinie.
- Houd deterministische event-ids voor retries; behandel een unieke-conflict als retry/reload van de allocator, niet als best-effort verlies.
- Corrigeer het schemacomment als bewust op de lease wordt vertrouwd.

**Verificatie**

Parallelle appendfixture, replay van dezelfde event-id en gesimuleerd leaseverlies leveren strikt oplopende, unieke sequences zonder dubbel event.

---

### A-11 — Activity-headercomment is stale

**Prioriteit/status:** P3 · **Stale**

`src/workspaces/insights/activity/page.tsx` zegt nog “dummy data today; the real TicketEvent log wires in later”, terwijl `workspaceSnapshot.ts` al echte `TicketEvent`-rows leest. Verwijder of actualiseer dit comment. Dit is geen dode feature; het echte probleem is A-02: de read is echt, de live-delta ontbreekt.

---

### A-12 — ADR-idbotsing in de actieve worktree

**Prioriteit/status:** P2 · **In uitvoering**

Bij aanvang stonden twee nieuwe bestanden naast elkaar:

- `docs/decisions/0294-global-writes-use-encrypted-durable-conductor-jobs.md`
- `docs/decisions/0294-per-workspace-media-generation-defaults.md`

Dit is een typisch parallel-agentmergeconflict: inhoudelijk verschillende duurzame besluiten met hetzelfde id. Los dit vóór commit op door de laatst-landende ADR opnieuw te nummeren en alle `@adr`-/indexverwijzingen te regenereren. Commit geen decision index met dubbele ids.

---

## 5. Skills versus designthemes — expliciet oordeel

### 5.1 Begrippen die wél moeten worden geconsolideerd

| Huidige term | Werkelijke semantiek | Oordeel |
|---|---|---|
| `Skill(skillType='instruction')` | Herbruikbare gedrags-/promptinstructie voor AI-output | Canonieke instruction skill; behouden. |
| Legacy `InfoSource(mode='skill')` / nieuwe capability Skill | Runtime readtool/MCP-capability voor een ontwikkelstage | Uit InfoSource halen is juist; productmatig hernoemen naar Capability/Tool. |
| Starter `InfoSource(context-doc)` | Hele contexttekst die in stageprompt wordt geladen | Geen skill; als Source/Guideline behouden. |

De opslagconsolidatie uit ADR 0295 is dus correct, maar een discriminator in één tabel betekent niet dat instruction en capability hetzelfde gedrag krijgen. Iedere query moet expliciet op `skillType` filteren, zoals de worktree nu grotendeels doet.

### 5.2 Begrippen die niet moeten worden samengevoegd

| Laag | Voorbeeld | Rol |
|---|---|---|
| Design theme | LuckyStack, Emerald, Violet | Volledige light/dark kleurentokens. |
| Design style | Apple, Material, Brutalist | Radius, schaduw, border, density, typografie en motionkarakter. |
| Premade look | Apple, Glassmorphic, Editorial | Samengestelde verwijzing naar theme + style + animation + fonts. |
| Persisted DesignArtifact | Een door workspace opgeslagen/actieve theme/style/animation | Tenantstate, historie en agentcontext. |
| StylePreset in Content | Per-mediafeature generatieprompt | Contentgeneratie, niet app-UI-design. |
| StudioBrandLibrary | Merkidentiteit/voice/palette | Workspacebrand, niet één renderpreset. |

De overlap in namen (“Apple” style én “Apple” look) is compositie, geen dubbele authoritative state. `lookToArtifacts` splitst een look bewust in theme- en style-artifacts en `saveDesignArtifact` upsert op workspace/kind/name, zodat herhaald kopiëren niet onbeperkt identieke rows maakt.

### 5.3 Aanbevolen naamgeving

- **Skills**: alleen prompt-instructies.
- **Capabilities / Tools**: RAG, graph, symbols, tests en andere runtime-tools.
- **Themes**: palette/tokens.
- **Styles**: component-/layoutgedrag.
- **Looks**: samengestelde presets.

Vervang vooral de commenttekst “design skills” in `styles.ts`; die voedt de semantische verwarring zonder technisch voordeel.

---

## 6. Wat aantoonbaar níet als bug moet worden gemeld

1. **Themes, styles en premades zijn geen duplicate tables.** Hun velden en lifecycle verschillen wezenlijk.
2. **Document, DocumentRevision en RagEntry zijn bron, historie en afgeleide index.** Samenvoegen zou de rebuildbaarheid en revisionsemantiek verslechteren.
3. **DesignArtifact, StudioArtifact, BuildArtifact en ContentAsset zijn geen geschikt mega-artifactmodel.** Eigenaarschap, retentie, security en statusmachines verschillen.
4. **`TicketEvent.seq` is niet bewezen direct te racen in de normale flow.** De huidige per-workspace chain + lease beschermt die flow; A-10 is hardening/contractdrift.
5. **De Activity-pagina is niet meer dummy.** Zij leest echte DB-events; alleen de livelevering is incompleet.
6. **De algemene `workspaceDirty`-strategie is op zichzelf verdedigbaar.** Een debounced refetch voor koude settingswrites is eenvoudiger en veiliger dan tientallen fragiele delta’s. Het probleem zit in de uitzonderingen en het ontbrekende echte convergentiebewijs.

---

## 7. Lopend werk dat nog niet als geleverd telt

De bewegende worktree bevat onder andere:

- ADR 0295 en schema-upgrade voor de skillstoreconsolidatie;
- aanwezigheid/presence-join-racefixes;
- granular content-piece-delta’s;
- durable global jobs en entity-CAS;
- workspacebrede mediadefaults.

Deze richting is grotendeels positief, maar vóór samenvoegen zijn minimaal nodig:

1. los de dubbele ADR-id `0294` op;
2. test de skillmigratie inclusief stage-runtimekeys, niet alleen rowtoggling;
3. reclassificeer de stale effectmatrixregels;
4. voer de volledige lint/build/ai:lint/testgates uit op één stabiele worktree;
5. draai de multi-client/multi-instance-suite uit A-09 zodra die bestaat.

---

## 8. Aanbevolen uitvoervolgorde

### Fase 1 — Stop zichtbare leugens

1. A-01: manual move via bestaande `bulk-move`.
2. A-04: verberg Snooze; maak Dismiss duurzaam; wacht op receipts.
3. A-07: hergebruik de werkende artifactpicker of verwijder de knop.
4. A-11: stale comment corrigeren.

### Fase 2 — Herstel realtime observability

1. A-02: `TicketEvent`-delta + id/seq-projectie.
2. A-03: duurzame, tenant-scoped AI-runfeed.
3. A-09: twee-clienttest, daarna twee-instance/Redis-test.

### Fase 3 — Maak AI-functionaliteit werkelijk uitvoerbaar

1. A-06: skillstoremigratie afronden met runtimeKey/catalogus/adapters.
2. A-05: link-suggestion materialiseren + TicketLink-readprojectie + collisionproducer.
3. Per suggestiontype een effectcontract en business-postconditietest.

### Fase 4 — Versterk invarianten en testwaarheid

1. A-08: effectmatrix actualiseren en exacte regressietests toevoegen.
2. A-10: centrale eventallocator + unique guard.
3. A-12: ADR-nummering repareren en indexes regenereren.

---

## 9. Minimale acceptatiechecklist

De audit kan als gesloten worden beschouwd wanneer:

- [ ] een stage-move na refresh blijft staan en op een tweede client verschijnt;
- [ ] Activity-events zonder refresh op twee clients verschijnen;
- [ ] AI-runs een restart en instancewissel overleven;
- [ ] dismiss/snooze/accept duurzaam zijn en fouten niet lokaal verbergen;
- [ ] `link-tickets` bij acceptatie echte `TicketLink`-rows maakt en de UI ze leest;
- [ ] iedere zichtbare reference/linkknop een effect of een disabled-uitleg heeft;
- [ ] een geactiveerde pipeline-capability vanuit een echte stagecontainer een echte toolcall kan uitvoeren;
- [ ] `content-edit-image` en `content-gen-thumbnail` in de effectmatrix als covered staan met postconditietest;
- [ ] de realtime-suite minimaal twee clients en één multi-instancepad test;
- [ ] `TicketEvent.seq` uniek en monotone is onder parallel/replay/leaseverlies-fixtures;
- [ ] er geen dubbele ADR-id in de te committen worktree staat.

---

## 10. Eindbeoordeling

De recente geschiedenis laat veel waardevolle hardening zien: Control-API/Conductorcentralisatie, tenantguards, route- en effectcoverage, Redis-ready broadcasts en een veel rijkere UI. De voornaamste regressieklasse is niet “de backend bestaat niet”, maar **een UI of observabilitysurface die een bestaande backend slechts half koppelt**. Dat verklaart waarom brede structurele suites groen kunnen zijn terwijl een gebruiker toch een klik zonder effect, een lokale move of een stale livefeed ervaart.

De hoogste hefboom is daarom niet nog meer losse features toevoegen, maar drie generieke contracts afdwingen:

1. **Iedere zichtbare write heeft een serverreceipt en authoritative delta.**
2. **Iedere activity/factstream heeft snapshot + realtime-delta + idempotente identiteit.**
3. **Iedere configureerbare AI-capability heeft een bewezen runtimeadapter, anders is zij niet selecteerbaar.**
