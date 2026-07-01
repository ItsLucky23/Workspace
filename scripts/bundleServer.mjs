//? Production server bundle. Compiles `server/server.ts` (TypeScript ESM) down
//? to `dist/server.js`, which `npm run prod` runs. Unlike the framework repo's
//? own bundler, a SCAFFOLDED project resolves every `@luckystack/*` package (and
//? all other runtime deps) from `node_modules` at runtime — so we mark them all
//? `external` and let Node resolve them, instead of aliasing into monorepo
//? sources. esbuild only inlines the project's OWN `server/`, `shared/`,
//? `config.ts`, and `luckystack/` overlay code.
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

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

//? Source maps are OFF by default: shipping `dist/server.js.map` beside the
//? bundle leaks the full readable server source (a source-disclosure risk if a
//? consumer ever wires real dist/-rooted static serving). Opt in for local
//? debugging with `BUNDLE_SERVER_SOURCEMAP=1`; production builds stay map-free.
const enableSourcemap = process.env.BUNDLE_SERVER_SOURCEMAP === '1';

build({
  entryPoints: ['server/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: enableSourcemap,
  external,
  logLevel: 'info',
}).catch((error) => {
  console.error('Server bundle failed:', error);
  process.exit(1);
});
