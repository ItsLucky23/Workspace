---
id: 0284
title: Blocked features explain themselves — a snapshot `readiness` block + resolved `myPerms` drive a permission-aware "what's missing / how to fix it" notice
status: accepted
date: 2026-07-20
tags: [ux, onboarding, snapshot, rbac, readiness]
supersedes: []
---

# 0284 — setup readiness + permission-aware fix routing

## Context

Across the product many features silently do nothing until a precondition is met, and the failure was
indistinguishable from "empty":

- No git repo linked → the entire **Develop** module is dead (Code, containers, terminals, the AI coding
  agent all clone the repo), but the pages just showed a blank/ambiguous empty state.
- No media-provider key → generation **"succeeds" with placeholder `stub://` assets** (the worst gate — it
  looks like it worked).
- No AI provider (no Claude CLI on the host AND no Gemini key) → every AI feature returns nothing.
- Docker down, no connected publish account, no encryption key → the same class of silent dead-end.

A four-way scan found the signals to detect these were scattered (some client-derivable like `repo.linked`,
some server-only like Docker availability, some not surfaced at all like which provider keys exist) and there
was **no client capability helper**: the only gate was a coarse `activeWorkspace.role !== 'member'`, which
can't answer "may THIS user link a repo?" for a custom role, and `navigate()` could only land on a settings
page's *default* tab, not the tab that holds the fix.

## Decision

**1. The snapshot ships a `readiness` block + the caller's resolved `myPerms` + raw `myRoleKey`.**
`readiness` is the set of "is this actually set up?" booleans (repo linked, AI text, per-media-provider key,
publishing connected, docker, push, secret-manager). Host-level probes (Docker via `docker info`, the Claude
CLI probe) are **cached with a 30s TTL** so the per-snapshot hot-path never shells out; config-presence
checks (stored `__provider_key_<id>` EnvVar KEYS — presence only, never decrypted — plus env fallbacks and
VAPID/enc-key env) are trivial. `myPerms` resolves the caller's **raw** role key against `WorkspaceRole.perms`
(mirroring the server `hasCapability`), so a custom role resolves correctly — the flattened `Workspace.role`
collapses those to `member`.

**2. One shared `SetupNotice` component renders WHAT / WHY / HOW.** A blocked feature renders it instead of a
bare `EmptyState`. The action is **permission-aware**: when `can(cap)` the CTA is a button that deep-links to
the exact settings tab (`focusSetup({view, tab})`, consumed by the settings pages); when the user may not, it
degrades to "ask someone with `<capability>`" — never a dead button. An infra-only gate (Docker/host env)
omits the fix and shows an explanation + the env hint.

**3. The client CAP indices are a committed mirror of the server `CAP` enum**, kept in lockstep by a test, so
the wrong `myPerms[cap]` can never be read.

## Rejected alternatives

- **Keep the coarse `role !== 'member'` and existing client signals (no snapshot change).** The lighter option
  the user was offered. Rejected: it can't detect the silent gates (media stub, Docker, AI provider) at all,
  can't route a fix to the right tab, and mis-gates custom roles. The user chose the full foundation.
- **Replicate `OP_CAPABILITY` on the client instead of shipping `myPerms`.** Duplicates the RBAC matrix in two
  places and still loses custom-role perms (the client never sees the raw role key). Shipping the resolved
  booleans keeps the server the single source of truth.
- **Live host probes in the snapshot.** `dockerAvailable()` shells out; running it per snapshot build (which
  happens on every delta) is a real cost. Cached with a TTL instead.
- **Make media generation FAIL LOUDLY when no key (change the backend).** Out of scope: the ask was UI
  feedback, not a behaviour change, and the stub path is deliberately useful for keyless local testing. The
  notice makes the stub visible without removing it.

## Consequences

- The client `Snap` interface + `EMPTY_SNAP` gained three fields (hand-maintained mirror of the server
  snapshot); the generated api-types refresh carries them to `res.result`.
- Adding a new gate is now: compute the boolean in `buildReadiness`, add copy under `workspaces.setup.*` (×4
  locales), and render a `SetupNotice` at the blocked state — no new component.
- Wired this pass: repo (Code, Terminals), Docker (Terminals), media stub (content piece, Studio, Designer),
  AI provider (the Workspace-AI panel, Studio), publishing (content piece). Sources was deliberately left as-is
  (it works via upload without a repo; only the repo-scan action is hidden).
- `readiness` reports presence only — no key or secret value ever enters the snapshot.
