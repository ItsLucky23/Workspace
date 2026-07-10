---
status: accepted
date: 2026-07-10
tags: [ai, media, vision, provider]
---

# 0268 — Multimodal image critique (F5): the AI sees the actual pixels

## Context

A headline media ask was "upload a photo and tell the AI what should change about it." The only existing
"analyze" path (`analyzeReferenceVideo`) handed the media URL to the model as a TEXT string — the model
never saw the pixels. No provider in the abstraction accepted image input.

## Decision

- **`AiCompletionRequest.imageUrls?: string[]`** — an optional multimodal input. The Gemini provider
  resolves each URL to bytes (local `/media/<file>` off the media store, or http fetch), base64-encodes
  it, and sends it as an `inline_data` part alongside the text prompt. Text-only providers (Claude CLI)
  ignore the field. Failed/oversized (>8MB) images are dropped so the turn still runs text-only.
- **New `image-critique` AiFeature**, defaulted to `gemini-api` (vision-capable) in the assignment map;
  degrades to an honest stub without a key (never a fake result).
- **`critiqueImage` service** + **`content-critique-image` control-op** (content family, RBAC
  `workTickets`): loads a ready IMAGE asset, runs the critique, stores the result on the asset's
  `metadata.critique` (+ `critiqueStub` honesty flag), and broadcasts a delta. **Advisory only** — it
  never edits the asset; the prompt maps each suggestion to an existing edit op (inpaint/adjust/crop/
  regenerate) the user then runs. Reachable via the UI and (X1) proposable by the assistant.
- **Lazy env read (bug fix):** the Gemini provider captured `GEMINI_API_KEY` at MODULE LOAD, but the key
  is a `@luckystack/secret-manager` pointer that resolves into `process.env` only AFTER boot — freezing
  the unresolved pointer caused a latent "key present but unavailable/401". Now read at call time.

## Rejected alternatives

- **A dedicated vision provider/SDK** — the existing Gemini provider already speaks `generateContent`;
  adding an `inline_data` part reuses it with no new dependency.
- **Sending the image URL as text** (the old path) — the model can't see pixels; this is exactly the gap.
- **Auto-applying the critique's edits** — violates B-23/advisory intent; the user runs the edit op.

## Consequences

- "What should change about this photo?" now works: proven live — Gemini returned "Red" for a red test
  image (real pixel understanding), and the op stores the critique honestly (real vs stub flagged).
- Any future feature can attach images to a turn via `imageUrls` (e.g. a UI-review vision pass).
- The lazy-env fix also hardens every other Gemini-backed feature against the secret-resolution race.
