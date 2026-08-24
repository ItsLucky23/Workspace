//? Production server bundle. Compiles `server/server.ts` (TypeScript ESM) down
//? to `dist/server.js`, which `npm run prod` runs. Unlike the framework repo's
//? own bundler, a SCAFFOLDED project resolves every `@luckystack/*` package (and
//? all other runtime deps) from `node_modules` at runtime — so we mark them all
//? `external` and let Node resolve them, instead of aliasing into monorepo
//? sources. esbuild only inlines the project's OWN `server/`, `shared/`,
//? `config.ts`, and `luckystack/` overlay code.
//?
//? The `luckystack/` overlay needs special handling: the framework discovers and
//? `import()`s those `.ts` files at RUNTIME (`loadOverlayFolder`), which works
//? under tsx but not under plain `node dist/server.js` (".ts" is not loadable).
//? So this script enumerates the overlay AT BUILD TIME (same rules as the
//? framework walk: OVERLAY_ORDER across dirs, index first then sorted, .ts/.js,
//? no recursion, no test files) and emits a synthetic entry that registers the
//? inlined files via `registerOverlayLoader` before importing the real server.
//? `@luckystack/server` stays external, so the entry and the framework share one
//? module instance at runtime and the hook actually lands.
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OVERLAY_ORDER } from '@luckystack/server';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

//? Everything declared as a (dev)dependency resolves from node_modules in prod,
//? so it must stay external — bundling it in would duplicate code and break
//? packages that rely on their own package.json / native bindings (e.g. sharp,
//? prisma, socket.io).
const dependencyNames = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
];

const nodeBuiltins = builtinModules.flatMap((moduleName) => {
  const normalized = moduleName.replace(/^node:/, '');
  return [normalized, `node:${normalized}`];
});

//? Optional peer-deps that some `@luckystack/*` adapters reach behind a runtime
//? `require.resolve` guard + dynamic `import()`. They may not be installed; mark
//? them external so the bundle builds regardless of which adapters are wired.
const optionalPeerDeps = [
  'nodemailer', 'resend',
  '@sentry/node', 'dd-trace', 'hot-shots', 'posthog-node',
  '@luckystack/secret-manager', '@luckystack/email',
];

const external = [...new Set([...dependencyNames, ...nodeBuiltins, ...optionalPeerDeps])];

//? Mirror of the framework's `collectOverlayEntries`: index first, the rest
//? name-sorted; only top-level .ts/.js; test files skipped.
const isTestFile = (name) => /\.tests?\.(ts|js|mts|mjs)$/.test(name) || name.includes('.test.');
const collectOverlayFiles = () => {
  const overlayRoot = path.join(projectRoot, 'luckystack');
  if (!fs.existsSync(overlayRoot)) return [];
  const files = [];
  for (const packageName of OVERLAY_ORDER) {
    const packageDir = path.join(overlayRoot, packageName);
    if (!fs.existsSync(packageDir)) continue;
    const entries = fs.readdirSync(packageDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(ts|js)$/.test(e.name) && !isTestFile(e.name))
      .map((e) => e.name)
      .toSorted((a, b) => a.localeCompare(b));
    const indexFirst = [
      ...entries.filter((n) => n === 'index.ts' || n === 'index.js'),
      ...entries.filter((n) => n !== 'index.ts' && n !== 'index.js'),
    ];
    files.push(...indexFirst.map((n) => `./luckystack/${packageName}/${n}`));
  }
  return files;
};

const overlayFiles = collectOverlayFiles();
const entrySource = [
  "import { registerOverlayLoader } from '@luckystack/server';",
  'registerOverlayLoader(async () => {',
  ...overlayFiles.map((f) => `  await import(${JSON.stringify(f)});`),
  '});',
  "await import('./server/server.ts');",
].join('\n');

//? Source maps are OFF by default: shipping `dist/server.js.map` beside the
//? bundle leaks the full readable server source (a source-disclosure risk if a
//? consumer ever wires real dist/-rooted static serving). Opt in for local
//? debugging with `BUNDLE_SERVER_SOURCEMAP=1`; production builds stay map-free.
const enableSourcemap = process.env.BUNDLE_SERVER_SOURCEMAP === '1';

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: projectRoot,
      sourcefile: 'bundleEntry.generated.ts',
      loader: 'ts',
    },
    outfile: 'dist/server.js',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: enableSourcemap,
    external,
    logLevel: 'info',
  });
  console.log(`[bundle:server] inlined ${String(overlayFiles.length)} overlay file(s): ${overlayFiles.join(', ')}`);
  process.exit(0);
} catch (error) {
  console.error('Server bundle failed:', error);
  process.exit(1);
}
