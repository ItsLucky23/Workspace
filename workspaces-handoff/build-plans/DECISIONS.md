# Beslissingen-log — open punten uit de bouwplannen

> Vastgelegd 2026-06-15 op basis van de antwoorden van de gebruiker op de openstaande vragen. Deze beslissingen zijn bindend voor de plannen in deze map; waar een plan iets anders zei, geldt dit log.

## Raamwerk

| # | Beslissing |
|---|---|
| 1 | Module-default-triggers worden **als suggestie** aangeboden (user accepteert), niet automatisch geseed. (framework O4 → optie b, conform B-23) |
| 2 | Live-referentie: een Stage-Agent krijgt de artifact-versie mee **bij de start van de stage**; latere wijzigingen bereiken een lopende sessie niet. Akkoord voor V1, expliciet documenteren in de Conductor. (framework O2) |

## Interviewer

| # | Beslissing |
|---|---|
| 3 | **GEEN harde max** op het aantal vragen. In plaats daarvan: korte **batches** (`batchSize` 6) van de meest waardevolle cards; na elke batch vraagt de UI "wil je nog door?" → volgende batch, of **pauzeren en later hervatten** (sessie is resumable, `status: paused → active`). De reasoner krijgt expliciet mee dat een user niet graag 30+ vragen beantwoordt en moet zuinig/prioriterend zijn. (vervangt INT-6; plan `01-interviewer.md` is hierop bijgewerkt) |
| 4 | Een idee-kaart wordt pas een `WorkspaceSuggestion` **ná expliciet Accepteren**. (INT-1, B-23) |
| 5 | Interviewer-kaarten krijgen een **eigen subtiele badge** op het sidebar-item; ze tellen **niet** mee in de TopBar-answer-queue-badge (die blijft voor blocking ticket-gates). (AQ-INTERVIEWER-PRIO) |
| 6 | Sessie starten: **subtiele niet-blokkerende banner**, geen confirm-dialoog. |
| 7 | Bij voltooiing **ook een push-notificatie** (`Notification(type:'ai-suggestion')`) als de user niet in de app is. (INT-3) |
| 8 | Een gewoon workspace-lid (niet-admin) **mag** een sessie starten (`work-on-tickets` RBAC volstaat). (INT-5) |
| 9 | "Herstel/fork vorige sessie": **V2**, niet V1. |

## Designer

| # | Beslissing |
|---|---|
| 10 | De always-on `main` preview-server is **opt-in per workspace** (standaard aan op de hoofd-host). Het permanente container-slot wordt bewust in het capaciteitsbudget meegerekend. |
| 11 | Build-check op gegenereerde designs is **optioneel** per workspace (waarschuwen, niet blokkeren) — niet afgedwongen in V1. |

## Marketing (V1 = setup)

| # | Beslissing |
|---|---|
| 12 | Een asset-aanvraag mag **zonder skill** worden opgeslagen (skill optioneel, met UI-waarschuwing). (MKT-3) |
| 13 | Marketing-kaarten zijn in V1 **niet** zichtbaar in Backlog/Board; ticket-koppeling is V2. (MKT-5) |

## Document

| # | Beslissing |
|---|---|
| 14 | **Hallucinatie-vangnet in V1:** na generatie een check die flagt als de AI bronverwijzingen produceert die niet in de geladen bronnen voorkomen → emit een `needs-input` ("kon niet alles verankeren; citaties aanzetten of meer bronnen?"). |
| 15 | Round-trip **ondersteunde subset**: standaard-opmaak behouden, complexe opmaak (geneste tabellen, animaties, embedded media) vereenvoudigen, en netjes falen bij lege extractie — gecommuniceerd in de UI. |
| 16 | De storage-abstractie wordt in V1 **alleen** gebruikt door Document + Marketing (governance, voorkomt wildgroei van de seam). |

## Niet-beslissingen (bouwer-taken, geen user-input nodig)

Meten/inventariseren door de bouw-AI: echte LibreOffice/PowerPoint-render-kosten op de referentiehost · design-agent-sessiekosten · bestaan van een herbruikbare `ContextSelector`/`WorkspaceFeature`-component · `generatingTimeout` (10 min) · context-token-cap (start ~20–40k, meten) · `MEDIA_API_KEY`-naamgeving · golden-fixture-setup voor CI · security-review op de upload-parse-sandbox + ADR voor de D74-override.
