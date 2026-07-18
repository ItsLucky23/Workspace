//? GAP_SCAN B3/B4/B5 — the testable halves of "the phone-first loop is not silently lossy":
//? notification deep-link targets (B3), the iOS install/push capability detection (B4), and the global
//? touch-ergonomics rule (B5). The B1 offline queue + B2 mobile create are UI wiring, verified in the
//? browser pass; their server-visible contracts are unchanged.

import { readFileSync } from 'node:fs';

import { notificationTarget } from '../../server/automation/executor.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ B3: deep-links */

const ticket = notificationTarget({ ticketKey: 'WS-12' });
eq(ticket.deepLink, { view: 'board', ticketId: 'WS-12' }, 'a ticket notification still deep-links to its ticket');
eq(ticket.url, '/?ticket=WS-12', 'and the push URL opens that ticket');

//? The regression: these used to have NO deepLink at all and dumped the user at the app root.
const orphan = notificationTarget({});
eq(orphan.deepLink, { view: 'activity' }, 'a ticket-less notification lands on the activity feed, not the root');
assert(orphan.url !== '/', 'the push URL is a real destination');
eq(orphan.url, '/?view=activity', 'the push URL names the same view as the in-app deep-link');

eq(notificationTarget({ roleKey: 'interviewer' }).deepLink, { view: 'interviewer' }, 'an interviewer finding opens the interviewer');
eq(notificationTarget({ roleKey: 'scraper' }).deepLink, { view: 'knowledge' }, 'a scraper finding opens the knowledge view');
eq(notificationTarget({ roleKey: 'unknown-role' }).deepLink, { view: 'activity' }, 'an unmapped role falls back to activity');
eq(notificationTarget({ ticketKey: 'WS-9', roleKey: 'interviewer' }).deepLink, { view: 'board', ticketId: 'WS-9' }, 'a ticket wins over the role view');

/* ------------------------------------------------------------ B4: iOS capability detection */

const installSrc = readFileSync(new URL('../../src/workspaces/_functions/installPrompt.ts', import.meta.url), 'utf8');
assert(installSrc.includes('export function isIosSafari'), 'iOS detection exists (beforeinstallprompt never fires there)');
assert(installSrc.includes('export function isStandalone'), 'installed-PWA detection exists (iOS push requires it)');

const settingsSrc = readFileSync(new URL('../../src/workspaces/settings/page.tsx', import.meta.url), 'utf8');
assert(settingsSrc.includes('setPushProblem'), 'the push toggle keeps the failure reason instead of snapping back silently');
assert(settingsSrc.includes('workspaces.account.installIos'), 'iOS gets a manual add-to-home-screen path');
for (const reason of ['unsupported', 'unconfigured', 'denied', 'error']) {
  for (const lang of ['en', 'nl', 'de', 'fr']) {
    const locale: unknown = JSON.parse(readFileSync(new URL(`../../src/_locales/${lang}.json`, import.meta.url), 'utf8'));
    const account = (locale as { workspaces: { account: Record<string, unknown> } }).workspaces.account;
    assert(typeof account[`push_${reason}`] === 'string', `${lang}: the '${reason}' push failure has a real message`);
  }
}

/* ------------------------------------------------------------ B5: touch ergonomics */

const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
assert(coarse.length > 0, 'the touch-only block exists');
assert(coarse.includes('font-size: 16px'), 'inputs are 16px on touch (below that iOS auto-zooms the page)');
assert(coarse.includes('min-height: 44px'), 'controls meet the 44px touch target');
assert(css.indexOf('@media (pointer: coarse)') > 0 && !css.includes('@media (max-width'), 'it keys on the POINTER, so a desktop stays dense');

report('phoneLoopIntegrity');
