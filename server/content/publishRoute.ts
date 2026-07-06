//? Publishing OAuth connect routes (FIX-C, ADR 0092) — the two HTTP endpoints that make the
//? server-complete YouTube/TikTok publishing (M5, ADR 0083) REACHABLE from the app:
//?   GET /content/oauth/<platform>/start?ws=<workspaceId>  → (authed + member) 302 to the platform consent
//?   GET /content/oauth/<platform>/callback?code&state     → exchange the code + store the token, 302 back
//? The `state` is an encrypted {workspaceId,userId,platform,exp} blob (secretBox) → CSRF-safe AND it
//? carries the workspace across the external round-trip. The callback stores the user's OWN OAuth
//? credential (not AI-proposed authoritative state), so it writes directly — B-23 governs the AI→board/git
//? write path, and publishing itself still goes through the B-23 gate (content-request-publish → accept).

import { readSession, getPrismaClient, tryCatch, tryCatchSync } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import { encryptSecret, decryptSecret } from '../crypto/secretBox';
import { hasCapability, CAP } from '../control/rbac';
import { buildAuthUrl, connectPublishPlatform, type OAuthPlatform } from './publishOAuth';

export const OAUTH_PREFIX = '/content/oauth/';
const PLATFORMS: OAuthPlatform[] = ['youtube', 'tiktok'];
const STATE_TTL_MS = 10 * 60 * 1000;

const isPlatform = (s: string): s is OAuthPlatform => (PLATFORMS as string[]).includes(s);

interface OAuthState { workspaceId: string; userId: string; platform: OAuthPlatform; exp: number }

interface HttpReq { url?: string; headers: Record<string, string | string[] | undefined> }
interface HttpRes { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void }

const firstHeader = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

//? Public base url of THIS backend (must match the registered OAuth app's redirect). `WS_PUBLIC_URL`
//? wins (explicit, stable); otherwise derive from the forwarded host so it works in dev without config.
function publicBase(req: HttpReq): string {
  const explicit = (process.env.WS_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit.length > 0) return explicit;
  const fwdHost = firstHeader(req.headers['x-forwarded-host']);
  const hostHeader = firstHeader(req.headers.host);
  const hostPart = (fwdHost.length > 0 ? fwdHost : hostHeader).split(':')[0] ?? '';
  const host = hostPart.length > 0 ? hostPart : 'localhost';
  const fwdProto = firstHeader(req.headers['x-forwarded-proto']);
  const proto = fwdProto.length > 0 ? fwdProto : (host === 'localhost' || host.startsWith('127.') ? 'http' : 'https');
  const port = hostHeader.split(':')[1] ?? '';
  return `${proto}://${host}${port.length > 0 && host === 'localhost' ? `:${port}` : ''}`;
}

//? Encrypt/decrypt the CSRF state that survives the external round-trip. Exported for the unit test.
export function encodeOAuthState(state: OAuthState): string {
  return encodeURIComponent(encryptSecret(JSON.stringify(state)));
}
export function decodeOAuthState(raw: string): OAuthState | null {
  const [decodeErr, parsed] = tryCatchSync(() => {
    const dec = decryptSecret(decodeURIComponent(raw));
    if (dec === null) return null;
    return JSON.parse(dec) as OAuthState;
  });
  if (decodeErr || !parsed || typeof parsed.workspaceId !== 'string' || !isPlatform(parsed.platform) || typeof parsed.exp !== 'number') return null;
  return parsed;
}

const redirect = (res: HttpRes, url: string): void => { res.statusCode = 302; res.setHeader('Location', url); res.end(); };
const send = (res: HttpRes, code: number, msg: string): void => { res.statusCode = code; res.setHeader('Content-Type', 'text/plain'); res.end(msg); };

//? Register the connect + callback routes (call once at boot). Origin-exempt: the callback is an external
//? redirect from Google/TikTok (no Origin header); the `start` leg is session-authed + membership-gated.
export function registerPublishOAuthRoutes(): void {
  registerOriginExemptPath({ pathPrefix: OAUTH_PREFIX });
  registerCustomRoute(async (req, res, ctx) => {
    const url = req.url ?? '';
    const path = (url.split('?')[0] ?? '').replace(/\/+$/, '');
    if (!path.startsWith(OAUTH_PREFIX)) return false;
    const [platform, leg] = path.slice(OAUTH_PREFIX.length).split('/');
    if (!platform || !isPlatform(platform)) { send(res, 400, 'bad platform'); return true; }
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    const appSettings = `${publicBase(req)}/content/settings`;
    const redirectUri = `${publicBase(req)}${OAUTH_PREFIX}${platform}/callback`;

    if (leg === 'start') {
      const session = await readSession(ctx.token);
      if (!session) { send(res, 401, 'unauthorized'); return true; }
      const workspaceId = query.get('ws') ?? '';
      if (workspaceId.length === 0) { send(res, 400, 'missing workspace'); return true; }
      const member = await hasCapability(getPrismaClient(), workspaceId, session.id, CAP.workspaceSettings);
      if (!member) { send(res, 403, 'forbidden'); return true; }
      const state = encodeOAuthState({ workspaceId, userId: session.id, platform, exp: Date.now() + STATE_TTL_MS });
      redirect(res, buildAuthUrl(platform, { redirectUri, state }));
      return true;
    }

    if (leg === 'callback') {
      const code = query.get('code') ?? '';
      const state = decodeOAuthState(query.get('state') ?? '');
      if (!state) { redirect(res, `${appSettings}?connected=error`); return true; }
      if (code.length === 0 || state.platform !== platform || state.exp < Date.now()) { redirect(res, `${appSettings}?connected=error`); return true; }
      const [err, result] = await tryCatch(() => connectPublishPlatform(getPrismaClient(), state.workspaceId, platform, { code, redirectUri }));
      redirect(res, `${appSettings}?connected=${!err && result?.ok === true ? platform : 'error'}`);
      return true;
    }

    send(res, 404, 'not found');
    return true;
  }, { phase: 'pre-params' });
}
