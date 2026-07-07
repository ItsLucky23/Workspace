//? Unit test for D1 (IDEA_TO_OUTCOME) — the YouTube resumable-upload request builders. Pure. The audit found
//? the upload only ever did the init leg; this asserts BOTH legs are shaped correctly: (1) the resumable init
//? (metadata + the X-Upload-Content-Type header that makes YouTube return a session URI), and (2) the PUT to
//? that session URI where the bytes actually go. The live round-trip is the opt-in post-keys e2e.

import { assert, eq, report } from '../_helpers.mts';
import { buildUploadRequest, buildResumablePut } from '../../server/content/publishOAuth';

try {
  //? Leg 1 — the resumable INIT.
  const init = buildUploadRequest('youtube', { accessToken: 'tok', assetUrl: '/media/out.mp4', title: 'My video' });
  assert(init.url.includes('uploadType=resumable'), 'the init hits the resumable endpoint');
  eq(init.method, 'POST', 'the init is a POST');
  eq(init.headers.Authorization, 'Bearer tok', 'the init is bearer-authed');
  eq(init.headers['X-Upload-Content-Type'], 'video/*', 'the init declares the upload content type (→ YouTube returns a session URI)');
  const initBody = JSON.parse(init.body ?? '{}') as { snippet?: { title?: string }; status?: { privacyStatus?: string } };
  eq(initBody.snippet?.title, 'My video', 'the metadata carries the title');
  eq(initBody.status?.privacyStatus, 'private', 'defaults to private');

  //? A privacy variant flows through.
  const pub = buildUploadRequest('youtube', { accessToken: 'tok', assetUrl: '/media/out.mp4', title: 'T', variant: { privacy: 'public' } });
  eq((JSON.parse(pub.body ?? '{}') as { status?: { privacyStatus?: string } }).status?.privacyStatus, 'public', 'a public variant sets privacyStatus public');

  //? Leg 2 — the PUT of the bytes to the session URI returned by leg 1.
  const put = buildResumablePut('https://upload.example/session/abc123', 'tok');
  eq(put.url, 'https://upload.example/session/abc123', 'the PUT targets the session URI (not the init endpoint)');
  eq(put.method, 'PUT', 'the bytes go via PUT');
  eq(put.headers.Authorization, 'Bearer tok', 'the PUT is bearer-authed');
  eq(put.headers['Content-Type'], 'video/*', 'the PUT declares the video content type');
  assert(put.body === undefined, 'the builder leaves the byte body to the transport (pure shape)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/youtubeUpload.test.mts');
