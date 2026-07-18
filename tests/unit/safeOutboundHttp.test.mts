//? A04 — central outbound URL-security regression suite. Pure/mocked: no server, Docker or live network.
//? Covers special-use IPv4/IPv6, all-answer DNS validation, direct-IP pin metadata, per-hop redirects,
//? DNS rebinding, HTTPS/redirect policy, generic credential stripping, POST bodies, byte caps and abort.

import { assert, eq, report } from '../_helpers.mts';
import {
  safeHttpRequest,
  type HttpTransportResponse,
  type OutboundResolver,
  type OutboundTransport,
  type PinnedHttpRequest,
  type SafeHttpResult,
} from '../../server/security/safeHttp';

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V4_ALT = '8.8.8.8';
const PUBLIC_V6 = '2606:4700:4700::1111';

function code(result: SafeHttpResult): string {
  return result.ok ? 'ok' : result.error.code;
}

function response(status = 200, body = 'ok', headers: HttpTransportResponse['headers'] = {}): HttpTransportResponse {
  return { status, headers, body: Buffer.from(body) };
}

const noDns: OutboundResolver = async () => [{ address: PUBLIC_V4, family: 4 }];
let blockedTransportCalls = 0;
const blockedTransport: OutboundTransport = async () => {
  blockedTransportCalls += 1;
  return response();
};

// ---- Private, loopback, link-local, metadata, multicast, documentation and reserved literals.
for (const url of [
  'http://127.0.0.1/',
  'http://2130706433/',
  'http://10.0.0.1/',
  'http://169.254.169.254/latest/meta-data',
  'http://100.100.100.200/',
  'http://192.0.2.1/',
  'http://198.51.100.1/',
  'http://203.0.113.1/',
  'http://224.0.0.1/',
  'http://240.0.0.1/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[fc00::1]/',
  'http://[fe80::1]/',
  'http://[ff02::1]/',
  'http://[2001:db8::1]/',
  'http://[3fff::1]/',
]) {
  const result = await safeHttpRequest(url, { resolver: noDns, transport: blockedTransport, allowInsecureHttp: true });
  eq(code(result), 'blocked-address', `special-use literal is blocked: ${url}`);
}
eq(blockedTransportCalls, 0, 'blocked literals never reach the transport');

// ---- URL shape: only HTTP(S), default ports, and no embedded credentials.
eq(code(await safeHttpRequest('ftp://public.test/file', { resolver: noDns, transport: blockedTransport })), 'unsupported-protocol', 'non-HTTP protocol is blocked');
eq(code(await safeHttpRequest('https://public.test:444/hook', { resolver: noDns, transport: blockedTransport })), 'non-default-port', 'non-default HTTPS port is blocked');
eq(code(await safeHttpRequest('https://user:pass@public.test/hook', { resolver: noDns, transport: blockedTransport })), 'credentials-not-allowed', 'URL-embedded credentials are blocked');
eq(code(await safeHttpRequest('https://public.test:443/hook', { resolver: noDns, transport: async () => response() })), 'ok', 'an explicit default HTTPS port is allowed');

// ---- Plain HTTP is opt-in and only valid for credential-free, bodyless GET/HEAD reads.
let publicHttpCalls = 0;
const publicHttpTransport: OutboundTransport = async () => { publicHttpCalls += 1; return response(); };
eq(code(await safeHttpRequest('http://public.test/read', { resolver: noDns, transport: publicHttpTransport })), 'insecure-http-not-allowed', 'plain HTTP is blocked by default');
eq(publicHttpCalls, 0, 'HTTP without the explicit opt-in never reaches transport');
eq(code(await safeHttpRequest('http://public.test/read', { resolver: noDns, transport: publicHttpTransport, allowInsecureHttp: true })), 'ok', 'explicit bodyless HTTP GET is allowed for public scraping');
eq(code(await safeHttpRequest('http://public.test/read', { resolver: noDns, transport: publicHttpTransport, allowInsecureHttp: true, method: 'HEAD' })), 'ok', 'explicit bodyless HTTP HEAD is allowed for public discovery');
eq(code(await safeHttpRequest('http://public.test/write', { resolver: noDns, transport: publicHttpTransport, allowInsecureHttp: true, method: 'POST' })), 'insecure-http-not-allowed', 'HTTP POST is blocked even without a body');
eq(code(await safeHttpRequest('http://public.test/read', { resolver: noDns, transport: publicHttpTransport, allowInsecureHttp: true, body: '' })), 'insecure-http-not-allowed', 'HTTP is blocked when a body is present, including an empty body');
eq(code(await safeHttpRequest('http://public.test/read', { resolver: noDns, transport: publicHttpTransport, allowInsecureHttp: true, headers: { 'X-Service-Token': 'secret' } })), 'insecure-http-not-allowed', 'HTTP is blocked when a sensitive header is present');
eq(publicHttpCalls, 2, 'only the opted-in bodyless GET and HEAD reach HTTP transport');

// ---- ALL DNS answers are checked: one private answer poisons the whole hostname.
let mixedTransportCalls = 0;
const mixedResult = await safeHttpRequest('https://mixed.test/', {
  resolver: async () => [{ address: PUBLIC_V4, family: 4 }, { address: '10.0.0.7', family: 4 }, { address: PUBLIC_V6, family: 6 }],
  transport: async () => { mixedTransportCalls += 1; return response(); },
});
eq(code(mixedResult), 'blocked-address', 'a private answer among public A/AAAA answers blocks the hostname');
eq(mixedTransportCalls, 0, 'mixed DNS answers are rejected before transport');

// ---- Public mocked request: connect pin, Host and TLS SNI retain their distinct responsibilities.
const publicRequests: PinnedHttpRequest[] = [];
const publicResult = await safeHttpRequest('https://public.test/path?q=1', {
  resolver: async () => [{ address: PUBLIC_V4, family: 4 }, { address: PUBLIC_V6, family: 6 }],
  transport: async (request) => { publicRequests.push(request); return response(204, ''); },
});
eq(code(publicResult), 'ok', 'a hostname whose complete A/AAAA set is public is allowed');
eq(publicRequests[0]?.connectAddress, PUBLIC_V4, 'the socket target is the validated IP, not the hostname');
eq(publicRequests[0]?.hostHeader, 'public.test', 'the HTTP Host remains the original hostname');
eq(publicRequests[0]?.headers.host, 'public.test', 'the emitted Host header remains the original hostname');
eq(publicRequests[0]?.servername, 'public.test', 'HTTPS TLS SNI/certificate identity remains the original hostname');

// ---- Redirects resolve and validate EVERY hop; a private redirect target never reaches transport.
const redirectHosts: string[] = [];
const redirectPins: string[] = [];
const redirectSignals: AbortSignal[] = [];
const redirectResult = await safeHttpRequest('https://first.test/start', {
  resolver: async (hostname) => {
    redirectHosts.push(hostname);
    return [{ address: hostname === 'first.test' ? PUBLIC_V4 : PUBLIC_V4_ALT, family: 4 }];
  },
  transport: async (request) => {
    redirectPins.push(request.connectAddress);
    redirectSignals.push(request.signal);
    return request.url.pathname === '/start'
      ? response(302, '', { location: 'https://second.test/final' })
      : response(200, 'done');
  },
});
eq(code(redirectResult), 'ok', 'a fully public redirect chain succeeds');
eq(redirectHosts, ['first.test', 'second.test'], 'both redirect hops are independently resolved');
eq(redirectPins, [PUBLIC_V4, PUBLIC_V4_ALT], 'each hop connects to its own validated pin');
assert(redirectSignals[0] === redirectSignals[1], 'one total-request AbortSignal spans the complete redirect chain');

let privateRedirectCalls = 0;
const privateRedirect = await safeHttpRequest('https://first.test/start', {
  resolver: noDns,
  transport: async () => {
    privateRedirectCalls += 1;
    return response(302, '', { location: 'https://127.0.0.1/admin' });
  },
});
eq(code(privateRedirect), 'blocked-address', 'a redirect to a private literal is blocked on the next hop');
eq(privateRedirectCalls, 1, 'the private redirect target never reaches transport');

let downgradeCalls = 0;
const downgradeRedirect = await safeHttpRequest('https://secure.test/start', {
  resolver: noDns,
  allowInsecureHttp: true,
  transport: async () => { downgradeCalls += 1; return response(302, '', { location: 'http://public.test/end' }); },
});
eq(code(downgradeRedirect), 'https-downgrade-redirect', 'HTTPS to HTTP redirects are blocked even with the public-read opt-in');
eq(downgradeCalls, 1, 'an HTTPS downgrade never issues the second request');

let loopCalls = 0;
const redirectLoop = await safeHttpRequest('https://loop.test/a', {
  resolver: noDns,
  maxRedirects: 1,
  transport: async (request) => {
    loopCalls += 1;
    return response(302, '', { location: request.url.pathname === '/a' ? '/b' : '/a' });
  },
});
eq(code(redirectLoop), 'too-many-redirects', 'redirect count is capped');
eq(loopCalls, 2, 'the transport stops at the configured redirect cap');

// ---- Cross-origin redirects never forward bearer/cookie credentials; unrelated headers survive.
const credentialRequests: PinnedHttpRequest[] = [];
const credentialResult = await safeHttpRequest('https://auth.test/start', {
  resolver: noDns,
  headers: {
    Authorization: 'Bearer secret', Cookie: 'sid=secret', 'X-Api-Key': 'also-secret',
    'X-Service-Token': 'token-secret', 'Client-Secret': 'client-secret', 'X-Trace': 'keep',
  },
  transport: async (request) => {
    credentialRequests.push(request);
    return request.url.hostname === 'auth.test'
      ? response(307, '', { location: 'https://other.test/end' })
      : response(200, 'ok');
  },
});
eq(code(credentialResult), 'ok', 'cross-origin redirect completes');
eq(credentialRequests[0]?.headers.authorization, 'Bearer secret', 'credentials are present on the configured origin');
assert(credentialRequests[1]?.headers.authorization === undefined, 'Authorization is stripped on the cross-origin hop');
assert(credentialRequests[1]?.headers.cookie === undefined, 'Cookie is stripped on the cross-origin hop');
assert(credentialRequests[1]?.headers['x-api-key'] === undefined, 'API-key credentials are stripped on the cross-origin hop');
assert(credentialRequests[1]?.headers['x-service-token'] === undefined, '*token* credentials are stripped on the cross-origin hop');
assert(credentialRequests[1]?.headers['client-secret'] === undefined, '*secret* credentials are stripped on the cross-origin hop');
eq(credentialRequests[1]?.headers['x-trace'], 'keep', 'non-credential headers survive the redirect');

// ---- Cross-origin redirects cannot replay unsafe methods or bodies, including redirects that normally become GET.
let crossOriginPostCalls = 0;
const crossOriginPost = await safeHttpRequest('https://write.test/start', {
  resolver: noDns,
  method: 'POST',
  body: 'sensitive-body',
  transport: async () => { crossOriginPostCalls += 1; return response(303, '', { location: 'https://other.test/end' }); },
});
eq(code(crossOriginPost), 'cross-origin-redirect-not-allowed', 'cross-origin POST redirect is refused before 303 method conversion');
eq(crossOriginPostCalls, 1, 'cross-origin POST sends neither a second request nor a second body');

let crossOriginBodyCalls = 0;
const crossOriginBody = await safeHttpRequest('https://read.test/start', {
  resolver: noDns,
  body: 'body-on-get',
  transport: async () => { crossOriginBodyCalls += 1; return response(307, '', { location: 'https://other.test/end' }); },
});
eq(code(crossOriginBody), 'cross-origin-redirect-not-allowed', 'cross-origin redirect with a GET body is refused');
eq(crossOriginBodyCalls, 1, 'a body-bearing GET is not replayed cross-origin');

let crossOriginDeleteCalls = 0;
const crossOriginDelete = await safeHttpRequest('https://write.test/start', {
  resolver: noDns,
  method: 'DELETE',
  transport: async () => { crossOriginDeleteCalls += 1; return response(307, '', { location: 'https://other.test/end' }); },
});
eq(code(crossOriginDelete), 'cross-origin-redirect-not-allowed', 'cross-origin non-GET/HEAD redirect is refused without needing a body');
eq(crossOriginDeleteCalls, 1, 'a bodyless unsafe method is not replayed cross-origin');

// ---- DNS rebinding: validation resolves once; transport receives only that public IP pin.
let rebindResolutions = 0;
let rebindPin = '';
const rebindResult = await safeHttpRequest('https://rebind.test/resource', {
  resolver: async () => {
    rebindResolutions += 1;
    return rebindResolutions === 1 ? [{ address: PUBLIC_V4, family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
  },
  transport: async (request) => { rebindPin = request.connectAddress; return response(); },
});
eq(code(rebindResult), 'ok', 'the validated public rebind target succeeds');
eq(rebindResolutions, 1, 'there is no second DNS lookup between validation and connect');
eq(rebindPin, PUBLIC_V4, 'the transport connects to the validated public pin');

// ---- POST body + request metadata are preserved within caps.
let postRequest: PinnedHttpRequest | undefined;
const postResult = await safeHttpRequest('https://post.test/hook', {
  resolver: noDns,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"hello":"world"}',
  transport: async (request) => { postRequest = request; return response(202, 'accepted'); },
});
eq(code(postResult), 'ok', 'bounded POST succeeds');
eq(postRequest?.method, 'POST', 'POST method reaches transport');
eq(postRequest?.body?.toString('utf8'), '{"hello":"world"}', 'POST body reaches transport unchanged');
eq(postRequest?.headers['content-length'], String(Buffer.byteLength('{"hello":"world"}')), 'POST content-length matches the body');

// ---- Injected transports cannot evade central response-body and total-time caps.
const oversizedRequest = await safeHttpRequest('https://post.test/', {
  resolver: noDns,
  method: 'POST',
  body: '12345678901',
  maxRequestBytes: 10,
  transport: blockedTransport,
});
eq(code(oversizedRequest), 'request-too-large', 'request body byte cap is enforced before transport');

const oversized = await safeHttpRequest('https://large.test/', {
  resolver: noDns,
  maxResponseBytes: 10,
  transport: async () => response(200, '12345678901'),
});
eq(code(oversized), 'response-too-large', 'response byte cap is enforced after an injected transport');

const redirectBytes = await safeHttpRequest('https://bytes.test/start', {
  resolver: noDns,
  maxResponseBytes: 10,
  transport: async (request) => request.url.pathname === '/start'
    ? response(302, '123456', { location: '/end' })
    : response(200, '12345'),
});
eq(code(redirectBytes), 'response-too-large', 'response byte cap covers the complete redirect chain');

let abortObserved = false;
let timedOutSignal: AbortSignal | undefined;
const hangingTransport: OutboundTransport = (request) => new Promise((_resolve, reject) => {
  timedOutSignal = request.signal;
  request.signal.addEventListener('abort', () => {
    abortObserved = true;
    reject(new Error('transport observed abort'));
  }, { once: true });
});
const timedOut = await safeHttpRequest('https://slow.test/', { resolver: noDns, transport: hangingTransport, timeoutMs: 15 });
eq(code(timedOut), 'timeout', 'total request time is capped');
assert(abortObserved, 'the injected transport observes a real abort event, not only a Promise.race timeout');
eq(timedOutSignal?.aborted, true, 'PinnedHttpRequest carries the aborted total-request signal');

// ---- Scraper/search adapters consume the same injected central transport (no hidden raw fetch fallback).
const { fetchPageText } = await import('../../server/scraper/role');
const scraped = await fetchPageText('http://scrape.test/page', {
  resolver: noDns,
  transport: async () => response(200, '<html><script>secret()</script><h1>Hello</h1><p>Public page</p></html>'),
});
eq(scraped, 'Hello Public page', 'scraper uses the safe transport and strips active HTML');

const { fetchSearch } = await import('../../server/designer/webDiscovery');
let searchPin = '';
const searchHtml = await fetchSearch('design systems', {
  resolver: noDns,
  transport: async (request) => { searchPin = request.connectAddress; return response(200, '<div>results</div>'); },
});
eq(searchHtml, '<div>results</div>', 'web discovery uses the safe transport');
eq(searchPin, PUBLIC_V4, 'web discovery reaches only the validated public pin');

// ---- Deploy hook preserves POST/auth on its origin while using the shared resolver/transport seam.
const savedDeployUrl = process.env.WS_DEPLOY_WEBHOOK_URL;
const savedDeployToken = process.env.WS_DEPLOY_WEBHOOK_TOKEN;
process.env.WS_DEPLOY_WEBHOOK_TOKEN = 'deploy-secret';
let deployRequest: PinnedHttpRequest | undefined;
const { postDeployWebhook } = await import('../../server/deploy/buildExport');
process.env.WS_DEPLOY_WEBHOOK_URL = 'http://deploy.test/hook';
const insecureDeployResult = await postDeployWebhook({
  event: 'build-export', workspaceId: 'ws', projectId: 'project', kind: 'bundle',
  artifactId: 'artifact', imageRef: 'image:1', downloadToken: 'download-token',
}, {
  resolver: noDns,
  transport: async (request) => { deployRequest = request; return response(200, 'ok'); },
});
eq(insecureDeployResult.error, 'insecure-http-not-allowed', 'credential/body-bearing deploy hooks are HTTPS-only');
assert(deployRequest === undefined, 'an insecure deploy hook never reaches transport');

process.env.WS_DEPLOY_WEBHOOK_URL = 'https://deploy.test/hook';
const deployResult = await postDeployWebhook({
  event: 'build-export', workspaceId: 'ws', projectId: 'project', kind: 'bundle',
  artifactId: 'artifact', imageRef: 'image:1', downloadToken: 'download-token',
}, {
  resolver: noDns,
  transport: async (request) => { deployRequest = request; return response(200, 'ok'); },
});
eq(deployResult.ok, true, 'deploy hook succeeds through a mocked public target');
eq(deployRequest?.method, 'POST', 'deploy hook sends POST through the central transport');
eq(deployRequest?.headers.authorization, 'Bearer deploy-secret', 'deploy bearer reaches only its configured origin');
assert(deployRequest?.body?.toString('utf8').includes('"artifactId":"artifact"') === true, 'deploy descriptor body reaches the central transport');
process.env.WS_DEPLOY_WEBHOOK_URL = savedDeployUrl ?? '';
process.env.WS_DEPLOY_WEBHOOK_TOKEN = savedDeployToken ?? '';

// ---- Chromium remote capture is deliberately unavailable: HTTP preflight cannot secure subresources.
const { captureUrlScreenshot } = await import('../../server/designer/inspiration');
eq(await captureUrlScreenshot('https://public.test/'), null, 'remote Chromium URL capture fails closed before Docker/network');

report('safeOutboundHttp');
