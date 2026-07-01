// scripts/scaffoldRouteTest.mjs
//
// Creates a per-route business-logic test stub alongside an existing API or
// sync route. Refuses to overwrite. Inlines the route's input shape (parsed
// from `src/_sockets/apiTypes.generated.ts`) so the AI doesn't have to look
// it up.
//
// Usage:
//   npm run scaffold:test settings/revokeSession/v1
//   npm run scaffold:test playground/echo/v1
//
// Pure-Node ESM. No framework imports.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const GENERATED_TYPES_FILE = path.join(SRC_DIR, '_sockets', 'apiTypes.generated.ts');

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};

const fail = (message) => {
  console.error(`[scaffold:test] ${message}`);
  process.exit(1);
};

const arg = process.argv[2];
if (!arg) {
  fail('Usage: npm run scaffold:test <page>/<name>/<version>\nExample: npm run scaffold:test settings/revokeSession/v1');
}

const parts = arg.split('/');
if (parts.length < 3) {
  fail(`Invalid route path "${arg}". Expected format: <page>/<name>/<version> (e.g. settings/revokeSession/v1). Nested pages are supported: admin/users/list/v1`);
}

const version = parts.at(-1);
const name = parts.at(-2);
const page = parts.slice(0, -2).join('/');
const versionMatch = /^v(\d+)$/.exec(version);
if (!versionMatch) fail(`Version "${version}" should look like "v1", "v2", …`);
const versionNumber = versionMatch[1];

// ---------------------------------------------------------------------------
// Locate the route source file
// ---------------------------------------------------------------------------

const apiSourcePath = path.join(SRC_DIR, page, '_api', `${name}_v${versionNumber}.ts`);
const syncSourcePath = path.join(SRC_DIR, page, '_sync', `${name}_server_v${versionNumber}.ts`);

const [apiStatErr] = await safe(fs.access(apiSourcePath));
const [syncStatErr] = await safe(fs.access(syncSourcePath));

let kind, sourcePath, testPath;
if (!apiStatErr) {
  kind = 'api';
  sourcePath = apiSourcePath;
  testPath = path.join(SRC_DIR, page, '_api', `${name}_v${versionNumber}.tests.ts`);
} else if (!syncStatErr) {
  kind = 'sync';
  sourcePath = syncSourcePath;
  testPath = path.join(SRC_DIR, page, '_sync', `${name}_server_v${versionNumber}.tests.ts`);
} else {
  fail(`No route found at \`${page}/${name}/${version}\`. Tried:\n  - ${path.relative(REPO_ROOT, apiSourcePath)}\n  - ${path.relative(REPO_ROOT, syncSourcePath)}`);
}

// ---------------------------------------------------------------------------
// Refuse to overwrite
// ---------------------------------------------------------------------------

const [existsErr] = await safe(fs.access(testPath));
if (!existsErr) {
  fail(`Test file already exists at \`${path.relative(REPO_ROOT, testPath)}\`. Delete it first if you want to regenerate.`);
}

// ---------------------------------------------------------------------------
// Extract the input shape from the generated type map
// ---------------------------------------------------------------------------

const extractInputShape = async () => {
  const [readErr, source] = await safe(fs.readFile(GENERATED_TYPES_FILE, 'utf8'));
  if (readErr) return null;
  const mapAlias = kind === 'api' ? '_ProjectApiTypeMap' : '_ProjectSyncTypeMap';
  const inputField = kind === 'api' ? 'input' : 'clientInput';

  //? Find the alias body via brace-balanced scan.
  const aliasMatch = new RegExp(`type\\s+${mapAlias}\\s*=\\s*\\{`).exec(source);
  if (!aliasMatch) return null;
  let depth = 1;
  let i = aliasMatch.index + aliasMatch[0].length;
  const bodyStart = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0) break;
    i += 1;
  }
  const body = source.slice(bodyStart, i);

  //? Walk to the right page/name/version and extract the inputField block.
  const lines = body.split('\n');
  let curPage = null;
  let curName = null;
  let curVersion = null;
  let inLeaf = false;
  let leafDepth = 0;
  let leafLines = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (inLeaf) {
      leafLines.push(line);
      for (const ch of line) {
        if (ch === '{') leafDepth += 1;
        else if (ch === '}') leafDepth -= 1;
      }
      if (leafDepth === 0) {
        if (curPage === page && curName === name && curVersion === `v${versionNumber}`) {
          const leafBody = leafLines.join('\n');
          const inputRe = new RegExp(`^(\\s*)${inputField}:\\s*\\{`, 'm');
          const inputMatch = inputRe.exec(leafBody);
          if (!inputMatch) return null;
          let d = 1;
          let j = inputMatch.index + inputMatch[0].length;
          const start = j;
          while (j < leafBody.length && d > 0) {
            const ch = leafBody[j];
            if (ch === '{') d += 1;
            else if (ch === '}') d -= 1;
            if (d === 0) break;
            j += 1;
          }
          return `{${leafBody.slice(start, j)}}`;
        }
        leafLines = [];
        inLeaf = false;
        curVersion = null;
      }
      continue;
    }
    const pageMatch = line.match(/^  (?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*\{$/);
    if (pageMatch) { curPage = pageMatch[1] ?? pageMatch[2]; continue; }
    const nameMatch = line.match(/^    (?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*\{$/);
    if (nameMatch) { curName = nameMatch[1] ?? nameMatch[2]; continue; }
    const versionMatchLine = line.match(/^      (?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*\{$/);
    if (versionMatchLine) {
      curVersion = versionMatchLine[1] ?? versionMatchLine[2];
      inLeaf = true;
      leafDepth = 1;
      leafLines = [];
    }
  }
  return null;
};

const inputShape = await extractInputShape();
const inputShapeComment = inputShape
  ? inputShape.split('\n').map(l => `//?   ${l}`).join('\n')
  : '//?   (shape not detected — open the route source for reference)';

// ---------------------------------------------------------------------------
// Render the stub
// ---------------------------------------------------------------------------

const callFnName = kind === 'api' ? 'callApi' : 'callSync';
const stub = `import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for \`${page}/${name}/${version}\`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Add cases below for the
//? business-logic assertions the sweep can't reach.
//?
//? Suggested scenarios — replace placeholders with real assertions:
//? [ ] Happy path with valid input → expected output shape + side effects
//? [ ] Authenticated user A cannot affect user B's data
//? [ ] Post-conditions: did the expected hook fire? row inserted? cache invalidated?
//? [ ] Edge case: missing optional field, boundary values, unusual but valid input
//? [ ] Idempotency: calling twice with the same input is safe (if applicable)
//?
//? Input shape (from \`src/_sockets/apiTypes.generated.ts\`):
${inputShapeComment}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path returns success',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      // const result = await ctx.${callFnName}({ /* TODO: fill in valid input */ });
      // ctx.expect.eq(result.status, 'success');
      throw new Error('TODO: implement this test case');
    },
  },
];
`;

await fs.writeFile(testPath, stub, 'utf8');
console.log(`[scaffold:test] created ${path.relative(REPO_ROOT, testPath)}`);
console.log(`[scaffold:test] next: open the file and replace the placeholder with real assertions, then run \`npm run test -- --filter ${page}/${name}/${version}\``);
