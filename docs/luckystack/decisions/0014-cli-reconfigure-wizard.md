---
title: CLI `manage` becomes a step-based reconfiguration wizard with consequence previews
status: accepted
date: 2026-06-19
tags: [cli, scaffolder, dx, env, oauth]
---

## Context

`create-luckystack-app` lets you configure a project at creation time via wizard
steps: `authMode` (none / credentials / credentials+oauth), `oauthProviders`
(multi-select), `emailProvider`, `monitoringProvider`, and on/off optional
packages (presence, error-tracking, docs-ui, secret-manager, router).

`@luckystack/cli`'s `manage` could only **install/uninstall whole packages** as a
binary checkbox. It could not express sub-options — e.g. "login + OAuth with
Google and GitHub", switch the email provider, or change monitoring. It also gave
no preview of what a change would *do* to the project (files, deps, env keys,
origins). Users had to know the consequences in advance.

## Decision

`manage` becomes a **step-based reconfiguration wizard** that mirrors the
scaffold wizard, operating on an existing project:

1. **Detect current state** from the project (installed packages from
   `package.json`; `authMode` from the presence of `src/login/*`; active OAuth
   providers / email / monitoring from declared env KEY NAMES + `EXTERNAL_ORIGINS`
   + `config.ts`).
2. **Open a step**, choose its value (single-select for authMode / email /
   monitoring, multi-select for OAuth providers, toggle for the on/off packages).
3. **Consequence preview** before apply: every pending change lists exactly what
   will be added/removed — deps, files, env-key blocks, origins. (The user
   emphasised this must be explicit at every change.)
4. **Apply** the diff (reusing the existing add/remove handlers where they exist,
   plus new transitions for authMode / OAuth providers / email / monitoring), then
   ONE `npm install`.

Three confirmed sub-decisions:

- **(D1) `.env.local` may be read for KEY PRESENCE only.** To detect which OAuth /
  email / monitoring providers are configured, the CLI reads `.env.local` first,
  then `.env`, and inspects only the **key names** (left of `=`). It MUST NEVER
  read, log, store, or use a value. This is a deliberate, user-authorised
  narrowing of CLAUDE.md Rule 16 ("never read `.env.local`") — scoped to
  key-existence detection, because that is the only reliable signal for which
  providers a project intends, and no secret value is ever touched.
- **(D2) Reconfigure→none deletes the auth UI** (with an explicit confirm), unlike
  the standalone `remove login` which is GUARDED (keeps the consumer-owned files +
  warns). The reconfigure flow's intent is "make it none", so it fully reverses.
- **(D3) The CLI is the source-of-truth for transition descriptors**, with a
  parity test against the scaffolder (mirroring `assetParity.test.ts`). No shared
  transition package is extracted now.

## Rejected alternatives

- **Keep the binary checkbox.** Rejected — it cannot express the sub-options that
  are the entire point of the request (OAuth providers, email/monitoring choice).
- **Detect providers from `node_modules` / runtime only.** Rejected — provider
  intent lives in env, not in installed packages; reading env keys is the only
  reliable signal.
- **Refuse to touch `.env.local` (strict Rule 16).** Rejected by the user for the
  narrow key-presence case (D1); values remain off-limits.
- **Extract a shared `@luckystack/project-transforms` package now** so scaffolder +
  CLI share one transition engine. Deferred — too large for this change; a parity
  test (D3) guards drift until a future ADR revisits extraction.

## Consequences

- The CLI gains a small step-wizard engine (single-select + multi-select + step
  navigation) on top of the existing zero-dep checkbox.
- A transition-descriptor model drives BOTH the preview and the apply, so "what I
  said" and "what I did" can never diverge.
- OAuth/email/monitoring env-block editing must round-trip an existing env file
  surgically (add/remove a provider's key block) rather than emit a fresh template.
- Rule 16 now has a documented, narrow exception (D1) — future code touching
  `.env.local` must still treat values as off-limits.
