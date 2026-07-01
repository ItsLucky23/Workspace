# Interviewer — diepe ronde (bouw #1)

## Waar dit over gaat

De eerste tool die we bouwen. Eigen pagina, on-demand, output = vragen + idee-kaarten, "maak ticket" per idee. Deze vragen gaan over hoe de sessie eruitziet en aanvoelt — inclusief op je telefoon.

## Vragen

### V-1 · Hoe presenteer je de vragen — stepper of lijst?

**Samenvatting:** Eén vraag per scherm (zoals de Claude CLI) of een scrollbare lijst (zoals deze pagina)?

**Gedetailleerde uitleg:** Er zijn twee manieren om de vragen te tonen. Eén-voor-één (een "stepper": je ziet één vraag, beantwoordt, volgende) voelt gefocust en werkt fijn op een telefoon. Een scrollbare lijst (alles onder elkaar, zoals deze pagina) geeft overzicht en laat je makkelijk terugspringen, maar voelt op mobiel als een lange formulier. Je kunt ook per apparaat verschillen: stepper op mobiel, lijst op desktop.

**Opties:**

a) **Stepper op mobiel, lijst op desktop** — het beste van beide per schermgrootte. *(Aanbevolen.)*

b) **Altijd stepper (één vraag per scherm)** — maximale focus, telefoon-eerst.

c) **Altijd lijst (scrollbaar)** — maximaal overzicht, desktop-eerst.

---

### V-2 · Vragen en idee-kaarten — gescheiden of door elkaar?

**Samenvatting:** Toon je "vragen om te beantwoorden" en "ideeën om te accepteren" als twee aparte secties, of gemengd in één stroom?

**Gedetailleerde uitleg:** Een sessie levert twee soorten dingen: vragen (jij kiest een antwoord) en idee-kaarten (de AI stelt iets voor; jij accepteert/verwerpt). Je kunt die scheiden (een tab "vragen", een tab "ideeën") zodat het helder is wat van je verwacht wordt, of door elkaar tonen in één lijst (alles wat aandacht vraagt op één plek). Gescheiden is duidelijker; gemengd is sneller af te handelen.

**Opties:**

a) **Twee secties/tabs (vragen | ideeën)** — duidelijk onderscheid in wat van je gevraagd wordt. *(Aanbevolen.)*

b) **Eén gemengde stroom** — alles wat aandacht vraagt op één plek, snel doorheen.

c) **Gemengd, maar met een duidelijk type-label per kaart** — één lijst, elk item gemarkeerd als vraag of idee.

---

### V-3 · Wat leest de AI bij een sessie?

**Samenvatting:** Welke context krijgt de Interviewer: alleen code, of ook tickets, docs en de dependency-graph?

**Gedetailleerde uitleg:** De kwaliteit van de vragen hangt af van wat de AI "weet". Alleen de code geeft technische vragen. Code + tickets + docs + de dependency-graph (dezelfde context die je in de pipeline-editor aan AI's kunt geven) geeft bredere, project-bewuste vragen ("je hebt veel open tickets rond facturatie — wil je daar een epic van maken?"). Meer context = relevantere vragen, maar ook een langere/duurdere sessie.

**Opties:**

a) **De volledige pipeline-context (code + tickets + docs + graph)** — hergebruik wat je in de pipeline-editor al kunt meegeven. *(Aanbevolen.)*

b) **Code + tickets** — projectactiviteit zonder de zwaardere docs/graph.

c) **Jij kiest per sessie wat de AI meekrijgt** — een context-selector vóór het starten.

---

### V-4 · De scope-keuze vóór starten — hoe bied je die aan?

**Samenvatting:** Je koos "user kiest scope". Hoe ziet die keuze eruit?

**Gedetailleerde uitleg:** Voor het starten kies je waar de AI naar kijkt. Dat kan een paar vaste opties zijn (heel project / recente activiteit / specifiek onderdeel), of een vrij veld waar je in je eigen woorden zegt waar het over moet gaan ("kijk naar onze auth-flow"). Vaste opties zijn snel en voorspelbaar; een vrij veld is flexibeler maar minder gestuurd.

**Opties:**

a) **Vaste opties + een vrij veld** — kies "heel project / recent / onderdeel", of typ zelf een focus. *(Aanbevolen.)*

b) **Alleen vaste opties** — snel en voorspelbaar.

c) **Alleen een vrij tekstveld** — jij beschrijft de focus volledig zelf.

---

### V-5 · "Maak ticket" — direct in de backlog of het ticket-formulier vooringevuld?

**Samenvatting:** Maakt de knop meteen een ticket aan, of opent hij het normale ticket-aanmaak-scherm met alles al ingevuld?

**Gedetailleerde uitleg:** Bij een geaccepteerd idee wil je er een ticket van maken. De knop kan meteen een ticket in de backlog zetten (snelst, maar je controleert het niet vooraf), of het normale ticket-formulier openen met titel/omschrijving al ingevuld (één extra stap, maar je kunt het bijschaven en de juiste pipeline/labels kiezen vóór het echt bestaat).

**Opties:**

a) **Ticket-formulier vooringevuld openen** — je controleert/schaaft bij vóór aanmaken. *(Aanbevolen — past op "mens neemt de stap".)*

b) **Direct in de backlog** — één klik, meteen een ticket; bijschaven doe je daarna.

c) **Jij kiest per idee** — een snelknop "direct" plus een "bewerken vóór aanmaken".

---

### V-6 · Sessie-geschiedenis — wat bewaar je en hoe toon je het?

**Samenvatting:** Houd je oude interview-sessies bij (datum, % beantwoord, eruit voortgekomen tickets), en waar?

**Gedetailleerde uitleg:** Omdat de Interviewer een eigen pagina krijgt, is er ruimte voor geschiedenis. Je kunt elke sessie bewaren (wanneer, hoeveel vragen, wat je beantwoordde, welke tickets eruit kwamen) zodat je kunt terugkijken en de AI niet in herhaling valt. Of je houdt het simpel: alleen de huidige openstaande vragen, geen archief. Geschiedenis is waardevol voor dedup en overzicht, maar iets meer te bouwen.

**Opties:**

a) **Volledige geschiedenis per folder/onderwerp** — sessies bewaard, met voortgang en voortgekomen tickets. *(Aanbevolen — voedt ook de dedup.)*

b) **Alleen de laatste/openstaande sessie** — simpel; geen archief.

c) **Lichte geschiedenis (alleen datum + samenvatting)** — een tussenweg.

---

### V-7 · Toon je de kosten van een sessie vooraf?

**Samenvatting:** Een sessie kost een AI-beurt — waarschuw/meld je dat voor je start?

**Gedetailleerde uitleg:** Omdat een interview een AI-beurt verbruikt, kun je dat zichtbaar maken. Een korte melding vóór starten ("dit start een AI-sessie") voorkomt verrassingen en sluit aan op het budget-bewustzijn elders in Workspaces. Of je laat het weg om de drempel zo laag mogelijk te houden. Dit is een kleine UX-keuze met effect op hoe "duur" de tool voelt.

**Opties:**

a) **Korte, niet-blokkerende melding** — een subtiel "dit start een AI-sessie", geen pop-up. *(Aanbevolen.)*

b) **Geen melding** — laagste drempel; kosten zie je elders in het budget-overzicht.

c) **Bevestigingsstap** — expliciet "ja, start" klikken; meeste controle, hoogste drempel.
