---
status: accepted
date: 2026-07-17
tags: [content, comments, oauth, documents-and-skills]
---

# 0273 — Comment-inbox: alleen-lezen (YouTube + TikTok), replies bewust géén doel

## Context

De gebruiker wil reacties op gepubliceerde posts kunnen ZIEN, per platform, phone-first — maar in het interview van 2026-07-17 expliciet gekozen: **alleen lezen, nog geen reply-opties** (geen AI-suggesties, geen autopilot-replies). Er bestond al: PublishJob met `externalId` (post-id), de OAuth-connectielaag met token-refresh, en het cron/metrics-ingest-patroon.

## Decision

Een `SocialComment`-cache (upsert op de platform-comment-id) gevoed door een refresh (cron `comments-ingest` elke WS_COMMENTS_INTERVAL_MIN + on-demand `comments-refresh`-op), per gekoppelde connectie over de done-posts. **Geen reply-surface** — het model heeft geen reply-veld, er is geen reply-op. YouTube's `commentThreads.list` zit achter de bredere `youtube.force-ssl`-scope: nieuwe connecties vragen die scope erbij, en de granted scope wordt in `StoredTokens.scope` bewaard zodat `connectionSupportsComments` OUDE upload-only-connecties detecteert → de inbox toont een eenmalige "opnieuw koppelen"-hint (nooit gefabriceerde rijen). TikTok's comment-list is voor de meeste apps partner-gated: de fetch is eerlijk gebouwd, een weigering wordt een per-platform 'unavailable'-note. Pure request-builders/parsers zijn exporteerbaar; de netwerkstap is injecteerbaar (fixtures in tests, nooit live). Mark-read (één/alle) via een op; de UI groepeert per kanaal, nieuwste eerst, met een ongelezen-badge.

## Rejected alternatives

- **Replies nu meebouwen**: expliciet uitgesteld door de user; vergt óók de schrijf-scope (`youtube.force-ssl` dekt het, maar TikTok's reply-API is zwaarder gated) + een ADR-0269-achtig consent-model. Buiten scope.
- **Comments als `metrics`-veld op PublishJob**: een JSON-blob per post schaalt slecht voor lezen/markeren/paging + dedup; een eigen model met index is juist.
- **Alleen on-demand (geen cron)**: dan mist een telefoon-gebruiker een badge tot hij de pagina opent; de cron-sweep (zoals metrics-ingest) houdt de badge actueel.
- **De upload-scope ongewijzigd laten + comments onmogelijk**: dan kan het inbox nooit werken; de scope-verbreding + reconnect-detectie is de minst-verstorende weg (bestaande connecties blijven publiceren).

## Consequences

- Bestaande YouTube-connecties moeten één keer opnieuw koppelen om comments te lezen; de UI meldt dit expliciet.
- Zonder de force-ssl-scope of zonder TikTok-partnertoegang blijft de inbox eerlijk leeg met een note — nooit nep-comments.
- `SocialComment` staat op expliciete `workspaceId`-scoping (feature-model-patroon), niet in TENANT_MODELS.
- Replies blijven een bewuste toekomstige uitbreiding (nieuw ADR + consent) — de architectuur (cache + ops) staat het toe zonder herbouw.
