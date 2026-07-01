---
title: Tool-modules — gedeeld raamwerk, 11 modules geparkeerd, Interviewer/Designer/Image
status: accepted
date: 2026-06-22
covers: [G-FW-1, G-FW-2, G-FW-3, G-FW-4, G-FW-5, G-FW-6, G-INT-1, G-INT-2, G-INT-3, G-DSGN-1, G-DSGN-2, G-DSGN-3, G-DSGN-4, G-MKT-1, G-MKT-2, G-MKT-4, G-DOC-2, G-DOC-3, G-DOC-4, G-DOC-5, G-IMG-1, G-IMG-2, G-IMG-3, G-MOD-1, G-MOD-2, G-MOD-3, G-MOD-4, G-MOD-5]
---

## Context
De tool-modules (mini-apps: Interviewer, Designer, Marketing, Document, Image-builder) delen een raamwerk en kennen overkoepelende keuzes rond zichtbaarheid, opslag, concurrency, kostenmeldingen en welke extra modules we (niet) bouwen. De modules (Interviewer/Designer/Marketing/Document) komen pas in v2 (ADR 0006) — een fasering, géén schrapping: ze gelden als een GROOT idee achter het product (Interviewer voorop: features/lange termijn uitschetsen, nieuwe features bedenken, verbetervoorstellen). De **image-builder is de uitzondering**: die zit in v1, gated op de AI-implementatie-laag (ADR 0016). Deze ADR legt het modules-contract vast voor wanneer ze gebouwd worden.

## Beslissing
**Gedeeld raamwerk (FW):**
- **Aan/uit per hele werkruimte (G-FW-1):** mini-apps schakel je per werkruimte aan/uit (geen per-rol/per-persoon zichtbaarheid).
- **Uitzetten verbergt, artifacts blijven (G-FW-2):** uitzetten verbergt alleen; gemaakte bestanden/koppelingen blijven leesbaar.
- **Eén gedeelde opslag (G-FW-3) + één gedeeld mappensysteem (G-FW-5) + één gedeelde artifact-bak met label per mini-app (G-FW-6).**
- **Vaste systeem-volgorde in zijbalk (G-FW-4).**

**Interviewer (INT):**
- **Vragen vrij uit wachtrij, ook tijdens pauze (G-INT-1).**
- **Eén statuslijst: bezig/open/beantwoord/gepauzeerd/mislukt (G-INT-2).**
- **Interviewer plant ook hele features uit (G-INT-3):** afwijking/eigenaar — gaat verder dan losse vraagkaartjes; bouwt door naar een uitgewerkt plan. (Eigenaar-keuze; staat los van de standaard-aanbeveling.)

**Designer (DSGN):**
- **Eén gedeelde preview-server voor het systeem (G-DSGN-1).**
- **Afgeschermd draaien én goedkeuring (G-DSGN-2):** afwijking — door-AI-gegenereerde ontwerpcode draait in een sandbox én vereist goedkeuring (veiligheid hoog).
- **Tekstbeheer in Designer, geen aparte Copy-tool (G-DSGN-3):** eigenaar-keuze — copy/labels worden binnen de Designer beheerd.
- **Kleurvarianten passen automatisch mee (G-DSGN-4):** bij elkaar horende kleuren (dark mode, hover) bewegen samen mee.

**Marketing (MKT):**
- **Skill bruikbaar voor meerdere tools (G-MKT-1)** en **één centrale merk-bibliotheek (G-MKT-2).**
- **Dezelfde gedeelde mappenregel als de rest (G-MKT-4)** — geen afwijkende limiet.

**Document (DOC, niet-integriteit):**
- **Vaste ondersteund-lijst, rest geweigerd (G-DOC-2).**
- **Eén veilige inlees-manier voor alle uploads (G-DOC-3)** — sandbox-extractie geldt voor élke tool die uploads aanneemt.
- **Stoppen bij verzonnen feiten (G-DOC-4):** bij dreigende hallucinatie zonder bron stopt het document tot de info is aangevuld.
- **Artifact aan meerdere taken, versie gepind bij koppelen (G-DOC-5).**

**Image-builder (IMG):**
- **Voorlopig eigen netwerk; internet-pad later documenteren (G-IMG-1).**
- **Gewone aan/uit-mini-app (G-IMG-2):** maar uitzondering op "modules in v2" — de image-builder zit in v1, ná de AI-implementatie-laag (ADR 0016 + G-SCOPE-3). Interviewer/Designer/Marketing/Document blijven v2.
- **Sjablonen voor iedereen, AI-pad beheerder-only (G-IMG-3).**

**Modules-strategie (MOD):**
- **Alle 11 voorgestelde extra modules parkeren, nu niets erbij (G-MOD-1):** afwijking/eigenaar — geen top-3 kiezen; alles parkeren.
- **Cross-module data vanaf het ontwerp (G-MOD-2):** wijziging B→A (eigenaar 2026-06-22) — tools mogen elkaars resultaten lezen via gedeelde, cross-module leesbare opslag. De **modules zelf worden pas in v2 geïmplementeerd**, maar het **ontwerp ondersteunt cross-module data vanaf het begin** (bv. Designer leest Interviewer-resultaten, Marketing leest codebase-info). Dus NIET meer "eerst gescheiden, later koppelen". Aantekening: *modules in v2, data-uitwisseling vanaf ontwerp.*
- **Eén gedeelde totale concurrency-limiet (G-MOD-3) + één gedeelde beurtregeling (G-MOD-4) + één vaste kostenmelding bij alle tools (G-MOD-5).**

## Afgewezen alternatieven
- **Per-rol/per-persoon mini-app-zichtbaarheid** (G-FW-1 B/C) — te fijnmazig voor v1.
- **Interviewer alleen vraagkaartjes** (G-INT-3 A) — eigenaar wil verder gaan.
- **Designer: alleen sandbox óf alleen goedkeuring** (G-DSGN-2 A/B) — beide gekozen voor maximale veiligheid.
- **Aparte Copy-tool** (G-DSGN-3 B) — eigenaar houdt het in Designer.
- **Top-3 modules nu bouwen** (G-MOD-1 A) — eigenaar parkeert alles.
- **Tools in v1 nog gescheiden, koppelen pas later** (G-MOD-2 B, oude keuze) — verlaten: cross-module data wordt vanaf het ontwerp meegenomen (modules zelf wel v2).

## Gevolgen
- Eén tool-module-SDK: gedeelde opslag, mappen, artifact-registry (gelabeld), vaste zijbalk-volgorde, gedeelde concurrency + scheduler + kostenmelding.
- Interviewer en Designer krijgen extra capaciteiten (feature-planning, sandbox+approval) bovenop het basiscontract.
- Uploads lopen overal door dezelfde sandbox-extractie (security-invariant).
- Geen nieuwe modules in de eerste tool-release; cross-module data-uitwisseling wordt echter vanaf het ontwerp ondersteund (gedeelde, cross-module leesbare opslag), ook al worden de modules zelf pas in v2 geïmplementeerd.
- De image-builder is de uitzondering en landt al in v1 (gated op de AI-implementatie-laag, ADR 0016).
