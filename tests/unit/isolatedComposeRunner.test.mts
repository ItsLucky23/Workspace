//? Unrestricted Compose runner boundary. The app does not sanitize user Compose when — and only when — it is
//? sent over TLS to a root-configured URL that varies by workspace. Tests use a fake transport; no Docker/network.

import { assert, eq, report } from '../_helpers.mts';
import {
  createIsolatedComposeRunner,
  isolatedComposeRunnerConfig,
  resolveIsolatedComposeRunnerUrl,
} from '../../server/container/isolatedComposeRunner.ts';

const wsA = '507f1f77bcf86cd799439011';
const wsB = '507f191e810c19729de860ea';
const template = 'https://compose.example/workspaces/{workspaceId}/';

eq(resolveIsolatedComposeRunnerUrl(template, wsA, 'up')?.href, `https://compose.example/workspaces/${wsA}/v1/compose/up`, 'workspace A receives its own sandbox endpoint');
assert(resolveIsolatedComposeRunnerUrl(template, wsA, 'up')?.href !== resolveIsolatedComposeRunnerUrl(template, wsB, 'up')?.href, 'two workspaces can never resolve to one URL');
eq(resolveIsolatedComposeRunnerUrl('http://compose.example/{workspaceId}/', wsA, 'up'), null, 'plaintext runner URLs are refused');
eq(resolveIsolatedComposeRunnerUrl('https://compose.example/shared/', wsA, 'up'), null, 'a shared URL without workspace identity is refused');
eq(resolveIsolatedComposeRunnerUrl('https://user:secret@compose.example/{workspaceId}/', wsA, 'up'), null, 'credentials in runner URLs are refused');
eq(isolatedComposeRunnerConfig({ WS_COMPOSE_RUNNER_URL_TEMPLATE: template }), null, 'a runner without bearer token is disabled');

let calledUrl = '';
let authorization = '';
let sentCompose = '';
const transport: typeof fetch = async (input, init) => {
  calledUrl = String(input);
  authorization = new Headers(init?.headers).get('authorization') ?? '';
  const body: unknown = JSON.parse(String(init?.body ?? '{}'));
  if (body !== null && typeof body === 'object' && 'compose' in body && typeof body.compose === 'string') sentCompose = body.compose;
  return new Response(JSON.stringify({ ok: true, services: ['db'], env: { DATABASE_URL: 'postgres://gateway/db', 'BAD-KEY': 'drop' } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const runner = createIsolatedComposeRunner({ urlTemplate: template, token: 'runner-secret' }, transport);
const unrestricted = 'services:\n  db:\n    image: postgres\n    privileged: true\n    volumes:\n      - /:/host\n';
const result = await runner.up({ workspaceId: wsA, project: 'ws-a-db', compose: unrestricted });

assert(result.ok, 'the dedicated sandbox accepts unrestricted Compose');
eq(calledUrl, `https://compose.example/workspaces/${wsA}/v1/compose/up`, 'up reaches only the workspace endpoint');
eq(authorization, 'Bearer runner-secret', 'the runner call is bearer authenticated');
eq(sentCompose, unrestricted, 'privileged/bind syntax is preserved byte-for-byte for the isolated VM');
eq(result.services, ['db'], 'bounded service names are accepted');
eq(result.env.DATABASE_URL, 'postgres://gateway/db', 'the runner can return an explicit cross-daemon gateway endpoint');
assert(!('BAD-KEY' in result.env), 'invalid environment keys are dropped');

report('tests/unit/isolatedComposeRunner.test.mts');
