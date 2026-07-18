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
