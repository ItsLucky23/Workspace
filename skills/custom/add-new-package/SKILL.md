# Skill: add-new-package

Scaffold a new `@luckystack/*` package in the monorepo under `packages/<name>/`.

LuckyStack is split into independently publishable packages. Each package owns its own peer dependencies, build config, README, and AI summary. This skill walks through the full scaffolding.

## Workflow

### 1. Create the package folder

```
packages/<name>/
```

Naming conventions:

- `<name>` is `lower-kebab-case`.
- Prefer single-word names where possible (`@luckystack/router`, `@luckystack/login`, `@luckystack/presence`).
- Compound names are allowed when the single word is too generic (`@luckystack/create-luckystack-app`).

### 2. Add `package.json`

```json
{
  "name": "@luckystack/<name>",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "README.md",
    "CLAUDE.md",
    "docs",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch"
  },
  "peerDependencies": {},
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.7.0"
  }
}
```

Peer-dependency policy:

- Anything the consumer must own (React, Prisma, Socket.io) goes in `peerDependencies`.
- Optional integrations (Sentry, Redis) stay out of `peerDependencies`. The package code MUST hard-crash on boot if an env key is set without the corresponding peer dep installed (no silent fallthrough).

### 3. Add `tsup.config.ts`

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
});
```

### 4. Create `src/index.ts`

Start minimal. Export only what consumers should reach for. Internal helpers stay un-exported.

```typescript
export { /* initial exports */ } from './<feature>';
```

### 5. Write `README.md` (consumer-facing)

Audience: a developer who has never seen LuckyStack. Cover:

- One-paragraph "what this package does".
- Install command (`npm install @luckystack/<name>`).
- Required peer deps with versions.
- Quickstart: smallest possible working example.
- Link to the per-package `docs/` folder for deep dives.

### 6. Write `CLAUDE.md` (AI summary + function INDEX)

Audience: a future AI assistant. Cover:

- One-paragraph summary of the package responsibility.
- Architecture sketch (entry points, key types, integration boundary).
- Function INDEX: every exported function with one-line description.
- Pointer to `docs/` for the full doc set.
- Caveats / things the AI should NOT do (e.g. "do not import internal modules directly; consumer should only touch the public exports").

### 7. Create `docs/` with stubs

For each major feature inside the package, drop a stub file in `packages/<name>/docs/`. Use this banner at the top of each stub:

```markdown
# <Feature>

> TODO: this document is a stub. Fill in once the feature stabilizes.
> Last reviewed: <date>
```

A typical first set: `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/INTEGRATION.md`.

### 8. Register the package in the root workspace

Verify the root `package.json` has `"workspaces": ["packages/*"]` (or similar). If yes, no edit needed — npm will pick up the new folder. If the array is more specific, append `"packages/<name>"`.

### 9. Hook into the master build script

If `scripts/buildPackages.mjs` exists, add the new package to its ordered list (respect dependency order: dependents come after dependees). If it does not exist, the workspace-level `npm run build` should be enough.

### 10. Install and link

Run from the repo root:

```bash
npm install
```

This activates workspace symlinks so other packages can `import '@luckystack/<name>'`.

### 11. First build

```bash
npm run build --workspace @luckystack/<name>
```

Verify `dist/index.js` and `dist/index.d.ts` are emitted.

### 12. Update `docs/PACKAGE_OVERVIEW.md`

Add one row to the package table describing the new package, its responsibility, and its status (alpha / beta / stable).

## Reminders

- Stick to the strict typing policy: no `as unknown`, no `as any`, no disabled lint rules.
- Peer deps are a guard rail: missing peer + matching env key = hard crash on boot.
- Keep `src/index.ts` small. If the export surface grows past a screen, split into multiple sub-packages or namespaces rather than dumping everything at the root.
