## Zo begrijp ik je visie nu — corrigeer waar ik ernaast zit

Dit is de scope-ronde: **bredere vragen** om per tool de vorm/grenzen scherp te krijgen, vóórdat we de diepe details induiken. Lees eerst dit kader — als het klopt, zijn de vragen hieronder logisch; klopt iets niet, corrigeer het in het vrije veld onderaan.

**Het kernmodel zoals ik het nu zie:**

- De **pipeline is de hoofdzaak** van Workspaces, met z'n bestaande tabs: board, backlog, pipeline-editor, skills, terminals, enz.
- **Designer Studio, Marketing en Document Studio zijn geen pipeline-stappen** — het zijn **losse tools, als extra items in dezelfde sidebar**, per workspace **aan/uit te zetten in settings**. Het zijn in essentie gewoon **pagina's**.
- Elke tool-pagina is een **folder-gebaseerde werkruimte**. Voorbeeld Designer: je hebt 10 skills in je workspace, je vinkt er 5 aan, je zegt "maak een settings-pagina", en de AI genereert **5 designs op basis van die skills + codebase-context**. Je slaat dat op in folders.
- **De koppeling met de pipeline is één-richting en altijd mens-geïnitieerd:** jij verwijst op het board naar "design 5 in folder X"; bij het **aanmaken van een ticket zoekt de AI dat opgeslagen design op en linkt het in de ticket**. Een ticket triggert dus **nooit zelf** de Designer/Marketing-tool via interne automatisering — dat is voor nu expliciet te veel.
- **Marketing** werkt met hetzelfde folder-idee, plus optioneel een snelle root-actie ("maak een thumbnail voor een post die feature X uitlicht"). Skills horen erbij, en aparte AI-API's zijn handig — maar dat is **V2**. In **V1 hoeft Marketing nog niet functioneel** te zijn; alleen de **setup/het skelet** (pagina, folders, skill-config) moet staan. Frame-capture gebruikt straks Playwright tegen de URL van een via de pipeline-config opgestarte server-terminal.
- **Document Studio** (files/docs uploaden → andere docs genereren) past in hetzelfde tool-pagina-model.
- **Gedeelde fundamenten** tussen deze tools: het **skill-model**, **folders/werkruimte**, en een **artifact-store** waar output landt en waar tickets naar kunnen verwijzen.

**De rode draad:** dit zijn **developer-tools waar de mens de eerste stap neemt**. De output (designs, assets, documenten) wordt opgeslagen en kan handmatig aan tickets gekoppeld worden. Geen autonome AI-triggers binnen de pipeline voor deze tools — dat houden we voor later.

> De vragen hieronder gaan over **scope en vorm** ("hoe groot is V1, wat is het wel/niet, hoe verhoudt het zich tot de pipeline"), niet over implementatiedetails. Daar gaan we pas later dieper op in.
