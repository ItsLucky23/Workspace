//? Spike — prove egress control (WS_EGRESS=1) actually confines a worker to the allowlist:
//?  1. ensureEgressInfra brings up the internal network + the squid allowlist proxy.
//?  2. ISOLATION: a container on ws-egress with NO proxy has no external route (direct curl fails).
//?  3. ALLOWLIST: WITH the proxy, an ALLOWED domain (github.com) succeeds, a BLOCKED one (example.com) fails.
//? Run (needs Docker; pulls ubuntu/squid once): WS_EGRESS=1 npx tsx scripts/spike/egressSpike.mts

import { docker } from '../../server/container/runtime';
import { ensureEgressInfra, egressLaunchArgs } from '../../server/container/egress';

const IMG = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';
const ok = (label: string, cond: boolean): void => { console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const reaches = (r: { code: number; out: string }): boolean => r.code === 0 && /^[23]/.test(r.out);

const ready = await ensureEgressInfra();
ok('egress infra up (internal net + allowlist proxy)', ready);
await sleep(6000); //? let squid finish starting

await docker(['rm', '-f', 'ws-egress-spike']);
const run = await docker(['run', '-d', '--name', 'ws-egress-spike', ...egressLaunchArgs(), '--entrypoint', 'sleep', IMG, '120']);
ok('worker launched on egress net', run.code === 0);

const curl = (url: string, noProxy = false): Promise<{ code: number; out: string }> => docker([
  'exec',
  ...(noProxy ? ['-e', 'HTTP_PROXY=', '-e', 'HTTPS_PROXY=', '-e', 'http_proxy=', '-e', 'https_proxy='] : []),
  'ws-egress-spike', 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '12', url,
]);

const allowed = await curl('https://github.com');
ok(`ALLOWLIST: github.com reachable via proxy (http ${allowed.out})`, reaches(allowed));

const blocked = await curl('https://example.com');
ok(`ALLOWLIST: example.com blocked by proxy (http ${blocked.out || '-'})`, !reaches(blocked));

const direct = await curl('https://example.com', true);
ok(`ISOLATION: direct (no proxy) has no route (http ${direct.out || '-'})`, !reaches(direct));

await docker(['rm', '-f', 'ws-egress-spike']);
console.log('done');
process.exit(0);
