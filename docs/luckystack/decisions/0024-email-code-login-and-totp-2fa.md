---
status: accepted
date: 2026-07-12
tags: [auth, login, 2fa, security]
related: [0010, 0015, 0020, 0023]
---

# Passwordless email-code login + 2FA via the open TOTP standard (authenticator apps), backwards compatible for existing projects

## Context

Two long-requested auth features: signing in with just an email + a mailed
code, and a second factor on top of the first one. The user asked whether the
"verified apps" of Google/Microsoft could be used for 2FA — they can, without
any vendor integration: Google/Microsoft Authenticator (and Authy, 1Password,
…) all implement TOTP (RFC 6238), an open standard. A hard requirement: repos
already scaffolded on v0.5.1 must be able to ADD these features by upgrading
their `@luckystack/*` deps + flipping config flags — no re-scaffold.

## Decision

- **TOTP hand-rolled on `node:crypto`** (`packages/login/src/totp.ts`): HMAC-
  SHA1 HOTP + timing-safe TOTP verify across the drift window, base32 codecs,
  otpauth:// provisioning URI. Zero dependencies; pinned to the official RFC
  4226/6238 test vectors. Replay protection = the verify returns the matched
  timestep; the flow layer persists the highest accepted step per user.
- **Email-OTP store** (`emailOtp.ts`) is deliberately NOT the core
  one-time-token primitive: that hashes the KEY material, which is only safe
  for 256-bit tokens — a 6-digit code (10^6) would be brute-forceable from a
  Redis dump and unfindable at verify time. Codes are keyed by
  purpose+identity with the sha256 in the VALUE, an atomic INCR attempt
  counter, winner-take-all consume, one active code per slot.
- **2FA challenge = a parked login** (`twoFactor.ts`): after the first factor
  verifies, no session is minted; a high-entropy challenge token (hashed at
  rest) is returned and `/auth/api/2fa` completes the login through the SAME
  `finalizeLogin` tail as the password path. Wrong codes do not burn the
  challenge — the attempt budget does. Methods: `totp` (primary),
  `email-code` (config-gated fallback, bound to an active challenge),
  `recovery-code` (10 one-time codes, sha256 at rest, fail-closed burn).
- **Login gate as a DI slot** (`registerTwoFactorGate`): twoFactor.ts
  registers itself via the package index — avoids a login↔twoFactor module
  cycle and keeps every path that never imports the package unchanged.
- **Secrets at rest**: `sanitizeUserForSession` (and the fail-closed session
  fallback) always strips `totpSecret`/`recoveryCodes`; the TOTP secret is
  AES-256-GCM encrypted when `TOTP_ENCRYPTION_KEY` is set (legacy plaintext
  stays readable so the key can be introduced later).
- **Routes live in the framework layer** (`@luckystack/server`
  `authSecondFactorRoutes.ts`) because only that layer may write the HttpOnly
  session cookie. Login-completing routes join the CSRF bootstrap-exemption
  set; the authed enrollment routes stay CSRF-enforced.
- **Backwards compatibility**: all logic ships in framework packages (comes
  along with a dep upgrade), routes self-wire, the new `UserRecord`/Prisma
  fields are optional, and both features default OFF (`auth.emailCodeLogin:
  false`, `auth.twoFactor: 'disabled'`). An upgraded v0.5.1 project enables
  them in config.ts; the only schema action is adding the three optional User
  columns (db push / migrate).

## Rejected alternatives

- **Google/Microsoft as a 2FA *service*** — unnecessary: their apps speak the
  open TOTP standard; a vendor API would add lock-in for nothing.
- **A TOTP library (otplib etc.)** — the algorithm is ~60 lines on
  `node:crypto`; the repo's zero-dep preference and the RFC vectors make the
  hand-rolled version safer to audit than a dependency to track.
- **Reusing `oneTimeToken` for email codes** — see above; hashing low-entropy
  codes as Redis keys is unsafe by construction.
- **Email-code as the only 2FA channel** — weaker (mailbox = single point);
  chosen as fallback next to TOTP instead.
- **2FA challenge via the single-use token primitive** — a mistyped code
  would burn the whole challenge; users get an attempt budget instead.

## Consequences

- Wizard/scaffold: the template config.ts ships the options commented; the
  login form shows the email-code entry point only when `/auth/providers`
  advertises it. The settings page gains a 2FA management section
  (enroll/QR-URI/recovery/disable) on the framework routes.
- OAuth logins are NOT gated by the 2FA challenge (the provider is the second
  factor there); the gate covers password + email-code logins.
- The Prisma-bound settings-routes gap (ADR 0023) is unchanged — the 2FA
  section itself talks to adapter-based framework routes and works on every
  data layer.
