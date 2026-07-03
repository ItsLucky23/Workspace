---
id: 0030
title: Editor loose ends — profile encryption-at-rest + Open VSX gallery
status: accepted
date: 2026-07-03
tags: [workspaces, editor, security, encryption, open-vsx]
supersedes: []
---

# 0030 — Editor loose ends

## Context

Goal-item #14 groups four editor "loose ends": editor-profile encryption-at-rest, Open VSX
extensions, committing the generated Dockerfile into the repo, and Monaco i18n. Two are self-
contained security/correctness wins that don't collide with the concurrent editor UI work; two are
larger and are scoped honestly below.

## Decision

- **Editor-profile encryption-at-rest** (the security-critical one). The per-user editor profile
  carries openvscode's SECRET STORAGE — extension **auth tokens** — and was stored as loose plaintext
  files under `data/editor-profiles/<userId>/`. Now each half (user-data, extensions) is captured out
  of the container as a tar, **AES-256-GCM encrypted** (`secretBox.encryptBuffer`, same app key as the
  GitLab-token encryption), and written as a `.tar.enc` blob; on the next session it is decrypted +
  streamed back in. New binary primitives `encryptBuffer`/`decryptBuffer` (compact envelope
  `[0x01][iv][tag][ct]`, `[0x00][plain]` dev fallback) sit beside the existing string `encryptSecret`.
  A blob that fails to decrypt (tamper / rotated key) is skipped loudly, never crashes.
- **Open VSX gallery**. openvscode-server defaults to the Microsoft marketplace, whose ToS forbids
  non-MS builds. The editor launch + `--install-extension` now prepend
  `EXTENSIONS_GALLERY={open-vsx.org}` (overridable via `WS_EXTENSIONS_GALLERY`, shell-quoted) so
  extensions resolve from the licensing-correct Open VSX registry.

## Rejected alternatives

- **Keep the profile as loose plaintext dirs.** Leaks extension auth tokens to anyone with host disk
  access — unacceptable for a self-hosted product handling third-party credentials (Rule 19).
- **Encrypt per-file inside the profile.** Far more surface + breaks openvscode's own layout; a single
  encrypted tar blob per half is simpler and atomic.
- **Leave the MS marketplace default.** A licensing violation for an OSS-based editor; Open VSX is the
  correct registry and is a one-line env.

## Consequences

- The editor profile (auth tokens included) is encrypted at rest under the workspace app key;
  extensions install from Open VSX.
- Verified: `editorProfileCrypto.test.mts` (11/11) — encrypted round-trip, ciphertext ≠ plaintext,
  tamper/truncation/wrong-key → null, no-key dev round-trip, and the Open VSX gallery env (open-vsx.org
  + shell-safe quoting). Full suite 32/32. The tar-in/out against a live container is Docker-gated
  (the crypto + env shaping are proven headless).
- **DEFERRED (honest scope), tracked as #14 follow-ups:**
  - **Dockerfile-commit-in-repo** — writing the approved draft Dockerfile into the workspace's git
    repo (`.workspaces/Dockerfile`) touches the repo checkout + git-commit flow and needs Docker/git
    to verify; deferred rather than half-built.
  - **Monaco i18n** — localizing the Monaco-lite editor overlaps the concurrent editor-UI work; left
    to coordinate with that change rather than risk a collision (build-contract: don't touch the other
    stream's editor files unless needed).
