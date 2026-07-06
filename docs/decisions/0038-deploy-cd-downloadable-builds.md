---
id: 0038
title: Deploy/CD — promote ladder + downloadable build export
status: accepted
date: 2026-07-06
tags: [deploy, cd, promote, build-export, download, expansion-b2]
supersedes: []
depends_on: [0037]
---

# Deploy/CD — the promote ladder + downloadable builds

## Context

B1 (ADR 0037) added persistent environments + `deployEnvironment`. B2 turns that into a CD flow: move a
tested build UP the fixed `dev → staging → prod` ladder (gated), and let the user EXPORT a build to
self-host elsewhere — the user's explicit ask: *"optie 1 [same-host deploy] maar we willen ook builds
kunnen downloaden om die zelf ergens anders te hosten."*

## Decision

1. **Promote ladder (`env-promote`).** `promoteEnvironment(project, service, fromKind, {approved})` deploys
   the next stage with the SOURCE env's EXACT image pinned (`deployEnvironment(..., {imageRef})`) — what you
   tested on dev is what ships, not a fresh branch pull. Gates: the source must be **live** (a health
   signal — you can't promote a broken build), and **prod requires an explicit approval** (B-23 confirm).
   The green-CI gate is a documented HOOK that C1 (BUILTIN_CI) fills — left as an explicit TODO in
   `promote.ts` rather than faking a check that doesn't exist yet.

2. **Downloadable build export (`build-export` + `BuildArtifact`).** `buildExport` runs `docker save` on the
   project's built image → an OCI tarball under the workspace data dir, tracked by a `BuildArtifact` row
   (building→ready|error) with an unguessable 24-byte `downloadToken` + a TTL. Served over a signed,
   TTL'd, token-gated link `GET /downloads/build/<token>` (origin-exempt, streamed, 404 on unknown/expired
   — no existence oracle). The `bundle` kind (built dist, not the whole image) is deferred to the
   build-into-image work (returns `export.bundleNotImplemented`, not a silent no-op).

3. **`dev` auto-deploy on merge is a documented follow-up.** The user's decision includes it; the clean path
   is a `WorkspaceTrigger` matcher on `mr.merged` firing a deploy action (no new verb, ADR 0027 automation
   engine). Rather than fake a direct always-deploy, this is left as the next thin automation-engine wiring
   so it's configurable + opt-in — noted here so it isn't lost.

4. **`DeployTarget` seam stubbed.** Same-host deploy is the only built provider; external targets
   (VPS/cloud/k8s) are a later seam (§2.2). Not modeled yet — B2 is same-host + download-export.

## Rejected alternatives

- **Redeploy the branch on promote (no image pin).** Rejected — promotion must ship the *tested* artifact;
  re-pulling the branch could ship a different build than what passed the lower env.
- **A public/predictable download path.** Rejected — the token is the only auth; a guessable path would leak
  builds. A short TTL + a random token + a 404-on-miss avoids an existence oracle.
- **Ungated prod promote.** Rejected — prod is the irreversible-ish action B-23 reserves for an explicit
  human confirm; it also gets the green-CI gate once C1 lands.

## Consequences

- Schema grows (`BuildArtifact`). Snapshot returns the active project's `buildArtifacts[]` (download links);
  the settings Environments card gains Promote (per live env) + Export-build + a download list.
- `deployEnvironment` gained an optional pinned `imageRef` (promotion).
- A new origin-exempt streamed download route is registered at boot.
- C1 wires the green-CI gate into the prod promote; B3 (rollback) reuses the deploy machinery; the
  auto-deploy-on-merge trigger + the `bundle` export + external `DeployTarget` remain named follow-ups.
