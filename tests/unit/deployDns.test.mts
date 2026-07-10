//? D1/D2/D3 + E1/E2 — the pure deploy/DNS + stack helpers. D2 subdomain sanitize, D3 custom-domain validate +
//? the tls-ask domain parse (the on-demand-TLS guard's input), D1 per-stack prod command, E1 the extended stack
//? catalog (php/dotnet/ruby/generic) resolve to a base image + a dev command. The Docker-backed deploy itself is
//? the E2E round; here only the pure decision logic is asserted.

import { assert, eq, report } from '../_helpers.mts';

const { sanitizeSubdomain, sanitizeCustomDomain } = await import('../../server/deploy/environment.ts');
const { parseAskDomain } = await import('../../server/proxy/tlsAsk.ts');
const { defaultProdCommand, defaultDevCommand, isBaseStack, baseImageFor, BASE_STACKS } = await import('../../server/container/baseImages.ts');

// D2 — subdomain sanitize
eq(sanitizeSubdomain('My App!'), 'my-app', 'a subdomain is lowercased + dns-safe');
eq(sanitizeSubdomain('--a__b--'), 'a-b', 'leading/trailing dashes stripped, runs collapsed');
eq(sanitizeSubdomain(''), '', 'empty → empty (falls back to derived host)');
eq(sanitizeSubdomain('a'.repeat(70)), '', 'over 63 chars → rejected');

// D3 — custom domain validate
eq(sanitizeCustomDomain('https://preview.mijndomein.nl/path'), 'preview.mijndomein.nl', 'scheme + path stripped');
eq(sanitizeCustomDomain('bad domain'), '', 'a non-FQDN is rejected');
eq(sanitizeCustomDomain('localhost'), '', 'a bare label (no dot) is rejected');

// D3 — the tls-ask guard input
eq(parseAskDomain('/proxy/tls-ask?domain=Preview.Example.COM'), 'preview.example.com', 'ask domain is lowercased');
eq(parseAskDomain('/proxy/tls-ask'), '', 'no domain param → empty (refused)');

// E1 — the extended stack catalog
for (const s of ['php', 'dotnet', 'ruby', 'generic']) {
  assert(isBaseStack(s), `${s} is a known stack`);
  assert(defaultDevCommand(s).length > 0, `${s} has a dev command`);
  assert(defaultProdCommand(s).length > 0, `${s} has a prod command`);
  assert(baseImageFor(s).length > 0, `${s} resolves a base image`);
}
assert(BASE_STACKS.includes('php') && BASE_STACKS.includes('generic'), 'the catalog was extended');

// D1 — node prod builds then serves (distinct from the dev server)
assert(defaultProdCommand('node').includes('build'), 'node prod command builds first');
assert(defaultDevCommand('node') !== defaultProdCommand('node'), 'prod != dev for node');

report('tests/unit/deployDns.test.mts');
