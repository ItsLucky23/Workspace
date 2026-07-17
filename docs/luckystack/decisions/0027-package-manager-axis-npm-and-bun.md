---
name: package-manager-axis-npm-and-bun
title: Offer npm + bun as the scaffold's package managers, and generate Prisma via npx even on bun
status: accepted
date: 2026-07-15
deciders: [ItsLucky23]
tags: [cli, scaffold, packaging, bun, prisma]
supersedes: []
relates: [0020, 0021, 0025]
---

## Context

The scaffold wizard hardcoded npm: `runNpmInstall` resolved `npm` and `runPrismaGenerate`
resolved `npx`, with no package-manager dimension anywhere in the flag→preset→choice
pipeline. Meanwhile `@luckystack/cli`'s `detectPackageManager` already recognised bun (via a
`packageManager: "bun@…"` field or a `bun.lockb`), so the manager half of the story worked
while the scaffold half could not produce a project for it to detect.

A feasibility investigation established that the runtime is largely Bun-clean: no
`node:cluster`, no `worker_threads`, no native addons in any package, `AsyncLocalStorage` the
only static `node:*` runtime dependency, everything built with tsup. The blockers were
concentrated in the scaffold's install-invocation layer and per-package metadata.

Two forces shaped the scope:

1. **A wizard option is a support claim.** Every offered package manager is a matrix cell
   somebody must test. pnpm's strict `node_modules` layout in particular would exercise
   peer-dependency assumptions npm's flat hoisting hides — real information, but a real
   support burden, and there is no demand signal for it.
2. **Drift between what is claimed and what is true is this repo's most expensive recurring
   defect class** (assetParity drift, shadow-API drift, CHANGELOG gaps, the stale LoginForm
   asset). An untested "supported" package manager is that same bug wearing a new hat.

## Decision

**Offer npm + bun only.** `--pm=<npm|bun>` threads through the existing flag→preset→choice
pipeline exactly as the `cron` opt-in does; npm stays the default so an unattended
`--no-prompt` run keeps producing byte-identical projects. `packageManager: "bun@<floor>"` is
written for bun only — npm writes no field, because adding one would introduce a corepack pin
the scaffold never made and change every existing project. The recorded choice round-trips
through the manifest and `luckystack update`.

`detectPackageManager` keeps recognising pnpm/yarn for a hand-switched consumer; only the
wizard's offer is narrowed.

**Prisma is generated via `npx`, never `bunx`, even in a bun project.** This is deliberate and
is the non-obvious half of this ADR.

**Both runtimes always work** — there is no runtime choice, no manifest dimension, and no
switching machinery. A project runs on Node and on Bun.

## Rejected alternatives

**All four package managers (npm/bun/pnpm/yarn) as first-class wizard options.** Initially
requested, then narrowed once the matrix cost was made explicit: combined with the
"both runtimes always work" decision it is 4 PMs × 2 runtimes = 8 cells, and with the ORM
dimension 32. The four remaining cells (npm/bun × node/bun) each test a *distinct mechanism*;
a yarn cell would only test a resolution variant nobody asked for. The flag surface costs the
same either way — the difference is purely what gets promised.

**`bunx --bun prisma generate`.** The only variant that genuinely swaps the runtime, and
rejected on hard evidence: an open Windows infinite-hang (oven-sh/bun#14868, Oct 2024) where
it prints the schema line and then hangs forever with no error and no generated client.
A silent hang on a first-run scaffold is the worst failure mode available to us, and Windows
is a first-class target. Prisma's own Bun guide scopes `--bun` to `prisma init`, never
`generate`.

**Plain `bunx prisma generate`.** Buys nothing: the Prisma CLI's `#!/usr/bin/env node`
shebang defers to Node regardless, so it is `npx` with extra indirection while still carrying
the hang reports.

**A runtime axis (choose Node or Bun at scaffold time, recorded + switchable).** Rejected in
favour of "both always work": no choice, no manifest dimension, no switching machinery, and a
consumer can try Bun with zero commitment. Note this is a *stronger* claim, not a weaker one —
every project carries the promise, so the verification bar goes up rather than down.

**Deriving `BUN_VERSION_FLOOR` from the build machine's `bun --version`.** The ADR-0021
manifest hashes `package.json`; a machine-dependent value would make every `luckystack update`
re-render read as user-modified and spam sidecars. The floor is a fixed constant.

## Consequences

- A bun-scaffolded project still needs npm/Node available for Prisma *generation*. The
  generated client runs on Bun fine — this governs the generator only. This mirrors the
  existing precedent from lesson 0004 (the `@mikro-orm/cli` figlet crash was solved the same
  way: run the tooling through a known-good path rather than the fashionable one).
- `luckystack add/remove/manage` follow automatically: the scaffolder writes the exact
  `packageManager` field `detectPackageManager` already reads, so a bun project stays on bun
  for every subsequent install with no extra wiring.
- **`choicesToFlags` must replay `--pm`, and this was missed on the first pass** — a bun
  project would have re-rendered as npm and sidecar-spammed on every update. The existing
  forward flag-parity test could never catch it, because an *absent* flag is trivially a valid
  one. A reverse-parity test now asserts the replay-probe map is exhaustive against
  `DEFAULT_CHOICES`, so a future wizard choice cannot ship without its replay.
- `bun run <script>` on a bin-based script does **not** yield a Bun runtime — verified
  empirically on Windows (bun 1.3.14): npm's generated `.cmd` shim hardcodes a `node` call, so
  it runs under Node and looks completely green. Only `bun --bun run <script>` forces Bun. Any
  claim that "both runtimes work" must be tested with that in mind, not assumed from a green
  `bun run`.
- pnpm/yarn remain reachable for a consumer who switches by hand, but are explicitly untested
  and unclaimed.
