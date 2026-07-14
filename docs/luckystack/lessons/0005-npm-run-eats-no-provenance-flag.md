---
severity: medium
area: release / publishing
date: 2026-07-13
tags: [npm, publish, provenance, windows, release]
---

# `npm run publish:packages -- --no-provenance` silently drops the flag on a dev-machine release

## What happened

Releasing 0.6.1 from a dev machine, the publish aborted on the FIRST package
(`@luckystack/core`) with:

```
npm error code EUSAGE
npm error Automatic provenance generation not supported for provider: null
```

Every `@luckystack/*` package.json sets `publishConfig.provenance: true` (for the
CI/OIDC path). `scripts/publishPackages.mjs` is supposed to override that on a
non-CI release when it receives `--no-provenance` (it then passes
`--provenance=false` to `npm publish`). But the run was invoked as:

```
npm run publish:packages -- --no-provenance
```

and the npm debug log showed the child ran `publish --access public
--provenance` — i.e. `noProvenance` was FALSE inside the script. npm@11 did not
forward `--no-provenance` into the script's `process.argv`; it consumed it as its
own boolean config for the `run` command instead of passing it after `--`.

## Root cause

`npm run <script> -- --no-<x>` is unreliable for a flag whose name collides with
a known npm config key (`provenance` is one). npm's arg parser can absorb the
negated boolean before it reaches the script. So the script never sees the flag,
`publishConfig.provenance: true` stays in effect, and the publish tries provenance
with no OIDC provider → abort.

## How to avoid

Invoke the release script DIRECTLY with node so the flag lands in `process.argv`
unambiguously, and set the env var as a belt-and-suspenders (npm reads it as a
config too):

```
$env:NPM_CONFIG_PROVENANCE = 'false'
node scripts/publishPackages.mjs --no-provenance
```

The script skips already-published versions, so a re-run after this kind of
first-package abort completes the rest cleanly (nothing was uploaded when core
fails first). Provenance the RIGHT way (a signed attestation) only works from CI
with `id-token: write` — a dev-machine release must disable it. Related:
[[0004-mikro-orm-cli-figlet-crash-node22-windows]] (same 0.6.1 release).
