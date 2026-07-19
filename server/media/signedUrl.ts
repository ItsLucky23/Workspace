//? F05 + F42 — signed, expiring media URLs.
//?
//? `/media/<uuid>` was authless by design: the uuid WAS the capability. That is indefinite, unrevocable
//? access to anything anyone ever guessed or was once shown — and it is what F05 flagged. But simply
//? requiring a session breaks the other half of the product: TikTok's `PULL_FROM_URL` fetches the asset
//? from OUR host with no cookie, YouTube does the same for a thumbnail, and a published page's `<img>` is
//? opened by a stranger. F05 and F42 pull in opposite directions.
//?
//? The resolution the owner picked: private by DEFAULT (session + workspace membership), plus a short-lived
//? HMAC signature that the publish path mints for exactly the assets it is about to hand to a platform.
//? A signature carries its own expiry, so access ends on its own instead of living forever in a URL.
//?
//? The key is derived from `WORKSPACES_ENC_KEY` (already required for secrets at rest), so there is no new
//? key to distribute — and rotating that key invalidates every outstanding link, which is the correct
//? blast radius for a compromise.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

//? Signature inputs live in the query string, so they must survive URL encoding untouched.
export interface MediaSignature { exp: number; sig: string }

function signingKey(): string {
  //? Deliberately derived, not read directly: the media key is a separate purpose from secret encryption,
  //? so a leaked media signature can never be replayed against the secret box.
  const base = process.env.WORKSPACES_ENC_KEY ?? '';
  return createHmac('sha256', base).update('media-url-signing-v1').digest('hex');
}

//? The signature covers the FILE NAME and the expiry — nothing else. Adding the workspace id here was
//? tempting, but a platform fetch has no workspace context to present, and binding to it would only
//? create a false sense of scoping.
export function signMediaName(name: string, exp: number): string {
  return createHmac('sha256', signingKey()).update(`${name}:${String(exp)}`).digest('hex').slice(0, 32);
}

//? Mint a signed, expiring link for one media file. `baseUrl` must be the PUBLIC origin — a platform
//? fetching this URL is not on our network, which is precisely why F42's relative `/media/...` failed.
export function signMediaUrl(url: string, baseUrl: string, ttlMs = DEFAULT_MEDIA_TTL_MS): string {
  if (!url.startsWith('/media/')) return url;
  const name = url.slice('/media/'.length);
  const exp = Date.now() + Math.max(60_000, ttlMs);
  const sig = signMediaName(name, exp);
  const origin = baseUrl.replace(/\/+$/, '');
  return `${origin}/media/${name}?exp=${String(exp)}&sig=${sig}`;
}

export type SignatureVerdict = 'valid' | 'missing' | 'expired' | 'invalid';

//? Verify a request's signature for a file name. Constant-time compare: a byte-by-byte early exit would
//? leak the signature one character at a time to anyone willing to retry.
export function verifyMediaSignature(name: string, exp: string | null, sig: string | null, now = Date.now()): SignatureVerdict {
  if (exp === null || sig === null || exp.length === 0 || sig.length === 0) return 'missing';
  const expMs = Number(exp);
  if (!Number.isFinite(expMs)) return 'invalid';
  if (expMs < now) return 'expired';
  const expected = signMediaName(name, expMs);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return 'invalid';
  return timingSafeEqual(a, b) ? 'valid' : 'invalid';
}

//? Parse `exp`/`sig` off a raw request URL (the route has no query parser at this phase).
export function readSignatureParams(rawUrl: string): { exp: string | null; sig: string | null } {
  const q = rawUrl.split('?')[1] ?? '';
  const params = new URLSearchParams(q);
  return { exp: params.get('exp'), sig: params.get('sig') };
}

//? The public origin a PLATFORM must be able to reach. The OAuth route derives this from the request, but
//? the scheduled-publish loop has no request — so this is the configured value, with the proxy's base
//? domain as the fallback. If neither is set we return '' and the caller keeps the relative URL: better an
//? honest failure than a link to `localhost` that a platform will silently reject.
export function publicMediaOrigin(): string {
  const explicit = (process.env.WS_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit.length > 0) return explicit;
  const domain = (process.env.WS_BASE_DOMAIN ?? '').trim();
  if (domain.length > 0 && domain !== 'localhost') return `https://${domain}`;
  return '';
}

//? A platform-fetchable URL for an asset: absolute + signed, or '' when this install has no public origin
//? configured (F42 — a relative `/media/...` is exactly what TikTok could never fetch).
export function platformFetchableUrl(assetUrl: string, ttlMs = DEFAULT_MEDIA_TTL_MS): string {
  if (!assetUrl.startsWith('/media/')) return assetUrl;
  const origin = publicMediaOrigin();
  if (origin.length === 0) return '';
  return signMediaUrl(assetUrl, origin, ttlMs);
}
