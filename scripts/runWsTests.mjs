//? Runs every standalone Workspaces test (tests/**/*.test.mts) via tsx, sequentially,
//? and reports a pass/fail summary. Integration/e2e tests hit the real Mongo (secrets
//? resolved at runtime) + clean up their own data. Usage: `node scripts/runWsTests.mjs`
//? (optionally `node scripts/runWsTests.mjs unit` to filter by sub-dir).

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const filter = process.argv[2] ?? '';

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
let passed = 0;
let failed = 0;
const failedFiles = [];

for (const file of files) {
  console.log(`\n[36m▶ ${file}[0m`);
  try {
    execFileSync('npx', ['tsx', file], { stdio: 'inherit', shell: true });
    passed += 1;
  } catch {
    failed += 1;
    failedFiles.push(file);
  }
}

console.log(`\n[1m=== ${String(passed)}/${String(files.length)} test files passed ===[0m`);
if (failed > 0) {
  console.error('Failed files:\n' + failedFiles.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
