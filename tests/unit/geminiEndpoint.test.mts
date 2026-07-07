//? Unit test for FREEDOM_PROGRAM X4 — custom Gemini endpoint. Verifies geminiEndpoint builds the
//? generateContent URL from a base (default or custom/self-hosted), trimming a trailing slash. Pure.

import { assert, eq, report } from '../_helpers.mts';

const { geminiEndpoint } = await import('../../server/ai/providers/geminiApi.ts');

eq(geminiEndpoint('https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-flash'), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', 'default base builds the Google URL');
eq(geminiEndpoint('https://my-proxy.test/v1', 'gemini-2.5-pro'), 'https://my-proxy.test/v1/models/gemini-2.5-pro:generateContent', 'a custom base is honoured');
eq(geminiEndpoint('https://my-proxy.test/v1/', 'm'), 'https://my-proxy.test/v1/models/m:generateContent', 'a trailing slash is trimmed');
assert(!geminiEndpoint('https://x.test//', 'm').includes('///'), 'multiple trailing slashes collapse');

report('tests/unit/geminiEndpoint.test.mts');
