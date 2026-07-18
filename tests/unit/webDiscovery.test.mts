//? DESIGN_DOCS_PROGRAM 3.5 — the pure parse of search-results HTML into candidate reference sites
//? (de-dupes hosts, decodes DDG's uddg redirect, drops the engine's own links). No network.

import { parseSearchResults } from '../../server/designer/webDiscovery.ts';
import { assert, report } from '../_helpers.mts';

//? A representative DuckDuckGo html-endpoint result fragment (uddg-wrapped hrefs + one dup host + a DDG self-link).
const html = `
<div class="result"><a class="result__a" rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fstripe.com%2Fpayments&rut=x">Stripe — Payments</a></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flinear.app%2F">Linear — issue tracking</a></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.stripe.com%2Fabout">Stripe again (dup host)</a></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fsettings">DDG self</a></div>
`;

const sites = parseSearchResults(html, 6);
assert(sites.length === 2, 'two unique non-DDG hosts survive (stripe dup + ddg self dropped)');
assert(sites[0]?.url === 'https://stripe.com/payments', 'the uddg redirect is decoded to the real URL');
assert(sites[0]?.title.includes('Stripe'), 'the title is extracted + tag-stripped');
assert(sites.some((s) => s.url === 'https://linear.app/'), 'the second distinct host is kept');
assert(!sites.some((s) => s.url.includes('duckduckgo.com')), 'the search engine self-link is dropped');

//? limit is respected.
assert(parseSearchResults(html, 1).length === 1, 'limit caps the result count');
//? empty / junk html → [].
assert(parseSearchResults('', 6).length === 0, 'empty html → no sites');
assert(parseSearchResults('<a href="https://x.com">no result class</a>', 6).length === 0, 'links without result__a are ignored');

report('webDiscovery');
