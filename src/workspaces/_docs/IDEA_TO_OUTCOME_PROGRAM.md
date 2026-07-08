# IDEA → OUTCOME PROGRAM (het volgende grote /goal-bouwplan)

> Doel: de tool écht van **idee → afgemaakte uitkomst** brengen — een echte multi-scene video op YouTube, en (voor demos) `main` draaiend op een DNS — mét een conversatie-laag die de hele keten aftrapt. Gebaseerd op de eerlijke 5-agent-audit (`memory/workspaces-honest-gap-audit.md`) + de user-visie (2026-07-08). Draai met `/goal` over dit bestand, fase-voor-fase, waterfall (elke fase getest+gecommit vóór de volgende). Auteur-commits: `ItsLucky23`, niet gepusht. Alle FREEDOM_PROGRAM-invarianten blijven gelden (single-writer/B-23, frozen-verbs, `runInTenant`, PTY-billing, geen `as any`, tryCatch, i18n×4, theme-tokens, per-item test+ADR+branch-log+commit, gates tsc+lint+ai:lint+build).

## Kern-visie (user, 2026-07-08)
- **Langere video's via decompositie:** een 60s high-res video = splits het idee in bv. **4×15s scenes die op elkaar inspelen**, samengesteld via een **editor met timeline**. Geen dia's — échte videoclips gestitcht.
- **Range-edit:** selecteer bv. **seconde 13-18** → "refine de overgang / de voice-over / whatever" → alleen dat stuk opnieuw. Zo bouwen we onze eigen manier om lange video's te maken.
- **Simpele editor-tools:** stuk wegknippen (split/cut), transitions, per-scene trim.
- **Rijke image-editor** (bovenop E1/E2): crop, resize, tekst-overlay, meer.
- **Demo-hosting:** niet per se prod, maar "op DNS X draait `main`" — vanaf current-commit/timestamp óf altijd auto-update naar de verste main-commit (handig voor demos). **Echte prod = liever de build-output/CI-CD naar een andere server deployen.**
- **Publish moet écht landen** (YouTube byte-upload af).
- **Conversatie:** "maak een video/app over X" moet de hele pipeline aftrappen; nu is alles losse knoppen + de assistent kan alleen 3 board-ops.

---

## VOORTGANG (levend — bijgewerkt per gecommit increment)

| Item | Status | ADR | Test |
|---|---|---|---|
| Bug: `npm test` Redis WRONGPASS | ✅ | — | testWithSecrets |
| L2 O-A/O-B (intake copilot + assistent creëert) | ✅ | 0145 | 19/19 |
| V1 VideoScene-model + save-scenes | ✅ | 0146 | 14/14 |
| V2 echte multi-clip render | ✅ | 0147 | 17/17 |
| V3 long-video-decompositie | ✅ | 0148 | 9+9 |
| V4 range-refine | ✅ | 0149 | 10+7 |
| D1 YouTube byte-upload | ✅ | 0150 | 12/12 |
| D2 TikTok status-polling | ✅ | 0151 | 11/11 |
| O-C content-run-pipeline | ✅ | 0152 | 6/6 |
| V5 timeline-editor-UI | ✅ | 0153 | tsc/lint/build; browser-verify pending |
| V6 knip/transition (via V5) | ✅ | 0153 | idem |
| O-D auto-activatie | ✅ | 0154 | 5/5 |
| B2 tekst-overlay (image-editor) | ✅ | — | tsc/lint/build |
| L3 mobiel · D3/D4 host/prod · G greenfield · B1/B3 crop/filters | ⬜ | | |

> **Content "idee → uitkomst" backend + publish is COMPLEET** (O-A/O-B → O-C → D1/D2). Resterend = UI (browser-verify met dev-server) + deploy/greenfield (Docker/git).

---

## FASE V — Echte video (de marquee) — "van idee → 60s multi-scene video"

- **V1 — Video-segment-model (de basis).** Een piece krijgt een geordende lijst **Scenes/Segments**: `{order, videoAssetId?, imageAssetId?, startTrimMs, endTrimMs, transitionIn: 'cut'|'fade'|'xfade', durationMs}`. Prisma-model `VideoScene` (per-piece). **Seam:** nieuw model + snapshot-expose (piece.scenes). **Verify:** scenes CRUD-op + in snapshot; getest.
- **V2 — Echte multi-clip render (geen diavoorstelling).** `render.ts` een `buildVideoStitchPlan(scenes, audioPlan)` die ÉCHTE videoclips concat + per-segment `atrim`/`trim` + `xfade`/`fade`-transitions + de E4-audio-mix als één track. Stills → ken-burns/`zoompan` clip zodat beeld-én-video-scenes mengen. **Seam:** `render.ts` (nieuwe video-plan naast de slideshow) + `assembly.ts` gebruikt scenes als aanwezig. **Verify:** fixture assert het ffmpeg-plan (concat-order + xfade + trim); live-render-test (`renderLive`) uitbreiden naar 2 video-clips → 1 gestitcht mp4.
- **V3 — Long-video-decompositie ("splits in 4×15s die op elkaar inspelen").** Een `content-decompose-video`-flow: de AI (script-feature) splitst het idee in N scene-prompts die **continuïteit** doorgeven (elke scene krijgt de vorige eind-state/laatste-frame + een "flow-into"-instructie) → genereert per scene een clip (fal video-gen; te-kort → image+ken-burns) → vult V1-scenes. **Seam:** script-feature + video-gen-loop + V1. **Verify:** een idee → N scenes met doorlopende prompts; getest op de decompositie-logica (puur) + stub-assets.
- **V4 — Range-edit ("selecteer 13-18s → refine de overgang/voice").** Een `content-refine-range`-op: gegeven `{startMs, endMs, instruction}` → map naar de dekkende scene(s) → regenereer/inpaint dat segment (+ de transition) + optioneel de voice-over van dat stuk → nieuwe scene-versie (I2-lineage). **Seam:** scene→tijd-mapping (puur, testbaar) + video-gen/inpaint + voice-regen. **Verify:** range→scene-mapping getest; de op maakt een nieuwe segment-versie.
- **V5 — Timeline-editor-UI (Fabric/custom).** Een `VideoTimelineEditor`: scenes als blokken op een tijdlijn (drag-reorder, sleep-trim de randen), een range-selector (klik-sleep over de tijdlijn) → "refine deze selectie"-knop → V4, per-scene transition-dropdown, split/cut-knop (splitst een scene op de playhead), delete-scene. + een audio-spoor met de E4-waveform + volume/duck-sliders. Lazy-loaded. **Seam:** nieuw component + V1/V4-ops + E4-waveform. **Verify:** browser-verified (dev-server draait); de ops eronder zijn getest.
- **V6 — Simpele knip/transition-tools.** Split-op (scene op tijd T in twee), delete-scene-op, transition-set-op — alle via de timeline. **Verify:** split/delete/transition-ops getest (scene-lijst correct).

## FASE B — Rijke image-editor (bovenop E1/E2)
- **B1 — Crop + resize** (Fabric crop-rect → export sub-region; resize naar preset). **B2 — Tekst-overlay + shapes** (Fabric IText/shapes → export). **B3 — Meer filters + in-canvas variation-compare** (side-by-side origineel vs edit). **Verify:** export→content-import-asset getest; canvas browser-verified.

## FASE L2 — Conversatie & orchestratie (het GROOTSTE gat)
- **O-A — IntakeCopilot (de conversationele voordeur).** Eén NL-entry ("maak een 60s video over mijn startup" / "bouw een todo-app") → de AI stelt een PLAN voor (scenes/tickets/stappen) → mens keurt goed → de Conductor voert de hele keten uit + ketent de stappen automatisch. **Seam:** nieuwe `intake`-AiFeature + een plan→ops-vertaler (propose→accept→Conductor) + een intake-UI (chat + plan-preview). **Verify:** een NL-idee → een geldig meerstaps-plan van bestaande ops; de accept voert ze geketend uit (getest met stub-providers).
- **O-B — Assistent voorbij 3 board-ops.** Breid `workspaceChat`'s vocabulaire uit: `quick-add` (ticket), `content-create` (+ de content-gen-keten), `save-*`-settings, `run-custom-task` — allemaal *propose* (nooit direct schrijven; frozen-verbs + single-writer intact). De assistent wordt een echte "doe X"-surface i.p.v. board-reshuffle. **Seam:** `workspaceChat.ts` system-prompt + validate() + de accept-dispatch. **Verify:** de assistent stelt een create/gen/config-op voor; accept voert 'm uit; kan geen authoritative state direct schrijven (getest).
- **O-C — Content-pipeline-orchestratie ("maak de hele video").** Een `content-run-pipeline`-op die script→images/clips→voice→assemble ketent (de AI bepaalt de volgorde), met de mens die alleen kosten/kern-gates goedkeurt (autonomie-dial hergebruikt). **Seam:** een content-orchestrator (mirror de code-stageRunner-loop) + de bestaande content-gen-ops. **Verify:** één op → een complete piece met alle assets (stub); autonomie-niveaus werken.
- **O-D — Auto-activatie.** `quick-add` + een "start met AI"-toggle → automatisch naar de eerste AI-stage (geen handmatig slepen). **Verify:** een ticket met de toggle activeert vanzelf (getest).

## FASE L3 — Telefoon-first + resterende eerlijkheid
- **P-A — Mobiele chat + approvals-inbox.** De `AIPanel` (`hidden lg:flex`) krijgt een mobiel sheet (de mobiele "AI"-knop toont nu niets) → chat + suggesties-inbox + goedkeuren op de telefoon. **Verify:** browser-verified mobiel; de accept-ops zijn getest.
- **P-B — Structured approvals (A5-helft-2).** Rijke approve/reject/choice-kaarten i.p.v. een tekst-banner: `request-input`/`answer-input`-op + een kaart-UI, telefoon-bruikbaar. **Verify:** een gerouteerde keuze post de juiste op (getest).
- **P-C — Stub/fout zichtbaar in de UI.** Een badge op stub-PublishJobs ("niet echt geplaatst — verbind het platform") + op error-renders ("render mislukt — keys/Docker nodig"), zodat de eerlijkheids-fixes (ADR 0144) ook zichtbaar zijn. **Verify:** de UI toont de stub/error-status.

## FASE D — Publish + demo-hosting écht laten landen
- **D1 — YouTube byte-upload afmaken.** De resumable-upload voltooien: stap-1 leest de `Location`-session-URL uit de header → stap-2 PUT de videobytes → stap-3 leest de video-id. + een echte multipart/media-body. Mislukking = `error` (ADR 0144 al gedaan). **Seam:** `publishOAuth.ts buildUploadRequest`/`realUploadTransport`. **Verify:** de upload-request-shape (init→PUT→confirm) getest; live round-trip = user met echte OAuth-app.
- **D2 — TikTok status-polling + publieke media-URL.** Poll `/post/publish/status/fetch/` tot bevestigd; de asset-URL moet publiek bereikbaar zijn (via D3-demo-host of een media-CDN) voor `PULL_FROM_URL`. **Verify:** polling-logica getest.
- **D3 — Demo-host "main draait op DNS X".** Een `demo`-environment-kind dat `main` (of een pinned commit/timestamp) serveert + optioneel **auto-redeploy op nieuwe main-commit** (een watcher die de laatste main-commit pakt). Hergebruikt de bestaande deploy-engine (Caddy+Docker). **Seam:** `deploy/environment.ts` + een main-tracking-watcher. **Verify:** een demo-env pakt main + redeployt op een nieuwe commit (getest met injected git-state). NB: échte prod = D4.
- **D4 — Prod = build-output/CI-CD naar externe server.** Een `buildExport` die een échte productie-build (`npm run build` → dist/) exporteert als tarball/image + een deploy-hook (webhook/SSH/registry-push) naar een externe server. (Vervangt `export.bundleNotImplemented`.) **Seam:** `buildExport.ts` + een externe-deploy-hook. **Verify:** een prod-build-artifact wordt geproduceerd (getest); de hook POST/pusht (fixture).

## FASE G — Greenfield ("van een idee → draaibare software")
- **G1 — Echt repo + file-tree genereren.** `project-from-template` moet een echte bare repo initialiseren (`git init --bare` in de repoStore) + de impl-stage laten scaffolden (of een ingebouwde git-server, ADR-keuze). Zodat `isLinked` true wordt → container → code. **Verify:** een greenfield-project levert een draaibare repo (getest zonder externe forge).
- **G2 — Welcome/template-wizard-UI.** De `createFromTemplate`-provider-methode aan een echt welkomstscherm koppelen (bestaat nu nergens). **Verify:** browser-verified.

---

## Volgorde-advies (waterfall)
1. **L2 O-A/O-B eerst** (conversatie-voordeur + assistent) — deblokkeert het "gewoon chatten" gevoel voor ALLES.
2. **Fase V** (echte video + timeline + range-edit + long-video) — de marquee-uitkomst.
3. **Fase D** (publish-byte-upload + demo-host) — zodat de video écht landt.
4. **L3** (mobiel + structured approvals + stub-zichtbaarheid).
5. **Fase B** (rijke image-editor), **Fase G** (greenfield), **O-C/O-D** (content-orchestratie + auto-activatie).

Elke fase: gebouwd → gegate → getest → ge-ADR'd → gecommit vóór de volgende. Browser-heavy UI (V5-timeline, B, L3-mobiel, G2) verifiëren met de dev-server draaiend (user autoriseerde dit) via agent-browser/Playwright (suggest→approve).
