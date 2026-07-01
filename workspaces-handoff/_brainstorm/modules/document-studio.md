# Document Studio — module analyse

> Gegenereerd: 2026-06-14. Aanvulling op de Workspaces modules-brainstorm.
> Idee van de gebruiker: files/docs kunnen uploaden om daaruit andere docs te maken (bv. voor schoolprojecten), en AI die PDF/Excel/Word-bestanden genereert — met "skills" zodat de bestanden er human-made uitzien.

---

## Mijn mening

Het idee bestaat eigenlijk uit twee verschillende capabilities die je niet moet verwarren, en uit één gevoelig randje dat ik expliciet benoem.

**Capability A — ingest:** files/docs uploaden als bronmateriaal dat de AI leest. Dit is sterk en past naadloos: het is gewoon "voer extra context toe aan een sessie". De Sources-tab en de RAG-indexer bestaan al; een upload-bron erbij is een kleine, hoog-waardevolle uitbreiding.

**Capability B — genereren:** echte `.pdf` / `.xlsx` / `.docx` / `.pptx`-bestanden produceren als *eindproduct*. Dit is het echte nieuwe werk, en het is óók de plek waar de scope van Workspaces oprekt: tot nu toe is dit een **dev-orchestratie-tool** (code, tickets, MRs). Documenten genereren voor een schoolproject is een **algemene productiviteits-/kantoor-use-case**. Dat is geen showstopper — de infrastructuur (container die een generator draait, artifact-viewer, propose→accept) past verrassend goed — maar het is een bewuste positioneringskeuze: wordt Workspaces "AI-dev-orchestratie" of "AI-maakt-alles"? Dat moet je willen.

**De skills zijn het slimme deel.** Net als de "design skills" (Designer Studio) en "edit-styles" (Marketing) is een *document-skill* = een sjabloon + toon + opmaakconventies + referentiestijl. Dit hergebruikt een patroon dat je toch al drie keer bouwt. Eén skill-model voor design, media én documenten is precies de soort samenhang die het module-systeem rechtvaardigt.

**Het gevoelige randje — "human made lijken".** Voor de meeste documenten is "ziet er menselijk/professioneel uit" gewoon kwaliteit: een rapport, offerte of factuur hoort er niet robotachtig of template-achtig uit te zien, en daar is niets mis mee. Maar specifiek "zodat het human-made lijkt" voor **ingeleverd schoolwerk** is in de praktijk AI-detectie ontwijken voor cijferwerk — dat is academische oneerlijkheid, en dat is een feature die ik niet stilletjes als "anti-detectie-modus" wil inbouwen of als verkoopargument wil framen. Mijn lijn: bouw de legitieme kant (natuurlijke, niet-template-achtige, hoogwaardige opmaak — en optioneel een eerlijke "AI-assisted"-metadata-tag) volop uit; bouw géén expliciete "omzeil AI-detectie voor ingeleverd werk"-modus. Dit is een keuze die jij maakt, niet ik in je plaats — zie vraag 6. Ik flag het, ik weiger het niet categorisch: de tool zelf is prima, het gaat om hoe je die ene modus positioneert.

**Wat het excellent zou maken:** deterministische generators (libreoffice/pandoc) in een container i.p.v. de AI letterlijk bytes laten schrijven (vraag 2), één gedeeld skill-model met Designer/Marketing, en de uploads die via RAG terugvloeien zodat het gegenereerde document écht op jouw bronmateriaal is gebaseerd in plaats van verzonnen.

---

## Past op bestaande design

De bouwstenen zijn er grotendeels al; het ontbreekt aan de document-specifieke invulling.

- **Sources-management + upload** (`features/15_SOURCES_MANAGEMENT.md`): de plek waar geüploade files/docs landen als bronnen met frozen/live-badge en per-stage toggle. Een file-upload-bron is een natuurlijke uitbreiding van de bestaande SkillEntry/SourceEntry-rijen.
- **RAG delta-indexer** (`07_ORCHESTRATOR.md §D`): geüploade docs (pdf/docx → tekst) kunnen in dezelfde embedding-index als de codebase. Geen nieuwe indexing-infra; alleen extractie-stappen per filetype.
- **ArtifactViewerRegistry** (`03_AUTOMATION_AND_PLUGINS.md §3.3`): een gegenereerd document is een artifact; `registerArtifactViewer('document', ...)` geeft het een preview in TicketDetail (pdf-preview, xlsx-tabel, docx-render). FileDiffViewer blijft fallback.
- **ModuleArtifact-store** (voorgesteld in `modules-system.md` idee 3): de plek waar Document Studio output schrijft en waar bv. Marketing of een ticket het kan oppakken — cross-module, los gekoppeld.
- **Skill-model** (Designer `design skill` + Marketing `edit-style`): een `document-skill` is hetzelfde patroon (PromptVersion + template-tokens + referentie), dus het deelt `AI_QUALITY_AND_EVALS §4-5` (A/B + feedback) en de Sources-skill-UI.
- **Container-runtime** (`07b_CONTAINER_RUNTIME.md`): de generator (headless LibreOffice / pandoc / een xlsx-lib) draait deterministisch in een container — geen AI-beurt nodig voor de render-stap, dus geen provider/billing-implicatie.
- **Preview deployment / download** (`features/23_PREVIEW_DEPLOYMENT.md` + storage): het eindbestand wordt aangeboden als download/preview per ticket.

### Spanningen met locked decisions

- **B-23 (AI proposeert, Conductor schrijft)** — een gegenereerd document landt pas definitief na user-accept. Past goed.
- **Geen nieuwe verbs** (`02_PROTOCOL_AND_FLOW.md §2`) — de doc-agent emit via `emit_output` met een document-output-schema; de render gebeurt deterministisch, niet via een nieuw verb.
- **Scope-grens dev-tool** — dit is de scherpste: documenten-als-eindproduct ligt buiten de huidige dev-scope. Bewuste keuze, geen ongeluk (vraag 1).
- **Geen `providerKey` in v1** (`MULTI_PROVIDER_SEAM.md §4`) — niet relevant zolang de generator deterministisch is en de tekst-generatie op de Claude PTY draait. Pas relevant als je een aparte "schrijf-model"-provider wil.
- **CapacityManager** (`07b §8`) — render-containers trekken uit dezelfde pool; grote batch-exports kunnen tickets verdringen. Net als bij Designer/Marketing een bewuste cap.

---

## Risico's

- **Scope-explosie buiten dev.** "Maak een schoolwerkstuk" is een heel ander product dan "orchestreer mijn codebase". Als je dit te breed maakt, verwatert de identiteit van Workspaces. Houd v1 smal (bv. alleen export van project-gerelateerde docs) of accepteer bewust de bredere positionering.
- **Academische integriteit / misbruik.** "Human-made laten lijken" voor ingeleverd schoolwerk = AI-detectie ontwijken voor cijferwerk. Reputatie- en ethisch risico als je hier een feature van maakt. Bouw de legitieme kant; bouw geen expliciete anti-detectie-modus (vraag 6).
- **Untrusted file parsing = aanvalsoppervlak.** Geüploade pdf/docx/xlsx parsen is een klassieke exploit-bron (malafide office-bestanden, zip-bombs, XXE in docx). Parsing moet in de sandbox-container, met size-caps en zonder netwerk — niet in het orchestrator-proces.
- **Format-fidelity.** Een AI die letterlijk `.docx`-XML of `.xlsx`-bytes schrijft produceert vaak corrupte of lelijke bestanden. Deterministische libraries (pandoc/LibreOffice/exceljs) geven betrouwbaardere output dan de AI bytes laten genereren.
- **Bron-trouw (hallucinatie).** Als het gegenereerde document níet strak op de geüploade bron is gebaseerd, krijg je verzonnen inhoud met echte-document-opmaak — gevaarlijker dan zichtbaar-AI output. RAG-grounding + citaties zijn belangrijk.
- **Opslag.** Documenten + uploads zijn binaire blobs; de huidige Mongo/Prisma-modellen zijn niet de juiste plek. Vereist een storage-abstractie (de voorgestelde `@luckystack/storage`).
- **Skill-vervuiling.** Net als design-skills kan een document-skill-bibliotheek vollopen met half-afgewerkte sjablonen; versiebeheer + goedkeuring nodig.

---

## Extra ideeën

### 1. Eén gedeeld skill-model voor design / media / document
Maak `Skill` een generiek concept met een `surface`-veld (`design` | `media-edit` | `document`). Een document-skill = sjabloon + toon + opmaak/citatiestijl + optioneel referentiebestand. Zo deelt Document Studio de skill-bibliotheek-UI, A/B-tests en feedback-loop met Designer Studio en Marketing — minder te bouwen, consistenter te gebruiken.

### 2. Deterministische render-stap, AI alleen voor inhoud
Splits strikt: de **AI schrijft de inhoud + structuur** (markdown/JSON met secties, tabellen, bronverwijzingen), een **deterministische generator** (pandoc → docx/pdf, exceljs → xlsx, een template-engine → pptx) zet dat om naar het binaire bestand. Betrouwbaarder, testbaar (golden-fixture op de gegenereerde structuur), en de render kost geen AI-beurt.

### 3. Upload als "source pack" met round-trip
Laat de user een bestaand `.docx` uploaden, de AI bewerkt het (bv. "vul hoofdstuk 3 aan", "maak een samenvatting-spreadsheet"), en exporteer terug naar hetzelfde formaat met behoud van opmaak. De upload-bron is dan zowel context als template.

### 4. Verifieerbare citaties uit de geüploade bronnen
Als documenten op geüploade/RAG-bronnen zijn gebaseerd, laat de AI per claim een bron-anker meegeven. In het eindbestand worden dat voetnoten/bronverwijzingen — dit verhoogt kwaliteit én is het eerlijke alternatief voor "verbergen dat het AI is": traceerbare, gefundeerde output.

### 5. "Fidelity vs editability" als expliciete export-keuze
Per export kiezen: een **afgewerkt PDF** (presentatie-klaar, niet bedoeld om te bewerken) of een **bewerkbaar `.docx`/`.xlsx`** (jij werkt verder). Bepaalt of de generator naar print-layout of naar editbaar formaat rendert.

### 6. Export-presets per gebruikssoort
Built-in document-skills voor herkenbare gevallen: "technisch rapport", "factuur/offerte", "data-export spreadsheet", "presentatie-deck", "release-notes PDF". Elk een sjabloon + toon, direct bruikbaar, en ze tonen meteen de legitieme (niet-school) waarde van de module.

---

## Vragen

### V-1 · Positionering: blijft Workspaces een dev-tool of wordt het breder?

**Samenvatting:** Documenten genereren als eindproduct (schoolwerk, rapporten) ligt buiten de huidige dev-scope — wil je die verbreding?

**Gedetailleerde uitleg:** Workspaces is nu een tool om software-projecten te orkestreren: code, tickets, code-review. Documenten maken voor een schoolproject is een heel andere soort taak — het heeft niets met code te maken. De infrastructuur kan het prima aan, maar het verandert wel waar het product "over gaat". Je kunt de module smal houden (alleen documenten die met je project/codebase te maken hebben, zoals technische rapporten of release-notes) of breed (elk denkbaar document, ook puur school/kantoor). Breed is krachtiger maar maakt het product diffuser.

**Opties:**

a) **Smal: alleen project-gerelateerde documenten** — exports die uit je codebase/tickets voortkomen (technisch rapport, release-notes, data-export). Houdt de dev-identiteit scherp. *(Aanbevolen voor v1: bewijs de capability zonder de scope op te blazen.)*

b) **Breed: algemene document-productie** — elk document, ook puur school/kantoor, op basis van geüploade bronnen. Krachtiger, maar Workspaces wordt dan deels een algemene AI-kantoortool.

c) **Smal nu, breed als losse module later** — bouw de generieke generator-infra, maar lever in v1 alleen de project-gerelateerde presets; de brede "vrije document"-modus komt later als aparte module-uitbreiding.

---

### V-2 · Hoe worden de bestanden technisch gemaakt?

**Samenvatting:** Schrijft de AI zelf de `.docx`/`.xlsx`-bytes, of produceert hij inhoud die een deterministische generator omzet?

**Gedetailleerde uitleg:** Er zijn twee manieren om aan een echt Office-bestand te komen. Optie 1: de AI genereert direct het binaire formaat — vaak onbetrouwbaar, geeft soms corrupte of lelijke bestanden. Optie 2: de AI schrijft alleen de *inhoud en structuur* (tekst, koppen, tabellen, in een simpel formaat), en een vaste, geteste omzetter (zoals LibreOffice of pandoc, draaiend in een container) maakt daar het echte bestand van. Optie 2 is betrouwbaarder, beter testbaar, en de omzet-stap kost geen AI-beurt — maar het is iets meer bouwwerk vooraf.

**Opties:**

a) **AI schrijft inhoud → deterministische generator rendert** — betrouwbaar, testbaar, render kost geen AI-beurt. *(Aanbevolen.)*

b) **AI genereert direct het bestandsformaat** — minder bouwwerk vooraf, maar risico op corrupte/lelijke bestanden en moeilijk te testen.

c) **Hybride per formaat** — simpele formaten (markdown→pdf) deterministisch, complexe (een specifiek opgemaakt deck) eventueel AI-geassisteerd. Flexibel maar meer onderhoud.

---

### V-3 · Wat gebeurt er met geüploade bestanden?

**Samenvatting:** Worden uploads doorzoekbare kennis (RAG), losse bijlagen bij één taak, of allebei?

**Gedetailleerde uitleg:** Als je een bestand uploadt, kan het systeem er twee dingen mee doen. Het kan de inhoud in een doorzoekbare index zetten (RAG) zodat de AI er in elke latere taak naar kan verwijzen — goed voor blijvend bronmateriaal. Of het blijft een bijlage bij precies die ene opdracht ("gebruik dit als template voor dit document") — eenvoudiger, maar de AI "onthoudt" het daarna niet. De keuze bepaalt hoe zwaar de upload-infrastructuur is en hoe de AI met je materiaal omgaat.

**Opties:**

a) **Allebei, user kiest per upload** — "voeg toe aan projectkennis" (RAG) of "alleen voor deze taak" (bijlage). Meest flexibel. *(Aanbevolen.)*

b) **Altijd RAG-kennis** — elk geüpload bestand wordt doorzoekbare projectcontext. Krachtig, maar kan irrelevant materiaal in de index trekken.

c) **Altijd losse bijlage** — uploads horen bij één taak, geen blijvende index. Simpelst te bouwen, minst krachtig.

---

### V-4 · Welke formaten ondersteun je in v1?

**Samenvatting:** PDF, Word, Excel, PowerPoint — welke maak je eerst?

**Gedetailleerde uitleg:** Elk uitvoerformaat is apart werk: een PDF genereren is anders dan een bewerkbaar Word-bestand, en een Excel-spreadsheet met formules is weer iets heel anders dan een PowerPoint-presentatie. Meer formaten = meer bouw- en testwerk. Je kunt klein beginnen met de meest gevraagde en later uitbreiden.

**Opties:**

a) **PDF + Word (.docx) eerst** — de twee meest gevraagde voor rapporten/teksten. *(Aanbevolen startpunt.)*

b) **PDF + Word + Excel** — voeg spreadsheets toe voor data-exports; meer werk maar dekt het meeste.

c) **Alle vier (incl. PowerPoint)** — volledige dekking in één keer; grootste bouwlast.

d) **Alleen PDF** — kleinste slice; afgewerkte, niet-bewerkbare documenten. Snelst te leveren.

---

### V-5 · Wat is een "document-skill" precies?

**Samenvatting:** Is een skill alleen een sjabloon, of sjabloon + toon + opmaak + referentiestijl?

**Gedetailleerde uitleg:** Net als bij de Designer Studio bepaalt de definitie hoe nuttig de feature is. Een document-skill kan alleen een lege layout zijn ("zo zien de marges en koppen eruit"), of het kan ook de schrijfstijl/toon sturen ("formeel academisch" vs "zakelijk beknopt"), of zelfs een voorbeeld­document als referentie meekrijgen waar de AI de stijl van overneemt. Hoe rijker de skill, hoe consistenter het resultaat — maar hoe meer werk om een skill te maken.

**Opties:**

a) **Sjabloon + toon** — layout-conventies plus een schrijfstijl-instructie. Goede balans. *(Aanbevolen.)*

b) **Alleen sjabloon (layout)** — enkel opmaak; de toon komt puur uit de opdracht. Simpelst.

c) **Sjabloon + toon + referentiedocument** — een voorbeeldbestand als stijl-anker (de AI neemt structuur/toon over). Rijkste resultaat; vereist multimodale/voorbeeld-verwerking.

d) **Gedeeld skill-model met Designer/Marketing** — één skill-concept met een `surface`-veld voor design/media/document. Meeste samenhang, iets meer ontwerpwerk vooraf.

---

### V-6 · "Human-made lijken": waar leg je de grens?

**Samenvatting:** Natuurlijke, professionele opmaak is prima — maar AI-detectie ontwijken voor ingeleverd schoolwerk is academische oneerlijkheid. Wat bouw je wel/niet?

**Gedetailleerde uitleg:** "Het moet er menselijk uitzien" kan twee dingen betekenen. (1) Legitiem: een document hoort er niet robotachtig of template-achtig uit te zien — natuurlijke opmaak, goede typografie, variatie. Daar is niets mis mee; echte documenten zien er ook zo uit. (2) Problematisch: een document bewust zo maken dat het AI-detectie van een school/universiteit omzeilt voor werk dat je als je eigen werk inlevert — dat is in de meeste onderwijsinstellingen fraude. Ik wil de eerste kant graag bouwen, maar geen expliciete "ontwijk-detectie"-modus inbouwen of als feature aanprijzen. Dit is jouw keuze over hoe je het positioneert, niet de mijne — daarom leg ik 'm aan je voor.

**Opties:**

a) **Alleen legitieme kwaliteit** — natuurlijke, niet-template-achtige, professionele opmaak. Geen anti-detectie-modus, geen claims daarover. *(Aanbevolen — dit is de eerlijke en reputatie-veilige lijn.)*

b) **Kwaliteit + eerlijke AI-herkomst-tag** — documenten kunnen optioneel een "AI-assisted"-metadata/colofon dragen; transparant i.p.v. verhullend.

c) **Expliciete "humanize / ontwijk AI-detectie"-modus** — een feature die output bewust aanpast om detectoren te omzeilen. *(Niet aanbevolen: academische-integriteits- en reputatierisico; ik zou dit niet bouwen/promoten.)*

d) **Neutraal: generieke opmaak, geen stijl-investering** — je laat de "menselijke" kant helemaal links liggen in v1.

---

### V-7 · Waar worden uploads en gegenereerde bestanden opgeslagen?

**Samenvatting:** Binaire bestanden horen niet in de gewone database — welk opslagmodel?

**Gedetailleerde uitleg:** Geüploade documenten en gegenereerde bestanden zijn binaire blobs (soms groot). Die in de gewone projectdatabase stoppen werkt slecht. Je hebt een aparte opslagplek nodig: lokaal op de zelf-gehoste server, of een object-storage zoals S3/MinIO. Een eigen opslag-abstractie (de voorgestelde `@luckystack/storage`) zou dit netjes oplossen en is sowieso nuttig voor andere modules (Marketing-media bv.).

**Opties:**

a) **`@luckystack/storage`-abstractie (lokaal + S3-compatible)** — één opslaglaag voor alle modules. *(Aanbevolen; deelt met Marketing.)*

b) **Alleen lokale schijf op de zelf-gehoste server** — simpelst voor self-host; geen externe afhankelijkheid; minder schaalbaar.

c) **Direct S3/MinIO verplicht** — schaalbaar, maar legt een externe dienst op aan elke self-host-gebruiker.

---

### V-8 · Hoe veilig verwerk je untrusted uploads?

**Samenvatting:** Geüploade office-bestanden parsen is een bekend aanvalsoppervlak — hoe streng zet je dat op?

**Gedetailleerde uitleg:** Kwaadaardige PDF/Word/Excel-bestanden zijn een klassieke manier om systemen aan te vallen (verborgen code, "zip-bombs" die je geheugen opblazen, externe verwijzingen die data lekken). Omdat de gebruiker bestanden uploadt die het systeem moet openen en lezen, moet dat openen in een afgeschermde omgeving gebeuren, niet in het hoofdproces. Strenger is veiliger maar iets meer werk.

**Opties:**

a) **Parsen altijd in de sandbox-container, zonder netwerk, met size-caps** — de bestaande container-isolatie hergebruiken voor file-extractie. *(Aanbevolen.)*

b) **Parsen in het orchestrator-proces met een hardened library** — eenvoudiger, maar het hoofdproces raakt untrusted input aan; riskanter.

c) **Alleen tekst-extractie, geen rijke parsing in v1** — minimaliseer het oppervlak door alleen platte tekst eruit te halen; minst risico, minst rijk.
