# Designer Studio — diepe ronde

## Waar dit over gaat

De zwaarste tool van de eerste lichting: preview + code, volle breedte (pagina's + componenten + design-systeem), raakt de repo nooit direct. Deze vragen gaan over hoe het genereren, vergelijken en bewaren werkt — en hoe we de volle breedte in behapbare stukken knippen.

## Vragen

### V-1 · Hoe wordt de "preview" gemaakt?

**Samenvatting:** Render je de gegenereerde code live, maak je er een screenshot van, of toon je een statische mock?

**Gedetailleerde uitleg:** Je wilt designs op uiterlijk kunnen vergelijken. Daarvoor moet er een beeld zijn. Drie manieren: de gegenereerde code echt draaien in een afgeschermd venster (live, interactief, maar je moet de code veilig kunnen uitvoeren), er een screenshot van maken (een plaatje via een headless browser zoals Playwright — vergelijkbaar met de marketing-capture), of een statische weergave tonen zonder de code echt te draaien. Live is het rijkst maar het zwaarst; screenshot is een goede middenweg.

**Opties:**

a) **Screenshot via headless browser** — de code wordt gerenderd en als beeld vastgelegd; vergelijkbaar met de marketing-frame-capture. *(Aanbevolen — rijk genoeg, herbruikt infra.)*

b) **Live interactieve preview** — de code draait echt in een afgeschermd venster; klikbaar. Rijkst, zwaarst.

c) **Live preview per variant op een eigen URL** — elke variant draait als een mini-deployment (zoals de preview-deployments). Krachtig, hoogste kosten.

---

### V-2 · Hoe knippen we de "volle breedte" in V1?

**Samenvatting:** Pagina's, componenten én design-systeem is veel — wat bouw je eerst?

**Gedetailleerde uitleg:** Je koos de volle breedte, maar dat is de zwaarste tool. Het helpt om een eerste versie te kiezen die snel waarde geeft en de rest daarna. Pagina's eerst (jouw oorspronkelijke voorbeeld: "maak een settings-pagina") is het meest concreet. Componenten (losse knoppen/kaarten) zijn kleiner maar minder indrukwekkend. Het design-systeem (kleuren/typografie) is fundamenteel maar abstracter. De volgorde bepaalt wat je het eerst kunt gebruiken.

**Opties:**

a) **Pagina's eerst, dan componenten, dan design-systeem** — begin bij je eigen voorbeeld; bouw uit. *(Aanbevolen.)*

b) **Design-systeem eerst** — eerst kleuren/typografie vastleggen, dan pagina's die dat gebruiken.

c) **Alles tegelijk** — volle breedte direct; meeste werk, langste tijd tot iets bruikbaars.

---

### V-3 · Genereert de AI tegen je echte componenten/tokens?

**Samenvatting:** Gebruikt de AI je bestaande componentbibliotheek en design-tokens, of generieke React/Tailwind?

**Gedetailleerde uitleg:** Als de AI een settings-pagina ontwerpt, kan hij vanaf nul generieke code schrijven, of hij kan je bestaande bouwstenen hergebruiken (je eigen knop-component, je projectkleuren/tokens). Het tweede geeft designs die direct passen bij je project en makkelijker te implementeren zijn, maar vereist dat de Ai je codebase-conventies kent (via de codebase-context). Generiek is simpeler maar levert code die je nog moet "vertalen" naar je eigen stijl.

**Opties:**

a) **Tegen je echte componenten + tokens (codebase-bewust)** — designs passen meteen bij je project. *(Aanbevolen — sluit aan op "codebase-context".)*

b) **Generieke React/Tailwind** — simpeler, maar je moet het achteraf naar je eigen stijl brengen.

c) **Instelbaar per opdracht** — soms strak tegen je project, soms vrij/experimenteel.

---

### V-4 · Kun je een gegenereerd design verfijnen, of is het één-shot?

**Samenvatting:** Na het genereren: kun je zeggen "maak deze ronder/donkerder" en opnieuw, of genereer je gewoon een nieuwe set?

**Gedetailleerde uitleg:** Soms is een variant bijna goed en wil je 'm bijschaven ("maak de knoppen ronder", "meer witruimte"). Dat kan als een verfijn-lus (je praat met de AI over één variant tot het klopt) of je accepteert dat elke "genereer" een nieuwe set oplevert en je gewoon opnieuw vraagt. De verfijn-lus is fijner in gebruik maar meer werk om te bouwen.

**Opties:**

a) **Verfijn-lus per variant** — je kunt een gekozen design iteratief bijsturen. *(Aanbevolen als het kan; anders V2.)*

b) **Alleen opnieuw genereren** — geen lus; je vraagt een nieuwe set met aangepaste instructies.

c) **V1 zonder lus, V2 met lus** — start simpel, voeg verfijnen later toe.

---

### V-5 · Wat wordt er precies opgeslagen als een design-artifact?

**Samenvatting:** Alleen het beeld + de code, of ook de gebruikte skills/prompt zodat het reproduceerbaar is?

**Gedetailleerde uitleg:** Een opgeslagen design kan minimaal het resultaat zijn (de preview + de code). Maar je kunt er ook de "ingrediënten" bij bewaren: welke skills waren aangevinkt, welke opdracht je gaf, tegen welke codebase-versie. Dat maakt een design reproduceerbaar ("genereer nog eens met dezelfde skills maar net anders") en traceerbaar. Iets meer opslag, maar veel handiger op termijn.

**Opties:**

a) **Resultaat + ingrediënten (skills, prompt, codebase-versie)** — reproduceerbaar en traceerbaar. *(Aanbevolen.)*

b) **Alleen het resultaat (preview + code)** — simpelst; geen herkomst.

c) **Resultaat + alleen de skills** — een tussenweg.

---

### V-6 · Hoe ziet de "genereer"-ervaring eruit?

**Samenvatting:** Wacht je tot alle varianten klaar zijn, of verschijnen ze één voor één terwijl ze af zijn?

**Gedetailleerde uitleg:** Als je 5 designs aanvraagt, duurt dat even. Je kunt wachten tot alles klaar is en ze dan samen tonen, of ze laten verschijnen zodra elk af is (je ziet de eerste al terwijl de rest nog draait). Het tweede voelt sneller en levendiger, maar de pagina moet met "nog bezig"-staten omgaan. Dit raakt ook de capaciteit (meerdere designs tegelijk = meerdere AI-sessies).

**Opties:**

a) **Eén voor één, zodra klaar (streaming)** — je ziet meteen voortgang en de eerste resultaten. *(Aanbevolen.)*

b) **Allemaal tegelijk na afloop** — simpeler; je wacht tot het compleet is.

c) **Jij kiest serieel of parallel** — parallel = sneller maar meer capaciteit; serieel = rustiger.

---

### V-7 · Design-systeem-output — hoe verhoudt die zich tot je bestaande tokens?

**Samenvatting:** Als de AI een kleur/typografie-systeem voorstelt, is dat een los voorstel of een diff op je huidige tokens?

**Gedetailleerde uitleg:** Bij het design-systeem-deel stelt de AI kleuren, lettertypes en spacing voor. Dat kan een volledig nieuw, losstaand voorstel zijn (je vergelijkt het naast je huidige stijl), of een "diff" — een overzicht van precies welke van je bestaande tokens zouden veranderen en hoe. De diff is concreter en makkelijker te beoordelen/toe te passen; een los voorstel geeft meer creatieve vrijheid.

**Opties:**

a) **Diff op je bestaande tokens** — toon wat er verandert t.o.v. nu; makkelijk te beoordelen en later toe te passen. *(Aanbevolen.)*

b) **Losstaand voorstel** — een compleet nieuw systeem om naast het huidige te leggen.

c) **Allebei beschikbaar** — een diff-weergave én een "helemaal opnieuw"-modus.
