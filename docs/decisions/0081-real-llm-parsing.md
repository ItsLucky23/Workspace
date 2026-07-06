---
id: 0081
title: Real structured LLM parsing for script + reference-video blueprint
status: accepted
date: 2026-07-06
tags: [content, llm, parsing, depth-program]
supersedes: []
depends_on: [0072, 0049]
---

# M3 — parse a real structured response, not a canned/trivial one

## Context

`GAP_ANALYSIS.md` content #6: the "real" LLM lane was half-stub — `parseLiveScript` was a trivial
one-beat-per-line split, and `analyzeReferenceVideo` ALWAYS used the canned stub blueprint even when the
model responded. So adding a key wouldn't have produced structured beats.

## Decision

- New `server/content/jsonParse.ts`: `extractJson` robustly pulls the first JSON object out of an LLM
  response (```json fences, prose-wrapped, string-aware brace matching) — never throws (→ null on miss).
  `coerceBeats` maps a model's `beats` array into `{text, visualPrompt}[]`, tolerant of missing fields.
- `parseLiveScript` (script.ts) now prefers the requested JSON (`{body, beats:[…]}`) and falls back to
  the line-based parse when the model returned prose. The prompt appends a `SCRIPT_FORMAT` directive.
- `parseBlueprint` (referenceVideo.ts) parses a real `{pacing, styleHint, beats}` blueprint; the caller
  uses it when present and falls back to the stub only when there's no key OR nothing usable came back.
  The prompt appends a `BLUEPRINT_FORMAT` directive.
- Both parsers are exported + pure → unit-tested.

## Rejected alternatives

- **Free-form prose parsing (heuristics on sentences).** Rejected — brittle; asking the model for JSON +
  a tolerant extractor is far more reliable, with the line-based split kept only as a graceful fallback.

## Consequences

- `jsonParse.ts` added; `script.ts`/`referenceVideo.ts` parse real structured output behind the same
  `res.ok` gate (stub still the no-key path). `tests/unit/contentParse.test.mts` (17/17) covers JSON
  extraction (fenced/inline/prose/invalid), beat coercion, script JSON-vs-line-fallback, and blueprint
  parse/null. `contentScript` 8/8 + `referenceVideo` 6/6 (stub path) unaffected. Live parsing = deferred
  post-keys e2e.
