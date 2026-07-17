# Setup from scratch — the complete A-to-Z install guide

> From a fresh `git clone` to a fully running app, **without Googling anything**. Every value you put in
> `.env` and `.env.local` is here with click-by-click steps. Each item is flagged **MUST** (won't boot /
> insecure) or **OPTIONAL** (a feature stays off until you set it). Do the **MUST** items; add optional
> groups whenever you want that feature.
>
> **The golden rule:** a key lives in exactly ONE file. `.env` = public (committed). `.env.local` = secrets
> (gitignored). After changing any value, **restart the backend** (`npm run server`) — env is read at boot.

---

## 0. Get the code running (do this first)

```bash
git clone <repo> && cd <repo>
npm install
cp .env_template .env
cp .env.local_template .env.local
```

Now start the three background services (each is one Docker command):

### 0a. MongoDB — as a replica set (required by Prisma)
Prisma needs Mongo running **as a replica set** (single node is fine). Plain Mongo won't work.
```bash
docker run -d --name ws-mongo -p 27017:27017 mongo:7 --replSet rs0
# wait ~3 seconds, then initialise the replica set ONCE:
docker exec ws-mongo mongosh --quiet --eval "rs.initiate()"
```
Verify it's ready (should print `"ok" : 1` / a primary):
```bash
docker exec ws-mongo mongosh --quiet --eval "rs.status().ok"
```
The default `DATABASE_URL` in `.env.local` already points at this (`…?replicaSet=rs0&directConnection=true`).

### 0b. Redis
```bash
docker run -d --name ws-redis -p 6379:6379 redis:7
```

### 0c. Docker Desktop
Just make sure it's running — the app launches ticket/preview/ffmpeg containers through it.

---

## 1. Group A — the MUST values (self-generated, no accounts)

Open `.env.local` and fill these. You generate the keys yourself with one command.

> These use **Node** (already installed — it ships with the project), so they work identically on Windows,
> macOS and Linux. Copy the whole line into your terminal; it prints one random string — paste that as the value.

1. **`DATABASE_URL`** — **MUST.** Already correct for the local Mongo above. Only change it if your DB is
   elsewhere (MongoDB Atlas hands you a `mongodb+srv://…` URI — paste that).
2. **`WORKSPACES_ENC_KEY`** — **MUST.** The server **refuses to boot** without it (it encrypts stored
   credentials). Generate + paste:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   ```
3. **`TOTP_ENCRYPTION_KEY`** — **strongly recommended** (2FA is enabled). Encrypts 2FA secrets. Generate + paste:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **`EMAIL_FROM`** — set the "from" address for outgoing mail, e.g. `noreply@yourdomain.com`.
5. **`REDIS_USER` / `REDIS_PASSWORD`** — leave **blank** (the local Redis above has no auth). Fill only if
   your Redis requires a login.
6. **`WS_WEBHOOK_SECRET`** *(optional)* — only if a GitLab/GitHub webhook will POST into the app. Generate with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Unset = the webhook endpoint is safely off. (You can also make one per-workspace
   in the app's GitLab tab.)
7. **`TEST_RESET_TOKEN`** *(optional)* — only if you run the integration test suite. Any random string.

In `.env` (public), edit one thing:
- **`PROJECT_NAME`** — any short name (prefixes your Redis keys), e.g. `myapp`.
- Add this line (makes publishing redirect URIs deterministic in dev): `WS_PUBLIC_URL=http://localhost`

✅ **After Group A the app boots and you can register + log in with email + password.** Everything below is optional — add a group only when you want that feature.

---

## 2. Group B — social login buttons (OPTIONAL)

The "Sign in with Google/GitHub/Discord" buttons on the login page. Each needs one **Client ID** + one
**Client secret**. Fill the **`DEV_*`** pair for local dev. The button appears on `/login` automatically once
both are set + you restart. **The redirect URI is always `http://localhost/auth/callback/<provider>`.**

### 2a. Google login  → `DEV_GOOGLE_CLIENT_ID` + `DEV_GOOGLE_CLIENT_SECRET`
1. Go to **https://console.cloud.google.com** and sign in.
2. Top bar → project dropdown → **New Project** → give it a name → **Create** → select it.
3. Left menu → **APIs & Services → OAuth consent screen**:
   - Choose **External** → **Create**.
   - App name = anything; User support email + Developer email = **your email** → **Save and Continue**.
   - **Scopes** step → just **Save and Continue** (basic login needs no extra scopes).
   - **Test users** → **Add users** → type **your own email** → **Save and Continue**. *(Required, or Google blocks the login with "access denied".)*
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type = **Web application**.
   - **Authorized redirect URIs → Add URI** → paste exactly: `http://localhost/auth/callback/google`
   - **Create**.
5. Copy the **Client ID** and **Client secret** → into `.env.local`:
   `DEV_GOOGLE_CLIENT_ID=…` / `DEV_GOOGLE_CLIENT_SECRET=…` → restart.

### 2b. GitHub login  → `DEV_GITHUB_CLIENT_ID` + `DEV_GITHUB_CLIENT_SECRET`
1. **https://github.com/settings/developers** → **OAuth Apps** → **New OAuth App**.
2. Application name = anything. **Homepage URL** = `http://localhost:5173`.
   **Authorization callback URL** = `http://localhost/auth/callback/github` → **Register application**.
3. Copy the **Client ID**. Click **Generate a new client secret** → copy it (shown once).
4. Paste both → `DEV_GITHUB_CLIENT_ID=…` / `DEV_GITHUB_CLIENT_SECRET=…` → restart.

### 2c. Discord login  → `DEV_DISCORD_CLIENT_ID` + `DEV_DISCORD_CLIENT_SECRET`
1. **https://discord.com/developers/applications** → **New Application** → name → **Create**.
2. Left menu → **OAuth2**. Copy the **Client ID**. Click **Reset Secret** → copy the **Client Secret**.
3. Still on **OAuth2** → **Redirects → Add Redirect** → `http://localhost/auth/callback/discord` → **Save Changes**.
4. Paste both → `DEV_DISCORD_CLIENT_ID=…` / `DEV_DISCORD_CLIENT_SECRET=…` → restart.

> Facebook / Microsoft: same idea — uncomment their block, register `http://localhost/auth/callback/<provider>`.

---

## 3. Group C — transactional email (OPTIONAL)

Sends: password-reset mails, the **email-code login**, and the **2FA email fallback**.
**Skip this in dev** — with no sender, the framework prints the code straight to the server console (perfect for testing).

For real email (**Resend**) → `RESEND_API_KEY`:
1. **https://resend.com** → sign up.
2. Left menu → **API Keys → Create API Key** → name it → copy the key (shown once).
3. In the project: `npm i resend`.
4. Paste `RESEND_API_KEY=…`. Set `EMAIL_FROM` to an address on a **domain you verified in Resend** (for a quick test you can use `onboarding@resend.dev`). Restart.

---

## 4. Group D — content generation (OPTIONAL, **costs real money**)

> **⚠️ Set a budget first.** In the app: **Content → Settings → Media budget** → a small €-cap (e.g. €5) +
> an alert %. It's a hard stop. Until you add these keys the whole content pipeline runs in **dummy mode**
> (placeholder assets, nothing billed). You can also store these per-workspace in the app (Content →
> Settings → Provider keys, encrypted) instead of env.

### 4a. Gemini — script writing (cheap, start here)  → `GEMINI_API_KEY`
1. **https://aistudio.google.com/app/apikey** → sign in.
2. **Create API key** → **Create API key in new project** → copy it.
3. Paste `GEMINI_API_KEY=…` → restart. (Text only — very low cost.)

### 4b. Fal.ai — images / video / 3D  → `FAL_KEY`
1. **https://fal.ai** → sign in.
2. **Dashboard → Keys** (https://fal.ai/dashboard/keys) → **Add key** → copy it.
3. Paste `FAL_KEY=…` → restart. **Images are cheap; video/3D are the expensive part** — keep the cap low.

### 4c. ElevenLabs — voiceover / sound effects  → `ELEVENLABS_KEY`
1. **https://elevenlabs.io** → sign up.
2. Click your **profile (top-right) → API Keys** (or Profile → "API Key") → copy it.
3. Paste `ELEVENLABS_KEY=…` → restart.

### 4d. Suno — music  → `SUNO_KEY`
1. Sign up at your Suno API provider — **https://sunoapi.org** (the base the app defaults to).
2. Get your **API key** from its dashboard → copy.
3. Paste `SUNO_KEY=…` → restart. (Defaults for `SUNO_BASE`/`SUNO_MODEL` are already correct.)

### 💸 Cheapest live test
Set **`WS_MEDIA_CHEAP=1`** in `.env.local` → forces the cheapest real models (fast image model, lowest
resolution, fewest steps). With a €1–2 cap you can validate the whole real pipeline for pennies. Full detail:
`docs/KEY_SETUP_GUIDE.md`.

---

## 5. Group E — publishing to social platforms (OPTIONAL)

### 5a. YouTube  → `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET`
Sign in with **the Google account that owns your YouTube channel**.
1. **https://console.cloud.google.com** → project dropdown → **New Project** → name → **Create** → select it.
2. **APIs & Services → Library** → search **"YouTube Data API v3"** → open it → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - **External → Create**. App name + your email (support + developer) → **Save and Continue**.
   - **Scopes → Add or remove scopes** → paste `https://www.googleapis.com/auth/youtube.upload` → tick it → **Update → Save and Continue**.
   - **Test users → Add users → your email → Save and Continue**.
4. **Credentials → Create Credentials → OAuth client ID → Web application**:
   - **Authorized redirect URIs → Add URI** → `http://localhost/content/oauth/youtube/callback` → **Create**.
5. Copy **Client ID** + **Client secret** → `.env.local`:
   `YOUTUBE_CLIENT_ID=…` / `YOUTUBE_CLIENT_SECRET=…` → restart backend.
6. In the app: **Content → Settings → Connect YouTube** → Google's **Allow** → you're connected. Then a
   piece with a rendered video → **Publish** → pick the account → confirm.

> Why the redirect is `http://localhost` (no port): the backend runs on port 80, and browsers drop the
> default `:80`. It must match **character-for-character**. If Google complains, set `WS_PUBLIC_URL=http://localhost`.

### 5b. TikTok  → `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET`
1. **https://developers.tiktok.com** → log in → **Manage apps → Create an app**.
2. Add the product **Content Posting API**, request the **`video.publish`** scope.
3. Set the **Redirect URI**: `https://<your-domain>/content/oauth/tiktok/callback`.
   ⚠️ TikTok requires **real HTTPS** — plain `localhost` won't work; use your deployed domain or a tunnel
   (ngrok / cloudflared), and set `WS_PUBLIC_URL` to that HTTPS origin.
4. Copy **Client key** + **Client secret** → `.env.local`:
   `TIKTOK_CLIENT_KEY=…` / `TIKTOK_CLIENT_SECRET=…` → restart. Connect + publish like YouTube.

> Instagram / LinkedIn are designed-for but not built yet.

---

## 6. Group F — web push / installable notifications (OPTIONAL)

Generate a VAPID keypair once:
```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```
It prints `{ publicKey, privateKey }`. Paste into `.env.local`:

`WS_VAPID_PUBLIC=publicKey` 

`WS_VAPID_PRIVATE=privateKey` 

`WS_VAPID_SUBJECT=mailto:you@example.com` → restart.

---

## 7. Group G — error tracking (OPTIONAL)

Already logs to the console in dev (`[error-track]` lines, no key needed). For a real backend:

### Sentry  → `SENTRY_DSN`
1. **https://sentry.io** → sign up → **Create Project** → platform **Node.js** → copy the **DSN** it shows
   (Settings → Client Keys (DSN) if you need it again).
2. `npm i @sentry/node`. Paste `SENTRY_DSN=…` (uncomment it) → restart. (Add `SENTRY_ENABLED=true` to run it outside production.)

### PostHog  → `POSTHOG_KEY`
1. **https://posthog.com** → project → **Project Settings → Project API Key** → copy.
2. `npm i posthog-node`. Set `POSTHOG_KEY=…` + `POSTHOG_HOST=https://us.i.posthog.com` → restart.

---

## 8. Everything you can ignore

The remaining `.env` variables — proxy (`WS_PROXY`, `WS_CADDY_*`, `WS_NGINX_*`), engine caps
(`WS_MAX_CONCURRENT_TURNS`, `WS_EDITOR_IDLE_MIN`, …), egress (`WS_EGRESS*`), multi-instance
(`WS_MULTI_INSTANCE`), per-AI price (`WS_MODEL_PRICE_PER_1K_JSON`), and the render/model overrides
(`WS_FFMPEG_IMAGE`, `FAL_MODEL_*`, `SUNO_*`, `FAL_POLL_*`) — all have sensible defaults. **Leave them alone**
until you deploy multi-instance or want to tune cost/quality.

---

## 9. Start + verify

```bash
npm run prisma:db:push     # sync the Mongo schema/indexes (safe)
npm run server             # terminal 1 — backend (port 80)
npm run client             # terminal 2 — frontend
```
Open **http://localhost:5173**, register, and you're in.

### Minimal sets for common goals
| I want… | Fill in |
|---|---|
| **Just run the app** | Group A (`DATABASE_URL` + `WORKSPACES_ENC_KEY`) + Mongo/Redis running |
| **Try 2FA** | Group A + `TOTP_ENCRYPTION_KEY` (the login code prints in the server console in dev) |
| **Social login** | Group A + one provider from Group B |
| **Make + post a YouTube video** | Group A + `GEMINI_API_KEY` + `FAL_KEY` + `YOUTUBE_CLIENT_ID/SECRET` + `WS_PUBLIC_URL=http://localhost` + a €-cap |
