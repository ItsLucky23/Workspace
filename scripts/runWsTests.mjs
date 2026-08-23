//? Runs every standalone Workspaces test (tests/**/*.test.mts) via tsx and reports a pass/fail
//? summary. Integration tests hit the real Mongo (secrets resolved at runtime) + clean up their own
//? data. Usage: `node scripts/runWsTests.mjs` (optionally `node scripts/runWsTests.mjs unit` to
//? filter by sub-dir/substring).
//?
//? PARALLEL since 2026-08-23 (test:all was ~40 min, dominated by this file's sequential walk):
//?   - a WORKER POOL runs files concurrently (unit: WS_TEST_WORKERS or cpu-1 capped at 8;
//?     integration: half that, capped at 4 — they share Mongo/Redis but own their data),
//?   - a SERIAL LANE runs last, one at a time, for tests that hold a fixed resource: a bound port,
//?     a Docker container/daemon, the writer/leader singletons, or a global aggregate (spend,
//?     capacity, Redis locks). Add a file to SERIAL when it is flaky under the pool — that is the
//?     designed escape hatch, not a failure of the pool.
//?   - `tsx` is invoked DIRECTLY (node + tsx's cli.mjs), not through `npx` (a ~1s shell round-trip
//?     per file on Windows), and NODE_COMPILE_CACHE gives every worker a shared V8 compile cache.
//?   - output is BUFFERED per file and printed on completion (no interleave); the summary prints
//?     the 10 slowest files so a future slowdown is attributable.

import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

const filter = process.argv[2] ?? '';

//? Fixed-resource tests (bound ports, Docker, writer/leader singletons, global Redis/spend
//? aggregates) — they run AFTER the pool, one at a time. Names are basenames without extension.
const SERIAL = new Set([
  'ptyAgent', 'piAgentStage', 'dockerMediaE2E', 'composeSandboxAgent', 'isolatedComposeRunner',
  'recoveryWriter', 'writerFoundation', 'multiInstance', 'forgeWriter', 'greenfield', 'controlAck',
  'conductor', 'runCommandExec', 'worktreeSave', 'buildExportD4', 'kgBudgetAndTranscode',
  'documentExport', 'designerInspiration', 'containerBranchPush', 'mergeReal', 'mergePush',
  'capacity', 'hostSpendCap', 'spend', 'userSpendAttribution', 'watchdog', 'workerReaper',
  'proxyReconciliationCron', 'timeTravel',
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.test.mts')) out.push(p);
  }
  return out;
}

const files = walk('tests').filter((f) => f.replaceAll('\\', '/').includes(filter)).sort();
const baseName = (f) => f.replaceAll('\\', '/').split('/').pop().replace('.test.mts', '');
const isUnit = (f) => f.replaceAll('\\', '/').includes('tests/unit/');

const pooled = files.filter((f) => !SERIAL.has(baseName(f)));
const serial = files.filter((f) => SERIAL.has(baseName(f)));

//? Shared V8 compile cache across all workers (node >= 22): the server graph compiles once, not
//? per file. Directory is repo-local + gitignored via node_modules placement.
const compileCache = resolve('node_modules', '.cache', 'ws-tests-compile');
mkdirSync(compileCache, { recursive: true });
const TSX = resolve('node_modules', 'tsx', 'dist', 'cli.mjs');

const cpu = availableParallelism();
const unitWorkers = Number(process.env.WS_TEST_WORKERS ?? '') || Math.min(8, Math.max(2, cpu - 1));
const integWorkers = Math.min(4, Math.max(2, Math.floor(unitWorkers / 2)));

/** Run one test file; buffered output; returns { file, ok, ms, out }. */
function runFile(file) {
  return new Promise((resolvePromise) => {
    const start = Date.now();
    const child = spawn(process.execPath, [TSX, file], {
      env: { ...process.env, NODE_COMPILE_CACHE: compileCache },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { out += String(d); });
    child.on('close', (code) => { resolvePromise({ file, ok: code === 0, ms: Date.now() - start, out }); });
    child.on('error', (error) => { resolvePromise({ file, ok: false, ms: Date.now() - start, out: out + String(error) }); });
  });
}

const results = [];
let done = 0;
const total = files.length;

function printResult(r) {
  done += 1;
  const mark = r.ok ? '[32m✓[0m' : '[31m✗[0m';
  console.log(`[36m[${String(done)}/${String(total)}][0m ${mark} ${r.file} [2m(${(r.ms / 1000).toFixed(1)}s)[0m`);
  //? Full output only for failures (a green file's log is noise at this scale); failures print
  //? everything so the fix needs no re-run.
  if (!r.ok) console.log(r.out.trimEnd());
}

/** Run `list` through a pool of `size` workers. */
async function pool(list, size) {
  const queue = [...list];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const r = await runFile(file);
      results.push(r);
      printResult(r);
    }
  });
  await Promise.all(workers);
}

const startedAt = Date.now();
//? Units are pure → the wide pool; integration files share Mongo/Redis → the narrow pool; the
//? serial lane last so a fixed-resource test never races a pooled one for the same port/daemon.
await pool(pooled.filter((f) => isUnit(f)), unitWorkers);
await pool(pooled.filter((f) => !isUnit(f)), integWorkers);
for (const file of serial) {
  const r = await runFile(file);
  results.push(r);
  printResult(r);
}

const failedFiles = results.filter((r) => !r.ok).map((r) => r.file);
const passed = results.length - failedFiles.length;
const totalS = ((Date.now() - startedAt) / 1000).toFixed(0);

const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 10);
console.log('\n[2mSlowest files:[0m');
for (const r of slowest) console.log(`  [2m${(r.ms / 1000).toFixed(1)}s  ${r.file}[0m`);

console.log(`\n[1m=== ${String(passed)}/${String(results.length)} test files passed (${totalS}s, unit×${String(unitWorkers)} / integration×${String(integWorkers)} / serial×1) ===[0m`);
if (failedFiles.length > 0) {
  console.error('Failed files:\n' + failedFiles.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
