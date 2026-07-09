//? C3 — the audience-metrics parsers + helpers (pure). Verifies YouTube/TikTok stats parsing (string+number
//? tolerant), the post-id extraction from an external url, and the top-performers ranking the ideator feeds on.

import { assert, eq, report } from '../_helpers.mts';
import { parseYouTubeMetrics, parseTiktokMetrics, parsePlatformMetrics, extractExternalId, topPerformers } from '../../server/content/publishMetrics.ts';

// YouTube stats (strings, as the API returns)
{
  const m = parseYouTubeMetrics({ items: [{ statistics: { viewCount: '1200', likeCount: '80', commentCount: '9' } }] });
  eq(m.views, 1200, 'youtube views'); eq(m.likes, 80, 'youtube likes'); eq(m.comments, 9, 'youtube comments');
  eq(parseYouTubeMetrics({}).views, 0, 'missing stats → 0');
}

// TikTok stats (numbers)
{
  const m = parseTiktokMetrics({ data: { videos: [{ view_count: 5000, like_count: 300, comment_count: 20, share_count: 15 }] } });
  eq(m.views, 5000, 'tiktok views'); eq(m.shares, 15, 'tiktok shares');
  eq(parsePlatformMetrics('tiktok', { data: { videos: [{ view_count: 7 }] } }).views, 7, 'parsePlatformMetrics routes to tiktok');
}

// external id extraction
eq(extractExternalId('youtube', 'https://youtube.com/watch?v=ABC123'), 'ABC123', 'youtube watch?v → id');
eq(extractExternalId('tiktok', 'https://tiktok.com/@me/video/998877'), '998877', 'tiktok /video/ → id');
eq(extractExternalId('youtube', 'stub://youtube/x'), '', 'a stub url has no external id');
eq(extractExternalId('instagram', 'https://x/y'), '', 'an unsupported platform → empty');

// top performers: ranked by views, zero-view filtered, capped
{
  const rows = [
    { platform: 'youtube', title: 'A', metrics: { views: 100 } },
    { platform: 'tiktok', title: 'B', metrics: { views: 5000 } },
    { platform: 'youtube', title: 'C', metrics: { views: 0 } },
    { platform: 'youtube', title: 'D', metrics: null },
  ];
  const top = topPerformers(rows, 2);
  eq(top.length, 2, 'top-2 kept');
  eq(top[0].title, 'B', 'highest views first');
  eq(top[1].title, 'A', 'then the next');
  assert(!top.some((t) => t.title === 'C' || t.title === 'D'), 'zero/absent-metric pieces are excluded');
}

report('tests/unit/publishMetrics.test.mts');
