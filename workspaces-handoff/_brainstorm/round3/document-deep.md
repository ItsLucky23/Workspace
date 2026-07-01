# Document Studio — diepe ronde

## Waar dit over gaat

Derde tool in de eerste lichting. Zelfde model (folders + skills), uploads in de folder, project- én algemene documenten, **natuurlijke/professionele kwaliteit — geen AI-detectie-ontwijking**. Deze vragen gaan over hoe genereren, uploaden en koppelen werkt.

## Vragen

### V-1 · Hoe worden de bestanden technisch gemaakt?

**Samenvatting:** AI schrijft de inhoud, een vaste omzetter maakt het echte PDF/Word/Excel — of de AI maakt het bestand zelf?

**Gedetailleerde uitleg:** Om een echt Office-bestand te krijgen zijn er twee wegen. (1) De AI schrijft alleen de inhoud en structuur (tekst, koppen, tabellen), en een betrouwbare omzetter (zoals pandoc/LibreOffice in een container) maakt daar het bestand van — voorspelbaar, testbaar, en de omzet kost geen AI-beurt. (2) De AI genereert het bestand direct — minder voorwerk, maar vaak onbetrouwbaar (corrupte/lelijke bestanden). Ik raad de eerste sterk aan.

**Opties:**

a) **AI schrijft inhoud → vaste omzetter rendert** — betrouwbaar en testbaar. *(Aanbevolen.)*

b) **AI genereert het bestand direct** — minder voorwerk, hoger risico op slechte bestanden.

c) **Hybride per formaat** — simpele formaten via de omzetter, complexe evt. AI-geassisteerd.

---

### V-2 · Welke formaten in V1?

**Samenvatting:** Begin je met PDF + Word, of meteen ook Excel/PowerPoint?

**Gedetailleerde uitleg:** Elk uitvoerformaat is apart werk. PDF en Word (tekstdocumenten) dekken de meeste gevallen — rapporten, verslagen, brieven. Excel (spreadsheets met data/formules) en PowerPoint (presentaties) zijn waardevol maar elk een eigen bouwstuk. Klein beginnen levert sneller iets bruikbaars.

**Opties:**

a) **PDF + Word eerst** — dekt de meeste tekstdocumenten. *(Aanbevolen.)*

b) **PDF + Word + Excel** — voeg data-exports toe.

c) **Alle vier (incl. PowerPoint)** — volledige dekking, meeste werk.

d) **Alleen PDF** — kleinste start; afgewerkte, niet-bewerkbare documenten.

---

### V-3 · Wat is een document-skill concreet?

**Samenvatting:** Een skill = sjabloon + toon; hoe definieer je die (en sluit aan op het gedeelde skill-model)?

**Gedetailleerde uitleg:** Een document-skill bepaalt hoe het document eruitziet en klinkt: een sjabloon/opmaak (marges, koppen, lettertype) plus een schrijfstijl/toon (formeel-academisch, zakelijk-beknopt). Omdat skills gedeeld zijn (`surface: document`), past dit in het bestaande skill-model. De vraag is hoe rijk een document-skill mag zijn — alleen sjabloon + toon, of ook een voorbeelddocument als stijl-anker.

**Opties:**

a) **Sjabloon + toon** — opmaak plus schrijfstijl; goede balans. *(Aanbevolen.)*

b) **Sjabloon + toon + voorbeelddocument** — een referentiebestand waarvan de AI stijl/structuur overneemt. Rijker.

c) **Alleen sjabloon** — opmaak; de toon komt puur uit je opdracht.

---

### V-4 · Hoe behandel je een upload — als kennis of als bijlage?

**Samenvatting:** Wordt een geüpload bestand doorzoekbare projectkennis (RAG) of alleen materiaal voor die ene opdracht?

**Gedetailleerde uitleg:** Als je een bronbestand uploadt, kan het in een doorzoekbare index komen (de AI kan er later in elke taak naar verwijzen) of alleen gelden voor de huidige document-opdracht (een bijlage die je meegeeft, daarna "vergeten"). Doorzoekbaar maken is krachtig voor blijvend bronmateriaal; een losse bijlage is simpeler en voorspelbaarder. Vaak wil je per upload kunnen kiezen.

**Opties:**

a) **Jij kiest per upload (kennis óf bijlage)** — flexibel. *(Aanbevolen.)*

b) **Altijd losse bijlage** — simpel; uploads horen bij één opdracht.

c) **Altijd projectkennis (RAG)** — alles wordt doorzoekbaar; krachtig, maar kan ruis toevoegen.

---

### V-5 · Bron-trouw: hoe voorkom je verzonnen inhoud met echte opmaak?

**Samenvatting:** Als een document op uploads is gebaseerd — koppel je beweringen aan bronnen (citaties)?

**Gedetailleerde uitleg:** Een document dat er professioneel uitziet maar verzonnen inhoud bevat is gevaarlijker dan zichtbaar-ruwe output. De eerlijke manier om dat te ondervangen is grounding: de AI baseert zich strikt op de geüploade/geïndexeerde bronnen en koppelt beweringen aan een bron (voetnoot/verwijzing). Dat verhoogt de kwaliteit en is meteen het integere alternatief voor "verbergen dat het AI is": traceerbare, gefundeerde tekst. Het kan ook lichter (geen expliciete citaties) als het meer een vrij stuk is.

**Opties:**

a) **Grounding + optionele citaties/bronverwijzingen** — beweringen herleidbaar naar je bronnen. *(Aanbevolen.)*

b) **Grounding zonder zichtbare citaties** — de AI baseert zich op de bronnen, maar zonder voetnoten.

c) **Per document instelbaar** — soms strikt met bronnen, soms vrij geschreven.

---

### V-6 · Round-trip: bewerk je geüploade documenten en exporteer je ze terug?

**Samenvatting:** Kun je een bestaand `.docx` uploaden, laten bewerken, en in hetzelfde formaat terugkrijgen?

**Gedetailleerde uitleg:** Naast "maak een nieuw document" is er een sterk gebruik: een bestaand document uploaden en de AI laten bewerken ("vul hoofdstuk 3 aan", "maak hier een samenvatting van") en dan terug-exporteren met behoud van opmaak. Dat is krachtig maar lastiger (opmaak behouden bij bewerken is technisch fiddly). Je kunt het meenemen of beperken tot "nieuw genereren" in V1.

**Opties:**

a) **Ja, round-trip vanaf V1** — upload → bewerk → terug in hetzelfde formaat. Krachtig.

b) **V1 = alleen nieuw genereren, round-trip in V2** — eenvoudiger begin. *(Aanbevolen voor focus.)*

c) **Alleen round-trip voor tekstformaten (Word/Markdown)** — niet voor Excel/PowerPoint.

---

### V-7 · Veiligheid: hoe verwerk je geüploade (untrusted) bestanden?

**Samenvatting:** Geüploade office-bestanden parsen is een aanvalsoppervlak — hoe streng zet je dat op?

**Gedetailleerde uitleg:** Bestanden die gebruikers uploaden moeten geopend en gelezen worden, en kwaadaardige PDF/Word/Excel-bestanden zijn een bekende aanvalsweg (verborgen code, geheugen-bommen, externe verwijzingen). Het veilig openen hoort in een afgeschermde omgeving (de sandbox-container die je al hebt), niet in het hoofdproces, met limieten op grootte. Strenger is veiliger, iets meer werk.

**Opties:**

a) **Parsen in de sandbox-container, zonder netwerk, met size-limieten** — hergebruik de bestaande isolatie. *(Aanbevolen.)*

b) **Parsen in het hoofdproces met een geharde bibliotheek** — simpeler, maar riskanter.

c) **V1 alleen platte-tekst-extractie** — minimaliseer het risico door alleen tekst eruit te halen.
