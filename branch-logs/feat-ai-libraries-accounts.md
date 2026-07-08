# Branch log — feat/ai-libraries-accounts

> AI_LIBRARIES_ACCOUNTS_PROGRAM: zelf-bewuste AIs · referentie-galerijen · account-management. Geïsoleerde worktree, waterfall Q→L→M→A. ADRs vanaf 0250 (parallel met ADOPTION dat 0162+ gebruikt).

## 2026-07-08 — Q1: product self-knowledge corpus (generator)
De in-app AIs weten nu WAT het product kan. Bron: een hand-curated capability-Q&A (`docs/product-knowledge/capabilities.md` — "kan ik video's bewerken? → ja, via de media-module, stappen…") + alle ADRs. Generator `scripts/generateProductKnowledge.mjs` (`npm run ai:product-knowledge`, in de pre-commit-hook) compileert → `docs/AI_PRODUCT_KNOWLEDGE.md` (digest) + `.json` (`{hash,chunks:[{id,kind,title,text}]}` = embedding-input). 177 chunks (17 capabilities + 160 ADRs), content-hash voor idempotente boot-ensure (Q2). Deterministisch (geen timestamps). ADR 0250. gates: lint0·ai:lint clean·build groen.
**Verify:** `tests/unit/productKnowledge.test.mts` 9/9 — shard-shape, de video-edit-capability aanwezig + wijst naar media/timeline-editor, elke ADR gechunkt (adr-NNNN), determinisme (stabiele hash over 2 runs).
**Files:** `docs/product-knowledge/capabilities.md` (nw), `scripts/generateProductKnowledge.mjs` (nw), `package.json` (ai:product-knowledge), `.githooks/pre-commit` (regen+add), `tests/unit/productKnowledge.test.mts` (nw), `docs/decisions/0250-product-self-knowledge-corpus.md` (nw).
