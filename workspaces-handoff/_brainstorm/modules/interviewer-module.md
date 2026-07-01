# Interviewer Module — Analyse & Vragen

> Module waarbij de AI je project doorloopt en ideeën/toevoegingen surfact als een browser-UI van vragen — vaak meerkeuze (a/b/c/d) zoals de Claude CLI maar in de browser — elke vraag met title + summary + detailed-summary (de detailed summary begrijpbaar voor een niet-coder met alleen een globaal beeld van het project).

---

## Mijn mening

Dit is het sterkste module-idee van de drie. Niet omdat het technisch het eenvoudigste is, maar omdat het een echte pijnpunt adresseert: het beslissingstempo van een solo-dev of klein team is de bottleneck van het AI-systeem, niet de agent-kwaliteit. De Interviewer gooit die bottleneck open door de AI proactief richting te laten vragen, in een formaat dat je van je telefoon kunt beantwoorden.

Wat het sterk maakt: het QuestionSet-mechanisme, de one-question-per-screen stepper en de answer-queue bestaan al volledig. De kern van de rendering is dus geen werk. De meerkeuzevragen, de tap-not-type UX, de push-deep-link naar de queue — dat is allemaal al ontworpen in doc 09 en addition 05. Hierdoor is de **marginal build cost opvallend laag** vergeleken met de User Value.

Waar het zwak is of spanning geeft:

1. **De initiatie is de echte gap.** Het bestaande `request_input` is reactief (agent is geblokkeerd en vraagt). De Interviewer wil een proactieve modus: de AI scant het project en genereert een agenda van vragen/ideeën zonder dat er een geblokkeerd ticket is. Dat is net-new orchestratie. De "invoke-workspace-ai" trigger-action in doc 03 §1.5 is de dichtstbijzijnde primitief, maar die spant een one-shot reasoner voor een enkele message — niet een multi-batch iteratief interview.

2. **De drie-laags informatie-dichtheid is het echte onderscheidende kenmerk.** Title/summary/detailed-summary is niet alleen een UI-convenience, het is een brug tussen de technische agent en de niet-technische stakeholder. Dit moet goed uitgewerkt worden in het output-schema van de role; als het er als een bijzaak op wordt geplakt, gaat het nergens.

3. **Scope-creep risico is groot.** De Interviewer kan eindeloos uitgroeien: idee-categorisatie, impact/effort-matrix, ticket-generatie vanuit antwoorden, voice-antwoorden, iteratieve vervolgvragen. De lock op "geen nieuwe verbs" en "geen standing coordinator" beschermt hier goed — houd de v1-scope bij die constraint.

4. **Dit is geen vervanging van de intake co-pilot (addition 01).** De intake co-pilot is ticket-scoped en blocking (de user wil een ticket aanmaken). De Interviewer is project-scoped en async (de user wil weten waar hij heen moet). Ze zijn complementair, maar moeten scherp van elkaar afgebakend worden in de UX, anders voelen ze als hetzelfde.

Wat het excellent zou maken: de gelaagde summary die écht werkt (automatisch getest via golden fixtures), de async antwoord-lifecycle zodat je dag later kunt antwoorden, en een goede dedup die voorkomt dat je dezelfde vraag twee keer ziet.

---

## Past op bestaande design

### Wat al bestaat en direct hergebruikt wordt

**QuestionSet + Question data model** (02 §5, 09 §Data): de `kind:'choice'` cards, de `choices[]` array, de `status:'open'|'answered'|'superseded'` lifecycle, de `sessionId`-koppeling voor `--resume` — dit is precies het juiste model voor Interviewer-vragen. Het schema hoeft alleen een `title` en `detailedSummary` veld erbij.

**QuestionCard component** (09 §UI): de one-tap stacked buttons voor `choice`, de ≥44px tap-targets, de one-question-per-screen mobile stepper — dit is de Interviewer-UI. Geen herwerking nodig, alleen registratie als vierde subscriber op `ws-ai:needs-input`.

**Answer-queue triage stack** (addition 05): de cross-ticket swipe-door-alles UX is precies wat je wil voor "beantwoord alle Interviewer-vragen van je telefoon." De Interviewer-items worden gewoon opgenomen in de `useAnswerQueue()` selector als een tweede bron naast de blocking ticket-gates.

**AIPanel + WorkspaceSuggestion** (11, 02 §6): de Suggestions-tab is de juiste plek voor de "resultaten" van een interview-sessie — ideeën die de AI surfact worden `WorkspaceSuggestion(type:'ai-suggestion')` rows, die de user kan Accept/Dismiss/Snooze.

**WorkspaceTrigger invoke-workspace-ai** (03 §1.5): een cron- of on-demand trigger die een one-shot reasoner spant is de backend van de initiatie. De `invoke-workspace-ai` action + `spawnReasoner(render(template, ctx))` pad bestaat.

**AgentRole plugin model** (03 §3): de Interviewer kan als een lichtgewicht `AgentRole` met `needsWorkspace: false` worden geregistreerd — geen container, geen worktree, alleen een reasoner-sessie die de codebase via RAG leest en een `Question[]` batch produceert.

**RAG delta-indexer** (07 §D): de Interviewer-sessie leest de codebase via de bestaande embeddings. Geen nieuwe indexing-infrastructuur nodig.

**PromptFeedback + PromptABTest** (AI_QUALITY_AND_EVALS §4-5): de kwaliteit van het interview-systeem-prompt (wat voor vragen genereert de AI?) kan via het bestaande A/B-mechanisme verbeterd worden zonder fine-tuning.

### Spanningen met locked decisions

**Geen standing Coordinator** (02 §2, locked): de Interviewer mag geen persistent LLM-proces per workspace openhouden. De initiatie moet een one-shot reasoner zijn die een batch produceert en afsluit. Dit beperkt de conversationele back-and-forth tijdens de interview-sessie zelf — maar dat is juist OK, want de Interviewer is asynchroon van opzet.

**Geen nieuwe verbs** (02b §A, locked): het surfacen van Interviewer-vragen moet via bestaande verbs. Concreet: de one-shot reasoner gebruikt `propose_suggestion` om een `WorkspaceSuggestion` te maken met een batch `Question[]` in de body, en/of roept `request_input` aan om een `QuestionSet` te persisteren. Dit werkt, maar er zit een subtiele spanning: `request_input` is ontworpen als blocking call (de agent wacht op antwoord), terwijl Interviewer-vragen asynchroon zijn (de agent is al klaar). Oplossing: de Interviewer persisteert de `QuestionSet` via de Conductor (als een `WorkspaceSuggestion` met embedded questions, of via een nieuw control-API op) zonder een levende agent te blokkeren.

**B-23 proposes only** (locked): de Interviewer mag nooit zelf tickets aanmaken. Na antwoorden → `propose_suggestion({type:'create-tickets-from-interview', ...})` → user Accept → Conductor schrijft. Dit is de juiste flow.

**PTY-billing locked**: de one-shot reasoner is een interactieve `claude` PTY. De initiatie kost een subscription-turn. Dit moet duidelijk gecommuniceerd worden in de UI ("Starten van een interview kost een AI-beurt").

**QuestionSet antwoord-immutability** (09 §Resolved 3, locked): na Submit zijn antwoorden onveranderbaar. Bij de Interviewer is dit iets vriendelijker dan bij een geblokkeerde agent (de agent wacht toch niet), maar het model staat geen edit-after-submit toe. Iteratieve verdieping = een nieuwe QuestionSet.

---

## Risico's

- **Proactieve initiatie vs. het polling-antipatroon.** De gebruiker wil "AI gaat over mijn project en komt met ideeën" — maar als dit te vaak automatisch triggert, is het spam. De cron-trigger moet conservatief zijn (max 1x per week, en alleen als er significante git-activiteit was). On-demand is veiliger als v1-default.

- **Three-tier summary kwaliteit is moeilijk te testen.** De `detailedSummary` moet begrijpelijk zijn voor een niet-coder. Dit is een kwalitatief doel, niet een kwantitatief. Zonder golden fixtures die dit testen, degradeert het naar jargon. Needs explicit prompt-engineering aandacht en golden-ticket evals (AI_QUALITY_AND_EVALS §3).

- **Dedup is onderschat.** Als de Interviewer elke week draait en 70% van de vragen variaties zijn op vorige batches, haakt de gebruiker af. Dedup tegen answered QuestionSets via embeddings is noodzakelijk, niet optioneel.

- **De grens met de intake co-pilot vervaagt.** Beide interviewen de user. Beide gebruiken QuestionCards. Zonder duidelijke UX-afbakening (verschillende entry-point, verschillende tone-of-voice in het systeem-prompt) voelen ze als dezelfde feature.

- **Answer-queue vervuiling.** Als de Interviewer grote batches produceert (20+ vragen), overspoelt het de answer-queue die ook blocking ticket-gates bevat. Een prioriteitslaag of aparte sectie in de queue is nodig — maar de huidige queue-spec (addition 05) heeft alleen `oldest-blocking-first` sortering, geen prioriteit per bron.

- **Scope van de RAG-scan.** Scant de AI de hele codebase? Alleen de laatste sprint? Alleen de tickets? De scopekeuze bepaalt de relevantie van de vragen. Zonder expliciete scoping krijg je ofwel te breed (onherkenbare vragen over modules die de user nooit aanraakt) of te nauw.

- **No new verbs + async QuestionSet = ontwerp-frictie.** De bestaande `request_input` is blocking. Een persistentie-pad voor niet-blocking Interviewer QuestionSets zonder nieuwe verbs vereist een slim control-API op (zie additionalIdeas). Als dit niet goed uitgewerkt wordt, gaan developers ad-hoc hacks toepassen.

---

## Extra ideeën

### 1. Interview-scope selector
Laat de user vóór het starten de scope kiezen: "heel project", "alleen open tickets", "de laatste twee weken commits", "specifiek feature X". Dit maakt de vragen relevanter en de beurt goedkoper (minder context te lezen). Implementatie: een simpele `InterviewScopeConfig` parameter die de one-shot reasoner als seed-context meekrijgt.

### 2. Antwoord-geheugen als prompt-context voor volgende interview
Bewaar accepted antwoorden als een lichtgewicht "project-direction log" (een verzameling `WorkspaceSuggestion` rows met `status:'accepted'` gemarkeerd als `interviewOrigin:true`). Injecteer dit als context in de volgende interview-sessie zodat de AI bouwt op wat al beslist is en geen vragen herhaalt die al beantwoord zijn. Dit is de dedup-oplossing die ook waarde toevoegt.

### 3. Interviewer als onboarding voor een nieuw project
Trigger automatisch een Interviewer-sessie bij het aanmaken van een nieuw workspace (na de codebase-onboarding van addition 04). De AI stelt 5-8 fundamentele "dit moet ik weten over jouw product"-vragen die de PRODUCT.md, de pipeline-presets-keuze en de eerste tickets informeren. Dit is een hoge-waarde, lage-frequentie trigger die de user niet irriteert.

### 4. "Vorig interview"-weergave
Een minimalistische history-tab in het Interviewer-scherm: per sessie een datum, het aantal vragen, het percentage beantwoord, en de geaccepteerde ideeën die eruit kwamen. Dit is puur een read-projectie van bestaande `WorkspaceSuggestion` en `QuestionSet` data — geen nieuwe persistentie. Helpt de user bijhouden wat de AI al gevraagd heeft.

### 5. Vraag-kwaliteitsfeedback
Na het beantwoorden van een batch, een éénmalige "Waren deze vragen nuttig? (1-5 sterren + optionele opmerking)". Dit voedt direct het `PromptFeedback` / few-shot bank mechanisme (AI_QUALITY_AND_EVALS §5) zodat de interview-prompts per workspace verbeteren. Dezelfde infra als de bestaande feedback-loop, alleen toegepast op de Interviewer-role's systeem-prompt.

### 6. Niet-blocking QuestionSet control-API op
Een nieuw `create-interview-questionset` control-API op (CONTROL_API §8 toevoeging) dat een `QuestionSet` persisteert zonder een levende agent te blokkeren. De one-shot reasoner produceert de `Question[]` en sluit af; de Conductor schrijft de set; de user beantwoordt asynchroon. Dit is de correcte oplossing voor de "geen blocking maar toch QuestionSet" spanning, en het is een kleine uitbreiding van het bestaande op-catalogue zonder nieuwe verbs.

---

## Vragen

### V-1 · Initiatietrigger: on-demand vs. automatisch

**Samenvatting:** Hoe start een Interviewer-sessie — alleen als de user het vraagt, of ook automatisch op een schema?

**Gedetailleerde uitleg:** Elke Interviewer-sessie kost een AI-beurt (een interactieve Claude CLI-sessie). Als je het volledig automatisch doet (bv. elke week), wordt het voor een druk project duur en vervelend als de vragen niet relevant zijn. Als je het alleen on-demand doet, moeten gebruikers er zelf aan denken — wat betekent dat ze het waarschijnlijk nooit opstarten. Een tussenweg is automatisch triggeren maar alleen na een significante codebase-verandering (bv. een grote merge).

**Opties:**

a) **On-demand only** — de user start het zelf via een knop of command-palette. Geen automatische beurt-consumptie. *(Aanbevolen als v1-default: veilig, geen verrassingen.)*

b) **Cron met user-geconfigureerd interval** — elke N weken triggert een interview automatisch. De user kiest het interval in de workspace-instellingen.

c) **Event-driven** — triggert na een significante codebase-verandering (bv. een MR is gemerged of een sprint is afgesloten). Relevanter dan pure cron, maar vereist definitie van "significant."

d) **Hybride** — on-demand altijd beschikbaar, plus een opt-in automatische trigger.

---

### V-2 · Scope van de RAG-scan

**Samenvatting:** Wat leest de AI bij een interview — de hele codebase, alleen recente activiteit, of laat je de user dit kiezen?

**Gedetailleerde uitleg:** Als de AI de héle codebase scant, kan hij vragen stellen over modules die de user al jaren niet aanraakt — irrelevant. Als hij alleen de laatste week scant, mist hij structurele gaten in de architectuur. De scope bepaalt de relevantie van de vragen én de kosten van de beurt (meer context = langere sessie = hogere kans op context-overflow).

**Opties:**

a) **Volledige codebase via RAG** — de AI leest de volledige embedding-index. Meest volledig, maar de minst gerichte vragen.

b) **Recente activiteit** (bv. commits + tickets van de laatste sprint) — relevantere vragen voor "wat doe ik nu," maar mist lang-termijn gaten.

c) **User kiest scope vóór starten** — een simpele selector: "heel project / recent / specifiek feature." Meest flexibel, maar vraagt een extra UX-stap. *(Aanbevolen: dit geeft de beste trade-off tussen relevantie en kosten.)*

d) **AI kiest zelf** — de AI bepaalt zijn eigen scope op basis van wat hij "interessant" vindt. Minst voorspelbaar, maar potentieel de meest waardevolle vragen.

---

### V-3 · Vraagbatch grootte en aansturing

**Samenvatting:** Hoeveel vragen produceert een interview-sessie, en wie bepaalt dat?

**Gedetailleerde uitleg:** Tien vragen voelen beheersbaar. Veertig vragen voelen als huiswerk. Maar als de AI geforceerd wordt tot vijf vragen, kan hij de meest waardevolle negen niet vragen. Dit is ook belangrijk voor de answer-queue: als de Interviewer de queue overspoelt, missen gebruikers geblokkeerde ticket-gates (die urgenter zijn).

**Opties:**

a) **Vaste limiet (bv. 8-12 vragen)** — eenvoudig, voorspelbaar, handmatig instelbaar in workspace-config.

b) **AI bepaalt zelf** — de AI produceert zoveel vragen als hij relevant vindt, tot een hard maximum (bv. 25). De user beantwoordt in zijn eigen tempo.

c) **Gespreide batches** — de AI produceert 4-6 vragen per sessie, en na beantwoording kan de user "meer" vragen. Voelt conversationeler, maar vereist meerdere beurten.

d) **Aparte sectie in de answer-queue** — Interviewer-vragen worden gescheiden van blocking ticket-gates weergegeven, zodat grootte minder uitmaakt. *(Aanbevolen in combinatie met optie a/b.)*

---

### V-4 · Gelaagde samenvatting: wie schrijft de `detailedSummary`?

**Samenvatting:** De `detailedSummary` moet begrijpelijk zijn voor een niet-coder — hoe waarborg je die kwaliteit?

**Gedetailleerde uitleg:** De AI genereert de `detailedSummary` als onderdeel van zijn output. Maar "begrijpelijk voor een niet-coder" is een kwalitatief doel dat moeilijk automatisch te meten is. Als je dit niet actief stuurt in het systeem-prompt én test via golden fixtures, degradeert het naar technisch jargon. Tegelijkertijd wil je de user niet laten corrigeren op elke samenvatting — dat is meer werk dan de interview-vragen zelf.

**Opties:**

a) **Puur door het systeem-prompt gestuurd** — de Interviewer-role heeft een expliciete instructie: "schrijf de detailedSummary alsof je uitlegt aan iemand die alleen weet wat het product doet, niet hoe." Golden fixtures testen dit. Geen user-interactie.

b) **User kan de `detailedSummary` editen** — de card toont de AI-gegenereerde versie, maar de user kan het in-place bijwerken. Goed voor correcties, maar verhoogt de friction.

c) **Kwaliteitsfeedback na beantwoording** — na elke batch vraagt het systeem "waren de uitleg begrijpelijk?" en verbetert het over tijd via het PromptFeedback-mechanisme.

d) **Combinatie a + c** *(Aanbevolen)* — systeem-prompt stuurt de kwaliteit strikt, golden fixtures testen het, en feedback verbetert het per workspace over tijd. Geen user-edit-flow nodig in v1.

---

### V-5 · Wat gebeurt er met antwoorden?

**Samenvatting:** Nadat de user de vragen beantwoordt — wat doet het systeem vervolgens met die antwoorden?

**Gedetailleerde uitleg:** Antwoorden kunnen op drie manieren gebruikt worden: (1) direct als richting voor nieuwe tickets, (2) als context voor de volgende interview-sessie (zodat de AI niet dezelfde vragen stelt), of (3) gewoon als een afgesloten beslissing zonder automatische vervolgactie. Het risico van automatische ticket-generatie is dat je tickets krijgt die je niet wil; het risico van niets doen is dat de antwoorden nutteloos blijven.

**Opties:**

a) **Antwoorden worden opgeslagen als project-context, geen automatische actie** — de user ziet een samenvatting van zijn antwoorden, die als context wordt geïnjecteerd in volgende interview-sessies en stage-prompts. *(Aanbevolen als veiligste v1-keuze.)*

b) **Na beantwoorden stelt de AI ticket-voorstellen voor** — de Conductor maakt `WorkspaceSuggestion`-rows die de user kan accepteren als nieuwe tickets. De AI schrijft nooit zelf tickets.

c) **Beide** — antwoorden worden altijd als context opgeslagen, en bij bepaalde antwoorden (bv. "ja, dit wil ik bouwen") genereert de AI optioneel ticket-voorstellen.

d) **User kiest per vraag** — op de antwoord-card een optionele "maak hier een ticket van"-knop. Meest granulaire controle, maar meer UX-complexiteit.

---

### V-6 · Deduplicatie: hoe voorkom je dat dezelfde vraag terugkomt?

**Samenvatting:** Als de Interviewer meerdere keren per maand draait, hoe zorg je dat hij geen vragen herhaalt die al beantwoord zijn?

**Gedetailleerde uitleg:** Zonder deduplicatie irriteert het systeem snel: de AI vraagt elke week of je een dark mode wil toevoegen terwijl je dat al drie keer met "nee" hebt beantwoord. Deduplicatie via embedding-similarity is effectief maar vereist extra infrastructuur. Deduplicatie via simpele keyword-matching is goedkoper maar mist varianten.

**Opties:**

a) **Geen deduplicatie in v1** — accepteer het risico van herhaalde vragen; eenvoudig om te bouwen.

b) **Embedding-similarity tegen answered QuestionSets** — technisch het beste, maar vereist dat answered interview-vragen in de RAG-index landen naast de codebase.

c) **De AI leest de antwoord-history als context** — injecteer een samenvatting van recente antwoorden in het systeem-prompt zodat de AI zelf vermijdt te herhalen. Goedkoper dan embeddings, maar minder precies. *(Aanbevolen als pragmatische v1-aanpak.)*

d) **User markeert "nooit meer vragen"** — per vraag een "niet opnieuw vragen"-optie die de vraag persistent suppressed. Versterkt optie b of c.

---

### V-7 · Aparte Interviewer-screen of geïntegreerd in het bestaande AIPanel?

**Samenvatting:** Krijgt de Interviewer zijn eigen scherm/navigatie-item, of leeft het in het bestaande Workspace-AI panel?

**Gedetailleerde uitleg:** Een apart scherm geeft de Interviewer een duidelijke identiteit en maakt het makkelijker om de interview-history, de voortgang en de geaccepteerde ideeën te tonen. Maar het is ook meer werk om te bouwen en voegt een navigatie-item toe dat alleen waarde heeft als de feature regelmatig gebruikt wordt. Geïntegreerd in het AIPanel is minder werk, maar de Interviewer dreigt te verdwijnen in de ruis van andere Workspace-AI functionaliteit.

**Opties:**

a) **Geïntegreerd als extra tab in het AIPanel** — "Interviewer" naast "Chat", "Signals" en "Suggestions". Lage bouwkosten, maar beperkte ruimte voor een rijke UI.

b) **Aparte screen met eigen nav-item** — een dedicated `/interviewer`-route in de sidebar. Ruimte voor history, voortgang, categorie-filters. Hogere bouwkosten.

c) **Aparte screen, maar verborgen achter een feature-flag of module-toggle** — het screen bestaat, maar verschijnt alleen als de "Interviewer"-module is ingeschakeld in workspace-settings. Toekomstbestendig voor het module-systeem.

d) **Geen eigen screen in v1** — alleen de answer-queue en de AIPanel Suggestions-tab. Start klein, breidt uit als de feature bewezen heeft waarde te leveren. *(Aanbevolen voor v1: valideer eerst, investeer later.)*

---

### V-8 · Hoe interacteert de Interviewer met de bestaande intake co-pilot?

**Samenvatting:** De intake co-pilot (addition 01) en de Interviewer gebruiken allebei QuestionCards en interviewen de user — hoe houd je ze onderscheidbaar?

**Gedetailleerde uitleg:** Beide features stellen vragen, beide gebruiken tap-not-type cards, en beide zijn gerelateerd aan het AI-"begrijpen" van je project. Het risico is dat gebruikers ze door elkaar halen: "is dit de AI die me vraagt hoe ik een ticket wil formuleren, of de AI die me vraagt welke richting het project op moet?" Dit is een UX-probleem, maar ook een product-positioneringsprobleem. De technische primitieven zijn identiek; het verschil zit in de context en de toon.

**Opties:**

a) **Visueel onderscheid via icoontje/kleur** — de intake co-pilot gebruikt een "ticket"-icoon (een taak-gericht ding), de Interviewer een "idee"-icoon (een ampoule of kompas). Zelfde UI-mechanisme, andere visuele identiteit.

b) **Expliciete entry-points** — de intake co-pilot verschijnt alleen bij ticket-aanmaken, de Interviewer alleen via een dedicated startknop. Ze kunnen nooit in dezelfde flow opduiken.

c) **Toon-van-stem verschil in het systeem-prompt** — de intake co-pilot is precies en taakgericht ("wat is de scope van dit ticket?"), de Interviewer is exploratief en strategisch ("waar zie jij groeikansen?"). Zelfde card-component, andere taal.

d) **Alledrie** *(Aanbevolen)* — visueel onderscheid + aparte entry-points + andere toon. Dit is geen keuze maar een ontwerpeis; de vraag is of je dit al in v1 uitwerkt of pas na een eerste gebruikerstest.
