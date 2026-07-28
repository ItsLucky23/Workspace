---
id: 0027
title: Do not rebuild platform-neutral Vite assets on the Pi
severity: medium
area: deployment, raspberry-pi, frontend
date: 2026-07-28
---

# 0027 — deploy the already-verified frontend artifact

## What happened

After `npm ci` succeeded on the Pi, the release command unnecessarily ran the full Vite production build again.
It remained at `transforming...` for roughly 45 minutes without useful progress output, causing the deployment job
to look hung and wasting the operator's time.

## Root cause

The frontend `dist/` had already been built and verified on the release source. It is static, platform-neutral
output; only the app's runtime dependencies/native optional packages and small Compose-runner TypeScript output
need ARM64-side installation/compilation. Rebuilding the same 3,997-module/large-CSS graph on the Pi added cost
without strengthening the artifact proof.

## How to avoid

- Build and test `dist/` once on the release source, then transfer that exact artifact to the Pi.
- On the Pi run the clean dependency install and only architecture-relevant/small compilation steps.
- Give every remote build a short progress checkpoint; if no progress appears, inspect CPU/process state instead of
  waiting indefinitely.
- Compare source/artifact checksums across release source and host before restart.
