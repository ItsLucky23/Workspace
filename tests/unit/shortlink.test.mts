//? H3 (ads) — the short-link redirect helpers (pure). parseShortLink extracts the slug + UTM query from
//? `/l/<slug>?utm_...`; buildRedirectUrl merges the incoming UTM params onto the target (incoming wins), so a
//? per-post `?utm_content=B` reaches the landing page. The click-increment + 302 are the live route (integration).

import { parseShortLink, buildRedirectUrl } from '../../server/content/shortlinkRoute.ts';
import { assert, eq, report } from '../_helpers.mts';

eq(parseShortLink('/l/spring-sale-ab12').slug, 'spring-sale-ab12', 'the slug is parsed');
eq(parseShortLink('/l/x?utm_source=ig').query, 'utm_source=ig', 'the UTM query is captured');
eq(parseShortLink('/l/').slug, '', 'a missing slug → empty (404)');

eq(buildRedirectUrl('https://shop.example/p', ''), 'https://shop.example/p', 'no query → target unchanged');
assert(buildRedirectUrl('https://shop.example/p', 'utm_source=ig&utm_content=B').includes('utm_content=B'), 'UTM params pass through to the target');
const merged = buildRedirectUrl('https://shop.example/p?utm_source=default', 'utm_source=ig');
assert(merged.includes('utm_source=ig') && !merged.includes('utm_source=default'), 'incoming UTM overrides the target default');

report('tests/unit/shortlink.test.mts');
