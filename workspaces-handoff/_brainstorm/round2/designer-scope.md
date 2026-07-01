# Designer Studio — scope

## Waar dit over gaat

De Designer-pagina: selecteer skills → "maak pagina X" → AI genereert N designs met codebase-context → opslaan in folders → later koppelen aan een ticket. Deze vragen bakenen af **wat een "design" precies is** en **hoe ver de tool gaat** — niet de technische details.

## Vragen

### V-1 · Wat is een opgeslagen "design" concreet?

**Samenvatting:** Is een gegenereerd design een visuele preview, echte code, of allebei?

**Gedetailleerde uitleg:** Als de AI 5 designs maakt voor een settings-pagina, wat sla je dan op? Een visuele preview (een plaatje/render zodat je kan kiezen welke je mooi vindt), echte werkende code (React/Tailwind die je direct kan gebruiken), of beide (een preview om te kiezen + de code eronder). Alleen preview is lichter en sneller; code erbij maakt het direct bruikbaar maar zwaarder (de AI moet werkende componenten schrijven en er is een omgeving nodig om te renderen).

**Opties:**

a) **Preview + code** — een visuele weergave om uit te kiezen, met de bijbehorende code eronder die je later kan toepassen. *(Aanbevolen: dit is wat de "kies design 5 → link in ticket"-flow het nuttigst maakt.)*

b) **Alleen visuele preview** — je kiest op uiterlijk; de implementatie gebeurt later in een ticket. Lichter, sneller.

c) **Alleen code/spec** — geen render, alleen de gegenereerde code of een beschrijving. Lichtst, maar je moet de code lezen om te beoordelen.

---

### V-2 · Raakt de Designer ooit je echte codebase aan?

**Samenvatting:** Blijven designs altijd losse opgeslagen artifacts, of kan de Designer ook direct in je repo schrijven?

**Gedetailleerde uitleg:** In jouw model neemt de mens de eerste stap en wordt een design pas via een ticket geïmplementeerd. De vraag is of de Designer-tool zelf ooit code naar je repository mag schrijven, of dat het puur een "ontwerp-werkruimte" is waar resultaten worden bewaard tot een ticket ze oppakt. Puur bewaren houdt het veilig en simpel (geen ongewenste codewijzigingen); direct kunnen schrijven is krachtiger maar vervaagt de grens die je net hebt getrokken.

**Opties:**

a) **Nooit direct — alleen opgeslagen artifacts** — designs leven in folders; een ticket implementeert ze later. Past bij je één-richting-model. *(Aanbevolen.)*

b) **Optioneel direct toepassen** — vanaf de Designer-pagina kan je een gekozen design als voorstel naar de repo sturen (met jouw akkoord), buiten een ticket om.

c) **Pas later beslissen** — V1 bewaart alleen; "direct toepassen" is een mogelijke V2-toevoeging.

---

### V-3 · Hoeveel designs genereer je typisch per opdracht?

**Samenvatting:** Eén design per geselecteerde skill, of meerdere varianten per skill?

**Gedetailleerde uitleg:** Je voorbeeld: 5 skills aangevinkt → 5 designs. Dat is één design per skill. Maar misschien wil je per skill meerdere varianten (bv. 2 interpretaties van dezelfde stijl), of juist het aantal vrij kunnen kiezen los van het aantal skills. Meer designs = meer keuze maar ook meer AI-werk en wachttijd. Dit bepaalt de standaard-verwachting van de tool.

**Opties:**

a) **Eén design per geselecteerde skill** — voorspelbaar: 5 skills = 5 designs. *(Aanbevolen als standaard.)*

b) **Instelbaar aantal varianten** — je kiest hoeveel designs, los van het aantal skills.

c) **Meerdere varianten per skill** — elke skill levert er bv. 2, zodat je ook binnen een stijl kan vergelijken.

---

### V-4 · Hoe organiseer je wat je genereert?

**Samenvatting:** Groepeer je designs per "scherm/feature" (folder = settings-pagina) of per generatie-sessie?

**Gedetailleerde uitleg:** Als je vaak designs maakt, wil je ze terugvinden. Je kan folders rond een onderwerp organiseren ("alle designs voor de settings-pagina staan in folder settings"), of rond een sessie ("dit is wat ik dinsdag genereerde"). Onderwerp-folders sluiten het beste aan op "kijk naar onze designs voor de settings-pagina in folder X" dat je noemde.

**Opties:**

a) **Folder per scherm/feature** — bv. "settings-pagina", "dashboard"; elke generatie voegt designs toe aan de juiste folder. *(Aanbevolen — past op je ticket-koppeling.)*

b) **Folder per sessie** — elke "genereer"-actie is een eigen map met datum.

c) **Vrij** — jij bepaalt per keer waar het landt.

---

### V-5 · Is de Designer-pagina ook waar je vergelijkt en kiest?

**Samenvatting:** Doe je het vergelijken/kiezen van designs op de Designer-pagina zelf, of pas op het board bij het ticket?

**Gedetailleerde uitleg:** Er zijn twee momenten waarop je een design "kiest": meteen na het genereren (op de Designer-pagina, naast elkaar vergelijken en favorieten markeren), of later op het board als je een ticket maakt ("ik wil design 5"). Misschien wil je allebei. Dit bepaalt hoe rijk de Designer-pagina zelf moet zijn (met een vergelijk-weergave) versus hoe veel via het board/ticket loopt.

**Opties:**

a) **Beide: vergelijken op de Designer-pagina, definitief kiezen bij het ticket** — je markeert favorieten in de tool, en koppelt de uiteindelijke keuze bij ticket-aanmaak. *(Aanbevolen.)*

b) **Alleen op de Designer-pagina** — je kiest daar je favoriet; het ticket linkt gewoon die ene.

c) **Alleen bij het ticket** — de Designer bewaart alles plat; alle vergelijking gebeurt op het board.

---

### V-6 · Naast pagina-designs — wat hoort er nog meer in deze tool?

**Samenvatting:** Blijft de Designer puur voor UI-pagina's, of ook voor losse componenten, kleurenschema's, hele flows?

**Gedetailleerde uitleg:** Je voorbeeld is een settings-pagina. Maar dezelfde tool kan breder: losse componenten ontwerpen (een knop, een kaart), een kleur/typografie-systeem voorstellen, of een hele flow van meerdere schermen. Breder maken vergroot de waarde maar ook de scope. Dit helpt bepalen waar V1 stopt.

**Opties:**

a) **V1 = hele pagina's/schermen** — focus op het voorbeeld dat je gaf; de rest later. *(Aanbevolen voor focus.)*

b) **Pagina's + losse componenten** — ook kleinere bouwstenen ontwerpen.

c) **Pagina's + componenten + design-systeem (kleuren/typografie)** — de volle breedte van een echte design-tool.
