---
title: Ticket-toestandsmachine — annuleren, afkeuren, externe afronding & automatiseringen
status: accepted
date: 2026-06-22
covers: [G-SM-1, G-SM-2, G-SM-3, G-AUTO-1, G-AUTO-2, G-AUTO-3, G-AUTO-4]
---

## Context
Tickets bewegen door stage-stappen met goedkeur/afkeur-momenten, kunnen extern (in de forge) worden afgerond, en kunnen door automatiserings-regels vooruit worden geduwd. De toestandsmachine miste een echte annuleer-eindstatus, een afkeur-pad, en regels voor botsende of falende automatiseringen.

## Beslissing
- **Externe afronding stopt de AI (G-SM-1):** als een taak buiten het systeem om (forge) wordt afgerond/gesloten, stopt het systeem de draaiende AI direct en meldt het.
- **Echte "geannuleerd"-eindstatus (G-SM-2):** annuleren is een aparte eindstatus die werkruimte, branch en openstaande vragen netjes afsluit (niet slechts pauze + handwerk).
- **Afkeuren = opnieuw met de reden (G-SM-3):** afkeuren stuurt de AI meteen opnieuw aan het werk met de afkeurreden als instructie.
- **Automatiseringen: eerste wint (G-AUTO-1):** meerdere triggers op dezelfde taak worden op volgorde afgehandeld; de eerste wint, de rest wordt genegeerd.
- **Gefaalde automatisering: 1x + log (G-AUTO-2):** een mislukte automatische actie wordt één keer geprobeerd, bij falen gelogd als fout, en losgelaten (geen herhaal-wachtrij in v1).
- **Timer-state persistent met TTL (G-AUTO-3):** "laatst afgegaan"-info van automatiseringen staat in blijvend geheugen met verloopdatum (niet alleen in-memory).
- **Voorstel toetsen aan sjabloon + verouderd-check (G-AUTO-4):** een voorgestelde instellingswijziging wordt getoetst aan het settings-sjabloon én op verouderdheid gecontroleerd voordat hij toepasbaar is.

## Afgewezen alternatieven
- **AI draait door bij externe wijziging** (G-SM-1 B) — onveilig; forge is leidend (zie ADR 0009).
- **Pauze + handmatig opruimen** (G-SM-2 B) — laat resten achter.
- **Prioriteit-gestuurde automatiseringen** (G-AUTO-1 B) — te complex voor v1; volgorde is voorspelbaar.
- **Retry-wachtrij voor automatiseringen** (G-AUTO-2 B) — bewust uit v1 gehouden.

## Gevolgen
- Statusmodel krijgt expliciete `cancelled`-eindstatus met opruim-hook.
- Afkeur-reden wordt als nieuwe AI-instructie doorgegeven (input voor de volgende sessie).
- Automatiserings-engine heeft een persistente "laatst-uitgevoerd"-tabel met TTL.
- Settings-voorstellen lopen door een validatie-laag (schema + staleness).
