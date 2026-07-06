---
id: 0078
title: Real CI YAML parse + PTY prompt-ready detection
status: accepted
date: 2026-07-06
tags: [ci, yaml, pty, orchestrator, depth-program]
supersedes: []
depends_on: [0072, 0039]
---

# C4 — honour a real `.gitlab-ci.yml`; detect the PTY prompt instead of guessing

## Context

`GAP_ANALYSIS.md` code-side #5: (a) the CI parser was a fixed-indent mini-subset (2-space job names,
4-space fields, inline arrays only) — a real `.gitlab-ci.yml` (top-level jobs, `stages:`/`script:` as
block sequences) was largely dropped; (b) the interactive `claude` turn used hardcoded
`wait(7000)`/`wait(3000)` before confirming folder-trust + sending the kickoff — fragile on a slow
boot, wasteful on a fast one.

## Decision

- **Real YAML:** a dep-free recursive YAML-subset parser (`parseYamlSubset`) handles block mappings at
  any consistent indent, block sequences (`- item`), inline flow arrays, quoted scalars, and comments.
  `parseCiYaml` reads it into the same `CiSpec`, accepting BOTH the documented `jobs:`-wrapped shape
  (backward compatible) AND a real `.gitlab-ci.yml` (top-level jobs, reserved keys like `variables:`
  skipped, snake_case `allow_failure`). Still no js-yaml (a transitive dep is a boot-crash risk) and
  still pure + total (a bad config → `{ok:false}`, never throws).
- **PTY prompt-ready:** `server/orchestrator/ptyReady.ts` scans the accumulated PTY output for the
  CLI's trust/ready markers; `waitForOutput` early-exits as soon as one appears, with a ceiling so a
  wrong/missing marker DEGRADES to a bounded wait (never a hang, never worse than the old fixed wait).
  `stageRunner` accumulates `term.onData` and gates the trust-confirm + kickoff on detection.

## Rejected alternatives

- **Add js-yaml.** Rejected — the no-dep policy (boot-crash risk + no types) stands; the subset parser
  covers the real constructs CI configs use.
- **Parse the PTY to detect turn-end.** Rejected — the turn result still comes from the Stop hook, not
  the PTY (the billing/capture contract is unchanged); the stream is used ONLY to time the handshake.

## Consequences

- `server/ci/parse.ts` rewritten around `parseYamlSubset`; `server/orchestrator/ptyReady.ts` added +
  wired into `stageRunner`. Unit tests: `ciParse` 16/16 (backward compat + real gitlab-ci + tree +
  errors), `ptyReady` 8/8 (markers + early-exit + bounded-timeout). `ciGate` 12/12 unaffected. A live
  PTY handshake against a real container is part of the deferred post-keys e2e.
