---
title: Datamodel-conventies — één signaal-model, kluis-tabel, append-only, StageKind
status: accepted
date: 2026-06-22
covers: [G-DATA-PREVIEWDEPLOYMENT, G-DATA-WORKSPACESIGNAL-BODY, G-DATA-RAGENTRY-INFOSOURCE, G-DATA-INTEGRATIONTOOL-PERSIST, G-DATA-WORKSPACENOTE-BODY, G-DATA-STAGEKIND-DUALREVIEW, G-DATA-STAGEKIND-CUSTOM, G-DATA-QUESTIONSET-ANSWEREDBY, G-DATA-CARRYOVER-CASCADE-CONFLICT, G-MIG-PRESET-SEED, G-MIG-SEED-7-TO-KIND-CONSUMERS]
---

## Context
Het datamodel had open keuzes rond hoe previews, signalen, RAG-stukjes, geheimen, notities, stage-soorten, antwoorden en carry-over-pakketten worden opgeslagen, plus hoe presets geseed en oude stage-namen gemigreerd worden. Deze ADR legt de modelconventies vast die alle bouw-AI's volgen.

## Beslissing
- **Preview = één bij te werken regel per ticket (G-DATA-PREVIEWDEPLOYMENT):** één rij per ticket die je bijwerkt (adres, status, aan/uit), geen append-log.
- **Eén signaal-model (G-DATA-WORKSPACESIGNAL-BODY):** één soort WorkspaceSignal-briefje voor alles, met een veld dat aangeeft of het van mens of AI komt.
- **RAG: alles in één tabel (G-DATA-RAGENTRY-INFOSOURCE):** bestand-herkomst, tekst en embedding-vingerafdruk samen in één tabel.
- **Geheimen in aparte kluis-tabel (G-DATA-INTEGRATIONTOOL-PERSIST):** integratie-secrets in een aparte beveiligde kluis-tabel waar de rest naar verwijst (niet inline versleuteld).
- **Notities zijn append-only met auteur (G-DATA-WORKSPACENOTE-BODY):** notities zijn vaste, niet-wijzigende regels met auteur (mens/AI); een AI mág een notitie achterlaten.
- **StageKind: uniek kenmerk + losse soort (G-DATA-STAGEKIND-DUALREVIEW):** elke stage krijgt een eigen unieke id; de "soort" (bv. review) wordt los daarvan bewaard, zodat twee review-stappen onderscheidbaar zijn.
- **StageKind "custom" (G-DATA-STAGEKIND-CUSTOM):** naast de vaste soorten is er een extra soort `custom` voor zelfgemaakte stappen.
- **AnsweredBy + atomische transitie (G-DATA-QUESTIONSET-ANSWEREDBY):** een questionset krijgt een veld "beantwoord door" en gaat in één atomische stap van open→beantwoord (race-safe).
- **Carry-over: nieuwste pakketje wint (G-DATA-CARRYOVER-CASCADE-CONFLICT):** bij meerdere doorgeef-pakketjes tussen twee stages telt altijd het nieuwste; oudere blijven als geschiedenis.
- **Presets: één centrale lijst (G-MIG-PRESET-SEED):** stappen + standaarden van de drie startpakketten staan in één centrale, idempotent te seeden lijst.
- **Migratie naar nieuwe namen (G-MIG-SEED-7-TO-KIND-CONSUMERS):** bestaande gegevens met oude stage-namen worden via een migratiestap omgebouwd naar de nieuwe namen.

## Afgewezen alternatieven
- **Append-log voor previews** (G-DATA-PREVIEWDEPLOYMENT B) — onnodig zwaar voor één-status-per-ticket.
- **Twee signaal-soorten** (G-DATA-WORKSPACESIGNAL-BODY B) — verdubbelt het doorgeefluik.
- **Embeddings in aparte vector-store** (G-DATA-RAGENTRY-INFOSOURCE B) — uitgesteld; zie ADR 0006 (geavanceerde zoek-DB is standaard, maar het model blijft één tabel).
- **Secret inline versleuteld** (G-DATA-INTEGRATIONTOOL-PERSIST B) — minder isolatie dan een kluis-tabel.
- **Soort+volgnummer als onderscheid** (G-DATA-STAGEKIND-DUALREVIEW B) — breekt bij herordening.
- **Oude namen behouden** (G-MIG-SEED-7-TO-KIND-CONSUMERS B) — laat drift in stand.

## Gevolgen
- Eén `WorkspaceSignal`-tabel met `actor`-veld; één `RagEntry`-tabel; aparte `SecretVault`-tabel.
- `Stage` heeft een stabiele id los van `StageKind` (enum incl. `custom`).
- QuestionSet-transitie moet atomair zijn (compare-and-set).
- Idempotente seed-functie + eenmalige naam-migratie als onderdeel van het database-fundament (ADR 0005).
