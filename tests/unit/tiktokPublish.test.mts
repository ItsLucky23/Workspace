//? Unit test for D2 (IDEA_TO_OUTCOME) — TikTok async publish: the status-poll request builder + the status
//? parser. Pure. TikTok posts asynchronously, so the confirmed url only exists after the status endpoint
//? reports PUBLISH_COMPLETE; the transport polls until then (live). The pre-D2 code fabricated a url from the
//? publish_id with no confirmation — this locks down the real shape.

import { assert, eq, report } from '../_helpers.mts';
import { buildTiktokStatusRequest, parseTiktokStatus } from '../../server/content/publishOAuth';

try {
  //? The status poll request.
  const req = buildTiktokStatusRequest('pub_123', 'tok');
  assert(req.url.includes('/post/publish/status/fetch/'), 'the poll hits the status endpoint');
  eq(req.method, 'POST', 'the status poll is a POST');
  eq(req.headers.Authorization, 'Bearer tok', 'the poll is bearer-authed');
  eq((JSON.parse(req.body ?? '{}') as { publish_id?: string }).publish_id, 'pub_123', 'the poll carries the publish_id');

  //? A completed publish → the confirmed public post id.
  const done = parseTiktokStatus({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7_123_456] } });
  eq(done.status, 'PUBLISH_COMPLETE', 'a completed status is read');
  eq(done.postId, '7123456', 'the confirmed public post id is extracted (as a string)');

  //? Still processing → status, no post id yet.
  const processing = parseTiktokStatus({ data: { status: 'PROCESSING_UPLOAD' } });
  eq(processing.status, 'PROCESSING_UPLOAD', 'a processing status is read');
  eq(processing.postId, '', 'no post id while still processing');

  //? A failure is surfaced (the transport returns null on this).
  eq(parseTiktokStatus({ data: { status: 'FAILED' } }).status, 'FAILED', 'a failed status is read');

  //? Malformed / empty → empty (never throws).
  eq(parseTiktokStatus(null).status, '', 'null → empty status');
  eq(parseTiktokStatus({}).status, '', 'no data → empty status');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/tiktokPublish.test.mts');
