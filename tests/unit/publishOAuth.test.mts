//? Unit test for the publishing OAuth + upload request builders (M5). Pure, no DB/network. Verifies the
//? authorize URL, the code→token exchange request, token-response parsing (flat + TikTok-nested), and the
//? YouTube/TikTok upload request shapes (bearer auth + the platform's body).

import { assert, eq, report } from '../_helpers.mts';

const { buildAuthUrl, buildExchangeRequest, parseTokenResponse, buildUploadRequest, buildRefreshRequest, isTokenExpired } =
  await import('../../server/content/publishOAuth.ts');

// 1) authorize URL
{
  process.env.YOUTUBE_CLIENT_ID = 'yt-client';
  const url = buildAuthUrl('youtube', { redirectUri: 'https://app/cb', state: 'st1' });
  assert(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'), 'youtube authorize endpoint');
  assert(url.includes('client_id=yt-client') && url.includes('state=st1') && url.includes('access_type=offline'), 'youtube params (offline for a refresh token)');
  assert(url.includes('scope=https') && url.includes('youtube.upload'), 'youtube upload scope');

  process.env.TIKTOK_CLIENT_KEY = 'tt-key';
  const tt = buildAuthUrl('tiktok', { redirectUri: 'https://app/cb', state: 's2' });
  assert(tt.includes('client_key=tt-key'), 'tiktok uses client_key (not client_id)');
  assert(tt.includes('scope=video.publish'), 'tiktok publish scope');
}

// 2) code→token exchange request
{
  process.env.YOUTUBE_CLIENT_ID = 'yt'; process.env.YOUTUBE_CLIENT_SECRET = 'sec';
  const req = buildExchangeRequest('youtube', { code: 'abc', redirectUri: 'https://app/cb' });
  eq(req.method, 'POST', 'exchange is POST');
  eq(req.url, 'https://oauth2.googleapis.com/token', 'youtube token endpoint');
  assert((req.body ?? '').includes('code=abc') && (req.body ?? '').includes('grant_type=authorization_code'), 'body carries the code + grant_type');
  assert((req.headers['Content-Type'] ?? '').includes('x-www-form-urlencoded'), 'form-encoded');
}

// 3) parseTokenResponse — flat, nested, missing
{
  const flat = parseTokenResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  assert(flat?.accessToken === 'AT' && flat.refreshToken === 'RT' && typeof flat.expiresAt === 'number', 'flat token response');
  const nested = parseTokenResponse({ data: { access_token: 'TT' } });
  eq(nested?.accessToken, 'TT', 'TikTok-nested token under data');
  eq(parseTokenResponse({ nope: 1 }), null, 'no access_token → null');
}

// 4) upload request shapes
{
  const yt = buildUploadRequest('youtube', { accessToken: 'AT', assetUrl: 'https://cdn/v.mp4', title: 'My video' });
  assert(yt.url.includes('googleapis.com/upload/youtube/v3/videos'), 'youtube upload endpoint');
  eq(yt.headers.Authorization, 'Bearer AT', 'bearer auth');
  assert((yt.body ?? '').includes('"title":"My video"') && (yt.body ?? '').includes('privacyStatus'), 'youtube snippet + status');

  const tt = buildUploadRequest('tiktok', { accessToken: 'AT', assetUrl: 'https://cdn/v.mp4', title: 'Clip' });
  assert(tt.url.includes('open.tiktokapis.com/v2/post/publish/video/init'), 'tiktok init endpoint');
  assert((tt.body ?? '').includes('PULL_FROM_URL') && (tt.body ?? '').includes('https://cdn/v.mp4'), 'tiktok pulls the video from the asset url');
}

// 4b) AI-disclosure (EU AI Act / platform policy) — the synthetic-media flag reaches BOTH payloads,
//     and its absence keeps the payload byte-identical to the pre-disclosure shape.
{
  const yt = buildUploadRequest('youtube', { accessToken: 'AT', assetUrl: 'https://cdn/v.mp4', title: 'V', variant: { syntheticMedia: true } });
  assert((yt.body ?? '').includes('"containsSyntheticMedia":true'), 'youtube status carries containsSyntheticMedia when disclosed');
  const ytOff = buildUploadRequest('youtube', { accessToken: 'AT', assetUrl: 'https://cdn/v.mp4', title: 'V' });
  assert(!(ytOff.body ?? '').includes('containsSyntheticMedia'), 'no disclosure → youtube payload unchanged');

  const tt = buildUploadRequest('tiktok', { accessToken: 'AT', assetUrl: 'https://cdn/v.mp4', title: 'C', variant: { syntheticMedia: true } });
  assert((tt.body ?? '').includes('"is_aigc":true'), 'tiktok post_info carries is_aigc when disclosed');
  const ttOff = buildUploadRequest('tiktok', { accessToken: 'AT', assetUrl: 'https://cdn/v.mp4', title: 'C', variant: { syntheticMedia: false } });
  assert(!(ttOff.body ?? '').includes('is_aigc'), 'explicit false → no aigc flag (manual checkbox semantics)');
}

// 5) F1 — refresh-token grant request shape + expiry check
{
  process.env.YOUTUBE_CLIENT_ID = 'yt'; process.env.YOUTUBE_CLIENT_SECRET = 'sec';
  const yt = buildRefreshRequest('youtube', 'RT-123');
  eq(yt.method, 'POST', 'refresh is POST');
  eq(yt.url, 'https://oauth2.googleapis.com/token', 'youtube token endpoint reused for refresh');
  assert((yt.body ?? '').includes('grant_type=refresh_token') && (yt.body ?? '').includes('refresh_token=RT-123'), 'youtube refresh grant + token');
  assert((yt.body ?? '').includes('client_id=yt'), 'youtube keys on client_id');

  process.env.TIKTOK_CLIENT_KEY = 'tt-key'; process.env.TIKTOK_CLIENT_SECRET = 'tt-sec';
  const tt = buildRefreshRequest('tiktok', 'RT-tt');
  eq(tt.url, 'https://open.tiktokapis.com/v2/oauth/token/', 'tiktok token endpoint reused for refresh');
  assert((tt.body ?? '').includes('client_key=tt-key') && (tt.body ?? '').includes('grant_type=refresh_token'), 'tiktok keys on client_key + refresh grant');

  const now = 1_000_000_000_000;
  assert(isTokenExpired({ accessToken: 'AT', expiresAt: now - 1 }, now), 'a lapsed token is expired');
  assert(isTokenExpired({ accessToken: 'AT', expiresAt: now + 30_000 }, now), 'within the 60s skew → treated as expired');
  assert(!isTokenExpired({ accessToken: 'AT', expiresAt: now + 3600_000 }, now), 'a fresh token is not expired');
  assert(!isTokenExpired({ accessToken: 'AT' }, now), 'a token with no expiresAt is treated as non-expiring');
}

report('tests/unit/publishOAuth.test.mts');
