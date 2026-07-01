# Marketing — scope (V1 = setup, niet functioneel)

## Waar dit over gaat

Je was duidelijk: Marketing hoeft in V1 nog niet te werken, maar de **setup/het skelet** moet er wel staan (pagina, folders, skill-config), en de echte generatie + aparte AI-API's zijn V2. Deze vragen bakenen af **wat "setup zonder functie" precies inhoudt** en hoe de V2-vorm eruitziet.

## Vragen

### V-1 · Wat betekent "alleen setup" in V1 concreet?

**Samenvatting:** Welke onderdelen van Marketing bouw je in V1, ook al genereert hij nog niks?

**Gedetailleerde uitleg:** "De setup moet er staan maar nog niet functioneel" kan een paar dingen betekenen. Minimaal: alleen de pagina + folders bestaan (een leeg skelet). Iets meer: ook de skill-configuratie en de plek waar straks assets landen. Of: alles is er behalve de daadwerkelijke generatie-knop (die toont "binnenkort"). Hoe meer je in V1 zet, hoe minder werk V2 is — maar V1 wordt zwaarder.

**Opties:**

a) **Pagina + folders + skill-config (geen generatie)** — de hele werkruimte staat klaar, alleen "genereer" doet nog niets/zegt "V2". *(Aanbevolen: maximale voorbereiding, minimale V2-drempel.)*

b) **Alleen pagina + folders (kaal skelet)** — minimaal; skills en generatie komen volledig in V2.

c) **Alles behalve externe API-calls** — zelfs een simpele generatie via Claude (SVG/HTML) werkt al; alleen de "echte" media-API's wachten op V2.

---

### V-2 · Hoe initieer je een marketing-asset (als hij functioneel is)?

**Samenvatting:** Werk je vanuit folders (zoals Designer) of vooral via een snelle root-actie ("maak een thumbnail voor post X")?

**Gedetailleerde uitleg:** Je noemde allebei: folders maken zoals bij Designer, maar ook "in de root gewoon zeggen: maak een video/thumbnail voor een nieuwe post die feature X uitlicht". De eerste is georganiseerd (een folder per campagne/post), de tweede is snel en ad-hoc. Waarschijnlijk wil je beide, maar het helpt te weten wat de hoofd-ingang is.

**Opties:**

a) **Beide: snelle root-actie + optionele folders** — standaard snel iets maken; folders voor wie wil organiseren. *(Aanbevolen — precies wat je beschreef.)*

b) **Vooral folder-gebaseerd** — net als Designer; elke campagne een folder.

c) **Vooral root/ad-hoc** — snel genereren is de hoofdmodus; folders zijn bijzaak.

---

### V-3 · Welke soorten assets eerst (in V2)?

**Samenvatting:** Begin je met statische beelden (thumbnails/posters/OG-images), of meteen ook video?

**Gedetailleerde uitleg:** Statische beelden (thumbnails, posters, social-images) zijn een stuk eenvoudiger dan video. Video vereist meerdere frames, timing, montage en zwaardere AI-modellen. Beginnen met statisch levert sneller iets bruikbaars; video is de grote, latere stap.

**Opties:**

a) **Statisch eerst (thumbnails/posters/OG), video later** — sneller bruikbaar, lagere complexiteit. *(Aanbevolen — sluit aan op je eerdere keuze.)*

b) **Statisch + korte video tegelijk** — ambitieuzer; meer werk en zwaardere modellen.

c) **Beslis later** — in V1 leg je dit nog niet vast.

---

### V-4 · De codebase-context — waarvoor gebruik je die in marketing?

**Samenvatting:** Wat haalt de marketing-AI uit je codebase: feature-info, schermafbeeldingen, of branding?

**Gedetailleerde uitleg:** Je wil dat marketing-assets codebase-context hebben. Dat kan betekenen: de AI weet wélke features er zijn (om er een post over te maken), of de AI kan echte schermen van je app vastleggen (via Playwright op een draaiende server-terminal, zoals je noemde), of de AI hergebruikt je merk/kleuren/logo uit het project. Waarschijnlijk een mix — maar wat is het belangrijkst?

**Opties:**

a) **Alledrie: feature-kennis + screenshots + branding** — de volle codebase-context. *(Aanbevolen als richtbeeld.)*

b) **Vooral echte screenshots** (via Playwright + server-terminal) — de app zelf laten zien is het krachtigst.

c) **Vooral feature-kennis + branding** — de AI weet wat er is en in welke stijl, maar maakt geen live screenshots.

---

### V-5 · De aparte AI-API's voor marketing — hoe regel je die straks?

**Samenvatting:** Komt er per tool een eigen provider/key-instelling, of regel je marketing-API's los als "integraties"?

**Gedetailleerde uitleg:** Marketing (vooral video/beeld) heeft straks andere AI-diensten nodig dan de Claude-pipeline. Dat kan via een net "per-module provider"-systeem (elke tool kiest z'n eigen AI-aanbieder en sleutel), of pragmatischer als losse integratie-instellingen (een API-key die je per workspace invult, zoals andere externe diensten). Het eerste is netter maar groter werk; het tweede is sneller en past op wat er al is. Dit is V2, maar de richting bepaalt hoe je nu de setup ontwerpt.

**Opties:**

a) **Pragmatisch: API-key als workspace-integratie** — een ingevulde sleutel per externe dienst, zonder een volledig provider-systeem. *(Aanbevolen voor de eerste functionele versie.)*

b) **Net per-module provider-systeem** — elke tool kiest formeel z'n provider + sleutel; krachtiger, groter werk (de geparkeerde multi-provider build).

c) **Beslis bij V2** — alleen zorgen dat de setup dit later kan opnemen.
