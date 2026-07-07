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

export const realUploadTransport: PublishUploadTransport = {
  upload: async (platform, input) => {
    //? YouTube: the full 3-leg resumable upload (real bytes). TikTok: the single PULL_FROM_URL init (status
    //? polling + the confirmed url is D2). Instagram/LinkedIn have no builder (future-ready).
    if (platform === 'youtube') return youtubeResumableUpload(input);
    const res = await runJson(buildUploadRequest(platform, input));
    const o = (res !== null && typeof res === 'object' ? res : {}) as Record<string, unknown>;
    const publishId = (o.data as { publish_id?: unknown } | undefined)?.publish_id;
    const id = typeof publishId === 'string' ? publishId : '';
    if (id.length === 0) return null;
    return { externalUrl: `https://tiktok.com/@me/video/${id}` };
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
