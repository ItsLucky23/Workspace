---
title: Control-API & schrijfpad — enige-schrijver Conductor, idempotentie, retry, cron, presence
status: accepted
date: 2026-06-22
covers: [G-CTRL-IDEMPOTENCY-STORE, G-CTRL-CRON-TRIGGER-OP, G-CTRL-RETRY-DEADLETTER, G-CTRL-ANSWER-QUESTIONSET, G-MT-PUSHSUB-CROSSTENANT, G-NOTIF-1, G-PRESENCE-1, G-CLIENT-1, G-CLIENT-2, G-TIER2-1]
---

## Context
Alle mutaties lopen via de control-API met de Conductor als enige schrijver. Open vragen: hoe idempotentie-kenmerken bewaard worden, hoe geplande taken en het beantwoorden van vragensets binnenkomen, hoe push-meldingen account-breed naar het juiste toestel gaan, en welk onderdeel de gebeurtenis-meldingen bezit.

## Beslissing
- **Idempotentie-store: kort, per werkruimte, TTL (G-CTRL-IDEMPOTENCY-STORE):** commando-kenmerken worden kort in snel geheugen (per werkruimte) bewaard en verlopen automatisch.
- **Cron als aparte bediening (G-CTRL-CRON-TRIGGER-OP):** geplande taken krijgen eigen knoppen om te maken/bewerken/aan-uit-zetten, herstart-bestendig (niet via de voorstel-goedkeur-stroom).
- **Retry-dan-foutmelding (G-CTRL-RETRY-DEADLETTER):** een aangenomen-maar-mislukt commando wordt een paar keer automatisch herprobeerd; daarna een foutmelding (geen aparte dead-letter-bak in v1).
- **Aparte "beantwoord-vragen"-knop (G-CTRL-ANSWER-QUESTIONSET):** vragensets beantwoord je via een eigen nette control-actie, niet via de snelle berichten-route.
- **Push account-breed, melding werkruimte-lokaal (G-MT-PUSHSUB-CROSSTENANT):** een melding wordt binnen haar eigen werkruimte afgehandeld en het toestel wordt account-breed opgezocht — een op de laptop gestart ticket is op de telefoon zichtbaar bij inloggen met hetzelfde account. (Eigenaar-keuze, zie ook ADR 0008.)
- **"Geldt-voor-alles"-pad voor globale instellingen (G-NOTIF-1):** instellingen zonder project lopen via een goedgekeurd globaal pad, net als bestaande push-subscriptions.
- **Presence-check is de echte race-bescherming (G-PRESENCE-1):** bij meerdere mogelijke beantwoorders is de status-check de echte "wie eerst"-garantie; het per-apparaat-kenmerk stopt alleen dubbelklik van dezelfde persoon.
- **Client haalt verse stand (G-CLIENT-1):** de snelle Goedkeuren-knop haalt bij openen de verse stand op en toont "al beantwoord door X".
- **Nieuwe meldingstypes: expliciet kanaal (G-CLIENT-2):** elke nieuwe meldingssoort krijgt een eigen expliciete kanaal-instelling (push vs in-app).
- **Gebeurtenis-motor bij de automatiserings-laag (G-TIER2-1):** de gebeurtenis-meldingen waar andere onderdelen op leunen worden eigendom van de automatiserings-laag. (Eigenaar-keuze.)

## Afgewezen alternatieven
- **Idempotentie voorgoed bij het commando** (G-CTRL-IDEMPOTENCY-STORE B) — onnodige permanente opslag.
- **Cron via voorstel-goedkeuren** (G-CTRL-CRON-TRIGGER-OP B) — verkeerde, omslachtige route.
- **Dead-letter markeren i.p.v. melden** (G-CTRL-RETRY-DEADLETTER B) — geen oppakker in v1.
- **Push per werkruimte koppelen** (G-MT-PUSHSUB-CROSSTENANT B) — botst met account-niveau-principe.
- **Aparte genummerde gebeurtenis-component** (G-TIER2-1 B) — extra eigenaarloos onderdeel.

## Gevolgen
- Idempotentie-keys in Redis (per workspace, TTL).
- Cron-CRUD als eigen control-acties + persistente schedule-tabel.
- Control-handlers krijgen begrensde retry; faalpad logt + meldt.
- Push-routing: subscription op account, fan-out gefilterd op werkruimte-membership.
- Automatiserings-laag publiceert de event-stream die andere features consumeren.
