//? FASE SEC (COMPLETION) — pure security guards. Locks down: SEC6 the webhook SSRF-blocklist
//? (loopback/private/link-local/metadata/internal names), SEC9 the git-auth split (token NEVER in
//? the URL/argv; only the username convention stays in the URL, the token travels via GIT_ASKPASS
//? env), and SEC8 env-teardown now requires a client confirm (CONFIRM_REQUIRED).

import { assert, eq, report } from '../_helpers.mts';
import { isBlockedWebhookTarget } from '../../server/automation/executor';
import { withAuth, authEnv } from '../../server/git/repoStore';
import { CONFIRM_REQUIRED } from '../../src/workspaces/_functions/controlApi';

try {
  // ---- SEC6 — SSRF blocklist
  for (const bad of [
    'http://localhost/hook', 'http://sub.localhost/x', 'https://foo.local/x', 'https://ci.internal/x',
    'http://127.0.0.1/hook', 'http://127.9.9.9/x', 'http://0.0.0.0/x',
    'http://10.1.2.3/x', 'http://172.16.0.1/x', 'http://172.31.255.255/x', 'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data', 'http://[::1]/x', 'http://[fe80::1]/x', 'http://[fd12::1]/x',
    'not a url',
  ]) assert(isBlockedWebhookTarget(bad), `blocked: ${bad}`);
  for (const ok of [
    'https://hooks.slack.com/services/x', 'https://example.com/webhook', 'http://203.0.113.7/x',
    'https://172.15.0.1/x', 'https://172.32.0.1/x', 'https://11.0.0.1/x',
  ]) assert(!isBlockedWebhookTarget(ok), `allowed: ${ok}`);

  // ---- SEC9 — token never in the URL/argv
  const url = withAuth('https://gitlab.example.com/group/repo.git', 'glpat-SECRET123');
  assert(!url.includes('SECRET123'), 'the token is NOT embedded in the git URL');
  eq(url, 'https://oauth2@gitlab.example.com/group/repo.git', 'GitLab keeps only the oauth2 username');
  eq(withAuth('https://github.com/o/r.git', 'ghs_SECRET'), 'https://x-access-token@github.com/o/r.git', 'GitHub keeps only the x-access-token username');
  eq(withAuth('https://github.com/o/r.git', undefined), 'https://github.com/o/r.git', 'no token → URL unchanged');
  const env = authEnv('glpat-SECRET123');
  eq(env.WS_GIT_ASKPASS_TOKEN, 'glpat-SECRET123', 'the token travels via the spawn env');
  assert((env.GIT_ASKPASS ?? '').length > 0, 'GIT_ASKPASS points at the helper script');
  eq(env.GIT_TERMINAL_PROMPT, '0', 'git hard-fails instead of prompting');
  eq(Object.keys(authEnv(undefined)).length, 0, 'no token → no auth env');

  // ---- SEC8 — env-teardown is confirm-gated client-side
  assert(CONFIRM_REQUIRED.has('env-teardown'), 'env-teardown is in CONFIRM_REQUIRED');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/securityGuards.test.mts');
