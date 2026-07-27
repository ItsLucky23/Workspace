---
id: 0021
title: A named volume copies the image directory ownership on first mount
severity: high
area: production, docker, containers, git
date: 2026-07-27
---

# 0021 — declaring `USER agent` does not make a mounted workdir writable

## What happened

After Docker CLI itself was fixed, a production worker container started successfully but `git clone /mirror
/work` failed with `/work/.git: Permission denied`. The runtime correctly launched the container with
`--user agent`; repeatedly recreating the container and volume produced the same result.

## Root cause

The base image switched to `USER agent` and then declared `WORKDIR /work`, but `/work` had never explicitly been
created and owned by that user. Docker initializes a fresh named volume from the image's mountpoint metadata. The
volume therefore started as `root:root`, and selecting a non-root runtime user does not rewrite existing filesystem
ownership.

## How to avoid

- Create every named-volume mountpoint explicitly while building the image and `chown` it to the runtime uid/gid
  before `USER` drops privileges.
- Keep the runtime non-root; do not solve this with a privileged container or root entrypoint.
- Verify the first-write operation against a genuinely fresh named volume, not only the image filesystem.
- Lock the Dockerfile ordering in a unit contract and run a real container clone as the acceptance test.
