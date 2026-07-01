#!/usr/bin/env node
//? `npm run help` — prints every npm script in this project, grouped by purpose
//? with a one-line use-case, an example invocation, and any optional parameters.
//? Reads the sibling package.json dynamically (so newly added scripts still show
//? up under "Other"), and merges it with the curated metadata below. Keep this
//? map in sync when you add a script you want documented.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const scripts = JSON.parse(fs.readFileSync(PKG, 'utf8')).scripts ?? {};

//? color helpers — no-op when output is not a TTY (piped / CI logs stay clean).
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `[${code}m${s}[0m` : s);
const bold = (s) => c('1', s);
const cyan = (s) => c('36', s);
const dim = (s) => c('2', s);
const green = (s) => c('32', s);

//? name -> { desc, example?, params? }. `group` ordering is the array below.
const META = {
  // Dev
  client: { desc: 'Start the Vite dev server (frontend, hot reload).', example: 'npm run client' },
  server: {
    desc: 'Start the backend dev server via the supervisor (hot-reloads on config.ts / .env / server changes). This is your normal dev command.',
    example: 'npm run server',
    params: 'SERVER_PORT_AUTO_INCREMENT=1 auto-picks the next free port if SERVER_PORT is taken (off by default).',
  },
  'server:direct': { desc: 'Boot the backend ONCE without the supervisor (no hot reload).', example: 'npm run server:direct' },
  cluster: {
    desc: 'Boot a SECOND backend instance on a custom port for the local multi-instance test (no hot reload).',
    example: 'npm run cluster -- 4101',
    params: '<port> is required.',
  },
  router: { desc: 'Run the load-balancer/router process in front of multiple service nodes.', example: 'npm run router' },

  // Build & bundle
  build: { desc: 'Full production build: packages + generated artifacts + client + server bundle.', example: 'npm run build' },
  'build:packages': { desc: 'Build all @luckystack/* packages in dependency order.', example: 'npm run build:packages' },
  buildClient: { desc: 'Build only the client (type maps + tsc + vite build).', example: 'npm run buildClient' },
  buildServer: { desc: 'Build only the server bundle (artifacts + bundleServer).', example: 'npm run buildServer' },
  generateArtifacts: { desc: 'Regenerate API/sync type maps + server request types from your routes.', example: 'npm run generateArtifacts' },
  'pack:dry': { desc: 'Build + `npm pack --dry-run` every package (validate tarball contents, write nothing).', example: 'npm run pack:dry' },
  prod: { desc: 'Run the built production server (dist/server.js).', example: 'npm run prod' },

  // Test
  test: { desc: 'Full test run: per-route business-logic tests + auto-sweep (contract/auth/rate-limit/fuzz).', example: 'npm run test' },
  'test:unit': { desc: 'Run the Vitest unit suite.', example: 'npm run test:unit' },
  'test:integration': { desc: 'Run integration tests (need Redis/DB infra).', example: 'npm run test:integration' },
  typecheck: { desc: 'Type-check the project without emitting files.', example: 'npm run typecheck' },

  // Lint
  lint: { desc: 'Lint the project (client + server).', example: 'npm run lint' },
  'lint:client': { desc: 'Lint client code (src/).', example: 'npm run lint:client' },
  'lint:server': { desc: 'Lint server code (server/, shared/, config.ts).', example: 'npm run lint:server' },
  'lint:all': { desc: 'Lint client then server.', example: 'npm run lint:all' },
  'lint:packages': { desc: 'Lint the framework packages (packages/*/src).', example: 'npm run lint:packages' },

  // Versioning & publish
  bump: {
    desc: 'Bump every package version by a semver level (also rewrites internal ^ dep ranges).',
    example: 'npm run bump patch',
    params: 'patch | minor | major. Add `-- --dry-run` to preview without writing.',
  },
  'publish:packages': { desc: 'Build + publish all packages to npm in dependency order.', example: 'npm run publish:packages' },
  'publish:dry': { desc: 'Dry-run publish (validate every tarball, upload nothing).', example: 'npm run publish:dry' },

  // Database
  'prisma:generate': { desc: 'Regenerate the Prisma client after editing schema.prisma.', example: 'npm run prisma:generate' },
  'prisma:db:push': { desc: 'Push the Prisma schema to the database (no migration history).', example: 'npm run prisma:db:push' },

  // AI indexes
  'ai:index': { desc: 'Regenerate docs/AI_QUICK_INDEX.md (cross-repo surfaces).', example: 'npm run ai:index' },
  'ai:capabilities': { desc: 'Regenerate the helper/component capability snapshot.', example: 'npm run ai:capabilities' },
  'ai:project-index': { desc: 'Regenerate the routes/pages/helpers inventory.', example: 'npm run ai:project-index' },
  'ai:decisions': { desc: 'Regenerate docs/AI_DECISIONS_INDEX.md from docs/decisions/ ADRs.', example: 'npm run ai:decisions' },
  'ai:runbooks': { desc: 'Regenerate docs/AI_RUNBOOKS.md (task-shaped golden paths).', example: 'npm run ai:runbooks' },
  'ai:product': { desc: 'Regenerate docs/AI_PRODUCT_OVERVIEW.md (intent layer).', example: 'npm run ai:product' },
  'ai:graph': { desc: 'Regenerate docs/ai-graph.json (dependency + call graph).', example: 'npm run ai:graph' },
  'ai:lint': { desc: 'Run the CLAUDE.md invariant linter (no as-any / arbitrary colors / untranslated JSX).', example: 'npm run ai:lint' },

  // Scaffolding
  'scaffold:test': { desc: 'Create a per-route test stub.', example: 'npm run scaffold:test playground/getData/v1', params: '<page>/<name>/<version>' },
  'scaffold:page': { desc: 'Scaffold a new page.', example: 'npm run scaffold:page dashboard', params: '<path>' },

  // Bun (experimental)
  'bun:check': { desc: 'Check Bun runtime compatibility.', example: 'npm run bun:check' },
  'bun:server': { desc: 'Run the dev server under Bun.', example: 'npm run bun:server' },
  'bun:prod': { desc: 'Run the production server under Bun.', example: 'npm run bun:prod' },

  // Help
  help: { desc: 'Show this command reference.', example: 'npm run help' },
};

const GROUPS = [
  ['Dev', ['client', 'server', 'server:direct', 'cluster', 'router']],
  ['Build & bundle', ['build', 'build:packages', 'buildClient', 'buildServer', 'generateArtifacts', 'pack:dry', 'prod']],
  ['Test', ['test', 'test:unit', 'test:integration', 'typecheck']],
  ['Lint', ['lint', 'lint:client', 'lint:server', 'lint:all', 'lint:packages']],
  ['Versioning & publish', ['bump', 'publish:packages', 'publish:dry']],
  ['Database (Prisma)', ['prisma:generate', 'prisma:db:push']],
  ['AI indexes', ['ai:index', 'ai:capabilities', 'ai:project-index', 'ai:decisions', 'ai:runbooks', 'ai:product', 'ai:graph', 'ai:lint']],
  ['Scaffolding', ['scaffold:test', 'scaffold:page']],
  ['Bun (experimental)', ['bun:check', 'bun:server', 'bun:prod']],
  ['Help', ['help']],
];

//? Lifecycle scripts npm runs automatically — not meant to be invoked by hand.
const HIDDEN = new Set(['postinstall', 'prepare']);

const printEntry = (name) => {
  const meta = META[name];
  const desc = meta ? meta.desc : dim(scripts[name]);
  console.log(`  ${green('npm run ' + name)}`);
  console.log(`      ${desc}`);
  if (meta?.params) console.log(`      ${dim('params: ' + meta.params)}`);
  if (meta?.example) console.log(`      ${dim('e.g.  ' + meta.example)}`);
};

console.log(`\n${bold('LuckyStack — available commands')}  ${dim('(npm run <command>)')}\n`);

const shown = new Set();
for (const [title, names] of GROUPS) {
  const present = names.filter((n) => n in scripts);
  if (present.length === 0) continue;
  console.log(cyan(`▸ ${title}`));
  for (const n of present) {
    printEntry(n);
    shown.add(n);
  }
  console.log('');
}

//? Anything in package.json we didn't group + don't hide.
const other = Object.keys(scripts).filter((n) => !shown.has(n) && !HIDDEN.has(n));
if (other.length > 0) {
  console.log(cyan('▸ Other'));
  for (const n of other) printEntry(n);
  console.log('');
}

console.log(dim('Tip: flags after the command need a `--` separator, e.g.  npm run bump patch -- --dry-run\n'));
