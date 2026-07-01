# Beslissingsdocumenten (ADR's) — Workspaces

> Bindend "waarom + wat is besloten"-contract voor het Workspaces-product, gesynthetiseerd uit de 183 ronde-3-gap-keuzes (`REVIEW_3_GAPS_ANSWERS.md`). Latere bouw-AI's houden zich hieraan. Alle 183 G-id's zijn door precies één ADR gedekt.

| ADR | Titel | Status | Dekt (aantal G-id's) | Eigenaar-beslissing? |
|---|---|---|---|---|
| [0001](0001-engine-sessie-levenscyclus.md) | Engine — sessie-levenscyclus, concurrency, slot-vrijgave & reconciliatie | accepted | 15 | — |
| [0002](0002-toestandsmachine-tickets.md) | Ticket-toestandsmachine — annuleren, afkeuren, externe afronding & automatiseringen | accepted | 7 | — |
| [0003](0003-datamodel-conventies.md) | Datamodel-conventies — één signaal-model, kluis-tabel, append-only, StageKind | accepted | 11 | — |
| [0004](0004-control-api-schrijfpad.md) | Control-API & schrijfpad — enige-schrijver Conductor, idempotentie, retry, cron, presence | accepted | 10 | ✅ (G-TIER2-1) |
| [0005](0005-bouwvolgorde-afhankelijkheden.md) | Bouwvolgorde & afhankelijkheden — stap-voor-stap-plan leidend, één indeling | accepted | 5 | — |
| [0006](0006-v1-scope.md) | V1-scope — tools ná v1, geen preview-meters, monitoring-dashboard WEL, AI-kwaliteitstest WEL | accepted | 9 | — |
| [0007](0007-backups-deployment-observability.md) | Back-ups, deployment-capaciteit & observability | accepted | 17 | — |
| [0008](0008-multi-tenancy-identiteit.md) | Multi-tenancy & identiteit — alles op account-niveau, cross-device, gebruiker-verwijderen | accepted | 10 | ✅ (G-17-3) |
| [0009](0009-forge-mr-ci-git.md) | Forge / MR / CI / git — forge wint, merge-gate fail-closed, terugdraai uitgezonderd | accepted | 13 | — |
| [0010](0010-veiligheid-vertrouwen-audit.md) | Veiligheid & vertrouwen — mens-in-de-lus, afkeuren-wint, strengste instelling wint, audit | accepted | 19 | — |
| [0011](0011-ui-resilience-board-realtime.md) | UI-resilience — bord, realtime, crash/reconnect, voice & herstart-gedrag | accepted | 27 | — |
| [0012](0012-terminal-search-preview-noodstop.md) | Terminal-collaboratie, zoeken met leesrechten, preview-levenscyclus & noodstop-cascade | accepted | 10 | — |
| [0013](0013-tool-modules-framework.md) | Tool-modules — gedeeld raamwerk, 11 modules geparkeerd, Interviewer/Designer/Image | accepted | 28 | ✅ (G-INT-3, G-DSGN-3, G-MOD-1) |
| [0014](0014-geen-billing-payments.md) | Geen billing/payments — alle AI-kosten via subscription of eigen API-key | accepted | 1 | ✅ (G-MKT-3) |
| [0015](0015-document-studio-integriteitsgrens.md) | Document-Studio integriteitsgrens — GEEN AI-detectie-omzeiling | accepted | 1 | ✅ (G-DOC-1) |
| [0016](0016-ai-implementatie-laag.md) | AI-implementatie-laag — per rol/tool mechanisme + autorisatie; image-builder in v1 ná de laag; subscription-vs-API-afwijking | accepted | 0 (vision; raakt G-SCOPE-3, G-IMG-2, G-MOD-2) | ✅ (vision-beslissing eigenaar) |

**Totaal:** 16 ADR's, 183 G-id's gedekt (precies één ADR per G-id, geen overlap, geen gaten). ADR 0016 is een vision-beslissing zonder eigen G-id (covers: []), maar raakt G-SCOPE-3 (ADR 0006), G-IMG-2 + G-MOD-2 (ADR 0013).

## Eigenaar-beslissingen (uit de bronnen gemarkeerd)

| G-id | ADR | Korte beslissing |
|---|---|---|
| G-17-3 | 0008 | Export = alleen eigen accountgegevens (privacy) |
| G-TIER2-1 | 0004 | Gebeurtenis-motor → automatiserings-laag |
| G-INT-3 | 0013 | Interviewer plant ook hele features uit |
| G-DSGN-3 | 0013 | Tekstbeheer in Designer, geen aparte Copy-tool |
| G-MKT-3 | 0014 | Geen billing/payments; kosten via subscription of eigen API-key |
| G-MOD-1 | 0013 | Alle 11 extra modules parkeren |
| G-DOC-1 | 0015 | Integriteitsgrens blijft: geen AI-detectie-omzeiling |
| (vision) | 0016 | AI-implementatie-laag in v1; image-builder in v1 ná de laag; kern blijft subscription-PTY, per-tool API mag op eigen key (2026-06-22) |
| G-MOD-2 | 0013 | **Gewijzigd → A:** cross-module data vanaf het ontwerp (modules zelf v2) |
| G-SCOPE-3 | 0006 | **Gewijzigd → B:** per-project image-/project-laag KOMT in v1, gated op AI-laag (ADR 0016) |
| G-DEFER-3 | 0017 | **Verplaatst 0007→0017:** configureerbare context-cyclus (compact→clear+handoff, per model) |
| G-SCHED-1 | 0010 | **Geparkeerd:** voorrang-vs-budgetslot, samen met token-/budget-blokkering |
| (vision) | 0017 | Context-management & self-handoff configureerbaar per model; Opus-1M = 2× compact ~400k, dan clear+handoff (2026-06-22) |
| (vision) | 0005 | P0.5-spike = letterlijk stap 1: verifieert dual-billing, hooks, compact→clear+handoff, verbruik, resume, login (2026-06-22) |
| (vision) | 0016 | Dual-support bevestigd: subscription-PTY ÁLS API, per feature instelbaar (2026-06-22) |
| G-19-1/-2/-3, G-QUOTA-1 | 0010 | **Geparkeerd:** geen token-/budget-blokkeer-logica nu; alleen informatieve verbruik-weergave |

## Status-noot

Alle ADR's hebben status `accepted`. De clusters 1–3 (G-ids tot en met G-XB-5) zijn door de eigenaar in de chat-walkthrough bevestigd. De clusters 4–7 (schermen/features 01–24, code-merge/test/push, tool-modules) zijn door Claude ingevuld namens de eigenaar op basis van de aanbeveling + het beslispatroon; dat staat per ADR in de Context vermeld. Afwijkingen van de standaard-aanbeveling zijn in elke ADR-Context/Beslissing benoemd (o.a. G-OBS-3, G-SPIKE-2, G-13-3, G-24-1, G-INT-3, G-DSGN-2, G-MOD-1, G-MOD-2).

**Vision-verfijning 2026-06-22 (eigenaar).** Vijf verfijningen doorgevoerd: (1) tool-modules blijven v2 maar zijn een GROOT product-idee (gefaseerd, niet geschrapt); (2) **G-MOD-2 gewijzigd B→A** — cross-module data vanaf het ontwerp (modules zelf v2); (3) live preview/server blijft post-v1 (bevestigd); (4) nieuwe **ADR 0016** AI-implementatie-laag + **G-SCOPE-3 gewijzigd A→B** (per-project image-/project-laag in v1, gated op de AI-laag) + **G-IMG-2-notitie** (image-builder is de v1-uitzondering) + bewuste subscription-PTY-vs-per-tool-API-afwijking; (5) **G-19-1/-2/-3 + G-QUOTA-1 geparkeerd** — geen token-/budget-blokkeer-logica nu, alleen informatieve verbruik-weergave.
