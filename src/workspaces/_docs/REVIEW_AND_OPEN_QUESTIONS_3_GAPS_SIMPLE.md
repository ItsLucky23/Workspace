# Workspaces — Open vragen in simpele taal (ronde 3, leesbare versie)

> Dit is de **makkelijk-leesbare** versie van `REVIEW_AND_OPEN_QUESTIONS_3_GAPS.md`. Elke vraag heeft een korte titel, één zin, een uitleg van 2-3 zinnen, en A/B/C/D-keuzes zodat je er snel doorheen loopt.
>
> **Hoe te gebruiken:** lees per vraag de titel + "In één zin". Snap je 'm nog niet? Lees "Wat het betekent". Kies dan A/B/C/D op de `→ Keuze:`-regel. Optie **D** = "weet ik niet / laat Claude beslissen" — prima om te kiezen als je twijfelt; ik kom dan met een voorstel.
>
> De technische onderbouwing van elke vraag (met verwijzingen naar de docs) staat onder hetzelfde G-nummer in `REVIEW_AND_OPEN_QUESTIONS_3_GAPS.md`.

---

## 1. Engine / hoe de AI-sessies draaien

### G-ENG-1 — Wat bij pauze of crash midden in werk
**In één zin:** Als een AI-helper precies bezig is met een taak en je drukt op Pauze (of de hoofdmachine valt om), onthoudt het systeem dan hoe ver hij was?
**Wat het betekent:** Een AI-helper probeert soms iets meerdere keren opnieuw als het niet lukt, en houdt bij hoe vaak hij het al probeerde. De vraag is of die telling wordt opgeslagen of verdwijnt zodra je pauzeert of er iets crasht. Vergelijk het met een spel: ga je verder waar je was, of begin je het level opnieuw?
**Opties:**
- **A)** De voortgang en telling opslaan en bij hervatten precies verdergaan (aanbevolen)
- **B)** Bij een crash altijd veilig stoppen en wachten op de gebruiker
- **C)** Pauze bevriest alles precies zoals het was tot je weer op start drukt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Voortgang + telling onthouden, bij hervatten verdergaan

### G-ENG-2 — Tellen chat-helpers mee voor de limiet
**In één zin:** Er mag maar een beperkt aantal AI's tegelijk draaien — tellen de AI's waarmee je chat daar ook in mee, of alleen de AI's die echt werk doen?
**Wat het betekent:** Het systeem heeft een maximum aan AI's die tegelijk actief mogen zijn, zodat het niet overbelast raakt. Naast de werkers is er ook een chat-assistent waarmee je praat. De vraag: telt zo'n chatpraatje ook tegen dat maximum, of krijgen de werkers en de chatters elk hun eigen ruimte?
**Opties:**
- **A)** Eén gedeeld maximum voor alle AI's samen (aanbevolen)
- **B)** Een apart maximum voor chat-AI's en voor werk-AI's
- **C)** Chat-AI's onbeperkt, alleen de werk-AI's aan een maximum
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** B — Aparte maxima voor chat-AI's en werk-AI's

### G-ENG-3 — Eindrapport eisen bij AI zonder code
**In één zin:** Sommige stappen worden door een mens of door een AI zonder eigen codemap gedaan — moeten die toch een verplicht "klaar"-bonnetje met codenummer afleveren?
**Wat het betekent:** Normaal levert elke AI bij afronding een afsluitbericht met een uniek codenummer van zijn werk (denk aan een versielabel). Maar sommige stappen produceren geen code, zoals een mens die nadenkt of een planner-AI. De vraag is of zo'n afsluitbericht dan ook verplicht is, terwijl er geen codenummer te geven valt.
**Opties:**
- **A)** Het codenummer optioneel maken voor rollen zonder eigen codemap (aanbevolen)
- **B)** Denk- en planrollen helemaal vrijstellen van het verplichte afsluitbericht
- **C)** Het codenummer van de vorige stap doorgeven als plaatsvervanger
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Codenummer optioneel voor rollen zonder codemap

### G-PROTO-1 — Plek vasthouden tijdens wachten op jou
**In één zin:** Als een AI een vraag aan jou stelt en wacht op antwoord (soms dagen), houdt hij dan zijn schaarse plek bezet of geeft hij die vrij?
**Wat het betekent:** Er zijn maar beperkt plekken voor draaiende AI's. Als een AI een vraag stelt en stil blijft wachten op jouw antwoord, blokkeert hij ondertussen mogelijk een plek die niemand anders kan gebruiken. Vergelijk het met iemand die in de wachtrij blijft staan terwijl hij toch niets doet — beter om even opzij te stappen.
**Opties:**
- **A)** Plek meteen vrijgeven zodra de AI op jou wacht, en heroveren bij je antwoord (aanbevolen)
- **B)** De AI stopt netjes en start opnieuw zodra jij antwoordt
- **C)** Een aparte "wachtkamer" buiten de gewone plekkenlimiet
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Plek vrijgeven tijdens wachten op gebruiker

### G-PROTO-2 — Dubbele berichten voorkomen bij hapering
**In één zin:** Als een bericht door een internethapering per ongeluk twee keer wordt verstuurd, hoe voorkomen we dat het systeem het dubbel verwerkt?
**Wat het betekent:** Bij een trage verbinding stuurt software soms hetzelfde bericht twee keer voor de zekerheid. Zonder bescherming komt zo'n signaal dan dubbel binnen en raakt de boekhouding in de war. Net als een betaling die per ongeluk twee keer wordt afgeschreven: je wilt dat het systeem doorheeft "dit ken ik al".
**Opties:**
- **A)** Elk bericht een uniek kenmerk meegeven zodat dubbels herkend worden (aanbevolen)
- **B)** De server zelf dubbels laten herkennen aan de inhoud binnen een tijdvenster
- **C)** Accepteren dat berichten af en toe dubbel mogen binnenkomen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Uniek kenmerk per bericht tegen dubbels

### G-PROTO-3 — Wat als de bevraagde bron stilvalt
**In één zin:** Als een werk-AI snel iets opvraagt bij een andere AI die offline of traag is, wat gebeurt er dan — blijft hij eindeloos hangen?
**Wat het betekent:** Een werkende AI kan tijdens zijn taak even iets navragen bij een andere AI of bij de database. Als die andere bron niet reageert, kan de werker vast komen te zitten met wachten. Net als bellen naar iemand die niet opneemt: op een gegeven moment moet je ophangen en het anders oplossen.
**Opties:**
- **A)** Harde tijdslimiet, daarna terugvallen op alleen de database (aanbevolen)
- **B)** Alleen de database direct bevragen, de andere AI altijd los/later
- **C)** Direct een duidelijke foutmelding "niemand beschikbaar" teruggeven
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Harde tijdslimiet, dan terugvallen op database

### G-SM-1 — Externe wijziging tijdens lopend werk
**In één zin:** Wat doet een druk werkende AI als iemand buiten het systeem om (rechtstreeks in GitLab) de taak afrondt of sluit?
**Wat het betekent:** Normaal beheert ons systeem de status van een taak, maar GitLab (de externe codeopslag) is de baas bij conflicten. Stel: iemand sluit of voltooit de taak rechtstreeks in GitLab terwijl onze AI er nog mee bezig is. De vraag is wie dan wint en wat er met die draaiende AI gebeurt.
**Opties:**
- **A)** Het systeem stopt de AI direct en geeft een melding (aanbevolen)
- **B)** De AI draait gewoon door; de externe wijziging is slechts ter info
- **C)** Het systeem merkt het conflict op en zet de taak op pauze
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Externe afronding → AI stoppen + melding

### G-SM-2 — Een taak echt annuleren
**In één zin:** Hoe annuleer je een taak helemaal (niet alleen even pauzeren), en wat gebeurt er dan met de bijbehorende werkomgeving en losse vragen?
**Wat het betekent:** Het systeem kent wel "pauze" en "weer verder", maar geen knop om een taak definitief af te blazen. Bij annuleren moet je weten wat er gebeurt met de tijdelijke werkruimte, de aangemaakte codetak en eventuele openstaande vragen. Net als een bestelling annuleren: je wilt zeker weten dat alles netjes wordt opgeruimd.
**Opties:**
- **A)** Een duidelijke "geannuleerd"-eindstatus die alles netjes afsluit (aanbevolen)
- **B)** Pauze plus handmatig opruimen als twee losse stappen
- **C)** Annuleren ruimt de werkruimte op maar bewaart de codetak; vragen worden vervallen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Echte 'geannuleerd'-eindstatus

### G-SM-3 — Wat gebeurt er bij afkeuren
**In één zin:** Als je het resultaat van een afgeronde stap afkeurt in plaats van goedkeurt, wat gebeurt er dan met de taak en je feedback?
**Wat het betekent:** Aan het eind van een stap krijg je een Goedkeuren/Afkeuren-keuze. Het goedkeuren is uitgewerkt, maar het afkeuren-pad nog niet. De vraag is of de AI opnieuw aan de slag gaat met jouw afkeurreden als opdracht, of dat er iets anders gebeurt.
**Opties:**
- **A)** De AI gaat meteen opnieuw aan de slag met jouw afkeurreden als instructie (aanbevolen)
- **B)** De taak stelt jou eerst een vervolgvraag voordat er iets gebeurt
- **C)** Het afkeuren start een volledig nieuwe ronde van de stap
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Afkeuren → AI opnieuw met de afkeurreden

### G-AUTO-1 — Meerdere automatische acties tegelijk
**In één zin:** Wat gebeurt er als één gebeurtenis meerdere automatische regels tegelijk laat afgaan die allemaal dezelfde taak vooruit willen duwen?
**Wat het betekent:** Je kunt regels instellen die automatisch iets doen bij een gebeurtenis ("als X, doe dan Y"). Als twee zulke regels tegelijk afgaan op dezelfde taak, kan die per ongeluk dubbel worden gestart. Net als twee mensen die tegelijk op dezelfde knop drukken — je wilt maar één keer dat er iets gebeurt.
**Opties:**
- **A)** Op volgorde afhandelen; de eerste wint, de rest wordt genegeerd (aanbevolen)
- **B)** Regels een prioriteit geven zodat de belangrijkste voorgaat
- **C)** Het systeem herkent en blokkeert dubbele acties automatisch
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Meerdere triggers: op volgorde, eerste wint

### G-AUTO-2 — Wat als een automatische actie faalt
**In één zin:** Als een automatische actie mislukt, wordt hij dan opnieuw geprobeerd of laten we het er bij zitten?
**Wat het betekent:** Het systeem voert automatische acties uit, maar in deze versie bewust zonder een slim wachtrij-systeem dat herhaalt. De vraag is wat er gebeurt als zo'n actie faalt: gewoon loslaten met een foutmelding, of alsnog later opnieuw proberen.
**Opties:**
- **A)** Eén keer proberen, bij falen een foutmelding loggen en verder (aanbevolen)
- **B)** Bij afwijzing wegens drukte alsnog in een wachtrij zetten voor later
- **C)** Alleen als gelukt markeren, zodat een gemiste actie later vanzelf opnieuw komt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Gefaalde actie: 1x proberen + foutmelding

### G-AUTO-3 — Geheugen van automatische timers
**In één zin:** Waar onthoudt het systeem wanneer een automatische regel laatst afging, en wat als een geplande tijd gemist wordt door een crash?
**Wat het betekent:** Automatische regels mogen niet te vaak achter elkaar afgaan, dus het systeem houdt bij wanneer ze laatst liepen. Als die info maar in het werkgeheugen staat, kan hij verdwijnen bij een crash — met dubbel afgaan of een gemiste afspraak tot gevolg. Net als een wekker die zijn instelling vergeet na een stroomstoring.
**Opties:**
- **A)** De timer-info opslaan in een blijvend geheugen met verloopdatum (aanbevolen)
- **B)** De "laatst afgegaan"-tijd vastleggen bij de taak zelf als waarheid
- **C)** Een gemiste geplande tijd één keer inhalen zodra het systeem terug is
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Timer-info in blijvend geheugen

### G-AUTO-4 — Voorgestelde instellingswijziging controleren
**In één zin:** Wie controleert een voorgestelde wijziging aan de instellingen voordat die wordt toegepast, zodat er geen onzin of verouderde wijziging doorglipt?
**Wat het betekent:** De AI kan voorstellen om een instelling aan te passen, en jij keurt dat goed. Maar er is nog geen controle of dat voorstel wel klopt: bestaat de instelling wel, is het type goed, is het niet alweer achterhaald? Net als een formulier dat je tekent zonder dat iemand checkt of de velden kloppen.
**Opties:**
- **A)** Het voorstel toetsen aan het instellingen-sjabloon plus check op verouderdheid (aanbevolen)
- **B)** Weigeren zodra een veld niet klopt
- **C)** Eerst een proefweergave van het verschil tonen voor het wordt toegepast
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Voorstel toetsen aan sjabloon + verouderd-check

### G-ORCH-1 — Lange klus blokkeert andere klussen
**In één zin:** De centrale regelaar doet zijn taken netjes één voor één — kan een lange klus dan alle andere klussen laten wachten?
**Wat het betekent:** Een centrale regelaar verwerkt verschillende soorten werk strikt na elkaar, zodat ze elkaar niet in de weg zitten. Maar een hele lange klus (zoals het opnieuw doorzoeken van alle code, wat minuten duurt) houdt dan alles erachter tegen. Net als één traag persoon bij de kassa die de hele rij ophoudt.
**Opties:**
- **A)** Aparte rijen per soort werk zodat ze elkaar niet blokkeren (aanbevolen)
- **B)** Het zware zoekwerk buiten de exclusieve rij doen, alleen het korte wegschrijven erin
- **C)** Het zoekwerk op de achtergrond laten lopen zonder dat starten van taken wacht
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Aparte rijen per soort werk

### G-ORCH-2 — Wat als de routering even faalt
**In één zin:** Wat gebeurt er als de werkomgeving al draait maar het instellen van de toegangsroute ernaartoe net mislukt?
**Wat het betekent:** Bij het opstarten van een werkomgeving moet ook een soort wegwijzer worden ingesteld die het verkeer ernaartoe stuurt. Als die wegwijzer niet ingesteld kan worden terwijl de omgeving al draait, ontstaat een halve toestand. De vraag is of we het opnieuw proberen, alles terugdraaien, of de route pas later instellen.
**Opties:**
- **A)** De route-instelling automatisch opnieuw proberen met oplopende pauzes (aanbevolen)
- **B)** De hele opstart afbreken en alles netjes terugdraaien
- **C)** De route pas instellen op het moment dat de eerste bezoeker komt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Route-instelling opnieuw proberen met backoff

### G-ORCH-3 — Welke vorige versie om mee te vergelijken
**In één zin:** Als het systeem alleen de gewijzigde code opnieuw wil verwerken, hoe weet het dan met welke vorige versie het moet vergelijken?
**Wat het betekent:** Om snel te zijn, kijkt het systeem liefst alleen naar wat er veranderd is sinds de vorige versie. Maar taken zitten op een vastgezette versie terwijl de hoofdlijn ondertussen meerdere keren is bijgewerkt — dus "de vorige versie" is niet eenduidig. Net als zoeken naar de verschillen tussen twee documenten als je niet weet welk eerder document de juiste vergelijking is.
**Opties:**
- **A)** Vergelijken met de laatst verwerkte versie op de hoofdlijn (aanbevolen)
- **B)** Vergelijken met het gezamenlijke vertrekpunt van de twee versies
- **C)** Per samenvoeging alleen de eerste afkomst-versie nemen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Vergelijken met laatst verwerkte versie

### G-CT-1 — Verlopen toegangssleutel midden in een taak
**In één zin:** Kan een AI-taak mislukken doordat zijn toegangssleutel net verloopt op het verkeerde moment, en merkt het systeem dat dan?
**Wat het betekent:** Een AI-werkomgeving krijgt een tijdelijke toegangssleutel die regelmatig wordt ververst. Er is een klein risico dat de oude sleutel verloopt vlak voordat de nieuwe is doorgegeven, precies tijdens het werk. De vraag is of zo'n mislukking wordt opgemerkt en automatisch opnieuw geprobeerd. Net als een toegangspas die net tijdens je bezoek verloopt.
**Opties:**
- **A)** De sleutel ruim op tijd verversen met flinke marge (aanbevolen)
- **B)** Bij een mislukking de sleutel meteen vernieuwen en de taak opnieuw proberen
- **C)** Vóór elke taak even controleren of de sleutel nog geldig is
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Sleutel ruim op tijd verversen

### G-CT-2 — Dubbel bouwen bij twee taken tegelijk
**In één zin:** Als twee taken van hetzelfde project tegelijk starten en er moet eerst een werkomgeving-bouwsel gemaakt worden, bouwen we dat dan niet per ongeluk dubbel?
**Wat het betekent:** Bij de eerste taak van een project moet soms een soort kant-en-klaar pakket worden gebouwd, wat duur en traag is. Als twee taken tegelijk starten en dat pakket bestaat nog niet, kunnen ze allebei aan dezelfde dure bouw beginnen. De vraag is of we dat afvangen met een soort "bezig"-bordje, en of zo'n bouw meetelt voor de capaciteitslimiet.
**Opties:**
- **A)** De bouw afschermen met een slot zodat hij maar één keer draait (aanbevolen)
- **B)** De bouw laten meetellen in de capaciteitslimiet
- **C)** Alle bouwwerk in een aparte rij die ze één voor één afhandelt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Bouw met slot, maar 1x

### G-CT-3 — Onopgeslagen werk bij heropstart kwijt
**In één zin:** Als een taak weer wordt opgestart nadat zijn werkomgeving is opgeruimd, raken dan onopgeslagen wijzigingen kwijt?
**Wat het betekent:** Een werkomgeving wordt na verloop van tijd opgeruimd om ruimte te besparen, maar het opslagdeel blijft bewaard. Bij heropstart wordt de code echter opnieuw vers binnengehaald. De vraag is of werk dat nog niet was opgeslagen of weggezet dan verloren gaat. Net als een document sluiten zonder opslaan en hopen dat het er nog is.
**Opties:**
- **A)** Bij het opruimen het onopgeslagen werk eerst veilig wegzetten (aanbevolen)
- **B)** Bij heropstart het bewaarde opslagdeel hergebruiken in plaats van vers binnenhalen
- **C)** Verlies accepteren en duidelijk documenteren
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Onopgeslagen werk eerst wegzetten

### G-CT-4 — Database bereiken door de afgeschermde uitgang
**In één zin:** Alle internetverkeer van een AI moet door één afgeschermde uitgang, maar databases praten een andere taal — hoe bereikt de AI dan toch de database?
**Wat het betekent:** Om veilig te zijn moet al het uitgaande verkeer van een AI-werkomgeving door één gecontroleerde doorgang die alleen normaal webverkeer begrijpt. Maar databases gebruiken hun eigen "taal" die niet door die doorgang past. Dat botst: de AI moet bij de database kunnen, maar de enige uitgang snapt databases niet.
**Opties:**
- **A)** Databases als uitzondering rechtstreeks toestaan buiten de doorgang om (aanbevolen)
- **B)** Een slimmere doorgang die ook databasetaal aankan, met een toegestane-lijst
- **C)** De database alleen bereikbaar maken via een aparte hulpdienst aan de serverkant
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Database als uitzondering buiten de doorgang

### G-CT-5 — Wat als de centrale regelaar lang uitvalt
**In één zin:** Er is maar één centrale regelaar; wat gebeurt er als die lang uitvalt en alle AI-omgevingen stuurloos doordraaien?
**Wat het betekent:** Het hele systeem leunt op één centrale regelaar, en er is bewust geen reservekopie die het overneemt. Als die regelaar lang plat ligt, draaien de losse AI-omgevingen door zonder aansturing. De vraag is welk herstelplan en welke verwachte hersteltijd we afspreken. Net als één verkeersregelaar zonder vervanger op een druk kruispunt.
**Opties:**
- **A)** Een gedocumenteerd handmatig herstelplan met afgesproken hersteltijd (aanbevolen)
- **B)** Eerlijk vastleggen: geen reserve in deze versie, één machine is het zwakke punt
- **C)** Reservekopieën van de opslag maken zodat herstel op een nieuwe machine kan
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Handmatig herstelplan met hersteltijd

### G-CT-6 — Regelaar bij de AI-omgeving binnenkomen
**In één zin:** De AI-omgeving luistert alleen op haar eigen binnenkant, maar buitenpoorten zijn verboden — hoe komt de centrale regelaar er dan binnen?
**Wat het betekent:** Binnen elke AI-omgeving draait een onderdeel dat alleen luistert naar verbindingen vanaf zichzelf, terwijl het openzetten van poorten naar buiten verboden is om veiligheidsredenen. Dat spreekt elkaar tegen: de centrale regelaar moet er toch bij kunnen. Het is een van de tegenstrijdigheden in het ontwerp.
**Opties:**
- **A)** Het onderdeel laten luisteren op het interne netwerk zodat de regelaar het op naam vindt (aanbevolen)
- **B)** Verbinden via een gedeelde interne doorgeefluik in plaats van een poort
- **C)** De regelaar laat van binnenuit een commando lopen in plaats van te verbinden
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Pty-onderdeel op intern netwerk, op naam vindbaar

---

## 2. Wat het systeem onthoudt (datamodel) + commando-afhandeling

### G-DATA-PREVIEWDEPLOYMENT — Wat onthouden over een preview
**In één zin:** Wat moet het systeem allemaal onthouden over een tijdelijke voorvertoning van een ticket?
**Wat het betekent:** Soms wil je een ticket eerst live "uitproberen" op een eigen tijdelijk adres voordat het echt af is. Het systeem moet dan een lijstje gegevens bijhouden over zo'n proefopstelling, zoals welk webadres het heeft en of het aan- of uitstaat. Vergelijk het met een spreadsheet-regel per proefversie, met kolommen als "adres", "status" en "bij welk ticket hoort dit".
**Opties:**
- **A)** Eén regel per ticket die je steeds bijwerkt (aan/uit, adres, status) (aanbevolen)
- **B)** Een logboek waar elke wijziging een nieuwe regel wordt en de status daaruit volgt
- **C)** Geen aparte opslag — alleen tijdelijk in het geheugen zolang de preview draait
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén bij te werken regel per ticket

### G-DATA-WORKSPACESIGNAL-BODY — Wat staat er in een opdracht
**In één zin:** Welke gegevens horen er precies in een "opdracht-briefje" dat het systeem in de wachtrij zet bij elke wijziging?
**Wat het betekent:** Elke keer dat er iets verandert, schrijft het systeem een soort briefje met "wat moet er gebeuren". Daar moeten vaste velden op staan, zoals wat de actie is, op wie of wat het slaat, en wie het vroeg. Het is het centrale doorgeefluik, dus het moet duidelijk zijn welke informatie er altijd op staat.
**Opties:**
- **A)** Eén soort briefje voor alles, met een veldje dat aangeeft of het van een mens of een AI komt (aanbevolen)
- **B)** Twee aparte soorten briefjes: één voor AI-acties en één voor mensen-acties
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén soort briefje + mens/AI-veldje

### G-DATA-RAGENTRY-INFOSOURCE — Hoe slaan we doorzoekbare kennis op
**In één zin:** Hoe bewaart het systeem stukjes tekst uit de code zodat een AI ze later snel kan terugvinden?
**Wat het betekent:** Om slimme antwoorden te geven knipt het systeem code en documenten in kleine stukjes en bewaart die met een soort zoek-vingerafdruk. Vraag: welke velden hou je per stukje bij en waar bewaar je die vingerafdruk? Denk aan een spreadsheet met kolommen als "uit welk bestand", "de tekst" en "de zoek-code".
**Opties:**
- **A)** Alles in één tabel: bestand, tekst en zoek-vingerafdruk bij elkaar (aanbevolen)
- **B)** De tekst in een tabel, maar de zoek-vingerafdrukken in een aparte gespecialiseerde zoek-opslag
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Alles in één tabel (bestand+tekst+vingerafdruk)

### G-DATA-INTEGRATIONTOOL-PERSIST — Waar bewaren we geheime sleutels
**In één zin:** Worden koppelingen met andere diensten echt opgeslagen, en waar bewaren we hun geheime wachtwoorden/sleutels veilig?
**Wat het betekent:** Het systeem koppelt met andere diensten (zoals e-mail of GitLab), en dat vraagt vaak om geheime sleutels. Die mogen niet zomaar leesbaar opgeslagen worden. Vraag: bewaren we ze versleuteld in hetzelfde lijstje, of in een aparte goed-beveiligde kluis-tabel? Vergelijk met je wachtwoorden: opschrijven in code, of in een afgesloten kluisje.
**Opties:**
- **A)** Aparte beveiligde kluis-tabel voor geheimen, waar de rest naar verwijst (aanbevolen)
- **B)** In hetzelfde lijstje, maar het geheime veld versleuteld opslaan
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Aparte beveiligde kluis-tabel voor geheimen

### G-DATA-WORKSPACENOTE-BODY — Wie mag notities schrijven
**In één zin:** Wat houdt een notitie precies in, en mag een AI er zelf één schrijven of alleen een mens?
**Wat het betekent:** Het systeem kan notities bewaren bij een werkruimte. De vraag is welke gegevens daarop staan en wie ze mag maken of aanpassen. Het is gevoelig omdat er een regel is dat eigenlijk alleen één bepaalde rol mag schrijven; mag een AI dan toch een notitie achterlaten?
**Opties:**
- **A)** Notities zijn vaste regels die niet wijzigen, met daarbij wie hem schreef (mens of AI) (aanbevolen)
- **B)** Notities zijn vrij te bewerken door mens én AI, met een "vastgepind"-knopje
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Vaste notitie-regel + auteur (mens/AI)

### G-CTRL-IDEMPOTENCY-STORE — Dubbele opdrachten voorkomen
**In één zin:** Hoe lang en waar onthoudt het systeem een opdracht-kenmerk zodat dezelfde opdracht niet per ongeluk twee keer wordt uitgevoerd?
**Wat het betekent:** Soms wordt door een hapering dezelfde opdracht twee keer verstuurd. Om dubbel werk te voorkomen geeft elke opdracht een uniek kenmerk, dat het systeem even moet onthouden om herhalingen te negeren. Vraag: hoe lang bewaren we dat, en per werkruimte of voor het hele systeem? Net als een kassabon-nummer dat je even bewaart zodat je niet twee keer afrekent.
**Opties:**
- **A)** Kort onthouden in een snel geheugen, per werkruimte, en automatisch laten verlopen (aanbevolen)
- **B)** Voorgoed vastleggen bij de opdracht zelf, zodat een duplicaat altijd geweigerd wordt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Kort, per werkruimte, automatisch verlopen

### G-CTRL-CRON-TRIGGER-OP — Geplande taken instellen
**In één zin:** Hoe stel je een taak in die vanzelf op een vast tijdstip draait, en wie regelt dat?
**Wat het betekent:** Je wilt iets automatisch laten gebeuren op een tijdschema, bijvoorbeeld "elke maandag om 9 uur". Het systeem mist nu een nette manier om zulke geplande taken aan te maken en aan/uit te zetten, ook na een herstart. Vergelijk het met een wekker die ook nog afgaat nadat je je telefoon hebt herstart.
**Opties:**
- **A)** Aparte knoppen toevoegen om geplande taken te maken, bewerken en aan/uit te zetten (aanbevolen)
- **B)** Geplande taken regelen via de bestaande "voorstel-goedkeuren"-stroom
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Aparte knoppen voor geplande taken

### G-CTRL-RETRY-DEADLETTER — Wat als uitvoeren mislukt
**In één zin:** Wat gebeurt er als een opdracht is aangenomen maar daarna toch mislukt door een tijdelijke storing?
**Wat het betekent:** Het systeem zegt "ik ga het doen", maar daarna kan iets stuk zijn (een dienst plat). De gebruiker denkt dan dat het lukte, terwijl het stilletjes mislukt. Vraag: proberen we het automatisch opnieuw, of leggen we de mislukking apart zodat iemand het ziet? Net als een pakketje dat niet bezorgd kon worden: opnieuw proberen, of melden dat het misging.
**Opties:**
- **A)** Een paar keer automatisch opnieuw proberen, en daarna een foutmelding sturen (aanbevolen)
- **B)** De mislukte opdracht apart markeren als "niet gelukt" zodat iemand hem oppakt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Paar keer opnieuw, daarna foutmelding

### G-CTRL-ANSWER-QUESTIONSET — Hoe vragen beantwoord worden
**In één zin:** Via welke weg beantwoord je een vragenlijstje van het systeem, en wat gebeurt er dan met die lijst?
**Wat het betekent:** Het systeem kan je een setje vragen stellen (bijvoorbeeld op je telefoon) en jouw antwoord moet ergens netjes binnenkomen. Er zijn twee mogelijke routes en het is nog niet vastgelegd welke de officiële is, plus hoe de lijst dan op "beantwoord" gezet wordt.
**Opties:**
- **A)** Een aparte nette "beantwoord-vragen"-knop toevoegen die bij de rest past (aanbevolen)
- **B)** De bestaande snelle berichten-route officieel goedkeuren als uitzondering
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Aparte nette 'beantwoord-vragen'-knop

### G-DATA-STAGEKIND-DUALREVIEW — Twee keer dezelfde stap
**In één zin:** Hoe houdt het systeem twee aparte review-stappen uit elkaar als ze allebei "review" heten?
**Wat het betekent:** Een werkstroom heeft stappen, en soms zijn er twee review-stappen achter elkaar. Omdat ze dezelfde naam dragen, kan het systeem in de war raken bij wie wat deed en wat het kostte. Het moet ze kunnen onderscheiden, bijvoorbeeld via een eigen uniek nummer per stap.
**Opties:**
- **A)** Elke stap een eigen uniek kenmerk geven, en de soort ("review") los daarvan bewaren (aanbevolen)
- **B)** De combinatie van soort + volgorde-nummer gebruiken als onderscheid
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Uniek kenmerk per stap, soort los bewaren

### G-DATA-STAGEKIND-CUSTOM — Eigen stappen toevoegen
**In één zin:** Welk "type" krijgt een zelf-toegevoegde stap die niet in de vaste lijst van bekende stap-soorten past?
**Wat het betekent:** Het systeem kent zes vaste soorten stappen, maar laat je ook eigen stappen verzinnen (zoals "uitrollen" of "documentatie"). Zo'n eigen stap past dan op geen van de zes hokjes. Vraag: dwingen we je een bestaand hokje te kiezen, of maken we een extra hokje "eigen"?
**Opties:**
- **A)** Een extra soort "eigen" toevoegen voor zelfgemaakte stappen (aanbevolen)
- **B)** Je moet bij een eigen stap toch één van de zes bestaande soorten kiezen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Extra soort 'eigen' voor zelfgemaakte stappen

### G-MT-AGENTSESSION-GLOBAL — Gebruiker verwijderen opruimen
**In één zin:** Wat gebeurt er met alle gegevens van een gebruiker als die volledig uit het systeem wordt verwijderd?
**Wat het betekent:** Een gebruiker bestaat systeembreed, maar laat overal sporen na: lidmaatschappen, meldingen, AI-sessies. Als je zo'n gebruiker verwijdert, mogen die sporen niet als "wezen" blijven rondslingeren. Vraag: ruimen we eerst alles netjes op, of bewaren we het anoniem? Net als iemand die een bedrijf verlaat: bureau leegruimen, of zijn naam vervangen door "ex-medewerker".
**Opties:**
- **A)** Bij verwijderen eerst alle bijbehorende gegevens netjes opruimen (aanbevolen)
- **B)** De gebruiker "zacht" verwijderen en zijn naam overal anoniem maken
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Eigen — Bij verwijderen zelf kiezen: alles wissen óf anonimiseren

### G-MT-PUSHSUB-CROSSTENANT — Meldingen naar juiste telefoon
**In één zin:** Hoe zorgt het systeem dat een melding van één werkruimte op de juiste telefoon belandt en gemute kan worden per werkruimte?
**Wat het betekent:** Een telefoon-aanmelding voor meldingen geldt systeembreed, maar meldingen zelf horen bij één werkruimte, en je voorkeuren ("hier wil ik wel/geen meldingen") soms ook. Het systeem moet die drie netjes aan elkaar koppelen zodat het juiste signaal op het juiste toestel komt.
**Opties:**
- **A)** De melding behandelen binnen z'n eigen werkruimte en het toestel systeembreed opzoeken (aanbevolen)
- **B)** Telefoon-aanmeldingen toch per werkruimte/lidmaatschap koppelen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Eigen — Alles op account-niveau: op laptop gestart ticket op telefoon oppakken bij inloggen zelfde account

### G-MIG-PRESET-SEED — Standaard-instellingen per pakket
**In één zin:** Welke stappen en standaardinstellingen krijgt elk van de drie startpakketten (simpel/uitgebreid/professioneel)?
**Wat het betekent:** Bij het opstarten kun je kiezen uit drie kant-en-klare pakketten met elk een eigen set werkstroom-stappen en standaardinstellingen. Die sets moeten volledig vastliggen, en het opnieuw aanzetten mag niet per ongeluk dubbele dingen aanmaken. Vergelijk met "klein/middel/groot" abonnementen die elk een vaste inhoud hebben.
**Opties:**
- **A)** Eén centrale lijst die per pakket de stappen en standaarden vastlegt (aanbevolen)
- **B)** De pakketten als vaste, meegeleverde instellingsbestanden bewaren
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén centrale lijst per pakket

### G-MIG-SEED-7-TO-KIND-CONSUMERS — Bestaande gegevens ombouwen
**In één zin:** Welke onderdelen breken als we de manier van benoemen van stappen omgooien, en bouwen we oude gegevens om?
**Wat het betekent:** Het systeem gaat stappen anders benoemen. Op meer plekken dan gedacht staan nog de oude namen opgeslagen bij bestaande gegevens. Vraag: zetten we die oude gegevens netjes om naar de nieuwe namen, of laten we de oude namen gewoon staan zodat niks hoeft te veranderen? Net als een verhuizing waarbij je oude adresgegevens overal moet bijwerken, of het oude adres gewoon laat staan.
**Opties:**
- **A)** Een ombouwstap die alle bestaande gegevens naar de nieuwe namen omzet (aanbevolen)
- **B)** De oude namen behouden zodat bestaande gegevens ongewijzigd blijven
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Bestaande gegevens ombouwen naar nieuwe namen

### G-DATA-QUESTIONSET-ANSWEREDBY — Wie beantwoordde het eerst
**In één zin:** Moet het systeem onthouden wie een vragenlijstje beantwoordde, en wat als twee mensen tegelijk antwoorden?
**Wat het betekent:** Het systeem wil bijhouden wie een setje vragen beantwoord heeft. Het lastige is een "wie was eerst"-situatie: als twee mensen tegelijk antwoorden, moet maar één telling als de winnaar. Daar is een veilige manier voor nodig zodat het niet dubbel gaat. Net als een prijsvraag waarbij alleen de eerste inzending telt.
**Opties:**
- **A)** Een veld "beantwoord door" toevoegen en in één stap "open→beantwoord" zetten (aanbevolen)
- **B)** Antwoorden als aparte regels met een uniek kenmerk per antwoord
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Veld 'beantwoord door' + in één stap zetten

### G-DATA-CARRYOVER-CASCADE-CONFLICT — Doorgeef-pakketje bij herhaling
**In één zin:** Mag er meer dan één "doorgeef-pakketje" tussen twee stappen bestaan, en welke gebruikt de volgende stap dan?
**Wat het betekent:** Als werk van de ene stap naar de volgende gaat, geeft het systeem een pakketje met info door. Maar als een stap opnieuw gedraaid wordt, ontstaat er een tweede pakketje voor dezelfde overgang. Vraag: welke telt dan? Net als twee versies van hetzelfde overdrachtsdocument: pak je altijd de nieuwste?
**Opties:**
- **A)** Altijd het nieuwste pakketje gebruiken, oudere bewaren als geschiedenis (aanbevolen)
- **B)** Het oude pakketje markeren als "vervangen" in plaats van het te dupliceren
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Altijd nieuwste pakketje, oudere als geschiedenis

---

## 3. Bouwvolgorde, scope van versie 1, back-ups & server

### G-SEQ-1 — Welke bouwvolgorde geldt?
**In één zin:** We hebben drie verschillende bouwplannen die door elkaar lopen — welke is de baas?
**Wat het betekent:** Stel je voorbouwt een huis en je hebt drie verschillende bouwtekeningen die elkaar tegenspreken. De ene zegt "doe alles netjes na elkaar", de andere zegt "laat vier ploegen tegelijk werken". We moeten één tekening kiezen die wint, anders bouwt iedereen iets anders.
**Opties:**
- **A)** Het stap-voor-stap-plan is de baas, met een tabel die laat zien hoe het op de andere plannen aansluit (aanbevolen)
- **B)** Het vier-ploegen-tegelijk-plan is de baas, de rest is gewoon een andere manier van uitleggen
- **C)** Eén van de plannen markeren als verouderd en weggooien
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Stap-voor-stap-plan leidend + mappingtabel

### G-SEQ-2 — Kan stap 1 los starten?
**In één zin:** Kan het eerste bouwblok (zonder AI) helemaal apart beginnen, en wie maakt het gegevens-fundament dat het nodig heeft?
**Wat het betekent:** Voordat je meubels in een kamer zet, moet de vloer er liggen. Het eerste bouwblok heeft zo'n "vloer" nodig (de structuur van de database). De vraag is of dat eerste blok echt zelfstandig kan starten en wie verantwoordelijk is voor die vloer.
**Opties:**
- **A)** Eén persoon/ploeg maakt eerst de database-structuur af en bevriest die, dan kan stap 1 los (aanbevolen)
- **B)** De database-structuur groeit gewoon mee tijdens stap 1, geen apart fundament
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eerst database-fundament af + bevriezen

### G-SEQ-3 — Zitten de tools in versie 1?
**In één zin:** Horen de extra gereedschappen (Interviewer, Designer, Marketing, Document) bij de eerste versie of komen ze later?
**Wat het betekent:** Je lanceert een nieuwe app. De vraag is of die vier handige tools al meteen in de eerste lancering zitten, of dat ze pas in een latere update komen. Eén plan zegt "ze zitten erin", de scope-lijst noemt ze nergens — dat botst.
**Opties:**
- **A)** De tools komen pas ná versie 1 (aanbevolen)
- **B)** De tools zitten gewoon in versie 1
- **C)** Alleen sommige tools in versie 1, de rest later
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Tool-modules pas ná versie 1

### G-SCOPE-1 — Wat met de preview-functie?
**In één zin:** Previews zitten niet in versie 1 — moet de bijbehorende meet- en alarmcode er dan wél of niet in?
**Wat het betekent:** Stel je laat een functie weg uit de eerste versie, maar de "meterkast" die die functie in de gaten houdt zit er nog wel in. Dat is verwarrend. We moeten kiezen: alles weglaten, of de meters er vast inbouwen maar op nul laten staan.
**Opties:**
- **A)** Helemaal niet bouwen zolang previews eruit zijn (aanbevolen)
- **B)** De meet-/alarmcode wel inbouwen maar inactief op nul laten
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Preview-meters niet bouwen zolang previews eruit zijn

### G-SCOPE-2 — Zit de AI-kwaliteitstest erin?
**In één zin:** Bouwen we in versie 1 het testsysteem dat checkt of de AI goede antwoorden geeft, en wie is daarvan de eigenaar?
**Wat het betekent:** Net als een proefwerk-nakijksysteem voor de AI: het controleert of de AI nog steeds goede resultaten levert. De vraag is of dat al in de eerste versie moet, en niemand heeft nu de taak om het te maken.
**Opties:**
- **A)** Erin, en we wijzen er een duidelijke eigenaar aan (aanbevolen)
- **B)** Eruit, komt pas later
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — AI-kwaliteitstest erin + duidelijke eigenaar

### G-SCOPE-3 — Hoeveel "lagen" containers?
**In één zin:** Bouwen we in versie 1 ook een eigen kant-en-klare omgeving per project, of alleen een basis plus iets-per-taak?
**Wat het betekent:** Denk aan voorgemaakte maaltijden. Je kunt een basis-keuken hebben en per gerecht koken, óf per project een complete voorraadkast vooraf klaarzetten. Die extra voorraadkast-laag is werk; we moeten kiezen of die al in versie 1 hoort.
**Opties:**
- **A)** Alleen de basis plus iets-per-taak in versie 1; de project-laag komt later (aanbevolen)
- **B)** Ook de complete project-laag meteen in versie 1
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** B — Per-project image-/project-laag KOMT in v1 (gewijzigd 2026-06-22, was A), maar gated op de AI-implementatie-laag (zie ADR 0016)

### G-DEFER-1 — Wie maakt de back-ups?
**In één zin:** Wanneer en door wie worden back-ups gemaakt, en draait de eerste echte gebruiker dus zónder vangnet?
**Wat het betekent:** Back-ups zijn als kopietjes van je belangrijke spullen voor als er iets misgaat. Nu staat nergens wie ze maakt of wanneer. Het gevaar: de eerste echte klant draait misschien zonder enige kopie, dus bij een crash is alles weg.
**Opties:**
- **A)** Een eigenaar aanwijzen en back-ups verplicht maken vóór de eerste echte gebruiker (aanbevolen)
- **B)** Bewust accepteren dat de eerste gebruikers nog zonder back-ups draaien (kleine vertrouwde groep)
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Back-ups verplicht vóór eerste echte gebruiker

### G-DEFER-2 — Hoeveel uitval is oké?
**In één zin:** Hoeveel "platte tijd" mag de eerste gebruiker meemaken, en wanneer bouwen we een reserve-systeem dat snel overneemt?
**Wat het betekent:** Als de centrale motor van het systeem stilvalt, ligt alles plat. De vraag is: hoeveel minuten/uren mag dat duren voordat het echt een probleem is, en op welk moment zetten we een reserve-motor klaar die direct overneemt.
**Opties:**
- **A)** Een duidelijke maximale uitvaltijd afspreken plus een moment waarop het reserve-systeem verplicht wordt (aanbevolen)
- **B)** Voorlopig geen reserve-systeem; korte uitval accepteren
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Max uitvaltijd + moment waarop reserve verplicht

### G-DEFER-3 — Wat als geheugen-opschonen faalt?
**In één zin:** Wat doen we als beide manieren om het AI-geheugen op te schonen niet genoeg helpen?
**Wat het betekent:** De AI verzamelt te veel "geheugen" en moet af en toe opruimen om door te kunnen werken. Er zijn twee opruim-knoppen bedacht. Maar wat als allebei te weinig opleveren? Dan is er nu geen plan B en kan de AI vastlopen.
**Opties:**
- **A)** Vooraf een derde noodplan bedenken (bijv. helemaal opnieuw starten met overdracht) (aanbevolen)
- **B)** Eerst testen of het echt voorkomt, dan pas een noodplan maken
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Uitgewerkt (ADR 0017, 2026-06-22) — configureerbare cyclus per model: N× compact → daarna clear mét handoff-doc die meteen weer ingelezen wordt; instelbaar wanneer (drempel), hoe vaak compacten, en de trigger-prompt. Opus-1M: 2× compact rond ~400k tokens, dan clear+handoff.

### G-DEPLOY-1 — Hoelang mag de "baas" zwijgen?
**In één zin:** Hoelang mag het hoofdproces stil zijn voordat een ander het overneemt, en past dat getal bij de langste normale hapering?
**Wat het betekent:** Eén proces is de "baas" en moet af en toe een teken van leven geven. Als het te lang stil is, denkt het systeem dat het dood is en neemt iets anders over. We moeten een concreet aantal seconden kiezen dat ruim genoeg is dat een normale hapering niet per ongeluk een wissel veroorzaakt.
**Opties:**
- **A)** Concrete waarde kiezen met een ruime marge boven de langste normale hapering (aanbevolen)
- **B)** Een krappe waarde voor snellere overname, met meer risico op valse alarmen
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Levensteken-tijd met ruime marge

### G-DEPLOY-2 — Hoeveel projecten tegelijk?
**In één zin:** Hoeveel actieve projecten mag de server tegelijk aan, en bij hoeveel geheugengebruik moet hij ruimte vrijmaken?
**Wat het betekent:** Een server heeft beperkt geheugen, net als een tafel met beperkte ruimte. We moeten afspreken hoeveel projecten er tegelijk "op tafel" mogen liggen en bij welke volheid hij begint op te ruimen. Nu staat er alleen een vaag richtgetal, geen vaste instelling.
**Opties:**
- **A)** Concrete getallen vastleggen voor de standaardserver (8 cores / 32 GB) (aanbevolen)
- **B)** Voorzichtig lage limiet kiezen en later ophogen na meten
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Concrete capaciteitsgetallen (8 cores/32 GB)

### G-DEPLOY-3 — Eén of twee kopieën van de app?
**In één zin:** Draaien er in versie 1 echt twee kopieën van de webapp op één server, of in de praktijk maar één?
**Wat het betekent:** Twee kopieën draaien is bedoeld zodat één kan overnemen als de ander valt. Maar als ze op dezélfde server staan en die server valt om, vallen ze allebei om — dan is het schijnveiligheid. De vraag is of we echt twee draaien of eerlijk gewoon één.
**Opties:**
- **A)** Eerlijk één kopie in versie 1; twee kopieën pas als er meerdere servers zijn (aanbevolen)
- **B)** Toch twee kopieën draaien op die ene server
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eerlijk één app-kopie in v1

### G-BACKUP-1 — Waar bewaren we de hoofdsleutel?
**In één zin:** Waar bewaren we de sleutel die alle versleutelde wachtwoorden ontgrendelt, zodat we hem niet kwijtraken?
**Wat het betekent:** Belangrijke wachtwoorden worden versleuteld opgeslagen, achter één hoofdsleutel. Maak je een back-up van de versleutelde data maar verlies je die sleutel, dan kun je niets meer openen — net als een kluis-back-up zonder de code. Die sleutel moet apart en veilig bewaard worden.
**Opties:**
- **A)** De sleutel apart en versleuteld back-uppen, los van de database (aanbevolen)
- **B)** De sleutel in een aparte wachtwoordkluis/secret-manager bewaren
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Hoofdsleutel apart + versleuteld back-uppen

### G-BACKUP-2 — Back-up van handmatig werk?
**In één zin:** Worden de wijzigingen die een mens zelf maakt (en nog niet heeft opgeslagen) ook geback-upt, of accepteren we dat verlies?
**Wat het betekent:** De AI z'n werk kun je makkelijk opnieuw laten doen, maar als een mens zelf in de code zit te typen en dat is nog niet vastgelegd, dan is dat handwerk bij een crash gewoon weg. Dat opnieuw doen is voor een mens niet gratis. De vraag is of we dat beschermen.
**Opties:**
- **A)** Ook het onopgeslagen handwerk regelmatig back-uppen (aanbevolen)
- **B)** Accepteren dat onopgeslagen handwerk verloren kan gaan
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Ook onopgeslagen handwerk back-uppen

### G-BACKUP-3 — Wat als de back-up ook kapot is?
**In één zin:** Wat doet de beheerder als een back-up zelf beschadigd blijkt, en hoeveel oude back-ups bewaren we?
**Wat het betekent:** Soms is een back-up zelf stuk. Het plan zegt nu: pak dan de vorige. Maar wat als die óók stuk is? En hoeveel oude versies moeten we bewaren zodat we ver genoeg terug kunnen? Dat is nu niet vastgelegd.
**Opties:**
- **A)** Meerdere generaties bewaren plus een duidelijk noodpad als meerdere kapot zijn (aanbevolen)
- **B)** Een vast klein aantal generaties bewaren, simpel houden
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Meerdere generaties + noodpad

### G-OBS-1 — Wanneer moet het alarm afgaan?
**In één zin:** Bij welke concrete getallen en na hoeveel tijd moeten de waarschuwingen afgaan?
**Wat het betekent:** Een rookmelder moet weten bij hoeveel rook hij piept. Nu staat er alleen "piep als het te veel is", zonder getal. Zonder concrete grens kun je het alarm niet echt bouwen. We moeten echte getallen en tijdsvensters kiezen.
**Opties:**
- **A)** Voor elke waarschuwing een concrete grens en tijdsvenster vastleggen (aanbevolen)
- **B)** Met voorzichtige standaardwaarden starten en later bijstellen na meten
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Concrete alarmgrenzen + tijdsvensters

### G-OBS-2 — Hoe vaak meldt elk proces zich?
**In één zin:** Hoe vaak moet elk achtergrondproces "ik leef nog" zeggen, zodat we weten wanneer er iets hangt?
**Wat het betekent:** Elk achtergrond-taakje (zoals opruimen of controleren) moet regelmatig een teken van leven geven. Pas als je weet hoe vaak dat hoort te gebeuren, kun je merken wanneer er eentje stilvalt. Die ritmes zijn nergens vastgelegd.
**Opties:**
- **A)** Per taakje een concreet meld-ritme vastleggen (aanbevolen)
- **B)** Eén gezamenlijk standaardritme voor alle taakjes
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Per achtergrondtaak een meld-ritme

### G-OBS-3 — Echte monitoring aanzetten?
**In één zin:** Zetten we in versie 1 een echt monitoringsysteem aan, of laten we alles gewoon naar het scherm/logboek schrijven?
**Wat het betekent:** Je kunt waarschuwingen netjes naar een professioneel dashboard sturen, of ze gewoon in een tekstlogboek laten lopen. Het dashboard kost extra instelwerk en niemand heeft die taak nu. De vraag is of versie 1 al het dashboard krijgt.
**Opties:**
- **A)** Versie 1 draait simpel met logboek/scherm; dashboard komt later (aanbevolen)
- **B)** Het echte monitoring-dashboard meteen in versie 1 aanzetten en een eigenaar aanwijzen
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** B — Echt monitoring-dashboard meteen in v1 + eigenaar

### G-ENV-1 — Welke login-aanpak voor de beheerder?
**In één zin:** Welke manier van inloggen geldt voor de beheerder — de handleiding noemt nog de oude, afgekeurde methode?
**Wat het betekent:** De handleiding voor wie het systeem opzet beschrijft nog een oude manier om toegang te regelen die we eigenlijk hebben afgewezen ten gunste van een veiligere. Als de beheerder de oude volgt, zet hij het verkeerd op. Niemand is nu verantwoordelijk voor het corrigeren.
**Opties:**
- **A)** De handleiding bijwerken naar de nieuwe, veilige methode en een eigenaar aanwijzen (aanbevolen)
- **B)** De oude methode voorlopig toch toestaan
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Handleiding bijwerken naar veilige login

### G-ENV-2 — Eén aan/uit-knop of twee?
**In één zin:** Is er één aan/uit-instelling voor de terminal en AI-chat, of twee aparte — en welke namen gelden?
**Wat het betekent:** Verschillende documenten gebruiken net iets andere namen voor de schakelaars die de terminal en de AI-chat aan- of uitzetten. Daardoor is onduidelijk of het één knop is of twee. We moeten het opschonen tot duidelijke, eenduidige namen.
**Opties:**
- **A)** Twee aparte schakelaars met duidelijke namen (één voor terminal, één voor AI) (aanbevolen)
- **B)** Eén gezamenlijke schakelaar voor allebei
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Twee aparte schakelaars (terminal / AI)

### G-ENV-3 — Welke zoek-database als standaard?
**In één zin:** Gebruikt versie 1 standaard de slimme zoek-database, of de eenvoudige terugvaloptie — en hoe werkt opstarten dan?
**Wat het betekent:** Voor het slim doorzoeken van informatie zijn er twee opties: een geavanceerde en een simpele terugval. Bij de simpele bestaat een bepaalde zoek-index niet, dus een opstartstap valt dan weg. Nu staat nergens welke optie versie 1 standaard draait.
**Opties:**
- **A)** De geavanceerde zoek-database als standaard in versie 1 (aanbevolen)
- **B)** De simpele terugvaloptie als standaard, makkelijker te draaien
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Geavanceerde zoek-database als standaard

### G-SPIKE-1 — Hoeveel noodgrepen mag je stapelen?
**In één zin:** Hoeveel "het werkt, maar met een noodgreep" mag een test verzamelen voordat het samen tóch een mislukking is?
**Wat het betekent:** Bij het testen mag iets soms slagen "met een trucje eromheen". Eén trucje is prima, maar als je er drie tegelijk nodig hebt, staat het hele systeem op losse schroeven terwijl elk los puntje nog "geslaagd" lijkt. We moeten een grens stellen aan het aantal trucjes.
**Opties:**
- **A)** Een maximum afspreken (bijv. max 2 noodgrepen, daarna geldt het als mislukt) (aanbevolen)
- **B)** Per geval beoordelen door een mens, geen vast maximum
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Maximum aantal noodgrepen, daarna mislukt

### G-SPIKE-2 — Wat als er een limiet op tegelijk werken zit?
**In één zin:** Wat doen we als de test bij 4 tegelijk goed gaat maar bij 6–8 een limiet/blokkade van de AI-leverancier raakt?
**Wat het betekent:** We willen veel projecten tegelijk laten draaien. De test kijkt nu maar naar 4 tegelijk. Maar de AI-leverancier kan een plafond hebben dat bij 6–8 al een blokkade geeft — dan haal je het geplande aantal nooit. We moeten dat plafond echt testen.
**Opties:**
- **A)** De test uitbreiden tot het echte geplande aantal en het leverancier-plafond aftasten (aanbevolen)
- **B)** Het geplande aantal verlagen tot wat veilig binnen de limiet past
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** B — Gepland aantal verlagen tot binnen de limiet

### G-SPIKE-3 — Testen op het echte serversysteem?
**In één zin:** Moet de test op hetzelfde besturingssysteem als de echte server draaien, telt een test op de ontwikkel-pc wel mee?
**Wat het betekent:** Iets kan prima werken op je eigen laptop maar anders op de echte server (ander besturingssysteem). Vooral inloggen/toegang kan daar verschillen. De vraag is of de test verplicht op het echte server-systeem moet, en of hij opnieuw moet bij een systeemwissel.
**Opties:**
- **A)** Verplicht testen op het echte serversysteem, en opnieuw bij een systeemwissel (aanbevolen)
- **B)** Een test op de ontwikkel-pc accepteren als voldoende
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Verplicht testen op het echte serversysteem

### G-SPIKE-4 — Wie houdt updates van de AI-tool bij?
**In één zin:** Wie volgt nieuwe versies van de Claude-tool en beslist wanneer een vastgezette versie te oud of onveilig wordt?
**Wat het betekent:** We zetten een vaste versie van de AI-tool vast zodat alles voorspelbaar blijft. Maar iemand moet in de gaten houden of er belangrijke of veiligheidsupdates uitkomen en beslissen wanneer we moeten bijwerken. Die taak is nu van niemand.
**Opties:**
- **A)** Een vaste eigenaar aanwijzen die updates volgt en de bijwerk-beslissing neemt (aanbevolen)
- **B)** Periodiek (bijv. maandelijks) gezamenlijk controleren, geen vaste eigenaar
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Vaste eigenaar voor tool-updates

### G-XB-1 — Bouwen we de losse "denker"?
**In één zin:** Bouwen we in versie 1 het losse AI-denkonderdeel voor de Interviewer, of niet — twee plannen spreken elkaar tegen?
**Wat het betekent:** Eén onderdeel kan in z'n eentje even "nadenken" voor de Interviewer-functie, bijvoorbeeld als de gebruiker weg is. Het ene plan zegt dat het nodig is, het andere zet het buiten versie 1. We moeten kiezen.
**Opties:**
- **A)** Buiten versie 1 laten, komt later (aanbevolen)
- **B)** Toch bouwen in versie 1 omdat de Interviewer het nodig heeft
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Losse 'denker' pas ná versie 1

### G-XB-2 — Verbruik uitlezen, en zo niet?
**In één zin:** Bouwen we een test of we het AI-verbruik betrouwbaar kunnen uitlezen, en wat doen we als dat niet lukt?
**Wat het betekent:** We willen kunnen aflezen hoeveel "AI-tegoed" verbruikt is, bijvoorbeeld om automatisch te pauzeren bij een limiet. Maar het is onzeker of dat cijfer betrouwbaar uit te lezen is. We moeten dat testen en een plan B hebben als het niet werkt.
**Opties:**
- **A)** Een testrij toevoegen die dit checkt, plus een plan B als het niet betrouwbaar is (aanbevolen)
- **B)** Aannemen dat het werkt en pas reageren als het misgaat
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Test of verbruik uitleesbaar is + plan B

### G-XB-3 — Welke afhankelijkheids-indeling klopt?
**In één zin:** Welke indeling van "wat blokkeert wat" geldt — de twee plannen gebruiken onverenigbare benamingen?
**Wat het betekent:** Sommige onderdelen kunnen pas starten als andere klaar zijn. Twee plannen delen die afhankelijkheden anders in en gebruiken zelfs dezelfde letters voor verschillende dingen. Daardoor kan een bouwer de verkeerde onderdelen blokkeren of vrijgeven. We moeten één indeling kiezen.
**Opties:**
- **A)** Eén indeling als bindend kiezen en de andere benamingen daarop afstemmen (aanbevolen)
- **B)** Een nieuwe, heldere indeling maken die beide vervangt
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén afhankelijkheids-indeling bindend

### G-XB-4 — Wie legt het handwerk vast?
**In één zin:** Wie legt de handmatige wijzigingen van de mens vast (committen), wanneer, en krijgen die een eigen plek?
**Wat het betekent:** Als een mens zelf code aanpast, moet dat ergens netjes "vastgelegd" worden zodat het bewaard blijft. Nu staat niet wie dat doet, wanneer, of dat het apart genoteerd wordt of samengevoegd met het AI-werk. Dat moet helder.
**Opties:**
- **A)** De mens legt z'n eigen wijzigingen apart vast, met duidelijk moment en eigen notitie (aanbevolen)
- **B)** Het handwerk samenvoegen met het AI-werk in één geheel
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Handwerk apart vastleggen (eigen notitie)

### G-XB-5 — Wanneer stopt het herstel-rondje?
**In één zin:** Wanneer stopt de lus van "controleren en repareren" als een fout maar niet weggaat?
**Wat het betekent:** De AI controleert z'n eigen werk en repareert tot het goed is. Maar bij een echte ontwerpfout (niet een simpel foutje) kan dat eindeloos doorgaan zonder oplossing. We moeten een stopmoment afspreken: na zoveel pogingen escaleren naar een mens.
**Opties:**
- **A)** Een maximum aantal pogingen instellen, daarna escaleren naar een mens (aanbevolen)
- **B)** Doorgaan zolang het zin lijkt te hebben, een mens beoordeelt het zelf
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Max pogingen, daarna escaleren naar mens

---

## 4. Schermen & features (deel 1: 01–12)

### G-01-1 — Vastgelopen workspace opstart
**In één zin:** Wat gebeurt er als het klaarzetten van een nieuwe werkruimte halverwege blijft hangen, en wie mag het opnieuw proberen?
**Wat het betekent:** Als je een nieuw project aanmaakt, doet het systeem op de achtergrond wat voorbereidend werk. Soms loopt dat vast. De vraag is of je daar een melding van krijgt, en of alleen jij het opnieuw mag starten of ook een andere beheerder. Vergelijk het met een download die blijft steken: mag je collega hem hervatten of alleen jij?
**Opties:**
- **A)** Elke beheerder mag opnieuw proberen, en iedereen krijgt een melding (aanbevolen)
- **B)** Alleen degene die het startte mag hervatten
- **C)** Na een paar dagen stilstand zet het systeem het automatisch op archief met een bericht
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Elke beheerder mag hervatten; iedereen krijgt melding

### G-01-2 — Taken tijdens eerste indexering
**In één zin:** Mag je al taken aanmaken terwijl de werkruimte nog bezig is met het inlezen van de code?
**Wat het betekent:** Als een nieuw project net is aangemaakt, is het systeem nog bezig de code te leren kennen voordat alles helemaal werkt. De vraag is of je in die tussentijd al taakjes op het bord mag zetten. Net als een nieuwe medewerker: mag je hem al opdrachten geven terwijl hij nog z'n inwerkmap doorleest?
**Opties:**
- **A)** Ja, taken aanmaken mag al en ze wachten gewoon rustig tot alles klaar is (aanbevolen)
- **B)** Nee, taken aanmaken kan pas als het inlezen klaar is
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Taken mogen al aangemaakt; wachten tot indexeren klaar

### G-02-1 — Stappen wijzigen tijdens werk
**In één zin:** Wat gebeurt er met taken die druk bezig zijn als iemand de werkstappen onderweg verandert of weghaalt?
**Wat het betekent:** Je werk verloopt langs vaste stappen (zoals "ontwerp", "bouwen", "controleren"). Iemand mag die stappen aanpassen, ook terwijl er taken middenin zitten. De vraag is wat er dan met die lopende taken gebeurt. Stel je gooit een stap "controleren" weg terwijl er nog drie taken in die kolom staan: wat doe je met die taken?
**Opties:**
- **A)** Een stap weghalen kan niet zolang er nog taken in zitten (aanbevolen)
- **B)** De taken schuiven terug naar de vorige stap
- **C)** Lopend werk wordt direct gestopt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Stap weghalen kan niet zolang er taken in zitten

### G-02-2 — Afkeuren bij dubbele controle
**In één zin:** Als twee controleurs nodig zijn en de eerste keurt af, wat gebeurt er dan met die eerste en met de tweede die nog moet kijken?
**Wat het betekent:** Sommige taken moeten door twee mensen worden goedgekeurd. Als de eerste controleur het afkeurt, is de vraag of die opnieuw moet kijken zodra het verbeterd is, en wat de tweede controleur dan doet. Net als twee leraren die een opdracht nakijken: als de eerste een onvoldoende geeft, kijkt de tweede dan toch nog?
**Opties:**
- **A)** Afkeuren stuurt het werk terug; daarna begint de hele controle opnieuw bij controleur 1 (aanbevolen)
- **B)** Alleen de afkeurende controleur kijkt opnieuw, de tweede wacht gewoon
- **C)** Eén afkeuring stopt alles meteen, de tweede controle vervalt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Afkeuren stuurt terug; controle begint opnieuw bij 1

### G-03-1 — Handmatige tekst overschreven
**In één zin:** Wat gebeurt er als het systeem automatisch documentatie bijwerkt en daarbij tekst overschrijft die jij met de hand had aangepast?
**Wat het betekent:** Het systeem maakt zelf hulpteksten (documentatie) aan en houdt ze bij. Maar als jij zelf iets in zo'n tekst hebt aangepast, kan een automatische update jouw werk overschrijven. Net als een gedeeld document dat 's nachts automatisch ververst wordt: jouw handmatige notities kunnen dan verdwijnen.
**Opties:**
- **A)** Het systeem ziet jouw wijziging en laat die staan in plaats van overschrijven (aanbevolen)
- **B)** De automatische versie wint altijd en overschrijft alles
- **C)** Updates komen in een aparte voorstel-versie zodat jij kunt kiezen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Systeem ziet jouw wijziging en laat die staan

### G-03-2 — Bouwen zonder de AI-helper
**In één zin:** Wat kun je nog tijdens het opzetten van een project als de AI-assistent op dat moment niet beschikbaar is?
**Wat het betekent:** Bij het inrichten van een project helpt een AI-assistent mee met keuzes maken. Maar soms is die even weg (geen tegoed, of je bent zelf afwezig). De vraag is wat dan nog doorgaat. Net als een formulier invullen met hulp van een adviseur: wat als die adviseur even niet bereikbaar is, kun je dan toch verder?
**Opties:**
- **A)** Het systeem gebruikt standaardkeuzes en gaat door zonder de assistent (aanbevolen)
- **B)** Het inrichten wacht totdat de assistent weer beschikbaar is
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Standaardkeuzes gebruiken, doorgaan zonder assistent

### G-04-1 — Tellen van herhaalde fouten
**In één zin:** Als een hulpmiddel drie keer achter elkaar faalt, wanneer begint die telling opnieuw bij nul?
**Wat het betekent:** Het systeem koppelt externe hulpmiddelen aan (bijvoorbeeld een verbinding met een ander programma). Als zo'n hulpmiddel drie keer op rij faalt, grijpt het systeem in. De vraag is wanneer de teller weer op nul gaat: na een geslaagde poging, of pas bij een nieuwe stap? Vergelijk het met een pincode: na hoeveel goede of nieuwe pogingen wist hij de mislukte pogingen?
**Opties:**
- **A)** De teller gaat per hulpmiddel weer op nul zodra één poging lukt (aanbevolen)
- **B)** De teller loopt door per taak en reset niet zomaar
- **C)** De teller wordt gewist bij elke nieuwe werkstap
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Teller per hulpmiddel terug op nul bij één succes

### G-04-2 — Hulpmiddel verwijderd na koppeling
**In één zin:** Wat gebeurt er als een hulpmiddel dat aan een stap was gekoppeld later wordt verwijderd of hernoemd?
**Wat het betekent:** Je kunt een externe koppeling (bijvoorbeeld een verbinding met een dienst) aan een werkstap hangen. Als die koppeling daarna wordt weggehaald of hernoemd, wijst de stap naar iets dat niet meer bestaat. De vraag is of je daar een waarschuwing van krijgt of dat het stilletjes misgaat. Net als een snelkoppeling op je bureaublad naar een bestand dat je hebt verplaatst.
**Opties:**
- **A)** Je krijgt een duidelijke waarschuwing dat de koppeling kapot is (aanbevolen)
- **B)** Het systeem ruimt de kapotte koppeling automatisch op
- **C)** Het faalt stil pas op het moment dat de stap draait
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Duidelijke waarschuwing dat de koppeling kapot is

### G-05-1 — Kosten bij herhaalde stap
**In één zin:** Wat laat het kosten- en tijd-label zien als een taak meerdere keren door dezelfde stap heen ging?
**Wat het betekent:** Bij elke taak zie je een labeltje met de kosten en de tijd. Maar als een taak werd afgekeurd en de stap opnieuw deed, telt dat dan dubbel? En hoe wordt de geschatte resterende tijd herberekend? Net als een taxiritje waar je tussendoor moest omkeren: tel je die extra kilometers mee in de prijs en de verwachte aankomsttijd?
**Opties:**
- **A)** Het label telt alle pogingen bij elkaar op en herberekent de verwachte tijd opnieuw (aanbevolen)
- **B)** Alleen de laatste poging telt mee in het label
- **C)** Elke poging staat apart vermeld zodat je het verloop ziet
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Label telt alle pogingen op, herberekent tijd

### G-05-2 — Doorgaan na kostenlimiet
**In één zin:** Hoe gedraagt de knop "limiet verhogen en doorgaan" zich als de hele werkruimte al stilligt door een kostenplafond?
**Wat het betekent:** Als de kosten een grens raken, stopt het werk. Er is een knop om die grens te verhogen en verder te gaan. Maar als de hele werkruimte al helemaal stilligt, werkt die knop dan nog? De vraag is of de knop klikbaar lijkt maar niets doet, of meteen grijs en uitgeschakeld is. Net als een "betaal nu"-knop terwijl de winkel offline is.
**Opties:**
- **A)** De knop is duidelijk uitgeschakeld zolang de hele werkruimte stilligt (aanbevolen)
- **B)** De knop blijft klikbaar maar geeft uitleg waarom het nu niet kan
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Knop uitgeschakeld zolang werkruimte stilligt

### G-06-1 — Wachtrij voor spraak omzetten
**In één zin:** Wat gebeurt er als je een spraakbericht inspreekt terwijl het systeem al een ander bericht aan het uitschrijven is?
**Wat het betekent:** Je kunt taken inspreken met je stem; het systeem zet dat om naar tekst. Maar het kan maar één bericht tegelijk verwerken. Als jij en een collega tegelijk inspreken, moet er eentje wachten. De vraag is of je dan ziet dat je in de rij staat, of dat het misgaat. Net als één kassa met meerdere klanten: zie je je plek in de rij?
**Opties:**
- **A)** Je komt netjes in de wachtrij met een melding "wacht op je beurt" (aanbevolen)
- **B)** Het tweede bericht wordt geweigerd tot het eerste klaar is
- **C)** Na een tijdje wachten stopt het met een tijdslimiet-melding
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Netjes in wachtrij met "wacht op je beurt"

### G-06-2 — Inspreken op verouderde vraag
**In één zin:** Wat gebeurt er als je een gesproken antwoord stuurt op een vraag die intussen al door iemand anders is beantwoord?
**Wat het betekent:** Een taak kan een open vraag hebben waar jij met je stem op kunt antwoorden. Maar tegen de tijd dat jij klaar bent met inspreken, kan een collega die vraag al hebben beantwoord. De vraag is wat er dan met jouw antwoord gebeurt. Net als reageren op een appje dat al beantwoord is voor jij op verzenden drukt.
**Opties:**
- **A)** Je krijgt te zien dat de vraag al beantwoord is en je antwoord wordt niet dubbel verstuurd (aanbevolen)
- **B)** Je antwoord wordt alsnog als extra opmerking toegevoegd
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Toont dat vraag al beantwoord is; geen dubbel

### G-07-1 — Tegelijk goed- en afkeuren
**In één zin:** Als twee controleurs tegelijk hetzelfde werk beoordelen en de een keurt goed terwijl de ander afkeurt, wie wint er dan?
**Wat het betekent:** Twee mensen kunnen tegelijk hetzelfde stuk werk beoordelen. Als de een op "goedkeuren" klikt en de ander op exact hetzelfde moment op "afkeuren", botsen die. De vraag is welke actie telt en wat de verliezer te zien krijgt. Net als twee mensen die tegelijk bij dezelfde lift op "omhoog" en "omlaag" drukken.
**Opties:**
- **A)** Afkeuren wint altijd (veiligste keuze), de ander krijgt te zien dat het is afgekeurd (aanbevolen)
- **B)** Wie als eerste klikt wint, de ander krijgt een melding
- **C)** Beide acties blokkeren elkaar en er moet opnieuw worden beslist
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Afkeuren wint altijd (veiligst); ander ziet afkeuring

### G-07-2 — Goedkeuren zonder gewijzigde bestanden
**In één zin:** Wat laat het scherm zien als een stap klaar is maar er geen enkel bestand is veranderd?
**Wat het betekent:** Normaal toont het controlescherm welke bestanden zijn aangepast. Maar sommige stappen (zoals alleen nadenken of plannen) veranderen geen bestanden. De vraag is wat je dan ziet op die plek. Net als een nakijkblad voor een opdracht die alleen uit overleg bestond: er valt geen tekst te markeren.
**Opties:**
- **A)** Het bestanden-onderdeel verdwijnt en je keurt gewoon de tekst goed (aanbevolen)
- **B)** Er staat een nette lege melding "geen bestanden gewijzigd"
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Bestanden-onderdeel verdwijnt; tekst goedkeuren

### G-08-1 — Hele projectmap bekijken
**In één zin:** Hoe blader je door alle bestanden van een project zolang de complete bestandsverkenner er nog niet is?
**Wat het betekent:** Er komt later een volledige bestandsverkenner, maar nu kun je alleen de gewijzigde bestanden bekijken. De vraag is wat je in de tussentijd ziet als je de hele projectmap wilt doorbladeren. Net als een nieuw kantoorgebouw waar de lift nog niet werkt: neem je dan de trap of wacht je gewoon?
**Opties:**
- **A)** Een eenvoudige kijk-alleen verkenner als tussenoplossing tot de echte er is (aanbevolen)
- **B)** Bladeren door de hele map kan nog niet, met een "komt later"-melding
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eenvoudige kijk-alleen verkenner als tussenoplossing

### G-08-2 — Onopgeslagen werk bij wegvallen
**In één zin:** Wat gebeurt er met je onopgeslagen wijzigingen als de omgeving waarin je werkt ineens wegvalt?
**Wat het betekent:** Je kunt rechtstreeks in bestanden bewerken, maar dat gebeurt in een tijdelijke omgeving die kan worden gestopt of waar je rechten kunnen worden ingetrokken. De vraag is wat er met je nog-niet-opgeslagen werk gebeurt als dat tussendoor wegvalt. Net als typen in een online formulier dat plots uitlogt: ben je je tekst kwijt?
**Opties:**
- **A)** Je krijgt een waarschuwing en de kans om op te slaan voordat het wegvalt (aanbevolen)
- **B)** Onopgeslagen werk gaat verloren met achteraf een duidelijke melding
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Waarschuwing + kans om op te slaan voor wegvallen

### G-09-1 — Vraag blijft hangen na crash
**In één zin:** Wat gebeurt er met een openstaande vraag aan jou als het systeem vastloopt voordat je hebt geantwoord?
**Wat het betekent:** Soms stelt het systeem een vraag die jouw antwoord nodig heeft voordat het verder kan. Als het systeem vastloopt of opnieuw start terwijl die vraag nog openstaat, is de vraag of hij blijft staan, verloopt, of opnieuw aan je gesteld wordt. Net als een wachtende vraag in een chatbot die crasht: krijg je hem opnieuw te zien als hij weer opstart?
**Opties:**
- **A)** De vraag blijft staan en wordt opnieuw aan je voorgelegd na de herstart (aanbevolen)
- **B)** De vraag verloopt en het systeem probeert het zelf opnieuw
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Vraag blijft staan, opnieuw voorgelegd na herstart

### G-09-2 — Half ingevulde antwoorden kwijt
**In één zin:** Raak je antwoorden die je al hebt ingetypt maar nog niet verzonden kwijt als de vraag tussentijds vervangen wordt?
**Wat het betekent:** Bij een set vragen vul je alle antwoorden in en verstuurt ze in één keer. Maar als de vraag wordt vervangen door een nieuwe terwijl jij nog aan het typen bent, is de vraag of je ingevulde antwoorden verdwijnen. Net als een enquête waarbij je vraag 2 van 3 hebt ingevuld en de enquête plots vernieuwt: ben je je antwoorden kwijt zonder waarschuwing?
**Opties:**
- **A)** Je krijgt een waarschuwing voordat ingevulde antwoorden verdwijnen (aanbevolen)
- **B)** De antwoorden gaan zonder waarschuwing verloren bij de nieuwe vraag
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Waarschuwing voor verdwijnen ingevulde antwoorden

### G-10-1 — Automatisering wijst naar verdwenen stap
**In één zin:** Wat gebeurt er met een automatische regel als de stap of opdracht waar hij naar verwijst is verwijderd?
**Wat het betekent:** Je kunt regels maken die automatisch iets doen, bijvoorbeeld "start stap X". Als die stap X later wordt verwijderd, wijst de regel naar iets dat niet meer bestaat. De vraag is of de regel uit zichzelf stopt, een waarschuwing geeft, of stilletjes faalt. Net als een wekker die je hebt ingesteld voor een afspraak die je intussen hebt geschrapt.
**Opties:**
- **A)** De regel wordt uitgeschakeld met een duidelijke "kapot"-waarschuwing (aanbevolen)
- **B)** De regel blijft staan maar faalt stil als hij afgaat
- **C)** De regel wordt automatisch helemaal verwijderd
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Regel uitgeschakeld + "kapot"-waarschuwing

### G-10-2 — Wie mag automatiseringen maken
**In één zin:** Mag elk teamlid automatische regels maken, of alleen beheerders?
**Wat het betekent:** Automatische regels kunnen dingen in gang zetten waar normaal speciale rechten voor nodig zijn (zoals werk goedkeuren). Als iedereen zulke regels mag maken, kan iemand die rechten omzeilen. De vraag is wie regels mag aanmaken. Net als wie het alarm van het kantoor mag programmeren: iedereen of alleen de beheerder?
**Opties:**
- **A)** Alleen beheerders mogen automatische regels maken (aanbevolen)
- **B)** Iedereen mag regels maken, ongeacht zijn rol
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Alleen beheerders mogen automatische regels maken

### G-11-1 — AI-helper valt weg tijdens antwoord
**In één zin:** Wat gebeurt er met een antwoord van de AI-helper dat halverwege wordt afgebroken als je het paneel sluit of de verbinding wegvalt?
**Wat het betekent:** De AI-helper geeft soms antwoord dat letter voor letter binnenkomt. Als je het paneel midden in zo'n antwoord sluit, of de verbinding valt weg, is de vraag of dat halve antwoord verloren gaat of later doorgaat. Net als een spraakbericht dat halverwege afbreekt: hoor je later de rest of begint het opnieuw?
**Opties:**
- **A)** Het halve antwoord blijft bewaard en gaat door als je terugkomt (aanbevolen)
- **B)** Het halve antwoord vervalt en je vraagt het gewoon opnieuw
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Half antwoord bewaard, gaat door bij terugkomst

### G-11-2 — AI-helper op meerdere apparaten
**In één zin:** Als je tegelijk op je telefoon en je computer werkt, deel je dan dezelfde AI-chat of zijn het er twee los van elkaar?
**Wat het betekent:** Je hebt een eigen AI-helper per werkruimte. De vraag is of je op je telefoon en je laptop dezelfde gesprekgeschiedenis ziet, of dat elk apparaat een aparte chat heeft. Net als WhatsApp: zie je op je telefoon en je computer hetzelfde gesprek of twee verschillende?
**Opties:**
- **A)** Eén gedeelde chat die op al je apparaten gelijkblijft (aanbevolen)
- **B)** Een aparte chat per apparaat, los van elkaar
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén gedeelde chat, gelijk op alle apparaten (past bij account-niveau)

### G-12-1 — Bord bijwerken na weer online
**In één zin:** Hoe ziet het bord eruit als je telefoon weer verbinding krijgt en er ineens veel verplaatsingen tegelijk binnenkomen?
**Wat het betekent:** Taken schuiven over een bord van kolom naar kolom, met een vloeiende animatie. Maar als je even offline was en weer verbinding krijgt, komen er in één keer veel verplaatsingen binnen. De vraag is of het systeem die allemaal mooi animeert of de kaarten gewoon meteen op hun plek zet. Net als je mailbox die na een vliegreis ineens 30 nieuwe mails inlaadt.
**Opties:**
- **A)** De kaarten springen meteen op hun plek zonder animatie, om rommel te voorkomen (aanbevolen)
- **B)** Alle verplaatsingen worden netjes na elkaar geanimeerd
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Kaarten springen meteen op plek, geen animatie

### G-12-2 — Bord bij gepauzeerde werkruimte
**In één zin:** Wat verandert er op het bord als de AI is uitgezet of de hele werkruimte op pauze staat?
**Wat het betekent:** Op het bord staat per kolom een robot-teken dat aangeeft dat de AI er actief is. Als de AI uit staat of de hele werkruimte gepauzeerd is, is de vraag wat je dan ziet en wat je nog mag doen. Net als een fabriek waar de machines stilstaan: zie je dat duidelijk, en mag je nog wel handmatig spullen op de band leggen?
**Opties:**
- **A)** Het robot-teken verandert duidelijk, maar handmatige acties zoals taken toevoegen blijven mogelijk (aanbevolen)
- **B)** Het bord wordt volledig op slot gezet zolang het gepauzeerd is
- **C)** Kaarten worden "geparkeerd" en je kunt alleen kijken, niet wijzigen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Robot-teken verandert; handmatige acties blijven mogelijk

---

## 5. Schermen & features (deel 2: 13–24)

### G-13-1 — Bulk-actie loopt halverwege mis
**In één zin:** Als je in één keer 30 tickets verplaatst en het systeem hapert halverwege, wat zie je dan?
**Wat het betekent:** Je vinkt een grote stapel taken aan en zegt "verschuif allemaal". Als de computer er middenin mee stopt, zijn sommige wél verplaatst en andere niet. De vraag is hoe je dan duidelijk ziet welke gelukt zijn en welke niet.
**Opties:**
- **A)** Alles-of-niets: lukt er eentje niet, dan wordt niks verplaatst (aanbevolen)
- **B)** Per ticket een vinkje of kruisje, zodat je precies ziet wat lukte
- **C)** Een balkje "deels gelukt — 18 van de 30"
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Alles-of-niets bij bulk-fout, veilig en duidelijk

### G-13-2 — Bulk-actie op een werkende AI
**In één zin:** Mag je een ticket in bulk verplaatsen terwijl de AI er net druk mee bezig is?
**Wat het betekent:** Stel de AI is voor een taak code aan het schrijven, en jij sleept die taak tegelijk naar een andere kolom. Dat botst. De vraag is of we dat gewoon toestaan, of die taak overslaan, of de AI eerst even pauzeren.
**Opties:**
- **A)** Bulk-actie slaat taken over waar de AI mee bezig is (aanbevolen)
- **B)** Het systeem pauzeert de AI eerst automatisch, dan verplaatst het
- **C)** Verbieden: je krijgt een melding dat de taak bezig is
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Bulk slaat taken over waar AI mee bezig is

### G-13-3 — Sprint verwijderen of inkorten
**In één zin:** Wat gebeurt er met taken als je een sprint (werkperiode) weggooit of de einddatum vervroegt?
**Wat het betekent:** Een sprint is een blokje van een paar weken werk met taken erin. Als je dat blokje verwijdert, moeten de taken ergens heen. En als twee sprints elkaar in tijd overlappen, welke is dan "de actieve"?
**Opties:**
- **A)** Taken blijven bestaan en gaan terug naar "geen sprint" (aanbevolen)
- **B)** Taken verhuizen automatisch naar de volgende sprint
- **C)** Je mag een sprint met taken erin niet verwijderen zonder waarschuwing
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** C — Sprint met taken niet weggooien zonder waarschuwing (conservatief)

### G-14-1 — Twee mensen in dezelfde terminal
**In één zin:** Als twee mensen dezelfde terminal openhebben en allebei typen, wat gebeurt er dan?
**Wat het betekent:** Een terminal is een zwart venster waar je commando's typt. Als twee collega's het tegelijk openhebben en allebei tikken, raken de letters door elkaar. De vraag is of beiden mogen typen, of dat er om de beurt getypt wordt.
**Opties:**
- **A)** Beiden zien alles en mogen typen, samen (aanbevolen)
- **B)** Een melding "X is aan het typen" en de ander wacht even
- **C)** Wie als eerste binnen is mag typen, de rest kijkt alleen mee
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Beiden zien en typen samen in terminal

### G-14-2 — Wel sleutel, geen toegangsrecht
**In één zin:** Iemand heeft de juiste digitale sleutel maar geen toestemming voor deze terminal — wat ziet die persoon?
**Wat het betekent:** Je kunt de juiste sleutel hebben (zoals een huissleutel) maar toch niet in een bepaalde kamer mogen (geen toestemming). De vraag is wat die persoon op het scherm ziet als de deur dan dichtblijft.
**Opties:**
- **A)** Een duidelijke "geen toegang"-melding in plaats van de terminal (aanbevolen)
- **B)** De terminal lijkt te laden maar opent nooit
- **C)** De terminal opent maar alleen om mee te kijken, niet te typen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Duidelijke "geen toegang"-melding

### G-14-3 — Terminal opgeruimd terwijl je kijkt
**In één zin:** Wat zie je in de terminal als de machine erachter ondertussen is opgeruimd?
**Wat het betekent:** Achter elke terminal draait een soort tijdelijke computer. Om geld te besparen ruimt het systeem die op als er even niks gebeurt. Als jij het venster nog open hebt staan en dat gebeurt, moet je iets zinnigs zien in plaats van een bevroren scherm.
**Opties:**
- **A)** Een nette melding "deze sessie is afgesloten" met een knop om opnieuw te starten (aanbevolen)
- **B)** Het scherm bevriest op de laatste tekst
- **C)** Het systeem start automatisch stilletjes een nieuwe
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Nette "sessie afgesloten"-melding + herstart-knop

### G-15-1 — Twee keer tegelijk opnieuw inlezen
**In één zin:** Twee mensen drukken tegelijk op "lees de projectkennis opnieuw in" — wat gebeurt er met de tweede?
**Wat het betekent:** Het systeem leest af en toe het hele project opnieuw door zodat de AI up-to-date is. Als twee mensen die knop bijna tegelijk indrukken, moet de tweede keer niet voor problemen zorgen. De vraag is wat de tweede persoon dan ziet.
**Opties:**
- **A)** De tweede klik doet niks extra, want het loopt al (aanbevolen)
- **B)** De tweede gaat in de wachtrij en komt erna
- **C)** De twee verzoeken worden samengevoegd tot één
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Tweede klik doet niks, herindexering loopt al

### G-15-2 — Geüpload document zonder versie
**In één zin:** Een handmatig geüpload document komt niet uit de code-geschiedenis — bij welke versie hoort het dan?
**Wat het betekent:** Normaal hangt alle projectkennis vast aan een bepaald moment in de code-geschiedenis. Maar als jij zelf een los tekstbestand uploadt, hoort dat nergens bij. De vraag is hoe we dat losse bestand toch netjes meenemen.
**Opties:**
- **A)** Het document hangt aan de huidige nieuwste code-versie (aanbevolen)
- **B)** Het krijgt een eigen "los geüpload"-stempel zonder code-versie
- **C)** Het wordt elke keer opnieuw meegenomen, ongeacht versie
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Document hangt aan nieuwste code-versie

### G-15-3 — Mislukte herindexering
**In één zin:** Als het opnieuw inlezen halverwege mislukt, blijft dan de oude (werkende) kennis staan of een half-bijgewerkte mix?
**Wat het betekent:** Tijdens het opnieuw inlezen kan er iets stuk gaan. Je wilt niet dat de AI dan met half-oude, half-nieuwe kennis verder werkt, want dat geeft fouten. De vraag is of we netjes terugvallen op de laatste goede versie.
**Opties:**
- **A)** Terugvallen op de laatste volledige goede versie (aanbevolen)
- **B)** Houden wat al bijgewerkt is, ook al is het half
- **C)** Alles wissen tot het opnieuw lukt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Terugvallen op laatste volledige goede versie

### G-16-1 — Rechten afpakken tijdens het werk
**In één zin:** Als een beheerder midden in iemands sessie zijn rechten intrekt, stopt diens lopende actie en open terminal dan meteen?
**Wat het betekent:** Een beheerder kan iemand zijn toegang ontnemen. Maar die persoon kan op dat moment net iets aan het doen zijn of een terminal openhebben. De vraag is of dat per direct wordt afgekapt of pas bij de volgende keer.
**Opties:**
- **A)** Lopende actie maakt zichzelf af, maar daarna meteen geen toegang meer (aanbevolen)
- **B)** Alles wordt per direct afgekapt, ook open terminals
- **C)** Pas weg bij de volgende keer dat de persoon iets doet
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Lopende actie afmaken, daarna direct geen toegang

### G-16-2 — Jezelf tot eigenaar promoveren
**In één zin:** Kan iemand met de bevoegdheid "maak iemand beheerder" zichzelf stiekem tot enige eigenaar maken?
**Wat het betekent:** Er is altijd precies één eigenaar van een werkruimte. Als iemand het recht heeft om anderen te promoveren, mag hij dat recht niet misbruiken om zichzelf de baas te maken. Dit is een beveiligingsgaatje dat dicht moet.
**Opties:**
- **A)** Jezelf tot eigenaar maken is altijd geblokkeerd (aanbevolen)
- **B)** Mag alleen als de huidige eigenaar het bevestigt
- **C)** Mag, maar de oude eigenaar krijgt direct bericht en kan terugdraaien
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Zichzelf tot eigenaar maken altijd geblokkeerd

### G-16-3 — Rol verwijderen die nog in gebruik is
**In één zin:** Wat gebeurt er met mensen als je een rol verwijdert of hernoemt terwijl die nog aan hen is toegekend?
**Wat het betekent:** Een rol (zoals "redacteur") bepaalt wat iemand mag. Als je zo'n rol weggooit terwijl er nog mensen aan vasthangen, weet het systeem niet meer wat die mensen mogen. De vraag is waar die mensen dan landen.
**Opties:**
- **A)** Je mag een rol niet verwijderen zolang er mensen aan hangen (aanbevolen)
- **B)** Die mensen vallen terug op de minimale standaardrechten
- **C)** De rol wordt verwijderd en die mensen verliezen alle toegang
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Rol niet verwijderbaar zolang mensen eraan hangen

### G-17-1 — Sleutel intrekken met open terminal
**In één zin:** Als je je laatste digitale sleutel verwijdert, sluit dan je al-open terminal meteen of pas later?
**Wat het betekent:** Je gebruikt een sleutel om terminals te openen. Als je die sleutel weggooit terwijl er nog een terminal open is, is de vraag of dat venster meteen dichtgaat of pas de volgende keer dat je iets opent.
**Opties:**
- **A)** Open terminals worden per direct afgesloten (aanbevolen)
- **B)** Open terminals blijven, pas dicht bij de volgende keer openen
- **C)** Je krijgt eerst een waarschuwing voordat je de laatste sleutel mag weggooien
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Open terminals per direct afsluiten

### G-17-2 — Uitnodiging naar verkeerd e-mailadres
**In één zin:** Als een uitnodiging naar het ene e-mailadres ging maar iemand met een ánder adres inlogt, mag die de uitnodiging dan gebruiken?
**Wat het betekent:** Je nodigt iemand uit via zijn e-mail. Maar als diegene inlogt met een totaal ander account, hoort de uitnodiging niet zomaar te werken — anders kan een verkeerde persoon erin. De vraag is of we het e-mailadres moeten controleren.
**Opties:**
- **A)** Het inlog-e-mailadres moet kloppen met de uitnodiging (aanbevolen)
- **B)** De uitnodigingslink werkt voor iedereen die hem heeft, ongeacht e-mail
- **C)** Andere e-mail mag, maar de uitnodiger krijgt een melding
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Inlog-e-mail moet kloppen met uitnodiging

### G-17-3 — Wat zit er in "exporteer mijn data"
**In één zin:** Als je je gegevens downloadt, krijg je dan alleen je accountgegevens of ook alle data uit elke werkruimte?
**Wat het betekent:** Je hebt recht om je eigen gegevens op te vragen. Maar je zit misschien in meerdere werkruimtes met andere mensen. We willen je niet per ongeluk data van anderen meegeven, en ook niet te weinig. De vraag is wat er precies in de download zit.
**Opties:**
- **A)** Alleen je eigen accountgegevens, geen gedeelde werkruimte-data (aanbevolen)
- **B)** Account plus jouw eigen bijdragen binnen elke werkruimte
- **C)** Alles waar je toegang toe hebt, netjes per werkruimte gefilterd
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Alleen eigen accountgegevens exporteren (privacy-beslissing)

### G-18-1 — Vraag al door iemand anders beantwoord
**In één zin:** Als persoon A een AI-vraag oppakt, verdwijnt het meldingsbelletje dan ook bij persoon B?
**Wat het betekent:** De AI stelt soms een vraag en stuurt die naar meerdere collega's. Zodra de eerste antwoordt, is het klaar. De vraag is of de melding bij de anderen dan automatisch verdwijnt, zodat zij niet voor niets antwoorden.
**Opties:**
- **A)** Zodra iemand antwoordt, verdwijnt de melding bij alle anderen (aanbevolen)
- **B)** Iedereen ziet "al beantwoord door A" maar moet zelf wegklikken
- **C)** De melding blijft per persoon staan tot ze hem zelf lezen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Melding verdwijnt overal zodra iemand antwoordt

### G-18-2 — Wie krijgt welke meldingen
**In één zin:** Wie krijgt een melding als er iets met een taak gebeurt — iedereen, of alleen de betrokkenen?
**Wat het betekent:** Bij een gebeurtenis (zoals een nieuwe taak) moet een melding naar de juiste mensen. Je wilt niet iedereen met alles bestoken, en ook niemand iets sturen dat hij eigenlijk niet mag zien. De vraag is hoe we die kring bepalen.
**Opties:**
- **A)** Alleen de toegewezen persoon en de maker van de taak (aanbevolen)
- **B)** Alle leden van de werkruimte
- **C)** Per rol instelbaar wie wat krijgt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Alleen toegewezen persoon + maker krijgen melding

### G-18-3 — "Alles als gelezen markeren"
**In één zin:** Markeert de knop "alles gelezen" echt álle meldingen, of alleen die je nu op het scherm ziet?
**Wat het betekent:** Je hebt een knop om in één keer al je meldingen op gelezen te zetten. De vraag is of dat ook de oude meldingen meeneemt die nog niet zijn ingeladen, of alleen het stukje dat je nu ziet.
**Opties:**
- **A)** Echt alles, ook oude niet-ingeladen meldingen (aanbevolen)
- **B)** Alleen wat je nu op het scherm ziet
- **C)** Alleen het type dat je nu gefilterd hebt staan
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Markeert echt alles, ook oude meldingen

### G-19-1 — Twee budgetlimieten tegelijk vol
**In één zin:** Als twee uitgaven-limieten tegelijk vollopen met verschillende gevolgen, welk gevolg telt dan?
**Wat het betekent:** Je kunt grenzen instellen op kosten. De ene grens zegt "stop alleen nieuwe taken", de andere "stop alles". Als ze tegelijk geraakt worden, moet duidelijk zijn wat er gebeurt en welk venster je ziet.
**Opties:**
- **A)** De strengste regel wint, in één duidelijk venster (aanbevolen)
- **B)** Twee aparte vensters op elkaar gestapeld
- **C)** Je stelt zelf een volgorde in welke limiet voorgaat
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Geparkeerd (gewijzigd 2026-06-22, was A) — token-/budget-blokkering hoort niet in de huidige scope ("nog iets verzinnen"); alleen een informatieve verbruik-weergave mag, geen blokkeer-logica nu

### G-19-2 — Verbruik over een schuivend venster
**In één zin:** Hoe wordt het verbruik bijgehouden bij een limiet die "per laatste 5 uur" telt in plaats van per dag?
**Wat het betekent:** Sommige limieten kijken naar een steeds meeschuivend tijdvak, bijvoorbeeld de laatste 5 uur, niet naar een vaste kalenderdag. Het geschatte verbruik moet dan netjes over dat schuivende venster worden opgeteld en weer afnemen. De vraag is hoe we dat voor de eerste versie doen.
**Opties:**
- **A)** Simpele schatting die meeschuift met de tijd, goed genoeg voor v1 (aanbevolen)
- **B)** Pas precies meten zodra er een echte verbruiksmeter is
- **C)** Voorlopig terugvallen op een vaste dag-limiet
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Geparkeerd (gewijzigd 2026-06-22, was A) — sliding-window-verbruiksblokkade niet nu; alleen een informatieve verbruik-weergave, geen blokkeer-logica

### G-19-3 — Stopzetten raakt ook previews en CI
**In één zin:** Als het budget op is en alles stilgelegd wordt, gaan dan ook de preview-omgevingen en testtaken uit?
**Wat het betekent:** "Alles pauzeren" stopt de AI-taken. Maar er draaien ook andere dingen die geld kosten: preview-omgevingen (een proefversie van je app) en automatische tests. De vraag is of die ook meegaan in de noodstop.
**Opties:**
- **A)** Ja, alles wat geld kost gaat uit: AI, previews én tests (aanbevolen)
- **B)** Alleen de AI-taken, previews en tests blijven draaien
- **C)** AI en previews uit, tests laten aflopen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Geparkeerd (gewijzigd 2026-06-22, was A) — budget-noodstop (AI/previews/tests uitzetten) niet nu; geen blokkeer-logica, alleen informatieve weergave

### G-20-1 — Terugspoelen bij een opgeruimde taak
**In één zin:** Wat zie je als je de tijdlijn terugspoelt voor een taak waarvan de machine al is opgeruimd?
**Wat het betekent:** Je kunt door de geschiedenis van een taak heen "scrubben" zoals bij een video. Maar sommige taken hebben geen opgeslagen tussenpunten, bijvoorbeeld omdat ze nooit code opleverden of al zijn opgeruimd. De vraag is wat de tijdlijn dan toont.
**Opties:**
- **A)** Een melding "geen tussenpunten beschikbaar voor deze taak" (aanbevolen)
- **B)** Alleen de tekst-gebeurtenissen zonder code-momenten
- **C)** De scrubber wordt voor zulke taken verborgen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Melding "geen tussenpunten beschikbaar"

### G-20-2 — Terugspoelen naar overschreven moment
**In één zin:** Toont de tijdlijn een oud moment dat later door GitLab is overschreven als een echt historisch punt?
**Wat het betekent:** GitLab is de externe bron die soms de waarheid overschrijft. Als je terugspoelt, kun je een moment tegenkomen dat sindsdien is veranderd. De vraag is of we dat eerlijk als "zo wás het toen" tonen, ook al klopt het niet meer met nu.
**Opties:**
- **A)** Ja, tonen als historisch moment met een label "later gewijzigd" (aanbevolen)
- **B)** Zulke achterhaalde momenten verbergen
- **C)** Het moment tonen zonder waarschuwing dat het is gewijzigd
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Tonen als historisch moment + "later gewijzigd"-label

### G-21-1 — Zoekbalk doorzoekt hoever
**In één zin:** Doorzoekt de zoekbalk echt alles wat je mag zien, of alleen wat nu toevallig is ingeladen?
**Wat het betekent:** Bovenin zit een snelzoeker. De vraag is of die ook oude taken vindt die nu niet op het scherm staan, of alleen het recente stukje. Anders mis je dingen bij het zoeken.
**Opties:**
- **A)** Doorzoekt alles waar je toegang toe hebt, ook oude items (aanbevolen)
- **B)** Alleen het al-ingeladen recente stukje
- **C)** Recent stukje direct, oudere items op aanvraag bijladen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Doorzoekt alles waar je toegang toe hebt

### G-21-2 — Zoekresultaten en leesrechten
**In één zin:** Worden zoekresultaten eerst gefilterd op wat jij mag zien, zodat er geen geheime info doorlekt?
**Wat het betekent:** De zoeker vindt taken én stukjes uit documenten. Sommige documenten mag niet iedereen zien. We willen voorkomen dat een zoekopdracht per ongeluk een fragment toont dat voor jou afgeschermd is.
**Opties:**
- **A)** Resultaten worden per persoon op leesrechten gefilterd vóór weergave (aanbevolen)
- **B)** Alles binnen de werkruimte is zichtbaar in de zoeker
- **C)** Documenten alleen tonen, taken altijd
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Resultaten vooraf op leesrechten gefilterd

### G-22-1 — Botsing tussen jouw wijziging en GitLab
**In één zin:** Hoe voorkomen we dat jouw wijziging een net-binnengekomen GitLab-wijziging overschrijft en een eindeloze loop start?
**Wat het betekent:** Het bord praat heen en weer met GitLab. Als jij iets aanpast op het moment dat GitLab ook iets stuurt, kunnen ze elkaar overschrijven, of zelfs een lus maken (jouw wijziging triggert GitLab, die triggert jou, enzovoort). Dat moet netjes geregeld worden.
**Opties:**
- **A)** Eigen wijzigingen markeren zodat ze geen lus veroorzaken (aanbevolen)
- **B)** Een slotje op de GitLab-versie zodat oudere niet kan overschrijven
- **C)** Alle wijzigingen één voor één in dezelfde rij verwerken
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eigen wijzigingen markeren tegen sync-lus

### G-22-2 — GitLab-issue verwijderd of verplaatst
**In één zin:** Wat gebeurt er met een taak als de bijbehorende GitLab-issue wordt verwijderd of naar een ander project verhuist?
**Wat het betekent:** Elke taak hangt aan een issue in GitLab. Als iemand die issue daar weggooit of verplaatst, weet onze taak niet meer waar hij bij hoort. En als de AI er net mee bezig was, moet ook dat netjes afgehandeld worden.
**Opties:**
- **A)** De taak wordt gearchiveerd (niet hard verwijderd) en lopend werk netjes gestopt (aanbevolen)
- **B)** De taak verdwijnt helemaal, net als in GitLab
- **C)** De taak blijft staan met een melding "losgekoppeld van GitLab"
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Taak archiveren, lopend werk netjes stoppen

### G-22-3 — Wegschrijven naar GitLab mislukt
**In één zin:** Als het bord een wijziging niet naar GitLab kan sturen, hoe zie je dan dat ze niet meer gelijk lopen?
**Wat het betekent:** Het bord stuurt jouw wijzigingen door naar GitLab. Soms lukt dat niet (verlopen toegang, GitLab plat). Dan loopt jouw bord voor op GitLab zonder dat je het merkt. De vraag is hoe we die scheefstand zichtbaar maken.
**Opties:**
- **A)** Een duidelijk waarschuwingsteken "niet gesynct met GitLab" met opnieuw-knop (aanbevolen)
- **B)** Automatisch opnieuw proberen tot het lukt, zonder melding
- **C)** De wijziging terugdraaien tot GitLab weer bereikbaar is
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Waarschuwing "niet gesynct" + opnieuw-knop

### G-23-1 — Wanneer telt een preview als "in gebruik"
**In één zin:** Blijft een proefversie van je app draaien zolang je hem echt gebruikt, of alleen als je op het knopje klikt?
**Wat het betekent:** Een preview is een tijdelijke live versie van je app om te bekijken. Hij gaat na 30 minuten uit om kosten te sparen. Maar als je hem op dat moment net zit te gebruiken, wil je niet dat hij plots verdwijnt. De vraag is hoe we "nog in gebruik" herkennen.
**Opties:**
- **A)** Echt gebruik van de preview houdt hem vanzelf aan (aanbevolen)
- **B)** Alleen een klik op het knopje verlengt hem
- **C)** De preview-pagina geeft zelf elke paar minuten een levensteken
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Echt gebruik houdt preview vanzelf aan

### G-23-2 — Preview wijst naar oude code
**In één zin:** Wat gebeurt er met een live preview als de taak gepauzeerd wordt of de code intussen verder is gegaan?
**Wat het betekent:** Een preview is gekoppeld aan een bepaald moment in de code. Als de taak wordt stilgelegd of er nieuwe code bijkomt, kan de preview-link naar verouderde of verdwenen code wijzen. De vraag is hoe we dat afhandelen.
**Opties:**
- **A)** De preview blijft op het bevroren moment staan, met een "verouderd"-label (aanbevolen)
- **B)** De preview gaat uit zodra de taak pauzeert of de code verschuift
- **C)** De preview werkt automatisch mee naar de nieuwste code
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Preview bevroren op moment + "verouderd"-label

### G-23-3 — Wachtrij voor previews
**In één zin:** In welke volgorde komen wachtende previews aan de beurt, en kun je je eigen wachtende verzoek annuleren?
**Wat het betekent:** Er kunnen maar zoveel previews tegelijk draaien, dus de rest staat in de wacht. De vraag is wie er eerst aan de beurt is, wat er gebeurt als je te lang wacht, en of je je plek in de rij kunt opgeven.
**Opties:**
- **A)** Eerst-binnen-eerst-aan-de-beurt, met een annuleerknop (aanbevolen)
- **B)** Wie het meest urgente werk heeft, gaat voor
- **C)** Geen wachtrij: vol is vol, probeer later opnieuw
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eerst-binnen-eerst, met annuleerknop

### G-24-1 — Hervatten na automatische opruiming
**In één zin:** Wat doet de "Hervatten"-knop als de machine al automatisch was opgeruimd wegens stilte?
**Wat het betekent:** Je kunt een gepauzeerde taak hervatten. Maar als de machine intussen is opgeruimd om kosten te sparen, kun je niet zomaar verder waar je was. De vraag is of de knop dan een foutmelding geeft of gewoon stilletjes alles opnieuw opstart.
**Opties:**
- **A)** De knop start alles netjes opnieuw op, zonder gedoe voor jou (aanbevolen)
- **B)** Je krijgt eerst een melding "moet opnieuw opstarten — doorgaan?"
- **C)** Een foutmelding dat hervatten niet meer kan
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** B — Eerst melding "moet opnieuw opstarten — doorgaan?" (keuze-op-moment)

### G-24-2 — Noodknop pakt ook net-gestarte taken
**In één zin:** Stopt de "pauzeer alles"-noodknop ook taken die net beginnen terwijl hij bezig is?
**Wat het betekent:** De noodknop legt alle AI-taken één voor één stil. Maar dat kost even tijd, en in die tussentijd kan er net een nieuwe taak opstarten die dan ontsnapt. Omdat het een noodrem is, wil je dat echt alles stopt.
**Opties:**
- **A)** Eerst een "geen nieuwe starts"-slot, dan alles stilleggen (aanbevolen)
- **B)** Alleen de taken die er bij aanvang al waren
- **C)** Blijven herhalen tot er echt niks meer draait
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eerst "geen nieuwe starts"-slot, dan alles stil

### G-24-3 — Taak afbreken raakt preview en terminals
**In één zin:** Als je een taak helemaal afbreekt, gaan dan ook de gekoppelde preview en andermans open terminals dicht?
**Wat het betekent:** Bij het afbreken van een taak wordt de machine opgeruimd. Daaraan kunnen een live preview en terminals van collega's vasthangen. De vraag is of die meegaan en met welke melding die mensen dat te horen krijgen.
**Opties:**
- **A)** Preview en terminals gaan mee dicht, met een duidelijke melding aan de gebruikers (aanbevolen)
- **B)** Alleen de taak stopt, preview en terminals blijven nog even
- **C)** Eerst vragen of er nog iemand in de terminal zit
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Preview + terminals dicht, met duidelijke melding

---

## 6. Code-samenvoegen, testen, push & extra features

### G-FORGE-1 — Oude reviews na verhuizing
**In één zin:** Wat doen we met de reviews en goedkeuringen die bij ons opgeslagen zaten, als een team later overstapt naar GitHub/GitLab?
**Wat het betekent:** Eerst leefden de code-reviews bij ons in huis. Stapt iemand later over naar een externe plek zoals GitHub, dan is er daar geen plek om die oude reviews heen te kopiëren. Net als verhuizen naar een huis zonder kelder: waar laat je de dozen met oude spullen?
**Opties:**
- **A)** De oude reviews blijven bij ons staan als alleen-lezen archief (aanbevolen)
- **B)** Exporteren naar de nieuwe plek waar dat technisch kan, anders bevriezen
- **C)** Oude reviews gewoon weggooien bij de overstap
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Oude reviews als alleen-lezen archief bij ons

### G-FORGE-2 — Wie heeft gelijk bij conflict
**In één zin:** Als onze eigen status van een code-samenvoeging botst met wat GitHub doorgeeft, wie wint er dan?
**Wat het betekent:** We onthouden zelf alvast wat we denken dat er gebeurt ("dit is goedgekeurd"), maar GitHub kan iets anders melden ("nog open"). Dan moet duidelijk zijn welke versie waar is. Zoals twee agenda's die niet kloppen: welke geloof je?
**Opties:**
- **A)** GitHub/GitLab wint altijd, ook over onze eigen onthouden status (aanbevolen)
- **B)** Een aparte regel speciaal voor samenvoegingen, los van andere zaken
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — GitHub/GitLab wint altijd over eigen status

### G-MR-1 — Volgorde van opslaan
**In één zin:** Slaan we een review-bericht eerst bij onszelf op of eerst bij GitHub, en wat als die tweede stap mislukt?
**Wat het betekent:** Een review-opmerking moet op twee plekken landen: bij ons en bij GitHub. Mislukt de tweede helft, dan klopt het niet meer met elkaar. Zoals een brief die je in twee postbussen wilt: wat als de tweede vol zit?
**Opties:**
- **A)** Onze eigen kopie is altijd de baas, GitHub krijgt bewust een losse link (aanbevolen)
- **B)** We slaan pas bij onszelf op nadat GitHub het bevestigd heeft
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eigen kopie is baas, GitHub krijgt losse link

### G-MR-2 — Wat met openstaande samenvoeging
**In één zin:** Wat gebeurt er met een nog-niet-samengevoegd stuk werk als de hele taak wordt stopgezet?
**Wat het betekent:** Een taak kan tussentijds gekild worden terwijl er nog een openstaand voorstel hangt om code samen te voegen. Blijft dat eeuwig hangen, of ruimen we het op? Zoals een bestelling annuleren terwijl het pakket al onderweg is.
**Opties:**
- **A)** Bij stopzetten sluit het systeem de gekoppelde openstaande voorstellen netjes af + noteert het in het logboek (aanbevolen)
- **B)** Het voorstel blijft openstaan omdat de code-tak ook blijft bestaan
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Bij stopzetten voorstellen netjes sluiten + loggen

### G-MR-3 — Samenvoegen zonder goedkeuring
**In één zin:** Hoe komt een stuk werk dat "0 mensen hoeven goed te keuren" toch in de status "goedgekeurd"?
**Wat het betekent:** Soms staat ingesteld dat code helemaal automatisch zonder mens mag worden samengevoegd. Maar de normale weg naar "goedgekeurd" wacht juist op een menselijke klik die er nu niet is. Wie zet dan het stoplicht op groen?
**Opties:**
- **A)** Het systeem checkt zelf direct of de tests groen zijn en voegt dan samen, zonder goedkeur-stap (aanbevolen)
- **B)** De automatische modus slaat "goedgekeurd" helemaal over en voegt samen zodra de tests slagen
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Systeem checkt tests groen, voegt dan samen

### G-CI-1 — Nieuwe code tijdens lopende test
**In één zin:** Wat doen we als er nieuwe code binnenkomt terwijl de automatische test van de vorige versie nog draait?
**Wat het betekent:** Het systeem test code automatisch voordat die wordt samengevoegd. Komt er een nieuwe versie binnen terwijl de test nog bezig is, dan kun je beide laten draaien of de oude afbreken. Zoals je oven uitzetten als je toch een ander recept gaat maken.
**Opties:**
- **A)** De nieuwe versie breekt de oude lopende test direct af (aanbevolen)
- **B)** Eén test tegelijk, de nieuwe versie wacht in de rij
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Nieuwe versie breekt oude lopende test af

### G-CI-2 — Verloren testbericht
**In één zin:** Wat doet de poort als het bericht "test geslaagd" nooit aankomt of zoekraakt?
**Wat het betekent:** Voordat code wordt samengevoegd checkt een poort of de test geslaagd is. Maar als het bericht over die test verloren gaat, ziet de poort "geen uitslag". Dan moet je kiezen: wachten/blokkeren, of zelf gaan navragen. Zoals wachten op een pakketbezorging waarvan de track-en-trace stilvalt.
**Opties:**
- **A)** De poort eist een duidelijke "geslaagd" en blokkeert anders (veilig dicht) (aanbevolen)
- **B)** Het systeem vraagt zelf actief de uitslag op bij GitHub
- **C)** Na een tijdje vragen om menselijke hulp
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Poort eist "geslaagd", blokkeert anders (veilig dicht)

### G-GIT-1 — Volgorde bij automatisch samenvoegen
**In één zin:** Wie bepaalt de volgorde van samenvoegen als er geen mens meer op de knop drukt?
**Wat het betekent:** Normaal bepaalt de volgorde waarin mensen klikken wie eerst wordt samengevoegd. In de volautomatische modus is er geen klik, maar meerdere stukken zijn tegelijk klaar. Iets moet de rij bepalen, anders botsen ze. Zoals een kruispunt zonder verkeerslicht.
**Opties:**
- **A)** Op volgorde van wanneer de test groen werd, één voor één (aanbevolen)
- **B)** Dezelfde prioriteit-kiezer gebruiken als elders in het systeem
- **C)** Oudste voorstel eerst
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Samenvoegen op volgorde van wanneer test groen werd

### G-GIT-2 — Terugdraaien dat misgaat
**In één zin:** Wat doen we als het terugdraaien van een foute wijziging zelf botst, en mag dat terugdraaien per ongeluk ook automatisch doorgaan?
**Wat het betekent:** Soms moet je een eerder samengevoegde wijziging ongedaan maken (terugdraaien). Maar dat kan zelf vastlopen, en in de volautomatische modus zou het terugdraaien per ongeluk óók automatisch kunnen worden samengevoegd. Dat ondermijnt juist de noodrem.
**Opties:**
- **A)** Terugdraai-acties worden altijd uitgezonderd van automatisch samenvoegen (aanbevolen)
- **B)** Een terugdraaiing die vastloopt vraagt direct om menselijke hulp
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Terugdraai-acties altijd uitgezonderd van auto-merge

### G-AIQ-1 — Vasthouden aan de proefopzet
**In één zin:** Houdt een taak dezelfde testvariant vast nadat het experiment al is afgelopen?
**Wat het betekent:** Het systeem kan twee versies van een aanpak vergelijken (een A/B-test) en kent elke taak een vaste variant toe. Loopt het experiment af terwijl een taak nog bezig is, dan is de vraag of die taak zijn variant houdt of overspringt. Anders worden de meetresultaten rommelig.
**Opties:**
- **A)** De taak houdt zijn variant tot hij helemaal klaar is (aanbevolen)
- **B)** Het einde van de test stopt nieuwe toewijzingen, lopende taken houden hun variant
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Taak houdt test-variant tot helemaal klaar

### G-AIQ-2 — Oude opnames blijven groen
**In één zin:** Hoe voorkomen we dat oude opgenomen testritten "geslaagd" blijven melden terwijl de AI-software intussen veranderd is?
**Wat het betekent:** Om snel te testen speelt het systeem oude opgenomen sessies opnieuw af. Maar als de onderliggende AI-versie verandert, kan die oude opname onterecht "alles goed" blijven roepen en zo een echt probleem verbergen. Zoals een oude foto gebruiken om te checken hoe iemand er nú uitziet.
**Opties:**
- **A)** Opnames onthouden welke AI-versie ze gebruikten en falen luid bij een verschil (aanbevolen)
- **B)** Bij elke AI-versie-update verplicht eerst opnieuw opnemen voordat samenvoegen mag
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Opnames onthouden AI-versie, falen luid bij verschil

### G-CLIENT-1 — Knop al door ander gebruikt
**In één zin:** Toont de "Goedkeuren"-knop op je telefoon nog de oude vraag als iemand anders die intussen al beantwoord heeft?
**Wat het betekent:** Je krijgt een melding met een snelle Goedkeuren-knop. Maar tussen het verschijnen en jouw klik kan een collega de vraag al beantwoord hebben. Dan moet je niet per ongeluk dubbel antwoorden. Zoals twee mensen die tegelijk dezelfde laatste kaartjes willen kopen.
**Opties:**
- **A)** Bij het openen haalt de app de verse stand op en toont "al beantwoord door X" (aanbevolen)
- **B)** Je klik mislukt netjes met dezelfde melding, zonder schade
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — App haalt verse stand, toont "al beantwoord door X"

### G-CLIENT-2 — Nieuwe meldingstypes routeren
**In één zin:** Via welk kanaal (telefoon-melding of alleen in de app) gaan de nieuwe soorten meldingen die er later bij kwamen?
**Wat het betekent:** Het systeem kende vier soorten meldingen met elk een vaste route. Er kwamen nieuwe soorten bij (bijv. "automatisering mislukt"), maar voor die nieuwe is niet bepaald of ze naar je telefoon mogen pushen of alleen in de app blijven. Anders krijg je per ongeluk te veel of te weinig meldingen.
**Opties:**
- **A)** Elke nieuwe soort krijgt expliciet zijn eigen kanaal-instelling (aanbevolen)
- **B)** Onbekende soorten blijven standaard alleen in de app
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Elke nieuwe meldingssoort krijgt eigen kanaal-instelling

### G-INSTALL-1 — Sleutels na herstel uit back-up
**In één zin:** Blijven de telefoon-meldingen werken na een herstel uit back-up, of raken alle aanmeldingen onbruikbaar door een andere sleutel?
**Wat het betekent:** Voor telefoon-meldingen heeft het systeem een geheime sleutel. Die zit niet in de gewone back-up. Herstel je alles met een nieuwe sleutel, dan passen de oude meldings-aanmeldingen niet meer. Zoals je sloten vervangen maar vergeten nieuwe sleutels aan de bewoners te geven.
**Opties:**
- **A)** De meldings-sleutel gaat mee in de back-upset (aanbevolen)
- **B)** Na herstel een stap die niet-passende aanmeldingen opruimt
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Meldings-sleutel gaat mee in back-upset

### G-INSTALL-2 — Opschalen na installatie
**In één zin:** Hoe stap je na de installatie van de kleine opzet naar de volledige opzet zonder bestaande projecten te breken?
**Wat het betekent:** Je kunt klein beginnen (code leeft op een externe plek zoals GitHub) of vol (eigen code-server erbij). Later willen opschalen mag de al draaiende projecten niet stuk maken. Zoals een verbouwing terwijl het huis bewoond blijft.
**Opties:**
- **A)** De volledige opzet draait altijd alle diensten; per project blijft instelbaar waar de code leeft (aanbevolen)
- **B)** Een duidelijk stappenplan (runbook) voor het opwaarderen
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Volledige opzet draait alles; per project instelbaar

### G-TRUST-1 — Logboek bij automatisch samenvoegen
**In één zin:** Schrijven we in het logboek wie/wat een volautomatische samenvoeging deed, ook al was er geen mens bij?
**Wat het betekent:** Het logboek moet later de vraag kunnen beantwoorden "wie keurde de wijziging goed die misging?". Bij volautomatisch samenvoegen is er geen menselijke goedkeurder, dus moet het systeem zelf netjes noteren dat het automatisch ging en wie dat had aangezet.
**Opties:**
- **A)** Het systeem noteert de actie als "samengevoegd door systeem" met het autonomie-niveau en wie het aanzette (aanbevolen)
- **B)** Een aparte logboek-actie speciaal voor automatisch samenvoegen
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — "Samengevoegd door systeem" + autonomie-niveau + wie aanzette

### G-TRUST-2 — Losse instelling versus algemene
**In één zin:** Wat gebeurt er met een strengere instelling voor één taak als je daarna de algemene instelling losser of strenger maakt?
**Wat het betekent:** Je kunt per taak instellen dat het systeem minder zelfstandig mag handelen dan normaal. De regel is "alleen strenger, nooit losser". Maar als je later de algemene instelling aanpast, kan die losse instelling per ongeluk juist losser blijken. Dat mag niet de bedoeling zijn.
**Opties:**
- **A)** Het systeem neemt altijd de strengste van de twee instellingen (aanbevolen)
- **B)** Een algemene wijziging wist losse instellingen die niet meer strenger zijn
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Systeem neemt altijd de strengste instelling

### G-ANALYTICS-1 — Kosten bij prijswijziging
**In één zin:** Blijven de kostencijfers per taak kloppen als de prijs of het tarief midden in de periode verandert?
**Wat het betekent:** Kosten worden berekend met het huidige tarief. Verandert dat tarief halverwege, dan wordt opeens de hele oude historie herberekend tegen het nieuwe tarief. Zoals je oude tankbeurten opnieuw berekenen met de benzineprijs van vandaag — dat klopt niet meer.
**Opties:**
- **A)** Elk kostenrecord legt de prijs van dat moment vast, zodat historie blijft kloppen (aanbevolen)
- **B)** We accepteren dat oude cijfers meeveranderen en leggen dat duidelijk uit
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Elk kostenrecord legt prijs van dat moment vast

### G-ANALYTICS-2 — Tellen na terugdraaien
**In één zin:** Telt een taak die later is teruggedraaid nog mee als "afgerond" in de statistieken?
**Wat het betekent:** De statistieken markeren een taak als klaar zodra de code is samengevoegd. Maar een terugdraaiing maakt óók zo'n samenvoeg-moment, dus een fout plus de terugdraaiing telt per ongeluk als twee keer klaar. Zoals een verkoop én de retour allebei als omzet tellen.
**Opties:**
- **A)** Terugdraai-samenvoegingen tellen niet mee en gelden als negatief signaal (aanbevolen)
- **B)** Een terugdraaiing haalt de oorspronkelijke "afgerond" weer weg
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Terugdraai-merges tellen niet, gelden als negatief signaal

### G-ONBOARD-1 — Concept versus automatisch opslaan
**In één zin:** Botst een nog-niet-opgeslagen concept van de inwerk-helper met de regel die elke stap automatisch vastlegt?
**Wat het betekent:** De inwerk-helper houdt zijn werk bewust als concept tot iemand het goedkeurt. Maar een andere regel legt elke stap automatisch vast. Die twee spreken elkaar tegen: het concept wordt dan te vroeg definitief opgeslagen.
**Opties:**
- **A)** De inwerk-helper wordt uitgezonderd van het automatisch vastleggen per stap (aanbevolen)
- **B)** Het concept gaat naar een aparte plek die bij goedkeuring wordt overschreven
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Inwerk-helper uitgezonderd van auto-vastleggen per stap

### G-FORENSIC-1 — Wisselvallige tests herkennen
**In één zin:** Hoe herkennen we een onbetrouwbare test als de code-stempel telkens verandert tussen herhaalde pogingen?
**Wat het betekent:** Een test die soms slaagt en soms faalt (wisselvallig) herken je door dezelfde code twee keer te draaien. Maar als die code bij elke nieuwe poging een nieuwe stempel krijgt, kun je de twee ritten niet meer vergelijken en mis je het signaal. Zoals dezelfde vraag stellen maar telkens een ander vraagnummer geven.
**Opties:**
- **A)** Wisselvalligheid herkennen op een vaste, logische naam van de stap in plaats van de wisselende stempel (aanbevolen)
- **B)** Apart bijhouden welke ritten echte herhalingen zijn, los van de code-stempel
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Wisselvalligheid herkennen op vaste stap-naam

### G-SCHED-1 — Voorrang versus budgetslot
**In één zin:** Als het budget op slot zit, mag een spoedklus dan toch nog door?
**Wat het betekent:** Twee regels werken tegelijk: één bepaalt de voorrang van klussen, de andere zet alles op slot als het budget op is. Onduidelijk is welke eerst geldt en of een spoedklus dat budgetslot mag negeren. Zoals een spoedpatiënt in een volle wachtkamer: voorrang of toch wachten?
**Opties:**
- **A)** Het budgetslot filtert eerst, daarna pas de voorrang-kiezer (aanbevolen)
- **B)** Spoedklussen krijgen een uitzondering op het budgetslot
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Geparkeerd (2026-06-22) — samen met de token-/budget-blokkering; geen budgetslot om voorrang tegen af te wegen tot die logica ontworpen is

### G-QUOTA-1 — Gedeeld budget, andere grenzen
**In één zin:** Wat gebeurt er bij één gedeelde budgetmeter als projecten verschillende stop-grenzen hebben?
**Wat het betekent:** Alle projecten delen één budgetmeter, maar elk project mag een eigen grens hebben waarop het pauzeert. Een project met een lage grens pauzeert vroeg, terwijl een project met een hoge grens de pot blijft leegmaken. Dan is er geen eerlijke verdeling.
**Opties:**
- **A)** We accepteren en documenteren dat lage-grens-projecten eerder en langer pauzeren (aanbevolen)
- **B)** Een gezamenlijke minimum-grens los van de per-project-grenzen
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Geparkeerd (gewijzigd 2026-06-22, was A) — gedeeld-budget pauzeer-gedrag niet nu (onderdeel van de token-blokkering-parkering); alleen informatieve verbruik-weergave, geen blokkade

### G-PRESENCE-1 — Wie-het-eerst-antwoordt
**In één zin:** Is de echte bescherming tegen dubbele antwoorden de statuscheck van het systeem, en niet het per-apparaat-kenmerk?
**Wat het betekent:** Als meerdere mensen tegelijk een vraag kunnen beantwoorden, moet "wie het eerst is wint" gegarandeerd zijn. De documentatie haalt twee mechanismen door elkaar: een per-apparaat-kenmerk (dat alleen dubbele klikken van dezelfde persoon tegenhoudt) en de echte statuscheck. We moeten benoemen welke de juiste is.
**Opties:**
- **A)** Verduidelijken: de statuscheck is de echte bescherming tussen mensen, het per-apparaat-kenmerk stopt alleen dubbelklik van dezelfde persoon (aanbevolen)
- **B)** Een aparte server-bescherming op het vraag-nummer, los van het apparaat-kenmerk
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Statuscheck is echte bescherming tegen dubbel antwoord

### G-NOTIF-1 — Algemene instelling zonder project
**In één zin:** Hoe slaat het systeem een instelling op die voor álle projecten geldt, terwijl de regel altijd een project eist?
**Wat het betekent:** Sommige meldings-voorkeuren gelden niet voor één project maar voor alles. De kernregel eist echter altijd dat je een project meegeeft, anders loopt het vast. Voor deze algemene instellingen is een uitzondering nodig. Zoals een instelling die voor het hele gebouw geldt, niet per kamer.
**Opties:**
- **A)** Een goedgekeurd "geldt-voor-alles"-pad, net als al bestaat voor meldings-aanmeldingen (aanbevolen)
- **B)** Deze instelling draait onder een neutrale systeem-modus zonder project
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Goedgekeurd "geldt-voor-alles"-pad zoals bij aanmeldingen

### G-TIER2-1 — Wie beheert de nieuwe gebeurtenissen
**In één zin:** Welk onderdeel is eigenaar van de nieuwe gebeurtenis-meldingen waar een ander onderdeel op leunt?
**Wat het betekent:** Een onderdeel heeft bepaalde gebeurtenis-meldingen nodig (bijv. "automatisering mislukt", "iemand bewerkte iets"), maar nergens staat wie die meldingen maakt en beheert. Zonder duidelijke eigenaar weet niemand wie ze onderhoudt. Zoals een gedeelde tuin waarvan niemand weet wie hem maait.
**Opties:**
- **A)** De gebeurtenis-motor toewijzen aan een vast onderdeel (waarschijnlijk de automatiserings-laag) (aanbevolen)
- **B)** Deze nieuwe gebeurtenissen tot een eigen, apart genummerd onderdeel maken
- **C)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Gebeurtenis-motor toewijzen aan automatiserings-laag

---

## 7. Extra mini-apps (tool-modules)

### G-FW-1 — Wie ziet welke mini-app

**In één zin:** Mag je per persoon of per rol instellen wie een extra mini-app in de zijbalk te zien krijgt, of geldt het voor de hele werkruimte tegelijk?
**Wat het betekent:** Je kunt extra mini-apps (zoals een Interviewer of een Designer) aanzetten. De vraag is hoe fijn je dat kunt regelen. Vergelijk het met een gedeeld kantoor: zet je een tool aan voor iedereen, of mag de baas zeggen "alleen het ontwerpteam ziet de Designer"?
**Opties:**
- **A)** Alleen aan/uit voor de hele werkruimte (aanbevolen)
- **B)** Ook per rol kunnen kiezen (bijv. alleen ontwerpers)
- **C)** Ook elke persoon laten zelf verbergen wat ze niet willen zien
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Aan/uit per hele werkruimte (eenvoud op accountniveau)

### G-FW-2 — Wat als je mini-app uitzet

**In één zin:** Wat gebeurt er met de bestanden en koppelingen die een mini-app gemaakt heeft als je die mini-app weer uitschakelt?
**Wat het betekent:** Een mini-app maakt resultaten (we noemen die "artifacts", dus gemaakte bestanden/resultaten) en die hangen soms vast aan lopend werk. Zet je de mini-app uit, dan is de vraag: verdwijnt alles, of blijft het bewaard? Net als een app van je telefoon halen terwijl er nog foto's in staan.
**Opties:**
- **A)** Uitzetten verbergt alleen de mini-app; gemaakte bestanden en koppelingen blijven leesbaar (aanbevolen)
- **B)** Uitzetten mag niet zolang er nog actief werk aan vasthangt
- **C)** Alles netjes archiveren zodat je het later kunt terughalen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Uitzetten verbergt alleen; artifacts blijven leesbaar

### G-FW-3 — Waar bestanden worden bewaard

**In één zin:** Waar worden de bestanden die mini-apps maken opgeslagen, en geldt er een maximum aan opslagruimte?
**Wat het betekent:** Mini-apps maken bestanden zoals schermafbeeldingen of interview-resultaten. Die moeten ergens staan. De vraag is of alles in dezelfde opslagkast gaat of in aparte kasten, en of er een limiet komt. Net als kiezen of al je foto's en documenten in één map staan of netjes apart.
**Opties:**
- **A)** Alle mini-apps gebruiken dezelfde gedeelde opslag (aanbevolen)
- **B)** Twee aparte opslagplekken met een duidelijke grens
- **C)** Nu al een maximum aan ruimte vastleggen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén gedeelde opslag voor alle mini-apps

### G-FW-4 — Volgorde van mini-apps in zijbalk

**In één zin:** Krijgt elke mini-app een eigen knop in de zijbalk, en hoe houd je het overzichtelijk als er vijf of meer aanstaan?
**Wat het betekent:** Elke ingeschakelde mini-app komt als knop in het menu links. Bij veel mini-apps wordt dat menu vol. De vraag is hoe je dat ordent. Net als de apps op je telefoon: op alfabet, in een mapje "Tools", of zelf slepen?
**Opties:**
- **A)** Vaste volgorde die het systeem bepaalt (aanbevolen)
- **B)** Bij veel tools alles in één "Tools"-mapje stoppen
- **C)** De gebruiker mag zelf de volgorde slepen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Vaste systeem-bepaalde volgorde in zijbalk

### G-FW-5 — Eén soort map of meerdere

**In één zin:** Gebruiken alle mini-apps hetzelfde soort mappen om hun bestanden in te ordenen, of heeft elke mini-app z'n eigen mappensysteem?
**Wat het betekent:** Net als op je computer wil je je werk in mappen ordenen. Nu heeft de ene mini-app z'n eigen mappen en de andere weer iets anders, wat verwarrend is. De vraag is of we dat gelijktrekken. Eén universeel mappensysteem of per mini-app iets eigens.
**Opties:**
- **A)** Eén gedeeld mappensysteem voor alle mini-apps (aanbevolen)
- **B)** Elke mini-app houdt z'n eigen mappensysteem
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén gedeeld mappensysteem voor alle mini-apps

### G-FW-6 — Eén opslag voor alle resultaten

**In één zin:** Bewaren alle mini-apps hun resultaten in één gedeelde bak, of houdt elke mini-app z'n eigen aparte bak bij?
**Wat het betekent:** De gemaakte bestanden van mini-apps (de "artifacts") moeten ergens samenkomen, bijvoorbeeld zodat je ze makkelijk kunt terugvinden in een kiezer. De vraag is of alles in één lijst staat of per mini-app apart. Net als alle downloads in één map versus per programma een eigen map.
**Opties:**
- **A)** Alles in één gedeelde bak met een label per mini-app (aanbevolen)
- **B)** Elke mini-app houdt z'n eigen bak, met een gedeeld overzicht erbovenop
- **C)** Gedeeld voor het overzicht, eigen bak voor de details
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén gedeelde bak met label per mini-app

### G-INT-1 — Vragen beantwoorden tijdens pauze

**In één zin:** Mag je een openstaande interviewvraag los uit de wachtrij beantwoorden, en wat gebeurt er als het interview op pauze staat?
**Wat het betekent:** De Interviewer is een mini-app die je vragen stelt om je idee scherp te krijgen. Vragen kunnen één voor één komen of op een stapeltje in een wachtrij. De vraag is of je vrij uit dat stapeltje mag plukken, en of dat ook kan terwijl je het interview even hebt gepauzeerd.
**Opties:**
- **A)** Je mag vragen vrij uit de wachtrij beantwoorden, ook tijdens pauze (aanbevolen)
- **B)** Alleen netjes één voor één, niet tijdens pauze
- **C)** Tijdens pauze niets, daarna weer vrij kiezen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Vragen vrij uit wachtrij, ook tijdens pauze

### G-INT-2 — Welke statussen een interview heeft

**In één zin:** Welke vaste set toestanden (bezig, open, beantwoord, mislukt, gepauzeerd) mag een interviewsessie hebben?
**Wat het betekent:** Een interview kan in verschillende toestanden zijn, zoals "bezig", "klaar" of "gepauzeerd". Nu staan er op verschillende plekken verschillende lijstjes, wat verwarrend is voor de bouwer. We moeten één duidelijke lijst kiezen. Net als de bezorgstatus van een pakket: er moet één heldere set zijn.
**Opties:**
- **A)** Eén opgeschoonde lijst: bezig, open, beantwoord, gepauzeerd, mislukt (aanbevolen)
- **B)** Een kortere minimale lijst met alleen het hoogstnodige
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén opgeschoonde statuslijst (vijf toestanden)

### G-INT-3 — Hoe ver gaat de Interviewer

**In één zin:** Levert de Interviewer alleen losse vraagkaartjes, of bouwt hij door naar een volledig plan en kant-en-klare taken?
**Wat het betekent:** De Interviewer stelt vragen, maar er was een idee om hem verder te laten gaan: van vragen naar een uitgewerkt plan naar concrete taken. De vraag is of we die hele keten willen, of dat de Interviewer stopt bij de antwoorden. Vergelijk: alleen een boodschappenlijst, of meteen ook het recept en de bestelling.
**Opties:**
- **A)** Alleen losse vraagkaartjes, daar stopt het voor nu (aanbevolen)
- **B)** Doorbouwen naar een uitgewerkt plan
- **C)** Helemaal door naar concrete, klaargezette taken
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** B — Interviewer plant ook hele nieuwe features uit (niet alleen vragen beantwoorden)

### G-DSGN-1 — Wie draait de ontwerp-voorvertoning

**In één zin:** Wie zorgt voor de altijd-aan-server die ontwerp-voorvertoningen toont, en wat gebeurt er als die server even plat ligt?
**Wat het betekent:** De Designer (een ontwerp-studio als mini-app) laat live zien hoe een ontwerp eruitziet. Daar is een server voor nodig die altijd aanstaat. De vraag is wie die draait en betaalt, en wat er gebeurt als hij hapert. Net als een etalage die altijd verlicht moet zijn: wie betaalt de stroom?
**Opties:**
- **A)** Eén gedeelde server voor het hele systeem (aanbevolen)
- **B)** Elke werkruimte krijgt z'n eigen voorvertoning-server
- **C)** Alleen aanzetten op het moment dat je hem nodig hebt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén gedeelde voorvertoning-server voor systeem

### G-DSGN-2 — Door-AI-gemaakte code veilig tonen

**In één zin:** Hoe tonen we de door-AI-gemaakte ontwerpcode veilig, zonder dat die code iets stuks of geheims kan misbruiken?
**Wat het betekent:** De Designer laat de AI ontwerpcode schrijven en die wordt direct getoond. Die code is niet door een mens nagekeken, dus we moeten voorkomen dat hij kwaad kan. Net als een onbekend bestand openen in een veilige afgeschermde ruimte zodat het de rest van je computer niet raakt.
**Opties:**
- **A)** De code in een streng afgeschermde "veilige box" draaien (aanbevolen)
- **B)** Eerst een mens laten goedkeuren voordat het getoond wordt
- **C)** Allebei: afgeschermd draaien én goedkeuring vereisen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** C — Afgeschermd draaien én goedkeuring (veiligheid hoog)

### G-DSGN-3 — Aparte tekst-studio of niet

**In één zin:** Komt er een aparte studio om alle teksten en knoplabels in een ontwerp te beheren, of zit dat gewoon bij de Designer in?
**Wat het betekent:** Een ontwerp bevat teksten zoals knoppen en koppen. Er was een idee voor een aparte "tekst-studio" om die netjes te beheren (en in meerdere talen). De vraag is of dat een eigen mini-app wordt, onderdeel van de Designer, of dat we het schrappen. Net als kiezen of het schrijven van de teksten een apart vak is of het werk van de ontwerper.
**Opties:**
- **A)** Onderdeel van de Designer, geen aparte tool (aanbevolen)
- **B)** Een eigen aparte tekst-mini-app
- **C)** Voorlopig schrappen, later misschien
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Tekstbeheer in Designer, geen aparte Copy-tool

### G-DSGN-4 — Kleuren samen wijzigen

**In één zin:** Als je een kleur in het ontwerp aanpast, passen de bijbehorende varianten (zoals donkere modus en hover-kleuren) dan automatisch mee aan?
**Wat het betekent:** Een kleur heeft vaak familieleden: een variant voor donkere modus, een iets andere tint als je er met de muis overheen gaat, enzovoort. Als je er één wijzigt maar de rest niet, wordt het palet rommelig. De vraag is of die samen meebewegen. Net als één verfkleur kiezen en willen dat alle bijpassende tinten kloppen.
**Opties:**
- **A)** Bij elkaar horende kleuren passen automatisch samen mee (aanbevolen)
- **B)** Alleen de ene kleur wijzigen, de rest doe je zelf
- **C)** Voorstel tonen voor de hele kleurfamilie, jij bevestigt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Kleurvarianten passen automatisch samen mee

### G-MKT-1 — Vaardigheid voor twee tools tegelijk

**In één zin:** Kan een opgeslagen "vaardigheid" (bijv. een merkstijl) voor zowel de Marketing-tool als de Designer gebruikt worden, of hoort die maar bij één?
**Wat het betekent:** Je kunt de AI dingen aanleren via "skills", bijvoorbeeld jouw huisstijl. Zo'n merkstijl is logisch nuttig voor zowel marketing als ontwerp. De vraag is of één vaardigheid door beide tools gedeeld mag worden, of dat hij aan één tool vastzit. Net als één receptenboek dat zowel de bakker als de kok mag gebruiken.
**Opties:**
- **A)** Een vaardigheid kan voor meerdere tools tegelijk gelden (aanbevolen)
- **B)** Een vaardigheid hoort bij precies één tool
- **C)** Een speciale "merk"-vaardigheid die beide tools mogen lezen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Vaardigheid bruikbaar voor meerdere tools tegelijk

### G-MKT-2 — Centrale merk-bibliotheek

**In één zin:** Komt er één centrale plek met al je merkgegevens (logo, kleuren, stijl) die zowel ontwerp als marketing gebruiken, of blijft dat verspreid?
**Wat het betekent:** Je merk bestaat uit logo, kleuren, lettertypes en toon. Nu zit die info versnipperd op losse plekken. Het idee is één "Brand Kit": één bibliotheek waar alles staat zodat alle tools dezelfde stijl pakken. Net als één map met al je huisstijl-spullen in plaats van het overal moeten zoeken.
**Opties:**
- **A)** Eén centrale merk-bibliotheek die alle tools gebruiken (aanbevolen)
- **B)** Een gedeelde "merk"-vaardigheid die beide tools lezen
- **C)** Niets centraals, het blijft per tool los
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén centrale merk-bibliotheek voor alle tools

### G-MKT-3 — Kosten van beeld-generatie

**In één zin:** Hoe worden de extra kosten van het laten maken van beelden (via een betaalde externe dienst) afgerekend en begrensd?
**Wat het betekent:** De meeste dingen vallen onder je vaste abonnement, maar beelden laten genereren kost per stuk geld bij een externe dienst. De vraag is hoe we die losse kosten doorberekenen en of er een plafond komt. Net als bellen in je abonnement, maar dataroaming kost ineens extra per MB.
**Opties:**
- **A)** Doorberekenen per gebruik, met een instelbaar maximum (aanbevolen)
- **B)** In het vaste abonnement stoppen met een vaste limiet
- **C)** De gebruiker betaalt rechtstreeks z'n eigen externe dienst
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** Eigen — GEEN billing/payments in het project; alle AI-kosten lopen via subscription of eigen API-key

### G-MKT-4 — Mappenlimiet voor marketing

**In één zin:** Geldt voor de Marketing-tool dezelfde mappenlimiet als de rest, of mag die afwijken?
**Wat het betekent:** Er was afgesproken dat mappen maximaal vijf lagen diep mogen, maar de Marketing-tool gebruikt nu een eigen, afwijkende regel zonder dat limiet. Dat is verwarrend. De vraag is of we marketing aan dezelfde regel houden. Net als wel of niet dezelfde huisregels voor elke kamer.
**Opties:**
- **A)** Dezelfde gedeelde mappenregel als de rest (aanbevolen)
- **B)** Marketing mag een eigen afwijkende regel houden
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Dezelfde gedeelde mappenregel als de rest

### G-DOC-1 — Geen hulp bij vals spelen

**In één zin:** Hoe zorgen we er concreet voor dat de Document-studio niet gebruikt kan worden om AI-detectie te omzeilen (academisch vals spelen)?
**Wat het betekent:** De Document-studio (een mini-app om documenten te maken) mag niet helpen om bijvoorbeeld een scriptie zo te laten lijken alsof een mens het schreef om controles te misleiden. De vraag is hoe we dat afdwingen, niet alleen met een tekstwaarschuwing. Net als een kopieerapparaat dat weigert geld na te maken.
**Opties:**
- **A)** Een waarschuwing in de tekst plus de AI-instructie (aanbevolen)
- **B)** Een automatische controle die verboden trucs blokkeert
- **C)** Een logboek bijhouden van wat de gebruiker vraagt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Integriteitsgrens BLIJFT: geen AI-detectie-omzeiling als feature (waarschuwing + AI-instructie). Document-Studio doet opstellen/formatteren/in-uitlezen/toon, géén 'humanize om detector te misleiden'. Claude bouwt evasion niet.

### G-DOC-2 — Wat van bestanden wel werkt

**In één zin:** Welk deel van ingewikkelde documentbestanden (tabellen, dia's, opmerkingen) kunnen we netjes verwerken, en wanneer zeggen we "te ingewikkeld"?
**Wat het betekent:** Bij het inlezen en weer opslaan van documenten (Word, PowerPoint) werkt simpele inhoud prima, maar geneste tabellen of ingebedde objecten zijn lastig. De vraag is precies wat wel lukt en waar we de grens trekken. Net als een vertaalapp die gewone zinnen aankan maar bij dialect aangeeft "dit kan ik niet goed".
**Opties:**
- **A)** Een vaste lijst met wat wel ondersteund wordt, rest wordt netjes geweigerd (aanbevolen)
- **B)** Alles proberen en achteraf melden wat niet lukte
- **C)** Alleen heel simpele documenten toelaten voor nu
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Vaste ondersteund-lijst, rest netjes geweigerd

### G-DOC-3 — Veilig inlezen voor alle tools

**In één zin:** Geldt de veilige manier om geüploade bestanden in te lezen alleen voor de Document-studio, of ook voor Marketing en latere tools?
**Wat het betekent:** Geüploade bestanden worden in een afgeschermde ruimte uitgepakt zodat ze niets stuk kunnen maken. Dat is nu geregeld voor de Document-studio. Maar Marketing wil ook documenten kunnen uploaden. De vraag is of die veilige manier voor iedereen geldt. Net als één veiligheidscontrole bij elke ingang in plaats van maar bij één deur.
**Opties:**
- **A)** Dezelfde veilige manier voor alle tools die uploads aannemen (aanbevolen)
- **B)** Alleen voor de Document-studio, de rest later
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén veilige inlees-manier voor alle uploads

### G-DOC-4 — Stoppen bij verzonnen feiten

**In één zin:** Als de AI iets dreigt te verzinnen waar geen bron voor is, stopt hij dan het document of waarschuwt hij alleen achteraf?
**Wat het betekent:** De Document-studio kan een professioneel ogend document maken, maar het is gevaarlijk als daar verzonnen feiten of bronnen in staan. De vraag is of het systeem dan helemaal stopt tot je het oplost, of gewoon een waarschuwing toont en doorgaat. Net als een navigatie die stopt versus alleen even piept als je verkeerd rijdt.
**Opties:**
- **A)** Stoppen tot je de ontbrekende info aanvult (aanbevolen)
- **B)** Gewoon doorgaan maar een waarschuwing tonen
- **C)** Het verdachte stuk markeren maar de rest afmaken
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Stoppen tot ontbrekende info aangevuld is

### G-DOC-5 — Bestand aan meerdere taken koppelen

**In één zin:** Mag één gemaakt bestand aan meerdere taken tegelijk gekoppeld worden, en wat als dat bestand tussendoor een nieuwe versie krijgt?
**Wat het betekent:** Een gemaakt bestand (artifact) kun je vastkoppelen aan een taak. De vraag is of je hetzelfde bestand aan meerdere taken mag hangen, en of een taak de oude versie houdt of de nieuwe krijgt als het bestand wordt bijgewerkt. Net als een document delen met meerdere collega's: krijgen ze allemaal automatisch de nieuwe versie?
**Opties:**
- **A)** Mag aan meerdere taken; elke taak houdt de versie van het moment van koppelen (aanbevolen)
- **B)** Mag aan meerdere taken; iedereen krijgt altijd de nieuwste versie
- **C)** Maar aan één taak tegelijk koppelen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Meerdere taken; versie vastgezet bij koppelen

### G-IMG-1 — Voorvertoning alleen op eigen netwerk

**In één zin:** Werkt de voorvertoning van de Image-builder voorlopig alleen binnen je eigen netwerk, en wat is het pad om hem later wel via internet te bereiken?
**Wat het betekent:** De Image-builder (een mini-app om bouw-omgevingen klaar te zetten) heeft een voorvertoning. De vraag is of die in versie 1 alleen op je eigen kantoornetwerk werkt, en hoe je hem later veilig vanaf internet zou bereiken. Net als een printer die eerst alleen op kantoor werkt, en pas later van buitenaf.
**Opties:**
- **A)** Voorlopig alleen eigen netwerk; internet-toegang later met een gedocumenteerd pad (aanbevolen)
- **B)** Meteen ook via internet bereikbaar maken
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Voorlopig eigen netwerk; later internet-pad documenteren

### G-IMG-2 — Is Image-builder een gewone mini-app

**In één zin:** Is de Image-builder net zo'n in-/uitschakelbare mini-app als de rest, of een aparte instelling buiten dat systeem?
**Wat het betekent:** De andere tools zijn mini-apps die je aan en uit kunt zetten. De vraag is of de Image-builder daar ook bij hoort of een aparte instelling is. Dat maakt uit voor de bouwvolgorde, want hij zou eerder af zijn dan het gedeelde mini-app-raamwerk. Net als kiezen of iets een gewone app is of een vaste systeeminstelling.
**Opties:**
- **A)** Een gewone aan/uit-mini-app zoals de rest (aanbevolen)
- **B)** Een aparte instelling buiten het mini-app-systeem
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Gewone aan/uit-mini-app zoals de rest (+ notitie 2026-06-22: uitzondering op "modules in v2" — image-builder zit in v1, ná de AI-implementatie-laag, ADR 0016; Interviewer/Designer/Marketing/Document blijven v2)

### G-IMG-3 — Mag iedereen een sjabloon bouwen

**In één zin:** Mag een gewone gebruiker (geen beheerder) een kant-en-klaar sjabloon bouwen, of moet ook dat door een beheerder goedgekeurd worden?
**Wat het betekent:** De Image-builder heeft kant-en-klare sjablonen plus een AI-pad dat alleen een beheerder mag gebruiken. De vraag is of het bouwen vanuit een veilig sjabloon ook beheerder-goedkeuring nodig heeft. Net als kiezen tussen een vooraf goedgekeurd kant-en-klaar gerecht dat iedereen mag maken, versus zelf koken dat toestemming vraagt.
**Opties:**
- **A)** Sjablonen mag iedereen bouwen; alleen het AI-pad blijft beheerder-only (aanbevolen)
- **B)** Ook sjabloon-bouwen vereist beheerder-goedkeuring
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Sjablonen voor iedereen; AI-pad beheerder-only

### G-MOD-1 — Welke extra tools we parkeren

**In één zin:** Van de elf voorgestelde extra mini-apps: welke bewaren we voor later en welke schrappen we?
**Wat het betekent:** Er liggen elf ideeën voor extra mini-apps (een Diagram-tool, een Test-plan-maker, enzovoort), maar er is nooit gekozen wat we wel of niet doen. Zonder keuze blijft de lijst eindeloos groeien. De vraag is welke we bewust parkeren. Net als een verlanglijst opschonen tot een haalbare top-3.
**Opties:**
- **A)** Nu een korte top-3 kiezen om op te bouwen, de rest parkeren (aanbevolen)
- **B)** Alles parkeren voor later, nu niets erbij
- **C)** De duidelijk overbodige meteen schrappen, rest later beslissen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** B — Alle 11 voorgestelde extra modules parkeren, nu niets erbij

### G-MOD-2 — Tools elkaars resultaat laten gebruiken

**In één zin:** Mag de ene mini-app het resultaat van een andere als invoer gebruiken, of houden we dat in versie 1 nog gescheiden?
**Wat het betekent:** Het zou handig zijn als bijvoorbeeld de Marketing-tool een ontwerp uit de Designer kan oppakken. De vraag is of we die overdracht tussen tools nu al bouwen of bewaren voor later. Net als kunnen kiezen of apps onderling bestanden mogen doorgeven of dat je alles handmatig kopieert.
**Opties:**
- **A)** Tools mogen elkaars resultaten lezen via de gedeelde opslag (aanbevolen)
- **B)** In versie 1 nog niet; je doet het handmatig
- **C)** Alleen via een taak die je van de ene naar de andere meeneemt
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Tools lezen elkaars resultaten via gedeelde, cross-module leesbare opslag (gewijzigd 2026-06-22, was B). Aantekening: de modules zelf komen pas in v2, maar de cross-module data-uitwisseling wordt vanaf het ontwerp meegenomen (bv. Designer leest Interviewer-resultaten, Marketing leest codebase-info)

### G-MOD-3 — Niet meer aankunnen dan de server kan

**In één zin:** Hoe voorkomen we dat alle tools samen meer tegelijk willen doen dan de server aankan?
**Wat het betekent:** Elke tool mag een aantal dingen tegelijk doen (de Designer twee, de Document-studio drie, enzovoort), maar opgeteld kan dat meer zijn dan de computer aankan, waardoor alles traag wordt. De vraag is hoe we dat samen begrenzen. Net als te veel apparaten op één stopcontact: samen mag het de zekering niet laten springen.
**Opties:**
- **A)** Eén gedeelde totale limiet voor alles samen (aanbevolen)
- **B)** Elke tool z'n eigen vaste deel reserveren
- **C)** De som van de limieten controleren tegen wat de server aankan
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén gedeelde totale limiet voor alle tools

### G-MOD-4 — Eerlijk de beurt verdelen

**In één zin:** Hoe verdelen de tools netjes de beurten als er meerdere tegelijk willen draaien, en geldt die regel per tool of voor alles samen?
**Wat het betekent:** Als meerdere tools tegelijk willen werken, moet er een eerlijke beurtverdeling zijn zodat ze elkaar niet in de weg zitten. De ene tool regelt dat nu anders dan de andere, wat inconsistent is. De vraag is of we één gedeelde verkeersregelaar maken. Net als één stoplicht dat al het verkeer regelt in plaats van losse afspraken per straat.
**Opties:**
- **A)** Eén gedeelde beurtregeling voor alle tools samen (aanbevolen)
- **B)** Elke tool regelt z'n eigen beurten apart
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén gedeelde beurtregeling voor alle tools

### G-MOD-5 — Overal duidelijk de kosten melden

**In één zin:** Tonen alle tools op dezelfde manier een melding over de kosten, of doet alleen de Interviewer dat nu?
**Wat het betekent:** Sommige acties kosten geld (rekentijd). De Interviewer toont daar netjes een melding bij, maar de Designer en Document-studio nog niet, terwijl die juist méér tegelijk doen en dus duurder kunnen uitvallen. De vraag is of we overal dezelfde duidelijke kostenmelding willen. Net als bij elke aankoop vooraf de prijs zien, niet alleen in één winkel.
**Opties:**
- **A)** Eén vaste, duidelijke kostenmelding bij alle tools (aanbevolen)
- **B)** Alleen waar het echt veel kost een melding tonen
- **C)** Een lopend kostentotaal in beeld in plaats van losse meldingen
- **D)** Anders / weet ik niet — laat Claude een voorstel doen
**→ Keuze:** A — Eén vaste kostenmelding bij alle tools
