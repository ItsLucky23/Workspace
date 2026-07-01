---
title: Document-Studio integriteitsgrens — GEEN AI-detectie-omzeiling
status: accepted
date: 2026-06-22
covers: [G-DOC-1]
---

## Context
De Document-Studio (mini-app om documenten op te stellen, te formatteren, in/uit te lezen en de toon te bepalen) zou misbruikt kunnen worden om AI-detectie te omzeilen — bijvoorbeeld een scriptie laten "humanizen" zodat het lijkt of een mens het schreef, om academische controles te misleiden. De eigenaar heeft expliciet bevestigd dat deze integriteitsgrens behouden blijft.

## Beslissing
- **Integriteitsgrens BLIJFT (G-DOC-1):** de Document-Studio biedt GEEN AI-detectie-omzeiling als feature. Concrete invulling:
  - De tool doet wél: opstellen, formatteren, in-/uitlezen en toon-bepaling van documenten.
  - De tool doet NIET: "humanizen om een detector te misleiden" of enige vorm van AI-detectie-evasion.
  - Handhaving = een waarschuwing in de tekst plus de AI-instructie (de gekozen optie A). Claude/de bouw-AI bouwt evasion-functionaliteit niet — ook niet op verzoek. (Eigenaar-keuze; harde grens.)

## Afgewezen alternatieven
- **Automatische controle die verboden trucs blokkeert** (G-DOC-1 B) — zwaardere handhaving dan nu nodig; waarschuwing + AI-instructie volstaat als grens.
- **Logboek van gebruikersverzoeken** (G-DOC-1 C) — privacy-bezwaarlijk en niet de gekozen handhaving.
- **Evasion als feature bouwen** — uitgesloten: dit is de integriteitsgrens die het hele product respecteert.

## Gevolgen
- Document-Studio-prompts/instructies bevatten een expliciete weigering om aan AI-detectie-omzeiling mee te werken.
- UI toont een integriteits-waarschuwing bij relevant gebruik.
- Deze grens is niet onderhandelbaar binnen het project; een latere wijziging vereist een nieuwe ADR die deze supersedet en de eigenaar-beslissing herziet.
