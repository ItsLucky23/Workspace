---
title: Context-management & self-handoff — configureerbaar, per model (compact→clear+handoff)
status: accepted
date: 2026-06-22
covers: [G-DEFER-3]
---

## Context
Lange AI-sessies lopen vol (te veel context). Er zijn twee opschoon-commando's: `/compact` (samenvatten, de sessie/draad blijft) en `/clear` (volledig wissen). G-DEFER-3 vroeg om een noodplan als opschonen niet genoeg helpt. De eigenaar (2026-06-22) heeft dit uitgewerkt tot een concrete, configureerbare strategie die per model verschilt.

## Beslissing
- **Configureerbare context-cyclus, per model.** Instelbaar zijn: (a) de **drempel** — bij welk token-verbruik de cyclus start; (b) het **aantal `/compact`-rondes** vóór een `/clear`; (c) of/hoe een **handoff-doc-bestand** wordt geschreven én daarna meteen weer wordt ingelezen; (d) de **prompt** die de handoff + het herinlezen aanstuurt — dit alles **per model** instelbaar.
- **Default-profiel Opus 4.x (1M-context):** rond **~400k tokens** eerst **2× `/compact`**, daarna een **`/clear` mét een handoff-doc** dat onmiddellijk weer wordt ingelezen.
- `/compact` heeft de voorkeur boven `/clear` (behoudt de sessie/draad); `/clear` alleen mét handoff-doc als vangnet.

## Afgewezen alternatieven
- **Eén vaste cyclus voor alle modellen** — modellen verschillen in contextgrootte; one-size-fits-all loopt vol of verspilt.
- **Alleen `/clear` zonder handoff** — verliest de draad en het opgebouwde geheugen.
- **Niets configureerbaar** — kan niet per model/situatie worden bijgesteld.

## Gevolgen
- De engine krijgt een **per-model context-profiel**: drempel, aantal compacts, handoff aan/uit + de trigger-prompt.
- De P0.5-spike (ADR 0005) moet deze **compact→clear+handoff-cyclus** expliciet verifiëren (`/clear` vs `/compact` sessie-behoud + de handoff-reload).
- Vervangt het vage "derde noodplan" uit G-DEFER-3 door een concreet, instelbaar ontwerp.
