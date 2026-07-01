# Marketing — diepe ronde (V1 = setup)

## Waar dit over gaat

In V1 bouw je alleen de setup: de pagina, folders, skill-config en de context-/integratie-haken — geen echte generatie. Deze vragen gaan over hoe dat skelet eruitziet, zodat V2 (de echte generatie) er straks gewoon "inklikt".

## Vragen

### V-1 · Hoe ziet een marketing-skill eruit in de config?

**Samenvatting:** Wat definieer je als je een marketing-skill maakt (nog zonder dat er iets gegenereerd wordt)?

**Gedetailleerde uitleg:** Een marketing-skill is straks de stijl waarin een asset gemaakt wordt. In de setup-fase leg je vast wat een skill is: een toon (speels/zakelijk), een formaat/afmetingen (thumbnail, poster, social), en een visuele stijlrichting. Hoe rijker je de skill nu maakt, hoe minder je in V2 hoeft te doen. Maar je kunt ook minimaal beginnen (alleen een naam + toon) en de rest in V2 toevoegen.

**Opties:**

a) **Toon + formaat/afmetingen + stijlrichting** — een volwaardige skill-definitie, klaar voor V2. *(Aanbevolen — maximale voorbereiding.)*

b) **Minimaal (naam + toon)** — alleen het hoogstnodige; rest in V2.

c) **Hergebruik de design-skill-structuur 1:1** — een marketing-skill is gewoon een skill met `surface: marketing`, zelfde velden als design.

---

### V-2 · Het "maak een asset"-formulier (skelet) — welke velden?

**Samenvatting:** Ook al genereert hij nog niets: welke velden staan er in het aanvraagformulier?

**Gedetailleerde uitleg:** Je beschreef "maak een thumbnail voor een post die feature X uitlicht". Dat formulier heeft velden nodig, ook in de setup-fase (de knop doet nog niets / zegt "V2"). Denk aan: type asset, welke feature/onderwerp uitlichten, welke skill, en welke context meenemen. Door dit nu te bouwen, is de stap naar functioneel klein. De vraag is hoe compleet je het skelet maakt.

**Opties:**

a) **Compleet formulier (type, onderwerp/feature, skill, context-selectie)** — alles staat klaar; alleen de generatie-actie ontbreekt. *(Aanbevolen.)*

b) **Basaal formulier (type + onderwerp)** — minimaal skelet; verfijn in V2.

c) **Alleen de folder + een "binnenkort"-placeholder** — kaalste setup.

---

### V-3 · De context-bundel — hergebruik je de pipeline-editor-selectie?

**Samenvatting:** Kies je de context (code, docs, graph, screenshots, branding) met dezelfde selector als in de pipeline-editor?

**Gedetailleerde uitleg:** Je gaf aan dat marketing dezelfde info moet kunnen gebruiken die je in de pipeline-editor aan AI's geeft (codebase, docs, de dependency-graph, plus screenshots en branding). Het ligt voor de hand om diezelfde context-selectie te hergebruiken in plaats van een aparte te bouwen. Dat geeft consistentie en minder werk. Alternatief is een eigen, op marketing toegesneden selector.

**Opties:**

a) **Hergebruik de pipeline-editor context-selector** — één manier om context te kiezen, overal. *(Aanbevolen.)*

b) **Eigen marketing-context-selector** — toegesneden op assets (meer focus op screenshots/branding), maar dubbel werk.

c) **Hergebruik + marketing-specifieke extra's** — de gedeelde selector, plus knoppen voor screenshots/brand-kit.

---

### V-4 · De Playwright-frame-capture — waar configureer je de bron-URL?

**Samenvatting:** Screenshots van je app komen via een draaiende server-terminal — regel je die in de pipeline-terminalconfig of apart?

**Gedetailleerde uitleg:** Je merkte op dat je in de pipeline-view al terminals kunt configureren (bv. een server starten), en dat Playwright dan naar die URL kan om frames te maken. De vraag is of de Marketing-tool die bestaande terminalconfiguratie hergebruikt (je wijst gewoon een al-geconfigureerde server-terminal aan), of dat marketing z'n eigen "start hier een server en pak deze URL"-instelling krijgt. Hergebruik is consistenter; apart geeft de tool meer zelfstandigheid.

**Opties:**

a) **Hergebruik de pipeline-terminalconfig (wijs een server-terminal aan)** — consistent met hoe je servers al opstart. *(Aanbevolen.)*

b) **Eigen capture-instelling in de Marketing-tool** — een eigen URL/serverconfig, los van de pipeline.

c) **Beslis bij V2** — in de setup alleen de plek reserveren, de koppeling later.

---

### V-5 · Welke integratie-providers reserveer je in de settings?

**Samenvatting:** Voor welke externe diensten zet je nu al een (lege) API-key-plek klaar?

**Gedetailleerde uitleg:** Marketing-generatie gebruikt straks externe AI-diensten (voor beeld, en later video). In de setup-fase kun je de plekken voor die API-keys al klaarzetten in de workspace-integraties, zodat V2 alleen de sleutel hoeft in te vullen. De vraag is hoe ver je daarin gaat: alleen een generiek "externe media-API"-veld, of meteen herkenbare plekken voor beeld- én video-diensten.

**Opties:**

a) **Eén generiek "media-API"-integratieveld** — flexibel, niet vastgepind op één dienst. *(Aanbevolen voor setup.)*

b) **Aparte plekken voor beeld- en video-diensten** — concreter, maar je gokt nu al welke diensten.

c) **Nog niets reserveren** — integratie-keys komen pas in V2 in beeld.
