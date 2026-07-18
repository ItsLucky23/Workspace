//? GAP_SCAN Phase F — the pure halves of the content-depth tranche: the thumbnail composite (F1), caption
//? styling / word-reveal / dub muxing (F2), the SEO scorer (F3), metric trends + A/B (F4) and the community
//? sentiment/theme layer (F5).

import { buildThumbnailPlan, wrapHeadline, escapeDrawText, buildThumbnailUploadRequest, THUMB_WIDTH } from '../../server/content/thumbnail.ts';
import { toAssColor, buildForceStyle, buildStyledCaptionArgs, buildWordCues, buildDubMuxArgs } from '../../server/content/captionStyle.ts';
import { scoreTitle, deriveTags, evidenceBlock, parseSeoSuggestion } from '../../server/content/seo.ts';
import { buildMetricTrend, compareVariants } from '../../server/content/publishMetrics.ts';
import { classifySentiment, summarizeSentiment, extractThemes, buildReplyRequest } from '../../server/content/commentActions.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ F1: thumbnails */

eq(wrapHeadline('one two three four five six seven eight nine ten'), ['one two three four', 'five six seven', 'eight nine ten'], 'a headline wraps onto readable lines');
eq(wrapHeadline(''), [], 'an empty headline yields no lines');
eq(wrapHeadline('word '.repeat(60)).length, 3, 'a very long headline is capped at 3 lines');

//? The escaping is the security-relevant part: drawtext is a mini-language, and a colon or quote in a
//? user-authored title would otherwise change the filter itself.
assert(escapeDrawText('Time: 10:30').includes(String.raw`\:`), 'colons are escaped for drawtext');
assert(!escapeDrawText("it's here").includes("'"), 'straight quotes cannot terminate the filter argument');
assert(escapeDrawText('100% done').includes(String.raw`\%`), 'percent signs are escaped');
eq(escapeDrawText('a\nb'), 'a b', 'newlines are flattened');

const plain = buildThumbnailPlan({ headline: 'Ship it faster' });
assert(plain.includes('-filter_complex'), 'the plan is a filtergraph');
assert(plain.some((a) => a.includes('color=c=0x101014')), 'with no background it renders on a solid colour (free, no key)');
assert(plain.some((a) => a.includes(`scale=${String(THUMB_WIDTH)}`)), 'and scales to thumbnail size');
assert(plain.at(-1) === '/data/thumb.jpg', 'it writes a single jpg');

const withBg = buildThumbnailPlan({ headline: 'Ship it', backgroundFile: 'bg.png', logoFile: 'logo.png' });
assert(withBg.includes('/data/bg.png'), 'a background image is used when supplied');
assert(withBg.some((a) => a.includes('overlay=')), 'a logo is overlaid');
assert(withBg.every((a) => !a.includes('..')), 'no path traversal reaches the container args');

eq(buildThumbnailUploadRequest('tiktok', 'abc', 'tok'), null, 'TikTok has no public cover endpoint — honest null, not a fake success');
eq(buildThumbnailUploadRequest('youtube', '', 'tok'), null, 'no post id → no request');
const thumbReq = buildThumbnailUploadRequest('youtube', 'vid123', 'tok');
assert(thumbReq?.url.includes('videoId=vid123') === true, 'YouTube sets the thumbnail on the right video');
eq(thumbReq?.headers['Content-Type'], 'image/jpeg', 'as a jpeg upload');

/* ------------------------------------------------------------ F2: captions + dub */

eq(toAssColor('ff0000'), '&H0000FF', 'libass colours are byte-reversed (the classic wrong-colour bug)');
eq(toAssColor('#00ff00'), '&H00FF00', 'a leading # is tolerated');
const style = buildForceStyle({ fontSize: 32, color: 'ffff00', boxed: true });
assert(style.includes('FontSize=32'), 'the style carries the size');
assert(style.includes('BorderStyle=3'), 'boxed captions use the opaque band');
assert(buildForceStyle({ fontName: 'Bad,Font' }).split(',').filter((p) => p.startsWith('FontName')).length === 1, 'a comma in a font name cannot inject extra style fields');
assert(!buildForceStyle({ fontName: "x'y" }).includes("'"), 'a quote cannot terminate the filter argument');

const styled = buildStyledCaptionArgs('in.mp4', 'cc.srt', 'out.mp4', { fontSize: 30 });
assert(styled.some((a) => a.includes('force_style=')), 'the styled pass applies force_style');
assert(styled.includes('/media/out.mp4'), 'and writes the styled output');

const cues = buildWordCues([{ text: 'hello brave new world', startMs: 0, durationMs: 1000 }]);
eq(cues.length, 4, 'one cue per word');
eq(cues[0]?.text, 'hello', 'the first cue shows the first word');
eq(cues.at(-1)?.text, 'hello brave new world', 'cues accumulate (a lone word reads as flicker)');
eq(cues[0]?.startMs, 0, 'timing starts at the segment start');
eq(cues.at(-1)!.startMs + cues.at(-1)!.durationMs, 1000, 'and ends exactly on the segment boundary (no drift)');
eq(buildWordCues([{ text: '   ', startMs: 0, durationMs: 500 }]), [], 'a blank segment produces no cues');

const dub = buildDubMuxArgs('in.mp4', 'nl.mp3', 'out.mp4', 'Dutch');
assert(dub.includes('-map') && dub.includes('1:a'), 'the dub track is muxed in');
assert(dub.some((a) => a.startsWith('language=')), 'and tagged with its language');
assert(dub.includes('copy'), 'video is stream-copied — a dub never re-encodes the picture');

/* ------------------------------------------------------------ F3: SEO */

eq(scoreTitle('').score, 0, 'an empty title scores zero');
const weak = scoreTitle('the video about stuff');
assert(weak.issues.includes('seo.weakOpener'), 'a filler opener is flagged');
assert(weak.issues.includes('seo.noHook'), 'a title with no hook is flagged');
const strong = scoreTitle('7 mistakes killing your first app');
assert(strong.score > weak.score, 'a concrete, hooked title scores higher than a vague one');
assert(strong.issues.length < weak.issues.length, 'and carries fewer issues');
assert(scoreTitle('THIS IS ABSOLUTELY INSANE').issues.includes('seo.shouting'), 'ALL CAPS is flagged as shouting');
assert(scoreTitle('x'.repeat(80)).issues.includes('seo.tooLong'), 'over-long titles are flagged');
assert(scoreTitle('3 tips', 'tiktok').issues.includes('seo.tooShort'), 'too-short titles are flagged');
assert(scoreTitle('7 things about building apps that actually ship to real users today', 'tiktok').issues.includes('seo.tooLong'), 'the limit is platform-specific');

eq(deriveTags('7 mistakes killing your first app'), ['mistakes', 'killing', 'your', 'first', 'app'], 'tags drop filler + short words');
eq(evidenceBlock([]), '', 'no metrics → no evidence block (no invented advice)');
const evidence = evidenceBlock([{ title: 'A', views: 100 }, { title: 'B', views: 10 }, { title: 'C', views: 0 }]);
assert(evidence.includes('BEST PERFORMING'), 'the evidence names the best titles');
assert(!evidence.includes('C'), 'a post with no views is not evidence of anything');

const parsed = parseSeoSuggestion('TITLE: one\nTITLE: two\nDESCRIPTION: a description\nTAGS: a, #b, c', ['fallback']);
eq(parsed.titles, ['one', 'two'], 'alternatives are parsed');
eq(parsed.description, 'a description', 'the description is parsed');
eq(parsed.tags, ['a', 'b', 'c'], 'tags are parsed and de-hashed');
eq(parseSeoSuggestion('garbage', ['fallback']).tags, ['fallback'], 'a malformed answer degrades to the deterministic baseline');

/* ------------------------------------------------------------ F4: trends */

const day = 86_400_000;
const trend = buildMetricTrend([
  { fetchedAt: new Date(day * 2), views: 300, likes: 30, comments: 3 },
  { fetchedAt: new Date(day), views: 100, likes: 10, comments: 1 },
]);
eq(trend.points.length, 2, 'snapshots become points');
eq(trend.points[0]?.views, 100, 'ordered oldest-first regardless of query order');
eq(trend.growth.views, 200, 'growth is last minus first (not the raw total)');
eq(trend.perDay, 200, 'and the rate is per day over the observed window');
eq(buildMetricTrend([]).perDay, 0, 'no data → no invented rate');
eq(buildMetricTrend([{ fetchedAt: new Date(day), views: 5, likes: 0, comments: 0 }]).perDay, 0, 'a single reading has no window, so no rate (never Infinity)');

const fast = buildMetricTrend([{ fetchedAt: new Date(0), views: 0, likes: 0, comments: 0 }, { fetchedAt: new Date(day), views: 500, likes: 0, comments: 0 }]);
const slow = buildMetricTrend([{ fetchedAt: new Date(0), views: 0, likes: 0, comments: 0 }, { fetchedAt: new Date(day * 4), views: 800, likes: 0, comments: 0 }]);
eq(compareVariants(fast, slow).winner, 'a', 'the A/B winner is decided on RATE, so an older post does not win by age alone');

/* ------------------------------------------------------------ F5: community */

eq(classifySentiment('this is amazing, love it'), 'positive', 'praise is positive');
eq(classifySentiment('this is trash'), 'negative', 'criticism is negative');
eq(classifySentiment('can you cover pricing?'), 'question', 'a question outranks tone — it is the actionable case');
eq(classifySentiment('ok'), 'neutral', 'everything else is neutral');

const mood = summarizeSentiment([{ text: 'love it' }, { text: 'awesome' }, { text: 'trash' }, { text: 'how much?' }, { text: 'ok' }]);
eq(mood.total, 5, 'every comment is counted');
eq(mood.positive, 2, 'positives are counted');
eq(mood.question, 1, 'questions are counted separately');
eq(mood.score, 0.33, 'net score is over OPINIONATED comments only (questions do not dilute it)');
eq(summarizeSentiment([]).score, 0, 'no comments → a zero score, not a divide-by-zero');

const themes = extractThemes([{ text: 'what about pricing' }, { text: 'pricing please' }, { text: 'love the intro' }]);
assert(themes.some((t) => t.theme === 'pricing' && t.count === 2), 'a repeated topic becomes a theme');
assert(!themes.some((t) => t.theme === 'intro'), 'a one-off mention is noise, not a theme');

eq(buildReplyRequest('tiktok', 'c1', 'hi', 'tok'), null, 'TikTok has no public reply endpoint — honest null');
eq(buildReplyRequest('youtube', 'c1', '   ', 'tok'), null, 'an empty reply is never posted');
const reply = buildReplyRequest('youtube', 'c1', 'thanks!', 'tok');
assert(reply?.body?.includes('"parentId":"c1"') === true, 'the reply threads under the right comment');
assert(reply?.headers.Authorization === 'Bearer tok', 'and is authorised as the channel');

report('contentDepth');
