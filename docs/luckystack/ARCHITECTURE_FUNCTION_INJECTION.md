# Architecture — Function Injection

> How the `functions.X` parameter on every API + sync handler gets built. Spec last updated 2026-05-22.

## What it is

Every API handler at `src/{page}/_api/{name}_v{N}.ts` and every sync handler at `src/{page}/_sync/{name}_server_v{N}.ts` receives a `functions` parameter alongside `data`, `user`, etc.:

```ts
export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const [error, parsed] = await functions.tryCatch.tryCatch(() => JSON.parse(data.rawJson));
  if (error) return { status: 'error', errorCode: 'invalid' };
  await functions.sleep.sleep(50);
  return { status: 'success', result: { id: await functions.db.prisma.user.create({ data: parsed }) } };
};
```

The `functions` object is **assembled at boot** by walking a configured list of source directories, evaluating each `.ts` file as a module, and stitching the modules into a nested record. The generated `Functions` interface in `src/_sockets/apiTypes.generated.ts` provides type information so the handler's `functions.X.Y` accesses are fully typed.

## Source directories

Configured via `ProjectConfig.paths.serverFunctionDirs` (default `['functions', 'shared']`). The codegen and runtime walk every listed directory in order and merge the results.

| Directory | Default role |
|---|---|
| `functions/` | Consumer-edited shims. The framework scaffolds `functions/{db,redis,sentry,session,example}.ts` — re-exports of the canonical `@luckystack/*` primitives that consumers can wrap, log around, or replace with their own implementation. |
| `shared/` | Cross-cutting framework helpers — `tryCatch`, `sleep`, and any other module the framework wants on the injection surface without the consumer having to wrap it. |

Override the list to add more roots or change the order:

```ts
import { registerProjectConfig } from '@luckystack/core';

registerProjectConfig({
  paths: {
    serverFunctionDirs: ['functions', 'shared', 'my-tenant-overrides'],
  },
});
```

Backwards compat: the deprecated singular `serverFunctionsDir: string` is still honored — it becomes a single-entry list when `serverFunctionDirs` is absent.

## Filename → access path

For a `.ts` file at `<root>/<sub1>/<sub2>/<file>.ts` with `export const foo = (…) => …`:

```
functions.<sub1>.<sub2>.<file>.foo
```

Nested subdirectories work transparently. A file at `functions/admin/audit/log.ts` with `export const append = …` shows up as `functions.admin.audit.log.append(…)` on every handler.

### Special case — default-only re-exports

A module that only exports a `default` re-export — e.g. `shared/tryCatch.ts`:

```ts
export { default } from '../packages/core/src/tryCatch';
```

The codegen aliases the `default` slot to the filename, so handlers call `functions.tryCatch.tryCatch(…)` rather than `functions.tryCatch.default(…)`. The aliasing happens **only** when the file's sole export is `default` — files with both `default` and named exports keep both keys verbatim.

### Special case — `export default <ident>`

When a file uses `export default someFunction` AND also exports `someFunction` as a named export, the codegen drops the duplicate `default` key. If `someFunction` is the only export of any kind, the `default` slot becomes a top-level key under the filename. This is the legacy form; new code should prefer the `export { default } from '…'` re-export style above when no wrapping is needed.

## Conflict policy

If the same key path is produced by two different root directories — e.g. `functions/sleep.ts` AND `shared/sleep.ts` both contributing `functions.sleep` — the codegen fails the build with:

```
[function-injection] Conflict at `functions.sleep`: defined in both `<repo>/functions/sleep.ts` and `<repo>/shared/sleep.ts`. Delete one — `shared/` is the canonical location for framework re-exports.
```

Two directories with the same name (e.g. `functions/admin/` AND `shared/admin/`) **merge silently** as long as their leaf files don't collide. `functions/admin/users.ts` plus `shared/admin/roles.ts` is fine; both `functions/admin/users.ts` AND `shared/admin/users.ts` is a conflict.

Runtime mirrors the codegen's error: dev-mode hot reload logs the same diagnostic and skips the duplicate copy. The next type-map regeneration will fail the build, surfacing the conflict at PR time.

## How to add a new injected function

1. Write the source file. Use whichever root makes sense — `functions/` if it's a consumer override layer, `shared/` if it's a framework-wide helper.
2. Export at least one named export (or a `default` re-export — see special case above).
3. Run `npm run generateArtifacts` to regenerate `src/_sockets/apiTypes.generated.ts`.
4. Run `npm run ai:capabilities` to refresh `docs/AI_CAPABILITIES.md` so the next AI session sees the new function without re-discovering it.

## How the codegen walks files

Implementation lives at `packages/devkit/src/typeMap/functionsMeta.ts`. The function-extraction pipeline:

1. `walkDirToIR(dir)` — recursive descent for one root, returns an in-memory IR (`IRDirNode` of files and subdirs).
2. `mergeIR(target, source)` — merges two IRs with conflict detection at every level.
3. `serializeIRDir(merged, indent)` — emits the `interface Functions {…}` body.

Per file, the parser handles four export forms:

- `export const NAME = (…) => …` — extract via TypeChecker for typed arrow / function expression signature.
- `export function NAME(…)` — same.
- `export { NAME } from 'module'` — resolves to `typeof import('module')['NAME']`, which TypeScript then expands at compile time so consumers get real types instead of `any`.
- `export default …` — handled per the special-cases above.

When a `export { redis }` is bound to a local identifier from an `import` (no `from '…'` clause), the parser falls back to `any` because the named export form alone doesn't carry the source module. Prefer `export { redis, redis as default } from '@luckystack/core'` over `import { redis } …; export { redis }; export default redis;` in framework shims for this reason.

## Runtime loader

The dev-mode loader at `packages/devkit/src/loader.ts` mirrors the codegen walk. Each `.ts` file is loaded via dynamic `import()`, the module's resolved exports are placed under the corresponding nested key in `devFunctions`, and the running handler receives a reference to that object.

The runtime keeps a `functionClaimMap` so a duplicate file between two roots logs the conflict diagnostic at hot-reload time without crashing the dev server. The build still fails on next type-map regen.

## Scaffold story

A fresh scaffold from `npx create-luckystack-app` ships:

- `functions/` — 5 consumer-editable shim files (`db`, `redis`, `sentry`, `session`, `example`) re-exporting the canonical `@luckystack/*` primitives.
- `shared/` — 2 framework helpers (`tryCatch`, `sleep`).

Both are walked by the default `serverFunctionDirs: ['functions', 'shared']`. After scaffold, `functions.tryCatch.tryCatch`, `functions.sleep.sleep`, `functions.db.prisma`, etc. all work in API + sync handlers without any further wiring.

## Related docs

- `packages/devkit/docs/type-map-generation.md` — full codegen pipeline (apis + syncs in addition to functions).
- `packages/devkit/docs/loader-pipeline.md` — runtime side.
- `docs/ARCHITECTURE_API.md` — what API handlers look like in full.
