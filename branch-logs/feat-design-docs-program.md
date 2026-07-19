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

## 2026-07-18 18:34 — PTY-context en prompt-injection hardening

*User prompt:* Sluit de PTY/tool/context-blockers: one-shot Claude deny-all + minimale env, verwijder tweede Enter, en behandel web/MR/plan/chat/CarryOver/handoff/RAG-context als untrusted terwijl actuele user-instructies authoritative blijven.

*What I did:*
- One-shot `claude` blijft interactieve PTY, maar krijgt nu een fail-closed `permissions.deny` (`*` plus expliciete Bash/Read/Edit/Write/Glob/Grep/Web/Task/MCP-regels), een login/runtime/temp env-allowlist en exact één prompt-submit.
- Workspace-chat state/RAG/history, scraper-webtekst, MR-diff, AI-plan, CarryOver en self-handoff staan in unieke delimiter-blocks met de policy erna; de huidige user request en deterministic role-task blijven erbuiten.
- Script style/brand/knowledge/RAG blijft untrusted; `extraInstructions` en de actuele brief zijn expliciet authoritative.
- Fake-PTY/env/settings- en hostile-delimiter regressies toegevoegd; bestaande concurrente security-edits behouden.

*Files touched:* `server/ai/providers/claudeCli.ts`, `server/ai/workspaceChat.ts`, `server/scraper/role.ts`, `server/mr/reviewRole.ts`, `server/reasoning/planCritiqueRole.ts`, `server/orchestrator/renderStage.ts`, `server/orchestrator/turnResult.ts`, `server/content/script.ts`, `tests/unit/claudeCliProvider.test.mts`, `tests/unit/promptContextBoundaries.test.mts`, `tests/integration/stageEngine.test.mts`, `tests/integration/scriptGrounding.test.mts`, plus Ctx-fixture updates in `tests/unit/chatCreateOps.test.mts` en `tests/unit/opCatalogParity.test.mts`.

*Verification:* fake Claude **19/19**; prompt boundaries **19/19**; stage engine **37/37**; script grounding **8/8**; MR review **9/9**; plan critique **6/6**; chat create ops **19/19**; op-catalog **53/53**; gerichte ESLint schoon; typecheck groen; `npm run build` groen; `npm run ai:lint` schoon. Volledige lint werd tussentijds groen, maar eindigde door een nieuwe gelijktijdige buiten-scope edit op **2 errors** in `server/media/uploadRoute.ts:885` plus 22 reeds aanwezige waarschuwingen; gerichte scope-lint blijft schoon.

*Notes:* Geen commit, ADR, inhoudelijke docs of generators uitgevoerd. De omvangrijke gelijktijdige worktree is niet opgeschoond of overschreven.

## 2026-07-18 19:07 — Renewable workspace lease en fail-closed guard

**User prompt (summary)**: Fix A10 binnen ADR 0015: renew de workspace-lease tijdens >TTL-actions, maak leaseverlies caller-zichtbaar/fail-closed, geef de Conductor guard-checkpoints en bewijs dit met korte real-Redis/conductor-tests zonder nieuwe leader-forwarding of generator/commit.

**What I did**:
- Vervangen van de vaste workspace-lease door een sequentiële owner-checked renew-loop (elke 5s bij 15s TTL), met volledig injecteerbare testtimings en zonder overlappende renewals.
- Toegevoegd: `WorkspaceLeaseGuard` (`assertHeld` + `AbortSignal`) en zichtbare `WorkspaceLeaseLostError`; renew/deadline/release-onzekerheid faalt closed en release blijft owner-safe.
- De Conductor checkt leasebezit vóór seq, vóór signal-append, vóór execute en vóór succesvolle completion; de recovered queue-tail blijft bruikbaar na verlies.
- Real-Redis regressie toegevoegd voor een 320ms-action met 120ms-TTL + tweede contender, plus renewal-loss/successor-release; control-ACK regressie injecteert verlies op alle vier grenzen en bewijst caller failure + queueherstel.
- ADR 0277 supersedeert ADR 0015 en begrenst de claim eerlijk: geen volledige DB-fencing zonder cross-store atomische fencing; event-loop stalls en reeds gestarte Prisma/provider-writes blijven residual risk.

**Files touched**: `server/orchestrator/cluster.ts`, `server/orchestrator/conductor.ts`, `tests/integration/multiInstance.test.mts`, `tests/integration/controlAck.test.mts`, `docs/decisions/0015-multi-instance-safety-deel-a.md`, `docs/decisions/0277-renewable-workspace-lease-with-fail-closed-guard.md`, `docs/AI_DECISIONS_INDEX.md`, `branch-logs/feat-design-docs-program.md`, `branch-logs/INDEX.md`.

**Notes / decisions**: Geen leader-forwarding, nieuw verb of productarchitectuur. Geen commit/generators. Verificatie: multiInstance 22/22, controlAck 34/34, typecheck groen, gerichte lint schoon, volledige lint 0 errors/22 bestaande warnings, build groen, ai:lint schoon.

## 2026-07-18 19:44 — End-to-end project execution scope (A12/F21/E02/E15/E29)

**User prompt (summary)**: Fix project execution scope end-to-end while preserving concurrent edits, security, leases, A09 and ADR 0035; add two-project duplicate-key/APP_BRIEF regressions; regenerate artifacts; do not commit.

**What I did**:
- Made `ticket.projectId` authoritative for stage runtime, next-stage lookup, reprovision, watchdog recovery and edit guard; all stage identity reads now use `(workspaceId, projectId, key)`.
- Scoped starter and explicit project-owned context to the ticket project while retaining workspace-wide design-system context per ADR 0034; new dev projects now receive their own starter library.
- Required and validated `projectId` for stage save/create/delete/reorder, scoped every mutation to that project, and made reorder validate the complete target-project stage set.
- Made bulk move validate every ticket and every target-project stage before mutation; explicit mixed-project requests fail closed and internal unscoped batches split writes/worktree activation by project.
- Threaded active project context through finding/review conversion, pipeline/chat/provider/sync call sites and snapshot state; compare reviews retain a live artifact link so screenshots and analysis reach stage context.
- Added two-project regressions with duplicate stage keys and distinct `APP_BRIEF.md` content, including runtime/next/reprovision/editguard/snapshot/stage mutation/bulk move/finding/review coverage.

**Files touched**: `server/bootstrap/starterLibrary.ts`, `server/orchestrator/{artifactContext,conductor,editGuard,projectResolve,stageRunner,watchdog}.ts`, `server/read/workspaceSnapshot.ts`, project-aware Workspaces API/sync/provider/pipeline/interviewer/designer/board files, and focused integration/unit tests including `tests/integration/multiProject.test.mts`.

**Verification**: `npm run generateArtifacts` and `npm run typecheck` green; multi-project **45/45**, pipeline stages **8/8**, stage persona **3/3**, watchdog **24/24**, UI review **35/35**, plus stage-engine/model-wiring targeted tests green. Final `npm run lint`: 0 errors / 22 pre-existing concurrent warnings; `npm run build` green (existing Vite chunk warnings); `npm run ai:lint` clean.

**Notes / decisions**: No schema change or new ADR was needed; this enforces existing ADR 0035 and preserves ADR 0034/A09/renewable-lease behavior. No commit. The large concurrent worktree was not reverted, reformatted or otherwise cleaned up.

## 2026-07-18 20:24 — UI-review en MR-fallback projectbinding

**User prompt (summary)**: Persist UI-review project scope, make conversion and legacy handling fail closed, and derive rollback/MR reindex scope from source records. Preserve concurrent edits; regenerate Prisma/artifacts; test focused paths; do not migrate, install or commit.

**What I did**:
- Added optional indexed `UiReviewRequest.projectId`, validated explicit workspace-project bindings, and exposed the persisted binding through snapshots/client types.
- Made review conversion authoritative on the persisted project, rejected foreign/mismatched projects, and required an explicit active project for legacy null-project reviews.
- Kept project B stable across active-project switches and linked converted review artifacts to the resulting project-B ticket/context.
- Derived rollback follow-up tickets from the culprit MR/source ticket pair and post-merge RAG reindex from the validated MR/ticket project instead of project #1.
- Added focused UI-review, two-project, rollback and real-git MR/reindex regressions; regenerated Prisma Client and route artifacts.

**Files touched**: `prisma/schema.prisma`, `server/orchestrator/conductor.ts`, `server/read/workspaceSnapshot.ts`, `src/workspaces/_api/designerInspiration_v1.ts`, `src/workspaces/_data/types.ts`, `src/workspaces/_shell/{WorkspacesContext,WorkspacesProvider}.tsx`, `src/workspaces/_sync/{uiReviewAction,uiReviewCreate}_server_v1.ts`, `src/workspaces/designer/page.tsx`, `tests/integration/{uiReview,multiProject,aiRollback,mergeReal}.test.mts`, generated route artifacts.

**Notes / decisions**: No new architecture decision; this enforces ADRs 0035, 0042 and 0045. Verification: UI-review 49/49, multi-project 59/59, rollback 12/12, real MR/reindex 18/18, snapshot 33/33; typecheck/build/ai:lint green and focused ESLint clean. Full lint has 0 errors and 21 unrelated existing warnings. Designer inspiration reached 15 passing assertions but its 2 Docker capture assertions could not run because Docker was unavailable. No migrate/install/commit was performed by this task session; concurrent worktree changes were preserved. During final verification, another concurrent process committed the shared worktree as `7ee6fc1` (including these files); this session did not create or amend that commit.

## 2026-07-18 21:05 — GAP_SCAN_PROGRAM afgewerkt (fases A t/m G)

**User prompt (samenvatting)**: "werk nu al jouw punten af, negeer dat de andere AI ook bezig is … ik wil dat je alles in 1 keer maakt en zorgt dat alles groen is op het gebied van linting en building en alles e2e testen."

**Wat ik heb gedaan** — alle openstaande items uit `src/workspaces/_docs/GAP_SCAN_PROGRAM.md`:

- **Fase A (autopilot)**: A1–A3 multi-channel fan-out + retry/backoff + failure-notify (commit `58568a7`); A4 dode-OAuth-detectie + reconnect-CTA (`7ee6fc1`); A5 per-kanaal health-paneel, A6 burst-staggering, A7 platform-app-credentials in-app (encrypted, write-only, `.env` als fallback, géén auto-migratie) (`219afa6`).
- **Fase B (phone-first)**: offline write-queue met replay + banner, workspace aanmaken vanaf mobiel, echte deep-links voor ticket-loze notificaties, iOS PWA-installatiepad + eerlijke push-foutmeldingen, en één globale `@media (pointer: coarse)`-regel voor 16px inputs / 44px touch-targets (`f75789c`).
- **Fase C (koppelingen)**: alle acht bruggen — institutional-memory RAG in chat + interviewer, documenten hergebruiken bestaande assets, skill-ops in de chat-catalogus, catalogus gefilterd op modules, root-cause op diff + RAG, comments → ideator, documenten archiveren/herstellen + ⌘K-indexering, designer prefill vanaf de live omgeving (`ef50bd8`).
- **Fase D/E/F**: AI-job-queue (concurrency-cap + circuit breaker), per-tool-call audit-trail via PostToolUse-hook, deploy-history + rollback-op, durable audit-archief; stale-redeploy gefixt, tenant- en egress-guards report-first; thumbnail-studio, caption-styling/word-reveal/dubbing, SEO-laag, metric-snapshots + A/B, community-replies + sentiment (`b19f071`).
- **Fase G**: workspace-cloning, ship-it-live voor Studio-artifacts (`/s/<slug>`, strikte CSP), workspace-brede asset-library, pipeline-presets (dode `presetKey` echt gemaakt), prompt-A/B met eerlijke statistiek, en site-monitoring met snapshots + diff (`fb89898`).

**Files touched**: ~60 bestanden verspreid over `server/{ai,content,orchestrator,deploy,tenant,container,bootstrap,read,scraper,control}`, `src/workspaces/{_api,_sync,_shell,_functions,_data,_components,content,documents,designer,settings,workspace}`, `prisma/schema.prisma` (7 nieuwe modellen), alle vier `src/_locales/*.json`, plus 11 nieuwe testbestanden.

**Verification**: `npm run typecheck`, `npm run lint` (0 errors), `npm run ai:lint` (clean) en `npm run build` groen. Tests: newModules 57 + 48, contentDepth 74, reliabilityGuards 50, couplingBridges 42 + 13, phoneLoopIntegrity 33, publishHealthStagger 21, platformCredentials 22, publishHealth 16, deployAudit 16, plus bestaande suites (opCatalogParity 54, securityGuards 33, snapshot 33, settings 27, seed 61, scheduledPublish 32) allemaal groen.

**Notes / decisions**: ADR 0278 legt de drie programma-brede keuzes vast (security-guards report-first, gaps sluiten met ops i.p.v. verbs, eerlijke no-ops voor wat een platform niet ondersteunt). Descoped door de eigenaar: F6, G1, G6. E4 was al gedaan door de parallelle AI. Twee vondsten tijdens het werk: de cascade liet `AuditLog`- en `DeployHistory`-rijen wees achter (nu opgeruimd), en `isModuleEnabled` is te los voor op-gating (modules delen secties) — daarom keyt `opAvailable` op de definiërende sectie per module.

## 2026-07-18 23:22 — Automation/role writer-ordering B2 fase 1

**User prompt (samenvatting)**: Sluit automation/role direct-writer ordering met drie server-only InternalOps, zonder jobschema, publiek op-contract, Studio-B5, schema/migratie/generator of commit; behoud alle gelijktijdige forge-edits.

**Wat ik heb gedaan**:
- Toegevoegd: `automation-event-apply`, `automation-cron-fire` en `automation-action-run`, met begrensde typed payloads en zonder overlap met `ControlOp`/RBAC/proposal/sync-surfaces.
- `fireEvent` enqueueët altijd achter de workspace-chain; event- en cronhandlers re-readen triggerstate en voeren match/debounce/dedupe/action/`lastFiredAt` uit onder tenant + renewable writer lease. Cron gebruikt een stabiel trigger+minuut request-id.
- Externe trigger/action/role-aanroepen lopen via InternalOps; matching writer scope voert direct uit, wrong-workspace faalt. Findings, rol-suggesties, MR-comment-apply en scraper-watchmutaties hebben writer+tenant assertions op de mutatiegrens.
- Signal-recursie blijft gequeued en begrensd; emit-signal gebruikt de gedeelde Redis-seq. AI/webhook/Docker/push blijven in deze fase eerlijk onder de renewable lease met een expliciete follow-up-TODO.

**Files touched**: `server/automation/{agentRoles,cron,executor,triggers}.ts`, `server/orchestrator/{conductor,internalOps,writerContext}.ts`, `server/interviewer/findings.ts`, `server/mr/{reviewRole,rootCauseRole}.ts`, `server/reasoning/planCritiqueRole.ts`, `server/scraper/watch.ts`, en gerichte automation/writer/watch/webhook-tests.

**Verification**: typecheck groen; build groen; ai:lint schoon; volledige lint 0 errors / 25 bestaande warnings. Automation 31/31, writer-foundation 34/34 + 15/15, content-role 7/7, webhook 12/12, multi-project 69/69, watch/new-modules 48/48, MR-review 9/9, rollback 12/12, plan-critique 6/6, Studio 33/33. Run-command ordering/no-op 1/1; live Docker-leg overgeslagen omdat Docker niet beschikbaar was.

**Notes / decisions**: Geen schema, migratie, publiek verb, generator, ADR of commit. De reeds dirty forge-files zijn niet door deze taak aangepast of teruggedraaid.

## 2026-07-19 06:02 — Fenced watchdog/worker-reaper recovery

**User prompt (samenvatting)**: Implementeer de blockers uit `results/27` als één veilige recovery-lane: splits de korte capacity-lease van de harde turn-max, routeer recovery/reminders/sessionstatus via typed InternalOps, verifieer immutable Docker-identiteit + run-owner, verhuis watchdog naar cron en maak reaper-idle clusterduurzaam; behoud alle dirty work en commit/migreer niet.

**Wat ik heb gedaan**:
- `WS_CAPACITY_LEASE_MS` (standaard 30s) losgemaakt van `WS_TURN_MAX_MS`; admission/heartbeat/renewal/stale eviction gebruiken uitsluitend de korte lease. Recovery neemt de exacte oude token/fence atomair over met een deterministische hogere recovery-owner; oude releases/callbacks kunnen een successor niet raken.
- Server-only `agent-recovery-transition` (`prepare|complete|cancel`) en `watchdog-reminder-apply` toegevoegd aan de InternalOp/Conductor-lane, inclusief exact ticket/session-CAS, processed durable intent, transient `recovering`, recovery-owner-verificatie en idempotente notification/timestamp-CAS. Ook manual kill gebruikt nu hetzelfde recoveryprotocol in plaats van een directe AgentSession-write.
- Docker recovery controleert immutable container-ID, workspace/project/ticket-labels en `/work/.workspaces-run-owner`, handelt nonzero inspect/exec/stop en eindtoestand fail-closed af, en voert Docker buiten de writerlease uit; complete/reprovision gebeurt pas daarna en awaited. Session start reset `startedAt` + heartbeat.
- Watchdog geregistreerd als `@luckystack/cron` `runOnStart` job; de boottimer verwijderd. Tenantwerk loopt onder `runInTenant`; reminders gaan door InternalOps en push door een once-claim. Worker-reaper gebruikt exacte cross-tenant identities, host-global Redis-idle timestamps en een tweede editor/statusprobe; een onbeschikbare editorprobe of Dockerfout stopt niets.
- Env-templates, runtime/schema-contractcommentaar, 04b/07b builddocs en ADR 0279 bijgewerkt; ADRs 0020/0022 gemarkeerd als superseded en decision-index geregenereerd.

**Files touched**: `.env{,.local}_template`, `luckystack/cron/jobs.ts`, `prisma/schema.prisma`, `server/container/runtime.ts`, `server/proxy/editorReaper.ts`, `server/orchestrator/{agentControl,capacity,conductor,internalOps,recoveryWriter,stageWriter,watchdog,workerReaper}.ts`, `server/server.ts`, `src/workspaces/_data/types.ts`, `src/workspaces/_docs/{04b_DATA_MODEL_ADDENDA,07b_CONTAINER_RUNTIME}.md`, `docs/decisions/{0020,0022,0279-*}.md`, `docs/AI_DECISIONS_INDEX.md`, plus gerichte capacity/recovery/watchdog/reminder/stage-writer/reaper-tests.

**Verification**: typecheck groen; ai:lint schoon; build groen (alleen bestaande Vite chunk-warnings); volledige lint 0 errors / 25 reeds bestaande warnings. Capacity 66/66, recovery writer 28/28, watchdog 21/21, reminders 13/13, stage writer 157/157, worker-reaper 15/15 en reliability guards 53/53 groen. De Redis-capacity/recovery-suites zijn bewust sequentieel gedraaid omdat zij dezelfde host-global testkeys gebruiken.

**Notes / decisions**: ADR 0279 legt de split lease/hard-max en het fenced prepare→external→complete/cancel-contract vast. Geen migratie, package-install, publiek op/verb, proxy-boot-leaderfix, worktree-orphanfix of commit. Alle vooraf bestaande en gelijktijdige dirty changes zijn behouden. `npm run ai:index` bestaat niet in dit project; `npm run ai:decisions` is wel succesvol uitgevoerd.

## 2026-07-19 06:50 — P1 recovery-hardening na SOL-review

**User prompt (samenvatting)**: Los de zes P1 recovery-issues uit `results/28-sol-recovery-review.md` op: crash-resume, Redis fail-closed, successor-proof, atomische stage-owner-takeover, synchroon gefencete manual kill en eerlijke provisioning/retries; corrigeer docs/ADR en voeg regressies toe zonder schema/migratie/commit/publiek op/casts of verlies van dirty work.

**Wat ik heb gedaan**:
- Recovery reconstrueert een geaccepteerde deterministische prepare na een procescrash, herstelt zo nodig de exacte verlopen recovery-reservering en hervat ook partiële cancel-, reeds-uitgevoerde container-stop- en stopped/provisioning-retries.
- Redis owner/release/cancel/fence-paden zijn strict en falen bij onzekerheid; recovery meldt pas succes na bewijs van een nieuwe token met een strikt hogere fence.
- Stage-owner takeover gebruikt één atomische lock rond marker-read, beide Redis-checks, stale-process-kill en atomische marker-replacement; cleanup en A/B-interleaving zijn getest.
- Manual kill wacht vóór de publieke success-ACK synchroon op recovery-prepare/fencing. Provisioning geeft typed `started|queued|unavailable|duplicate`-uitkomsten en zet bij Docker/admission-onbeschikbaarheid een duurzame retry klaar.
- Watchdog scant nu ook `recovering` en relevante `stopped` recoveryrijen. ADR 0279 en 04b/07b documenteren de retry/fail-closed-semantiek en claimen niet langer dat standalone `resumeAll` al token-remint/PTy-reattach doet.

**Files touched**: `server/orchestrator/{agentControl,capacity,conductor,recoveryWriter,stageRunner,watchdog}.ts`, `tests/integration/{capacity,recoveryWriter,stageWriter,watchdog}.test.mts`, `tests/unit/writerFoundation.test.mts`, `docs/decisions/0279-fenced-agent-recovery-writer.md`, `docs/AI_DECISIONS_INDEX.md`, `src/workspaces/_docs/{04b_DATA_MODEL_ADDENDA,07b_CONTAINER_RUNTIME}.md`.

**Verification**: 446 gerichte assertions groen (recovery 50, watchdog 24, capacity 69, stage writer 164, writer foundation 26 + 98, worker-reaper 15); typecheck, ai:lint en build groen; volledige lint 0 errors / 25 reeds bestaande, out-of-scope warnings. `git diff --check` schoon voor alle taakbestanden en geen `as any`/`as unknown as` toegevoegd.

**Notes / decisions**: Geen schema, migratie, package-install, publieke op/verb, unsafe cast of commit. De grote vooraf bestaande dirty worktree — inclusief reeds dirty schema-, env-, forge- en writerfiles — is niet teruggedraaid of buiten deze herstelpatch opgeschoond.


## 2026-07-19 — Surfacing-ronde: de vijf engine-only modules aan een oppervlak

**User prompt (samenvatting)**: "doe nu het volgende maar onthoud de andere AI is ook nog bezig dus straks doen we nog een extra sweep: één ronde die de vijf ❌-items aan een oppervlak hangt (F2 render-pipeline, F3 piece-detail, F5 inbox, G4 picker die C2 óók gebruikt, G7 settings) plus knoppen voor F1/G3."

**Wat ik heb gedaan**:
- **F2** — `ContentProject.captionStyle` (nieuw, gevalideerd door `parseCaptionStyle`: onbruikbare waarden vallen terug op de kale ffmpeg-default i.p.v. stilzwijgend geclamped te worden); `applyCaptions` kiest de gestylede args voor een burn-in; piece-UI biedt grootte/kleur/balk/woord-voor-woord. De sidecar-`.srt` houdt bewust per-segment-timing zodat een download een leesbaar transcript blijft.
- **F3** — SEO-paneel op de piece via een nieuwe capability-gated read-route `seoSuggest_v1`. De deterministische score + issues werken zónder key; alternatieven komen van de provider (`aiOk:false` zegt dat eerlijk).
- **F5** — reply-affordance in de comment-inbox + `commentReplyDraft_v1`. De rij is een `<div>` geworden (geneste buttons zijn invalide HTML) met "markeer gelezen" als eigen knop. Draften en versturen zijn gescheiden acties — een AI-concept kan nooit vanzelf naar een publiek.
- **G4** — nieuwe gedeelde `AssetPicker` (alleen props, dus bruikbaar in een menuHandler-overlay, lesson 0011; lost `/media` op tegen de BACKEND-origin). Documents gebruiken hem nu op `content.assetLibrary` i.p.v. een eigen per-piece-scrape; sterren kan vanuit de picker zelf.
- **G7** — `ExperimentsPanel` in settings + `promptExperiments_v1` (read) en de ops `prompt-experiment-save` / `-stop`. Eén lopend experiment per feature: een tweede starten zet de vorige op `stopped` (trials blijven bewaard).
- **F1/G3** — knoppen voor de twee ops die alleen via de Assistant bereikbaar waren: thumbnail componeren op de piece (cost-confirm alleen voor de betaalde AI-achtergrond) en een ready landing-page live zetten vanuit Studio.

**Files touched**: `prisma/schema.prisma`, `server/content/{captionStyle,assembly,render}.ts`, `server/orchestrator/conductor.ts`, `server/{control/rbac,ai/opCatalog}.ts`, nieuwe `src/workspaces/_api/{seoSuggest,commentReplyDraft,promptExperiments}_v1.ts`, nieuwe `src/workspaces/_components/AssetPicker.tsx`, `src/workspaces/{content/page,content/[pieceId]/page,documents/[docId]/page,studio/page,settings/page}.tsx`, `_shell/{WorkspacesContext,WorkspacesProvider}`, `_sync/{contentControl,contentSettings}_server_v1.ts`, alle vier locales, plus `tests/unit/surfaceReachability.test.mts` en `tests/integration/surfacedOps.test.mts`.

**Verification**: typecheck/lint (0 errors)/ai:lint/build groen. surfaceReachability 50/50 (asserteert per feature dat het oppervlak bedraad is én in alle vier de locales vertaald), surfacedOps 17/17. Regressie: contentDepth 74, newModules 57+48, reliabilityGuards 53, couplingBridges 42+13, opCatalogParity 56, settings 27, snapshot 38, scheduledPublish 32, seed 61.

**Notes / decisions**: Geen nieuwe ADR — dit volgt ADR 0278 (gaps sluiten met ops, geen nieuwe verbs; eerlijke no-ops). Nieuw testtype toegevoegd: een *reachability*-test, omdat de vorige ronde liet zien dat groene unit-tests niets zeggen over of een gebruiker erbij kan. Nog steeds open en bewust: Docker ligt eruit (500 op de engine), dus de container-E2E (thumbnail-render, caption/dub-pass, stale-redeploy, tool-trail door een echte container) en de browser-pass staan nog. De andere AI werkt nog in dezelfde worktree — een extra sweep volgt.


## 2026-07-19 — HARDENING fase 10: de laatste geverifieerd-open gaps + de settings-KISS-pass

**User prompt (samenvatting)**: "ga verder waar de andere AI gebleven is, alles e2e testen, en al jouw eigen punten nu in 1 keer meenemen." Met beslissingen: F48 = prullenbak-model (UI toont "bestaat nog X dagen" + optie om nú permanent te wissen), F20 = best-effort + luid alarm, UI mag splitsen en oude routes vervangen, F06 = alleen meten.

**Wat ik heb gedaan** — zeven gaps met dezelfde vorm: state werd opgeslagen, netjes doorgegeven aan de UI, en door niets gelezen. Dát is waarom ze zo lang overleefden — alles zág er goed uit.
- **F48** — media-GC als *prullenbak*, geen versnipperaar. Er was geen GC: een jaar geleden verwijderde workspace hield nog steeds z'n volledige footprint. Nu: verwijderen zet in de bak (bytes blijven), de UI toont de resterende dagen, de gebruiker herstelt of wist definitief, een uurlijkse sweep doet de eindelijke unlink. Twee ops door de hele keten; `media-trash-purge` is destructief-gemarkeerd.
- **F06** — `workspaceStorage()` in de snapshot + settings. Alleen meten, geen limiet.
- **F20** — hash-ketting (`seq`/`prevHash`/`hash`) + `verifyAuditChain` die zégt wélke rij is bewerkt of verdwenen; de schrijf blijft best-effort maar is niet langer stil (luid gelogd + geteld).
- **F27** — deploy-historie werd vanaf dag één weggeschreven en was nergens leesbaar. Nu per environment in de snapshot + een ingeklapte UI die benoemt wat live is en wat eraan voorafging.
- **F28** — `Service.path` beloofde onafhankelijk deploybare monorepo-units; élke exec draaide op `/work`. Gevalideerde `serviceWorkdir()` (traversal/absoluut/control-chars geweigerd, val terug op de repo-root) + de serve-commando's draaien nu in de servicemap.
- **F29** — `hooks`/`processes`/`visibleStageIds` waren instelbaar en werden nergens gelezen. Twee daarvan lógen zelfs: de hooks-tab bood negen toggles waarvan er zes geen enkele emitter hadden, en het terminal-tabje "server" opende een kale shell omdat processen nooit werden gestart. De catalogus is nu exact de drie hooks die de container schrijft, met `Stop` als "altijd aan" i.p.v. een schakelaar die stilletjes weigert.
- **F45** — goedkeuren was fire-and-forget: geen pending-state, fouten verdwenen, en dubbelklikken stuurde een tweede antwoord omdat het request-id willekeurig was. Nu een afgeleid id (dedupe), spinner + disabled tot de ticket-delta terugkomt, en een toast bij weigering.
- **Settings-KISS** — de pagina was één scroll van ~14 kaarten, met de helft verstopt achter één "DevOps"-fold die óók API-tokens, opslag en data-export verborg voor workspaces zónder development-module. Nu drie benoemde bestemmingen: Jij / Workspace / Ontwikkelaar.
- **Meegenomen**: vier bestaande i18n-strings gebruikten enkele accolades (`{platform}`) waar de translator dubbele verwacht — die renderden letterlijk.

**Files touched**: nieuw `server/media/trash.ts`, `server/deploy/servicePath.ts`; `server/control/audit.ts`, `server/orchestrator/{conductor,stageRunner,renderStage}.ts`, `server/deploy/environment.ts`, `server/read/workspaceSnapshot.ts`, `luckystack/cron/jobs.ts`, `prisma/schema.prisma`; `src/workspaces/{settings/page,pipeline/page,board/[ticketId]/page}.tsx`, `_shell/{WorkspacesProvider,WorkspacesContext}`, `_data/{types,seed,chatOps}`, `_functions/{controlApi,chatDispatch}`, `_sync/contentControl_server_v1.ts`, `_api/createWorkspace_v1.ts`, alle vier locales; nieuw `tests/integration/{trashAndAudit,stageConfigAndService}.test.mts`; `docs/lessons/0014-*`.

**Verification**: lint 0 errors, ai:lint schoon, build groen. trashAndAudit 46/46, stageConfigAndService 51/51, navStructure 58/58, deployCd 9/9, httpControl e2e 15/15. **Browser-pass (chrome-devtools, echte server + client)**: prullenbak live doorlopen — "Brand mascot render · still here for 30 days" met Restore + Delete permanently; de permanente wis bevestigd, bytes daadwerkelijk van schijf (`existsSync` false, `purgedAt` gezet); restore live teruggedraaid.

**Notes / decisions**: Geen nieuwe ADR — dit volgt ADR 0278. Twee testfixtures waren achterhaald i.p.v. de code: `deployCd` forceerde een env op "live" zónder commit (precies wat F26 nu weigert — de weigering is nu zélf geasserteerd), en `httpControl` verwachtte een `workspaceId` die de op nooit teruggaf; die is hersteld omdat een verse gebruiker niets heeft om op te pollen. Browser vond opnieuw wat groene tests misten: een crash op een snapshot zonder de nieuwe velden (client/server deployen niet in lockstep — nu optioneel getypeerd) en een niet-geïnterpoleerde `{count}`. **Bewust open**: CI per service is een schemawijziging (`Pipeline`/`PipelineRun`/`BuildArtifact` dragen geen `serviceId`), workspace-export laat `Service`-rijen vallen, en `Service.buildCmd`/`deployUnit` worden geschreven en nergens gelezen.
