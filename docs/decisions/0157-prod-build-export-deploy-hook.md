---
title: D4 — prod build-export (bundle) + external deploy-hook
status: accepted
date: 2026-07-08
tags: [deploy, export, ci-cd, docker, idea-to-outcome]
---

## Context

`build-export` produced only a `docker save` image tarball; the `bundle` kind (a real production build,
`npm run build` → dist/) returned `export.bundleNotImplemented`. And there was no way to hand a built
artifact to an external server — the "prod = CI/CD to another host" half of the idea→outcome vision. D4
implements both, on the existing Docker + BuildArtifact + signed-download plumbing (no new op — `build-export`
already exists and is RBAC-gated).

## Decision

- **Bundle export runs the REAL build inside a throwaway container from the project image**: `docker run`
  `<buildCmd> && tar -czf /tmp/bundle.tgz -C <outputDir> .`, then `docker cp` the single tarball out, then
  `docker rm -f`. Build + tar happen IN the container (the app image has node + tar/gzip), so nothing is
  assumed about the host — it works cross-platform (the host never tars). `buildCmd`/`outputDir` are read
  from env at CALL time (`WS_BUILD_EXPORT_CMD` default `cd /app && npm run build`, `WS_BUILD_EXPORT_DIR`
  default `/app/dist`) so a non-standard project pins its own build without a code change or restart.
- **The deploy-hook is a webhook POST** of a self-describing descriptor (`event, workspaceId, projectId,
  kind, artifactId, imageRef, downloadToken`) to `WS_DEPLOY_WEBHOOK_URL` (+ optional bearer), fired
  automatically after a ready artifact. The fetch is injectable (`DeployFetch`) so it is E2E-tested against a
  real local HTTP receiver. Unconfigured → `fired:false` no-op; a network failure is reported on the result,
  never thrown (a failed hook must not fail an export that already produced a good artifact).

## Rejected alternatives

- **Host-side tar of a `docker cp`'d directory.** The server runs on Windows; there is no guaranteed host
  `tar`. Tarring inside the container (busybox/coreutils tar is always present) sidesteps the host entirely
  and yields one file to `docker cp` out.
- **SSH/registry-push as the first deploy transport.** A webhook is the universal, testable trigger (a CI job
  URL) and needs no credential mounting or a running registry; SSH/registry-push are follow-ups that reuse
  the same descriptor. Named in the ADR so the extension point is explicit.
- **A new `deploy-hook` control-op or a deploy-target schema column.** The hook is a side-effect of an
  existing export op; env config keeps it zero-schema. A stored per-workspace target is a later enhancement,
  not required to make the artifact land on an external server.

## Consequences

- A project can now be exported as a real production build tarball (not just an image) AND automatically
  announced to an external CI/CD endpoint — the "idea → deployed software on another server" path is real and
  E2E-proven: a 144-byte bundle produced via a live container build + a real webhook POST captured by a local
  receiver (15/15). `export.bundleNotImplemented` is gone. Best-effort throughout: no Docker → `docker.
  unavailable`; build fails → `export.buildFailed` on the row; hook down → reported, export still succeeds.
