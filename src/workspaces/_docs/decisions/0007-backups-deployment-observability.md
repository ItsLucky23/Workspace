---
title: Back-ups, deployment-capaciteit & observability
status: accepted
date: 2026-06-22
covers: [G-DEFER-1, G-DEFER-2, G-DEPLOY-1, G-DEPLOY-2, G-DEPLOY-3, G-BACKUP-1, G-BACKUP-2, G-BACKUP-3, G-OBS-1, G-OBS-2, G-ENV-1, G-SPIKE-1, G-SPIKE-3, G-SPIKE-4, G-INSTALL-1, G-INSTALL-2]
---

## Context
Self-hosted productie-aspecten waren onderbelicht: back-ups, uitvaltijd/reserve, server-capaciteit, alarmgrenzen, heartbeat-ritmes, veilige beheerder-login, test-grenzen op het echte serversysteem, en opschalen na installatie.

## Beslissing
- **Back-ups verplicht vóór eerste echte gebruiker (G-DEFER-1):** een eigenaar maakt back-ups verplicht vóór de eerste echte gebruiker live gaat.
- **Max uitvaltijd + reserve-moment (G-DEFER-2):** er is een afgesproken maximale uitvaltijd plus een vastgelegd moment waarop een reserve-systeem verplicht wordt.
- **Geheugen-opschonen (G-DEFER-3): verplaatst naar ADR 0017** — uitgewerkt tot een configureerbare context-management-/self-handoff-cyclus (compact→clear+handoff, per model).
- **Heartbeat met ruime marge (G-DEPLOY-1):** de leader-heartbeat-timeout krijgt een concrete waarde ruim boven de langste normale hapering.
- **Concrete capaciteitsgetallen (G-DEPLOY-2):** vastgelegd op de standaardserver (8 cores / 32 GB), met een opruim-drempel.
- **Eerlijk één app-kopie in v1 (G-DEPLOY-3):** v1 draait eerlijk één app-instance; twee instances pas bij meerdere servers (geen schijnredundantie op één host).
- **Hoofdsleutel apart + versleuteld back-uppen (G-BACKUP-1):** de master-key wordt apart en versleuteld geback-upt, los van de database.
- **Onopgeslagen handwerk back-uppen (G-BACKUP-2):** ook onopgeslagen handmatige wijzigingen worden regelmatig geback-upt.
- **Meerdere generaties + noodpad (G-BACKUP-3):** meerdere back-up-generaties bewaren plus een duidelijk noodpad als er meerdere kapot zijn.
- **Concrete alarmgrenzen + vensters (G-OBS-1):** elke waarschuwing krijgt een concrete grens en tijdsvenster.
- **Per-taak meld-ritme (G-OBS-2):** elk achtergrondproces krijgt een eigen concreet heartbeat-ritme.
- **Handleiding naar veilige login (G-ENV-1):** de beheerder-handleiding wordt bijgewerkt naar de veilige login-methode, met een eigenaar.
- **Max noodgrepen per test (G-SPIKE-1):** een test mag maximaal een vast aantal workarounds stapelen (bv. 2); daarboven geldt het als mislukt.
- **Testen op het echte serversysteem (G-SPIKE-3):** verplicht testen op hetzelfde OS als de echte server, en opnieuw bij een systeemwissel.
- **Vaste eigenaar voor tool-updates (G-SPIKE-4):** één eigenaar volgt Claude-tool-versies en beslist wanneer een pin te oud/onveilig is.
- **Push-sleutel in de back-upset (G-INSTALL-1):** de push-notificatie-sleutel gaat mee in de back-up, zodat aanmeldingen na herstel blijven werken.
- **Volledige opzet draait alles, per project instelbaar (G-INSTALL-2):** de volledige installatie draait alle diensten; per project blijft instelbaar waar de code leeft, zodat opschalen bestaande projecten niet breekt.

## Afgewezen alternatieven
- **Eerste gebruikers zonder back-up** (G-DEFER-1 B) — onacceptabel dataverlies-risico.
- **Twee app-kopieën op één host** (G-DEPLOY-3 B) — schijnveiligheid.
- **Voorzichtige defaults, later bijstellen** (G-OBS-1 B / G-DEPLOY-2 B) — eigenaar wil concrete getallen vooraf.
- **Test op dev-pc accepteren** (G-SPIKE-3 B) — auth/OS-verschillen maskeren bugs.

## Gevolgen
- Back-up-runbook met master-key-handling, onopgeslagen-werk-snapshot, generatie-retentie en corrupt-pad.
- Concrete config-waarden voor heartbeat-timeout, capaciteit en alarmgrenzen in `config.ts`/docs.
- Eén-instance deployment-profiel voor v1; reserve-moment gedocumenteerd.
- CI/test-policy: max-workarounds-teller + verplichte server-OS-runs.
