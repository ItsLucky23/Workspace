//? Unit test for the publishing OAuth + upload request builders (M5). Pure, no DB/network. Verifies the
//? authorize URL, the code→token exchange request, token-response parsing (flat + TikTok-nested), and the
//? YouTube/TikTok upload request shapes (bearer auth + the platform's body).

import { assert, eq, report } from '../_helpers.mts';

const { buildAuthUrl, buildExchangeRequest, parseTokenResponse, buildUploadRequest } =
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

report('tests/unit/publishOAuth.test.mts');
