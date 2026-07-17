---
status: accepted
date: 2026-07-17
tags: [designer, inspiration, vision, documents-and-skills]
---

# 0272 — Inspiratie-import: chromium-capture + vision-extractie → inactief theme-voorstel; vergelijk-analyse via de bestaande review-inbox

## Context

De gebruiker wil UI's "vergelijken met online stijlen": een site die je mooi vindt importeren als stijlrichting, en je eigen pagina naast een inspiratie leggen. Er bestond al: een 30-token-theme-systeem met `parseTheme` (vult partieel → compleet), de multimodale `image-critique`-feature (Gemini vision), een chromium-container (export-fase), en de UI-review-inbox met `ui-review-to-ticket`.

## Decision

(1) **URL-capture** hergebruikt het chromium-export-image als wegwerp-screenshotter (genetwerkt, `--screenshot`, URL ge-percent-encoded tegen Windows-arg-quoting). (2) **Extractie** loopt via de bestáánde `image-critique`-feature (vision, provider-pluggable) met een theme-extractie-prompt; `parseTheme` maakt het resultaat altijd compleet. Het resultaat wordt een **inactief** `DesignArtifact` (source `'ai'`) — activeren blijft de expliciete gebruikersstap (setActive), zodat een import nooit stilletjes de huisstijl wijzigt. (3) **Vergelijken** stuurt beide screenshots in één vision-call en slaat de markdown-analyse op als `UiReviewRequest` (page `inspiration-compare`) — de bestaande inbox + `ui-review-to-ticket` maken er zonder nieuw pad een redesign-ticket van. (4) **Stijl-galerij**: zes curated presets (Brutalist/Glassmorphism/Minimal/Editorial/Playful/Corporate) als partiële token-sets door `parseTheme`, lazy+idempotent per workspace geseed (source `'seed'`). Bonus-securityfix: acht modellen (DesignArtifact, StudioBrief/Artifact/BrandLibrary, InterviewFinding, TicketArtifactLink, UiReviewRequest, WorkspaceChatMessage) werden in de snapshot via tenantDb gelezen maar stonden NIET in `TENANT_MODELS` → cross-tenant-lek; toegevoegd aan de set + regressietests.

## Rejected alternatives

- **Eigen AiFeature 'style-extract'**: nog een feature-rij + assignment voor wat semantisch image-critique is; label onderscheidt de runs al.
- **Playwright-capture-image (demo-recorder)**: dat image moet per host gebouwd worden en levert mp4-opnames; alpine-chrome is gepulld, klein en doet native screenshots.
- **Direct actieve theme na import**: sneller, maar een capture-fout zou meteen de hele UI verkleuren; voorstel + expliciete activatie is één klik extra.
- **Nieuw vergelijk-model/inbox**: de UiReviewRequest-flow bestaat, heeft al een ticket-brug en een UI — een parallel pad zou tegen Rule 12 ingaan.

## Consequences

- Zonder vision-key zijn extractie/vergelijk eerlijk `null` (geen nep-themes); de UI meldt het.
- De capture-container heeft netwerk nodig (externe URL) — bewust géén `--network none` zoals de export-renders.
- De galerij-presets zijn `source:'seed'`-rows; verwijderen kan, her-seeden gebeurt alleen bij ontbrekende namen.
