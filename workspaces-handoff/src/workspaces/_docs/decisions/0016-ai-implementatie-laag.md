---
title: AI-implementatie-laag — per rol/tool het concrete AI-mechanisme + autorisatie; image-builder in v1 ná de laag
status: accepted
date: 2026-06-22
covers: []
---

## Context
Tot nu toe hadden de docs een harde regel: alle AI-orchestratie loopt via een **interactieve PTY op de subscription**, nooit via API/SDK (billing-vermijding, zie ADR 0014 — kosten alleen via subscription óf eigen API-key). Tegelijk groeit het product naar een groter idee: de tool-modules (Interviewer voorop) schetsen features en lange termijn uit, bedenken nieuwe features en doen verbetervoorstellen — en cross-module data-uitwisseling moet vanaf het ontwerp meegenomen worden (ADR 0013 / G-MOD-2). Daarbij wil de eigenaar de image-builder al in v1 toelaten, maar pas nádat er een gedetailleerde AI-implementatie-laag ligt. Een vision-beslissing zonder bestaand G-id; dit is een eigenaar-beslissing (2026-06-22).

Het probleem: één-mechanisme-voor-alles (subscription-PTY) past niet op elke rol/tool. Sommige tools werken natuurlijker via een API-call met een eigen auth-methode. Dat botst met de harde "nooit API/SDK"-regel.

## Beslissing
- **Nieuw v1-kern-deliverable: een AI-implementatie-laag.** Deze laag legt **per rol/tool** het concrete AI-mechanisme + de autorisatie vast. Voorbeeld (eigenaar): *Designer → Claude Code CLI (PTY); Interviewer → API-call met auth-methode X.*
- **Image-builder MAG in v1, maar gated op de AI-laag.** De image-builder komt in v1, maar pas nádat de AI-implementatie-laag er ligt. Dit raakt **G-SCOPE-3** (de per-project image-/project-laag KOMT in v1, gated op de AI-laag — wijzigt van A naar B) en **G-IMG-2** (image-builder is de uitzondering op "modules pas in v2": image-builder zit in v1, ná de AI-laag).
- **Dual-support is bewust gewenst (eigenaar 2026-06-22), niet slechts een uitzondering.** De eigenaar wil expliciet **zowel subscription-PTY ÁLS API-calls** ondersteunen, en **per feature instelbaar** welke welk mechanisme gebruikt. De **kern-orchestratie blijft op subscription-PTY** (de economische basis); elke rol/tool kiest in de AI-laag zijn eigen mechanisme + auth-methode. Een API-tool draait op de **eigen API-key van de gebruiker** — consistent met ADR 0014. Dit versoepelt bewust de oude harde "nooit API/SDK"-regel; de eigenaar acht dit "niet heel moeilijk" en wil de keuze per feature.

## Afgewezen alternatieven
- **Eén mechanisme (alleen subscription-PTY) voor alles** — past niet op elke rol/tool; sommige tools werken natuurlijker via een API-call.
- **Image-builder pas in v2 (samen met de overige modules)** — eigenaar wil hem al in v1, mits de AI-laag eerst ligt.
- **API-tools op een centrale/project-key** — zou een geldstroom/billing-laag impliceren; in strijd met ADR 0014. API-tools draaien op de eigen key van de gebruiker.

## Gevolgen
- v1 krijgt een AI-implementatie-laag als kern-deliverable: een per-rol/per-tool register van mechanisme (subscription-PTY of API) + autorisatie/auth-methode.
- De image-builder is een v1-deliverable, gated op het bestaan van die laag (uitzondering op "modules in v2").
- De harde "nooit API/SDK"-regel is bewust versoepeld: kern-orchestratie blijft subscription-PTY, per-tool API mag — altijd op de eigen API-key van de gebruiker (geen billing-laag, ADR 0014 blijft gelden).
- Raakt G-SCOPE-3 (→ B) en G-IMG-2 (notitie: image-builder in v1 ná de AI-laag); de feitelijke G-id-dekking blijft in ADR 0006 resp. 0013, deze ADR levert de overkoepelende vision-rationale.
