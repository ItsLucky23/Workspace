---
title: Terminal-collaboratie, zoeken met leesrechten, preview-levenscyclus & noodstop-cascade
status: accepted
date: 2026-06-22
covers: [G-14-1, G-14-2, G-14-3, G-21-1, G-21-2, G-23-1, G-23-2, G-23-3, G-24-2, G-24-3]
---

## Context
Gedeelde terminals, de globale zoekbalk, de preview-levenscyclus en de noodstop-cascade hadden open vragen over toegang, leesrecht-filtering, container-opruiming en wat er meegaat bij stoppen.

## Beslissing
- **Gedeelde terminal: samen typen (G-14-1):** twee mensen in dezelfde terminal zien alles en typen samen.
- **Geen-toegang-melding bij ontbrekend recht (G-14-2):** wie wel een sleutel maar geen permissie heeft, ziet een duidelijke "geen toegang"-melding i.p.v. de terminal.
- **Opgeruimde sessie: nette melding + herstart (G-14-3):** een opgeruimde terminal toont "deze sessie is afgesloten" met een herstart-knop.
- **Zoeken doorzoekt alles met toegang (G-21-1):** de zoekbalk doorzoekt alles waar je toegang toe hebt, ook oude items (niet alleen wat ingeladen is).
- **Zoekresultaten leesrecht-gefilterd (G-21-2):** resultaten worden per persoon op leesrechten gefilterd vóór weergave (geen lek via fragmenten).
- **Echt gebruik houdt preview aan (G-23-1):** werkelijk gebruik van een preview houdt hem automatisch in leven (niet alleen een klik).
- **Preview bevroren met "verouderd"-label (G-23-2):** bij pauze of voortgeschoven code blijft de preview op het bevroren moment staan met een "verouderd"-label.
- **Preview-wachtrij FIFO + annuleren (G-23-3):** previews komen eerst-binnen-eerst aan de beurt, met een annuleerknop voor je eigen wachtende verzoek.
- **Noodstop: eerst start-slot, dan stilleggen (G-24-2):** de "pauzeer alles"-noodknop zet eerst een "geen nieuwe starts"-slot en legt dan alles stil, zodat net-startende taken niet ontsnappen.
- **Taak afbreken sluit preview + terminals (G-24-3):** een taak afbreken sluit gekoppelde preview en andermans open terminals, met een duidelijke melding aan die gebruikers.

## Afgewezen alternatieven
- **Beurt-typen in terminal** (G-14-1 B/C) — minder collaboratief; samen typen is gekozen.
- **Preview verlengen alleen via klik** (G-23-1 B) — onhandig tijdens actief gebruik.
- **Urgentie-gestuurde preview-wachtrij** (G-23-3 B) — complexer dan FIFO voor v1.
- **Noodstop pakt alleen bestaande taken** (G-24-2 B) — laat race-starts ontsnappen.

## Gevolgen
- Terminal is multi-writer met permissie-gate los van sleutelbezit.
- Zoek-index past leesrecht-filter toe vóór resultaatweergave (security-review-punt).
- Preview heeft activity-based keep-alive, freeze-on-stale en FIFO-wachtrij.
- Noodstop is een twee-fase cascade (lock-then-drain) die afhankelijke resources meeneemt.
