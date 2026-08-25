//? GAP_SCAN Phase G — the pure halves of the new-module tranche: pipeline presets (G5), the clone contract
//? (G2), published-site slugging + CSP (G3), the asset library (G4) and site monitoring diffs (G8).
//? DB-backed halves live in tests/integration/newModules.test.mts. (G7 prompt A/B was removed 2026-08-25.)

import { readFileSync } from 'node:fs';

import { stagesForPreset, isPipelinePreset } from '../../server/bootstrap/defaultPipeline.ts';
import { siteSlug, extractHtml, siteHeaders, SITE_PREFIX } from '../../server/deploy/staticSite.ts';
import { parseSitePath } from '../../server/deploy/siteRoute.ts';
import { isStarred, isLibraryKind } from '../../server/content/assetLibrary.ts';
import { normalizeForDiff, contentHash, diffPages } from '../../server/scraper/watch.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ G5: pipeline presets */

assert(isPipelinePreset('simple') && isPipelinePreset('professional'), 'the known tiers are recognised');
assert(!isPipelinePreset('enterprise'), 'an unknown tier is refused (falls back to professional)');

const simple = stagesForPreset('simple');
const advanced = stagesForPreset('advanced');
const professional = stagesForPreset('professional');
eq(simple.length, 3, 'simple is a 3-stage board');
eq(advanced.length, 5, 'advanced adds plan + refine');
eq(professional.length, 7, 'professional is the full pipeline (unchanged default)');
assert(simple.length < advanced.length && advanced.length < professional.length, 'the tiers are strictly nested in size');

//? The KEYS must be stable across tiers: a ticket, a carry-over and every stage-scoped setting reference
//? them, so upgrading a tier must ADD columns, never rewrite history.
const simpleKeys = new Set(simple.map((s) => s.key));
assert([...simpleKeys].every((k) => professional.some((p) => p.key === k)), 'every simple stage key also exists in professional');
eq(simple.map((s) => s.order), [0, 1, 2], 'orders are contiguous, so the board has no gaps');
assert(simple.some((s) => s.key === 'impl'), 'even the simplest tier can implement');
assert(simple.some((s) => s.key === 'final'), 'and can finish');

/* ------------------------------------------------------------ G2: the clone contract */

const cloneSrc = readFileSync(new URL('../../server/bootstrap/cloneWorkspace.ts', import.meta.url), 'utf8');
//? These are the safety properties of a clone; if any regresses the feature becomes a credential leak.
assert(cloneSrc.includes('autopilot: false'), 'a clone never inherits autopilot (it would post from an unfinished workspace)');
assert(cloneSrc.includes('defaultAccountId: null'), 'a clone never inherits a connected publishing account');
assert(cloneSrc.includes('enabled: false'), 'triggers are copied disabled — a clone does not start firing crons');
assert(cloneSrc.includes('if (e.secret || isSecretKey(e.key)) continue'), 'secret env vars are never copied');
assert(!cloneSrc.includes('prisma.ticket.create'), 'no tickets are copied (that is the source\'s history)');
assert(!cloneSrc.includes('prisma.workspaceMember.create'), 'no members are copied — the cloner owns the copy');

/* ------------------------------------------------------------ G3: published sites */

eq(siteSlug('My Landing Page!', 'abc123'), siteSlug('My Landing Page!', 'abc123'), 'the slug is deterministic (re-publishing keeps the URL)');
assert(siteSlug('Landing', 'id-one') !== siteSlug('Landing', 'id-two'), 'two artifacts with the same title do not collide');
assert(/^[a-z0-9-]+$/.test(siteSlug('Wéird Ttl!! ***', 'x')), 'the slug is url-safe whatever the title is');
assert(siteSlug('', 'x').length > 0, 'an empty title still yields a slug');

eq(extractHtml({ html: '<h1>hi</h1>' }), '<h1>hi</h1>', 'a landing-page artifact yields its html');
eq(extractHtml({ tokens: {} }), null, 'a token set is not a page');
eq(extractHtml(null), null, 'null content is not a page');
eq(extractHtml({ html: '   ' }), null, 'empty html is not a page');

const headers = siteHeaders();
assert(headers['Content-Security-Policy']?.includes("default-src 'none'") === true, 'AI-generated HTML is served under a deny-by-default CSP');
assert(!headers['Content-Security-Policy']?.includes('script-src') || headers['Content-Security-Policy'].includes("script-src 'none'"), 'the page cannot run script');
eq(headers['X-Frame-Options'], 'DENY', 'and cannot be framed');

eq(parseSitePath(`${SITE_PREFIX}my-page-abc123`), 'my-page-abc123', 'the route parses the slug');
eq(parseSitePath(`${SITE_PREFIX}my-page/?utm=1`), 'my-page', 'query + trailing slash are stripped');
eq(parseSitePath(`${SITE_PREFIX}`), '', 'an empty slug is refused upstream');

/* ------------------------------------------------------------ G4: asset library */

assert(isLibraryKind('image') && isLibraryKind('music'), 'reusable kinds are in the library');
assert(!isLibraryKind('render') && !isLibraryKind('script'), 'per-piece outputs are NOT library assets');
assert(isStarred({ starred: true }), 'a starred asset is detected');
assert(!isStarred({ starred: 'yes' }), 'only a real boolean counts');
assert(!isStarred(null) && !isStarred([]), 'malformed metadata is simply not starred');

/* ------------------------------------------------------------ G8: site monitoring */

const page = 'Our pricing is 20 euro per month. Updated 2026-07-18 at 10:30. Ref ?utm_source=x';
assert(!normalizeForDiff(page).includes('2026-07-18'), 'dates are normalized away (they churn every day)');
assert(!normalizeForDiff(page).includes('10:30'), 'clock times too');
assert(!normalizeForDiff(page).includes('utm_source'), 'and tracking params');
assert(normalizeForDiff(page).includes('20 euro'), 'but the actual claim survives');

eq(contentHash('a  b'), contentHash('a b'), 'whitespace churn does not change the hash');
assert(contentHash('20 euro') !== contentHash('30 euro'), 'a real change does');

const unchanged = diffPages('Our pricing is 20 euro per month for everyone.', 'Our pricing is 20 euro per month for everyone.');
assert(!unchanged.changed, 'an unchanged page reports no change');
assert(unchanged.summary.includes('No meaningful change'), 'in plain language');

const changed = diffPages(
  'Our pricing is 20 euro per month for teams. We support single sign-on for everyone.',
  'Our pricing is 30 euro per month for teams. We support single sign-on for everyone.',
);
assert(changed.changed, 'a price change is detected');
assert(changed.added.some((l) => l.includes('30 euro')), 'the new claim is reported');
assert(changed.removed.some((l) => l.includes('20 euro')), 'and the old one');
assert(!changed.added.some((l) => l.includes('single sign-on')), 'the unchanged sentence is not reported as noise');

report('newModules');
