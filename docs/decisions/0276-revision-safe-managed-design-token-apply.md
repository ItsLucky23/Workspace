---
id: 0276
title: Design tokens apply only through managed Tailwind blocks with expected-HEAD CAS
status: accepted
date: 2026-07-18
tags: [designer, git, css, tailwind, concurrency, b-23]
supersedes: []
---

# Design tokens apply only through managed Tailwind blocks with expected-HEAD CAS

## Context

The first `apply-design-tokens` implementation generated a new minimal `src/index.css` and committed it to a hardcoded `main` branch. That destroyed every authored rule/comment outside the generated tokens, ignored multi-project service roots and the configured target branch, and could overwrite a concurrent branch edit. A missing stylesheet, non-Tailwind project, unchanged result and git failure all collapsed into the same boolean failure.

## Decision

The existing control op remains the only product/control surface; the Conductor remains the only writer (B-23). Its implementation is now fail-closed and revision-safe:

1. Resolve the explicit target project and optional existing `Service.path`; root projects target `src/index.css`, monorepo services target `<service.path>/src/index.css`.
2. Resolve `Workspace.gitConfig.targetBranch`; never infer or hardcode `main`.
3. Read the stylesheet from one immutable branch SHA. Accept exactly one top-level Tailwind `@theme` color-token block and, when dark tokens exist, exactly one `.dark` color-token block. Patch only `--color-*` values/additions inside those blocks; preserve every other byte/comment. Missing, non-Tailwind or ambiguous blocks return typed semantic failures.
4. Commit against the read SHA. Re-check HEAD immediately before commit and push with `--force-with-lease=<expected SHA>` as the final compare-and-swap. A race returns `repo.headChanged`; it never overwrites the newer revision.
5. An unchanged patch is a successful no-op. Semantic/git failures flow through the existing failed control ACK, and the Designer's existing inline-feedback pattern reflects that real ACK rather than a timer.

## Rejected alternatives

- **Keep replacing the entire stylesheet with generated CSS.** Rejected because it destroys unrelated application CSS and comments.
- **Append a new token block when none is recognisable.** Rejected because duplicate/competing Tailwind tokens are ambiguous; fail-closed is safer.
- **Always target `main`.** Rejected because repositories use `master` or configured release branches, and `GitConfig.targetBranch` already owns that choice.
- **Commit the stale patch and rely on a normal push failure.** Rejected because an explicit expected-HEAD check avoids creating stale commits, while the push lease closes the remaining race window.
- **Add a new control verb/schema.** Rejected because the existing `apply-design-tokens` op, project/service contracts and current failure propagation are sufficient.

## Consequences

- Existing CSS, comments, imports, utility layers and custom rules survive token application byte-for-byte.
- Non-Tailwind and unmanaged stylesheets require a human/agent to establish a clear managed token block before one-tap apply is enabled.
- Concurrent edits are preserved; users receive a failed ACK and can retry from the new HEAD.
- Tests cover root/service paths, `main`, `master`, an arbitrary configured branch, unchanged applies, typed fail-closed cases and a stale-HEAD race.
