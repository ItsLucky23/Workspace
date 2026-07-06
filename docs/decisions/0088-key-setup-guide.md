---
id: 0088
title: KEY_SETUP_GUIDE + Depth Program complete
status: accepted
date: 2026-07-06
tags: [docs, content, keys, depth-program]
supersedes: []
depends_on: [0072, 0079, 0080, 0083, 0086]
---

# D1 — the plain-language key-setup guide (+ program close-out)

## Context

The Depth Program wrote the real gen/render/publish code behind each `available()` gate. Turning it on
needs real keys + budget — and that step must be safe + clear for a non-technical user, with the money
risk spelled out.

## Decision

`docs/KEY_SETUP_GUIDE.md` — per provider (Fal, ElevenLabs, Suno, Gemini, YouTube, TikTok): where to get
the key, where to put it (the encrypted in-app settings form OR `.env.local`), the env var names, and a
**cost warning** (video/3D are the expensive ones; set a €-cap first). It leads with the two load-bearing
rules: `WORKSPACES_ENC_KEY` is a boot requirement (H2), and set a media €-budget cap before adding any key.
Linked from the U3 settings setup flow. ffmpeg render (Docker, no key) + the safe dummy-mode default are
documented so the reader understands what already works without keys.

## Consequences

- The guide ships in `docs/` (travels with the repo). `DEPTH_PROGRAM.md` is marked COMPLETE. The content
  platform is now REACHABLE + USABLE (nav → create → generate(stub) → assemble → download → publish behind
  the gate) with a real live-code path behind every `available()` gate; **adding keys + budget makes it
  produce + post real content.** The complete LIVE e2e is the user-triggered post-keys acceptance step
  (boot with keys → a real container + a real AI/media turn → a real render → a real sandbox post).
