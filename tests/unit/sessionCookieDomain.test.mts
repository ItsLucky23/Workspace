import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { registerSessionCookieDomainBridge, withSessionCookieDomain } from '../../server/http/sessionCookieDomain.ts';

const domain = '.workspace.keetlerop.nl';
assert.equal(
  withSessionCookieDomain('token=abc; Path=/; HttpOnly; Secure', 'token', domain),
  `token=abc; Path=/; HttpOnly; Secure; Domain=${domain}`,
  'the session cookie receives the configured wildcard parent',
);
assert.equal(
  withSessionCookieDomain('ls-oauth-state=abc; Path=/; HttpOnly', 'token', domain),
  'ls-oauth-state=abc; Path=/; HttpOnly',
  'OAuth state cookies remain host-only',
);
assert.deepEqual(
  withSessionCookieDomain(['token=abc; Path=/', 'csrf=def; Path=/'], 'token', domain),
  [`token=abc; Path=/; Domain=${domain}`, 'csrf=def; Path=/'],
  'only the session entry changes in a multi-cookie header',
);

const server = createServer((_request, response) => {
  response.setHeader('Set-Cookie', 'token=live; Path=/; HttpOnly');
  response.end('ok');
});
registerSessionCookieDomainBridge(server, { cookieName: 'token', domain });
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
assert.ok(address && typeof address === 'object');
const response = await fetch(`http://127.0.0.1:${String(address.port)}/`);
assert.equal(response.headers.get('set-cookie'), `token=live; Path=/; HttpOnly; Domain=${domain}`);
await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });

console.log('session cookie domain unit tests passed');
