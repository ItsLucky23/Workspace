---
status: accepted
date: 2026-07-17
tags: [eval, pipeline, testing, documents-and-skills]
---

# 0274 — Pipeline role-prompt eval: de replay-helft eerst (structurele scorer op opgenomen turn-events)

## Context

Elke wijziging aan een rol-prompt (refine/plan/implement/review) is ongetest — een prompt-edit die de agent een malformed carry-over laat emitten, buiten de ticket-file-scope laat drijven, een BLOKKERENDE vraag laat stellen waar een advisory hoort, of z'n complexity-score laat vergeten, degradeert de hele pipeline stil. De bestaande `ai:eval`-harness meet iets anders (of de docs-artefacten Claude Code helpen). De user koos in het interview: **replay-helft eerst** (geen subscription-turns), live golden-runs later.

## Decision

Een golden corpus van OPGENOMEN stage-turns (`eval/pipeline/scenarios/GT-001..006.json`) wordt afgespeeld door de ÉCHTE pipeline-code (`parseTurnResult`, `renderPromptTemplate`, de structured-question-codec) en gescoord op structurele invarianten: kind-match, envelope-welgevormdheid (summary/openQuestions), **scope-naleving** (changedFiles tegen `scope.allow`-globs, none in `scope.deny`), **advisories-hebben-assumptie** (een W2-advisory zonder assumptie = een verkapte blokkerende vraag), **complexity 1–10**, **template-volledig-gevuld** (geen resterende `{{chip}}`), question-decode. Géén LLM in de scorer. `npm run ai:eval:pipeline` scoort; `--check` is de CI-gate tegen `baseline.json` (per-ticket-score mag niet dalen); `--write-baseline` herijkt bewust. Elke fixture draagt een `promptVersion` — bij een prompt-wijziging herneem je de turns en bumpt de versie; breken de nieuwe turns een invariant, dan zakt de score → rood.

## Rejected alternatives

- **Live golden-runs nu**: kost echte subscription-turns per run; user koos expliciet replay eerst. De architectuur (zelfde scorer op live-opgenomen turns) laat dit later toe zonder herbouw.
- **De scorer de invarianten laten her-implementeren** (los van de productiecode): dan test hij zichzelf, niet de pijplijn. Door de ÉCHTE `parseTurnResult`/`renderPromptTemplate` te importeren vangt hij regressies in díe code (een gebroken envelope-contract of scope-gate zakt de golden-score).
- **Uitbreiden van de bestaande `ai:eval`**: die grade't een handmatig candidate-record voor docs-artefacten; de pipeline-eval is deterministisch en machinaal — een aparte harness houdt beide zuiver.

## Consequences

- Een codewijziging die `parseTurnResult`/`renderPromptTemplate`/de scope-logica breekt, zakt de golden-score → de `--check`-gate faalt tot code óf baseline bewust bijgewerkt is.
- De corpus is klein (6 tickets, alle stage-types + happy/needs-input/continue/advisory-paden); uitbreiden = één JSON-bestand.
- Live golden-runs blijven een bewuste latere uitbreiding (dezelfde scorer, echte turns).
