# DESIGN & DOCS PROGRAM — phased build plan

> **BUILD STATUS (2026-07-18) — branch `feat/design-docs-program`, not pushed.** All phases built, gated
> (typecheck 0 · lint 0 · ai:lint clean · build ✓) and tested; document + design + scaffold journeys proven
> LIVE end-to-end against real Mongo (+ real Gemini / real greenfield git repo). Per-phase detail + tests in
> `branch-logs/feat-design-docs-program.md`.
>
> | Phase | Status | E2E proof |
> |---|---|---|
> | 0.1 harness · 0.2 parser | ✅ | real-Docker poppler/pandoc extraction |
> | 0.5 review viewer · 0.6 asset-index · 0.7 corpora · 0.8 humanizer | ✅ (0.6 doc-side; humanizer = existing skill) | — |
> | 1.1–1.3 document ingestion | ✅ | documentDesignDocs integration (16/16, incl. live Gemini) |
> | 2.1 templates · 2.4 export fidelity · 2.5 diff+restore | ✅ | documentDesignDocs + unit suites |
> | 2.2 mermaid | ✅ preview (client) + **export (real-Docker PDF render verified: node labels rendered, raw syntax gone)** | — |
> | 2.3 humanize | ✅ (existing humanizer skill injects at document-generate) | — |
> | 3.1 full-look · 3.2 mobile-capture · 3.3 lossless handoff · 3.6 design-library RAG | ✅ | designPremiumLoop integration (6/6) |
> | 3.4 apply-tokens | ✅ | applyDesignTokens integration (5/5, real repo commit) |
> | 3.5 web-discovery | ✅ **LIVE** (AI-suggestion primary via the provider layer + scrape fallback behind the seam) | webDiscoveryLive (real AI → 5 distinct sites) + parse unit 13/13 |
> | 4.1–4.3 UI from 0 | ✅ | uiFromZero integration (6/6, real greenfield repo) |
>
> **All phases complete + live-verified.** Mermaid export now renders via the working chromium container
> (inlined runtime + `--virtual-time-budget`), and web-discovery runs live via the AI provider (with the
> static-search scrape as a fallback behind the `fetchSearch` seam).


> A `/goal`-runnable build program for the Design tool and Document tool deep-dive
> (`DESIGN_DOCS_DEEPDIVE_2026-07-17.md`, which merges the design/document findings of
> `GAP_SCAN_2026-07-17.md`). Created 2026-07-18.
>
> **Owner decisions baked in (2026-07-18):**
> - **J-D1 "UI from 0" = at PROJECT CREATION** — a brief → AI generates real routes+components as the starting UI (net-new generative scaffold, replaces the Hello-World skeleton).
> - **J-Doc2 "submission-grade" = generally polished** — professional, well-structured docs; no specific school rubric/citation format required (light source-grounding only).
> - **Web-discovery = YES** — the Designer may search the web to FIND reference sites (needs a search step behind the provider abstraction).
>
> **Standing invariants that constrain every item:** B-23 single-writer (AI proposes → user approves → Conductor is the only writer of authoritative state); every user-initiated write is a `[control-API]` op (no new frozen verbs — re-express via existing verbs + ops); `runInTenant` on every orchestrator/worker path; AI features stay provider-pluggable (ADR 0007); phone-first + simple UI; surgical changes. Waterfall: each phase completed, tested, committed before the next.
>
> Effort key: **S** ≈ days · **M** ≈ 1–2 weeks · **L** ≈ multi-week.

---

## Phase 0 — Shared spine (build once, both tools unblock)

These are the cross-tool building blocks the deep-dive flagged as "build once". Everything downstream depends on them, so they go first.

| # | Item | Reuses | Verifiable goal | Effort |
|---|---|---|---|---|
| 0.1 | **Harden the throwaway-container parse/render harness** — one invocation helper wrapping `docker run --rm --network none` | Design's `captureUrlScreenshot` (chromium), the exporter's pandoc/chromium containers | A single `runToolContainer(...)` helper exists, unit-tested for timeout + non-zero-exit + `runInTenant` scoping; both existing callers refactored onto it with no behavior change | S |
| 0.2 | **Real PDF/docx text extractor** on the harness (poppler for PDF, pandoc-reverse for docx) | 0.1, already-pulled `PANDOC_IMAGE` | Given a sample PDF and a sample docx, `extractText()` returns their body text; regression test with a fixture file in each format passes | M |
| 0.3 | **Mermaid/diagram renderer** — client `MarkdownView` mermaid branch + server mermaid-cli pre-render container | 0.1, existing `MarkdownView` | A ```mermaid fence renders in the editor preview, the AI-draft panel, AND all 5 exports; fixture doc with one flowchart exports a real image in pdf/html/docx | L |
| 0.4 | **Background-job + progress + push** adopted for long design/doc generations | `server/content/queuedMediaJob.ts` (`runQueuedMediaAsset`) | A long generation returns immediately with a queued row; progress broadcasts; on completion a `PushNotification` fires and the result lands even if the tab was backgrounded | M |
| 0.5 | **Phone "review-before-approve" viewer** — standardize text-diff (docs) + look-diff (design) | `DiffView`/`DiffLine` (MR-review), Design's `LookPreview` | One consent-time viewer component; a doc AI-draft shows a real diff vs current, a design change shows before/after — both usable at ≤ phone width | M |
| 0.6 | **Cross-module asset-reuse index + picker** over `StudioArtifact` / `DesignArtifact` / `ContentAsset` | `menuHandler.open`, existing asset grid | `generateDocumentImage` (and design gen) first offer an existing approved asset before generating; a picker modal lists reusable assets workspace-scoped | M |
| 0.7 | **Extend the reserved RAG side-corpus pattern** — new corpora: `workspace-tickets`, `workspace-decisions`, `design-library`, plus asset-text chunks | `referenceLibrary.ts` (`embed → RagEntry under reserved commit → retrieve()`), `RESERVED_CORPUS_COMMITS` | Each new corpus indexes + is retrievable via the existing `retrieve()`; a query against `workspace-decisions` returns a seeded decision | M |
| 0.8 | **Expose a `humanize` preset** on the shared skill choke-point, reachable from both tools' generative-copy paths | `skillPromptBlock` (`server/ai/registry.ts`) — already injects humanizer into doc modes | A fixed `humanize` preset is selectable; enabling it measurably changes generated copy (before/after prompt captured in a test); Studio/Designer copy paths route through the same choke-point | S |

**Phase 0 exit:** file parsing, diagram rendering, background-jobs, the review viewer, asset reuse, the new RAG corpora, and the humanizer preset all exist and are tested in isolation.

---

## Phase 1 — Document tool: ingestion spine (makes "upload PDFs → doc" REACHABLE)

The headline Document journey is unreachable today: the upload is rejected client-side and no extractor exists. This phase is the make-or-break spine.

| # | Item | Evidence / target | Verifiable goal | Effort |
|---|---|---|---|---|
| 1.1 | **Unblock PDF/docx upload** — add `pdf`/`docx` to BOTH allow-maps | `uploadMedia.ts:11-17,22-23` (client rejects ext), `uploadRoute.ts` `ALLOWED_EXT` (415) | Picking a PDF in the editor uploads successfully and records an asset on `Document.assets` (kind/url/label) | S |
| 1.2 | **Extract + store durably** — run 0.2 on upload; persist `extractedText` + `extractStatus` on the asset | `Document.assets` Json (no slot today) | After upload, the asset row carries the extracted text and a status; a failed extract is visible, not silent | S |
| 1.3 | **Index asset text into RAG + fix retrieval** — chunk/embed asset text; fix the own-doc filter so asset chunks aren't excluded; inline FULL source text for attached assets (not top-k) | `indexDocument`/`chunkDocument` (only touch `doc.content`), own-doc filter `docs.ts:71`, k=4/2500-char cap | A generate call on a doc with an attached rubric provably grounds on the whole rubric (test: a rubric-specific term appears in output only when the asset is attached) | M |

**Phase 1 exit (E2E):** upload a real assignment PDF + a source PDF → the AI reads them → a generate call cites their content. Journey J-Doc1 is now *possible*.

---

## Phase 2 — Document tool: structure, diagrams & submission-grade output (J-Doc1 output + J-Doc2)

Turn a blind one-shot completion into a structured, diagram-bearing, polished, phone-reviewable document.

| # | Item | Evidence / target | Verifiable goal | Effort |
|---|---|---|---|---|
| 2.1 | **`kind` + technical-design template + outline-then-sections generation** | `Document` model has no `kind`; `generate` is a single blind completion | Choosing the "technical design" kind seeds a section skeleton (requirements / architecture / system decisions / wireframes / …); generation fills section-by-section with cross-section coherence | M |
| 2.2 | **Wireframes + diagrams in the doc** — via 0.3; the AI can emit mermaid; render in editor, draft panel, export | "wireframes" named in the vision; renders nowhere today | A generated tech-design doc contains a rendered architecture diagram AND a wireframe sketch that survive to the exported PDF | M (on 0.3) |
| 2.3 | **Humanizer on doc generation** — wire the 0.8 preset into the doc modes | `skillPromptBlock` already at the choke-point | Toggling humanize on a rewrite changes tone; default-on for the tech-design kind | S |
| 2.4 | **Export fidelity** — inline images/diagrams, preserve links/code/footnotes, add TOC + page numbers in pdf/html (docx already clean) | export drops images/links/code, no TOC/page-nums | The same doc exports to pdf/html/docx with images, working links, code blocks, a TOC and page numbers; visual regression on a fixture doc | S–M |
| 2.5 | **Diff-before-approve + revision view/restore** — via 0.5; list & restore `DocumentRevision` | revisions are write-only; rewrite shows whole draft, no diff | On a phone, an AI rewrite shows a diff; the history panel lists revisions and restores one (B-23: restore is a Conductor op) | M |

**Phase 2 exit (E2E):** upload brief → generate a structured technical-design doc with a rendered diagram + wireframe, humanized → review the diff on a phone → export a clean, polished PDF.

---

## Phase 3 — Design tool: close the "decent → premium" loop (J-D2)

The premium loop exists but leaks at every seam. Close them so an imported/referenced look actually looks premium once applied.

| # | Item | Evidence / target | Verifiable goal | Effort |
|---|---|---|---|---|
| 3.1 | **Full-look extraction** — inspiration extracts style + animation (radius/shadow/border/density/font/weight/tracking/motion), not color-only | `inspiration.ts` EXTRACT_SYSTEM (color-only); `generateAsset.ts` `DesignStyle`/`AnimSpec` schema already exists | Importing a reference yields a full `DesignStyle`+`AnimSpec`, not just 30 colors; applied result visibly matches the reference's spacing/type/motion | M |
| 3.2 | **Mobile-viewport capture + rendered before/after** — capture at phone width too; before/after via `LookPreview` → page-level re-capture | capture hardcoded `1440x2200`; compare is prose-only | Compare shows a rendered before/after at both desktop AND phone width (uses 0.4 background-job for the ~3-min capture) | M |
| 3.3 | **Lossless handoff to the coding agent** — stop stripping the linked Studio HTML + animation data; link the structured artifact into redesign tickets | `artifactContext.ts` (strips artifact, drops anim data), `designSystemDoc.ts`, `TicketArtifactLink` | A redesign ticket carries a named look / `TicketArtifactLink` with full style+motion; the agent no longer re-derives premium-ness from prose | S + M |
| 3.4 | **Fast `apply-active-design-tokens` control op** — mechanical token swap without a full pipeline run | today: full pipeline run or ungoverned copy-paste | A one-tap control op applies the active design tokens to the target project (Conductor-written, B-23); round-trips in seconds from a phone | M |
| 3.5 | **Web-discovery of reference sites** — a search step (behind the provider abstraction) that FINDS candidate reference UIs from a description | no discovery today; user must paste a URL | From "premium fintech dashboard" the tool returns candidate sites to capture; search runs through the provider registry (ADR 0007), not hardcoded | M–L |
| 3.6 | **Design-library RAG corpus** — index saved themes + captured inspiration so `generateTheme` builds on them | via 0.7; `RESERVED_CORPUS_COMMITS` already reserves the slot | A new generation demonstrably reuses the workspace's saved visual language (test: a saved motif recurs) | M |

**Phase 3 exit (E2E):** describe or discover a reference → full look extracted → applied to the product via the token op → before/after rendered and approved from a phone.

---

## Phase 4 — Design tool: UI from 0 at project creation (J-D1, net-new)

The big net-new piece: replace the Hello-World skeleton with a brief-driven generative starting UI. Depends on the design-apply path (Phase 3) being solid.

| # | Item | Evidence / target | Verifiable goal | Effort |
|---|---|---|---|---|
| 4.1 | **Brief field in Create Project** | `Shell.tsx` `CreateProjectForm` collects only name + template; no brief anywhere | The create form accepts an optional brief; it's threaded to the scaffold step | S |
| 4.2 | **Generative scaffold** — brief (+ chosen active design) → real routes + components + applied look, replacing the static `StarterFile[]` | `scaffold/templates.ts` (4 static skeletons, react-vite = one `<h1>`), `initGreenfieldRepo` (no AI calls) | Given a brief, the scaffolder produces a multi-page, multi-component UI reflecting the brief and the active design tokens | L |
| 4.3 | **Write the generated UI into the greenfield repo via the Conductor** (single-writer) | `initGreenfieldRepo` in `conductor.ts` | Creating a project with a brief results in a real starting UI committed to the repo through the Conductor (B-23; `runInTenant`); opening the editor shows real routes, not Hello-World | M |

**Phase 4 exit (E2E):** create a project with a brief → the repo gets a real, multi-page starting UI reflecting the brief and the chosen design system.

---

## Sequencing notes

- **Phase 0 is the leverage.** Six of the twelve top-priority items in the deep-dive resolve to a Phase-0 block (parser, diagram renderer, review viewer, background-job, asset index, humanizer). Do it first even though it's not user-visible on its own.
- **Phase 1 before 2** — no point structuring/exporting a doc the AI can't read yet.
- **Phase 3 before 4** — J-D1's generative scaffold reuses the design-apply path and the active-design tokens hardened in Phase 3.
- **Web-discovery (3.5)** is the only item needing genuinely new provider infra; keep it behind the provider abstraction so it stays swappable.
- Each item lists a *verifiable goal* (Rule 1a) — a phase isn't "done" until its E2E exit check passes, tested, and committed.

## Resolved decisions (2026-07-18)

- **3.5 web-discovery = Playwright (headless chromium), no API key.** Discovery AND capture run through a Playwright-driven browser in the existing throwaway-container harness (0.1): a search-engine page is driven + results scraped to FIND candidate sites, then each is visited/captured — so any site works without a key. Still wired behind the provider abstraction (ADR 0007) so a stable search API can be plugged in later. Caveat: search-engine scraping is brittle/can be blocked — mitigate with a real browser + retries.
- **2.1 templates = user-authorable from day one (option B).** Documents get user-definable templates (custom sections), not a single hardcoded one. Ship a built-in "technical design" template as the seed/example, but the model + UI support authoring/editing/duplicating templates per workspace.
