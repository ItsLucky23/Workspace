---
title: Engine — sessie-levenscyclus, concurrency, slot-vrijgave & reconciliatie
status: accepted
date: 2026-06-22
covers: [G-ENG-1, G-ENG-2, G-ENG-3, G-PROTO-1, G-PROTO-2, G-PROTO-3, G-ORCH-1, G-ORCH-2, G-ORCH-3, G-CT-1, G-CT-2, G-CT-3, G-CT-4, G-CT-5, G-CT-6]
---

## Context
De engine draait meerdere AI-sessies (chat-AI's en werk-AI's) in containers met beperkte plekken. Bij pauze, crash, wachten-op-gebruiker, verlopen sleutels en routerings-fouten ontstonden onbeantwoorde vragen over hoe voortgang bewaard blijft, hoe schaarse plekken vrijkomen en hoe de centrale regelaar (Conductor) bij geïsoleerde containers komt. Deze ADR legt de levenscyclus, de concurrency-limieten en het reconciliatie-gedrag vast.

## Beslissing
- **Voortgang & retry-telling persistent (G-ENG-1):** bij pauze of crash worden voortgang en pogingen-telling opgeslagen; bij hervatten gaat de sessie precies verder waar hij was.
- **Aparte concurrency-pools (G-ENG-2):** chat-AI's en werk-AI's hebben elk hun eigen maximum, niet één gedeelde pool.
- **Afsluitbericht zonder codenummer (G-ENG-3):** het verplichte "klaar"-afsluitbericht blijft, maar het codenummer (commit/versie) is optioneel voor rollen zonder eigen codemap (mens, planner-AI).
- **Slot vrijgeven tijdens wachten (G-PROTO-1):** zodra een AI op gebruikersinput wacht, geeft hij zijn plek vrij en herovert die bij het antwoord.
- **Idempotentie per bericht (G-PROTO-2):** elk bericht krijgt een uniek kenmerk zodat dubbel-verzonden berichten herkend en genegeerd worden.
- **Harde timeout op inter-AI-bevraging (G-PROTO-3):** een werk-AI die een andere bron bevraagt valt na een harde tijdslimiet terug op alleen de database.
- **Aparte rijen per soort werk (G-ORCH-1):** de Conductor verwerkt per werksoort een eigen rij zodat een lange klus de rest niet blokkeert.
- **Routering met backoff-retry (G-ORCH-2):** mislukte route-instelling wordt automatisch opnieuw geprobeerd met oplopende pauzes (geen volledige rollback).
- **Diff tegen laatst verwerkte hoofdlijn-versie (G-ORCH-3):** incrementeel herverwerken vergelijkt met de laatst verwerkte versie op de hoofdlijn.
- **Sleutel ruim op tijd verversen (G-CT-1):** toegangssleutels worden met flinke marge ververst i.p.v. reactief vernieuwen.
- **Container-build achter een slot (G-CT-2):** de eerste (dure) container-build draait achter een slot zodat hij maar één keer gebeurt bij gelijktijdige starts.
- **Onopgeslagen werk wegzetten bij opruiming (G-CT-3):** bij het opruimen van een container wordt onopgeslagen werk eerst veilig weggezet.
- **Database buiten de afgeschermde uitgang (G-CT-4):** databaseverkeer is een expliciete uitzondering die rechtstreeks mag, buiten de egress-proxy om.
- **Handmatig herstelplan voor de Conductor (G-CT-5):** er is één Conductor zonder hot-standby; er geldt een gedocumenteerd handmatig herstelplan met afgesproken hersteltijd.
- **PTY-onderdeel op intern netwerk, op naam vindbaar (G-CT-6):** het in-container onderdeel luistert op het interne netwerk zodat de Conductor het op naam (service-discovery) bereikt, zonder externe poort.

## Afgewezen alternatieven
- **Eén gedeelde concurrency-pool** (G-ENG-2 A) — chat-verkeer zou werk-capaciteit kunnen verdringen.
- **AI stopt en herstart bij gebruikersantwoord** (G-PROTO-1 B) — duurder en verliest in-memory context.
- **Slimmere egress-proxy met DB-protocol** (G-CT-4 B) — te complex voor v1; uitzondering is simpeler.
- **Hot-standby Conductor** (G-CT-5 C, deels) — bewust uitgesteld; zie ADR 0006 voor het reserve-moment.

## Gevolgen
- Sessie-state (voortgang, pogingen, slot-status) moet in persistente opslag staan, niet alleen in-memory.
- Twee gescheiden concurrency-tellers in de scheduler.
- Egress-policy documenteert de DB-uitzondering expliciet (security-review-punt).
- Conductor-herstel is een runbook, geen geautomatiseerde failover in v1.
