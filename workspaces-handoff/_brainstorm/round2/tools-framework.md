# Tools als pagina's — het gedeelde raamwerk

## Waar dit over gaat

Designer, Marketing en Document zijn allemaal "een tool-pagina in de sidebar, aan/uit per workspace, met folders". Voordat we per tool inzoomen, een paar vragen over het **gedeelde raamwerk** dat ze alledrie gebruiken — want hier wil je één keer een goede keuze maken en niet drie keer een andere.

## Vragen

### V-1 · Wat deelt elke tool-pagina als gemeenschappelijk fundament?

**Samenvatting:** Bouw je één gedeeld "tool-pagina"-raamwerk (folders + skills + opslag) dat elke tool hergebruikt, of krijgt elke tool zijn eigen losse implementatie?

**Gedetailleerde uitleg:** Designer, Marketing en Document lijken sterk op elkaar qua vorm: een pagina met folders, een skill-selectie, een "genereer"-actie, en opgeslagen resultaten. Je kunt dat één keer bouwen als een herbruikbaar raamwerk waar elke tool op draait (sneller nieuwe tools toevoegen, consistente UX), of elke tool apart bouwen (meer vrijheid per tool, maar meer dubbel werk en inconsistentie). De keuze bepaalt hoe snel je later een vierde of vijfde tool kan toevoegen.

**Opties:**

a) **Eén gedeeld raamwerk** — folders, skill-selectie, generatie-actie en artifact-opslag zijn generieke bouwstenen; een tool vult alleen z'n eigen "wat genereer ik"-logica in. *(Aanbevolen: dit is precies wat het module-systeem waardevol maakt.)*

b) **Per tool een eigen implementatie** — maximale vrijheid per tool, maar je herbouwt folders/skills/opslag elke keer.

c) **Hybride** — een gedeelde kern (folders + opslag) maar de skill- en generatie-UX mag per tool verschillen.

---

### V-2 · Hoe ver gaat "aan/uit per workspace"?

**Samenvatting:** Is een tool puur per workspace aan/uit, of ook per gebruiker / per rol?

**Gedetailleerde uitleg:** Je zei dat tools in de workspace-settings aan/uit gaan. De vraag is hoe fijnmazig dat moet zijn. Alleen per workspace (iedereen in die workspace ziet dezelfde tools) is het simpelst. Maar misschien wil je dat een tool alleen zichtbaar is voor bepaalde rollen (bv. alleen designers zien Designer Studio), of dat een individuele gebruiker tools voor zichzelf kan verbergen. Meer fijnmazigheid = meer controle, maar ook meer complexiteit in je rechten-systeem.

**Opties:**

a) **Alleen per workspace** — aan/uit geldt voor iedereen in de workspace. Simpelst, sluit aan op het bestaande model. *(Aanbevolen voor V1.)*

b) **Per workspace + per rol (RBAC)** — een tool kan zichtbaar zijn voor bepaalde rollen; sluit aan op het bestaande RBAC-systeem.

c) **Per workspace + persoonlijke voorkeur** — workspace bepaalt beschikbaarheid, gebruiker kan tools voor zichzelf tonen/verbergen.

---

### V-3 · Hoe werken folders binnen een tool-pagina?

**Samenvatting:** Zijn folders een vrije mappenstructuur (zoals een verkenner), of meer een platte lijst van "projecten/sessies"?

**Gedetailleerde uitleg:** Je noemde folders aanmaken op een tool-pagina. Dat kan een volledige boomstructuur zijn (mappen in mappen, vrij te organiseren zoals op je computer), of een eenvoudiger model: één niveau van "folders" die elk een werkonderwerp groeperen (bv. een folder "settings-pagina" met daarin alle gegenereerde designs). Een vrije boom is flexibeler maar vraagt meer UI; een plat model is sneller te bouwen en vaak genoeg.

**Opties:**

a) **Eén niveau folders (per onderwerp/feature)** — bv. een folder "settings-pagina", "dashboard", "login". Simpel en overzichtelijk. *(Aanbevolen startpunt.)*

b) **Vrije mappenboom** — mappen in mappen, volledig vrij te organiseren. Flexibeler, meer UI-werk.

c) **Geen folders, alleen tags/filters** — alles in één lijst, georganiseerd via labels en zoeken in plaats van mappen.

---

### V-4 · Wat is het gedeelde "skill"-begrip over de tools heen?

**Samenvatting:** Is een skill één generiek concept met een type (design / marketing / document), of heeft elke tool een eigen, los soort skill?

**Gedetailleerde uitleg:** Elke tool heeft "skills" (een designstijl, een marketing-stijl, een document-sjabloon). Je kunt dat als één concept modelleren met een veldje dat zegt voor welke tool de skill is — dan deelt alles dezelfde skill-bibliotheek, beheer-UI en het bestaande skills-tabblad. Of elke tool krijgt z'n eigen skill-soort, los van elkaar. Eén model is consistenter en minder werk; aparte modellen geven elke tool meer vrijheid maar splitsen je skill-beheer op.

**Opties:**

a) **Eén skill-model met een "surface"-type** — design / marketing / document zijn varianten van hetzelfde skill-concept; gedeelde bibliotheek en beheer. *(Aanbevolen.)*

b) **Aparte skill-soorten per tool** — elke tool z'n eigen skill-type en beheer-UI.

c) **Gedeeld nu, kan later splitsen** — begin met één model; splits alleen als een tool echt iets fundamenteel anders nodig heeft.

---

### V-5 · Waar leeft de skill-bibliotheek?

**Samenvatting:** Beheer je skills in het bestaande "skills"-tabblad van de pipeline, of krijgt elke tool z'n eigen skill-beheer op z'n eigen pagina?

**Gedetailleerde uitleg:** Er is al een skills-tab in de pipeline. De vraag is of design/marketing/document-skills daar ook landen (één centrale plek voor alle skills), of dat je ze beheert op de tool-pagina zelf (de Designer-pagina heeft z'n eigen skill-sectie). Centraal is overzichtelijker; per-pagina houdt alles bij de tool waar het hoort.

**Opties:**

a) **Centraal in het bestaande skills-tabblad, gefilterd per type** — één plek, filter op design/marketing/document. *(Aanbevolen — sluit aan op wat er al is.)*

b) **Per tool-pagina z'n eigen skill-sectie** — skills beheer je waar je ze gebruikt.

c) **Allebei** — centraal overzicht, maar ook snel toegankelijk vanaf de tool-pagina.
