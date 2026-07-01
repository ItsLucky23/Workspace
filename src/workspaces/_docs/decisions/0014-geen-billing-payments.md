---
title: Geen billing/payments — alle AI-kosten via subscription of eigen API-key
status: accepted
date: 2026-06-22
covers: [G-MKT-3]
---

## Context
Het project raakt op meerdere plekken AI-kosten (beeld-generatie, tool-gebruik, rekentijd). Er was een vraag of het systeem die kosten doorberekent/begrenst via een eigen billing-laag. De eigenaar heeft dit projectbreed beslist.

## Beslissing
- **Geen billing/payments in het project (G-MKT-3):** er komt géén billing- of payment-laag. Alle AI-kosten — inclusief de extra kosten van beeld-generatie via een externe dienst — lopen via de subscription van de gebruiker óf via diens eigen API-key. (Eigenaar-keuze, projectbreed principe.)

## Afgewezen alternatieven
- **Doorberekenen per gebruik met instelbaar maximum** (G-MKT-3 A) — vereist een billing-laag die we bewust niet bouwen.
- **In het vaste abonnement stoppen met vaste limiet** (G-MKT-3 B) — impliceert eveneens een eigen afreken-mechanisme.

## Gevolgen
- Geen payment-provider-integratie, geen facturatie, geen per-use-afrekening in de codebase.
- Externe betaalde diensten (bv. beeld-generatie) draaien op de credentials/subscription van de gebruiker; het systeem bemiddelt geen geldstromen.
- Budget/quota-features (ADR 0010) gaan over verbruik-begrenzing en pauzeren, NIET over geld innen.
- Dit principe overstijgt individuele tools en geldt voor elke toekomstige module.
