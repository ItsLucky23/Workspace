---
status: accepted
date: 2026-07-17
tags: [content, autopilot, b-23, consent, publishing]
---

# 0269 — Kanaal-autopilot: eenmalige opt-in-consent vervangt de per-post-approval (B-23-uitbreiding)

## Context

Invariant B-23 zegt: de mens keurt elke authoritative write goed; publiceren liep ALTIJD via een
`WorkspaceSuggestion(type:'publish')` die de gebruiker accepteert. Maar de productvisie ("10
YouTube-kanalen op cron-timers, een workspace puur voor automated content") vraagt een keten die
zonder dagelijkse taps doorloopt: idee → render → publiceren. De gap-scan (GAP_SCAN_2026-07-16,
critical "geen autonome end-to-end pipeline") bevestigde dat elke schakel handmatig was. De
gebruiker heeft in het beslis-interview van 2026-07-17 expliciet gekozen voor per-kanaal opt-in.

## Decision

- **`Channel.autopilot` (default false)** is een per-kanaal opt-in die de gebruiker bewust aanzet via
  een expliciete confirm-dialoog. **Die consent vooraf ÍS de goedkeuring** voor elke publish vanaf dat
  kanaal — `content-request-publish` slaat de suggestion over en publiceert direct wanneer het kanaal
  autopilot aan heeft. B-23 blijft intact: de Conductor blijft de enige writer (de hele keten loopt
  via Conductor-ops), alleen het consent-MOMENT verschuift van per-post naar per-kanaal.
- **De keten**: de content-ideator-rol (cron, `params.channelId`) is kanaal-bewust (naam/brand-voice
  + per-kanaal winners) en draait op een autopilot-kanaal de volledige keten:
  `content-from-brief` (kanaal-gebonden piece) → `content-run-pipeline` (volledige render) →
  `content-request-publish` (autopilot-tak → direct posten).
- **Waarborgen**: (1) de kill-switch is de autopilot-toggle zelf (uitzetten stopt de eerstvolgende
  run); (2) elke autopilot-publish landt in de Activity-feed (`autopilot-publish`); (3) AI-disclosure
  volgt `Channel.aiDisclosureDefault` — de confirm-dialoog waarschuwt expliciet wanneer die uit
  staat; (4) het account is `Channel.defaultAccountId`; (5) de media-budget-guards (per-workspace cap
  + host-breed `WS_HOST_SPEND_CAP_EUR`) begrenzen de kosten van elke run.

## Rejected alternatives

- **Semi-autopilot (render automatisch, publish met approval)** — afgewezen door de gebruiker: "10
  kanalen op cron" zou alsnog dagelijkse taps vragen.
- **Workspace-brede autopilot** — te grof; consent hoort bij het kanaal (het publieke oppervlak).
- **Een aparte autopilot-verb/engine** — onnodig: de bestaande ops + het bestaande trigger-systeem
  dekken de keten (invariant #2: geen nieuwe verbs; dit zijn control-ops, geen structured-channel-verbs).

## Consequences

- Een autopilot-kanaal kan zonder menselijke tussenkomst publiek posten; de verantwoordelijkheid
  verschuift naar het moment van aanzetten. De UI maakt dat moment zwaar (confirm + disclosure-status).
- De publish-suggestion-flow blijft het pad voor alle niet-autopilot-kanalen — gedrag ongewijzigd.
- `//? @adr 0269` op de autopilot-tak in de conductor + de ideator-keten.
