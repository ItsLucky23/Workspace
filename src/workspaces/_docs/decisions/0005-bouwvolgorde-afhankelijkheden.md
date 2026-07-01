---
title: Bouwvolgorde & afhankelijkheden — stap-voor-stap-plan leidend, één indeling
status: accepted
date: 2026-06-22
covers: [G-SEQ-1, G-SEQ-2, G-XB-3, G-XB-4, G-XB-5]
---

## Context
Er bestonden drie elkaar tegensprekende bouwplannen en twee onverenigbare afhankelijkheids-indelingen. Zonder één bindende volgorde bouwt elke AI iets anders. Ook was onduidelijk of stap 1 los kan starten en hoe handwerk wordt vastgelegd.

## Beslissing
- **P0.5-spike = stap 1 (eigenaar 2026-06-22):** vóór alle overige bouw eerst een test-harnas dat de kern-aannames tegen de echte `claude`-CLI verifieert: (1) billing op zowel **subscription-PTY ÁLS API-auth** (dual-support, ADR 0016), (2) hooks/gebeurtenis-seintjes, (3) de configureerbare **compact→clear+handoff-cyclus** (ADR 0017), (4) verbruik per beurt uitlezen, (5) resume na crash, (6) veilig inloggen. Groen → verder bouwen; rood op billing/PTY → escaleren, niet omzeilen.
- **Stap-voor-stap-plan is leidend (G-SEQ-1):** het sequentiële plan is de baas; een mappingtabel laat zien hoe het aansluit op de andere (parallel-)plannen.
- **Database-fundament eerst + bevriezen (G-SEQ-2):** één persoon/ploeg maakt eerst de databasestructuur af en bevriest die; daarna kan stap 1 zelfstandig starten.
- **Eén bindende afhankelijkheids-indeling (G-XB-3):** één indeling van "wat blokkeert wat" is bindend; de andere benamingen worden daarop afgestemd (geen derde nieuwe indeling).
- **Handwerk apart vastleggen (G-XB-4):** de mens commit zijn eigen wijzigingen apart, met een duidelijk moment en een eigen notitie (niet stilzwijgend samengevoegd met AI-werk).
- **Repair-loop met max pogingen (G-XB-5):** de zelf-controle/repareer-lus stopt na een maximum aantal pogingen en escaleert dan naar een mens (voorkomt eindeloos doorgaan bij een echte ontwerpfout).

## Afgewezen alternatieven
- **Parallel-plan leidend** (G-SEQ-1 B) — minder geschikt als bindende volgorde; blijft uitleg-laag.
- **Database meegroeien tijdens stap 1** (G-SEQ-2 B) — geen stabiel fundament, breekt latere stappen.
- **Nieuwe indeling die beide vervangt** (G-XB-3 B) — extra werk en herintroduceert verwarring.
- **Handwerk samenvoegen met AI-werk** (G-XB-4 B) — verliest herkomst.

## Gevolgen
- Het sequentiële plan + mappingtabel is het canonieke bouwdocument; afwijkingen vereisen een nieuwe ADR.
- Database-schema wordt als eerste milestone afgerond en bevroren (incl. seed + naam-migratie uit ADR 0003).
- Bouw-AI's gebruiken de ene afhankelijkheids-indeling voor blokkeer/vrijgeef-beslissingen.
- Repair-loop heeft een harde poging-teller met escalatie-pad.
