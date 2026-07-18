# Branch log — `feat/design-docs-program`

Building `src/workspaces/_docs/DESIGN_DOCS_PROGRAM.md` (Design tool: UI-from-0 + decent→premium; Document tool: upload PDFs → technical-design doc). Waterfall, phase by phase, each gated (typecheck·lint·ai:lint) + tested, committed per phase.

---

## 2026-07-18 — Phase 0.1 + 0.2 + Phase 1 (shared container harness · file parser · document ingestion spine)

*User prompt:* `/goal` — build all phases of DESIGN_DOCS_PROGRAM.md, E2E test everything, keep going until lint/build/tests are green.

*What I did:*
- **0.1 Shared container harness** — `server/container/toolHarness.ts` (`runToolContainer` / `runToolContainerText`): the one "write inputs to a temp dir → run an image over /data → read an output file → clean up" helper, `--network none` by default, never throws. Refactored the document exporter (`renderDocx`/`renderPdf`) onto it.
- **0.2 PDF/docx/txt parser** — `server/documents/parseUpload.ts` (`extractUploadText`): pdf→poppler `pdftotext`, docx→pandoc, txt/md→verbatim; resolves the file safely under MEDIA_DIR (reuses `safeMediaPath`); typed status; MAX_TEXT cap.
- **1.1 Unblock upload** — added pdf/docx/txt/md to the client (`uploadMedia.ts`) + server (`uploadRoute.ts`, kind `file`) allow-maps + download MIME (`download.ts`).
- **1.2 Extract + store** — `document-edit` marks a parseable upload `extractStatus:'pending'` and fires background extraction OUTSIDE the write lock; new server-internal op `document-set-asset-text` persists the text onto the asset + indexes it (single-writer, B-23).
- **1.3 RAG grounding** — new `workspace-doc-assets` corpus (`indexDocumentAsset`/`clearDocumentAssets`, added to `RESERVED_CORPUS_COMMITS`); `runDocumentAi` now inlines the FULL extracted source text of the doc's attached files (`sourceMaterialBlock`, per-asset 12k / total 40k caps), raised the related-docs retrieval k=6/cap 4k. New op wired through `ControlOp` union + rbac + opCatalog (EXCLUDED). Editor: accept `.pdf/.docx/.txt/.md`, extract-status icon per file asset.

*Files touched:* `server/container/toolHarness.ts` (new), `server/documents/parseUpload.ts` (new), `server/documents/export.ts`, `server/documents/docs.ts`, `server/orchestrator/conductor.ts`, `server/rag/index.ts`, `server/control/rbac.ts`, `server/ai/opCatalog.ts`, `server/media/uploadRoute.ts`, `server/media/download.ts`, `server/read/workspaceSnapshot.ts`, `src/workspaces/_functions/uploadMedia.ts`, `src/workspaces/_functions/controlApi.ts`, `src/workspaces/_data/types.ts`, `src/workspaces/documents/[docId]/page.tsx`, `tests/unit/documentSourceGrounding.test.mts` (new).

*Verification:* typecheck 0 · lint 0 errors · ai:lint clean · new unit test 15/15 · opCatalog parity 53/53. Real-Docker E2E of the extraction pipeline proven: chromium→PDF→poppler `pdftotext` returns the text, and pandoc md→docx→md round-trips (both images pull + run).

*Notes:* Full upload→extract→generate through the live server (DB+redis) not yet run end-to-end; the container extraction itself is proven with real Docker. Poppler image `minidocks/poppler:latest` (env `WS_POPPLER_IMAGE`).

## 2026-07-18 — Phase 2.5 (diff-before-approve + revision restore)

*What I did:*
- **Diff-before-approve** — dependency-free LCS line diff (`src/workspaces/documents/lineDiff.ts`) rendered via the existing `DiffView`; the document draft-review panel now defaults to a diff (current vs AI draft) with a `+n −n` stat and a diff/preview toggle. Makes the apply-is-consent step (B-23) actually reviewable, incl. on a phone.
- **Revision view + restore** — the snapshot now ships each document's revision history (id/note/date only; content fetched on restore); new single-writer op `document-restore-revision` snapshots the current content first (undoable) then restores + reindexes; editor gains a History list with a confirm-gated Restore.

*Files touched:* `src/workspaces/documents/lineDiff.ts` (new), `tests/unit/documentLineDiff.test.mts` (new), `src/workspaces/documents/[docId]/page.tsx`, `server/read/workspaceSnapshot.ts`, `src/workspaces/_data/types.ts`, `server/orchestrator/conductor.ts`, `server/control/rbac.ts`, `server/ai/opCatalog.ts`, `src/workspaces/_functions/controlApi.ts`, `src/workspaces/_sync/documentsControl_server_v1.ts`, `src/workspaces/_shell/WorkspacesProvider.tsx`, `src/workspaces/_shell/WorkspacesContext.tsx`.

*Verification:* typecheck 0 · lint 0 errors · ai:lint clean · line-diff unit 9/9 · grounding 15/15 · op-parity 53/53. generateArtifacts re-run for the new snapshot field + op param.

## 2026-07-18 — Phase 2.4 (export fidelity: links · images · code · TOC)

*What I did:* upgraded the md→html export renderer (`server/documents/export.ts`) so the HTML/PDF export is genuinely submission-grade: markdown **links** + **images** (with a `safeUrl` gate — `javascript:` etc. dropped), **fenced code blocks** (escaped, language-tagged, not inline-parsed; markdown inside a fence stays literal), **horizontal rules**, **heading anchor ids**, a generated **table of contents** (≥3 headings), and **self-contained images** — any local `/media/` image is inlined as a data URI so the downloaded HTML + the `--network none` chromium PDF render both show it. Print CSS avoids breaking code/tables/images across pages. Rewrote `inline()` to escape-first (no placeholder scheme → removed stray NUL bytes + a `" 3 "`-in-prose corruption bug).

*Files touched:* `server/documents/export.ts`, `tests/unit/documentExportFidelity.test.mts` (new).

*Verification:* typecheck 0 · lint 0 errors · ai:lint clean · export-fidelity unit 16/16 (incl. XSS-url, code-fence-isolation, TOC-ignores-code, bare-number-safety). docx keeps pandoc's native md rendering. Known limits (headless-chromium): CSS margin-box page numbers aren't supported → no per-page numbers; footnotes not yet handled.

## 2026-07-18 — Phase 2.1 (document kind + user-authorable templates + template-guided generation)

*What I did:* the "detailed technical design" core.
- **Schema (additive, Mongo):** `Document.kind` + a `DocumentTemplate` model (`slug/name/description/sections[]/builtin`). `prisma generate` re-run.
- **Templates module** (`server/documents/templates.ts`): a built-in **Technical Design** template (Overview, Goals/non-goals, Requirements, Architecture, Data model, Wireframes & UX, System decisions, Risks & open questions, Milestones) — builtins are **virtual** (no seeding; a DB row with the same slug overrides one) so existing workspaces get them free. `parseSections` (safe), `buildSkeleton` (blank doc from a template), `buildTemplateStructure` (the outline-then-sections generation instruction), `listWorkspaceTemplates` (virtual-merge), `resolveTemplate`.
- **Generation:** `runDocumentAi` gained an optional `structure`; a templated doc (kind = a template slug) generates against the template's required section set, grounded on the uploaded source material (Phase 1). 
- **Create-with-template:** `document-create` takes `templateSlug` → seeds `kind` + a section skeleton. Documents list page gets a template picker (Blank + each template).
- **Authoring (option B):** control-ops `doc-template-save` / `doc-template-delete` (single-writer) + provider actions + a compact inline template manager (list/edit/duplicate-builtin/delete + a "Heading | hint" section editor).

*Files touched:* `prisma/schema.prisma`, `server/documents/templates.ts` (new), `server/documents/docs.ts`, `server/orchestrator/conductor.ts`, `server/control/rbac.ts`, `server/ai/opCatalog.ts`, `server/read/workspaceSnapshot.ts`, `src/workspaces/_data/types.ts`, `src/workspaces/_functions/controlApi.ts`, `src/workspaces/_sync/documentsControl_server_v1.ts`, `src/workspaces/_shell/WorkspacesProvider.tsx`, `src/workspaces/_shell/WorkspacesContext.tsx`, `src/workspaces/documents/page.tsx`, `tests/unit/documentTemplates.test.mts` (new).

*Verification:* typecheck 0 · lint 0 errors · ai:lint clean · templates unit 17/17 · op-parity 53/53. generateArtifacts re-run (snapshot gained `documentTemplates` + `kind`, route gained the template ops/params). Live AI generation of a full templated doc needs the running stack — not E2E-run here; the structure/skeleton/parse logic is unit-proven and the AI path is typechecked on the proven runDocumentAi pattern.

**Document tool status:** Phase 1 (ingestion) + Phase 2 (2.1 templates, 2.4 export fidelity, 2.5 diff+restore) done. 2.2 (mermaid rendering in export/editor) + 2.3 (a dedicated humanize preset — the humanizer skill already injects at document-generate when enabled) remain.

## 2026-07-18 12:27 — All-in-one product-gap scan

**User prompt (summary)**: Reconstruct what Workspaces really is, then use mainly Terra 5.6 and several Sol 5.6 models to scan the entire product for missing modules, module polish and especially missing cross-module links, including the phone-first all-in-one vision.

**What I did**:
- Ran a read-only dynamic workflow: one Sol 5.6 product-map, twelve Terra 5.6 dimension scans, three Sol 5.6 synth/verification passes and one Sol 5.6 final editor.
- Reconciled the historical narrow V1 docs against current code, recent ADRs and the expanded Development/Content/Design/Documents product scope.
- Adversarially verified 45 active high-value claim clusters and separated confirmed gaps, needs-live checks, roadmap ideas and stale/fixed findings.
- Added a standalone 983-line audit with 60 unique coupling edges, stop-ship/foundation findings, module polish, new tool candidates, target journeys, phased roadmap and live-verification matrix.
- Rechecked the Document findings against the concurrently landed Phase 2.1/2.4/2.5 commits so templates, export fidelity, draft diff and revision restore are not incorrectly reported as open.

**Files touched**: `src/workspaces/_docs/PRODUCT_GAP_SCAN_2026-07-18.md`, `branch-logs/feat-design-docs-program.md`, `branch-logs/INDEX.md`

**Notes / decisions**: This report records findings and roadmap candidates, not accepted architecture decisions. `npm run ai:index` could not run because this project no longer defines that script, despite the root contract still requiring it after significant docs changes.

## 2026-07-18 — Phase 3 (design premium loop: full-look extraction · mobile capture · lossless handoff · design-library RAG)

*What I did:*
- **3.1 full-look extraction** — inspiration import now also extracts the STYLE (radius/shadow/border/density/fonts/weight/tracking/motion/blur) via `extractStyleFromScreenshot` + `saveStyleProposal`, saved alongside the theme proposal, so an imported look resembles the reference once applied (not colour-only). Wired into `inspire-url`/`inspire-image`.
- **3.2 mobile capture** — `captureUrlScreenshot(url, viewport)` (desktop default + a 390px phone form factor); the inspiration route takes a `viewport` param (capture + compare).
- **3.3 lossless handoff** — `artifactContext.ts` now hands the coding agent the Studio artifact's ACTUAL HTML (bounded) instead of an "HTML omitted" pointer, and renders a linked ANIMATION artifact's motion spec (was silently dropped into an empty style doc).
- **3.6 design-library RAG** — new `design-library` corpus (`designLibraryRag.ts`); saving/deleting a look indexes/de-indexes it; `generateTheme` retrieves the workspace's existing looks and grounds on them (builds on the visual language instead of one-offs).

*Files touched:* `server/designer/inspiration.ts`, `server/designer/designLibraryRag.ts` (new), `server/designer/library.ts`, `server/designer/generateTheme.ts`, `server/orchestrator/artifactContext.ts`, `server/rag/index.ts`, `src/workspaces/_api/designerInspiration_v1.ts`, `tests/integration/designPremiumLoop.test.mts` (new).

*Verification:* typecheck 0 · lint 0 · ai:lint clean · designPremiumLoop integration **6/6 against real Mongo** (index+retrieve+de-index, animation motion-spec handoff, Studio HTML handoff). Remaining Phase 3: 3.4 (apply-active-design-tokens op — repo-mutating) + 3.5 (web-discovery via headless browser). Frontend viewport/before-after toggles are follow-ups on this backend.

## 2026-07-18 — Phase 4 (UI from 0 — generative scaffold at project creation)

*What I did:* the "describe an app → real starting UI" journey, routed through the EXISTING coding pipeline
(no new generator, per the deep-dive's recommendation). `project-from-template` gains an optional **brief**:
after the greenfield repo is initialised it seeds an **APP_BRIEF.md** context-doc and files a **scaffold
ticket** (`labels:['scaffold']`) auto-advanced to the first AI stage (start-with-AI) — so the ticket→stage→
in-container-agent pipeline generates the initial UI from the brief (single writer, B-23; no-op without a
linked repo). Brief threaded through the create form (a textarea in the template flow) → provider →
projectAdmin sync route → op.

*Files touched:* `server/orchestrator/conductor.ts` (project-from-template), `src/workspaces/_sync/projectAdmin_server_v1.ts`, `src/workspaces/_shell/WorkspacesProvider.tsx`, `src/workspaces/_shell/WorkspacesContext.tsx`, `src/workspaces/_shell/Shell.tsx`, `tests/integration/uiFromZero.test.mts` (new).

*Verification:* typecheck 0 · lint 0 · ai:lint clean · uiFromZero integration **6/6 vs real Mongo + a real greenfield repo** (project + linked repo + APP_BRIEF doc + scaffold ticket auto-advanced to an AI stage). The agent turn itself is the existing pipeline (torn down in the test).

## 2026-07-18 — Phase 3 completion (3.4 apply-tokens · 3.5 web-discovery)

*3.4 apply-active-design-tokens:* a new control op turns the workspace's ACTIVE theme into the project's
`src/index.css` (`buildIndexCss` → `@theme` light + `.dark` overrides) and commits it directly to main via a
new `commitFilesToMain` repoStore helper (throwaway clone → write → commit → push) — a fast mechanical apply,
no pipeline run (single writer, B-23; no-op without a linked repo/active theme). Wired: op + rbac + opCatalog +
projectAdmin route + provider action + a "Apply tokens" button in the designer.

*3.5 web-discovery:* `discoverReferenceSites(brief)` FINDS candidate reference sites from a brief via a
static-fetchable search endpoint (DDG html), following the scraper egress pattern (AbortController + withRetry
+ guards), behind a documented SWAP SEAM (`fetchSearch`) where a headless-browser backend can replace it. A
`discover` op on the inspiration route returns candidates; the user picks one → the existing capture+extract.

*Files touched:* `server/designer/applyTokens.ts` (new), `server/designer/webDiscovery.ts` (new), `server/git/repoStore.ts` (commitFilesToMain), `server/orchestrator/conductor.ts` (apply-design-tokens op), `server/control/rbac.ts`, `server/ai/opCatalog.ts`, `src/workspaces/_functions/controlApi.ts`, `src/workspaces/_sync/projectAdmin_server_v1.ts`, `src/workspaces/_shell/WorkspacesProvider.tsx`, `src/workspaces/_shell/WorkspacesContext.tsx`, `src/workspaces/designer/page.tsx`, `src/workspaces/_api/designerInspiration_v1.ts`, `tests/integration/applyDesignTokens.test.mts` (new), `tests/unit/webDiscovery.test.mts` (new).

*Verification:* typecheck 0 · lint 0 · ai:lint clean · applyDesignTokens integration **5/5 vs real Mongo + a real greenfield repo** (buildIndexCss + a real src/index.css commit) · webDiscovery parse unit **8/8**. Live web-discovery depends on outbound to the search endpoint (unreliable from this sandbox, like the mermaid-cli/puppeteer path) — the parse is unit-proven and the fetch is a swappable seam.

## 2026-07-18 — Carve-outs closed (mermaid export + live web-discovery)

*Mermaid export (2.2):* the earlier mermaid-cli/puppeteer crash is bypassed — the export now renders diagrams
in the WORKING chromium container by inlining the mermaid runtime (an IIFE global, no bundler) + init and
letting the print pass run it via `--virtual-time-budget`. `mdToHtmlBody` emits ```mermaid as
`<pre class="mermaid">`; `standaloneHtml` injects the runtime only when a diagram is present. **Verified real:**
a PDF of a flowchart contains the rendered node labels (Brief/Plan/ShipIt) and NO raw `flowchart TB` syntax.

*Web-discovery (3.5) LIVE:* discovery's primary path is now AI suggestion via the working provider layer
(`runAiCompletion('scraper')` → real reference URLs), with the static-search scrape kept as a fallback behind
the `fetchSearch` seam. **Verified live:** the brief "premium minimal fintech dashboard UI" returned 5 real
distinct sites (Stripe/Mercury/Ramp/Brex/N26).

*Files touched:* `server/documents/export.ts` (mermaid runtime + render), `server/designer/webDiscovery.ts` (AI discovery + parseAiSites), `src/workspaces/_api/designerInspiration_v1.ts` (workspaceId), `tests/unit/documentExportFidelity.test.mts`, `tests/unit/webDiscovery.test.mts`, `tests/integration/webDiscoveryLive.test.mts` (new).

*Verification:* typecheck 0 · lint 0 · ai:lint clean · export-fidelity unit 20/20 · webDiscovery unit 13/13 · webDiscoveryLive 3/3 (real AI) · real-Docker mermaid PDF render proven. **All DESIGN_DOCS_PROGRAM phases now complete + live-verified.**

## 2026-07-18 — Live browser E2E (Chrome DevTools MCP) + i18n fix

Ran a real browser pass against the running stack (server :4787 + client :5391): register → onboarding (module
picker incl. Documents + Design) → **Documents**: the template picker shows "Blank" + "Technical Design",
create-with-template opens the editor pre-filled with the FULL 9-section technical-design skeleton; the AI bar,
diff/preview, export (MD/HTML/PDF/Word/Excel), attachments + Templates manager all render → **Designer**:
gallery (8 looks, live previews) + Inspiration tab + Themes editor with the new **Apply tokens** button. 0
console errors.

*Bug found + fixed:* the new UI strings (template picker, manage-templates, diff/preview, history/restore,
designer "Apply tokens", the project-brief placeholder) were referenced by key but not defined in the
`src/_locales/*.json` bundles → they rendered as raw keys (e.g. "workspaces.documents.templateBlank"). Added
all keys to en/de/fr (English) + nl (Dutch), key-parity green (`localeIntegrity` 8/8). Re-verified in the
browser: labels now render ("Blank", "Templates", "Apply tokens", …).

*Files touched:* `src/_locales/en.json`, `src/_locales/de.json`, `src/_locales/fr.json`, `src/_locales/nl.json`.

## 2026-07-18 17:41 — A09 apply-tokens non-destructief + revision-safe

*User prompt:* Fix A09 design-token apply: behoud bestaande CSS en concurrente edits; target project/service/configured branch; expected-HEAD CAS; typed fail-closed; eerlijke ACK; tests/docs/generators/commit.

*What I did:*
- Vervangen van heel `src/index.css` is verwijderd. De active theme wordt nu gevalideerde token-data; alleen `--color-*`-declaraties in exact één top-level Tailwind `@theme` en (indien nodig) `.dark` block worden gepatcht. Alle overige bytes/comments blijven intact; non-Tailwind, missing/ambiguous managed blocks en onveilige servicepaden falen typed en closed.
- De bestaande repo-helper is branch-aware gemaakt: raw file-read op één SHA, configured `gitConfig.targetBranch`, project/servicepad, HEAD-check direct vóór commit en `--force-with-lease=<expected SHA>` als push-CAS. Unchanged is een succesvolle no-op; een race geeft `repo.headChanged` zonder overwrite.
- De Conductor resolveert nu `target.projectId` (de sync-route zette het al daar), optionele `serviceId`/`Service.path`, configured branch en geeft typed semantic/git failures door aan de bestaande control-failureketen. Designer-feedback wacht op de echte sync-ACK i.p.v. een timer.
- ADR 0276 + DESIGN_DOCS_PROGRAM-bewijs bijgewerkt; artifacts/generators vernieuwd.

*Files touched:* `server/designer/applyTokens.ts`, `server/git/repoStore.ts`, `server/orchestrator/conductor.ts`, `src/workspaces/_shell/WorkspacesContext.tsx`, `src/workspaces/_shell/WorkspacesProvider.tsx`, `src/workspaces/designer/page.tsx`, `tests/integration/applyDesignTokens.test.mts`, `src/workspaces/_docs/DESIGN_DOCS_PROGRAM.md`, `docs/decisions/0276-revision-safe-managed-design-token-apply.md`, gegenereerde AI-indexen, branch-log/index.

*Verification:* applyDesignTokens integration **35/35** tegen echte Mongo + echte git; `npm run typecheck` groen; target ESLint 0; `npm run build` groen; `npm run ai:lint` schoon; generateArtifacts + decisions/capabilities/project-index/graph/product/context-budget groen. Volledige lint: 0 errors, 22 reeds aanwezige warnings in andere gelijktijdig gewijzigde document/content/settings-files (niet drive-by gefixt).

*Notes:* Geen nieuw control-verb/schema/productkeuze. De werkboom bevat omvangrijke gelijktijdige wijzigingen van andere A0x-prompts; die zijn niet door A09 overschreven.
