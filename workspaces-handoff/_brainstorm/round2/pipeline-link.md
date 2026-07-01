# Koppeling tool-output ↔ tickets/board

## Waar dit over gaat

Dit is het scharnierpunt van je hele visie: tool-output (designs, assets, documenten, ideeën) wordt opgeslagen, en op het board koppel je het handmatig aan tickets — "kijk naar design 5 in folder X". Bij ticket-aanmaak **zoekt de AI het artifact op en linkt het in de ticket**. Eén richting, mens-geïnitieerd. Deze vragen bakenen die brug af.

## Vragen

### V-1 · Bevestig de richting: alleen mens → ticket, nooit ticket → tool-automatiek?

**Samenvatting:** Klopt het dat tools nooit automatisch vanuit een ticket getriggerd worden?

**Gedetailleerde uitleg:** Je zei expliciet: het is te veel als een ticket "maak een MVP voor de housing-feature" intern de Designer triggert om designs te maken. De mens neemt altijd de eerste stap op de tool-pagina; de output koppel je daarna handmatig. Ik wil dit als harde regel vastleggen voor V1, zodat ik nergens per ongeluk autonome triggers inbouw. Klopt dat — of wil je één uitzondering openhouden?

**Opties:**

a) **Ja, harde regel: alleen mens-geïnitieerd, geen ticket-triggers** — tools draaien nooit autonoom vanuit de pipeline in V1. *(Aanbevolen — dit is wat je zei.)*

b) **Grotendeels, maar laat één opt-in uitzondering open** — bv. een ticket mag de Interviewer vragen, als je dat per workspace aanzet.

c) **Nog niet vastleggen** — ik hou het flexibel tot we verder zijn.

---

### V-2 · Hoe vindt de AI het juiste artifact bij ticket-aanmaak?

**Samenvatting:** Verwijs je expliciet (folder + naam), of zoekt de AI semantisch ("het settings-design dat we maakten")?

**Gedetailleerde uitleg:** Bij het maken van een ticket wil je een opgeslagen design/asset koppelen. Dat kan precies (je kiest folder X, design 5 uit een lijst) of slim (je typt "het tweede settings-ontwerp" en de AI zoekt het op via de naam/inhoud). Precies is voorspelbaar en simpel; semantisch is gemakzuchtiger maar kan het verkeerde pakken. Vaak wil je beide: een kiezer plus zoeken.

**Opties:**

a) **Beide: handmatige kiezer + semantisch zoeken** — kies uit een lijst, of laat de AI het opzoeken op beschrijving. *(Aanbevolen.)*

b) **Expliciet kiezen (folder + item)** — jij selecteert precies welk artifact; geen giswerk.

c) **Vooral semantisch** — je beschrijft het en de AI vindt het; minste klikwerk.

---

### V-3 · Wat betekent "gekoppeld" precies?

**Samenvatting:** Is de koppeling een verwijzing naar het artifact, of wordt het artifact in de ticket gekopieerd?

**Gedetailleerde uitleg:** Als een design aan een ticket hangt, kan dat een verwijzing zijn (de ticket linkt naar het artifact in de folder; wijzig je het artifact, dan ziet de ticket de nieuwe versie) of een kopie (een momentopname wordt in de ticket vastgelegd; latere wijzigingen aan het origineel raken de ticket niet). Een verwijzing houdt alles in sync; een kopie is stabieler maar kan verouderen.

**Opties:**

a) **Verwijzing (live link naar het artifact)** — de ticket toont altijd de actuele versie. *(Aanbevolen.)*

b) **Kopie/momentopname** — de ticket bevriest wat je koppelde; het origineel mag later veranderen.

c) **Verwijzing + vastgezette versie** — een link, maar naar een specifieke versie (zo heb je beide voordelen).

---

### V-4 · Hoe gebruikt een Stage-Agent het gekoppelde artifact tijdens het werk?

**Samenvatting:** Krijgt de uitvoerende AI het design/asset als context mee bij het implementeren van de ticket?

**Gedetailleerde uitleg:** Als een design aan een ticket hangt en de pipeline gaat die ticket bouwen, wil je waarschijnlijk dat de uitvoerende AI dat design daadwerkelijk gebruikt (de code/preview als referentie meekrijgt) in plaats van vanaf nul te beginnen. De vraag is hoe sterk dat is: het artifact als referentie meegeven (de AI mag ervan afwijken), of als strikte specificatie (de AI moet het volgen). Dit is wat de koppeling écht waardevol maakt.

**Opties:**

a) **Als referentie/context** — de uitvoerende AI krijgt het design mee en gebruikt het als leidraad. *(Aanbevolen.)*

b) **Als strikte specificatie** — de AI moet het gekoppelde design exact volgen.

c) **Instelbaar per ticket** — jij kiest of het leidend of bindend is.
