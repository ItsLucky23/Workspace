# Upgrading LuckyStack (AI-actionable runbook)

> This is the golden path an AI agent (or a developer) follows when the user
> says **"upgrade LuckyStack"**, **"bump to the latest version"**, or names a
> target version. It is written so an AI can execute it end-to-end and — this is
> the important part — **proactively surface what changed and OFFER new
> features**, rather than silently bumping numbers.

---

## The one rule that makes this good

**Never bump the version silently.** Before touching `package.json`, read the
CHANGELOGs between the installed and target version, and tell the user in plain
language what they'd gain — especially security features (e.g. 2FA / email-code
login) and breaking changes — then ask whether they want to adopt any new
feature. A version bump the user didn't understand is a bad upgrade even if it
compiles.

---

## Where the upgrade info lives (so you can ALWAYS find it)

Everything an AI needs to upgrade is on disk after a plain `npm install` — you do
not need network access beyond `npm view` for the latest version number:

- **What changed:** `node_modules/@luckystack/*/CHANGELOG.md` (per package). These
  ship inside every package tarball, so after `npm install` of the NEW versions
  they describe exactly what you're moving TO. Read `core`, `server`, `cli`,
  `create-luckystack-app`, and `login` first.
- **How each package works + how to upgrade:** `node_modules/@luckystack/*/CLAUDE.md`
  — every package ships its own. `node_modules/@luckystack/cli/CLAUDE.md` carries a
  self-contained copy of THIS runbook, so even a project whose own docs predate the
  upgrade tooling can read the procedure once the new cli is installed.
- **Deep dives + the "why":** `node_modules/@luckystack/core/docs/` and (in the
  project) `docs/luckystack/` + `docs/luckystack/decisions/`. When a CHANGELOG is
  terse or has gaps for an old version (see the OLDER-project section), the
  per-package CLAUDE.md "Config keys" section and the ADRs fill in the detail.

So the reliable order is always: **bump the versions → `npm install` → THEN read
the now-updated `node_modules/@luckystack/*` docs → execute.** The one thing you
can't read from the old project is the new procedure itself; that's why it also
lives in the cli package (point 2) and, for a project scaffolded with AI docs, in
this file (`docs/luckystack/UPGRADING.md`).

---

## Step 0 — Find the version gap and read the changes

1. **Installed version:** read `node_modules/@luckystack/core/package.json`
   (`version`). All `@luckystack/*` packages move in lockstep, so one is enough.
2. **Latest version:** `npm view @luckystack/core version` (or the version the
   user named).
3. **What changed:** read the `CHANGELOG.md` of the relevant installed packages
   (`node_modules/@luckystack/<pkg>/CHANGELOG.md`) OR the framework docs copied
   into `docs/luckystack/` after step 3 below. Focus on entries BETWEEN the
   installed and target version. Summarize for the user:
   - **New features** (call out security ones like 2FA / email-code login).
   - **Bug fixes** relevant to their stack (e.g. MikroORM codegen, Windows).
   - **Breaking changes** (rare; LuckyStack keeps new features OFF by default).

4. **Surface + offer.** Say something like:
   > "v0.5.0 → v0.6.1 adds passwordless email-code login + 2FA (authenticator
   > apps, via the open TOTP standard) and fixes N bugs. 2FA is off by default.
   > Want me to enable 2FA + email-code login as part of this upgrade?"

   Then act on their answer. Adopting a feature adds steps 5b/5c below.

---

## Step 1 — Bump the dependencies (developer action)

Bump EVERY `@luckystack/*` entry in `package.json` — including the
`@luckystack/cli` **devDependency** — to the same target version, then install:

```
npm install
```

`npm install` is a developer action — if you're an AI, ask the user to run it
(or `! npm install` in this session). This delivers all **package code**
(runtime, framework routes, the whole library) automatically. New config
DEFAULTS also arrive here — they deep-merge from core, so a new config key is
present with a safe default without editing `config.ts`.

> Keep the cli version equal to the other `@luckystack/*` versions — `luckystack
> update` re-renders at the CLI's version and warns on a mismatch.

---

## Step 2 — Refresh the framework-authored files

`npm install` cannot deliver files that live in YOUR tree (docs, scripts, and —
after a feature release — `src/` UI + routes). Two commands close that gap:

```
npx luckystack update          # docs/luckystack, CLAUDE.md, skills, scripts, templates
npx luckystack update --app    # ALSO src/ UI + routes, functions/, config.ts, tsconfig
```

Both re-render a fresh scaffold with your RECORDED choices
(`.luckystack/scaffold.json`) as the single source of truth, then per file:

- **new framework file** (you didn't have it) → delivered (e.g. a feature's new
  UI component).
- **file you never edited** (hash matches the manifest baseline) → refreshed.
- **file you edited** → a `<file>.new` sidecar next to it — **never
  overwritten** — plus an AI-merge note in `dump/UPDATE_<hash>.log`.

Your own app code (never in the fresh render) is untouched. `prisma/`, `.env`,
`.env.local`, and `package.json` are never touched, even by `--app`.

---

## Step 3 — Merge the `.new` sidecars

For each `<file>.new` the report lists: merge its changes into `<file>`,
preserving your local edits, then delete the `.new` sidecar. An AI can apply the
`dump/UPDATE_<hash>.log` report directly. Review with `git diff` before
committing.

---

## Step 4 — Adopt a feature the user opted into (feature-specific)

First decide WHICH kind of adoption it is — they use different commands:

- **A new OPTIONAL PACKAGE** (e.g. `cron`, `presence`, `docs-ui`,
  `secret-manager`, `router`, `email`, `sync`). `npm install` upgrading the
  version does NOT install a package the project never had, and `luckystack
  update` won't add one either (it only refreshes files that were already
  rendered with your recorded choices). Adopt it with **`npx luckystack add
  <feature>`** — that adds the dependency, injects any `src/` assets a plain
  `npm i` can't (Vite/file-routing only see `src/`), and self-wires backend-only
  packages at boot. Run `npx luckystack list` first to see installed vs
  available. (These same packages are also scaffold `--<feature>` flags for NEW
  projects, but on an EXISTING project `luckystack add` is the path.)
- **A feature TOGGLE on an already-installed package** (e.g. turning on 2FA /
  email-code login, which live inside `@luckystack/login` you already have).
  This needs the three things below — a package add won't do it.

Enabling a feature toggle usually needs three things the safe auto-update can't
do for you:

- **Flip the config flag** in `config.ts` (e.g. `auth.twoFactor: 'optional'`,
  `auth.emailCodeLogin: true`). `--app` sidecars the new commented options into
  `config.ts.new` so you can see them.
- **Add data-layer columns** (schema is NEVER auto-edited — too risky). For 2FA:
  add `twoFactorEnabled Boolean @default(false)`, `totpSecret String?`,
  `recoveryCodes Json?` to your `User` model (or your data layer's user table)
  and migrate (`prisma db push` / `migrate`, `db:schema:update`, …). If you
  forget, enrollment fails LOUDLY with a server log naming the exact columns.
- **Wire prerequisites** the feature needs (e.g. `@luckystack/email` installed +
  a sender registered for email-code login; `TOTP_ENCRYPTION_KEY` in
  `.env.local` to encrypt TOTP secrets at rest).

Each feature ships a runbook — for 2FA / email-code login see
`docs/luckystack/ARCHITECTURE_AUTH.md` (§"Enabling email-code login / 2FA on an
EXISTING project").

---

## Step 5 — Verify

```
npm run generateArtifacts   # regenerate the typed route maps
npm run typecheck           # tsc --noEmit — 0 errors
npm run build               # optional: prod bundle
```

Then smoke-test the flows you touched in a browser (server-start is a developer
action). Commit once green.

---

## Upgrading an OLDER project (before the update tooling / no manifest)

A project scaffolded before the upgrade tooling existed needs three extra things.
None of them block the upgrade — they just add manual steps.

- **Bootstrap the procedure.** A very old project's own `CLAUDE.md` / `docs/` predate
  this runbook, so the AI can't read the procedure from the project until AFTER the
  refresh. Break the cycle by bumping `@luckystack/cli` (and the rest) FIRST and
  running `npm install` — then read `node_modules/@luckystack/cli/CLAUDE.md` (it
  ships this runbook) and continue. If in doubt, the developer can paste the
  standalone upgrade handoff; a capable AI can also just do the version bump from
  first principles ("upgrade = bump every `@luckystack/*` to the same latest
  version, then install").
- **No scaffold manifest (`.luckystack/scaffold.json`, added in 0.4.1).** Without it,
  `luckystack update` / `update --app` run in **sidecar-only mode**: every framework
  file that differs from the fresh render becomes a `<file>.new` twin and NOTHING is
  overwritten — safe, but more `.new` files to merge by hand. (A project keeps its
  manifest once it re-scaffolds or is created 0.4.1+.)
- **CHANGELOG gaps.** Some packages' `CHANGELOG.md` do not have an entry for every
  historical version (e.g. the 0.2.x–0.4.x window). When the gap between the
  installed and target version isn't fully covered by the CHANGELOGs, ALSO read the
  per-package `CLAUDE.md` "Config keys" sections (they document new config keys +
  the rare behaviour-flip defaults) and the relevant `docs/decisions/*.md` ADRs.

## Behaviour changes to expect (not breaking, but visible)

LuckyStack keeps new features OFF by default, so upgrades rarely break a build.
But a few defaults change observable behaviour — call these out to the user:

- **Logger timestamps ON (since 0.6.3).** The built-in loggers now prefix each line
  with an ISO-8601 UTC timestamp. Set `logging.timestamps: false` to restore the old
  output (e.g. under a log aggregator that stamps its own time).
- **When adopting an opt-in feature** (2FA, email-code login, …) you are turning on
  new behaviour deliberately — that's Step 4, not an automatic change.

Check each package CHANGELOG's **### Changed** entries for anything else in your gap.

---

## What arrives how (summary)

| Change kind | Delivered by | Automatic? |
| --- | --- | --- |
| Runtime / framework routes / library code | `npm install` | Yes |
| New config VALUE (with a default) | `npm install` (deep-merge) | Yes — safe default, feature OFF |
| Framework docs / scripts / CLAUDE.md | `luckystack update` | Yes (pristine) / sidecar (edited) |
| Framework `src/` UI + routes, `config.ts` | `luckystack update --app` | New→delivered, edited→`.new` sidecar |
| Your own app code | — | Never touched |
| Data-layer schema columns (2FA, …) | Manual (documented) | No — fails loudly if a feature needs them |
| Real secrets / `.env.local` | Manual | No — never touched |
