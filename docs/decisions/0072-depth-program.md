---
id: 0072
title: Depth program — real gen/render/publish + UI + platform hardening
status: accepted
date: 2026-07-07
tags: [strategy, depth, hardening, content, ui, expansion-depth]
supersedes: []
depends_on: [0049, 0050, 0004, 0015]
---

# Depth program (V2 — make it real)

## Context

A 3-agent depth audit (`src/workspaces/_docs/GAP_ANALYSIS.md`) found: the code/dev-orchestration side + the
contract spine are genuinely deep + real, but (a) the content platform is a hollow stub skeleton — no real
generation/render/publish code (the live `generate()` returns `notImplemented`) and NO user-facing UI at all
(unreachable; the `snapshot.content` is dead state), and (b) three cross-cutting depth risks: a tenant-isolation
leak surface (new + content models are outside `tenantDb`'s loud-fail guarantee), encryption that fails OPEN
(`secretBox` → `plain:` when `WORKSPACES_ENC_KEY` is unset), and ~0% real-infra test coverage. The user wants a
real, usable product, not a half-fake one.

## Decision

Run a `DEPTH_PROGRAM.md` `/goal` build (16 items, H→C→M→U→D) that:
1. **Hardens the platform first** — fold every `workspaceId` model into the tenant isolation guarantee (or lint
   it) so it can never leak; hard-force `WORKSPACES_ENC_KEY` (fail-closed).
2. **Fixes the code-side edges** — MR merge/rollback push-to-origin, container readiness probes (no fire-and-forget),
   retry/backoff + pagination, a real CI-YAML parser + PTY prompt-ready detection. (Docker-dependency is ACCEPTED —
   no fix.)
3. **Writes the REAL content code behind every `available()` gate** — real Fal/Replicate + ElevenLabs + Suno +
   Gemini generation, a real ffmpeg (Docker) render pipeline, real YouTube/TikTok OAuth + upload. The stub becomes
   PURELY the no-key fallback.
4. **Builds the content UI** — reachable (`content` WsView + nav + route), rich but clear for non-technical
   first-time users, with a style-picker, asset viewer, a provider-key + €-budget settings form, and a setup flow.
5. **Ships a `KEY_SETUP_GUIDE.md`** (how to get each key + where + cost warnings).

**Testing:** no keys this round → hardening/code-side get real integration tests; real gen/render/publish code is
tested with fixtures/structure (not live); UI by build; the stub-fallback keeps the pipeline e2e green. The
**complete LIVE e2e is DEFERRED — user-triggered once keys + budget are in place**, NOT in this run.

## Rejected alternatives

- **"Just add keys" to make content work.** Rejected — the audit found the live `generate()` is `notImplemented`;
  adding keys alone does nothing. The real code must be written (behind `available()`), keeping the stub as the
  no-key fallback. (Clarification: the earlier stubs were the agreed no-key TEST path; fake CODE was never asked
  for — only fake tests. This program writes the real code.)
- **Run the full live e2e now.** Rejected — half the media surface is still key-gated; a live e2e over a
  half-fake codebase proves nothing. It is the post-keys acceptance step.
- **Defer the tenant/crypto hardening.** Rejected — a leak or a `plain:` secret in production is unacceptable;
  hardening goes FIRST (fundament) before more surface is added.

## Consequences

- New `GAP_ANALYSIS.md` + `DEPTH_PROGRAM.md` (the `/goal` source of truth) + this ADR. The build produces: a
  hardened tenant/crypto layer, code-side edge fixes, real content gen/render/publish code, the content UI, and a
  key-setup guide. Follow-up (user-triggered): add keys + budget → run the live e2e acceptance.
