---
title: S1 — any-stack via a multi-base catalog sharing one agent base (relaxed Dockerfile-trust guard)
status: accepted
date: 2026-07-08
tags: [container, any-stack, base-image, dockerfile, adoption, schema]
---

## Context

Every project image was forced to `FROM workspaces/base` (Node), enforced by THREE triplicated `extendsBase`
guards; Python/Go/Rust were only reachable as an Admin-gated, linked-repo-only AI-generated Dockerfile that
`apt`-layered a toolchain onto the full Node base, and the one non-Node template couldn't actually run. The user
wants to build on ANY stack. The audit called this the #3 dev blocker.

## Decision

- **One agent base, N stack variants.** The coding agent (`claude` CLI), `node-pty`, openvscode-server, the
  pty-agent, and the DB/git tooling are Node-based and MUST run in EVERY container — so a "clean per-stack image"
  is impossible; instead each stack base (`docker/base-<stack>.Dockerfile`) does `FROM workspaces/base` and adds
  ONLY that stack's toolchain (python/go/rust/jdk). The user's app builds/runs in the stack; the agent runs on the
  inherited Node layer.
- **A first-class catalog** (`server/container/baseImages.ts`): `BASE_STACKS = node|python|go|rust|java`,
  `baseImageFor(stack)` (node = the agent base, others = `workspaces/base-<stack>`, env-overridable),
  `resolveProjectBaseImage(project)` = the built L2 `baseImageRef` else the stack base. New `Project.stack` field
  (null = node) selects it; the launch callers (stageRunner, preview, ref-preview) resolve through it.
- **The Dockerfile-trust guard is relaxed to the FAMILY** (`extendsAllowedBase`): the first `FROM` must be a
  `workspaces/base*` image (agent base or any stack variant), not a single fixed image — still a supply-chain gate
  (an arbitrary `FROM ubuntu`/`FROM python:3.12` is rejected). The three formerly-triplicated `extendsBase` copies
  now delegate to this one shared guard (the cleanup the code itself had flagged).

## Rejected alternatives

- **Fully independent per-stack images (no shared Node base).** Rejected: the agent + editor are Node — every
  image would re-install the whole Node agent machinery anyway, so `FROM workspaces/base` + a toolchain layer is
  the LEANEST correct shape, not a compromise.
- **Keep the AI-generated-Dockerfile-only path.** Rejected: ad-hoc, Admin-gated, linked-repo-only, and unproven;
  a pre-built catalog + a `stack` field is first-class and testable.
- **A wide-open guard (any FROM).** Rejected: an arbitrary base is a supply-chain surface; the family allowlist
  keeps the gate.

## Consequences

- The catalog + guard + resolver are pure + unit-tested (`baseImages.test.mts`, 20 assertions). BUILDING the
  `base-<stack>` images + proving a Python/Go/Rust app runs is Docker-dependent (user-triggered) — the Dockerfiles
  are the committed spec.
- `dockerfileGen`'s prompt still tells the AI `FROM workspaces/base` (node); a stack-aware generated Dockerfile
  (FROM the stack base) is a small follow-up. Preview default port/dev-command per stack = S3.
- Un-blocks S2 (stack starter templates) + K (services): a stack project is now a first-class, launchable thing.
