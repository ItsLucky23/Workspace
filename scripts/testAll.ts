//? `npm run test` — orchestrates all five test layers (contract, auth,
//? rate-limit, fuzz, custom) against a running server. The server must be
//? up already; this script does NOT boot it. Run `npm run server` first.
//?
//? Config via env:
//?   TEST_BASE_URL          — defaults to http://localhost:80
//?   TEST_SKIP              — comma-separated `<page>/<name>` to skip
//?   TEST_AUTH_TOKEN        — applied as session cookie to sweep layers
//?   TEST_FILTER            — substring match against `<page>/<name>/<version>`
//?   TEST_NO_FUZZ=1         — skip the fuzz layer
//?   TEST_NO_RATE_LIMIT=1   — skip the rate-limit layer
//?   TEST_NO_SWEEP=1        — skip all sweep layers (only run custom tests)
//?   TEST_ONLY_CUSTOM=1     — alias for TEST_NO_SWEEP
//?   TEST_NO_CUSTOM=1       — skip per-route custom tests

import { logRunAllSummary, runAllTests } from '@luckystack/test-runner';
import { apiInputSchemas } from '../src/_sockets/apiInputSchemas.generated';
import { apiMetaMap, apiMethodMap } from '../src/_sockets/apiTypes.generated';

const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:80';
const skip = (process.env.TEST_SKIP ?? '').split(',').map(s => s.trim()).filter(Boolean);
const authToken = process.env.TEST_AUTH_TOKEN || undefined;
const filter = process.env.TEST_FILTER || undefined;
const noSweep = process.env.TEST_NO_SWEEP === '1' || process.env.TEST_ONLY_CUSTOM === '1';
const noFuzz = process.env.TEST_NO_FUZZ === '1';
const noRateLimit = process.env.TEST_NO_RATE_LIMIT === '1';
const noCustom = process.env.TEST_NO_CUSTOM === '1';

console.log(`[luckystack-test] target: ${baseUrl}`);
if (filter) console.log(`[luckystack-test] filter: ${filter}`);

const summary = await runAllTests({
  apiMethodMap,
  apiMetaMap,
  apiInputSchemas,
  baseUrl,
  authToken,
  skip,
  filter,
  noSweep,
  noFuzz,
  noRateLimit,
  noCustom,
});

logRunAllSummary(summary);

if (summary.totalFailed > 0) {
  process.exit(1);
}
process.exit(0);
