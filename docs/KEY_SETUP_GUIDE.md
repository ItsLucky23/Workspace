# Key setup guide — turning on real content generation

> **⚠️ This costs real money.** Every image, video, voice, song and post below is billed by the
> provider, per generation. Before you add any key: open **Content → Settings → Media budget** and set a
> **€-cap + alert %**. The cap is a hard stop — a runaway automation cannot bill past it. Start small
> (e.g. €5) while you test.

Until you add keys, the whole content platform runs in a **safe dummy mode**: the pipeline, budget,
review and publish-gate all work end-to-end on placeholder assets (`stub://…`), so nothing is billed and
nothing is posted. Adding a key flips that feature to the real provider.

## Where keys go

There are two places, and either works:

1. **In the app** — **Content → Settings → Provider keys**. Keys are stored **encrypted** on the server
   (AES-256-GCM) and never shown back. This is the recommended path for a hosted workspace.
2. **In the server environment** — `.env.local` (or your secret-manager). Use this for a self-hosted /
   single-tenant setup. The env value is read at boot.

> **🔒 Required first:** `WORKSPACES_ENC_KEY` **must be set** (any long random string, or a secret-manager
> pointer) or the server will refuse to boot — this is deliberate: it guarantees every stored credential
> is encrypted at rest, never plaintext. Set it in `.env.local` before anything else.

---

## Providers

### Fal.ai — images · video · 3D · reference-image  (`FAL_KEY`)
- **Get it:** sign in at <https://fal.ai> → **Dashboard → Keys** → create a key.
- **Put it:** app settings (provider **Fal.ai**) or `FAL_KEY=…`.
- **Cost:** pay-per-generation, per model. Images are cheap (a few cents); **video and 3D are the
  expensive ones** (tens of cents to euros per clip). Optional overrides: `FAL_MODEL_IMAGE`,
  `FAL_MODEL_VIDEO`, `FAL_MODEL_3D`, `FAL_MODEL_REFERENCE_IMAGE`, and the budgeting estimates
  `FAL_COST_IMAGE` / `FAL_COST_VIDEO` / `FAL_COST_3D` (cents).
- **⚠️ Watch video/3D** — a single automation over many beats can add up fast. Keep the €-cap low first.

### ElevenLabs — voiceover · sound effects  (`ELEVENLABS_KEY`)
- **Get it:** <https://elevenlabs.io> → **Profile → API Keys**.
- **Put it:** app settings (provider **ElevenLabs**) or `ELEVENLABS_KEY=…`. Optional:
  `ELEVENLABS_VOICE_ID` (default voice), `ELEVENLABS_MODEL`.
- **Cost:** billed per character (TTS) / per generation (SFX). A subscription tier includes a monthly
  character quota; overage is metered.

### Suno — music  (`SUNO_KEY`)
- **Get it:** from your Suno API provider dashboard.
- **Put it:** app settings (provider **Suno**) or `SUNO_KEY=…`. Optional: `SUNO_COST_CENTS`.
- **Cost:** per song/clip. Modest per generation, but a channel automation generating a track per piece
  adds up — keep it under the €-cap.

### Gemini — script writing · reference-video analysis  (`GEMINI_API_KEY`)
- **Get it:** <https://aistudio.google.com/app/apikey>.
- **Put it:** `GEMINI_API_KEY=…` (+ optional `GEMINI_MODEL`, default `gemini-2.5-flash`).
- **Cost:** per token, very cheap for scripts. This is the text lane (not media) — low risk.

### YouTube — publishing  (`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`)
- **Get it:** <https://console.cloud.google.com> → create an OAuth 2.0 Client (type: Web) with the
  **YouTube Data API v3 → `youtube.upload`** scope. Add your callback URL as an authorized redirect URI.
- **Put it:** `YOUTUBE_CLIENT_ID=…`, `YOUTUBE_CLIENT_SECRET=…`. Then connect the account (OAuth) — the
  per-workspace access token is stored **encrypted**.
- **Cost:** the API itself is free (quota-limited). Uploads post to your channel — **a bad AI video is
  public and hard to undo**, so posting is always behind the human **approve-before-publish** gate.

### TikTok — publishing  (`TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`)
- **Get it:** <https://developers.tiktok.com> → create an app → enable **Content Posting API**
  (`video.publish` scope) → add your redirect URI.
- **Put it:** `TIKTOK_CLIENT_KEY=…`, `TIKTOK_CLIENT_SECRET=…`, then connect (OAuth; token stored
  encrypted).
- **Cost:** free API; same approve-before-publish gate applies.

> **Instagram / LinkedIn** are designed-for but not built yet — the abstraction is ready; posting adapters
> land later.

---

## Rendering (no key — Docker)

The final video is assembled locally with **ffmpeg in a Docker container** (`WS_FFMPEG_IMAGE`, default
`jrottenberg/ffmpeg:latest`) — no hosted render API, no per-render cost. Rendered files + generated audio
are written under `data/media/` (`WS_MEDIA_DIR`) and streamed from `/media/<file>`. Make sure Docker is
available on the host.

---

## Recommended first run

1. Set `WORKSPACES_ENC_KEY` (boot requirement).
2. In **Content → Settings**, set a **€5 media budget cap**.
3. Add **`GEMINI_API_KEY`** (cheap) + **`FAL_KEY`** — generate a script + a few images on one piece.
4. Assemble → download the result. Confirm the spend shows on the **Insights** dashboard.
5. Only then add voice/music/video keys and, when you're ready to post, connect YouTube/TikTok.

Every generation asks you to confirm first, and every publish waits for your approval. Start small, watch
the budget, and scale up once you trust the output.
