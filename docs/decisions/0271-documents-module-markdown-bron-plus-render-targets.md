---
status: accepted
date: 2026-07-17
tags: [documents, architecture, documents-and-skills]
---

# 0271 — Documents als eigen module: markdown-bron + render-targets, AI schrijft alleen drafts

## Context

De gebruiker wil een volwaardige Documents-module (specs, plannen, briefings, sheets) waarin de AI alle bestandstypen kan maken en bewerken (Word/PDF/Excel/images), phone-first, met export. De bestaande content-pipeline is video/post-gericht; Studio-artifacts zijn campagne-gebonden. Er was geen generieke document-laag.

## Decision

Eén `Document`-model met **markdown als enige bron van waarheid** (`content`); Word/PDF/Excel/HTML zijn **render-targets** in de EXP-fase (pandoc/chromium-container), geen aparte opslagformaten — markdown-tabellen zijn de bron voor de xlsx-export. AI-schrijfacties (generate/rewrite/summarize/extend, feature `document-generate`, default Gemini) landen ALTIJD in `aiDraft`; de op `document-apply-draft` is de consent die `content` schrijft (B-23), met een `DocumentRevision`-snapshot van de vorige versie (gebonden op 20). Documenten indexeren in de gedeelde workspace-RAG onder het reserved-corpus-commit `workspace-documents` (`doc/<id>/<chunk>`), zodat chat én document-runs erop gronden; document-runs gronden omgekeerd op product-knowledge + de andere documenten. Eigen nav-module `documents` (vierde WorkspaceModule) met eigen routes (`documents/` + `documents/[docId]`). Afbeeldingen via de bestaande media-pipeline (budget-guard + spend + honest stub); uploads via `/media/upload` als document-assets.

## Rejected alternatives

- **'document' als ContentProject-format**: erft de video-gerichte stage-machinerie en publish-keten die documenten niet nodig hebben; een eigen model is kleiner én duidelijker.
- **Per-formaat opslag (docx als bron)**: binaire bronnen maken AI-edits, diffs, RAG-indexering en versies allemaal zwaarder; markdown → render is de omgekeerde, goedkope richting.
- **AI schrijft direct in `content` (zonder draft)**: sneller, maar breekt B-23 (de Conductor als enige schrijver ná consent) en maakt AI-fouten destructief; de draft+apply-flow kost één klik en houdt de gebruiker eigenaar.
- **Suggestion-flow (WorkspaceSuggestion) i.p.v. draft-op-document**: generieker, maar de draft hoort bij het document (zichtbaar in de editor, één per document) — een losse suggestielijst verstopt hem.

## Consequences

- Elke content-schrijvende weg loopt door dezelfde vier ops; nieuwe AI-acties = nieuwe mode, geen nieuw schrijfpad.
- `workspace-documents` staat in `RESERVED_CORPUS_COMMITS` — de code-retrieve-heuristiek ("nieuwste commit") kan er nooit door gekaapt worden.
- Sheets zijn v1 markdown-tabellen (geen aparte grid-editor); de xlsx-export leest ze. Een echte grid-editor kan later zonder modelwijziging.
