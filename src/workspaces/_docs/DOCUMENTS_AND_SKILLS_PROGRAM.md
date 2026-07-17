# DOCUMENTS & SKILLS PROGRAM — het volgende grote /goal-bouwplan

> Doel: de laatste grote visie-gaten uit `GAP_SCAN_2026-07-16.md` dichten — een volwaardige **Document-module** (AI die word/pdf/excel/images maakt én bewerkt), een **universeel Skills-systeem** (humanizer, tone-of-voice, …) dat bij ELKE AI-run injecteerbaar is, **designer-inspiratie-import** (URL/screenshot → DesignTheme), een **read-only comment-inbox** (YouTube + TikTok), de **eval-replay-harness** en het klein grut. Beslissingen komen uit het user-interview van 2026-07-16/17 (3 AskUserQuestion-rondes) — zie §1. Draai met `/goal` over dit bestand, fase-voor-fase, waterfall (elke fase getest+gecommit vóór de volgende). Alle bestaande invarianten blijven gelden (single-writer/B-23, frozen structured-channel-verbs — control-API-ops mogen wél groeien, `runInTenant`, PTY-billing, geen `as any`, tryCatch, i18n×4, theme-tokens, per-item test+ADR+branch-log+commit, gates tsc+lint+ai:lint+build). Premium-UX-DoD = FREEDOM_PROGRAM §0b voor élk UI-item.

## §1 User-beslissingen (bindend — interview 2026-07-16/17)

| Onderwerp | Beslissing |
|---|---|
| Document Studio vorm | **Eigen module + nav-sectie** ("Documents"), niet meeliften op de content-pipeline. AI moet alle soorten files kunnen **maken én bewerken**: Word, PDF, Excel, images. |
| Export-formaten v1 | Markdown, PDF, HTML (deelbare pagina), Word (.docx), **Excel (.xlsx)**. |
| Skills-systeem | **Generiek `Skill`-model overal** (workspace-scoped) — injecteerbaar bij elke AI-run (documents, content, designer, pipeline-stages, interviewer). Seed: humanizer + tone-of-voice. DesignThemes/media-styles blijven bestaan maar delen de picker-UI; migratie onder Skill kan later. Skills = "hoe we nog meer variatie creëren" (user). |
| Humanizer-grens | ADR 0015 blijft gelden: menselijke toon ja, AI-detectie-omzeiling nee; AI-assisted-tag blijft. |
| Eval-harness | **Replay-helft eerst**: fixture-corpus + structurele scorer op opgenomen turn-events (kost géén subscription-turns). Live golden runs later. |
| Comment-inbox | **YouTube + TikTok, alleen LEZEN** — nog geen reply-opties (geen AI-suggesties, geen autopilot-replies). |
| Designer-inspiratie | Alle vier: URL-capture, screenshot-upload, side-by-side vergelijk-view, stijl-galerij met presets. |
| Klein grut | Budget-alert-push + webm/gif render-containers + **voice-interface** (spec ligt klaar). NIET geselecteerd: 2FA-session-refresh (framework-kant, bewust uitgesteld). |
| `.new`-scaffolds | Afgehandeld — al verwerkt in de 0.6.7-upgrade-commit; `bunfig.toml` als rest gecommit (`c83e20e`). |

## §2 Bestaande fundamenten (NIET herbouwen — eerst checken)

- **Skill-achtige surfaces die er al zijn**: DesignThemes (designer), video/media-styles-galerijen (AI_LIBRARIES_ACCOUNTS), role-prompts per pipeline-stage, product-knowledge-RAG (189 chunks). Het Skill-model unificeert het *injectie-mechanisme*, niet (nu) de data.
- **Media-infra**: fal + ffmpeg + render-pipeline (aspect/watermark/templates), MediaUploadButton, media-bibliotheek workspace-breed.
- **Playwright-infra** (editor-subdomein-tests) → herbruikbaar voor URL-capture-screenshots.
- **Vision-provider** (multimodal image-critique, ADR 0268) → herbruikbaar voor stijl-extractie.
- **Push-infra** (VAPID + PWA) en **spend-tracking** (SpendRecord, alertPct, WS_HOST_SPEND_CAP_EUR) → budget-alert-push is wiring, geen nieuwbouw.
- **OAuth-koppelingen** YouTube/TikTok (accounts + channels + autopilot ADR 0269) → comment-inbox leest via dezelfde accounts. Let op scopes: check of de huidige YouTube-scope commentThreads.list dekt; zo niet → één re-consent-flow, duidelijk in de UI gemeld.
- **Voice-spec**: ligt klaar als BUILD-DEFERRED-doc — eerst herlezen, niet opnieuw ontwerpen.
- **Turn-event-opnames** (ws-carryover envelope, turnResult) → de grondstof voor de replay-scorer.

## §3 Fasen (waterfall — elke fase: gebouwd → getest → gecommit → volgende)

### FASE SK — Skills-fundament (eerst: alles hierna injecteert skills)

| Item | Wat | Verificatie |
|---|---|---|
| SK1 | `Skill` Prisma-model (workspace-scoped: name, slug, instruction, examples?, applyPoints[], enabled, builtin?) + control-ops create/edit/delete/toggle (RBAC, Conductor) + settings-UI-sectie | integratie-test CRUD + RBAC; tenant-isolatie |
| SK2 | **Injectie-laag**: één helper `resolveSkillsFor(workspaceId, applyPoint)` die actieve skill-instructies levert; wiren in content-generate, stage-runner (contextDoc), designer-runs, interviewer, document-runs (SK-vooruitwijzing) + gedeelde picker-UI-component (zelfde shell als theme/style-pickers) | unit: apply-point-filtering; integratie: skill-instructie aantoonbaar in de prompt-envelope |
| SK3 | Seeds: **humanizer** (ADR-0015-grens in de instructie zelf verankerd), tone-of-voice, SEO-optimizer, merkstem, jargon-vertaler — als `builtin` skills, per workspace kopieerbaar/aanpasbaar | unit: seed-idempotentie; e2e: skill aan/uit → output-verschil op een stub-run |
| ADR | "Universeel Skill-model met apply-points" (nummer bij landing) | |

### FASE DOC — Document-module (eigen nav-sectie)

| Item | Wat | Verificatie |
|---|---|---|
| DOC1 | Schema (`Document`: title, kind, content (markdown-bron), assets[], versie-log via bestaand seq/event-patroon) + nav-sectie "Documents" + module-gating (`enabledSections`) + lijst/detail-pages (mobile-first) | integratie: CRUD via control-ops; drawer/nav-gating |
| DOC2 | Editor: markdown-first rich editor (bestaande editor-bouwstenen hergebruiken waar mogelijk) + AI-acties via Conductor-ops (genereer sectie, herschrijf, vat samen — met skills-injectie uit SK2) | e2e stub-run: AI-edit landt als voorstel → accept schrijft (B-23) |
| DOC3 | AI maakt/bewerkt **bestandstypen**: images via bestaande media-infra; Word/Excel/PDF via de EXP-container (DOC3 levert de ops + UI, EXP de renderers) — een Document kan meerdere output-bestanden dragen | integratie: document → asset-registratie; stub-render |
| DOC4 | RAG-grounding: documenten indexeren in de bestaande workspace-RAG + product-knowledge als bron bij document-runs | integratie: chunk-count stijgt; retrieval-hit in een document-run |
| ADR | "Documents als eigen module, markdown-bron + render-targets" | |

### FASE EXP — Export-laag (pandoc/chromium-container)

| Item | Wat | Verificatie |
|---|---|---|
| EXP1 | Export-container (Docker): pandoc voor **.docx**, chromium-print voor **PDF**, zelfde pad voor standalone **HTML**; **.xlsx** via een lichte lib in de container (tabel-documenten/sheets) | integratie mét Docker: elk formaat levert een geldig bestand (magic bytes + open-check) |
| EXP2 | Export-op + UI (per document: formaat-keuze, download + opslag als asset) + Markdown-export native (geen container) | e2e: MD direct; PDF/docx/xlsx/HTML via container; MSYS_NO_PATHCONV-les toepassen |
| EXP3 | Branding: optioneel logo/watermerk (Workspace.brandLogoUrl bestaat al) + deelbare HTML-pagina (bestaande deploy/DNS-infra als optie noemen, niet bouwen) | unit: branding-injectie; visuele check |

### FASE INS — Designer-inspiratie-import

| Item | Wat | Verificatie |
|---|---|---|
| INS1 | **URL-capture**: URL plakken → Playwright-screenshot (bestaande infra) → vision-extractie (kleuren/typografie/spacing/stijlkenmerken) → opslaan als DesignTheme-**voorstel** (user accepteert — B-23) | integratie: capture van een lokale test-pagina → theme-voorstel met geëxtraheerde tokens |
| INS2 | **Screenshot-upload**: zelfde vision-extractie-pad vanaf een upload (MediaUploadButton hergebruiken) | integratie: fixture-image → theme-voorstel |
| INS3 | **Side-by-side vergelijk-view**: eigen pagina-capture naast de inspiratie + AI-verschillenanalyse → 1-klik redesign-ticket (hergebruik U-flow/ui-review-to-ticket) | e2e stub: vergelijk-run → ticket met bevindingen |
| INS4 | **Stijl-galerij**: curated presets (brutalist, glassmorphism, minimal, editorial, playful, corporate) als DesignThemes-seed naast de imports | unit: seed; UI-galerij |
| ADR | "Inspiratie-import → DesignTheme-voorstel (vision-extractie)" | |

### FASE CI — Comment-inbox (READ-ONLY)

| Item | Wat | Verificatie |
|---|---|---|
| CI1 | YouTube: commentThreads per gekoppeld kanaal ophalen (cron + on-demand refresh); scope-check + eventuele re-consent-flow netjes in de UI | integratie met fixtures (geen live YouTube nodig); scope-detectie-unit |
| CI2 | TikTok: comment-list via de beschikbare API (beperkingen documenteren — als de app-tier het niet toelaat: eerlijk "nog niet beschikbaar" in de UI, geen stub-fake) | fixtures-integratie; degrade-pad getest |
| CI3 | Inbox-UI: per kanaal, nieuwste eerst, markRead (bestaand patroon), badge in nav — **géén reply-knoppen** (bewust, §1) | e2e stub: comments verschijnen, markRead werkt |

### FASE EV — Eval-replay-harness

| Item | Wat | Verificatie |
|---|---|---|
| EV1 | Fixture-corpus GT-001..006 (golden tickets: opgenomen turn-events per stage, geanonimiseerd) + loader | corpus laadt deterministisch |
| EV2 | Structurele scorer: schema-validiteit, scope-naleving (files-touched vs ticket-scope), verb-gebruik, vraag-kwaliteit — draait op OPGENOMEN events, kost géén turns; `npm run ai:eval:pipeline` | scorer-unit + een bewust-kapotte fixture die rood scoort |
| EV3 | CI-haakbaar rapport (rood bij regressie t.o.v. baseline-scores per rol-prompt-versie) | rapport-snapshot-test |

### FASE KG — Klein grut

| Item | Wat | Verificatie |
|---|---|---|
| KG1 | Budget-alert-push: push-notificatie bij het passeren van alertPct (spend-tracking + push-infra bestaan — alleen de brug + dedup per drempel) | integratie: drempel-passage → één push, geen herhaal-spam |
| KG2 | webm + gif als render-containers naast mp4 (ffmpeg-args + formaat-keuze in de assemble-UI) | integratie: stub-render levert geldige webm/gif |

### FASE VO — Voice-interface (laatste — grootste klein-grut-item)

| Item | Wat | Verificatie |
|---|---|---|
| VO1 | Bestaande BUILD-DEFERRED-spec herlezen en bijwerken naar de huidige codebase; provider-abstractie voor STT/TTS (provider-pluggable — user-regel) | spec-delta gecommit |
| VO2 | Spraak-in voor de Assistant (phone-first, PWA-mic → STT → bestaand chat-pad) + spraak-uit (TTS op antwoorden, opt-in) | e2e stub-providers; live-proof met echte keys als afsluiter |

## §4 Volgorde-rationale

SK eerst omdat DOC/INS/VO er skills uit injecteren; DOC vóór EXP omdat export documenten nodig heeft; INS/CI/EV/KG zijn onderling onafhankelijk maar blijven sequentieel (waterfall-methode, invariant 9). VO laatst: grootste oppervlak, minst blokkerend.

## §5 Bewust NIET in dit programma

- Comment-**replies** (AI-suggestie of autopilot) — expliciet uitgesteld door de user; vergt ook YouTube `force-ssl`-scope + ADR-0269-achtige consent.
- 2FA-session-refresh — framework-kant (`@luckystack/login`), niet geselecteerd.
- Live golden-runs (eval) — pas na de replay-helft.
- Themes/styles-migratie onder het Skill-model — kan later, picker-UI-deling is genoeg voor nu.

## VOORTGANG (levend — bijgewerkt per gecommit increment)

| Item | Status | ADR | Test |
|---|---|---|---|
| SK1 | ✅ | 0270 | skillsLayer 28/28 |
| SK2 | ✅ | 0270 | skillsLayer 28/28 |
| SK3 | ✅ | 0270 | skillsLayer 28/28 |
| DOC1 | ✅ | 0271 | documentsModule 22/22 |
| DOC2 | ✅ | 0271 | documentsModule 22/22 |
| DOC3 | 🟡 | 0271 | ops+UI+images klaar; docx/pdf/xlsx-renderers in EXP |
| DOC4 | ✅ | 0271 | documentsModule 22/22 |
| EXP1 | ⬜ | | |
| EXP2 | ⬜ | | |
| EXP3 | ⬜ | | |
| INS1 | ⬜ | | |
| INS2 | ⬜ | | |
| INS3 | ⬜ | | |
| INS4 | ⬜ | | |
| CI1 | ⬜ | | |
| CI2 | ⬜ | | |
| CI3 | ⬜ | | |
| EV1 | ⬜ | | |
| EV2 | ⬜ | | |
| EV3 | ⬜ | | |
| KG1 | ⬜ | | |
| KG2 | ⬜ | | |
| VO1 | ⬜ | | |
| VO2 | ⬜ | | |
