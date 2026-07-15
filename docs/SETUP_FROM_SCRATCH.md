# Setup from scratch — every env value, step by step

> From a fresh `git clone` to a running app. This walks through **every** variable you fill in `.env`
> (public config) and `.env.local` (secrets). Each item is flagged **MUST** (won't boot / insecure without
> it) or **OPTIONAL** (a feature stays off until you set it). For the paid content-generation + publishing
> keys, the deep "where + cost" detail lives in **[KEY_SETUP_GUIDE.md](./KEY_SETUP_GUIDE.md)** — this doc is
> the from-zero overview that also covers the boot + login + infra keys that guide doesn't.

## 0. Before any keys — the two files + the services

```bash
git clone <repo> && cd <repo>
npm install
cp .env_template .env
cp .env.local_template .env.local
```

`.env` = public, committed. `.env.local` = secrets, gitignored. **A key belongs in exactly ONE file.**

You also need three background services running locally:

| Service | Why | Quick start |
|---|---|---|
| **MongoDB (as a replica set)** | Prisma needs it; the default `DATABASE_URL` expects `replicaSet=rs0` | `docker run -d -p 27017:27017 mongo:7 --replSet rs0` then once: `docker exec <id> mongosh --eval "rs.initiate()"` |
| **Redis** | sessions, rate-limit, cron leases, boot-UUID | `docker run -d -p 6379:6379 redis:7` |
| **Docker** | ticket containers, previews, ffmpeg render | Docker Desktop running |

---

## 1. `.env` — public config (mostly leave the defaults)

| Var | MUST/OPT | What to do |
|---|---|---|
| `NODE_ENV=development` | keep | `development` locally, `production` when deployed. |
| `SERVER_IP=127.0.0.1` | keep | Bind address. `0.0.0.0` inside a container. |
| `SECURE=false` | keep | `true` only behind HTTPS. |
| `PROJECT_NAME=test` | edit | Any short name — prefixes your Redis keys. |
| `REDIS_HOST` / `REDIS_PORT` | keep | Match your Redis (defaults are fine for the Docker line above). |
| `EXTERNAL_ORIGINS` | edit-if-oauth | Comma-list of OAuth provider origins (already lists Google/GitHub/Discord). Add more only if you enable other login providers. |
| `PUBLIC_URL` (commented) | **prod only** | Your deployed domain, e.g. `https://app.example.com`. Leave commented in dev. |
| `WS_PUBLIC_URL` (commented) | recommended | The backend's public origin, used to build the **publishing** OAuth redirect. In dev set `WS_PUBLIC_URL=http://localhost` so YouTube/TikTok redirect URIs are deterministic. |

Everything else in `.env` (proxy, engine caps, egress, per-AI price) has sensible defaults — **ignore it** until you actually deploy multi-instance or tune costs.

---

## 2. `.env.local` — group A: **MUST / strongly-recommended** (mostly self-generated)

You generate these yourself — no external account. Run the command, paste the output.

| Var | MUST/OPT | Command / value |
|---|---|---|
| `DATABASE_URL` | **MUST** | Already pre-filled for local Mongo. Only change it if your DB is elsewhere (Atlas gives you a `mongodb+srv://…` URI). |
| `WORKSPACES_ENC_KEY` | **MUST** | The server **refuses to boot** without it (guarantees stored credentials are encrypted). `openssl rand -base64 48` → paste. |
| `TOTP_ENCRYPTION_KEY` | recommended (2FA is on) | Encrypts 2FA secrets at rest. `openssl rand -hex 32` → paste. Without it they're stored plaintext + a boot warning. |
| `WS_WEBHOOK_SECRET` | optional | Only if you POST forge (GitLab/GitHub) webhooks to the app. `openssl rand -hex 32`. Unset ⇒ the webhook endpoint is safely disabled. (You can also generate it per-workspace in the app's GitLab tab.) |
| `REDIS_USER` / `REDIS_PASSWORD` | only-if-auth | Fill only if your Redis requires a login. Blank for the default local Redis. |
| `EMAIL_FROM` | edit | The "from" address on outgoing mail, e.g. `noreply@yourdomain.com`. |
| `TEST_RESET_TOKEN` | optional | Only needed if you run the integration test suite. Any random string. |

> No Windows `openssl`? Use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

**After group A the app boots + you can register/log in with email+password.** Everything below is optional per feature.

---

## 3. Group B — log INTO the app with Google/GitHub/Discord (OPTIONAL)

This is the *sign-in* button on the login page — different from *publishing to YouTube*. Each provider = one id + one secret. In dev fill the `DEV_*` pair; in prod fill the unprefixed pair.

**The redirect URI to register is `<backend-origin>/auth/callback/<provider>`** — in dev: `http://localhost/auth/callback/google` (backend runs on port 80). Must match exactly.

### Google login (`DEV_GOOGLE_CLIENT_ID` / `DEV_GOOGLE_CLIENT_SECRET`)
1. <https://console.cloud.google.com> → a project → **APIs & Services → OAuth consent screen** (External, add your email as a test user).
2. **Credentials → Create Credentials → OAuth client ID → Web application**.
3. Authorized redirect URI: `http://localhost/auth/callback/google`.
4. Paste the id + secret. Restart → a **Google** button appears on `/login` automatically.

### GitHub login (`DEV_GITHUB_CLIENT_ID` / `DEV_GITHUB_CLIENT_SECRET`)
1. <https://github.com/settings/developers> → **New OAuth App**.
2. Authorization callback URL: `http://localhost/auth/callback/github`.
3. Paste id + secret → restart.

### Discord login (`DEV_DISCORD_CLIENT_ID` / `DEV_DISCORD_CLIENT_SECRET`)
1. <https://discord.com/developers/applications> → **New Application → OAuth2**.
2. Redirect: `http://localhost/auth/callback/discord`.
3. Paste id + secret → restart.

> Facebook / Microsoft: same pattern, uncomment their block. A provider stays hidden on `/login` until **both** its id and secret are set.

---

## 4. Group C — transactional email (OPTIONAL)

Needed for: password-reset mails, the passwordless **email-code login**, and the **2FA email fallback**.
**In dev you can skip this** — without any sender the framework logs the code to the server console (fine for testing).

- `RESEND_API_KEY` — <https://resend.com> → **API Keys**. Requires `npm i resend`. Paste + restart.
- (Or SMTP: `npm i nodemailer`, uncomment + fill `SMTP_HOST/PORT/USER/PASS`.)

---

## 5. Group D — content generation + publishing (OPTIONAL, **costs money**)

These make/post real media. Full where-to-get + cost + cheap-test detail is in **[KEY_SETUP_GUIDE.md](./KEY_SETUP_GUIDE.md)**. Set a **€-budget cap in Content → Settings first.** In short:

| Var | For | Where |
|---|---|---|
| `GEMINI_API_KEY` | scripts (cheap, start here) | aistudio.google.com/app/apikey |
| `FAL_KEY` | images / video / 3D | fal.ai → Dashboard → Keys |
| `ELEVENLABS_KEY` | voice / sfx | elevenlabs.io → Profile → API Keys |
| `SUNO_KEY` (+`SUNO_BASE`/`SUNO_MODEL`) | music | your Suno API provider |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | publish to YouTube | Google Cloud → OAuth client, `youtube.upload` scope, redirect `http://localhost/content/oauth/youtube/callback` |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | publish to TikTok | developers.tiktok.com, `video.publish` scope, redirect `http://localhost/content/oauth/tiktok/callback` (needs real HTTPS, not localhost) |
| `WS_MEDIA_CHEAP=1` | cheapest live test | forces the cheapest real models — validate the pipeline for pennies |

> Media keys can also be set **per-workspace** in the app (Content → Settings → Provider keys) instead of env — stored encrypted.

---

## 6. Group E — web push / installable PWA notifications (OPTIONAL)

Generate a VAPID keypair once:
```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```
Paste into: `WS_VAPID_PUBLIC`, `WS_VAPID_PRIVATE`, and set `WS_VAPID_SUBJECT=mailto:you@example.com`. Unset ⇒ push is simply off.

---

## 7. Group F — error tracking (OPTIONAL)

Already wired to a console adapter (you see `[error-track]` lines in dev with no key). For a real backend:
- **Sentry**: `npm i @sentry/node`, set `SENTRY_DSN` (from sentry.io → project settings). `SENTRY_ENABLED=true` to force it outside prod.
- **PostHog**: `npm i posthog-node`, set `POSTHOG_KEY` (+ `POSTHOG_HOST`).

---

## 8. Start + verify

```bash
npm run prisma:db:push     # sync the Mongo schema/indexes (safe; optional fields need no migration)
npm run server             # terminal 1 — backend (port 80)
npm run client             # terminal 2 — frontend (http://localhost:5173)
```

Open http://localhost:5173, register an account, and you're in. Add the optional groups above whenever you
want that feature — each just needs its key(s) + a restart.

### Minimal sets for common goals
- **Just run the app:** group A only (DATABASE_URL + WORKSPACES_ENC_KEY) + Mongo/Redis running.
- **2FA:** group A + `TOTP_ENCRYPTION_KEY` (email code shows in the server console in dev).
- **Make + post a video to YouTube:** group A + `GEMINI_API_KEY` + `FAL_KEY` (to generate) + `YOUTUBE_CLIENT_ID/SECRET` + `WS_PUBLIC_URL=http://localhost` + a €-cap.
