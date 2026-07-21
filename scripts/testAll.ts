//? `npm run test` — orchestrates all five test layers (contract, auth,
//? rate-limit, fuzz, custom) against a running server. The server must be
//? up already; this script does NOT boot it. Run `npm run server` first.
//?
//? Config via env:
//?   TEST_BASE_URL          — defaults to the ACTUAL bound dev-server port (dev-server.json,
//?                            falling back to config.ports.backend); 127.0.0.1, not localhost
//?   TEST_SKIP              — comma-separated `<page>/<name>` to skip
//?   TEST_AUTH_TOKEN        — applied as session cookie to sweep layers
//?   TEST_FILTER            — substring match against `<page>/<name>/<version>`
//?   TEST_NO_FUZZ=1         — skip the fuzz layer
//?   TEST_NO_RATE_LIMIT=1   — skip the rate-limit layer
//?   TEST_NO_SWEEP=1        — skip all sweep layers (only run custom tests)
//?   TEST_ONLY_CUSTOM=1     — alias for TEST_NO_SWEEP
//?   TEST_NO_CUSTOM=1       — skip per-route custom tests

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { logRunAllSummary, runAllTests } from '@luckystack/test-runner';
import { apiInputSchemas } from '../src/_sockets/apiInputSchemas.generated';
import { apiMetaMap, apiMethodMap } from '../src/_sockets/apiTypes.generated';
import { ports } from '../config.ports';

//? Default target: the ACTUAL bound backend port — the dev server hops off a busy port and records
//? the real one in dev-server.json (lesson 0015; same pattern as vite.config.ts). 127.0.0.1 instead
//? of localhost: the latter intermittently fails DNS resolution on this platform.
const readBackendPort = (fallback: string): string => {
  try {
    const raw = readFileSync(path.join(process.cwd(), 'node_modules', '.luckystack', 'dev-server.json'), 'utf8');
    const info = JSON.parse(raw) as { port?: number };
    return info.port ? String(info.port) : fallback;
  } catch {
    return fallback;
  }
};
const baseUrl = process.env.TEST_BASE_URL ?? `http://127.0.0.1:${readBackendPort(String(ports.backend))}`;
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
