# Build Plan 01 — Interviewer Tool

> Status: DRAFT · Auteur: AI architect · Datum: 2026-06-15  
> Doel: Bouw-gereed spec voor de eerste FeatureModule van het Workspaces-platform. De builder volgt dit document van boven naar beneden; elke bouwstap heeft een verificatieregel.

---

## Doel & V1-scope

### Wat dit levert

De Interviewer is een **standalone tool-pagina** in de workspace-sidebar — hetzelfde navigatieniveau als board, backlog, pipeline en terminals — die één ding doet: de AI leest het project en produceert een batch vragen + ideekaarten die de user asynchroon beantwoordt, het liefst van zijn telefoon.

**Kernloop:**

1. User opent de Interviewer-pagina en tikt "Start interview".
2. Een bevestigingsscherm toont scope-keuze en de kosten-melding ("dit start een AI-sessie").
3. Een one-shot reasoner (een `invoke-workspace-ai`-actie via het bestaande `WorkspaceTrigger`-pad, zie 03 §1.5) leest de codebase via RAG, de open tickets, en de antwoord-history van vorige sessies, en produceert een `InterviewSession` met een gemixte lijst `InterviewCard[]` (vragen én ideekaarten, type-gelabeld per card).
4. De sessie is onmiddellijk persistent. De user beantwoordt cards asynchroon via de one-question-per-screen stepper — ook uren later, ook op een telefoon.
5. Beantwoorde cards worden opgeslagen als `InterviewAnswer`-rows en als `WorkspaceSuggestion(type:'interview-answer')` zodat volgende sessies de antwoord-history als context injecteren (dedup).
6. "Maak ticket" opent het bestaande ticket-create-scherm pre-filled met de card-data (intake co-pilot pad, addition 01).
7. De history-tab toont alle vorige sessies met voortgang en geaccepteerde ideeën.

### V1 omvat

- Eigen tool-pagina (`/workspaces/[wsId]/interviewer`) als FeatureModule, default ON per workspace, via de bestaande feature-toggle infrastructuur.
- Scope-selector vóór het starten: vier vaste opties + vrij tekstveld (zie §UX).
- One-shot reasoner via het bestaande `invoke-workspace-ai`-pad (03 §1.5); geen standing LLM.
- `InterviewSession` + `InterviewCard[]` datamodel (nieuw, zie §Datamodel).
- Stepper UX: phone-first, one-question-per-screen, reuse `QuestionCard` (09 §UI).
- Antwoord-immutability na submit, precies zoals `QuestionSet` (09 §Resolved 3).
- Answer-queue integratie: Interviewer-cards verschijnen als aparte sectie onder blocking ticket-gates (addition 05 §3.1, uitbreiding).
- "Maak ticket"-knop opent ticket-create prefilled (intake co-pilot, addition 01 §3.3).
- History-tab: read-only projectie van vorige sessies, geen nieuwe persistentie.
- Antwoord-history als dedup-context voor de volgende sessie-prompt (interviewer-module.md §Extra idee 2).
- Kosten-melding: subtiele notice ("dit start een AI-sessie"), non-blocking.
- `PromptFeedback`-koppeling na batch: "Waren deze vragen nuttig?" éénmalig per sessie (AI_QUALITY_AND_EVALS §5).

### Expliciet uitgesteld (niet in V1)

| Item | Reden |
|---|---|
| Automatische cron-trigger | Risico op spam; V1 = on-demand only (interviewer-module.md V-1a) |
| Embedding-similarity dedup | RAG-overhead; V1 = antwoord-history-als-context (V-6c) |
| Ticket-voorstellen na beantwoorden (AI genereert batch proposals) | Pas na validatie dat de vragen waarde leveren; user kan per card "maak ticket" kiezen |
| Vraag-kwaliteitsverbetering via A/B-prompt | Infrastructuur bestaat (AI_QUALITY_AND_EVALS §4), maar vraagt een tweede sessie; V1 = one prompt, PromptFeedback capture |
| Voice-antwoorden | Deferred in doc 09 §Deferred |
| "Nooit meer vragen"-suppression per card | V2; dedup via history is voldoende voor V1 |
| Marketing- en Designer-tools | Aparte build plans |

---

## Past op de bestaande corpus

### Wat direct hergebruikt wordt

**`QuestionCard` + one-question-per-screen stepper (09 §UI, 09 §Mobile)**  
De `kind:'choice'` stacked buttons ≥44px, de progress-dots, de `free` textarea, het Submit-na-alle-beantwoord-principe — exact de Interviewer-stepper. Geen fork, geen herwerking. De Interviewer registreert zich als subscriber op het card-component.

**Answer-queue triage stack (addition 05 §3.1, §3.2)**  
Interviewer-cards verschijnen als een aparte sectie in de `AnswerQueueSheet` naast blocking ticket-gates. De `useAnswerQueue()` selector krijgt een tweede bron. Geen nieuwe write-path: answering route via de bestaande `ws-ai:reply`/`[control-API]`-path of een equivalent nieuw `answer-interview-card`-op (zie §Datamodel). De outer swipe-shell en het `EmptyState` worden ongewijzigd hergebruikt.

**`WorkspaceSuggestion` + AIPanel Suggestions-tab (02 §6, 11 §Suggestions)**  
Geaccepteerde ideekaarten worden `WorkspaceSuggestion(type:'interview-answer', status:'accepted')` met `interviewOrigin:true`. Dit maakt ze zichtbaar in de bestaande Suggestions-tab én bruikbaar als context-injectie voor de volgende sessie.

**`invoke-workspace-ai` ActionExecutor-pad (03 §1.5)**  
De one-shot reasoner is een `WorkspaceTrigger{ on:'user-action', action:'invoke-workspace-ai', params.template:'...' }` die on-demand vuurt. De `spawnReasoner(render(template, ctx))`-pad bestaat al. Geen nieuwe scheduler of cron nodig voor V1.

**RAG delta-indexer (07 §D)**  
De reasoner leest de codebase via de bestaande embeddings. Geen nieuwe indexing-infrastructuur.

**AgentRole plugin model (03 §3)**  
De Interviewer registreert een lichtgewicht `AgentRole{ key:'interviewer', needsWorkspace:false, ... }` — geen container, geen worktree, alleen een reasoner-sessie. Dit is conform het `needsWorkspace:false` pad dat ook Refine/Plan volgen.

**PromptFeedback + PromptABTest (AI_QUALITY_AND_EVALS §4-5)**  
Kwaliteitsverbetering van het interview-systeem-prompt via de bestaande feedback-loop. De Interviewer-role's systeemprompt is een `PromptVersion` row; user-feedback na een sessie wordt een `PromptFeedback` row. Identieke infra als de pijpline-stages.

**FeatureModule toggle (locked general tool model)**  
De Interviewer is een `FeatureModule{ core:false, key:'interviewer' }` die per workspace aan/uit te zetten is in de workspace-instellingen. De bestaande feature-toggle infra (sidebar items tonen/verbergen, settings-tab) wordt hergebruikt. Hoe exact FeatureModules geregistreerd worden, moet afgeleid worden uit de bestaande sidebar-configuratie-code.

### Spanningen met locked decisions

**Geen standing Coordinator (02 §2, locked)**  
De reasoner is one-shot en sluit af na het produceren van de batch. De `InterviewSession` wordt persistent via de Conductor na de `spawnReasoner`-call, niet door een levend LLM-proces. De user beantwoordt asynchroon; er is nooit een open LLM-verbinding tijdens het beantwoorden.

**Geen nieuwe verbs (02b §A, locked)**  
Het persisteren van de `InterviewSession` na de reasoner-run gaat via een nieuw `[control-API]` op `create-interview-session` (zie §Datamodel §5). Dit is een kleine uitbreiding van de bestaande op-catalogus (CONTROL_API §8), niet een nieuw verb in het structured-channel (02 §2). De reasoner *produceert* de cards als output van zijn reasoner-sessie (via `emit_carryover`-equivalent of rechtstreeks in zijn output-JSON); de Conductor schrijft ze naar de DB.

**B-23 proposes only (locked)**  
De Interviewer mag nooit zelf tickets aanmaken. Na "Maak ticket" → opent het bestaande ticket-create-scherm prefilled (addition 01 §3.3 `quick-add`-pad) — de user tikt Create. Als de AI na beantwoording ticket-voorstellen zou maken (V2), gaat dat via `propose_suggestion` → user Accept → Conductor schrijft.

**PTY-billing locked**  
De one-shot reasoner is een interactieve `claude` PTY (V1_SCOPE §1). Dit kost een subscription-turn. De UI meldt dit expliciet vóór het starten. Kosten-transparantie is architectureel, niet optioneel.

**QuestionSet antwoord-immutability (09 §Resolved 3, locked)**  
Na Submit zijn antwoorden onveranderbaar. Iteratieve verdieping = nieuwe `InterviewSession`. De Interviewer hanteert hetzelfde immutability-model als `QuestionSet`.

**Single-instance orchestrator constraint (07 §A)**  
De `spawnReasoner`-call voor de Interviewer valt onder de Redis-lease van de orchestrator. De Interviewer mag geen parallelle reasoner-sessies spawnen voor dezelfde workspace; de UI-knop is disabled terwijl een sessie wordt aangemaakt.

---

## Datamodel

### Nieuwe entiteiten

#### `InterviewSession`

```prisma
model InterviewSession {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId   String   @db.ObjectId
  status        String   // 'generating' | 'open' | 'answered' | 'partial'
  scopeConfig   Json     // InterviewScopeConfig (zie hieronder)
  cards         InterviewCard[]   // embedded array OF sub-documents (MongoDB) of relation
  answerHistory Json[]   // snapshot van vorige antwoorden geïnjecteerd als dedup-context
  createdAt     DateTime @default(now())
  completedAt   DateTime?
  reasonerSessionId String?   // de AgentSession-id van de one-shot reasoner (audit)
  feedbackGiven Boolean  @default(false)   // was PromptFeedback al gevraagd na deze sessie?

  @@index([workspaceId, status])
  @@index([workspaceId, createdAt])
}
```

**`InterviewScopeConfig` (JSON-veld):**

```ts
interface InterviewScopeConfig {
  mode: 'full' | 'recent' | 'feature' | 'tickets-only';
  // 'full' = volledige codebase via RAG
  // 'recent' = commits + tickets van de laatste 2 weken
  // 'feature' = specifieke folder/feature (vrij tekstveld hieronder)
  // 'tickets-only' = alleen open tickets, geen code
  freeText?: string;   // vrij tekstveld (optioneel, voor mode:'feature')
  batchSize: number;   // cards per batch, default 6 (kort houden — users beantwoorden niet graag 30+ vragen)
}
// BESLISSING 2026-06-15: GEEN harde max op het totaal. De reasoner levert per keer
// een korte BATCH (~batchSize) van de meest waardevolle cards. Na een batch vraagt
// de UI "wil je nog door?" → volgende batch, of pauzeer en kom later terug
// (InterviewSession is resumable: status 'paused' → 'active'). De reasoner krijgt
// expliciet mee dat een user niet graag lange lijsten (30+) beantwoordt.
```

#### `InterviewCard`

Embedded in `InterviewSession.cards` (MongoDB sub-document) OF een aparte relation-model afhankelijk van de DB-keuze. Elk card is ofwel een vraag ofwel een ideekaart.

```ts
interface InterviewCard {
  id: string;              // lokale UUID binnen de sessie
  type: 'question' | 'idea';
  // 'question' = de user moet iets beslissen
  // 'idea' = de AI surfact iets; de user kan Accept/Dismiss/Snooze

  // Drie-laags informatie-dichtheid (interviewer-module.md §2):
  title: string;           // ≤ 60 tekens; de card-header
  summary: string;         // 1-2 zinnen; begrijpbaar voor een niet-coder
  detailedSummary: string; // uitleg alsof je uitlegt aan iemand die alleen het product kent

  // Voor type:'question':
  kind?: 'choice' | 'free';   // reuse van QuestionCard-kinds (09 §UI)
  choices?: string[];          // voor kind:'choice', max 6 (09 §Resolved 5)

  // Voor type:'idea':
  // answer via Accept/Dismiss/Snooze (WorkspaceSuggestion-semantiek)

  // Antwoord-state (immutable na submit):
  status: 'open' | 'answered' | 'accepted' | 'dismissed' | 'snoozed';
  answer?: string;         // voor kind:'free' of kind:'choice' (gekozen optie)
  answeredAt?: string;
}
```

**Rationale voor de drie-laags aanpak:** dit is de brug tussen de technische reasoner en de niet-technische stakeholder (interviewer-module.md §2). De `title` is de card-header die je op je telefoon scant; de `summary` geeft context; de `detailedSummary` is voor als je wil begrijpen *waarom* de AI dit vraagt. Als de AI alleen een `title` produceert, is de functie waardeloos voor een niet-technisch teamlid. De systeem-prompt dwingt dit schema af (zie §Bouwstappen fase 3).

#### `InterviewAnswer` (denormalized log)

```prisma
model InterviewAnswer {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId     String   @db.ObjectId
  sessionId       String   @db.ObjectId   // → InterviewSession
  cardId          String               // lokale card-id binnen de sessie
  answer          String?              // tekst voor free; gekozen optie voor choice
  disposition     String?              // 'accepted' | 'dismissed' | 'snoozed' voor idea-cards
  createdAt       DateTime @default(now())

  @@index([workspaceId, sessionId])
}
```

Dit is het duurzame antwoord-log dat als context wordt geïnjecteerd in volgende sessies. Het is append-only en nooit gemuteerd na write (conform het no-mutation posture van het systeem).

#### Control-API uitbreiding (CONTROL_API §8 additionele rows)

Twee nieuwe ops in de bestaande `[control-API]`-catalogus (geen verbs):

| `op` | Target | RBAC | Conductor action |
|---|---|---|---|
| `create-interview-session` | `{ workspaceId, scopeConfig }` | work-on-tickets | Spawn reasoner via `invoke-workspace-ai`; persist `InterviewSession(status:'generating')`; flip naar `'open'` na afloop |
| `answer-interview-card` | `{ sessionId, cardId, answer?, disposition? }` | work-on-tickets | Persist `InterviewAnswer`; update `InterviewCard.status`; als alle cards beantwoord → `InterviewSession.status:'answered'` |

Beide routes zijn `login:true` + `preApiExecute` RBAC → enqueue signal → `ControlAck`. De Conductor is de enige schrijver. Geen nieuw verb in 02 §2.

#### Wijzigingen op bestaande modellen

| Model | Delta | Motivatie |
|---|---|---|
| `WorkspaceSuggestion.type` | voeg `'interview-answer'` toe aan de 5-value enum (02 §6, 04b §8) | Geaccepteerde ideekaarten als suggestions persisteren voor history en context-injectie |
| `AnswerQueueItem.source` | voeg `'interviewer'` toe naast `'ticket'` (addition 05 §3.1 projectie) | Queue-items kunnen nu van twee bronnen komen; de sectie-header in de queue toont de bron |
| `PipelineStageCfg`-equivalent | FeatureModule-registratie (per workspace toggle) | Interviewer als optionele FeatureModule |

---

## UX & flows

### Navigatie

De Interviewer verschijnt als een extra item in de workspace-sidebar naast board/backlog/pipeline/terminals. Het item heeft een "kompas"-icoon (ter onderscheiding van de intake co-pilot met zijn "ticket"-icoon — interviewer-module.md V-8a). Het item is zichtbaar als de FeatureModule `'interviewer'` enabled is voor de workspace (default ON).

Route: `src/workspaces/[wsId]/interviewer/page.tsx`

### Scherm 1: Interviewer-landingspagina

```
┌──────────────────────────────────────────────────────┐
│  🧭 Interviewer                              [History]│
│                                                      │
│  De AI leest je project en stelt je de vragen        │
│  die ertoe doen. Beantwoord ze op je eigen tempo.    │
│                                                      │
│  ────────────────────────────────────────────────   │
│  Scope                                               │
│  ● Heel project (via RAG)                            │
│  ○ Recente activiteit (2 weken commits + tickets)    │
│  ○ Specifieke feature: [___________________________] │
│  ○ Alleen open tickets                               │
│                                                      │
│  Vragen komen in korte batches · ga door of pauzeer  │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  ⚡ Dit start een AI-sessie (1 PTY-beurt)    │   │
│  │  Kosten variëren met scope-keuze.            │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│            [ Start interview ]                       │
│                                                      │
│  Vorige sessie: 8 juni · 9 vragen · 7 beantwoord    │
│  [Open vorige sessie]                                │
└──────────────────────────────────────────────────────┘
```

- De kosten-melding is een `Banner` component (niet een blocking confirm), subtiel, non-blocking (conform locked design: "subtle non-blocking notice").
- "Start interview" → disabled zodra een sessie `status:'generating'` is voor deze workspace.
- "Open vorige sessie" → navigeert naar de stepper van de meest recente open/partial sessie.
- `[History]` → interne tab-wissel naar het History-scherm (scherm 3).

### Scherm 2: Stepper (phone-first, ALTIJD)

Het locked design schrijft ALWAYS stepper voor, one question per screen, phone-first. Dit is geen optionele mobile-variant — het is de enige manier om cards te beantwoorden.

```
Mobile                                  Desktop (centered, max-w-lg)
┌───────────────────────────────┐      ┌───────────────────────────────┐
│  🧭 Interview · 4 van 9       │      │  🧭 Interview · DEV-WSID      │
│  ● ● ● ○ ○ ○ ○ ○ ○           │      │  ─────────────────────────────│
│  ─────────────────────────── │      │  ● ● ● ○ ○ ○ ○ ○ ○   4/9    │
│                               │      │                               │
│  Vraag                        │      │  💡 Idee                      │
│  Welk authenticatiepad        │      │                               │
│  wil je als eerste bouwen?    │      │  Overweeg een rate-limiter    │
│                               │      │  op je login-endpoint         │
│  De AI heeft gezien dat er    │      │                               │
│  twee incomplete flows zijn:  │      │  Je API accepteert momenteel  │
│  Microsoft OAuth en email/    │      │  onbeperkt login-pogingen.    │
│  wachtwoord. Welke eerst?     │      │  Een eenvoudige rate-limiter  │
│  [Meer uitleg ▼]              │      │  voorkomt brute-force.        │
│                               │      │  [Meer uitleg ▼]              │
│  ┌───────────────────────┐   │      │                               │
│  │  Microsoft OAuth      │   │      │  [ Accepteer ]  [ Sla over ]  │
│  ├───────────────────────┤   │      │  [ Afwijzen  ]               │
│  │  Email + wachtwoord   │   │      │                               │
│  └───────────────────────┘   │      │  [ Maak ticket van dit idee ] │
│                               │      └───────────────────────────────┘
│  [ Overslaan ]  [ ← Terug ]  │
└───────────────────────────────┘
```

**Card-types:**

- `type:'question', kind:'choice'` → grote stacked buttons ≥44px, één tap = antwoord + automatisch volgende vraag.
- `type:'question', kind:'free'` → textarea, keyboard omhoog, "Volgende →"-knop na typen.
- `type:'idea'` → drie knoppen: Accepteer / Afwijzen / Sla over (= Snooze). Plus optionele "Maak ticket van dit idee"-knop die de ticket-create sheet opent prefilled.

**"Meer uitleg"** toggle: ontvouwt de `detailedSummary`. Default verborgen om de phone-UX schoon te houden.

**Navigatie:**
- Progress-dots rij bovenaan (9 dots, huidige filled).
- "← Terug" gaat naar de vorige card (antwoord is nog niet gesubmit → bewerkbaar).
- "Overslaan" verschuift de card naar het einde van de stack (AQ-4 equivalent — schrijft niets, card blijft `open`).
- Einde van een batch: keuze **"Nog meer vragen?"** → volgende batch (de reasoner levert de eerstvolgende meest waardevolle, zonder herhaling), of **"Klaar voor nu"** → batch-submit van beantwoorde cards. De sessie blijft **resumable** (status `paused`) en is later te hervatten vanuit history.

**Na afronden:**
Éénmalige PromptFeedback-vraag: "Waren deze vragen nuttig? (1–5 sterren + optionele opmerking)" — als `feedbackGiven:false` op de sessie. Simpel, niet blokkerend; na invullen of overslaan → history-scherm.

### Scherm 3: History

Read-only projectie. Geen nieuwe persistentie — alles uit bestaande `InterviewSession`-rows.

```
┌──────────────────────────────────────────────────┐
│  🧭 Interviewer  [ Start nieuw ]        [← Terug]│
│                                                  │
│  8 jun 2026 · Heel project · 9 vragen            │
│  ████████░ 7/9 beantwoord                        │
│  3 ideeën geaccepteerd · [Open]                  │
│                                                  │
│  1 jun 2026 · Recent · 6 vragen                  │
│  ██████░░░ 6/6 beantwoord (volledig)             │
│  1 idee afgewezen · [Bekijk]                     │
└──────────────────────────────────────────────────┘
```

Tappen op "Open" herneemt een partial sessie in de stepper.  
Tappen op "Bekijk" opent een read-only weergave van een afgesloten sessie.

### Answer-queue integratie (addition 05 uitbreiding)

Open Interviewer-cards verschijnen als een **aparte sectie** in de `AnswerQueueSheet` onder de blocking ticket-gates:

```
┌─ Wacht op jou · 6 ────────────────────────────[✕]┐
│  BLOKKERENDE GATES  (3)                           │
│  ❓ DEV-1241 · needs-input · 6m                   │
│  ...                                              │
│  ──────────────────────────────────────────────   │
│  INTERVIEW-VRAGEN  (3)  · 8 jun                   │
│  🧭 Welk auth-pad eerst?                          │
│  [Beantwoord] →                                   │
└───────────────────────────────────────────────────┘
```

Prioriteitsregel: blocking ticket-gates (oldest-blocking-first) altijd boven Interviewer-cards. Interviewer-cards worden gesorteerd op `InterviewSession.createdAt` (oudste sessie eerst).

### Make-ticket prefilled flow

Op elke `type:'idea'`-card staat een "Maak ticket van dit idee"-knop. Tappen opent de `IntakeCopilotSheet` (addition 01 §3.3) prefilled met:

- `title`: `card.title`
- `description`: `card.summary + '\n\n' + card.detailedSummary`
- `labels`: `['interview-idea']` (auto-label)
- `Ticket.intakeStatus`: `'copilot'`

De intake co-pilot kan verder interviewen als een turn beschikbaar is; anders werkt het als de plain `QuickAddSheet` fallback. De Interviewer schrijft nooit zelf een ticket (B-23).

Op `type:'question'`-cards is er géén "Maak ticket"-knop in V1. De vraag is bedoeld voor richting-beslissing, niet voor een direct ticket. (V2 kan dit toevoegen als de user-test dit vraagt.)

---

## Bouwstappen (geordend)

### Fase 1 — Datamodel & control-API (backend)

**1.1 — Prisma-schema uitbreiden**

- Voeg `InterviewSession`-model toe met alle velden uit §Datamodel.
- Voeg `InterviewAnswer`-model toe.
- Voeg `'interview-answer'` toe aan `WorkspaceSuggestion.type`-enum.
- Voeg `'interviewer'` toe aan de FeatureModule-registratie (afhankelijk van bestaande feature-toggle infra).
- Voeg `InterviewScopeConfig` toe als TypeScript interface in `_data/types.ts`.
- Voeg `InterviewCard` toe als embedded type in `types.ts`.

Verificatie: `npm run build` clean; `prisma generate` zonder fouten; `npm run lint` zero warnings.

**1.2 — Control-API ops toevoegen**

- `src/workspaces/_api/create_interview_session_v1.ts` — `rateLimit:5` (max 5 per workspace per dag), `method:'POST'`, `auth:{login:true}`. Handler: RBAC `work-on-tickets` → validate `scopeConfig` → enqueue `WorkspaceSignal` → `ControlAck`.
- `src/workspaces/_api/answer_interview_card_v1.ts` — `rateLimit:60`, `method:'POST'`. Handler: RBAC `work-on-tickets` → validate `sessionId`/`cardId` → validate answer/disposition → enqueue → `ControlAck`.

Verificatie: `npm run scaffold:test workspaces/create_interview_session/v1` + happy-path test geschreven; `npm run test` groen; ongeautoriseerde caller krijgt `reason:'rbac'`.

**1.3 — Conductor-handlers**

- Signal-consumer voor `create-interview-session`: persist `InterviewSession(status:'generating')`, bouw de `InterviewScopeConfig`-context, roep `invoke-workspace-ai` aan met de interview-systeem-prompt-template (zie fase 3), wacht op output, persist cards, flip `status:'open'`, emit `ws-ai:interviewer-ready {sessionId}`.
- Signal-consumer voor `answer-interview-card`: persist `InterviewAnswer`, update `InterviewCard.status` in de embedded array, check of alle cards beantwoord zijn → flip `InterviewSession.status:'answered'`.
- `runInTenant(workspaceId, ...)` om beide handlers (vereist, 04b §11c).

Verificatie: golden-fixture test (TESTING_STRATEGY §3 `FakeEngineDriver`-aanpak): gegeven een seed `InterviewSession(status:'generating')` + een gesimuleerde reasoner-output → `status:'open'` + cards persistent; gegeven `answer-interview-card` ops voor alle cards → `status:'answered'`.

### Fase 2 — AgentRole + reasoner-prompt (orchestrator)

**2.1 — AgentRole registreren**

```ts
registerAgentRole({
  key: 'interviewer',
  label: 'Interviewer',
  needsWorkspace: false,     // geen container, geen worktree
  systemPromptTemplate: '... (fase 3)',
  defaultSkillKeys: ['rag', 'ticket-reader'],
  outputSchema: {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: { /* InterviewCard schema */ },
        maxItems: 20
      }
    },
    required: ['cards']
  },
  artifactKind: 'interview-batch',
  ingest: (raw, ctx) => parseInterviewCards(raw.cards, ctx.sessionId),
});
```

Verificatie: `listAgentRoles()` retourneert `'interviewer'`; `needsWorkspace:false` zorgt dat de launch-sequentie (07 §A) geen container start.

**2.2 — `invoke-workspace-ai`-trigger configureren**

De `create-interview-session`-signal-consumer gebruikt de bestaande `ActionExecutor`-path (03 §1.5):

```ts
ActionExecutor({ action: 'invoke-workspace-ai', params: {
  template: buildInterviewerTemplate(session, answerHistory, ragContext)
}})
```

`buildInterviewerTemplate` bouwt de prompt uit:
- Workspace-metadata (naam, tech stack uit PRODUCT.md).
- Scope-context (afhankelijk van `scopeConfig.mode`: RAG-chunks / recente commits / open tickets).
- Antwoord-history van vorige sessies (dedup-context): samenvatting van geaccepteerde antwoorden en afgewezen ideeën, max 1500 tokens.
- Het output-schema voor de cards (JSON-schema als instructie in de prompt).

Verificatie: met een seed workspace + twee vorige sessies produceert de template een prompt die de RAG-context + antwoord-history bevat; de prompt bevat het JSON-output-schema voor cards.

### Fase 3 — Systeem-prompt content (kwaliteitslaag)

De interview-`AgentRole.systemPromptTemplate` is het kritiekste onderdeel. De kwaliteit van de vragen is de enige echte differentiator. Schrijf hem conform AI_QUALITY_AND_EVALS §2-principes:

```text
Je bent de Interviewer-rol van een AI-dev-orchestrator. Je taak: lees het project
en produceer een batch GERICHTE vragen en ideeën die de developer helpen richting
te kiezen — niet vragen die je vanuit de code kunt beantwoorden, maar vragen die
ALLEEN de developer kan beantwoorden.

KWALITEITSREGELS:
- Elke card heeft een title (≤60 tekens), een summary (1-2 zinnen, begrijpbaar
  voor iemand die het product kent maar de code niet), en een detailedSummary
  (uitleg van het probleem + waarom het nu relevant is, zonder jargon, voor een
  niet-coder). Als je een technisch begrip gebruikt in de detailedSummary, leg
  het dan uit. Nooit "dit verwijst naar X" zonder X uitleggen.
- Geen vragen waarvan het antwoord al in de code staat. De developer interviewen
  over iets wat jij al kunt opzoeken, is een mislukking.
- Geen vragen over features die al beantwoord zijn in de antwoord-history.
  Lees de history-sectie zorgvuldig vóór je vragen formuleert.
- Produceer minimaal 40% choice-vragen (opties opsommen is waardevoller dan
  een lege vrije-tekstvraag).
- Lever één korte BATCH van ~{{batchSize}} cards (default 6) — de MEEST
  waardevolle eerst. GEEN lange lijsten: een user beantwoordt niet graag 30+
  vragen. Stop na de batch; vraagt de user om meer, dan lever je de
  eerstvolgende meest waardevolle batch (zonder eerdere vragen te herhalen).
- Scopediscipline: vraag alleen naar wat relevant is voor de gekozen scope.
  Als de scope 'recent' is, stel dan vragen over de activiteit van de laatste
  twee weken, niet over het algehele architectuurvraagstuk.

OUTPUT: een JSON-object met key 'cards' en een array van InterviewCard-objecten
(schema hieronder). Produceer ALLEEN dit JSON-object, geen andere tekst.

{{outputSchema}}

Antwoord-history (eerder beantwoorde vragen — sla deze topics over):
{{answerHistory}}

Project-context:
{{ragContext}}

Open tickets:
{{ticketContext}}
```

**Golden fixture voor de Interviewer-prompt (AI_QUALITY_AND_EVALS §3):**

Voeg toe aan `_fixtures/golden-tickets/`:

- `GT-INT-001`: een workspace met 5 recente commits en 3 open tickets. Verwacht: ≥4 cards, ≥2 choice-vragen, 0 vragen die al in de code beantwoord zijn, detailedSummary zonder onverklaarde technische termen.
- `GT-INT-002`: een workspace met bestaande antwoord-history. Verwacht: 0 cards die al beantwoorde topics herhalen (dedup-check).
- `GT-INT-003`: een workspace met scope `'tickets-only'`. Verwacht: alle cards hebben betrekking op de open tickets; geen algemene architectuurvragen.

Verificatie: golden replay-harness slaagt voor alle drie fixtures (nul subscription-turns); structural scorer checkt card-schema-validiteit + dedup-invariant.

### Fase 4 — Frontend (Lane C)

**4.1 — Route + pagina-shell**

- `src/workspaces/[wsId]/interviewer/page.tsx` met `template:'dashboard'` (sidebar-layout), `//? intent: tool-pagina voor proactieve AI-vragen over het project`.
- Sidebar-item toevoegen: alleen zichtbaar als `workspace.features.interviewer === true`.
- i18n: alle strings via `useTranslator` (Rule 13).

Verificatie: route wordt gerenderd in de sidebar wanneer de feature enabled is; ontbreekt wanneer disabled; `npm run lint` clean.

**4.2 — Landingspagina-component**

- `InterviewerLanding` component: scope-selector (radio-group met vrij tekstveld voor `mode:'feature'`), batch-uitleg (korte batches · doorgaan/pauzeren), kosten-banner, Start-knop.
- Start-knop roept `apiRequest({ name:'workspaces/create_interview_session', version:'v1', data:{workspaceId, scopeConfig} })` aan.
- Knop disabled terwijl `status:'generating'` of terwijl er al een open sessie is die nog niet beantwoord is.
- "Open vorige sessie" deeplink naar de stepper van de laatste partial/open sessie.

Verificatie: met een gemockte `InterviewSession(status:'generating')` is de knop disabled; na `'open'` is er een redirect naar de stepper.

**4.3 — Stepper-component**

- `InterviewStepper` component: one-question-per-screen, wraps `QuestionCard` (09 §UI).
- Card-mapping: `type:'question', kind:'choice'` → `QuestionCard(kind:'choice')`; `type:'question', kind:'free'` → `QuestionCard(kind:'free')`; `type:'idea'` → eigen `IdeaCard`-component (twee Accept/Dismiss-knoppen + optioneel Sla over, plus "Maak ticket"-knop).
- Progress-dots bovenaan; "← Terug" gaat naar vorige card (pre-submit bewerkbaar); "Overslaan" verschuift naar einde stack.
- Op "Afronden": batch `apiRequest(answer-interview-card)` per beantwoorde card → redirect naar history + PromptFeedback-vraag als `feedbackGiven:false`.
- "Meer uitleg"-toggle voor `detailedSummary` (default verborgen, ontvouwt op tap).
- "Maak ticket van dit idee" op `type:'idea'`-cards → opent `IntakeCopilotSheet` (addition 01) prefilled.
- `prefers-reduced-motion`-safe transitions (reuse `SPRING_*` uit `motion.tsx`).

Verificatie: `choice`-cards behoeven geen keyboard (≥44px tap targets); `free` toont keyboard; Progress-dots tellen correct; "Maak ticket" opent de sheet met correct prefilled data; Submit roept de control-API aan en redirect correct.

**4.4 — IdeaCard-component**

- `IdeaCard`: renders `title`, `summary`, "Meer uitleg" toggle voor `detailedSummary`, drie knoppen: Accepteer/Afwijzen/Sla over (reuse `WsButton`/`IconButton` tokens).
- Accepteer → `disposition:'accepted'` → na submit wordt een `WorkspaceSuggestion(type:'interview-answer', status:'accepted')` aangemaakt door de Conductor.
- "Maak ticket van dit idee": opent `IntakeCopilotSheet` prefilled (addition 01 §3.3).

Verificatie: Accepteer/Afwijzen/Sla-over zetten correct de `disposition`; "Maak ticket"-knop opent de sheet met `title` en `description` correct prefilled.

**4.5 — History-component**

- `InterviewerHistory`: read-only lijst van `InterviewSession`-rows, gesorteerd op `createdAt` desc.
- Per sessie: datum, scope-mode label, voortgangsbalk (`answeredCount/totalCards`), geaccepteerde ideeën count, "Open"-knop (naar stepper) of "Bekijk"-knop (read-only view).
- Read-only view: toont alle cards met hun antwoorden, als `QuestionCard(status:'answered')` of `IdeaCard` met disposition.

Verificatie: sessies staan in omgekeerde chronologische volgorde; een partial sessie heeft een "Open"-knop; een answered sessie heeft een "Bekijk"-knop.

**4.6 — Answer-queue uitbreiding (addition 05)**

- `useAnswerQueue()` selector uitbreiden: naast open `QuestionSet`s ook open `InterviewCard`s (uit open `InterviewSession`s) als tweede bron.
- `AnswerQueueItem.source:'interviewer'` toevoegen aan het type.
- `AnswerQueueSheet` uitbreiden met sectie-header "INTERVIEW-VRAGEN" boven de Interviewer-items (na alle blocking gates).
- Tappen op een Interviewer-item in de queue navigeert naar de `InterviewStepper` op de juiste card (of opent de stepper als sheet overlay).

Verificatie: een open `InterviewSession` met cards verschijnt als aparte sectie in de queue; blocking ticket-gates staan altijd boven Interviewer-cards.

**4.7 — `ws-ai:interviewer-ready` socket handler**

- De Conductor emitteert `ws-ai:interviewer-ready {sessionId, workspaceId}` zodra de sessie van `'generating'` naar `'open'` flipt.
- De client abonneert op dit event en: herlaadt de `InterviewSession`-data, toont een in-app notificatie "Je interview is klaar", update de answer-queue badge.

Verificatie: na het starten van een sessie (gemockt als 'generating') en het ontvangen van het socket-event verschijnt de notificatie en de queue-badge update.

### Fase 5 — Kwaliteit & hardening

**5.1 — PromptFeedback capture**

- Na het afronden van een sessie (als `feedbackGiven:false`): toon een `PromptFeedback`-form met 1-5 sterren + optionele opmerking.
- Bij submit → `apiRequest` naar een bestaande of nieuwe `create-prompt-feedback`-op → persist `PromptFeedback(roleKey:'interviewer', kind:'session-rating', ...)`.
- Flip `InterviewSession.feedbackGiven:true` zodat de vraag niet twee keer verschijnt.

Verificatie: na het afronden van een sessie verschijnt de feedback-form; na invullen of overslaan verschijnt hij niet meer voor dezelfde sessie.

**5.2 — Dedup-context builder**

- `buildAnswerHistorySummary(workspaceId)`: leest de laatste N (default 5) afgesloten `InterviewSession`s, extraheert accepted/dismissed `InterviewCard`s + hun antwoorden, bouwt een leesbare samenvatting (max 1500 tokens), cap op 5 sessies.
- Deze functie wordt aangeroepen in de `create-interview-session`-signal-consumer vóór de reasoner wordt gespawnd.

Verificatie: met 3 vorige sessies produceert de builder een samenvatting die alle geaccepteerde cards bevat; een kaart die al `dismissed` was, staat in de "afgewezen" sectie zodat de AI hem niet opnieuw stelt.

**5.3 — FeatureModule toggle in workspace-instellingen**

- Workspace-settings: nieuwe rij "Interviewer" met aan/uit toggle.
- Standaard ON voor nieuwe workspaces.
- Toggle → control-API op `toggle-feature-module {key:'interviewer', enabled}`.

Verificatie: uitschakelen verbergt het sidebar-item en de route geeft 404 of redirect; inschakelen toont het weer.

**5.4 — Lint, build, i18n pass**

- `npm run lint && npm run build` zero warnings.
- `npm run ai:lint` — controleer op geen `as any`, geen arbitrary kleuren.
- Alle user-facing strings via `useTranslator`.
- Tailwind-tokens only (Rule 14, geen arbitrary hex).

---

## Risico's & open punten

### R-1 — Drie-laags summary kwaliteit is moeilijk te testen

**Risico:** De `detailedSummary` moet begrijpbaar zijn voor een niet-coder. Dit is een kwalitatief doel dat automatische structural checks niet volledig kunnen vangen. Zonder golden fixtures met concrete kwaliteitscriteria degradeert het naar jargon.

**Mitigatie:** Twee lagen:
1. Het systeem-prompt dwingt de kwaliteit af (fase 3) met expliciete instructie: "Als je een technisch begrip gebruikt, leg het dan uit."
2. Golden fixture `GT-INT-001` bevat een structural scorer die checkt op ontbrekende uitleg van technische termen (simpele regex-check op veelvoorkomende tech-buzzwords zonder context). Dit is geen perfecte check maar geeft een vroeg signaal.
3. `PromptFeedback` na elke sessie verzamelt user-oordeel over begrijpelijkheid; bij slechte scores verbetert het prompt over tijd (AI_QUALITY_AND_EVALS §5).

**Open punt:** Hoe definieer je "begrijpbaar voor een niet-coder" machinaal? Een LLM-as-judge (AI_QUALITY_AND_EVALS §3.3 Tier 3) is de correcte oplossing maar kost subscription-turns. Aanbeveling: in V1 alleen golden fixtures + PromptFeedback; V2 = live-lane LLM-judge voor `detailedSummary`-kwaliteit.

### R-2 — Answer-queue vervuiling

**Risico:** Als de Interviewer in één keer veel cards produceert, overspoelt het de answer-queue met niet-blocking items terwijl blocking ticket-gates urgenter zijn.

**Mitigatie:** 
- Sectie-scheiding in de queue is verplicht (fase 4.6): blocking gates altijd boven Interviewer-cards.
- Korte batches (`batchSize: 6` default) i.p.v. één grote dump; de user kiest na elke batch of hij doorgaat.
- Geen harde totaal-max, maar opt-in doorgaan + resumable sessie voorkomt overspoeling (BESLISSING 2026-06-15).

**Open punt (AQ-INTERVIEWER-PRIO):** Wordt de TopBar-badge (addition 05 §3.2) meegeteld voor Interviewer-cards? Aanbeveling: NEE in V1 — de badge telt alleen blocking gates. Interviewer-cards geven een eigen subtiele badge op het sidebar-item (een getal bij het kompas-icoon). Vlag als dit incorrect is.

### R-3 — "Geen nieuwe verbs" vs. async QuestionSet-persistentie

**Risico:** De bestaande `request_input` is een blocking verb. De Interviewer heeft een non-blocking persistentie nodig: de reasoner is al klaar, de cards moeten persistent zijn zodat de user later kan antwoorden.

**Mitigatie (interviewer-module.md §Extra idee 6):** Het `create-interview-session`-control-API-op (fase 1.2) is de correcte oplossing. De Conductor schrijft de `InterviewSession` direct na de reasoner-output, zonder een levende agent te blokkeren. Geen blocking `request_input` nodig, geen nieuwe verb in 02 §2. Het is een uitbreiding van de bestaande op-catalogus (CONTROL_API §8), wat expliciet de bedoeling is ("New feature docs add rows here").

### R-4 — Confusie met intake co-pilot (addition 01)

**Risico:** Beide features stellen vragen aan de user en gebruiken `QuestionCard`. Zonder duidelijke afbakening voelen ze als dezelfde feature.

**Mitigatie (interviewer-module.md V-8, optie d):** Drie lagen:
1. Visueel: kompas-icoon voor Interviewer, ticket-icoon voor intake co-pilot.
2. Aparte entry-points: intake co-pilot alleen bij ticket-aanmaken; Interviewer alleen via de dedicated pagina.
3. Toon-van-stem in de systeem-prompt: intake co-pilot is precies en taakgericht; Interviewer is exploratief en strategisch.

Alle drie moeten in V1 uitgewerkt zijn, anders faalt de UX.

### R-5 — PTY-billing en kosten-verrassing

**Risico:** De user start een sessie, ziet pas achteraf dat het een AI-beurt heeft gekost. Dit geeft frustratie, vooral bij slechte vraag-kwaliteit.

**Mitigatie:**
- De kosten-melding is verplicht vóór elke sessie (fase 4.2), niet alleen bij de eerste.
- De knop heet "Start interview" (niet "Genereer" of "Analyseer") zodat de actie duidelijk is.
- De banner is prominent maar non-blocking — conform locked design.

**Open punt:** moet er een confirmatie-dialoog zijn (menuHandler.confirm) of is de banner voldoende? Aanbeveling: V1 = banner only (non-blocking), conform de locked beslissing "subtle non-blocking notice". Als user-tests wijzen op te veel onbedoelde sessie-starts → V2 = optionele confirm.

### R-6 — Single-instance orchestrator en concurrency

**Risico:** Als twee users tegelijk "Start interview" klikken voor dezelfde workspace, worden er twee reasoner-sessies gespawnd. De Conductor is single-instance (07 §A), maar de reasoner is een one-shot PTY die buiten de Redis-lease wordt gespawnd.

**Mitigatie:**
- Voeg een `interviewSessionLock:{workspaceId}` Redis-SETNX-check toe in de `create-interview-session`-signal-consumer: weiger als er al een sessie `status:'generating'` bestaat voor de workspace.
- De UI-knop is al disabled bij `status:'generating'` (fase 4.2), maar de backend check is de load-bearing guard.

**Open punt (R-6-RACE):** Wat als de reasoner crasht en `status:'generating'` blijft hangen? Voeg een `generatingTimeout` toe: als de sessie langer dan 10 minuten in `'generating'` staat, flip hem naar `'failed'` en unlock. Geef de user een melding.

### R-7 — Scope van de RAG-scan en context-overflow

**Risico:** Bij scope `'full'` kan de codebase te groot zijn om als context in één reasoner-turn te passen. Context-overflow geeft ofwel truncatie of een mislukte sessie.

**Mitigatie:**
- Bij scope `'full'`: gebruik RAG (07 §D) — de reasoner doet embedding-queries, niet een volledige codebase-dump.
- Bij scope `'recent'`: injecteer alleen de commit-diff-summaries en de beschrijvingen van open tickets (compact).
- Cap de totale context-grootte in `buildInterviewerTemplate` op een veilige waarde (bv. 40k tokens voor de context-sectie).

**Open punt (R-7-CTX):** Wat is de veilige max-contextgrootte voor de Interviewer-reasoner? Dit hangt af van het gebruikte Claude-model. Aanbeveling: begin conservatief (20k tokens voor context-sectie), meet in de eerste paar live sessies, schaal op.

### R-8 — Antwoord-immutability vs. user expectations

**Risico:** Na Submit zijn antwoorden onveranderbaar (conform 09 §Resolved 3). Een user die op zijn telefoon snel tikt en dan een antwoord wil aanpassen, vindt dit vervelend.

**Mitigatie:**
- De Interviewer heeft geen blocking agent die wacht op antwoorden. De immutability-regel is minder streng nodig (de agent wacht toch niet).
- Toch: houd de immutability-regel voor consistentie met het bestaande systeem. Communiceer dit duidelijk in de UI: "Antwoorden zijn definitief na Afronden."
- Iteratieve verdieping = nieuwe sessie starten. Dit is de correcte V1-gedragsregel.

**Open punt:** Moet er een "Herstel vorige sessie"-knop zijn die een nieuwe sessie start met de vorige antwoorden als basis (soort van "session fork")? V2-feature; niet in V1.

### Open punten (vlaggen voor de builder)

| id | Vraag | Default / aanbeveling |
|---|---|---|
| INT-1 | Mogen Interviewer-cards ook `type:'idea'` zonder user-keuze direct een `WorkspaceSuggestion` aanmaken, of alleen na expliciet Accepteren? | Alleen na Accepteren (B-23 — AI proposes, user accepts) |
| INT-2 | Hoe wordt de FeatureModule-toggle technisch geïmplementeerd? Exists er al een `WorkspaceFeature`-model? | Inventariseer de bestaande sidebar-configuratie-code; gebruik dezelfde infra als andere optionele features |
| INT-3 | Wordt `ws-ai:interviewer-ready` als een `Notification` (type aanvullen) gefired, of alleen als socket-event? | Aanbeveling: ook als `Notification(type:'ai-suggestion')` zodat de user een push ontvangt als hij niet in de app is |
| INT-4 | Hoe zijn golden fixtures voor de Interviewer-prompt in CI te draaien zonder echte RAG? | Seed een mini `RagEntry`-fixture (zoals `avatar-mini` in AI_QUALITY_AND_EVALS §3.1); de `FakeEngineDriver` retourneert de fixture-chunks |
| INT-5 | Mag een workspace-member (niet admin) een Interviewer-sessie starten? | Ja — `work-on-tickets` RBAC is voldoende (CONTROL_API §5); Interviewer-vragen zijn project-richtinggevend maar geen destructieve actie |
| INT-6 | ~~max-cards default~~ | **OPGELOST 2026-06-15:** geen harde max. Korte batches (`batchSize` 6) + "wil je nog door?"-prompt + resumable sessie; reasoner is expliciet zuinig (geen 30+ vragen) |
