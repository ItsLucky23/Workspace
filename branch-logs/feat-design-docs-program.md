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
