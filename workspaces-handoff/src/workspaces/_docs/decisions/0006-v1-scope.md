---
title: V1-scope — tools ná v1, geen preview-meters, monitoring-dashboard WEL, AI-kwaliteitstest WEL
status: accepted
date: 2026-06-22
covers: [G-SEQ-3, G-SCOPE-1, G-SCOPE-2, G-SCOPE-3, G-OBS-3, G-XB-1, G-XB-2, G-ENV-3, G-SPIKE-2]
---

## Context
De scope van versie 1 botste tussen plannen: zaten de tool-modules erin, de preview-meters, de losse "denker", het monitoring-dashboard en de AI-kwaliteitstest? Deze ADR snijdt de v1-scope vast.

## Beslissing
- **Tool-modules ná v1 = v2 (G-SEQ-3):** de tool-modules (Interviewer, Designer, Marketing, Document, ...) komen pas ná versie 1 (v2). Dit is een fasering, géén schrapping: de modules gelden als een GROOT idee achter het product (Interviewer voorop: features/lange termijn uitschetsen, nieuwe features bedenken, verbetervoorstellen). **Uitzondering:** de image-builder zit wél in v1, gated op de AI-implementatie-laag (zie ADR 0016 + G-IMG-2).
- **Geen preview-meters in v1 (G-SCOPE-1):** zolang previews uit de scope zijn, wordt de bijbehorende meet-/alarmcode helemaal niet gebouwd (niet inactief-op-nul). (Live preview / live server blijft post-v1; bevestigd, geen wijziging.)
- **AI-kwaliteitstest WEL in v1 + eigenaar (G-SCOPE-2):** het AI-kwaliteits/eval-systeem zit in v1 met een duidelijk aangewezen eigenaar.
- **Container-lagen: per-project image-/project-laag KOMT in v1 (G-SCOPE-3):** wijziging A→B (eigenaar 2026-06-22) — v1 bouwt naast de basislaag + per-taak ook de complete per-project image-/project-laag, **gated op de AI-implementatie-laag** (ADR 0016). De image-builder mag in v1 maar pas nádat de AI-laag ligt.
- **Monitoring-dashboard WEL in v1 + eigenaar (G-OBS-3):** afwijking van de aanbeveling — v1 krijgt meteen een echt monitoring-dashboard met een aangewezen eigenaar (niet alleen logboek/scherm).
- **Losse "denker" ná v1 (G-XB-1):** het zelfstandige reflectie-onderdeel voor de Interviewer valt buiten v1.
- **Verbruik-uitlezen testen + plan B (G-XB-2):** v1 bevat een testrij die controleert of AI-verbruik betrouwbaar uitleesbaar is, met een plan B als dat niet lukt.
- **Geavanceerde zoek-DB als standaard (G-ENV-3):** v1 draait standaard de geavanceerde (vector-)zoek-database, niet de simpele terugval.
- **Gepland aantal verlagen tot binnen de limiet (G-SPIKE-2):** afwijking van de aanbeveling — het geplande aantal gelijktijdige projecten wordt verlaagd tot wat veilig binnen het leverancier-plafond past (i.p.v. het plafond aftasten tot 6–8).

## Afgewezen alternatieven
- **Tools in v1** (G-SEQ-3 B) — te grote scope (uitgezonderd de image-builder, die wél in v1 zit, gated op de AI-laag — ADR 0016).
- **Per-project-laag pas later** (G-SCOPE-3 A, oude keuze) — verlaten: eigenaar wil de per-project image-/project-laag in v1, gated op de AI-implementatie-laag (ADR 0016).
- **Preview-meters inactief inbouwen** (G-SCOPE-1 B) — dode code, verwarrend.
- **Simpele zoek-terugval als standaard** (G-ENV-3 B) — minder goede resultaten; geavanceerd is standaard.
- **Plafond aftasten tot 6–8** (G-SPIKE-2 A) — risicovol; bewust conservatief begrensd.
- **Monitoring later** (G-OBS-3 A) — eigenaar wil vanaf v1 echt zicht.

## Gevolgen
- Geen preview-/tool-code in de v1-codebase, met één uitzondering: de image-builder + per-project image-/project-laag zitten in v1 (gated op de AI-implementatie-laag, ADR 0016); de overige tool-modules (Interviewer/Designer/Marketing/Document) zijn v2 maar gefaseerd, niet geschrapt — hun toekomstige plek + cross-module data-uitwisseling worden vanaf het ontwerp gerespecteerd.
- AI-eval en monitoring-dashboard zijn v1-deliverables met benoemde eigenaren.
- Vector-zoek-DB is een v1-afhankelijkheid (opstart-stap aanwezig).
- Concurrency-doel in v1 is conservatief begrensd; verbruik-uitlezen heeft een geteste fallback.
