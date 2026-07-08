//? Publishing OAuth + upload (M5) — the REAL YouTube + TikTok connect + post code behind the B-23 gate.
//? The OAuth token is obtained via a standard code-exchange and stored ENCRYPTED (secretBox) in the
//? per-workspace EnvVar store; `publishAsset` uses it to run a real upload. The request BUILDERS are pure
//? + exported (unit-tested for the correct endpoints/headers/shape); the transports wrap them with fetch
//? (the live round-trip is the deferred post-keys e2e). Instagram/LinkedIn stay future-ready (no builder).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';
import { tryCatch } from '@luckystack/core';

import { encryptSecret, decryptSecret } from '../crypto/secretBox';
import { MEDIA_DIR } from '../media/store';
import { withRetry } from '../util/retry';

export type OAuthPlatform = 'youtube' | 'tiktok';

export interface StoredTokens { accessToken: string; refreshToken?: string; expiresAt?: number }
export interface HttpRequest { url: string; method: string; headers: Record<string, string>; body?: string }

//? Per-platform OAuth + API config (client id/secret from env; the endpoints are fixed).
interface PlatformCfg { authUrl: string; tokenUrl: string; uploadUrl: string; scope: string; clientIdEnv: string; clientSecretEnv: string }
const CFG: Record<OAuthPlatform, PlatformCfg> = {
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    uploadUrl: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    clientIdEnv: 'YOUTUBE_CLIENT_ID', clientSecretEnv: 'YOUTUBE_CLIENT_SECRET',
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    uploadUrl: 'https://open.tiktokapis.com/v2/post/publish/video/init/',
    scope: 'video.publish',
    clientIdEnv: 'TIKTOK_CLIENT_KEY', clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
  },
};

const env = (name: string): string => (process.env[name] ?? '').trim();

//? Build the OAuth authorize URL the user is redirected to (connect flow). Pure + exported.
export function buildAuthUrl(platform: OAuthPlatform, input: { redirectUri: string; state: string }): string {
  const cfg = CFG[platform];
  const idParam = platform === 'tiktok' ? 'client_key' : 'client_id';
  const params = new URLSearchParams({
    [idParam]: env(cfg.clientIdEnv), redirect_uri: input.redirectUri, response_type: 'code', scope: cfg.scope, state: input.state,
    ...(platform === 'youtube' ? { access_type: 'offline', prompt: 'consent' } : {}),
  });
  return `${cfg.authUrl}?${params.toString()}`;
}

//? Build the code→token exchange request. Pure + exported.
export function buildExchangeRequest(platform: OAuthPlatform, input: { code: string; redirectUri: string }): HttpRequest {
  const cfg = CFG[platform];
  const idKey = platform === 'tiktok' ? 'client_key' : 'client_id';
  const body = new URLSearchParams({
    [idKey]: env(cfg.clientIdEnv), client_secret: env(cfg.clientSecretEnv), code: input.code,
    grant_type: 'authorization_code', redirect_uri: input.redirectUri,
  });
  return { url: cfg.tokenUrl, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() };
}

//? F1 — build the refresh-token grant (both providers reuse their token endpoint with grant_type=refresh_token;
//? Google keys on client_id, TikTok on client_key). Pure + exported. The audit found stored refresh tokens were
//? never used, so any post >~1h after connect (incl. every scheduled post) failed silently — this closes it.
export function buildRefreshRequest(platform: OAuthPlatform, refreshToken: string): HttpRequest {
  const cfg = CFG[platform];
  const idKey = platform === 'tiktok' ? 'client_key' : 'client_id';
  const body = new URLSearchParams({
    [idKey]: env(cfg.clientIdEnv), client_secret: env(cfg.clientSecretEnv),
    grant_type: 'refresh_token', refresh_token: refreshToken,
  });
  return { url: cfg.tokenUrl, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() };
}

//? Parse a token response (both providers return access_token/refresh_token/expires_in, TikTok nests
//? some under `data`). Pure + exported. Returns null when no access token is present.
export function parseTokenResponse(json: unknown): StoredTokens | null {
  if (json === null || typeof json !== 'object') return null;
  const top = json as Record<string, unknown>;
  const data = (top.data !== null && typeof top.data === 'object' ? top.data : top) as Record<string, unknown>;
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (accessToken.length === 0) return null;
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : undefined;
  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : undefined;
  return { accessToken, ...(refreshToken === undefined ? {} : { refreshToken }), ...(expiresInSec === undefined ? {} : { expiresAt: Date.now() + expiresInSec * 1000 }) };
}

//? O2 — a normalized per-platform privacy choice + the mappers to each platform's own vocabulary. TikTok has
//? no "unlisted", so it collapses to SELF_ONLY. Pure + exported.
export type PublishPrivacy = 'public' | 'unlisted' | 'private';
export interface PublishVariant { caption?: string; hashtags?: string[]; privacy?: PublishPrivacy }
const YT_PRIVACY: Record<PublishPrivacy, string> = { public: 'public', unlisted: 'unlisted', private: 'private' };
const TT_PRIVACY: Record<PublishPrivacy, string> = { public: 'PUBLIC_TO_EVERYONE', unlisted: 'SELF_ONLY', private: 'SELF_ONLY' };

//? Compose the post caption from a base title + an optional override caption + hashtags (each '#'-prefixed).
export function composeCaption(title: string, variant?: PublishVariant | null): string {
  const base = (variant?.caption ?? '').trim() || title;
  const tags = (variant?.hashtags ?? []).map((t) => t.trim()).filter((t) => t.length > 0).map((t) => (t.startsWith('#') ? t : `#${t}`));
  return tags.length > 0 ? `${base}\n\n${tags.join(' ')}` : base;
}

//? Build the video upload request (auth-bearer + the platform's init/upload endpoint). Pure + exported.
//? (YouTube resumable + TikTok init are multi-step; this is the initiating request whose shape we assert.)
//? O2 — an optional per-platform `variant` drives the caption/description + privacy; defaults preserve the
//? prior behaviour (title-only, private).
export function buildUploadRequest(platform: OAuthPlatform, input: { accessToken: string; assetUrl: string; title: string; variant?: PublishVariant | null }): HttpRequest {
  const cfg = CFG[platform];
  const caption = composeCaption(input.title, input.variant);
  const privacy = input.variant?.privacy ?? 'private';
  if (platform === 'youtube') {
    return {
      url: cfg.uploadUrl, method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'video/*' },
      body: JSON.stringify({ snippet: { title: input.title, description: caption }, status: { privacyStatus: YT_PRIVACY[privacy] } }),
    };
  }
  return {
    url: cfg.uploadUrl, method: 'POST',
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_info: { title: caption, privacy_level: TT_PRIVACY[privacy] }, source_info: { source: 'PULL_FROM_URL', video_url: input.assetUrl } }),
  };
}

//? D1 — the SECOND leg of YouTube's resumable upload: PUT the actual video bytes to the session URI the init
//? request returned in its `Location` header. Pure builder (the transport attaches the byte body). The audit
//? found the upload only ever did the init leg (reading a non-existent `id` from an empty body) → this closes
//? the gap. Exported for tests.
export function buildResumablePut(sessionUri: string, accessToken: string, contentType = 'video/*'): HttpRequest {
  return { url: sessionUri, method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentType } };
}

//? D2 — TikTok publishes asynchronously: the init returns a `publish_id`, and the post only exists once the
//? status endpoint reports PUBLISH_COMPLETE. Pure builder for that status poll. Exported for tests.
const TIKTOK_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
export function buildTiktokStatusRequest(publishId: string, accessToken: string): HttpRequest {
  return { url: TIKTOK_STATUS_URL, method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ publish_id: publishId }) };
}

//? D2 — parse a TikTok status response → the processing status + (once available) the public post id. Pure +
//? exported. `status` is TikTok's enum (PROCESSING_UPLOAD | PUBLISH_COMPLETE | FAILED | …).
export function parseTiktokStatus(json: unknown): { status: string; postId: string } {
  const top = (json !== null && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const data = (top.data !== null && typeof top.data === 'object' ? top.data : {}) as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : '';
  const ids: unknown[] = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id : [];
  const first: unknown = ids[0];
  const postId = typeof first === 'string' || typeof first === 'number' ? String(first) : '';
  return { status, postId };
}

//? Read a publishable asset's bytes: a local `/media/<file>` from the media store, or an http(s) URL. A
//? `stub://`/unknown url yields null (not uploadable). Used by the real YouTube byte-upload.
async function readAssetBytes(assetUrl: string): Promise<Buffer | null> {
  if (assetUrl.startsWith('/media/')) {
    const p = path.join(MEDIA_DIR, assetUrl.slice('/media/'.length));
    return existsSync(p) ? readFileSync(p) : null;
  }
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    const [err, buf] = await tryCatch(() => withRetry(async () => {
      //? External asset host — not a framework `/api/*` route.
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(assetUrl);
      if (!r.ok) throw new Error(`asset ${String(r.status)}`);
      return Buffer.from(await r.arrayBuffer());
    }, { attempts: 3, baseMs: 400 }));
    return err ? null : (buf ?? null);
  }
  return null;
}

// --- transports (injectable) ---------------------------------------------------

export interface OAuthTransport { exchange: (platform: OAuthPlatform, input: { code: string; redirectUri: string }) => Promise<StoredTokens | null> }
export interface OAuthRefreshTransport { refresh: (platform: OAuthPlatform, refreshToken: string) => Promise<StoredTokens | null> }
export interface PublishUploadTransport { upload: (platform: OAuthPlatform, input: { accessToken: string; assetUrl: string; title: string; variant?: PublishVariant | null }) => Promise<{ externalUrl: string } | null> }

//? Run a pure-built HttpRequest and return the parsed JSON.
async function runJson(reqShape: HttpRequest): Promise<unknown> {
  return withRetry(async () => {
    //? External OAuth/platform API — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const r = await fetch(reqShape.url, { method: reqShape.method, headers: reqShape.headers, ...(reqShape.body === undefined ? {} : { body: reqShape.body }) });
    if (!r.ok) throw new Error(`oauth ${String(r.status)}`);
    const json: unknown = await r.json();
    return json;
  }, { attempts: 3, baseMs: 400 });
}

export const realOAuthTransport: OAuthTransport = {
  exchange: async (platform, input) => parseTokenResponse(await runJson(buildExchangeRequest(platform, input))),
};

//? F1 — the REAL refresh transport: run the refresh grant + parse the new tokens.
export const realRefreshTransport: OAuthRefreshTransport = {
  refresh: async (platform, refreshToken) => parseTokenResponse(await runJson(buildRefreshRequest(platform, refreshToken))),
};

//? D1 — the REAL YouTube resumable upload, all three legs: (1) POST the metadata → read the session URI from
//? the `Location` header; (2) read the video bytes; (3) PUT the bytes to the session URI → read the video id.
//? Previously only leg 1 ran, so a real upload always failed. Returns null on any leg failing (→ honest error).
async function youtubeResumableUpload(input: { accessToken: string; assetUrl: string; title: string; variant?: PublishVariant | null }): Promise<{ externalUrl: string } | null> {
  const initReq = buildUploadRequest('youtube', input);
  const [initErr, sessionUri] = await tryCatch(() => withRetry(async () => {
    //? External platform API — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const r = await fetch(initReq.url, { method: initReq.method, headers: initReq.headers, ...(initReq.body === undefined ? {} : { body: initReq.body }) });
    if (!r.ok) throw new Error(`youtube init ${String(r.status)}`);
    const loc = r.headers.get('location');
    if (loc === null || loc.length === 0) throw new Error('youtube init: no session uri');
    return loc;
  }, { attempts: 3, baseMs: 400 }));
  if (initErr || !sessionUri) return null;
  const bytes = await readAssetBytes(input.assetUrl);
  if (bytes === null) return null;
  const putReq = buildResumablePut(sessionUri, input.accessToken);
  const [putErr, id] = await tryCatch(() => withRetry(async () => {
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const r = await fetch(putReq.url, { method: putReq.method, headers: putReq.headers, body: bytes });
    if (!r.ok) throw new Error(`youtube put ${String(r.status)}`);
    const json = (await r.json()) as { id?: unknown };
    return typeof json.id === 'string' ? json.id : '';
  }, { attempts: 3, baseMs: 400 }));
  if (putErr || !id) return null;
  return { externalUrl: `https://youtube.com/watch?v=${id}` };
}

//? D2 — the real TikTok publish: init (PULL_FROM_URL) → `publish_id`, then POLL the status endpoint until it is
//? PUBLISH_COMPLETE and build the url from the confirmed post id. Returns null if it FAILs or is not confirmed
//? within the poll window (→ honest error, never a fabricated url like the pre-D2 code returned). `sleep` is
//? injectable so a live poll waits between attempts without blocking tests (which inject the whole transport).
const TIKTOK_POLL_ATTEMPTS = 6;
async function tiktokUpload(input: { accessToken: string; assetUrl: string; title: string; variant?: PublishVariant | null }, sleepMs: (ms: number) => Promise<void>): Promise<{ externalUrl: string } | null> {
  const initRes = await runJson(buildUploadRequest('tiktok', input));
  const o = (initRes !== null && typeof initRes === 'object' ? initRes : {}) as Record<string, unknown>;
  const publishIdRaw = (o.data as { publish_id?: unknown } | undefined)?.publish_id;
  const publishId = typeof publishIdRaw === 'string' ? publishIdRaw : '';
  if (publishId.length === 0) return null;
  for (let attempt = 0; attempt < TIKTOK_POLL_ATTEMPTS; attempt++) {
    const [, statusRes] = await tryCatch(() => runJson(buildTiktokStatusRequest(publishId, input.accessToken)));
    const { status, postId } = parseTiktokStatus(statusRes ?? null);
    if (status === 'PUBLISH_COMPLETE') return { externalUrl: `https://tiktok.com/@me/video/${postId.length > 0 ? postId : publishId}` };
    if (status === 'FAILED') return null;
    await sleepMs(3000);
  }
  return null; // not confirmed within the window — do not fabricate a url
}

export const realUploadTransport: PublishUploadTransport = {
  upload: async (platform, input) => {
    //? YouTube: the full 3-leg resumable upload (real bytes). TikTok: init + status-poll until confirmed.
    //? Instagram/LinkedIn have no builder (future-ready).
    if (platform === 'youtube') return youtubeResumableUpload(input);
    return tiktokUpload(input, (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  },
};

// --- token store (EnvVar, encrypted) ------------------------------------------

const tokenKey = (platform: OAuthPlatform): string => `__publish_${platform}`;

//? Persist the OAuth tokens ENCRYPTED in the per-workspace EnvVar store (secretBox). Upsert by key.
export async function saveConnection(prisma: PrismaClient, workspaceId: string, platform: OAuthPlatform, tokens: StoredTokens): Promise<void> {
  const value = encryptSecret(JSON.stringify(tokens));
  await prisma.envVar.upsert({
    where: { workspaceId_key: { workspaceId, key: tokenKey(platform) } },
    create: { workspaceId, key: tokenKey(platform), value, secret: true },
    update: { value },
  });
}

//? Read + decrypt the stored OAuth tokens for a platform (null when not connected).
export async function getConnection(prisma: PrismaClient, workspaceId: string, platform: OAuthPlatform): Promise<StoredTokens | null> {
  const row = await prisma.envVar.findFirst({ where: { workspaceId, key: tokenKey(platform) } });
  if (!row) return null;
  const dec = decryptSecret(row.value);
  if (dec === null) return null;
  const [err, parsed] = await tryCatch(() => Promise.resolve(JSON.parse(dec) as StoredTokens));
  if (err || !parsed || typeof parsed.accessToken !== 'string') return null;
  return parsed;
}

//? F1 — a token is expired (or about to be) when its `expiresAt` is within the skew window of now. A token with
//? no `expiresAt` is treated as non-expiring (we only refresh when we know it lapsed). Pure + exported.
const REFRESH_SKEW_MS = 60_000;
export function isTokenExpired(tokens: StoredTokens, now: number, skewMs = REFRESH_SKEW_MS): boolean {
  return typeof tokens.expiresAt === 'number' && tokens.expiresAt - skewMs <= now;
}

//? F1 — return a USABLE connection: the stored tokens, transparently refreshed when expired. If the tokens are
//? expired AND a refresh token exists, run the refresh grant, persist the new tokens re-encrypted, and return
//? them; a Google refresh omits a new refresh_token, so the old one is preserved. If the refresh fails we return
//? the stale tokens (the upload then errors honestly — never a fabricated success). Refresh transport injectable.
export async function getValidConnection(
  prisma: PrismaClient, workspaceId: string, platform: OAuthPlatform,
  opts: { refreshTransport?: OAuthRefreshTransport; now?: number } = {},
): Promise<StoredTokens | null> {
  const stored = await getConnection(prisma, workspaceId, platform);
  if (!stored) return null;
  const now = opts.now ?? Date.now();
  const refreshToken = stored.refreshToken;
  if (!isTokenExpired(stored, now) || refreshToken === undefined || refreshToken.length === 0) return stored;
  const transport = opts.refreshTransport ?? realRefreshTransport;
  const [err, refreshed] = await tryCatch(() => transport.refresh(platform, refreshToken));
  if (err || !refreshed) return stored;
  const merged: StoredTokens = { ...refreshed, refreshToken: refreshed.refreshToken ?? refreshToken };
  await saveConnection(prisma, workspaceId, platform, merged);
  return merged;
}

//? Complete a connect: exchange the OAuth code for tokens + store them encrypted. Returns ok.
export async function connectPublishPlatform(
  prisma: PrismaClient, workspaceId: string, platform: OAuthPlatform,
  input: { code: string; redirectUri: string }, opts: { transport?: OAuthTransport } = {},
): Promise<{ ok: boolean; error?: string }> {
  const transport = opts.transport ?? realOAuthTransport;
  const [err, tokens] = await tryCatch(() => transport.exchange(platform, input));
  if (err || !tokens) return { ok: false, error: `publish.oauthFailed: ${err?.message ?? 'no-token'}` };
  await saveConnection(prisma, workspaceId, platform, tokens);
  return { ok: true };
}
