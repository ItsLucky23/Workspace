//? HARDENING phase 1+2 — the pure halves of the fixes for what independent verification found still open:
//? signed media URLs (F05/F42), the frozen publish intent (F40), and the promotion/push wiring (F26/F44/F41).
//?
//? Each block states the BROKEN behaviour it pins down, because several of these looked fixed while being
//? wrong — that is the whole reason this file exists.

import { readFileSync } from 'node:fs';

import { signMediaUrl, signMediaName, verifyMediaSignature, readSignatureParams, platformFetchableUrl, DEFAULT_MEDIA_TTL_MS } from '../../server/media/signedUrl.ts';
import { safeMediaPath } from '../../server/media/download.ts';
import { withSignedMedia } from '../../server/deploy/staticSite.ts';
import { parseFrozenIntent } from '../../server/content/publish.ts';
import { assert, eq, report } from '../_helpers.mts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

//? A stable key so signatures are reproducible inside this test.
process.env.WORKSPACES_ENC_KEY = process.env.WORKSPACES_ENC_KEY ?? 'test-key-for-media-signing';

/* ------------------------------------------------------------ F05: /media is no longer a bearer uuid */

const now = Date.now();
const name = 'abc123.mp4';
const validExp = now + 60_000;
const goodSig = signMediaName(name, validExp);

eq(verifyMediaSignature(name, String(validExp), goodSig, now), 'valid', 'a correctly signed, unexpired link is accepted');
eq(verifyMediaSignature(name, null, null, now), 'missing', 'an unsigned request is "missing" — it falls through to the session check');
eq(verifyMediaSignature(name, String(now - 1000), signMediaName(name, now - 1000), now), 'expired', 'an expired signature is rejected even though it was once valid');
eq(verifyMediaSignature(name, String(validExp), 'deadbeef'.repeat(4), now), 'invalid', 'a forged signature is rejected');

//? The signature is bound to the FILE: replaying a valid signature on another asset must fail. This is the
//? property that makes a leaked link harmless beyond its own file.
eq(verifyMediaSignature('other.mp4', String(validExp), goodSig, now), 'invalid', 'a signature for one file does not unlock another');
//? …and to the EXPIRY: extending the deadline invalidates it.
eq(verifyMediaSignature(name, String(validExp + 1), goodSig, now), 'invalid', 'the expiry cannot be extended by editing the URL');

const signed = signMediaUrl('/media/abc123.mp4', 'https://example.test', 60_000);
assert(signed.startsWith('https://example.test/media/abc123.mp4?'), 'a signed URL is absolute');
const parsed = readSignatureParams(signed);
assert(parsed.exp !== null && parsed.sig !== null, 'and carries both params');
eq(verifyMediaSignature('abc123.mp4', parsed.exp, parsed.sig, now), 'valid', 'the minted URL verifies end-to-end');
eq(signMediaUrl('https://cdn.example/x.png', 'https://example.test'), 'https://cdn.example/x.png', 'a non-local URL is passed through untouched');

//? The traversal guard must still hold — the new auth is in ADDITION to it, not instead of it.
eq(safeMediaPath('/media/../../etc/passwd'), null, 'path traversal is still refused');
eq(safeMediaPath('/media/sub/dir.png'), null, 'nested paths are still refused');

const downloadSrc = read('server/media/download.ts');
assert(downloadSrc.includes('readSession'), 'an unsigned /media request now requires a session');
assert(downloadSrc.includes('workspaceMember.findFirst'), 'and workspace membership');
assert(downloadSrc.includes("verdict === 'expired' || verdict === 'invalid'"), 'a bad signature is refused outright, not silently downgraded to the session path');

/* ------------------------------------------------------------ F42: TikTok can finally fetch the asset */

const prevPublic = process.env.WS_PUBLIC_URL;
process.env.WS_PUBLIC_URL = 'https://app.example.test';
const pullUrl = platformFetchableUrl('/media/video1.mp4');
assert(pullUrl.startsWith('https://app.example.test/media/video1.mp4?'), 'a platform pull URL is absolute (the old relative /media/... was unfetchable by definition)');
assert(pullUrl.includes('sig='), 'and signed, so it works without a cookie');

//? An install with no public origin must NOT pretend: returning a localhost URL would fail silently at the
//? platform. '' lets the caller keep the raw value and surface the real error.
delete process.env.WS_PUBLIC_URL;
const prevDomain = process.env.WS_BASE_DOMAIN;
process.env.WS_BASE_DOMAIN = 'localhost';
eq(platformFetchableUrl('/media/video1.mp4'), '', 'no public origin → no fake URL');
if (prevDomain === undefined) delete process.env.WS_BASE_DOMAIN; else process.env.WS_BASE_DOMAIN = prevDomain;
process.env.WS_PUBLIC_URL = 'https://app.example.test';

assert(read('server/content/publishOAuth.ts').includes('platformFetchableUrl(input.assetUrl)'), 'the TikTok builder uses it');

/* ------------------------------------------------------------ F05 fallout: published pages keep working */

const page = `<img src="/media/hero.png"><a href='/media/deck.pdf'>deck</a><img src="https://cdn/x.png">`;
const rewritten = withSignedMedia(page, DEFAULT_MEDIA_TTL_MS);
assert(rewritten.includes('https://app.example.test/media/hero.png?'), 'a published page gets signed absolute media URLs');
assert(rewritten.includes("href='https://app.example.test/media/deck.pdf?"), "single-quoted attributes survive the rewrite");
assert(rewritten.includes('src="https://cdn/x.png"'), 'external URLs are left alone');
assert(!rewritten.includes('src="/media/'), 'no relative media URL survives (it would 401 for a stranger)');
if (prevPublic === undefined) delete process.env.WS_PUBLIC_URL; else process.env.WS_PUBLIC_URL = prevPublic;

/* ------------------------------------------------------------ F40: the scheduled intent is frozen */

eq(parseFrozenIntent(null), null, 'a pre-F40 job has no frozen payload and falls back to a live read');
eq(parseFrozenIntent({}), null, 'an empty payload is not treated as a freeze');
const intent = parseFrozenIntent({ title: 'Launch day', assetUrl: '/media/v.mp4', variant: { caption: 'hi', privacy: 'public' }, frozenAt: 123 });
eq(intent?.title, 'Launch day', 'the frozen title is read back');
eq(intent?.variant?.caption, 'hi', 'and the frozen caption');
const publishSrc = read('server/content/publish.ts');
assert(publishSrc.includes('freezePublishIntent'), 'scheduling freezes the intent');
assert(publishSrc.includes('frozen: parseFrozenIntent(job.frozenPayload)'), 'and firing honours it');
assert(publishSrc.includes('const variant = frozen ? frozen.variant :'), 'a frozen job does not re-read the live caption hours later');

/* ------------------------------------------------------------ F26: promote ships what it gated */

const promoteSrc = read('server/deploy/promote.ts');
assert(promoteSrc.includes('pinnedCommit: promotedCommit'), 'promotion pins the SOURCE revision on the target');
assert(promoteSrc.includes("data: { pinnedCommit: promotedCommit }"), 'and writes the pin even when the target env already existed');
assert(promoteSrc.includes("error: 'promote.commitMismatch'"), 'a divergence between gated and shipped commit is refused, not reported as success');
assert(promoteSrc.includes("error: 'promote.sourceHasNoCommit'"), 'a source with no recorded commit cannot be promoted at all');

/* ------------------------------------------------------------ F44: a new question pushes immediately */

const writerSrc = read('server/orchestrator/stageWriter.ts');
assert(writerSrc.includes('notifyNewQuestion'), 'a newly asked question notifies immediately');
assert(writerSrc.includes("sendWebPush"), 'including a web push (the phone-first half)');
assert(writerSrc.includes('deterministicObjectId'), 'the notification id is deterministic, so a retried write cannot double-notify');
//? The bug was that the reminder path is the ONLY notifier and it requires remindedAt !== null.
assert(writerSrc.includes('remindedAt: null'), 'the question still resets the reminder clock');

/* ------------------------------------------------------------ F41: the channel default wins */

const composer = read('src/workspaces/content/[pieceId]/page.tsx');
assert(composer.includes('defaultAccountId'), 'the composer knows the channel default');
assert(composer.includes('accounts.some((a) => a.accountId === defaultAccountId)'), 'and only uses it when that account is actually connected');
assert(!composer.includes("useState(accounts[0]?.accountId ?? '')"), 'the blind accounts[0] default is gone');

report('hardeningPhase1');
