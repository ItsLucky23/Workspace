# Workspaces — bouwplannen (kern-tools)

> Gegenereerd 2026-06-15, gegrond in de Workspaces-docs (`../src/workspaces/_docs/`) + de keuzes uit de drie vragenrondes (antwoorden door de gebruiker). Elk plan: doel & V1-scope · past op de corpus (met doc-citaties) · datamodel · UX & flows · geordende bouwstappen · risico's.
>
> **Uitvoering:** deze plannen worden gedraaid via het gefaseerde **[`../BUILD_PROGRAM.md`](../BUILD_PROGRAM.md)** (status in `../BUILD_LOG.md`). De tool-modules `00`–`04` zijn **Fase 3** (na het basisplatform en het AI/pipeline-systeem); **`05-image-builder`** is **Fase 2** (AI stelt stacks/images per instance voor → Admin keurt goed).

## Bouwvolgorde

```
00-framework  ──►  01-interviewer  ──►  02-designer  ──►  03-marketing (setup)  ─┐
   (fundament)        (bouw #1)            (zwaarst)         (alleen skelet)       │
                                                                                   ▼
                                                                          04-document (3e echte tool)
```

`00-framework` is de basis waar alle tools op draaien — bouw die eerst. `01-interviewer` is bewust de eerste echte tool: hij leunt het zwaarst op wat al bestaat (QuestionSet/AIPanel/one-shot reasoner) en bewijst het raamwerk op de simpelste case. Daarna Designer (zwaarst), Marketing (in V1 alleen setup), Document (derde echte tool).

| Plan | Tool | V1 levert |
|---|---|---|
| [00-framework](./00-framework.md) | Gedeeld tool-raamwerk | `ModuleManifest` + `registerModule()`, `WorkspaceModule` aan/uit per workspace, vrije mappenboom, gedeeld Skill-model (`surface`-filter in skills-tab), `ModuleArtifact`-store, artifact→ticket live-reference + picker met semantische zoek |
| [01-interviewer](./01-interviewer.md) | Interviewer (bouw #1) | eigen pagina, one-shot reasoner → batch vragen+ideekaarten, phone-first stepper, scope-selector, make-ticket prefilled, history per folder, dedup via antwoord-history, kosten-melding |
| [02-designer](./02-designer.md) | Designer Studio | N parallelle codebase-bewuste varianten (preview+code), screenshot via always-on main-preview-server, streaming, refine-loop, design-systeem als token-diff, artifacts + ticket-link |
| [03-marketing](./03-marketing.md) | Marketing (V1 = setup) | pagina + folders + marketing-skill-config + aanvraagformulier-skelet (generatie disabled/V2), hergebruik pipeline-context-selector, Playwright-capture via pipeline-terminal, 1 generiek media-API-slot |
| [04-document](./04-document.md) | Document Studio | upload + generatie van echte PDF/Word/Excel/PowerPoint via deterministische omzetter (LibreOffice/pandoc/ffmpeg in sandbox), round-trip, document-skills, grounding+citaties, niveau/toon-controls |
| [05-image-builder](./05-image-builder.md) | **Fase 2** — AI bouwt stacks/images per instance | Stack-wizard + template-catalogus; AI stelt `.workspaces/Dockerfile` voor (`propose_suggestion`) → **Admin keurt goed** → Conductor bouwt L2 + health-check; preview forward-auth. LOCKED: nooit autonoom bouwen |

## Vastgelegde kaders (gelden voor alle plannen)

- Tools = standalone sidebar-pagina's, per workspace aan/uit; **mens-geïnitieerd** (geen autonome ticket-triggers; één opt-in uitzondering voor de Interviewer, standaard uit).
- Respecteert de gelockte Workspaces-constraints: **geen nieuwe verbs**, **Conductor is de enige schrijver / B-23 propose-only**, single-instance orchestrator, subscription-PTY-engine.
- Per-module AI-provider-keuze blijft **geparkeerd** (V1 draait op Claude PTY; Marketing reserveert alleen een integratie-slot).

## Harde grens (Document Studio)

Document Studio bouwt schrijfniveau-, toon- en schone-output-controls (legitieme kwaliteit). Het bevat **geen** functie wiens doel is AI-detectie te omzeilen voor academisch werk dat als eigen werk wordt ingeleverd — geen "make undetectable"-modus, geen detector-gerichte tuning. Zie `04-document.md` §"Harde grens".
